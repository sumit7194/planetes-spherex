"""Why each fake was missed (Physics' review, 17 Nov 2026): analysis only, the registered search and
scoring are unchanged. For every fake-pair row that yardstick_score.score_field makes, the first cause
that applies, in the search's own order:
  found          - scored found (yardstick_score)
  not_in_ref     - no all-season reference source within 1.5 px of the fake's true track
  fit_failed     - fewer than 2 detectors with a fit in both passes (box off the grid, NaNs, fit failure)
  fit_at_bound   - a detector's fitted centre sits at the +-2 px bound in either pass (shift capped)
  inconsistent   - the detectors' shifts disagree (spread >= max(0.5*mag, 0.3) px)
  below_T        - consistent, but shift / steady scatter <= T
  failed_pm      - above T but the size (30%) or direction (30 deg) test fails, or > 1.5 px off track
Also: found fraction by W2 for true shifts 11-15" (Physics: faint-end roll-off inside the window).
Usage: [YARD_EXT=E1] python yardstick_misses.py [--out FILE]
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

import build_pack as bp
import field_stacks as fs
import season_pairs as sp
import yardstick_inject as yi
import yardstick_null as yn
import yardstick_score as ys
from smo.inject.truth import unseal

BOUND = 1.98  # |offset| at or above this is the fit's +-2 px bound


def fit_raw(img, x0, y0, r=3):
    """season_pairs.fit, also returning the box offset so a pinned centre shows."""
    xi, yi_ = int(round(x0)), int(round(y0))
    box = img[yi_ - r: yi_ + r + 1, xi - r: xi + r + 1]
    if box.shape != (2 * r + 1, 2 * r + 1) or np.isnan(box).sum() > 4:
        return None
    yy, xx = np.mgrid[-r: r + 1, -r: r + 1]
    ok = np.isfinite(box)

    def model(p):
        a, dx, dy, sg, b, bx, by = p
        return a * np.exp(-((xx - dx) ** 2 + (yy - dy) ** 2) / (2 * sg * sg)) + b + bx * xx + by * yy

    p0 = [np.nanmax(box) - np.nanmedian(box), 0, 0, 0.9, np.nanmedian(box), 0, 0]
    try:
        res = least_squares(lambda p: (model(p) - box)[ok], p0,
                            bounds=([0, -2, -2, 0.4, -np.inf, -np.inf, -np.inf], [np.inf, 2, 2, 3, np.inf, np.inf, np.inf]))
    except Exception:  # noqa: BLE001
        return None
    if not res.success:
        return None
    return xi + res.x[1], yi_ + res.x[2], max(abs(res.x[1]), abs(res.x[2])) >= BOUND


def classify_field(fdir: Path) -> list[dict]:
    run = json.loads((fdir / "run.json").read_text())
    scored = ys.score_field(fdir)
    out, k = [], 0
    for ps in run["passes"]:
        p = ps["pass_no"]
        truth = unseal(fdir / f"truth_p{p}.json", ps["truth_sha256"])
        res = json.loads((fdir / f"search_p{p}.json").read_text())
        st = yn.load_stacks(fdir / f"stacks_p{p}.npz")
        npz = np.load(fdir / f"stacks_p{p}.npz")
        ref = np.nanmedian(np.stack([v["img"] for v in st.values()]), axis=0)
        srcs = sp.find_sources(ref)
        dets = sorted({d for _, d in st})
        gw = bp.out_grid(*ys._centre(fdir), fs.SIZE)
        for pair in res:
            a, b = pair["seasons"]
            ma, mb = ys.pass_mjd(npz, a), ys.pass_mjd(npz, b)
            if ma is None or mb is None:
                continue
            removed = {str(d): v["px"] for d, v in pair["commonShiftRemoved"].items()}
            sig = pair["steadyScatterPx"]
            for f in truth["fakes"]:
                ra_a, de_a = yi.apparent(f, ma)
                ra_b, de_b = yi.apparent(f, mb)
                pa = np.array(gw.all_world2pix(ra_a, de_a, 0), float)
                pb = np.array(gw.all_world2pix(ra_b, de_b, 0), float)
                if not all(4 <= c <= fs.SIZE - 5 for c in (*pa, *pb)):
                    continue
                row = scored[k]
                k += 1
                assert row["pass_no"] == p and row["pair"] == f"{a}-{b}" and row["w2"] == f["w2"]
                cause = None
                if row["found"]:
                    cause = "found"
                else:
                    near = [(ys.seg_dist(np.array([x, y]), pa, pb), x, y) for x, y, _ in srcs]
                    near = [t for t in near if t[0] <= 1.5]
                    if not near:
                        cause = "not_in_ref"
                    else:
                        _, x, y = min(near)
                        shifts, at_bound = [], False
                        for d in dets:
                            if (a, d) not in st or (b, d) not in st:
                                continue
                            fa, fb = fit_raw(st[(a, d)]["img"], x, y), fit_raw(st[(b, d)]["img"], x, y)
                            if fa and fb:
                                at_bound |= fa[2] or fb[2]
                                c = removed.get(str(d), [0, 0])
                                shifts.append((fb[0] - fa[0] - c[0], fb[1] - fa[1] - c[1]))
                        if len(shifts) < 2:
                            cause = "fit_failed"
                        elif at_bound:
                            cause = "fit_at_bound"
                        else:
                            s = np.array(shifts)
                            v = s.mean(axis=0)
                            mag = float(np.hypot(*v))
                            spread = float(np.max(np.hypot(*(s - v).T)))
                            if not spread < max(0.5 * mag, 0.3):
                                cause = "inconsistent"
                            elif not (sig > 0 and mag / sig > ys.T):
                                cause = "below_T"
                            else:
                                cause = "failed_pm"
                out.append(dict(row, cause=cause))
    assert k == len(scored)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(yi.OUT / "misses.json"))
    a = ap.parse_args()
    rows = []
    for fdir in sorted(p for p in yi.OUT.iterdir() if (p / "run.json").exists()):
        rows += classify_field(fdir)
    edges = [0, 2, 4, 6, 8, 10, 12, 15, 20, 25, 30, 40, 60, 80, 120, 160]
    by_shift = []
    for pl in ("isolated", "anywhere"):
        for lo, hi in zip(edges, edges[1:]):
            sel = [r for r in rows if r["placement"] == pl and lo <= r["true_shift_arcsec"] < hi]
            if sel:
                c = Counter(r["cause"] for r in sel)
                by_shift.append(dict(placement=pl, shift_arcsec=f"{lo}-{hi}", n=len(sel), **dict(sorted(c.items()))))
    by_w2 = []
    for pl in ("isolated", "anywhere"):
        for lo, hi in ys.W2_BINS:
            sel = [r for r in rows if r["placement"] == pl and lo <= r["w2"] < hi and 11 <= r["true_shift_arcsec"] < 15]
            if sel:
                kf = sum(r["found"] for r in sel)
                ci = ys.cp(kf, len(sel))
                c = Counter(r["cause"] for r in sel)
                by_w2.append(dict(placement=pl, w2=f"{lo}-{hi}", n=len(sel), found=kf, ci95=[round(ci[0], 3), round(ci[1], 3)],
                                  causes=dict(sorted(c.items()))))
    out = dict(ext=yi.EXT or "registered", T=ys.T, rows=len(rows), causes=dict(Counter(r["cause"] for r in rows)),
               by_shift=by_shift, by_w2_shift_11_15=by_w2)
    Path(a.out).write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
