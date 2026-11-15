"""The slow-mover yardstick's fake-mover run (prereg/slowmover/PLAN.md §3, §5, §8).

For each of the 40 development fields (fields_dev.json): read every photo once through the helper
with extra=1 (IMAGE, FLAGS, VARIANCE, ZODI, headers; the path smo_identity.py checked), then for
each of 5 injection passes:
  1. draw 6 fakes (§3): 4 isolated (≥ 8 px from each other and from any source in the all-season
     stack, outside saturated blobs and their glare) and 2 anywhere outside saturated blobs;
     PM log-uniform 0.3-10″/yr, random direction; parallax from v_tan (lognormal, median 30 km/s,
     σ_ln 0.5, 5-200 km/s); W2 uniform 12-18; family: brown-dwarf-like (Sonora 900 K / 500 K,
     alternating) or star-like (4000 K blackbody), half each;
  2. in every photo, render each fake along its track over the exposure (smo.inject.render,
     SMEAR_STEPS sub-steps from MJD-BEG to MJD-END; PM plus parallax from Earth's position) at
     its own band flux (F_ν over [CWAVE ± CBAND/2] at its pixel, spectral_wcs cal-swcs-v5);
  3. seal the truth (smo.inject.truth.seal) and record its sha256 BEFORE stacking or scoring;
  4. stack with field_stacks.stack_exps (the N3 code, unchanged), passes as seasons, and search
     with season_pairs.search_stacks (keep_all) using the field's Gaia-quiet stars (VizieR I/355).
Scoring is a separate step (yardstick_score.py), against the sealed truth, at T = 11.19 (frozen).

Seeds: numpy SeedSequence from sha256(field|pass), spawned into draw / photometry / per-photo noise
streams, so the same pass is reproducible and changing one stream cannot shift another.

Usage: GAIA_SOURCE=vizier python yardstick_inject.py --first 0 --count 40 [--workers 3]
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

import aiohttp
import numpy as np
from astropy.coordinates import get_body_barycentric
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS

import build_pack as bp
import fake_phot as fp
import field_stacks as fs
import helper_client as hc
import inject_io as io
import season_pairs as sp
import yardstick_null as yn

from smo.data.calib import release_for_version, spectral_wcs  # noqa: E402  (inject_io set the path)
from smo.inject.render import SMEAR_STEPS, FrameFake, inject, pixel_solid_angle_sr  # noqa: E402
from smo.inject.truth import seal  # noqa: E402

HERE = Path(__file__).parent
FIELDS = HERE.parent / "prereg" / "slowmover" / "fields_dev.json"
OUT = HERE / "yardstick_inject"
CAL = HERE / "cache" / "smo_calib"
PASSES, N_FAKES, N_ISOLATED = 5, 6, 4
T_FROZEN = 11.19
AU_KM = 1.495978707e8
MAS = math.pi / 180 / 3600 / 1000
# The W2 zero-point convention (Physics, 15 Nov): "wise" or "calspec". Must be set before a run.
W2_SYSTEM = os.environ.get("W2_SYSTEM", "")
WISE_OVER_CALSPEC = 171.787 / 167.34  # F_ν(4.6028 µm) of WISE's Vega vs CALSPEC stis_012


def seeds(field: str, pass_no: int) -> list[np.random.SeedSequence]:
    h = int.from_bytes(hashlib.sha256(f"{field}|{pass_no}".encode()).digest()[:8], "little")
    return np.random.SeedSequence(h).spawn(3)  # draw, photometry, noise


def earth_au(mjd: float) -> np.ndarray:
    """Earth's barycentric position (AU, ICRS equatorial)."""
    p = get_body_barycentric("earth", Time(mjd, format="mjd", scale="tdb"))
    return np.array([p.x.value, p.y.value, p.z.value]) / AU_KM if p.x.unit.to_string() == "km" else \
        np.array([p.x.to_value("AU"), p.y.to_value("AU"), p.z.to_value("AU")])


def apparent(f: dict, mjd: float) -> tuple[float, float]:
    """Where a fake appears at mjd: its barycentric place at t_ref moved by PM, seen from Earth
    (parallax from its distance 1/π)."""
    dt = (mjd - f["t_ref"]) / 365.25
    dec0 = math.radians(f["dec"])
    ra = f["ra"] + f["pmra_mas"] * dt / 3.6e6 / math.cos(dec0)
    dec = f["dec"] + f["pmdec_mas"] * dt / 3.6e6
    a, d = math.radians(ra), math.radians(dec)
    dist_au = 1.0 / (f["plx_mas"] * MAS)
    v = np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]) * dist_au - earth_au(mjd)
    return math.degrees(math.atan2(v[1], v[0])) % 360, math.degrees(math.asin(v[2] / np.linalg.norm(v)))


