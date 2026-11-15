"""Export the measured parallax loop for the site (prereg/parallaxloop/PLAN.md; Physics signed 15 Nov).

Writes public/data/loop/<object>.json and one stack thumbnail per visit (<object>-v<k>.f32, 31 x 31,
north up, row 0 = south). Only stacks that COUNT under the registered rules are used: per visit the
one with the highest S/N. The measured place = the predicted place at the stack's mean photo time,
plus the stack's centroid offset. Per-photo dots: a centroid only where a photo's own S/N >= 10
(PLAN §8). Paths: Horizons @399 (Earth's centre) and @10 (the Sun's centre), every 2 days.

Usage: python loop_export.py Makemake
"""
from __future__ import annotations

import asyncio
import json
import math
import sys
from pathlib import Path

import numpy as np
from astropy.time import Time

import parallax_loop as pl
import season_pairs as sp

DEST = pl.HERE.parent / "public" / "data" / "loop"
CROP = 15  # half-size of the thumbnail (31 x 31)
PROXIMA_ARCSEC = 0.7685  # Gaia DR3 parallax of Proxima Centauri, 768.07 mas → shown as 0.77″


def offset_place(ra, dec, east, north):
    return (ra + east / 3600 / math.cos(math.radians(dec))) % 360, dec + north / 3600


def main(name: str) -> None:
    num = pl.OBJECTS[name]
    res = json.loads((pl.OUT / name / "result.json").read_text())
    stacks = np.load(pl.OUT / name / "stacks.npz")
    DEST.mkdir(parents=True, exist_ok=True)
    a399, _ = pl.horizons(num, "@399", "2025-04-01", "2026-11-15")
    a10, _ = pl.horizons(num, "@10", "2025-04-01", "2026-11-15")
    step = 96  # 30 min rows → every 2 days
    path = lambda a: [[round(float(t), 3), round(float(r), 5), round(float(d), 5)] for t, r, d, _ in a[::step]]  # noqa: E731

    daily, _ = pl.horizons(num, "@399", "2025-04-01", "2026-11-15")
    vs = pl.visits(pl.coverage(daily[::48]))
    out_visits = []
    for v, vres in zip(vs, res["visits"]):
        counted = {k: s for k, s in vres["stacks"].items() if s["counts"]}
        if not counted:
            out_visits.append(dict(visit=vres["visit"], first=vres["first"], detected=False))
            continue
        det, s = max(counted.items(), key=lambda kv: kv[1]["sn"])
        arc = [p for p in vres["arc"] if f"D{p['det']}" == det]
        t_mean = float(np.mean([p["t"] for p in arc]))
        start = Time(v[0]["t"] - 1, format="mjd").strftime("%Y-%m-%d")
        stop = Time(v[-1]["t"] + 2, format="mjd").strftime("%Y-%m-%d")
        tr = pl.Track(pl.horizons(num, "@399", start, stop)[0])
        tr10 = pl.Track(pl.horizons(num, "@10", start, stop)[0])
        pra, pdec = tr.at(t_mean)
        e, n = s["centroid_offset_arcsec"]
        mra, mdec = offset_place(pra, pdec, e, n)
        # The thumbnail: the counted stack, centre crop.
        st = stacks[f"v{vres['visit']}_{det}"]
        c = int(pl.C)
        thumb = st[c - CROP:c + CROP + 1, c - CROP:c + CROP + 1].astype("<f4")
        fname = f"{name.lower()}-v{vres['visit']}.f32"
        (DEST / fname).write_bytes(thumb.tobytes())
        # Per-photo dots (all detectors): a photo's own centroid where its S/N >= 10.
        strong = [p for p in vres["arc"] if p["sn"] is not None and p["sn"] >= 10]
        dots = []
        if strong:
            rows = {r["obs_id"]: r for r in v}
            jobs = []
            for p in strong:
                r = next((r for r in v if r["det"] == p["det"] and abs(r["t"] - p["t"]) < 0.01), None)
                if r is not None:
                    jobs.append((r, *tr.at(r["t"])))
            boxes = asyncio.run(pl.read_boxes(jobs))
            for (r, _, _), b in zip(jobs, boxes):
                if b is None:
                    continue
                t = pl.mjd_avg(b)
                ra, dec = tr.at(t, pl.sc_km(b))
                g, _ = pl.grid_of(b, ra, dec)
                if g is None:
                    continue
                f = sp.fit(g, pl.C, pl.C)
                if f is None:
                    continue
                de, dn = -(f[0] - pl.C) * pl.PIX, (f[1] - pl.C) * pl.PIX
                dra, ddec = offset_place(ra, dec, de, dn)
                dots.append(dict(t=round(t, 4), det=r["det"], ra=round(dra, 6), dec=round(ddec, 6),
                                 offsetArcsec=[round(de, 2), round(dn, 2)]))
            del rows
        hra, hdec = tr10.at(t_mean)
        out_visits.append(dict(
            visit=vres["visit"], first=vres["first"], detected=True, detector=int(det[1:]), photos=s["n"],
            sn=s["sn"], meanMjd=round(t_mean, 4),
            predicted=[round(pra, 6), round(pdec, 6)], measured=[round(mra, 6), round(mdec, 6)],
            offsetArcsec=[e, n], offsetErrArcsec=s.get("centroid_err_arcsec"),
            fromSun=[round(hra, 6), round(hdec, 6)], parallaxArcsec=vres["parallax_arcsec"],
            thumb=dict(file=fname, size=2 * CROP + 1),
            countedStacks=sorted(counted), photoDots=dots))
        print(name, "visit", vres["visit"], det, "S/N", s["sn"], "dots", len(dots), flush=True)
    par = [v["parallaxArcsec"] for v in out_visits if v.get("detected")]
    doc = dict(
        object=name, number=num,
        source="SPHEREx DR1/QR3 photos via our sky index; JPL Horizons (astrometric, light-time corrected)",
        registered="prereg/parallaxloop/PLAN.md", passes=res["passes"], visitsDetected=res["visits_detected"],
        pathEarth=path(a399), pathSun=path(a10), visits=out_visits,
        parallaxArcsec=round(float(np.mean(par)), 0) if par else None,
        proximaArcsec=PROXIMA_ARCSEC,
        ratioToProxima=round(float(np.mean(par)) / PROXIMA_ARCSEC, -2) if par else None,
        built=Time.now().iso[:16])
    (DEST / f"{name.lower()}.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(json.dumps({k: v for k, v in doc.items() if k not in ("pathEarth", "pathSun", "visits")}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
