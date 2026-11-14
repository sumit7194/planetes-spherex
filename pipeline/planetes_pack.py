"""Write a target's photos in the Planetes viewer's pack format (planetes-pack/1), from today's
DR1+QR3 fetch (the cache build_pack.py fills), and measure its motion or brightness.

  public/data/packs/dr1qr3/<id>/manifest.json
  public/data/packs/dr1qr3/<id>/measurements.json
  public/data/packs/dr1qr3/<id>/frames/<frame>.f32   float32 LE, size x size, MJy/sr, minus the frame median
  public/data/packs/dr1qr3/<id>/frames/<frame>.u8    FlagMask: 1 saturated, 2 rejected, 4 source, 8 outlier
  public/data/packs/dr1qr3/<id>/spectrum.json        one aperture flux per photo at its own wavelength

The format is the one the pre-event practice viewer reads (see PRIOR_WORK.md); the writer and the
measurements here are new, run on data fetched during the event.

Usage: uv run python planetes_pack.py barnard [--size 48]
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import datetime as dt
import hashlib
import json
import math
import subprocess
import warnings
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

import build_pack as bp
import catalogs
import measure
import spherex as sx

warnings.simplefilter("ignore")
HERE = Path(__file__).parent
OUT = HERE.parent / "public" / "data" / "packs" / "dr1qr3"
SAT = 1
REJ = 2
SRC = 4
OUTL = 8
SAT_NAMES = sx.SATURATION
REJ_NAMES = [n for n in sx.STRICT if n not in sx.SATURATION]


def flag_byte(e: dict) -> np.ndarray:
    """Per native pixel: the four FlagMask bits, decoded by name from this file's own FLAGS header."""
    out = np.zeros(e["fl"].shape, np.uint8)
    out[sx.mask_of(e, SAT_NAMES)] |= SAT
    out[sx.mask_of(e, REJ_NAMES)] |= REJ
    out[sx.mask_of(e, ["SOURCE"])] |= SRC
    out[sx.mask_of(e, ["OUTLIER"])] |= OUTL
    return out


def resample_frame(e: dict, w_exp: WCS, gw: WCS, n: int):
    """Bilinear image on the grid, and the OR of the flags of every native pixel the sample draws on."""
    yy, xx = np.mgrid[0:n, 0:n]
    sky = gw.pixel_to_world_values(xx, yy)
    px, py = w_exp.world_to_pixel_values(*sky)
    px = px - e["x0"]
    py = py - e["y0"]
    img = e["img"]
    v = map_coordinates(np.nan_to_num(img, nan=0.0), [py, px], order=1, cval=np.nan)
    good = map_coordinates(np.isfinite(img).astype(float), [py, px], order=1, cval=0.0)
    v[good < 0.999] = np.nan
    fb = flag_byte(e)
    H, W = fb.shape
    fl = np.zeros((n, n), np.uint8)
    x0 = np.floor(px).astype(int)
    y0 = np.floor(py).astype(int)
    for dy in (0, 1):
        for dx in (0, 1):
            xi = np.clip(x0 + dx, 0, W - 1)
            yi = np.clip(y0 + dy, 0, H - 1)
            fl |= fb[yi, xi]
    # Samples off the detector carry no flags (they have no data; the browser reader agrees).
    # Before 14 Nov the clipped lookup gave them the edge pixel's flags.
    nxd, nyd = w_exp.pixel_shape  # (NAXIS1, NAXIS2) of the photo
    gx, gy = px + e["x0"], py + e["y0"]
    fl[(gx < 0) | (gx > nxd - 1) | (gy < 0) | (gy > nyd - 1)] = 0
    if np.isfinite(v).any():
        v = v - np.nanmedian(v)
    return v.astype("<f4"), fl


DATA = HERE.parent / "public" / "data"


def offsets(gw: WCS, ra: float, dec: float) -> tuple[float, float]:
    """East and north offsets from the grid centre, arcsec."""
    x, y = gw.world_to_pixel_values(ra, dec)
    c = (gw.pixel_shape[0] - 1) / 2 if gw.pixel_shape else None
    n = gw.wcs.crpix[0] * 2 - 1
    c = (n - 1) / 2
    return round(-(float(x) - c) * bp.PIX, 2), round((float(y) - c) * bp.PIX, 2)


