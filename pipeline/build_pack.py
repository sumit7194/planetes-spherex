"""Build a Planetes pack: everything the viewer needs to show how one patch of sky changed.

For a sky position this:
  1. finds every SPHEREx spectral image covering it (IRSA SIA; DR1 + QR3 by default),
  2. reads only the box around it from IRSA's public S3 bucket (byte ranges),
  3. resamples every exposure onto one north-up grid (6.15"/px, the native scale),
  4. median-combines per survey pass and detector, with two flag policies:
       display - keeps saturated pixels (drawn with a "saturated" overlay), for pictures;
       strict  - masks every artefact flag, for differences and measurements,
  5. measures a quick aperture flux at the target in every exposure, at that exposure's own
     wavelength (from the file's WCS-WAVE table) -> a spectrum per pass,
  6. adds Gaia DR3 and CatWISE2020 sources for the overlay.

Usage:
  uv run python build_pack.py barnard              # a target from targets.json
  uv run python build_pack.py --ra 210 --dec -30   # any position
Options: --box 64 --conc 24 --max-per-cell N --out ../public/packs
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import datetime as dt
import hashlib
import json
import math
import pickle
import sys
import time
import warnings
from pathlib import Path

import aiohttp
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

import catalogs
import spherex as sx

warnings.simplefilter("ignore")
HERE = Path(__file__).parent
PIX = 6.15  # arcsec per output pixel (native SPHEREx scale)
PIX_SR = (PIX / 206264.806) ** 2
APER, ANN_IN, ANN_OUT = 2.5, 5.0, 8.0  # px


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def mjd_iso(m: float) -> str:
    return (dt.datetime(1858, 11, 17) + dt.timedelta(days=m)).strftime("%Y-%m-%d")


def out_grid(ra: float, dec: float, n: int) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    w.wcs.cdelt = [-PIX / 3600, PIX / 3600]
    return w


def target_at(t: dict, mjd: float) -> tuple[float, float]:
    src = dict(ra=t["ra"], dec=t["dec"], pmra=t.get("pmra", 0.0), pmdec=t.get("pmdec", 0.0), epoch=t.get("epoch", 2026.0))
    return catalogs.propagate(src, catalogs.mjd_to_year(mjd))


# ---------------------------------------------------------------- fetching (with a disk cache)

# The cache holds only pickles this script wrote itself (in its own cache/ folder, git-ignored);
# it never loads a pickle from anywhere else.
def cache_path(cache: Path, row: dict, ra: float, dec: float, half: int) -> Path:
    key = hashlib.sha1(f"{row['url']}|{ra:.5f}|{dec:.5f}|{half}".encode()).hexdigest()[:16]
    return cache / f"{row['obs_id']}_D{row['det']}_{key}.pkl"


async def fetch_all(rows, ra, dec, half, conc, cache: Path):
    cache.mkdir(parents=True, exist_ok=True)
    out, todo = [], []
    for r in rows:
        p = cache_path(cache, r, ra, dec, half)
        if p.exists():
            e = pickle.loads(p.read_bytes())
            if e is not None:
                e.update({k: r[k] for k in ("pass",)})
                out.append(e)
        else:
            todo.append(r)
    log(f"  {len(out)} exposures from cache, {len(todo)} to fetch")
    if not todo:
        return out, dict(requests=0, MB=0.0)
    t0 = time.time()
    conn = aiohttp.TCPConnector(limit=conc)
    async with aiohttp.ClientSession(connector=conn, timeout=aiohttp.ClientTimeout(total=180)) as s:
        rd = sx.RangeReader(s)
        sem = asyncio.Semaphore(conc)
        done = [0]

        async def one(r):
            async with sem:
                e = None
                try:
                    e, tab = await asyncio.gather(sx.read_box(rd, r, ra, dec, half), sx.read_wave(rd, r["url"]))
                    if e is not None:
                        e["lam"], e["bw"] = sx.wave_at(tab, e["xt"], e["yt"])
                        e["wcs_hdr"] = e.pop("hdr").tostring()
                        e.pop("wcs")
                except Exception as ex:  # noqa: BLE001
                    log("  skip", r["obs_id"], r["det"], repr(ex)[:140])
                    return None
                cache_path(cache, r, ra, dec, half).write_bytes(pickle.dumps(e))
                done[0] += 1
                if done[0] % 25 == 0:
                    rate = rd.nbytes / 1e6 / max(1e-3, time.time() - t0)
                    log(f"  {done[0]}/{len(todo)}  {time.time() - t0:.0f}s  {rate:.2f} MB/s")
                return e

        got = await asyncio.gather(*(one(r) for r in todo))
        stats = dict(requests=rd.nreq, MB=round(rd.nbytes / 1e6, 1), seconds=round(time.time() - t0, 1))
    out += [e for e in got if e is not None]
    return out, stats


# ---------------------------------------------------------------- per-exposure processing

def resample(e: dict, w_exp: WCS, gw: WCS, n: int, img: np.ndarray, order: int = 1) -> np.ndarray:
    yy, xx = np.mgrid[0:n, 0:n]
    sky = gw.pixel_to_world_values(xx, yy)
    px, py = w_exp.world_to_pixel_values(*sky)
    coords = [py - e["y0"], px - e["x0"]]
    v = map_coordinates(np.nan_to_num(img, nan=0.0), coords, order=order, cval=np.nan)
    good = map_coordinates(np.isfinite(img).astype(float), coords, order=1, cval=0.0)
    v[good < 0.999] = np.nan
    return v


def photometry(e: dict, w_exp: WCS, ra: float, dec: float, disp: np.ndarray, strict_m: np.ndarray, sat_m: np.ndarray):
    x, y = (float(v) for v in w_exp.world_to_pixel_values(ra, dec))
    x -= e["x0"]
    y -= e["y0"]
    ny, nx = disp.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    r = np.hypot(xx - x, yy - y)
    ap = r <= APER
    an = (r >= ANN_IN) & (r <= ANN_OUT) & ~strict_m & np.isfinite(disp)
    if ap.sum() < 5 or an.sum() < 15 or not (APER < x < nx - APER and APER < y < ny - APER):
        return None
    bk = np.median(disp[an])
    sd = 1.4826 * np.median(np.abs(disp[an] - bk))
    vals = disp[ap]
    if not np.all(np.isfinite(vals)):
        return None
    flux = float((vals - bk).sum()) * PIX_SR * 1e12  # MJy/sr * sr -> µJy
    err = float(sd * math.sqrt(ap.sum() * (1 + ap.sum() / an.sum()))) * PIX_SR * 1e12
    names = [n for n, b in e["bits"].items() if n in sx.STRICT and np.any((e["fl"][ap] >> b) & 1)]
    return dict(flux=round(flux, 2), err=round(err, 2), flagged=bool(strict_m[ap].any()),
                saturated=bool(sat_m[ap].any()), flags=names, x=round(x + e["x0"], 2), y=round(y + e["y0"], 2))


def centroid(img: np.ndarray, cx: float, cy: float, rad: float = 3.0):
    """Background-subtracted, positive-weighted centroid within rad px of (cx, cy) (grid pixels)."""
    n = img.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - cx, yy - cy)
    m = (r <= rad) & np.isfinite(img)
    ring = (r > 6) & (r < 10) & np.isfinite(img)
    if m.sum() < 10 or ring.sum() < 20:
        return None
    w = np.clip(img[m] - np.median(img[ring]), 0, None)
    if w.sum() <= 0:
        return None
    return float((xx[m] * w).sum() / w.sum()), float((yy[m] * w).sum() / w.sum())


# ---------------------------------------------------------------- the pack

def build(target: dict, rows: list[dict], exps: list[dict], box: int, fetch_stats: dict, out_dir: Path, catalog: list[dict]):
    n = box
    ra0, dec0 = target["ra"], target["dec"]
    gw = out_grid(ra0, dec0, n)
    npass = 1 + max((r["pass"] for r in rows), default=-1)
    cells = collections.defaultdict(list)
    exposures = []
    frames16, frame_scales = [], []
    flag_hits = collections.Counter()
    flag_total = 0
    for e in sorted(exps, key=lambda e: (e["t"], e["det"])):
        w_exp = WCS(fits.Header.fromstring(e["wcs_hdr"]))
        strict_m = sx.mask_of(e, sx.STRICT)
        disp_m = sx.mask_of(e, sx.DISPLAY)
        sat_m = sx.mask_of(e, sx.SATURATION)
        d_img = np.where(disp_m, np.nan, e["img"])
        s_img = np.where(strict_m, np.nan, e["img"])
        d = resample(e, w_exp, gw, n, d_img)
        s = resample(e, w_exp, gw, n, s_img)
        sat = resample(e, w_exp, gw, n, sat_m.astype(np.float32), order=0)
        if np.isfinite(d).mean() < 0.25:
            continue
        bg = np.nanmedian(d)
        d -= bg
        s -= bg
        cells[(e["pass"], e["det"])].append((d, s, np.nan_to_num(sat, nan=0.0), e))
        # flag statistics in the central 9x9 native pixels around the target
        tx, ty = int(round(e["xt"] - e["x0"])), int(round(e["yt"] - e["y0"]))
        core = e["fl"][max(0, ty - 4):ty + 5, max(0, tx - 4):tx + 5]
        flag_total += core.size
        for name, b in e["bits"].items():
            flag_hits[name] += int(((core >> b) & 1).sum())
        tra, tdec = target_at(target, e["mjd"])
        ph = photometry(e, w_exp, tra, tdec, d_img, strict_m, sat_m)
        scale = float(np.nanmax(np.abs(d))) / 32000 if np.isfinite(d).any() else 1.0
        scale = scale or 1.0
        q = np.where(np.isfinite(d), np.round(d / scale), -32768).astype("<i2")
        frames16.append(q)
        frame_scales.append(scale)
        exposures.append(dict(obsId=e["obs_id"], det=e["det"], pass_=e["pass"], mjd=round(e["mjd"], 5),
                              lam=round(e["lam"], 4), bw=round(e["bw"], 4), release=e["release"].upper(),
                              frame=len(frames16) - 1, phot=ph))

    data = bytearray()
    sat_bytes = bytearray()
    out_cells = []
    for (p, det), lst in sorted(cells.items()):
        D = np.nanmedian(np.stack([x[0] for x in lst]), 0).astype("<f4")
        S = np.nanmedian(np.stack([x[1] for x in lst]), 0).astype("<f4")
        SAT = (np.mean(np.stack([x[2] for x in lst]), 0) * 255).round().astype(np.uint8)
        mjds = [x[3]["mjd"] for x in lst]
        lams = [x[3]["lam"] for x in lst]
        good = S[np.isfinite(S)]
        sigma = float(1.4826 * np.median(np.abs(good - np.median(good)))) if good.size > 50 else None
        mid = float(np.median(mjds))
        # predicted target position on the grid at this pass, and a rough measured centroid
        tra, tdec = target_at(target, mid)
        px, py = (float(v) for v in gw.world_to_pixel_values(tra, tdec))
        c = centroid(D, px, py)
        fin = D[np.isfinite(D)]
        out_cells.append(dict(
            pass_=p, det=det, n=len(lst), mjdMin=round(min(mjds), 4), mjdMax=round(max(mjds), 4), mjdMid=round(mid, 4),
            lamMin=round(min(lams), 4), lamMax=round(max(lams), 4),
            display=len(data) // 4, strict=len(data) // 4 + n * n, sat=len(sat_bytes),
            stats=dict(p1=float(np.percentile(fin, 1)), p50=float(np.percentile(fin, 50)),
                       p99=float(np.percentile(fin, 99)), p999=float(np.percentile(fin, 99.9)), max=float(fin.max()),
                       sigma=sigma),
            predicted=dict(x=round(px, 3), y=round(py, 3)),
            centroid=None if c is None else dict(x=round(c[0], 3), y=round(c[1], 3)),
        ))
        data += D.tobytes() + S.tobytes()
        sat_bytes += SAT.tobytes()

    passes = []
    for p in range(npass):
        pr = [r for r in rows if r["pass"] == p]
        if not pr:
            continue
        passes.append(dict(i=p, mjdMin=round(min(r["t"] for r in pr), 4), mjdMax=round(max(r["t"] for r in pr), 4),
                           start=mjd_iso(min(r["t"] for r in pr)), end=mjd_iso(max(r["t"] for r in pr)),
                           releases=sorted({r["release"].upper() for r in pr}), listed=len(pr),
                           used=sum(1 for x in exposures if x["pass_"] == p)))

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "coadds.bin").write_bytes(bytes(data))
    (out_dir / "sat.bin").write_bytes(bytes(sat_bytes))
    (out_dir / "frames.bin").write_bytes(b"".join(f.tobytes() for f in frames16))
    pack = dict(
        format="planetes-event-pack/1",
        created=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        slug=target["slug"], name=target["name"], kind=target.get("kind", "look"), blurb=target.get("blurb", ""),
        target=dict(ra=ra0, dec=dec0, epoch=target.get("epoch", 2026.0), pmra=target.get("pmra", 0.0),
                    pmdec=target.get("pmdec", 0.0), pmSource=target.get("pmSource")),
        grid=dict(n=n, pixArcsec=PIX, crval=[ra0, dec0], northUp=True, eastLeft=True),
        collections=sx.COLLECTIONS,
        releases=sorted({x["release"] for x in exposures}),
        passes=passes,
        cells=out_cells,
        exposures=exposures,
        frameScales=[round(s, 8) for s in frame_scales],
        flagFractionsCore={k: round(v / flag_total, 4) for k, v in sorted(flag_hits.items()) if flag_total and v},
        policies=dict(strict=sx.STRICT, display=sx.DISPLAY, saturation=sx.SATURATION),
        photometry=dict(method="aperture", radiusPx=APER, annulusPx=[ANN_IN, ANN_OUT], units="µJy",
                        note="Quick aperture sum, no aperture correction; flagged points use pixels with artefact flags."),
        catalog=catalog,
        fetch=fetch_stats,
        bunit=exps[0].get("bunit", "MJy/sr") if exps else "",
    )
    pack = json.loads(json.dumps(pack).replace('"pass_"', '"pass"'))
    (out_dir / "pack.json").write_text(json.dumps(pack, separators=(",", ":")))
    return pack


def load_targets() -> dict:
    return {t["slug"]: t for t in json.loads((HERE / "targets.json").read_text())["targets"]}


async def run(target: dict, box: int, conc: int, max_per_cell: int, out_root: Path, cache: Path, with_catalog: bool = True):
    t0 = time.time()
    ra, dec = target["ra"], target["dec"]
    log(f"[{target['slug']}] SIA search at {ra:.5f} {dec:+.5f}")
    rows = sx.search(ra, dec)
    npass = sx.group_passes(rows)
    log(f"  {len(rows)} exposures in {npass} passes ({time.time() - t0:.0f}s)")
    if max_per_cell:
        by = collections.defaultdict(list)
        for r in rows:
            by[(r["pass"], r["det"])].append(r)
        rows = []
        for k in sorted(by):
            lst = by[k]
            step = max(1, len(lst) // max_per_cell)
            rows += lst[::step][:max_per_cell]
    # half-size of the native box: the grid is rotated relative to the detector, so read a margin
    half = int(box * 0.75) + 6
    exps, stats = await fetch_all(rows, ra, dec, half, conc, cache)
    stats["exposuresListed"] = len(rows)
    catalog = []
    if with_catalog:
        rad = box * PIX / 3600 * 0.75
        for fn in (catalogs.gaia_dr3, catalogs.catwise2020):
            try:
                catalog += fn(ra, dec, rad)
            except Exception as ex:  # noqa: BLE001 - the overlay is optional
                log("  catalogue skipped:", fn.__name__, repr(ex)[:100])
    pack = build(target, rows, exps, box, stats, out_root / target["slug"], catalog)
    log(f"  wrote {out_root / target['slug']} ({len(pack['exposures'])} exposures, {len(pack['cells'])} cells) "
        f"in {time.time() - t0:.0f}s")
    return pack


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--ra", type=float)
    ap.add_argument("--dec", type=float)
    ap.add_argument("--name")
    ap.add_argument("--box", type=int, default=64)
    ap.add_argument("--conc", type=int, default=24)
    ap.add_argument("--max-per-cell", type=int, default=0)
    ap.add_argument("--out", default=str(HERE.parent / "public" / "packs"))
    ap.add_argument("--cache", default=str(HERE / "cache"))
    ap.add_argument("--no-catalog", action="store_true")
    a = ap.parse_args()
    if a.slug and a.slug in load_targets():
        t = dict(load_targets()[a.slug])
    elif a.ra is not None and a.dec is not None:
        t = dict(slug=a.slug or f"p{a.ra:.4f}{a.dec:+.4f}", name=a.name or f"RA {a.ra:.4f}, Dec {a.dec:+.4f}",
                 ra=a.ra, dec=a.dec, kind="look")
    else:
        ap.error("give a target slug from targets.json or --ra and --dec")
    box = t.get("box", a.box)
    asyncio.run(run(t, box, a.conc, a.max_per_cell, Path(a.out), Path(a.cache), not a.no_catalog))


if __name__ == "__main__":
    main()
