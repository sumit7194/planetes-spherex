"""R-0 of the registered ranker plan R-1 (~/mac_shared/RANKER_draft.md v5, md5 09919f7d…; PLAN.md §11, 14 Nov).

Count-only inventory of Physics' v4 candidate records (read-only; .gz read with gzip.open, never gunzipped), from the
manifest ~/mac_shared/RANKER_records_manifest.txt (PRESENT lines only; T-1..T-3 and V are never listed or opened).
No training, no stamps. Physics' functions are imported from SphereXVision/src, unpatched.

Per patch x step: candidates, hard_ok, passes, above FAR-1.0 (secondary: slow 7.658, fast 12.546, Physics 14 Nov) and above
T6 (t6_result.json thresholds.v4), fake matches (injection passes; companion guard fakes in guard0), known-asteroid matches
(known.json objects, positions at the record's t0, the same t0 as known.json's visit), vetoed real-sky candidates, scramble
candidates, masked-frame fractions (fakes vs knowns), and the projections the plan needs (found fakes at T6 per visit-pass;
junk above FAR 1.0 per visit in guard0 and scramble).
Usage: python r0_inventory.py [--limit N]      (writes $SXA_ROOT/runs/r0/inventory.json)
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

SXV = Path("/Users/sumit/Github/SphereXVision")
sys.path.insert(0, str(SXV / "src"))
from smo.score import t6 as T6                      # noqa: E402
from smo.score.yardstick import MATCH_ARCSEC, match, unseal  # noqa: E402

from sxa.paths import ROOT                          # noqa: E402

MANIFEST = Path.home() / "mac_shared" / "RANKER_records_manifest.txt"
OUT = ROOT / "runs" / "r0"
THR_T6 = {b: json.loads((SXV / "runs/yardstick/T6/t6_result.json").read_text())["thresholds"]["v4"][b]["t"] for b in T6.BANDS}
THR_FAR1 = {"slow": 7.658, "fast": 12.546}           # v4 secondary threshold at FAR 1.0 (Physics, 14 Nov)
FORBIDDEN = ("T-1", "T-2", "T-3", "V-1", "V-2", "V-3", "V_LOOK")
MASK_TOL = 0.01                                      # masked-fraction check: fail if the 95 % CI of (known - fake) lies outside +-0.01 (tightened from 0.05 after the smoke test, disclosed in PLAN)


def log(m: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), m, flush=True)


def load_record(p: Path) -> tuple[dict, list[dict]]:
    """Physics' smo.score.yardstick.load_visit (yardstick.py lines 72-78), but opening .gz with gzip:
        rec = json.loads(Path(path).read_text())
        truth = []
        if "truth" in rec:
            t = unseal(Path(rec["truth"]["path"]), rec["truth"]["sha256"])
            truth = [f for f in t["fakes"] if "skipped" not in f and f["n_valid_frames"] >= 2]"""
    with (gzip.open(p, "rt") if p.suffix == ".gz" else open(p)) as f:
        rec = json.load(f)
    truth = []
    if "truth" in rec:
        t = unseal(Path(rec["truth"]["path"]), rec["truth"]["sha256"])
        truth = [f for f in t["fakes"] if "skipped" not in f and f["n_valid_frames"] >= 2]
    return rec, truth


def above(c: dict, thr: dict) -> bool:
    """yardstick.passing's rule (passes and score > t) at the candidate's rate band."""
    return bool(c["passes"]) and c["score"] > thr[T6.band_of(c)]


def known_at(objs: list[dict], dt_days: float) -> list[dict]:
    """known.json objects moved linearly from the visit's t0 by dt (outlier_check.py's formula), as match() truth."""
    out = []
    for o in objs:
        ra = o["ra_t0"] + o["dra_cosdec_deg_per_day"] * dt_days / np.cos(np.radians(o["dec_t0"]))
        out.append({"ra_t0": ra, "dec_t0": o["dec_t0"] + o["ddec_deg_per_day"] * dt_days, "desig": o["desig"],
                    "v_mag": o["v_mag"], "rate": o["rate_arcsec_per_s"]})
    return out


def manifest() -> list[dict]:
    rows = []
    for line in MANIFEST.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = [x.strip() for x in line.split("|")]
        if f[2] != "PRESENT":
            continue
        if any(f[0].startswith(x) for x in FORBIDDEN):
            raise SystemExit(f"manifest lists a locked patch: {f[0]}")
        rows.append({"patch": f[0], "step": f[1], "folder": Path(f[3]), "known": None if f[6] == "ABSENT" else Path(f[6])})
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="smoke test: records per folder")
    a = ap.parse_args()
    rows = manifest()
    res, mask_fake, mask_known = {}, [], []
    known_seen = {}                                        # (patch, visit, desig) -> {"v_mag", "rate", "t6", "steps"}
    fake_t6_per_visitpass = []
    junk_far1_per_visit = defaultdict(list)                # source -> counts per visit
    t0 = time.time()
    for r in rows:
        files = sorted(p for p in r["folder"].iterdir() if p.name.endswith((".json", ".json.gz")) and "_set" not in p.name)
        if a.limit:
            files = files[: a.limit]
        kn = json.loads(r["known"].read_text())["visits"] if r["known"] else None
        c = defaultdict(int)
        for p in files:
            rec, truth = load_record(p)
            cands = rec["candidates"]
            c["records"] += 1
            c["candidates"] += len(cands)
            c["hard_ok"] += sum(bool(x["hard_ok"]) for x in cands)
            ok = [x for x in cands if x["passes"]]
            c["passes"] += len(ok)
            c["above_far1"] += sum(above(x, THR_FAR1) for x in ok)
            c["above_t6"] += sum(above(x, THR_T6) for x in ok)
            # fakes (injection passes) or companion guard fakes (guard0), matched among passing candidates as recovered() does
            pairs, used = match(ok, truth)
            fake_ids = set(used)
            key = "guard_fake" if r["step"] == "guard0" else "fake"
            c[f"{key}_truth"] += len(truth)
            c[f"{key}_matched"] += len(used)
            n_t6 = sum(above(ok[i], THR_T6) for i in used)
            c[f"{key}_matched_t6"] += n_t6
            if r["step"].startswith("pass"):
                fake_t6_per_visitpass.append(n_t6)
            for i in used:
                m = ok[i]["masked"]
                mask_fake.append(sum(m) / len(m) if m else 0.0)
            # known asteroids at this visit (real sky is in every step except scramble)
            known_ids = set()
            if kn is not None and r["step"] != "scramble_guard0" and rec["visit"] in kn:
                kv = kn[rec["visit"]]
                rt0 = {x["t0"] for x in cands}
                if len(rt0) > 1:
                    raise SystemExit(f"{p}: candidates carry several t0")
                dt = (rt0.pop() - kv["t0"]) if rt0 else 0.0
                if abs(dt) > 1.0:
                    raise SystemExit(f"{p}: record t0 differs from known.json's by {dt} d")
                ko = known_at(kv["objects"], dt)
                rest = [i for i in range(len(ok)) if i not in fake_ids]
                kp, kused = match([ok[i] for i in rest], ko)
                known_ids = {rest[i] for i in kused}
                c["known_objects"] += len(ko)
                c["known_matched"] += len(kused)
                for j, i in kp.items():
                    cand = ok[rest[i]]
                    kk = (r["patch"], rec["visit"], ko[j]["desig"])
                    new = kk not in known_seen
                    e = known_seen.setdefault(kk, {"v_mag": ko[j]["v_mag"], "rate": ko[j]["rate"], "t6": False, "steps": []})
                    e["t6"] |= above(cand, THR_T6)
                    e["steps"].append(r["step"])
                    if new:   # one masked fraction per known object and visit (passes repeat the same real sky)
                        m = cand["masked"]
                        mask_known.append(sum(m) / len(m) if m else 0.0)
            # negatives
            if r["step"] == "scramble_guard0":
                c["neg_scramble"] += len(cands)
                c["neg_scramble_passes"] += len(ok)
            elif r["step"] in ("real", "guard0"):
                lab = {id(ok[i]) for i in fake_ids | known_ids}
                c["neg_vetoed"] += sum(1 for x in cands if (x["veto_static"] or x["veto_partner"] or x["screened_out"]) and id(x) not in lab)
            # claim-B junk: guard0 / scramble passing above FAR 1.0, not a fake or known match
            if r["step"] in ("guard0", "scramble_guard0"):
                n = sum(1 for i, x in enumerate(ok) if above(x, THR_FAR1) and i not in fake_ids and i not in known_ids)
                junk_far1_per_visit[r["step"]].append(n)
                c["junk_far1"] += n
        res[f"{r['patch']}|{r['step']}"] = dict(c)
        log(f"{r['patch']} {r['step']}: {dict(c)}  ({time.time() - t0:.0f} s)")
    kn_u = list(known_seen.values())
    mf, mk = np.array(mask_fake), np.array(mask_known)
    if len(mf) and len(mk):
        rng = np.random.default_rng(0)
        bd = [rng.choice(mk, len(mk)).mean() - rng.choice(mf, len(mf)).mean() for _ in range(10000)]
        lo, hi = (float(x) for x in np.percentile(bd, [2.5, 97.5]))
        mask_ok = not (lo > MASK_TOL or hi < -MASK_TOL)
    else:
        lo = hi = float("nan"); mask_ok = False
    tot = lambda k: sum(v.get(k, 0) for v in res.values())  # noqa: E731
    fpv = np.array(fake_t6_per_visitpass, float)
    summary = {
        "positives_fake_matched": tot("fake_matched"), "positives_fake_matched_t6": tot("fake_matched_t6"),
        "guard_fakes_matched": tot("guard_fake_matched"),
        "negatives": {"scramble": tot("neg_scramble"), "scramble_passes": tot("neg_scramble_passes"), "vetoed_real_sky": tot("neg_vetoed")},
        "known_unique": len(kn_u), "known_unique_t6": sum(e["t6"] for e in kn_u),
        "known_vmag": [e["v_mag"] for e in kn_u], "known_rate": [e["rate"] for e in kn_u],
        "masked_fraction": {"fake_mean": float(mf.mean()) if len(mf) else None, "known_mean": float(mk.mean()) if len(mk) else None,
                            "n_fake": len(mf), "n_known": len(mk), "ci95_known_minus_fake": [lo, hi], "tol": MASK_TOL, "ok": mask_ok},
        "projection": {"found_fakes_t6_per_visit_pass": {"mean": float(fpv.mean()) if len(fpv) else None, "n": len(fpv)},
                       "visit_passes_for_300": (300 / fpv.mean()) if len(fpv) and fpv.mean() > 0 else None,
                       "junk_far1_per_visit": {k: {"mean": float(np.mean(v)), "n_visits": len(v), "total": int(np.sum(v))} for k, v in junk_far1_per_visit.items()}},
    }
    stops = []
    if summary["positives_fake_matched"] < 2000:
        stops.append("fewer than 2,000 fake positives")
    for k in ("scramble", "vetoed_real_sky"):
        if summary["negatives"][k] < 2000:
            stops.append(f"fewer than 2,000 negatives from {k}")
    if summary["known_unique"] < 20:
        stops.append("fewer than 20 known asteroids")
    if not mask_ok:
        stops.append("masked-fraction check fails")
    summary["stop"] = stops
    out = {"plan_md5": "09919f7d2b74268433e7b20298af50e4", "thresholds": {"t6": THR_T6, "far1": THR_FAR1, "match_arcsec": MATCH_ARCSEC},
           "limit": a.limit, "per_patch_step": res, "summary": summary, "seconds": time.time() - t0}
    OUT.mkdir(parents=True, exist_ok=True)
    name = "inventory_smoke.json" if a.limit else "inventory.json"
    tmp = OUT / (name + ".tmp"); tmp.write_text(json.dumps(out, indent=1)); os.replace(tmp, OUT / name)
    log(f"R-0 done: STOP {stops}" if stops else "R-0 done: no STOP rule fired")


if __name__ == "__main__":
    main()