def write_overlay(slug, t, frames, gaia, catwise, gw, size):
    seasons = sorted({f["season"] for f in frames})
    mean_mjd = {str(s): float(np.mean([f["mjd"] for f in frames if f["season"] == s])) for s in seasons}
    t_src = dict(ra=t["ra"], dec=t["dec"], pmra=t.get("pmra", 0), pmdec=t.get("pmdec", 0), epoch=t.get("epoch", 2026.0))

    def at(src):
        out = {}
        for s, m in mean_mjd.items():
            r, d = catalogs.propagate(src, catalogs.mjd_to_year(m))
            out[s] = [round(r, 7), round(d, 7), *offsets(gw, r, d)]
        return out

    def is_target(src):
        # Near the target's position at the catalogue's own epoch, AND moving like it. Position
        # alone flagged steady sources sitting where a fast mover was at that epoch (W0855's
        # 2015 CatWISE place is ~87" from today's; found by Viewer, 14 Nov).
        tr, td = catalogs.propagate(t_src, src["epoch"])
        near = math.hypot((src["ra"] - tr) * math.cos(math.radians(td)), src["dec"] - td) * 3600 < (8 if src["cat"] == "CatWISE2020" else 2)
        dpm = math.hypot((src.get("pmra") or 0.0) - t_src.get("pmra", 0.0), (src.get("pmdec") or 0.0) - t_src.get("pmdec", 0.0))
        tpm = math.hypot(t_src.get("pmra", 0.0), t_src.get("pmdec", 0.0))
        # mas/yr: within 30% of the target's motion, or 300 mas/yr for slow targets (CatWISE's errors).
        return near and dpm < max(300.0, 0.3 * tpm)

    g = [dict(source_id=x["id"], G=x["mag"], parallax_mas=x["plx"], pmra_mas_yr=x["pmra"], pmdec_mas_yr=x["pmdec"],
              at_season=at(x), target=is_target(x)) for x in gaia]
    c = [dict(source_name=x["id"], W1=x.get("w1"), W2=x["mag"], pmra_arcsec_yr=round(x["pmra"] / 1000, 4),
              pmdec_arcsec_yr=round(x["pmdec"] / 1000, 4), at_season=at(x), target=is_target(x)) for x in catwise]
    doc = dict(pack=slug, what="catalogue sources in this pack's field; catalogue data, not SPHEREx",
               grid=dict(centre=dict(ra=t["ra"], dec=t["dec"]), orientation="north-up-east-left", pixelScaleArcsec=bp.PIX, size=size),
               season_mean_mjd=mean_mjd, at_season_columns=["ra_deg", "dec_deg", "east_arcsec", "north_arcsec"],
               gaia_dr3=g, catwise2020=c,
               credit=dict(gaia="Gaia DR3 (ESA/Gaia/DPAC), via the ESA Gaia archive.",
                           catwise="CatWISE2020 (Marocco et al. 2021), via IRSA."),
               notes="Positions moved by proper motion only (no parallax) to each pass's mean photo time. Made during the event.")
    (DATA / "overlays").mkdir(parents=True, exist_ok=True)
    (DATA / "overlays" / f"overlay_{slug}.json").write_text(json.dumps(doc, separators=(",", ":")))


