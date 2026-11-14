"""Queue #7: R Draconis's brightness, checked with comparison stars outside its glare.

measure.measure_wings judges a saturated star's wing-brightness ratios against comparison stars
measured the same way in the same photos. For R Draconis those stars sat inside the +/-54 px box
(<= 5.5') and so inside its own glare: their ratios scattered by 34%, and every detector came out
"not reliable". This script measures comparison stars farther out, in the SAME photos, with the
IDENTICAL method (wing ring 3-6 px, >= 200 usable photos, ratio pairs with >= 10 matched photos),
and re-runs the R Draconis gates with that systematic error. Nothing else changes.

Selection rule, fixed before any of these photos were read (14 Nov 2026, ~20:00 IST):
  - Gaia DR3, G < 14 (as measure.py), 4' to 15' from R Draconis;
  - isolated: no other Gaia star with G < (its G + 1) within 30";
  - the 10 brightest that pass; each read as a +/-20 px box from every photo of R Draconis's pack
    search (sx.search + group_passes, as planetes_pack.py), cached in pipeline/cache.
  - a comparison star counts only if >= 200 photos measure its wings (as measure.py).

Output: pipeline/rdra_far_comparisons.json (the comparison stars, their pass ratios, the new
systematic error, and the R Draconis entries the gates give). The pack is NOT rebuilt here.

Usage: uv run python rdra_far_comparisons.py
"""
import asyncio
import json
import math
import warnings
from pathlib import Path

import numpy as np

import build_pack as bp
import helper_client as hc
import catalogs
import measure
import spherex as sx

warnings.simplefilter("ignore")
HERE = Path(__file__).parent
R_MIN, R_MAX = 4 / 60, 15 / 60  # degrees


def sep_deg(a, b):
    ra1, d1 = a
    ra2, d2 = b
    return math.degrees(math.acos(min(1.0, math.sin(math.radians(d1)) * math.sin(math.radians(d2))
                                      + math.cos(math.radians(d1)) * math.cos(math.radians(d2)) * math.cos(math.radians(ra1 - ra2)))))


def main():
    t = bp.load_targets()["r-dra"]
    here = (t["ra"], t["dec"])
    gaia = catalogs.gaia_dr3(t["ra"], t["dec"], R_MAX + 0.01, gmax=15.0)
    pos = {g["id"]: catalogs.propagate(g, 2026.0) for g in gaia}
    picks = []
    for g in sorted((g for g in gaia if g["mag"] is not None and g["mag"] < 14.0), key=lambda g: g["mag"]):
        if not (R_MIN <= sep_deg(here, pos[g["id"]]) <= R_MAX):
            continue
        crowded = any(o["id"] != g["id"] and o["mag"] is not None and o["mag"] < g["mag"] + 1
                      and sep_deg(pos[g["id"]], pos[o["id"]]) * 3600 < 30 for o in gaia)
        if not crowded:
            picks.append(g)
        if len(picks) == 10:
            break
    print(f"{len(picks)} comparison stars:", [(g["id"], g["mag"], round(sep_deg(here, pos[g['id']]) * 60, 1)) for g in picks])

    rows = sx.search(t["ra"], t["dec"])
    sx.group_passes(rows)
    devs, n_ctrl, stars = [], 0, []
    for g in picks:
        ra, dec = pos[g["id"]]
        # Read next to the bucket through the helper (identical arrays: helper_client.py --check).
        exps, stats = asyncio.run(hc.fetch_all_helper(rows, ra, dec, 20, 32, HERE / "cache"))
        rc, nc = measure.wing_ratios(exps, ra, dec, 3.0, 6.0)
        used = nc >= 200
        if used:
            n_ctrl += 1
            devs += [((v[0] - 1) ** 2, v[1] ** 2) for v in rc.values() if v[2] >= 10]
        stars.append(dict(gaia=g["id"], G=g["mag"], arcmin=round(sep_deg(here, (ra, dec)) * 60, 2), photos=nc, used=used,
                          ratios={f"D{d} s{a}s{b}": [round(m, 3), round(e, 3), n] for (a, b, d), (m, e, n) in sorted(rc.items())}))
        print(f"  {g['id']} G {g['mag']}: {nc} photos, used={used}, fetch {stats}")
    sys_err = math.sqrt(max(0.0, float(np.median([d2 - e2 for d2, e2 in devs])))) if len(devs) >= 6 else None
    print("systematic error from far comparison stars:", sys_err, f"({len(devs)} ratio pairs, {n_ctrl} stars)")

    # R Draconis itself: the pack's own photos (+/-54 px boxes, already cached), identical gates.
    exps, _ = asyncio.run(bp.fetch_all(rows, t["ra"], t["dec"], int(64 * 0.75) + 6, 24, HERE / "cache"))
    note = "4-15' away, outside its glare (rdra_far_comparisons.py)"
    entries = measure.measure_wings(t, exps, [], ctrl=(n_ctrl, devs, note))
    for e in entries:
        print(e["key"], e["status"], e["value"], (e["basis"] or [""])[0][:110])
    (HERE / "rdra_far_comparisons.json").write_text(json.dumps(dict(
        rule=__doc__.split("Selection rule")[1].split("Output:")[0].strip(),
        comparisonStars=stars, systematicError=sys_err, nStarsUsed=n_ctrl, nRatioPairs=len(devs),
        rdra=entries), indent=1, default=float))


if __name__ == "__main__":
    main()
