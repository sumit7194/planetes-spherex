"""Score the fake-mover run (prereg/slowmover/PLAN.md §5), at the frozen threshold T = 11.19.

A fake is FOUND in a pair of passes (a, b) when a candidate there has significance > T, lies within
1.5 px of the fake's true track between the two passes' stack dates, and its shift agrees with the
true one: direction within 30°, size within 30%. Truth is unsealed by its recorded sha256
(run.json), so a changed truth file stops the scoring.

Reports: completeness per W2 bin (12-13 … 17-18) × PM bin (0.3-1, 1-3, 3-10″/yr), for 6-month and
12-month pairs and for isolated and anywhere placements, with Clopper-Pearson 95% intervals; the
detector-count split of the found ones (2 vs ≥ 3); the headline W2 at 50% completeness for PM 1-3″/yr
on 12-month pairs (isolated) from a logistic in W2, with a 2,000-draw bootstrap over fields; and the
rate bias (median measured/true PM) of the found ones.

Usage: python yardstick_score.py [--out yardstick_inject/score.json]
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.stats import beta

import build_pack as bp
import field_stacks as fs
import yardstick_inject as yi

from smo.inject.truth import unseal  # noqa: E402

T = yi.T_FROZEN
W2_BINS = [(12 + i, 13 + i) for i in range(6)]
PM_BINS = [(0.3, 1.0), (1.0, 3.0), (3.0, 10.0)]


def cp(k: int, n: int) -> tuple[float, float]:
    """Clopper-Pearson 95%."""
    lo = 0.0 if k == 0 else float(beta.ppf(0.025, k, n - k + 1))
    hi = 1.0 if k == n else float(beta.ppf(0.975, k + 1, n - k))
    return lo, hi


def seg_dist(p, a, b) -> float:
    ab = b - a
    t = 0.0 if not ab.any() else float(np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1))
    return float(np.linalg.norm(p - (a + t * ab)))


def pass_mjd(stacks: np.lib.npyio.NpzFile, g: str) -> float | None:
    v = [float(stacks[k][0]) for k in stacks.files if k.startswith(f"{g}_D") and k.endswith("_mjd")]
    return float(np.mean(v)) if v else None


def score_field(fdir: Path) -> list[dict]:
    run = json.loads((fdir / "run.json").read_text())
    rows = []
    for ps in run["passes"]:
        p = ps["pass_no"]
        truth = unseal(fdir / f"truth_p{p}.json", ps["truth_sha256"])
        res = json.loads((fdir / f"search_p{p}.json").read_text())
        stacks = np.load(fdir / f"stacks_p{p}.npz")
        gw = bp.out_grid(*_centre(fdir), fs.SIZE)
        for pair in res:
            a, b = pair["seasons"]
            ma, mb = pass_mjd(stacks, a), pass_mjd(stacks, b)
            if ma is None or mb is None:
                continue
            kind = "6-month" if abs(pair["years"]) < 0.75 else "12-month"
            for f in truth["fakes"]:
                ra_a, de_a = yi.apparent(f, ma)
                ra_b, de_b = yi.apparent(f, mb)
                pa = np.array(gw.all_world2pix(ra_a, de_a, 0), float)
                pb = np.array(gw.all_world2pix(ra_b, de_b, 0), float)
                if not all(4 <= c <= fs.SIZE - 5 for c in (*pa, *pb)):
                    continue  # off the field in one pass: not injected for this pair
                cosd = math.cos(math.radians(de_a))
                # East is +RA (the search's shiftEastNorth: east = −Δx on the north-up, east-left grid).
                true_e = ((ra_b - ra_a + 540) % 360 - 180) * cosd * 3600
                true_n = (de_b - de_a) * 3600
                true_mag = math.hypot(true_e, true_n)
                found, hit = False, None
                for c in pair["candidates"]:
                    if c["significance"] <= T:
                        continue
                    if seg_dist(np.array([c["x"], c["y"]]), pa, pb) > 1.5:
                        continue
                    me, mn = c["shiftEastNorth"]
                    mag = math.hypot(me, mn)
                    if true_mag == 0 or abs(mag / true_mag - 1) > 0.30:
                        continue
                    dang = abs((math.degrees(math.atan2(me, mn) - math.atan2(true_e, true_n) * 180 / math.pi) + 180) % 360 - 180)
                    if dang > 30:
                        continue
                    found, hit = True, c
                    break
                rows.append(dict(field=run["field"], pass_no=p, pair=f"{a}-{b}", kind=kind, placement=f["placement"],
                                 w2=f["w2"], pm=f["pm_mas"] / 1000, family=f["family"], found=found,
                                 detectors=hit["detectors"] if hit else None,
                                 rate_ratio=(hit["arcsecPerYr"] / (f["pm_mas"] / 1000)) if hit and hit.get("arcsecPerYr") else None,
                                 true_shift_arcsec=true_mag))
    return rows


def _centre(fdir: Path) -> tuple[float, float]:
    name = fdir.name
    f = next(x for x in json.loads(yi.FIELDS.read_text()) if x["field"] == name)
    return f["ra"], f["dec"]


def logistic_w50(w2: np.ndarray, found: np.ndarray) -> float | None:
    if len(w2) < 5 or found.all() or not found.any():
        return None

    def nll(p):
        z = (w2 - p[0]) / max(p[1], 1e-3)
        q = 1 / (1 + np.exp(z))
        q = np.clip(q, 1e-9, 1 - 1e-9)
        return -np.sum(found * np.log(q) + (~found) * np.log(1 - q))

    r = minimize(nll, x0=[15.0, 0.5], method="Nelder-Mead")
    return float(r.x[0]) if r.success else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(yi.OUT / "score.json"))
    a = ap.parse_args()
    rows = []
    for fdir in sorted(p for p in yi.OUT.iterdir() if (p / "run.json").exists()):
        rows += score_field(fdir)
    table = []
    for kind in ("6-month", "12-month"):
        for pl in ("isolated", "anywhere"):
            for lo, hi in W2_BINS:
                for plo, phi in PM_BINS:
                    sel = [r for r in rows if r["kind"] == kind and r["placement"] == pl and lo <= r["w2"] < hi and plo <= r["pm"] < phi]
                    k = sum(r["found"] for r in sel)
                    n = len(sel)
                    ci = cp(k, n) if n else (None, None)
                    table.append(dict(kind=kind, placement=pl, w2=f"{lo}-{hi}", pm=f"{plo}-{phi}", n=n, found=k,
                                      completeness=round(k / n, 3) if n else None,
                                      ci95=[round(ci[0], 3), round(ci[1], 3)] if n else None))
    head = [r for r in rows if r["kind"] == "12-month" and r["placement"] == "isolated" and 1.0 <= r["pm"] < 3.0]
    w50 = logistic_w50(np.array([r["w2"] for r in head]), np.array([r["found"] for r in head]))
    fields = sorted({r["field"] for r in head})
    rng = np.random.default_rng(15)
    boots = []
    for _ in range(2000):
        pick = rng.choice(fields, len(fields))
        sel = [r for f in pick for r in head if r["field"] == f]
        v = logistic_w50(np.array([r["w2"] for r in sel]), np.array([r["found"] for r in sel]))
        if v is not None:
            boots.append(v)
    found = [r for r in rows if r["found"]]
    out = dict(T=T, fakes_pair_rows=len(rows), found=len(found),
               detector_split={"2": sum(1 for r in found if r["detectors"] == 2),
                               ">=3": sum(1 for r in found if (r["detectors"] or 0) >= 3)},
               headline=dict(what="W2 at 50% completeness, PM 1-3″/yr, 12-month pairs, isolated (logistic in W2)",
                             w2_50=round(w50, 2) if w50 is not None else None, n=len(head),
                             ci95=[round(float(np.percentile(boots, 2.5)), 2), round(float(np.percentile(boots, 97.5)), 2)] if boots else None),
               rate_bias=dict(median=round(float(np.median([r["rate_ratio"] for r in found if r["rate_ratio"]])), 3) if found else None),
               table=table)
    Path(a.out).write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "table"}, indent=1))


if __name__ == "__main__":
    main()
