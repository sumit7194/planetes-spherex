"""R-1a, C1 (ranker plan R-1, Amendment 3; ~/mac_shared/RANKER_draft.md, PLAN.md §11): the no-stamp tree baseline.

Operating set: passing v4 candidates with score > 5.0. Positives: fake / guard-fake matches (smo.score.yardstick.match).
Negatives: guard0 / scramble_guard0 candidates with no fake or known match. Unmatched real-step and pass-step candidates
are unlabelled and unused. Train: D-1, D-1dr, D-5, N-1..N-8 minus D-1/D-1dr candidates inside D-1drB's core; choose:
D-1drB core + N-9..N-11 (core by Physics' smo.sky.tiles.Tiling.owner, qr3-adapter worktree, tile (1, 0) of
Tiling(28.6722, 10.8662, 0.5)). C1: HistGradientBoostingClassifier, fixed settings. Cut on choose keeps >= 99 % of the fakes
v4 finds above T6 there. Pass/fail tells check on the above-T6 known asteroids. Read-only on Physics' files.
Usage: python r1a_c1.py      (writes $SXA_ROOT/runs/r1a/c1_result.json and c1_model.joblib)
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from collections import defaultdict

import joblib
import numpy as np
from sklearn import __version__ as SKV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from r0_inventory import THR_FAR1, THR_T6, T6, above, known_at, load_record, log, manifest, match
from sxa.paths import ROOT

OUT = ROOT / "runs" / "r1a"
FLOOR = 5.0
TRAIN = {"D-1", "D-1dr", "D-5"} | {f"N-{k}" for k in range(1, 9)}
CHOOSE = {"D-1drB", "N-9", "N-10", "N-11"}
_spec = importlib.util.spec_from_file_location("sxv_tiles", "/Users/sumit/Github/SphereXVision/runs/qr3/wt/src/smo/sky/tiles.py")
_tiles = importlib.util.module_from_spec(_spec); sys.modules["sxv_tiles"] = _tiles; _spec.loader.exec_module(_tiles)  # dataclasses need the module registered
# Tiling(28.6722, 10.8662, 0.5) with its defaults (cutout_half 128, margin 16), built without __post_init__: that only
# validates margin >= margin_min_px(), which imports Physics' whole pipeline (pyvo, Gaia). owner() is Physics' code, unchanged.
TILING = object.__new__(_tiles.Tiling)
for _k, _v in {"ra0": 28.6722, "dec0": 10.8662, "half_width_deg": 0.5, "cutout_half": _tiles.DEFAULT_CUTOUT_HALF, "margin": _tiles.DEFAULT_MARGIN}.items():
    object.__setattr__(TILING, _k, _v)
FEATS = ["rate_px", "fast", "n_frames", "n_times_z2", "nu_grid", "cheap_score", "score", "static_median",
         "z_max", "z_mean", "z_min", "z_std", "z_n"]


def in_b_core(cands) -> np.ndarray:
    if not cands:
        return np.zeros(0, bool)
    i, j = TILING.owner(np.array([c["ra"] for c in cands]), np.array([c["dec"] for c in cands]))
    return (np.asarray(i) == 1) & (np.asarray(j) == 0)


def feats(c: dict) -> list[float]:
    z = c["z_frames"]
    z = np.array(json.loads(z) if isinstance(z, str) else z, float)
    z = z[np.isfinite(z)]
    rate = float(np.hypot(c["v_xi"], c["v_eta"]) * T6.STEP_S / T6.PX_ARCSEC)
    fin = lambda v: float(v) if np.isfinite(v) else -99.0  # noqa: E731
    return [rate, float(T6.band_of(c) == "fast"), c["n_frames"], c["n_times_z2"], fin(c["nu_grid"]), fin(c["cheap_score"]),
            fin(c["score"]), fin(c["static_median"]),
            *( [z.max(), z.mean(), z.min(), z.std(), len(z)] if len(z) else [-99.0, -99.0, -99.0, -99.0, 0])]


def collect():
    rows = {"train": [], "choose": []}
    knowns = {}
    for r in manifest():
        split = "train" if r["patch"] in TRAIN else "choose" if r["patch"] in CHOOSE else None
        if split is None:
            continue
        kn = json.loads(r["known"].read_text())["visits"] if r["known"] else None
        for p in sorted(x for x in r["folder"].iterdir() if x.name.endswith((".json", ".json.gz")) and "_set" not in x.name):
            rec, truth = load_record(p)
            sel = [x for x in rec["candidates"] if x["passes"] and x["score"] > FLOOR]
            if r["patch"] in ("D-1", "D-1dr", "D-1drB"):
                core = in_b_core(sel)
                sel = [x for x, k in zip(sel, core) if (k if r["patch"] == "D-1drB" else not k)]
            pairs, used = match(sel, truth) if truth else ({}, set())
            fake_of = {i: truth[j] for j, i in pairs.items()}
            kused = set()
            if kn is not None and r["step"] != "scramble_guard0" and rec["visit"] in kn and sel:
                kv = kn[rec["visit"]]
                ko = known_at(kv["objects"], sel[0]["t0"] - kv["t0"])
                rest = [i for i in range(len(sel)) if i not in used]
                kp, ku = match([sel[i] for i in rest], ko)
                kused = {rest[i] for i in ku}
                for j, i in kp.items():
                    c = sel[rest[i]]
                    key = (r["patch"], rec["visit"], ko[j]["desig"])
                    if above(c, THR_T6) and key not in knowns:
                        knowns[key] = {"x": feats(c), "v_mag": ko[j]["v_mag"], "fast": T6.band_of(c) == "fast", "split": split}
            guard = r["step"] in ("guard0", "scramble_guard0")
            for i, c in enumerate(sel):
                if i in used:
                    lab, src = 1, ("guard_fake" if r["step"] == "guard0" else "fake")
                elif guard and i not in kused:
                    lab, src = 0, r["step"]
                else:
                    continue
                rows[split].append({"x": feats(c), "y": lab, "src": src, "patch": r["patch"], "step": r["step"], "visit": rec["visit"],
                                    "v4": float(c["score"]), "t6": above(c, THR_T6), "far1": above(c, THR_FAR1),
                                    "m_ref": float(fake_of[i].get("m_ref", np.nan)) if i in fake_of else np.nan,
                                    "fast": T6.band_of(c) == "fast"})
        log(f"{r['patch']} {r['step']}: train {len(rows['train'])}, choose {len(rows['choose'])}, knowns {len(knowns)}")
    return rows, knowns


def main() -> None:
    t0 = time.time()
    rows, knowns = collect()
    X = lambda R: np.array([r["x"] for r in R], float)  # noqa: E731
    tr, ch = rows["train"], rows["choose"]
    ytr = np.array([r["y"] for r in tr])
    model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, l2_regularization=1.0,
                                           class_weight="balanced", early_stopping=False, random_state=0)
    model.fit(X(tr), ytr)
    pc = model.predict_proba(X(ch))[:, 1]
    ych = np.array([r["y"] for r in ch])
    fake_t6 = np.array([r["y"] == 1 and r["t6"] for r in ch])
    cut = float(np.quantile(pc[fake_t6], 0.01, method="lower"))          # keeps >= 99 % of v4's found fakes on choose
    keep = pc >= cut
    junk = ych == 0
    # top-5 junk per visit per guard (by v4 score), and junk above FAR 1.0
    top5 = np.zeros(len(ch), bool)
    byv = defaultdict(list)
    for k, r in enumerate(ch):
        if r["y"] == 0:
            byv[(r["patch"], r["step"], r["visit"])].append(k)
    for ks in byv.values():
        for k in sorted(ks, key=lambda k: -ch[k]["v4"])[:5]:
            top5[k] = True
    far1 = np.array([r["far1"] for r in ch]) & junk
    red = lambda m: {"n": int(m.sum()), "removed": float((~keep[m]).mean()) if m.any() else None}  # noqa: E731
    src = np.array([r["src"] for r in ch])
    res = {"auc_choose": {"C1": float(roc_auc_score(ych, pc)), "C0_v4_score": float(roc_auc_score(ych, [r["v4"] for r in ch]))},
           "cut": cut, "fake_t6_kept": float(keep[fake_t6].mean()), "n_fake_t6_choose": int(fake_t6.sum()),
           "junk_reduction": {"top5_per_visit_guard": red(top5), "above_far1": red(far1),
                              "top5_guard0": red(top5 & (src == "guard0")), "top5_scramble": red(top5 & (src == "scramble_guard0"))},
           "counts": {"train": {"pos": int(ytr.sum()), "neg": int((ytr == 0).sum())}, "choose": {"pos": int(ych.sum()), "neg": int(junk.sum())}}}
    # pass/fail tells check: knowns' ranker-score percentile among choose fakes of the same band within +-0.5 mag
    fk = [(ch[k]["m_ref"], ch[k]["fast"], pc[k]) for k in range(len(ch)) if ch[k]["y"] == 1 and np.isfinite(ch[k]["m_ref"])]
    kv = list(knowns.values())
    pk = model.predict_proba(np.array([k["x"] for k in kv], float))[:, 1] if kv else np.zeros(0)
    pct = []
    for k, s in zip(kv, pk):
        ref = np.array([p for m, f, p in fk if f == k["fast"] and abs(m - k["v_mag"]) <= 0.5])
        if len(ref) >= 5:
            pct.append(100.0 * (ref < s).mean() + 50.0 * (ref == s).mean())
    pct = np.array(pct)
    if len(pct):
        b = np.random.default_rng(0).choice(pct, (10000, len(pct)))
        lo, hi = (float(x) for x in np.percentile(np.median(b, 1) - 50.0, [2.5, 97.5]))
    else:
        lo = hi = float("nan")
    res["tells_check"] = {"n_knowns_t6": len(kv), "n_with_ref": int(len(pct)), "median_pct": float(np.median(pct)) if len(pct) else None,
                          "ci95_median_minus_50": [lo, hi], "pass": bool(len(pct) >= 20 and hi >= 0)}
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT / "c1_model.joblib")
    res.update({"sklearn": SKV, "floor": FLOOR, "features": FEATS, "seconds": time.time() - t0})
    tmp = OUT / "c1_result.json.tmp"; tmp.write_text(json.dumps(res, indent=1)); os.replace(tmp, OUT / "c1_result.json")
    log(f"C1 done: {json.dumps({k: res[k] for k in ('auc_choose', 'fake_t6_kept', 'junk_reduction', 'tells_check')})}")


if __name__ == "__main__":
    main()