def write_spectrum(slug, t, spec, gaia, gw):
    kept = [p for p in spec if not p["flagged"] and not p["saturated"]]
    sn = sorted(p["fluxUJy"] / p["errUJy"] for p in kept if p["errUJy"] > 0)
    med_sn = sn[len(sn) // 2] if sn else 0.0
    frac = len(kept) / max(1, len(spec))
    # Known stars inside the aperture (plus a pixel) would add their light to the target's.
    t_src = dict(ra=t["ra"], dec=t["dec"], pmra=t.get("pmra", 0), pmdec=t.get("pmdec", 0), epoch=t.get("epoch", 2026.0))
    tr, td = catalogs.propagate(t_src, 2026.0)
    blend = []
    seps = []
    for x in gaia:
        r, d = catalogs.propagate(x, 2026.0)
        seps.append((math.hypot((r - tr) * math.cos(math.radians(td)), d - td) * 3600, x))
    me = [x for sep, x in seps if sep <= 2.0]
    t_mag = me[0]["mag"] if me else None
    for sep, x in seps:
        # Inside the aperture, and bright enough to matter: within 3.3 mag (5%) of the target,
        # or any star brighter than G 19.5 when the target itself isn't in Gaia (too red, too faint).
        if 2.0 < sep <= bp.APER * bp.PIX and (x["mag"] or 99) < (t_mag + 3.3 if t_mag is not None else 19.5):
            blend.append(f"Gaia DR3 {x['id']} (G {x['mag']}) {sep:.1f} arcsec away")
    if blend:
        status, reason = "not measurable", "blended: " + "; ".join(blend) + " lies inside the aperture, so its light would be counted"
    elif frac < 0.8:
        status, reason = "not measurable", f"{len(kept)} of {len(spec)} photos usable ({frac:.0%}); the rest are saturated or flagged at the star"
    elif med_sn >= 10:
        status, reason = "measured", f"{len(kept)} of {len(spec)} photos usable ({frac:.0%}); median S/N {med_sn:.1f}"
    else:
        status, reason = "binned only", f"{len(kept)} of {len(spec)} photos usable; median S/N {med_sn:.1f} per photo"
    doc = dict(pack=slug, target=slug, unit="uJy", status=status, reason=reason,
               status_rule="measured: >= 80% of photos usable, median S/N >= 10 and no catalogued star inside the aperture",
               label="SPHEREx DR1+QR3, measured during the event; one point per photo at that photo's own wavelength (WCS-WAVE)",
               flux_definition=f"aperture sum within {bp.APER} px minus the median of a {bp.ANN_IN}-{bp.ANN_OUT} px annulus; MJy/sr x pixel solid angle; no aperture correction",
               error_definition="annulus scatter, scaled to the aperture",
               columns=["lambda_um", "flux_uJy", "sigma_uJy", "detector", "season"],
               exposures=[[p["lambdaUm"], p["fluxUJy"], p["errUJy"], p["detector"], p["season"]] for p in kept],
               binned_by_season={}, binned_columns=[])
    (DATA / "spectra").mkdir(parents=True, exist_ok=True)
    (DATA / "spectra" / f"spectrum_{slug}.json").write_text(json.dumps(doc, separators=(",", ":")))


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip()
    except Exception:  # noqa: BLE001
        return "uncommitted"


async def main_async(slug: str, size: int, conc: int):
    targets = bp.load_targets()
    t = dict(targets[slug])
    ra, dec = t["ra"], t["dec"]
    rows = sx.search(ra, dec)
    sx.group_passes(rows)
    half = int(64 * 0.75) + 6  # same boxes as build_pack's 64 px packs, so the cache is reused
    exps, stats = await bp.fetch_all(rows, ra, dec, half, conc, HERE / "cache")
    exps.sort(key=lambda e: (e["mjd"], e["det"]))
    gw = bp.out_grid(ra, dec, size)
    out = OUT / slug
    (out / "frames").mkdir(parents=True, exist_ok=True)
    for old in (out / "frames").glob("*"):
        old.unlink()

    frames, arrays = [], {}
    spec = []
    for e in exps:
        w_exp = WCS(fits.Header.fromstring(e["wcs_hdr"]))
        img, fl = resample_frame(e, w_exp, gw, size)
        if np.isfinite(img).mean() < 0.5:
            continue
        fid = f"{e['obs_id']}D{e['det']}_D{e['det']}"
        (out / "frames" / f"{fid}.f32").write_bytes(img.tobytes())
        (out / "frames" / f"{fid}.u8").write_bytes(fl.tobytes())
        frames.append(dict(
            id=fid, obsId=f"{e['obs_id']}D{e['det']}", detector=e["det"], mjd=round(e["mjd"], 6), season=e["pass"],
            lambdaUm=round(e["lam"], 4), bandwidthUm=round(e["bw"], 4), colourUncertain=False,
            registrationPx=[0.0, 0.0], sha256=hashlib.sha256(img.tobytes()).hexdigest(),
            image=f"frames/{fid}.f32", flags=f"frames/{fid}.u8", release=e["release"].upper(),
        ))
        arrays[fid] = (img, fl, e)
        tra, tdec = bp.target_at(t, e["mjd"])
        strict_m = sx.mask_of(e, sx.STRICT)
        sat_m = sx.mask_of(e, sx.SATURATION)
        d_img = np.where(sx.mask_of(e, sx.DISPLAY), np.nan, e["img"])
        ph = bp.photometry(e, w_exp, tra, tdec, d_img, strict_m, sat_m)
        if ph:
            spec.append(dict(frame=fid, season=e["pass"], detector=e["det"], mjd=round(e["mjd"], 5),
                             lambdaUm=round(e["lam"], 4), fluxUJy=ph["flux"], errUJy=ph["err"],
                             flagged=ph["flagged"], saturated=ph["saturated"], flags=ph["flags"]))

    # Stacks: one detector per season, and all colours per season (every detector, equal weight).
    stacks = []
    seasons = sorted({f["season"] for f in frames})
    for s in seasons:
        per_det = {}
        for d in range(1, 7):
            ids = [f["id"] for f in frames if f["season"] == s and f["detector"] == d]
            if not ids:
                continue
            fls = np.stack([arrays[i][1] for i in ids])
            # Each photo's artefact pixels are left out of the stack; saturated ones stay (they are
            # outlined in the viewer, never hidden).
            ims = np.stack([np.where((arrays[i][1] & REJ) != 0, np.nan, arrays[i][0]) for i in ids])
            med = np.nanmedian(ims, 0).astype("<f4")
            # A stack pixel is flagged when most of its photos are. SOURCE marks nearly every pixel
            # near stars in every photo, so it carries nothing at stack level and is not set.
            stack_fl = np.zeros((size, size), np.uint8)
            for bit in (SAT, REJ, OUTL):
                stack_fl[((fls & bit) != 0).mean(0) >= 0.5] |= bit
            sid = f"one-detector_s{s}_D{d}"
            (out / "frames" / f"{sid}.f32").write_bytes(med.tobytes())
            (out / "frames" / f"{sid}.u8").write_bytes(stack_fl.tobytes())
            stacks.append(dict(id=sid, kind="one-detector", season=s, detectors=[d], frameIds=ids,
                               image=f"frames/{sid}.f32", flags=f"frames/{sid}.u8"))
            g = med[np.isfinite(med)]
            sig = 1.4826 * np.median(np.abs(g - np.median(g))) if g.size else 1.0
            per_det[d] = (med / max(sig, 1e-9), stack_fl, ids)
        if per_det:
            allc = np.nanmean(np.stack([v[0] for v in per_det.values()]), 0).astype("<f4")
            # All colours: a pixel is flagged when most detectors' stacks flag it (not when any one does).
            dets_fl = np.stack([v[1] for v in per_det.values()])
            allf = np.zeros((size, size), np.uint8)
            for bit in (SAT, REJ, OUTL):
                allf[((dets_fl & bit) != 0).mean(0) >= 0.5] |= bit
            sid = f"all-colour_s{s}"
            (out / "frames" / f"{sid}.f32").write_bytes(allc.tobytes())
            (out / "frames" / f"{sid}.u8").write_bytes(allf.tobytes())
            stacks.append(dict(id=sid, kind="all-colour", season=s, detectors=sorted(per_det),
                               frameIds=[i for v in per_det.values() for i in v[2]],
                               image=f"frames/{sid}.f32", flags=f"frames/{sid}.u8"))

    # Measurements (new, during the event): see measure.py.
    catalog, catwise = [], []
    rad = size * bp.PIX / 3600 * 0.75
    try:
        catalog = catalogs.gaia_dr3(ra, dec, rad, gmax=19.5)
    except Exception as ex:  # noqa: BLE001
        print("gaia skipped", repr(ex)[:100])
    try:
        catwise = catalogs.catwise2020(ra, dec, rad, w2max=17.0)
    except Exception as ex:  # noqa: BLE001
        print("catwise skipped", repr(ex)[:100])
    meas = measure.measure_target(t, frames, arrays, stacks, out, gw, size, catalog, spec)
    (out / "measurements.json").write_text(json.dumps(meas, indent=1))
    write_spectrum(slug, t, spec, catalog, gw)
    write_overlay(slug, t, frames, catalog, catwise, gw, size)

    pipeline_versions = sorted({str(arrays[f["id"]][2]["hdr_pipe"]) for f in frames if arrays[f["id"]][2].get("hdr_pipe")}) or ["7.0.5"]
    manifest = dict(
        format="planetes-pack/1", release="dr1qr3", pipelineVersions=pipeline_versions,
        generator=dict(name="SpaceAppChallenge pipeline/planetes_pack.py (event build, 14 Nov 2026)", commit=git_commit(),
                       createdUtc=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        target=dict(id=slug, name=t["name"], ra=ra, dec=dec, epoch=t.get("epoch", 2026.0),
                    # Detectors where the target itself is seen (others are its neighbours' light).
                    motionDetectors=t.get("motionDets") or [1, 2, 3, 4, 5, 6]),
        grid=dict(size=size, pixelScaleArcsec=bp.PIX, centre=dict(ra=ra, dec=dec), orientation="north-up-east-left"),
        eye=json.loads((HERE / "eye_tests.json").read_text()).get(slug, dict(status="untested", testedUtc=None)),
        frames=frames, stacks=stacks, measurements="measurements.json", layers=[],
    )
    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    print(json.dumps(dict(target=slug, frames=len(frames), stacks=len(stacks), measurements=len(meas),
                          spectrum=len(spec), seasons=seasons)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--conc", type=int, default=20)
    a = ap.parse_args()
    asyncio.run(main_async(a.slug, a.size, a.conc))


if __name__ == "__main__":
    main()
