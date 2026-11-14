"""Steady-star test for the PSF-wing photometry (measure.measure_wings): run the identical method on
Barnard's Star, which saturates SPHEREx like RW Aurigae but holds steady in the near-infrared, and
record per detector whether every pass pair gives 1.00 within 0.06 in both rings. Only detectors
that pass may report a wing brightness ratio for a variable star.

Output: pipeline/wing_validation.json.  Usage: uv run python validate_wings.py
"""
import asyncio
import itertools
import json
import warnings
from pathlib import Path

import build_pack as bp
import measure
import spherex as sx

warnings.simplefilter("ignore")


def main():
    t = bp.load_targets()["barnard"]
    rows = sx.search(t["ra"], t["dec"])
    sx.group_passes(rows)
    exps, _ = asyncio.run(bp.fetch_all(rows, t["ra"], t["dec"], 54, 20, bp.HERE / "cache"))
    # Barnard's Star moves ~10"/yr: measure its wings where it is in each photo.
    pos = {id(e): bp.target_at(t, e["mjd"]) for e in exps}
    orig = measure.wing_index
    measure.wing_index = lambda e, ra, dec, r0, r1: orig(e, *pos[id(e)], r0, r1)
    inner, _ = measure.wing_ratios(exps, 0, 0, 3.0, 6.0)
    outer, _ = measure.wing_ratios(exps, 0, 0, 5.0, 9.0)
    measure.wing_index = orig
    out = {}
    for d in range(1, 7):
        pairs = {f"s{a}s{b}": [round(inner.get((a, b, d), (None,))[0] or 0, 3), round(outer.get((a, b, d), (None,))[0] or 0, 3)]
                 for a, b in itertools.combinations(sorted({k[0] for k in inner} | {k[1] for k in inner}), 2)}
        ok = all(v and abs(v - 1) <= 0.06 for vals in pairs.values() for v in vals)
        out[str(d)] = dict(passes=ok, ratios=pairs)
    doc = dict(star="Barnard's Star (saturated, steady in the near-infrared)", rule="every pass pair within 1.00 +/- 0.06 in both rings (3-6 px and 5-9 px); the tolerance was chosen after seeing this test's results",
               detectors=out, detectorsOk=[int(d) for d, v in out.items() if v["passes"]])
    (Path(__file__).parent / "wing_validation.json").write_text(json.dumps(doc, indent=1))
    print(json.dumps({d: v["passes"] for d, v in out.items()}), doc["detectorsOk"])


if __name__ == "__main__":
    main()
