"""R-1a cut (ranker plan R-1, Amendment 4): the 0.2 % quantile of pooled out-of-fold (train, 5 folds grouped by patch) and
final-model (choose) C1 scores of above-T6 fakes. Freezes the final C1 model's md5, the cut and the choose numbers at it.
Usage: python r1a_cut.py      (reads runs/r1a/c1_model.joblib; writes runs/r1a/frozen.json)
"""
from __future__ import annotations

import hashlib
import json
import os

import joblib
import numpy as np
from sklearn.base import clone

from r1a_c1 import OUT, collect, log

Q = 0.002


def main() -> None:
    rows, _ = collect()
    tr, ch = rows["train"], rows["choose"]
    X = lambda R: np.array([r["x"] for r in R], float)  # noqa: E731
    model = joblib.load(OUT / "c1_model.joblib")   # our own file, written by r1a_c1.py in this run folder (trusted)
    patches = sorted({r["patch"] for r in tr})
    fold_of = {p: k % 5 for k, p in enumerate(patches)}
    Xtr, ytr = X(tr), np.array([r["y"] for r in tr])
    f = np.array([fold_of[r["patch"]] for r in tr])
    oof = np.full(len(tr), np.nan)
    for k in range(5):
        m = clone(model).fit(Xtr[f != k], ytr[f != k])
        oof[f == k] = m.predict_proba(Xtr[f == k])[:, 1]
    pc = model.predict_proba(X(ch))[:, 1]
    t6_tr = np.array([r["y"] == 1 and r["t6"] for r in tr]); t6_ch = np.array([r["y"] == 1 and r["t6"] for r in ch])
    pool = np.concatenate([oof[t6_tr], pc[t6_ch]])
    cut = float(np.quantile(pool, Q, method="lower"))
    junk = np.array([r["y"] == 0 for r in ch])
    keep = pc >= cut
    from collections import defaultdict
    byv = defaultdict(list)
    for k, r in enumerate(ch):
        if r["y"] == 0:
            byv[(r["patch"], r["step"], r["visit"])].append(k)
    top5 = np.zeros(len(ch), bool)
    for ks in byv.values():
        top5[sorted(ks, key=lambda k: -ch[k]["v4"])[:5]] = True
    far1 = np.array([r["far1"] for r in ch]) & junk
    out = {"model_md5": hashlib.md5((OUT / "c1_model.joblib").read_bytes()).hexdigest(), "cut": cut, "quantile": Q,
           "n_pool_fakes": int(len(pool)), "oof_t6_fake_kept": float((oof[t6_tr] >= cut).mean()), "choose_t6_fake_kept": float(keep[t6_ch].mean()),
           "choose_junk_removed": {"top5": float((~keep[top5]).mean()), "n_top5": int(top5.sum()),
                                   "above_far1": float((~keep[far1]).mean()), "n_far1": int(far1.sum())},
           "folds": fold_of}
    tmp = OUT / "frozen.json.tmp"; tmp.write_text(json.dumps(out, indent=1)); os.replace(tmp, OUT / "frozen.json")
    log(f"cut frozen: {json.dumps({k: v for k, v in out.items() if k != 'folds'})}")


if __name__ == "__main__":
    main()
