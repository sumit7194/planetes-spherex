"""R-1a label prep (ranker plan R-1, PLAN.md §11): label floors and their chance-match rates. Descriptive, read-only.

For every PRESENT manifest record with truth (injection passes, guard0 companion fakes) and every record with known
asteroids: matches among passing candidates above the FAR-1.0 and T6 floors, with the true positions and with the truth
shifted by +-60 arcsec in dec (the chance rate). Also masked-frame fractions of above-T6 knowns vs above-T6 fakes in the
knowns' magnitude range. Same loaders and thresholds as r0_inventory.py.
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict

import numpy as np

from r0_inventory import OUT, THR_FAR1, THR_T6, above, known_at, load_record, log, manifest, match

SHIFT = 60.0 / 3600.0


def shifted(truth, s):
    return [{**t, "dec_t0": t["dec_t0"] + s} for t in truth]


def main() -> None:
    c = defaultdict(int)
    mk, mf = [], []          # masked fractions: knowns above T6; fakes above T6 with their m_ref
    t0 = time.time()
    for r in manifest():
        kn = json.loads(r["known"].read_text())["visits"] if r["known"] else None
        for p in sorted(x for x in r["folder"].iterdir() if x.name.endswith((".json", ".json.gz")) and "_set" not in x.name):
            rec, truth = load_record(p)
            ok = [x for x in rec["candidates"] if x["passes"]]
            for floor, thr in (("far1", THR_FAR1), ("t6", THR_T6)):
                sel = [x for x in ok if above(x, thr)]
                if truth:
                    k = "guard" if r["step"] == "guard0" else "fake"
                    c[f"{k}_{floor}_true"] += len(match(sel, truth)[1])
                    c[f"{k}_{floor}_shift"] += sum(len(match(sel, shifted(truth, s))[1]) for s in (SHIFT, -SHIFT)) / 2
                    c[f"{k}_truth"] += len(truth) if floor == "t6" else 0
                    if floor == "t6":
                        pairs, _ = match(sel, truth)
                        for j, i in pairs.items():
                            m = sel[i]["masked"]
                            mf.append((truth[j].get("m_ref", np.nan), sum(m) / len(m) if m else 0.0))
                if kn is not None and r["step"] != "scramble_guard0" and rec["visit"] in kn and r["step"] in ("real", "guard0"):
                    kv = kn[rec["visit"]]
                    dt = (sel[0]["t0"] - kv["t0"]) if sel else 0.0
                    ko = known_at(kv["objects"], dt)
                    pairs, used = match(sel, ko)
                    c[f"known_{floor}_true"] += len(used)
                    c[f"known_{floor}_shift"] += sum(len(match(sel, shifted(ko, s))[1]) for s in (SHIFT, -SHIFT)) / 2
                    c["known_objects"] += len(ko) if floor == "t6" else 0
                    if floor == "t6":
                        for j, i in pairs.items():
                            m = sel[i]["masked"]
                            mk.append((ko[j]["v_mag"], sum(m) / len(m) if m else 0.0))
        log(f"{r['patch']} {r['step']} done ({time.time() - t0:.0f} s)")
    out = {"counts": dict(c)}
    for k in ("fake", "guard", "known"):
        for floor in ("far1", "t6"):
            tr, sh = c.get(f"{k}_{floor}_true", 0), c.get(f"{k}_{floor}_shift", 0)
            out[f"chance_rate_{k}_{floor}"] = (sh / tr) if tr else None
    mk_, mf_ = np.array(mk, float), np.array(mf, float)
    if len(mk_):
        lo, hi = np.nanmin(mk_[:, 0]), np.nanmax(mk_[:, 0])
        f_in = mf_[(mf_[:, 0] >= lo) & (mf_[:, 0] <= hi)]
        rng = np.random.default_rng(0)
        bd = [rng.choice(mk_[:, 1], len(mk_)).mean() - rng.choice(f_in[:, 1], len(f_in)).mean() for _ in range(10000)]
        out["masked_t6"] = {"n_known": len(mk_), "known_mean": float(mk_[:, 1].mean()), "n_fake_same_mag": len(f_in),
                            "fake_mean": float(f_in[:, 1].mean()), "vmag_range": [float(lo), float(hi)],
                            "ci95_known_minus_fake": [float(x) for x in np.percentile(bd, [2.5, 97.5])]}
    tmp = OUT / "r1a_labels.json.tmp"; tmp.write_text(json.dumps(out, indent=1)); os.replace(tmp, OUT / "r1a_labels.json")
    log(json.dumps({k: v for k, v in out.items() if k != "counts"}))


if __name__ == "__main__":
    main()
