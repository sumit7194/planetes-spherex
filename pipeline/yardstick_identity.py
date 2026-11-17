"""Identity check before the fake-mover run continues from the sky index (PLAN §8, 15 Nov night,
Physics): for each field already done from IRSA's image search (SIA), the index's photo list
(margin 0) must give the same photo set after the 8 px edge rule.

IRSA's lists were not kept, so the comparison is what each finished field recorded:
  - run.json `photos`: how many photos SIA returned (before the edge rule);
  - stacks_base.npz: the photo count in every pass x detector stack and `edge_dropped`
    (after the edge rule), from the same stack_exps code;
  - truth_p*.json: every (obs_id, detector) a fake was drawn into, which must all be in the index list.
The index list is read through the same helper and stacked with the same code (no injection).
Exits non-zero, printing every difference, if anything differs.

Usage: .venv/bin/python yardstick_identity.py Y-01 Y-12 Y-15 Y-27
"""
from __future__ import annotations

import asyncio
import re
import json
import sys
from pathlib import Path

import numpy as np

import field_stacks as fs
import yardstick_inject as yi

HERE = Path(__file__).parent
FIELDS = {f["field"]: f for f in json.loads(yi.FIELDS.read_text())}


def check(name: str) -> list[str]:
    field = FIELDS[name]
    done = HERE / "yardstick_inject" / name
    run = json.loads((done / "run.json").read_text())
    base = np.load(done / "stacks_base.npz")
    fs.ROWS_FROM = "index"
    fs.INDEX_MARGIN = -0.05  # max(0.05, 1.5 x worst 0.0223 deg over 1,663 photos), PLAN §8 16 Nov
    rows = fs.search_rows(field["ra"], field["dec"])
    exps, _ = asyncio.run(yi.read_field(rows, field["ra"], field["dec"]))
    ok = [(r, e) for r, e in zip(rows, exps) if e is not None]

    st = fs.stack_exps(field, [r for r, _ in ok], [e for _, e in ok], "passes")
    diffs = []
    worst = 0.0
    # Listed and read counts may differ (the index list is a superset at -0.05 deg); they're reported,
    # not compared. What reaches the science must be identical (Physics, 15 Nov night).
    keys_a = {k for k in base.files if k.endswith("_n")}
    keys_b = {k for k in st if k.endswith("_n")}
    for k in sorted(keys_a | keys_b):
        a = int(base[k][0]) if k in keys_a else 0
        b = int(st[k][0]) if k in keys_b else 0
        if a != b:
            diffs.append(f"{k[:-2]}: SIA {a} photos, index {b}")
    # Pixel identity of every stack both runs made (the read path too: hosted helper then, the same
    # Worker code on this Mac now). NaN where both are NaN counts as equal.
    worst = 0.0
    for k in sorted(k for k in keys_a & keys_b):
        ka = k[:-2] + "_img"
        a_img, b_img = base[ka], st[ka]
        same_nan = np.array_equal(np.isnan(a_img), np.isnan(b_img))
        d = float(np.nanmax(np.abs(a_img - b_img))) if np.isfinite(a_img - b_img).any() else 0.0
        worst = max(worst, d)
        if not same_nan or d > 0:
            diffs.append(f"{k[:-2]} image differs: max |diff| {d:.3g}, NaN pattern {'same' if same_nan else 'differs'}")
        if not np.array_equal(base[k[:-2] + "_flags"], st[k[:-2] + "_flags"]):
            diffs.append(f"{k[:-2]} flags differ")
    # The index's obs_id carries the detector ("..._0110_1D4"); SIA's doesn't ("..._0418_1").
    have = {(re.sub(r"D\d$", "", r["obs_id"]), int(r["det"])) for r in rows}
    seen = set()
    for t in sorted(done.glob("truth_p*.json")):
        for p in json.loads(t.read_text()).get("per_photo", []):
            seen.add((p["obs"], int(p["det"])))
    missing = sorted(seen - have)
    if missing:
        diffs.append(f"{len(missing)} photos with fakes are not in the index list, e.g. {missing[:3]}")
    n_stacks = len(keys_a)
    print(f"{name}: SIA {run['photos']} listed ({run['read']} read) / index {len(rows)} listed ({len(ok)} read); {n_stacks} pass x detector stacks compared; "
          f"edge_dropped {int(st['edge_dropped'][0])}; pixel max |diff| {worst:.3g}; {len(seen)} photo IDs from the truth files checked; "
          f"{'IDENTICAL' if not diffs else f'{len(diffs)} DIFFERENCES'}", flush=True)
    for d in diffs:
        print("   ", d, flush=True)
    return diffs


def main() -> int:
    bad = 0
    for name in sys.argv[1:]:
        bad += bool(check(name))
    print("ALL IDENTICAL" if not bad else f"{bad} field(s) differ: stop and tell Physics", flush=True)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
