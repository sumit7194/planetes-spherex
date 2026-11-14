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


def summary(seed: int = 20261114):
    """The N-A numbers, counted as fixed with Physics (14 Nov, night) before the pooled list was read:
    - the threshold uses ALL field-pairs that have >= 2 detectors (the search's own minimum);
      the >= 3-detector split is descriptive only;
    - T = the k-th highest pooled consistentSignificance, k = floor(N_pairs / 100); a candidate
      needs significance > T, so the null leaves at most k - 1 false candidates (<= 1 per 100);
    - the expected count at T is shown with its Poisson 95% range;
    - pairs of one field share sources, so the tail's fields are listed and T is bootstrapped by
      field (resample fields, 2,000 draws)."""
    from scipy.stats import chi2
    rows = [json.loads(line) for line in RESULTS.read_text().splitlines()] if RESULTS.exists() else []
    pairs = [r for r in rows if r.get("detectors", 0) >= 2]
    fields = sorted({r["field"] for r in rows})
    print(f"{len(fields)} fields, {len(rows)} field-pairs ({len(pairs)} with >= 2 detectors, "
          f"{sum(r['detectors'] >= 3 for r in pairs)} with >= 3)")
    if not pairs:
        return
    print(f"  candidates at the old 5x: {sum(r['nCandidates'] for r in pairs)} in {sum(r['nCandidates'] > 0 for r in pairs)} field-pairs")
    sc = np.array([r["steadyScatterPx"] for r in pairs])
    print(f"  steady scatter px: median {np.median(sc):.3f}, 10-90% {np.percentile(sc, 10):.3f}-{np.percentile(sc, 90):.3f}")
    pooled = sorted(((v, r["field"], r["detectors"]) for r in pairs for v in r["consistentSignificance"]), reverse=True)
    k = max(1, len(pairs) // 100)
    if len(pooled) < k:
        print(f"  only {len(pooled)} consistent sources; k = {k}")
        return
    T = pooled[k - 1][0]
    lo, hi = chi2.ppf(0.025, 2 * k) / 2, chi2.ppf(0.975, 2 * (k + 1)) / 2
    print(f"  threshold T = {T} (the {k}th highest of {len(pooled)} consistent sources over {len(pairs)} field-pairs); "
          f"candidates need > T; expected count at T ~{k} (Poisson 95% {lo:.1f}-{hi:.1f})")
    print(f"  top {min(2 * k, len(pooled))}: " + ", ".join(f"{v} {f} ({d} det)" for v, f, d in pooled[:2 * k]))
    from collections import Counter
    tail = Counter(f for _, f, _ in pooled[:k])
    print(f"  fields in the top {k}: {dict(tail)}" + ("  <- one field holds more than one" if max(tail.values()) > 1 else ""))
    t3 = sorted((v for r in pairs if r["detectors"] >= 3 for v in r["consistentSignificance"]), reverse=True)
    print(f"  >= 3-detector pairs (descriptive): {sum(v > T for v in t3)} above T")
    by_field = {f: [r for r in pairs if r["field"] == f] for f in {r["field"] for r in pairs}}
    names = sorted(by_field)
    rng = np.random.default_rng(seed)
    ts = []
    for _ in range(2000):
        pick = rng.choice(names, len(names))
        ps = [r for f in pick for r in by_field[f]]
        vals = sorted((v for r in ps for v in r["consistentSignificance"]), reverse=True)
        kk = max(1, len(ps) // 100)
        ts.append(vals[kk - 1] if len(vals) >= kk else 0.0)
    print(f"  T bootstrapped by field (2,000): median {np.median(ts):.2f}, 95% {np.percentile(ts, 2.5):.2f}-{np.percentile(ts, 97.5):.2f}")
    # Order and timing, so a reader sees the pause at the helper's daily cap selected nothing.
    order = []
    for f in fields:
        z = OUT / f"{f}_halves.npz"
        if z.exists():
            order.append((z.stat().st_mtime, f))
    order.sort()
    log = OUT / "na_order.txt"
    import datetime as dt
    log.write_text("".join(f"{dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat(timespec='seconds')} {f}\n" for t, f in order))
    print(f"  read order and UTC times: {log.name} ({len(order)} fields)")


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
