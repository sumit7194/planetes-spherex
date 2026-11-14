"""R Draconis's bright-steady-star test (prereg/rdra_steady/PLAN.md, committed before any ratio).

  --select   step 1 (catalogues) and step 2 (flags only): writes prereg/rdra_steady/candidates.json
             and chosen.json. No brightness ratio is computed.
  --test     step 3: the identical wing method on the chosen stars, then R Draconis from the
             trusted detectors. Writes pipeline/rdra_steady.json.

Usage: uv run python rdra_steady.py --select ; (commit chosen.json) ; uv run python rdra_steady.py --test
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import math
import re
import struct
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import label

import build_pack as bp
import helper_client as hc
import measure
import spherex as sx

warnings.simplefilter("ignore")
HERE = Path(__file__).parent
ROOT = HERE.parent
REG = ROOT / "prereg" / "rdra_steady"
VIZIER = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?"
DETS = (1, 5, 6)
FIVE = [(269.446, 4.768), (133.760, -7.243), (331.097, -56.801), (76.956, 30.401), (248.167, 66.755)]
GIANT = re.compile(r"^K[0-5](\.\d+)?\s*III(?!-?IV)(?!a|b)")
UA = {"User-Agent": "planetes-research/1 (Space Apps 2026)"}


def asu(params: dict) -> list[dict]:
    url = VIZIER + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        lines = [ln for ln in r.read().decode().splitlines() if ln and not ln.startswith("#")]
    head = lines[0].split("\t")
    return [dict(zip(head, (c.strip() for c in ln.split("\t")))) for ln in lines[3:]]


def sep(a, b):
    r = math.radians
    return math.degrees(math.acos(min(1, math.sin(r(a[1])) * math.sin(r(b[1])) + math.cos(r(a[1])) * math.cos(r(b[1])) * math.cos(r(a[0] - b[0])))))


def passes_map():
    b = (ROOT / "public/data/coverage/dr1qr3/weekly.bin").read_bytes()
    nside, W, npix = struct.unpack("<III", b[4:16])
    cov = np.frombuffer(b, "<u2", W * npix, 16).reshape(W, npix) > 0
    out = np.zeros(npix, int)
    for p in range(npix):
        n, last = 0, -99
        for k in np.nonzero(cov[:, p])[0]:
            if k - last > 6:
                n += 1
            last = k
        out[p] = n
    return nside, out


def at_2026(c: dict) -> tuple[float, float]:
    dt = 2026.0 - 1991.25
    dec = c["dec"] + c["pmde"] * dt / 3.6e6
    ra = c["ra"] + c["pmra"] * dt / 3.6e6 / math.cos(math.radians(c["dec"]))
    return ra % 360, dec


def step1() -> list[dict]:
    import healpy as hp
    rows = asu({"-source": "I/239/hip_main", "-out": "HIP,Hpmag,Hpscat,HvarType,SpType,RAICRS,DEICRS,pmRA,pmDE",
                "Hpmag": "<6", "SpType": "K*", "-out.max": "unlimited"})
    nside, npass = passes_map()
    cands = []
    for r in rows:
        try:
            hpscat = float(r["Hpscat"])
        except ValueError:
            continue
        if not GIANT.match(r["SpType"]) or hpscat > 0.010 or r["HvarType"] not in ("", "C"):
            continue
        c = dict(hip=int(r["HIP"]), sp=r["SpType"], hp=float(r["Hpmag"]), hpscat=hpscat, ra=float(r["RAICRS"]),
                 dec=float(r["DEICRS"]), pmra=float(r["pmRA"] or 0), pmde=float(r["pmDE"] or 0))
        if abs(SkyCoord(c["ra"] * u.deg, c["dec"] * u.deg).galactic.b.deg) <= 10:
            continue
        if any(sep((c["ra"], c["dec"]), f) <= 5 for f in FIVE):
            continue
        if npass[hp.ang2pix(nside, c["ra"], c["dec"], nest=True, lonlat=True)] < 2:
            continue
        cands.append(c)
    keep = []
    for c in sorted(cands, key=lambda c: (c["hpscat"], c["hp"])):
        tm = asu({"-source": "II/246/out", "-c": f"{c['ra']} {c['dec']:+}", "-c.rs": "5", "-out": "Kmag,_r", "-sort": "_r"})
        k = float(tm[0]["Kmag"]) if tm and tm[0].get("Kmag") else None
        if k is not None and 0 <= k <= 2:
            keep.append(dict(c, K=k))
        if len(keep) == 25:
            break
    return keep


def core_radius(e: dict, ra: float, dec: float) -> float | None:
    w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
    x, y = (float(v) for v in w.world_to_pixel_values(ra, dec))
    x -= e["x0"]
    y -= e["y0"]
    H, W = e["img"].shape
    if not (3 <= x < W - 3 and 3 <= y < H - 3):
        return None
    bad = sx.mask_of(e, measure.WING_BAD)
    lab, _ = label(bad)
    yy, xx = np.mgrid[0:H, 0:W]
    near = np.unique(lab[(np.hypot(xx - x, yy - y) <= 2) & (lab > 0)])
    if not len(near):
        return 0.0
    return float(math.sqrt(np.isin(lab, near).sum() / math.pi))


def radii(exps, ra, dec) -> dict[int, float | None]:
    per = {}
    for e in exps:
        if e["det"] in DETS:
            r = core_radius(e, ra, dec)
            if r is not None:
                per.setdefault(e["det"], []).append(r)
    return {d: (float(np.median(per[d])) if per.get(d) else None) for d in DETS}


def rows_for(ra, dec):
    rows = [r for r in sx.search(ra, dec) if r["det"] in DETS]
    sx.group_passes(rows)
    return rows


def step2(cands):
    t = bp.load_targets()["r-dra"]
    rd_rows = rows_for(t["ra"], t["dec"])
    rd_exps, _ = asyncio.run(bp.fetch_all(rd_rows, t["ra"], t["dec"], int(64 * 0.75) + 6, 8, HERE / "cache"))
    rd = radii(rd_exps, t["ra"], t["dec"])
    print("R Draconis flagged-core radius (px):", rd)
    out = []
    for c in cands:
        ra, dec = at_2026(c)
        exps, st = asyncio.run(hc.fetch_all_helper(rows_for(ra, dec), ra, dec, 20, 32, HERE / "cache"))
        rr = radii(exps, ra, dec)
        ok = all(rd[d] and rr[d] is not None and abs(rr[d] / rd[d] - 1) <= 0.30 for d in DETS)
        dist = sum(abs(math.log(rr[d] / rd[d])) for d in DETS) if ok else None
        out.append(dict(c, at2026=[round(ra, 6), round(dec, 6)], radius=rr, match=ok, distance=dist, photos=len(exps)))
        print(f"  HIP {c['hip']} {c['sp']:10s} K {c['K']:.2f} radius {rr}  match={ok}")
    chosen = sorted((o for o in out if o["match"]), key=lambda o: o["distance"])[:5]
    return rd, out, chosen


def step3():
    doc = json.loads((REG / "chosen.json").read_text())
    rings = [(5.0, 9.0), (8.0, 13.0)]
    res, trusted = {}, {d: True for d in DETS}
    for c in doc["chosen"]:
        ra, dec = c["at2026"]
        exps, _ = asyncio.run(hc.fetch_all_helper(rows_for(ra, dec), ra, dec, 20, 32, HERE / "cache"))
        per = {}
        for r0, r1 in rings:
            ratios, _ = measure.wing_ratios(exps, ra, dec, r0, r1)
            for (a, b, d), (m, e, n) in ratios.items():
                if d in DETS and n >= 10:
                    per.setdefault(str(d), {})[f"s{a}s{b} {r0:g}-{r1:g}px"] = [round(m, 3), round(e, 3), n]
        for d in DETS:
            vals = per.get(str(d), {})
            ok = bool(vals) and all(abs(v[0] - 1) <= 0.06 for v in vals.values())
            trusted[d] = trusted[d] and ok
        res[str(c["hip"])] = per
        print(f"HIP {c['hip']}:", {d: per.get(str(d)) for d in DETS})
    print("trusted detectors for R Draconis:", [d for d in DETS if trusted[d]])
    (HERE / "rdra_steady.json").write_text(json.dumps(dict(stars=res, trusted=[d for d in DETS if trusted[d]]), indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--select", action="store_true")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    if a.select:
        cands = step1()
        (REG / "candidates.json").write_text(json.dumps(cands, indent=1))
        print(len(cands), "candidates")
        rd, out, chosen = step2(cands)
        (REG / "chosen.json").write_text(json.dumps(dict(rdraRadius=rd, candidates=out, chosen=chosen), indent=1))
        print("chosen:", [(c["hip"], c["sp"], c["radius"]) for c in chosen])
    if a.test:
        step3()


if __name__ == "__main__":
    main()
