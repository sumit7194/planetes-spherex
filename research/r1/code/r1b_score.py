"""R-1b (ranker plan R-1 v5 + Amendments 1-7, ~/mac_shared/RANKER_draft.md; PLAN.md §11): the one locked score on T-1..T-3.

Paired at v4's frozen T6 thresholds; the challenger is v4 + the frozen C1 cut (runs/r1a/frozen.json; model md5 checked).
Claim A (fake loss): of pass0 + pass1 fakes (Amendment 6) v4 finds above T6 (yardstick.recovered's rule), the share with C1 score < cut;
  one-sided 95 % Clopper-Pearson upper bound <= 2 %. Visit-cluster bootstrap reported beside it.
Claim B (junk reduction): top-5 per visit per guard (guard0, scramble_guard0) by v4 score among passing candidates with no
  fake or known match; share removed by the cut; visit-cluster bootstrap (10,000, rng 0) 95 % lower bound >= 20 %.
Readings: HELPS if A and B hold; DOESN'T HELP if the two-sided 95 % CP lower bound of the loss > 2 % or B's upper bound
< 20 %; INCONCLUSIVE otherwise. Descriptive: retention by rate bin, completeness by magnitude and m50 at T6 (C0 vs
challenger), FA above T6 per guard before/after the cut, knowns above T6 kept, top-5 by guard.
The visit list frozen at Physics' frame fetch is checked (--visits FILE --visits-sha256 HEX): every record's visit must be in it.
Usage: python r1b_score.py --root DIR --patches T-1 T-2 T-3 --visits FILE --visits-sha256 HEX
       python r1b_score.py --root DIR --patches D-1drB --dry      (code test on development records; no claim)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path

import joblib
import numpy as np
from scipy.stats import beta

from r0_inventory import THR_T6, above, known_at, load_record, log, match
from r1a_c1 import OUT as R1A, feats
from smo.score.yardstick import m50_m90
from sxa.paths import ROOT

OUT = ROOT / "runs" / "r1b"
MODEL_MD5 = "2dfcb62229b733b534681bd282fb5371"
STEPS = ("real", "pass0", "pass1", "guard0", "scramble_guard0")   # Amendment 6: two injection passes on T
INJ = ("pass0", "pass1")       # claim A pools both passes; clusters stay (patch, visit)
BINS = [(0.0, 0.25), (0.25, 1.0), (1.0, 2.0), (2.0, 99.0)]


def recs(root: Path, patch: str, step: str):
    d = root / patch / "v4" / step
    if not d.exists():
        return
    for p in sorted(x for x in d.iterdir() if x.name.endswith((".json", ".json.gz")) and "_set" not in x.name):
        yield load_record(p)


def cp_upper1(k, n):          # one-sided 95 % Clopper-Pearson upper bound
    return 1.0 if k >= n else float(beta.ppf(0.95, k + 1, n - k))


def cp_lower2(k, n):          # two-sided 95 % Clopper-Pearson lower bound
    return 0.0 if k == 0 else float(beta.ppf(0.025, k, n - k + 1))


def cluster_boot(vals_by_cluster, stat):
    keys = list(vals_by_cluster)
    if not keys:
        return [float('nan'), float('nan')]
    B = np.random.default_rng(0).integers(0, len(keys), (10000, len(keys)))
    out = []
    for b in B:
        num = sum(vals_by_cluster[keys[i]][0] for i in b); den = sum(vals_by_cluster[keys[i]][1] for i in b)
        out.append(num / den if den else np.nan)
    return [float(x) for x in np.nanpercentile(out, [2.5, 97.5])]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--patches", nargs="+", required=True)
    ap.add_argument("--visits"); ap.add_argument("--visits-sha256")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    root = Path(a.root)
    mp = R1A / "c1_model.joblib"
    if hashlib.md5(mp.read_bytes()).hexdigest() != MODEL_MD5:
        raise SystemExit("frozen C1 model md5 mismatch")
    model = joblib.load(mp)                  # our own frozen file, md5-checked above (trusted)
    cut = json.loads((R1A / "frozen.json").read_text())["cut"]
    allowed = None
    if not a.dry:
        vb = Path(a.visits).read_bytes()
        if hashlib.sha256(vb).hexdigest() != a.visits_sha256:
            raise SystemExit("visit list sha256 mismatch")
        vl = json.loads(vb)                  # Amendment 7: Physics' format {"patches": {P: {"visits": {visit: [frames]}}}}
        allowed = {(P, v) for P, d in vl["patches"].items() for v in d["visits"]}
        missing = set(a.patches) - set(vl["patches"])
        if missing:
            raise SystemExit(f"patches not in the frozen visit list: {sorted(missing)}")
    score = lambda cs: model.predict_proba(np.array([feats(c) for c in cs], float))[:, 1] if cs else np.zeros(0)  # noqa: E731
    A = defaultdict(lambda: [0, 0])          # visit -> [lost, found]
    rate_found, rate_kept, m_all, rec_c0, rec_ch = [], [], [], [], []
    B = defaultdict(lambda: [0, 0])          # (guard, visit) -> [removed, n]
    fa = defaultdict(lambda: [0, 0])         # guard -> [above T6 before, after]
    kn_kept = [0, 0]
    seen = set()
    for patch in a.patches:
        kj = root / patch / "known.json"
        kn = json.loads(kj.read_text())["visits"] if kj.exists() else None
        for step in STEPS:
            for rec, truth in recs(root, patch, step):
                v = rec["visit"]
                if allowed is not None and (patch, v) not in allowed:
                    raise SystemExit(f"{patch} {step}: visit {v} not in the frozen visit list")
                seen.add((patch, v))
                ok = [c for c in rec["candidates"] if c["passes"]]
                pairs, used = match([c for c in ok if above(c, THR_T6)], truth) if (truth and step in INJ) else ({}, set())
                kused = set()
                if kn is not None and step != "scramble_guard0" and v in kn and ok:
                    kv = kn[v]
                    kp, kused_ = match(ok, known_at(kv["objects"], ok[0]["t0"] - kv["t0"]))
                    kused = kused_
                    if step == "real":
                        t6k = [ok[i] for i in kused if above(ok[i], THR_T6)]
                        s = score(t6k); kn_kept[0] += int((s >= cut).sum()); kn_kept[1] += len(t6k)
                if step in INJ and truth:
                    t6 = [c for c in ok if above(c, THR_T6)]
                    s = score(t6)
                    for j, t in enumerate(truth):
                        found = j in pairs
                        kept = found and s[pairs[j]] >= cut
                        m_all.append(t.get("m_ref", np.nan)); rec_c0.append(found); rec_ch.append(kept)
                        if found:
                            A[(patch, v)][1] += 1; A[(patch, v)][0] += int(not kept)
                            rate_found.append(feats(t6[pairs[j]])[0]); rate_kept.append(kept)
                if step in ("guard0", "scramble_guard0"):
                    gpairs, gused = match(ok, truth) if truth else ({}, set())
                    junk = [c for i, c in enumerate(ok) if i not in gused and i not in kused]
                    top = sorted(junk, key=lambda c: -c["score"])[:5]
                    s = score(top)
                    B[(step, patch, v)][0] += int((s < cut).sum()); B[(step, patch, v)][1] += len(top)
                    t6j = [c for c in junk if above(c, THR_T6)]
                    st = score(t6j)
                    fa[step][0] += len(t6j); fa[step][1] += int((st >= cut).sum())
            log(f"{patch} {step} done")
    if allowed is not None and seen != {x for x in allowed if x[0] in a.patches}:
        log(f"note: {len(allowed - seen)} listed visits have no record")
    lost = sum(x[0] for x in A.values()); found = sum(x[1] for x in A.values())
    rem = sum(x[0] for x in B.values()); nb = sum(x[1] for x in B.values())
    a_up, a_lo = cp_upper1(lost, found), cp_lower2(lost, found)
    b_ci = cluster_boot(B, None)
    if a_up <= 0.02 and b_ci[0] >= 0.20:
        verdict = "HELPS"
    elif a_lo > 0.02 or b_ci[1] < 0.20:
        verdict = "DOESN'T HELP"
    else:
        verdict = "INCONCLUSIVE"
    rf, rk = np.array(rate_found), np.array(rate_kept, bool)
    m, r0, r1 = np.array(m_all, float), np.array(rec_c0, bool), np.array(rec_ch, bool)
    fin = np.isfinite(m)
    res = {"dry": a.dry, "patches": a.patches, "cut": cut, "model_md5": MODEL_MD5,
           "claim_A": {"found_t6": found, "lost": lost, "loss": lost / found if found else None, "cp_upper1_95": a_up,
                       "cp_lower2_95": a_lo, "visit_boot_ci95": cluster_boot(A, None) if A else None},
           "claim_B": {"n_top5": nb, "removed": rem / nb if nb else None, "visit_boot_ci95": b_ci,
                       "by_guard": {g: (sum(x[0] for k, x in B.items() if k[0] == g) / max(1, sum(x[1] for k, x in B.items() if k[0] == g))) for g in ("guard0", "scramble_guard0")}},
           "verdict": None if a.dry else verdict,
           "descriptive": {"retention_by_rate": {f"{lo}-{hi}": {"n": int(((rf >= lo) & (rf < hi)).sum()), "kept": float(rk[(rf >= lo) & (rf < hi)].mean()) if ((rf >= lo) & (rf < hi)).any() else None} for lo, hi in BINS},
                           "fa_above_t6": {g: {"before": v[0], "after": v[1]} for g, v in fa.items()},
                           "knowns_t6_real": {"kept": kn_kept[0], "n": kn_kept[1]},
                           "m50_t6": {"C0": m50_m90(m[fin], r0[fin]) if fin.sum() > 20 else None, "challenger": m50_m90(m[fin], r1[fin]) if fin.sum() > 20 else None}}}
    OUT.mkdir(parents=True, exist_ok=True)
    name = "dry_run.json" if a.dry else "result.json"
    tmp = OUT / (name + ".tmp"); tmp.write_text(json.dumps(res, indent=1, default=float)); os.replace(tmp, OUT / name)
    log(f"R-1b{' DRY' if a.dry else ''}: A loss {lost}/{found} (CP1 upper {a_up:.4f}); B removed {rem}/{nb} CI {b_ci}; -> {res['verdict']}")


if __name__ == "__main__":
    main()
