"""R-1 Amendment 5 (descriptive, before T): the frozen C1 cut's rate profile.
NEO fakes (D-1dr pass100-108, never trained or chosen on) above T6: retention overall and by rate bin; the 34 above-T6
knowns by rate bin; choose junk removed by rate bin. Read-only on Physics' files.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import joblib
import numpy as np

from r0_inventory import THR_T6, above, load_record, log, match
from r1a_c1 import OUT, collect, feats

NEO = Path("/Users/sumit/Github/SphereXVision/runs/qr3/wt/runs/yardstick/D-1dr/v4")
BINS = [(0.25, 1.0), (1.0, 2.0), (2.0, 3.0001)]


def binned(rate, kept):
    out = {}
    for lo, hi in BINS:
        m = (rate >= lo) & (rate < hi)
        out[f"{lo}-{min(hi, 3.0)}"] = {"n": int(m.sum()), "kept": float(kept[m].mean()) if m.any() else None}
    out["below_0.25"] = {"n": int((rate < 0.25).sum()), "kept": float(kept[rate < 0.25].mean()) if (rate < 0.25).any() else None}
    return out


def main() -> None:
    model = joblib.load(OUT / "c1_model.joblib")       # our own file (trusted)
    cut = json.loads((OUT / "frozen.json").read_text())["cut"]
    X = []
    for k in range(100, 109):
        d = NEO / f"pass{k}"
        for p in sorted(x for x in d.iterdir() if x.name.endswith((".json", ".json.gz")) and "_set" not in x.name):
            rec, truth = load_record(p)
            sel = [c for c in rec["candidates"] if c["passes"] and above(c, THR_T6)]
            _, used = match(sel, truth)
            X += [feats(sel[i]) for i in used]
    X = np.array(X, float)
    s = model.predict_proba(X)[:, 1]
    neo = {"n": len(X), "kept": float((s >= cut).mean()), "by_rate": binned(X[:, 0], s >= cut)}
    rows, knowns = collect()
    kv = list(knowns.values())
    kx = np.array([k["x"] for k in kv], float)
    ks = model.predict_proba(kx)[:, 1]
    ch = rows["choose"]
    jx = np.array([r["x"] for r in ch if r["y"] == 0], float)
    js = model.predict_proba(jx)[:, 1]
    res = {"cut": cut, "neo_t6": neo, "flag_neo_below_95": neo["kept"] < 0.95,
           "knowns_t6": {"n": len(kv), "kept": float((ks >= cut).mean()), "by_rate": binned(kx[:, 0], ks >= cut)},
           "choose_junk_removed_by_rate": {k: {"n": v["n"], "removed": (1 - v["kept"]) if v["kept"] is not None else None}
                                           for k, v in binned(jx[:, 0], js >= cut).items()},
           "note": "2-3 px/step NEO bin is nearly empty (Physics: ~2 fakes); retention there can't be judged"}
    tmp = OUT / "neo_profile.json.tmp"; tmp.write_text(json.dumps(res, indent=1)); os.replace(tmp, OUT / "neo_profile.json")
    log(json.dumps(res))


if __name__ == "__main__":
    main()