def draw_fakes(field: dict, pass_no: int, t_ref: float, srcs: list, blobs: list, sat_any: np.ndarray) -> list[dict]:
    """§3, one injection pass: 6 fakes, 4 isolated then 2 anywhere, on the field's 64 px grid."""
    rng = np.random.default_rng(seeds(field["field"], pass_no)[0])
    n = fs.SIZE
    gw = bp.out_grid(field["ra"], field["dec"], n)
    margin = 6

    def in_glare(x, y):
        return any(3 < math.hypot(x - bx, y - by) < r for bx, by, r in blobs)

    def on_sat(x, y):
        return bool(sat_any[int(round(y)), int(round(x))])

    fakes: list[dict] = []
    for k in range(N_FAKES):
        isolated = k < N_ISOLATED
        for _ in range(10000):
            x, y = rng.uniform(margin, n - 1 - margin, 2)
            if on_sat(x, y) or in_glare(x, y):
                continue
            if isolated and (any(math.hypot(x - sx, y - sy) < 8 for sx, sy, _ in srcs)
                             or any(math.hypot(x - g["gx"], y - g["gy"]) < 8 for g in fakes)):
                continue
            break
        else:
            raise RuntimeError(f"{field['field']} pass {pass_no}: no room for fake {k}")
        ra, dec = gw.all_pix2world(x, y, 0)
        pm = 10 ** rng.uniform(math.log10(300), math.log10(10000))  # mas/yr, 0.3-10″/yr
        ang = rng.uniform(0, 2 * math.pi)
        while True:
            vt = 30 * math.exp(0.5 * rng.standard_normal())
            if 5 <= vt <= 200:
                break
        plx_mas = (pm / 1000) / (4.74 * vt) * 1000
        family = (("bd900", "bd500")[(k // 2) % 2]) if k % 2 == 0 else "bb4000"
        fakes.append(dict(fake_id=k, placement="isolated" if isolated else "anywhere", gx=float(x), gy=float(y),
                          ra=float(ra), dec=float(dec), t_ref=t_ref, pm_mas=pm, pa_deg=math.degrees(ang),
                          pmra_mas=pm * math.sin(ang), pmdec_mas=pm * math.cos(ang), vt_kms=vt, plx_mas=plx_mas,
                          w2=float(rng.uniform(12, 18)), family=family))
    return fakes


def spectrum_jy(f: dict) -> tuple[np.ndarray, np.ndarray]:
    lam, fnu = fp.shape(f["family"])
    s = fp.scale_to_w2(lam, fnu, f["w2"])
    if W2_SYSTEM == "wise":
        s *= WISE_OVER_CALSPEC
    elif W2_SYSTEM != "calspec":
        raise SystemExit("W2_SYSTEM must be set to 'wise' or 'calspec' (Physics' decision) before a run")
    return lam, fnu * s


def frame_fakes(e: dict, cut, fakes: list[dict], spectra: dict) -> tuple[list[FrameFake], list[dict]]:
    """Each fake's sub-step positions in this photo's cutout and its flux there."""
    h = fits.Header.fromstring(e["wcs_hdr"])
    w = WCS(h)
    ts = np.linspace(float(h["MJD-BEG"]), float(h["MJD-END"]), SMEAR_STEPS)
    det = int(e["det"])
    cw, cb, _ = spectral_wcs(CAL, det, release_for_version(cut.meta["version"]))
    omega = pixel_solid_angle_sr(cut)
    ny, nx = cut.shape
    out, rec = [], []
    for f in fakes:
        xs, ys = [], []
        for t in ts:
            ra, dec = apparent(f, float(t))
            px, py = w.all_world2pix(ra, dec, 0)
            xs.append(float(px) - e["x0"])
            ys.append(float(py) - e["y0"])
        xm, ym = xs[SMEAR_STEPS // 2], ys[SMEAR_STEPS // 2]
        ix, iy = int(round(xm)), int(round(ym))
        if not (0 <= ix < nx and 0 <= iy < ny):
            continue
        lam, fjy = spectra[f["fake_id"]]
        cwave, cband = float(cw[iy + e["y0"], ix + e["x0"]]), float(cb[iy + e["y0"], ix + e["x0"]])
        fnu = fp.band_fnu_jy(lam, fjy, cwave, cband)
        out.append(FrameFake(f["fake_id"], np.array(xs), np.array(ys), float(fnu * 1e-6 / omega)))
        rec.append(dict(fake_id=f["fake_id"], obs=e.get("obs_id"), det=det, jy=fnu, cwave=cwave, cband=cband,
                        x_mid=xm + e["x0"], y_mid=ym + e["y0"]))
    return out, rec


async def read_field(rows, ra, dec, conc=16):
    sem = asyncio.Semaphore(conc)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as s:
        async def one(r):
            async with sem:
                try:
                    return await hc.native(s, r, ra, dec, fs.HALF, extra=True)
                except Exception:  # noqa: BLE001
                    return None
        exps = await asyncio.gather(*(one(r) for r in rows))
        psfs = {}
        for e in exps:
            if e is not None and e["psf_sha256"] not in psfs:
                psfs[e["psf_sha256"]] = await io.psf_for(s, e)
    return exps, psfs


def run_field(field: dict) -> None:
    name = field["field"]
    fdir = OUT / name
    fdir.mkdir(parents=True, exist_ok=True)
    rows = fs.search_rows(field["ra"], field["dec"])
    exps, psfs = asyncio.run(read_field(rows, field["ra"], field["dec"]))
    ok = [(r, e) for r, e in zip(rows, exps) if e is not None]
    rows_ok, exps_ok = [r for r, _ in ok], [e for _, e in ok]
    # The un-injected all-season stack: sources, saturated blobs and glare for placement (§3).
    base = fs.stack_exps(field, rows_ok, exps_ok, "passes")
    np.savez_compressed(fdir / "stacks_base.npz", **base)
    st0 = yn.load_stacks(fdir / "stacks_base.npz")
    # As search_stacks does: the all-season reference, its sources, saturated blobs and glare.
    ref = np.nanmedian(np.stack([v["img"] for v in st0.values()]), axis=0)
    srcs = sp.find_sources(ref)
    from scipy.ndimage import label
    sat_any = np.any(np.stack([v["sat"] for v in st0.values()]), axis=0)
    lab, nb = label(sat_any)
    blobs = []
    for k in range(1, nb + 1):
        yy, xx = np.nonzero(lab == k)
        if len(yy) >= 6:
            blobs.append((xx.mean(), yy.mean(), float(np.clip(3 * np.sqrt(len(yy)), 6, 16))))
    t_ref = float(np.mean([e["mjd"] for e in exps_ok]))
    quiet = yn.quiet_pixels(field)
    log = dict(field=name, photos=len(rows), read=len(exps_ok), sources=len(srcs), blobs=len(blobs),
               psf_versions=len(psfs), t_ref=t_ref, w2_system=W2_SYSTEM, passes=[])
    for p in range(PASSES):
        fakes = draw_fakes(field, p, t_ref, srcs, blobs, sat_any)
        spectra = {f["fake_id"]: spectrum_jy(f) for f in fakes}
        noise_root = seeds(name, p)[2]
        injected, per_photo = [], []
        for i, e in enumerate(exps_ok):
            hdr, planes = psfs[e["psf_sha256"]]
            cut = io.cutout_from(e, hdr, planes)
            ff, rec = frame_fakes(e, cut, fakes, spectra)
            if ff:
                rng = np.random.default_rng(np.random.SeedSequence(noise_root.entropy, spawn_key=(i,)))
                out, _ = inject(cut, ff, rng)
                injected.append(dict(e, img=out.image))
                per_photo.extend(rec)
            else:
                injected.append(e)
        truth = dict(field=name, pass_no=p, t_ref=t_ref, w2_system=W2_SYSTEM, fakes=fakes, per_photo=per_photo,
                     seeds=[int(seeds(name, p)[0].entropy)])
        sha = seal(fdir / f"truth_p{p}.json", truth)
        stacks = fs.stack_exps(field, rows_ok, injected, "passes")
        np.savez_compressed(fdir / f"stacks_p{p}.npz", **stacks)
        st = yn.load_stacks(fdir / f"stacks_p{p}.npz")
        res = sp.search_stacks(st, fs.SIZE, lambda _s: quiet, keep_all=True)
        (fdir / f"search_p{p}.json").write_text(json.dumps(res, default=float))
        log["passes"].append(dict(pass_no=p, truth_sha256=sha, injected_photos=sum(1 for r in per_photo),
                                  pairs=len(res)))
        print(f"{name} pass {p}: truth sealed {sha[:12]}, {len(per_photo)} fake-photo renders, {len(res)} pairs", flush=True)
    (fdir / "run.json").write_text(json.dumps(log, indent=1, default=float))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", type=int, default=0)
    ap.add_argument("--count", type=int, default=1)
    a = ap.parse_args()
    if W2_SYSTEM not in ("wise", "calspec"):
        raise SystemExit("set W2_SYSTEM=wise or calspec (Physics' decision) first")
    fields = json.loads(FIELDS.read_text())[a.first:a.first + a.count]
    OUT.mkdir(exist_ok=True)
    for f in fields:
        if (OUT / f["field"] / "run.json").exists():
            continue
        t0 = time.time()
        try:
            run_field(f)
        except Exception as ex:  # noqa: BLE001
            print(f"{f['field']} skipped for now: {ex!r}"[:300], flush=True)
            continue
        print(f"{f['field']} done in {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    sys.exit(main())
