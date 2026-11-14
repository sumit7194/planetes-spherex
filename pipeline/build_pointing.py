"""Where SPHEREx pointed, exposure by exposure, over one day: for the home page's "Riding with
SPHEREx" view. Made during the event from IRSA's ObsCore footprints (the same CSV as build_index.py).

  public/data/pointing/pointing_<label>.json
    label: a target id (the day starting just before its first DR1+QR3 photo) or
           "ordinary-2025-11-15" (2025-11-15 00:00 UTC)
    rows:  [mjd, ra_deg, dec_deg, pa_deg, n_detectors, centre_from]
           centre = mean of the footprint centres of detectors 2 and 5 (the middle of each focal
           plane); pa = angle of detector 2's footprint edge, east of north, modulo 90 degrees
           (a square field looks the same under quarter turns).

Usage: uv run python build_pointing.py --footprints footprints.csv
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import math
from pathlib import Path

import numpy as np

import build_index as bi
import build_pack as bp

OUT = Path(__file__).parent.parent / "public" / "data" / "pointing"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--footprints", required=True)
    a = ap.parse_args()
    targets = bp.load_targets()
    # The day for each target starts just before its first photo (from its pack's manifest).
    windows = {"ordinary-2025-11-15": 60994.0}
    for slug in targets:
        m = Path(__file__).parent.parent / "public" / "data" / "packs" / "dr1qr3" / slug / "manifest.json"
        if m.exists():
            first = min(f["mjd"] for f in json.loads(m.read_text())["frames"])
            windows[slug] = math.floor((first - 0.02) * 100) / 100
    expo = {k: collections.defaultdict(dict) for k in windows}
    with open(a.footprints) as f:
        for row in csv.DictReader(f):
            t = float(row["t_min"])
            det = int(row["energy_bandpassname"][-1])
            if det not in (2, 5):
                continue
            for k, m0 in windows.items():
                if m0 <= t < m0 + 1:
                    ra, dec, pa, _ = bi.footprint(row["s_region"])
                    expo[k][row["obs_id"]][det] = (t, ra, dec, pa)
    OUT.mkdir(parents=True, exist_ok=True)
    for k, m0 in windows.items():
        rows = []
        for obs, dets in sorted(expo[k].items(), key=lambda kv: min(v[0] for v in kv[1].values())):
            t = min(v[0] for v in dets.values())
            vecs = [bi.unit(v[1], v[2]) for v in dets.values()]
            c = sum(vecs) / np.linalg.norm(sum(vecs))
            ra = math.degrees(math.atan2(c[1], c[0])) % 360
            dec = math.degrees(math.asin(c[2]))
            pa = (dets.get(2) or next(iter(dets.values())))[3] % 90
            rows.append([round(t, 6), round(ra, 5), round(dec, 5), round(pa, 2), 6,
                         "detectors 2 and 5" if len(dets) == 2 else f"detector {next(iter(dets))} only"])
        doc = dict(label=k, what="SPHEREx pointing, one row per exposure, over one day (DR1 + QR3 footprints)",
                   window_mjd=[m0, m0 + 1], columns=["mjd", "ra_deg", "dec_deg", "pa_deg", "n_detectors", "centre_from"],
                   rows=rows,
                   caveats=["centre: mean of detectors 2 and 5 footprint centres (IRSA ObsCore s_region)",
                            "pa: footprint edge angle modulo 90 degrees, not the detector's +y axis",
                            "made during the event, 14 Nov 2026"])
        (OUT / f"pointing_{k}.json").write_text(json.dumps(doc, separators=(",", ":")))
        print(k, m0, len(rows), "exposures")


if __name__ == "__main__":
    main()
