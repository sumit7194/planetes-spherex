"""Slow-mover yardstick, step 4: the split-pass null N-A on the 200 null fields
(prereg/slowmover/PLAN.md section 4).

For each null field: the per-(half-pass, detector) stacks from field_stacks.py, then the SAME
search as the packs (season_pairs.search_stacks), comparing only each pass's first half with its
second half. True motion there is about zero, so every candidate is a false alarm. Each
field-pair keeps the significance of every cross-detector-consistent source (> 0.3 px), so the
threshold for "<= 1 false candidate per 100 field-pairs" is read off the pooled list afterwards,
without re-running anything.

Gaia-quiet stars (< 50 mas/yr) come from Gaia DR3 (one cone per field, cached as a small JSON next
to the stacks), placed on the grid by its WCS.

Usage: python yardstick_null.py --first 0 --count 3      (stacks are built first when missing)
       python yardstick_null.py --summary                  (pooled numbers so far)
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np

import build_pack as bp
import catalogs
import field_stacks as fs
import season_pairs as sp

OUT = fs.OUT
RESULTS = OUT / "na_results.jsonl"


def load_stacks(path: Path):
    z = np.load(path)
    stacks = {}
    for k in z.files:
        m = re.fullmatch(r"(p\d+[ab]?)_D(\d)_img", k)
        if not m:
            continue
        g, d = m.group(1), int(m.group(2))
        fl = z[f"{g}_D{d}_flags"]
        stacks[(g, d)] = dict(img=np.where(fl & sp.BAD, np.nan, z[k].astype(float)),
                              mjd=float(z[f"{g}_D{d}_mjd"][0]), sat=(fl & sp.SAT) > 0, n=int(z[f"{g}_D{d}_n"][0]))
    return stacks


def quiet_pixels(field: dict):
    path = OUT / f"{field['field']}_gaia.json"
    if path.exists():
        rows = json.loads(path.read_text())
    else:
        half_diag = fs.SIZE * bp.PIX / 2 * np.sqrt(2) / 3600 + 0.002
        rows = [dict(ra=r["ra"], dec=r["dec"], pm=float(np.hypot(r["pmra"], r["pmdec"])))
                for r in catalogs.gaia_dr3(field["ra"], field["dec"], half_diag)]
        path.write_text(json.dumps(rows))
    gw = bp.out_grid(field["ra"], field["dec"], fs.SIZE)
    q = [r for r in rows if r["pm"] < 50]
    if not q:
        return []
    x, y = gw.world_to_pixel_values(np.array([r["ra"] for r in q]), np.array([r["dec"] for r in q]))
    return list(zip(np.atleast_1d(x).tolist(), np.atleast_1d(y).tolist()))


def run_field(field: dict) -> list[dict]:
    path = OUT / f"{field['field']}_halves.npz"
    if not path.exists():
        np.savez_compressed(path, **fs.stack_field(field, "halves"))
    stacks = load_stacks(path)
    quiet = quiet_pixels(field)
    passes = sorted({g[:-1] for g, _ in stacks})
    pairs = [(p + "a", p + "b") for p in passes
             if any((p + "a", d) in stacks and (p + "b", d) in stacks for d in range(1, 7))]
    res = sp.search_stacks(stacks, fs.SIZE, lambda _s: quiet, pairs=pairs)
    for r in res:
        r["field"] = field["field"]
        r["nPhotos"] = [sum(v["n"] for (g, _), v in stacks.items() if g == s) for s in r["seasons"]]
        r["detectors"] = len(r["commonShiftRemoved"])
    return res


def summary():
    rows = [json.loads(line) for line in RESULTS.read_text().splitlines()] if RESULTS.exists() else []
    pairs = [r for r in rows if r.get("detectors", 0) >= 2]
    fields = {r["field"] for r in rows}
    sig = sorted((s for r in pairs for s in r["consistentSignificance"]), reverse=True)
    top = sorted((max(r["consistentSignificance"], default=0) for r in pairs), reverse=True)
    print(f"{len(fields)} fields, {len(rows)} field-pairs ({len(pairs)} with >= 2 detectors)")
    print(f"  candidates at today's 5x: {sum(r['nCandidates'] for r in pairs)} in {sum(r['nCandidates'] > 0 for r in pairs)} field-pairs")
    print(f"  steady scatter px: median {np.median([r['steadyScatterPx'] for r in pairs]):.3f}" if pairs else "")
    print(f"  per field-pair max significance, top 10: {top[:10]}")
    if pairs:
        k = max(1, len(pairs) // 100)  # the threshold that leaves <= 1 per 100 field-pairs above it
        print(f"  threshold for <= 1 per 100 field-pairs (sources counted, {len(pairs)} pairs): "
              f"just above {sig[k - 1] if len(sig) >= k else 0} (the {k}th highest of {len(sig)})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", type=int, default=0)
    ap.add_argument("--count", type=int, default=3)
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()
    if a.summary:
        return summary()
    fields = json.loads((Path(__file__).parent.parent / "prereg" / "slowmover" / "fields_null.json").read_text())
    OUT.mkdir(exist_ok=True)
    done = {json.loads(line)["field"] for line in RESULTS.read_text().splitlines()} if RESULTS.exists() else set()
    for f in fields[a.first:a.first + a.count]:
        if f["field"] in done:
            continue
        res = run_field(f)
        with RESULTS.open("a") as fh:
            for r in res or [dict(field=f["field"], seasons=[], detectors=0, consistentSignificance=[], nCandidates=0, steadyScatterPx=None)]:
                fh.write(json.dumps(r) + "\n")
        for r in res:
            print(f"{f['field']} {r['seasons']} photos {r['nPhotos']} dets {r['detectors']} sources {r['sources']} "
                  f"measured {r['measured']} scatter {r['steadyScatterPx']} px, cands {r['nCandidates']}, "
                  f"top sig {r['consistentSignificance'][:3]}", flush=True)
    summary()


if __name__ == "__main__":
    main()
