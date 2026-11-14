"""R Draconis follow-up (Physics' review of 0bb11c1): (1) how much of the wing ring is usable
(unflagged) per detector, and whether flagged pixels enter the sum (they don't: wing_index drops
WING_BAD pixels and needs >= 60% of the ring usable); (2) the far comparison stars' pass ratios
against their distance from R Draconis (a trend would mean its glare reaches them)."""
import asyncio
import json
import math
import warnings
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.stats import spearmanr

import build_pack as bp
import measure
import spherex as sx

warnings.simplefilter("ignore")
HERE = Path(__file__).parent


def ring_usable(e, ra, dec, r0, r1):
    w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
    x, y = (float(v) for v in w.world_to_pixel_values(ra, dec))
    x -= e["x0"]
    y -= e["y0"]
    H, W = e["img"].shape
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.hypot(xx - x, yy - y)
    ring = (r >= r0) & (r <= r1)
    if ring.sum() == 0 or not (r1 + 7 < x < W - r1 - 7 and r1 + 7 < y < H - r1 - 7):
        return None
    bad = sx.mask_of(e, measure.WING_BAD) | ~np.isfinite(e["img"])
    return float((ring & ~bad).sum() / ring.sum())


def main():
    t = bp.load_targets()["r-dra"]
    rows = sx.search(t["ra"], t["dec"])
    sx.group_passes(rows)
    exps, _ = asyncio.run(bp.fetch_all(rows, t["ra"], t["dec"], int(64 * 0.75) + 6, 8, HERE / "cache"))
    out = {"ring": {}}
    for r0, r1 in ((5.0, 9.0), (8.0, 13.0)):
        per = {}
        for e in exps:
            f = ring_usable(e, t["ra"], t["dec"], r0, r1)
            if f is not None:
                per.setdefault(e["det"], []).append(f)
        out["ring"][f"{r0:g}-{r1:g}px"] = {
            str(d): dict(medianUsable=round(float(np.median(v)), 3), photos=len(v),
                         shareMeasurable=round(float(np.mean(np.array(v) >= 0.6)), 3))
            for d, v in sorted(per.items())}
    far = json.loads((HERE / "rdra_far_comparisons.json").read_text())
    dist, dev = [], []
    for s in far["comparisonStars"]:
        devs = [abs(v[0] - 1) for v in s["ratios"].values() if v[2] >= 10]
        if devs:
            dist.append(s["arcmin"])
            dev.append(float(np.median(devs)))
    rho = spearmanr(dist, dev)
    out["farStars"] = dict(arcmin=dist, medianAbsDeviation=[round(v, 4) for v in dev],
                           spearman=round(float(rho.statistic), 3), p=round(float(rho.pvalue), 3))
    out["note"] = "wing_index uses only ring pixels without WING_BAD flags (saturation incl. NONLINEAR, SUR_ERROR, BLOOM; transient, hot, cold, persistence, crosstalk, streak, missing) and needs >= 60% of the ring usable"
    (HERE / "rdra_ring_check.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
