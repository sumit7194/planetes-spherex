"""RW Aurigae against Barnard's Star (Physics, 14 Nov): RW Aur's MEASURED brightness rests on the
wing method's steady-star test on Barnard's Star, which holds only if Barnard is at least as
saturated in the detectors used. Median flagged-core radius per detector, from the packs' own
cached boxes (flags only), the same measure as the R Draconis test."""
import asyncio
import json
from pathlib import Path

import numpy as np

import build_pack as bp
import helper_client as hc
import rdra_steady as rs
import spherex as sx

HERE = Path(__file__).parent


def radii_moving(exps, t):
    per = {}
    for e in exps:
        ra, dec = bp.target_at(t, e["mjd"])
        r = rs.core_radius(e, ra, dec)
        if r is not None:
            per.setdefault(e["det"], []).append(r)
    return {d: round(float(np.median(v)), 2) for d, v in sorted(per.items())}


def main():
    out = {}
    for slug in ("barnard", "rw-aur"):
        t = bp.load_targets()[slug]
        rows = None
        for attempt in range(4):
            try:
                rows = sx.search(t["ra"], t["dec"])
                break
            except Exception:  # noqa: BLE001  (IRSA's search drops connections now and then)
                import time
                time.sleep(10 * (attempt + 1))
        sx.group_passes(rows)
        # The packs' own boxes, from the cache; any missing one read next to the bucket.
        exps, _ = asyncio.run(hc.fetch_all_helper(rows, t["ra"], t["dec"], int(64 * 0.75) + 6, 32, HERE / "cache"))
        out[slug] = radii_moving(exps, t)
        print(slug, out[slug])
    larger = [d for d in out["rw-aur"] if d in out["barnard"] and out["rw-aur"][d] > out["barnard"][d]]
    out["rwAurLargerIn"] = larger
    print("RW Aur's core larger than Barnard's in detectors:", larger)
    (HERE / "core_compare.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
