"""Per-field stacks for the slow-mover yardstick (prereg/slowmover/PLAN.md), read next to NASA's
bucket through the cloud helper, with only the small stacks kept on this machine.

For a field (ra, dec): every DR1 + QR3 photo of it, read as a native box (/v1/native), resampled
onto the same 64 x 64 north-up grid at 6.15" as the packs (planetes_pack.resample_frame), then
median-stacked per (group, detector) leaving out each photo's artefact pixels, as the packs do.

Groups:
  passes  the survey passes (gap > 60 days), for real season pairs (N-B, and the scored run);
  halves  each pass split at its median time into a first and a second half, for the split-pass
          null N-A (plan section 4: "run the identical search on the halves as if they were two
          seasons").

Output: one compressed .npz per field and grouping under pipeline/yardstick_stacks/ (git-ignored;
~0.3 MB each). Nothing per photo is written.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

import aiohttp
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

import build_pack as bp
import helper_client as hc
import planetes_pack as pp
import spherex as sx

HERE = Path(__file__).parent
OUT = HERE / "yardstick_stacks"
SIZE = 64
HALF = int(SIZE * 0.75) + 6
EDGE_PX = 8  # PLAN.md §8 edge rule


# Where the photo list comes from: IRSA's image search (as registered), or our own sky index
# (sky_index.py; IRSA's search was down from 14 Nov ~22:15 IST). One source per run, never mixed.
ROWS_FROM = "irsa"


def search_rows(ra, dec):
    if ROWS_FROM == "index":
        import sky_index
        rows = sky_index.search(ra, dec, margin_deg=0.0)
        sx.group_passes(rows)
        return rows
    for attempt in range(7):
        try:
            rows = sx.search(ra, dec)
            sx.group_passes(rows)
            return rows
        except Exception:  # noqa: BLE001  (IRSA's image search drops connections, 502s now and then)
            if attempt == 6:
                raise
            time.sleep(min(90, 15 * (attempt + 1)))


def groups_of(rows, mode: str) -> list[str]:
    if mode == "passes":
        return [f"p{r['pass']}" for r in rows]
    by_pass: dict[int, list[float]] = {}
    for r in rows:
        by_pass.setdefault(r["pass"], []).append(r["t"])
    mid = {p: float(np.median(ts)) for p, ts in by_pass.items()}
    return [f"p{r['pass']}{'a' if r['t'] <= mid[r['pass']] else 'b'}" for r in rows]


hc.HELPER = hc.DIRECT  # one request per box, nothing worth caching at the edge


async def read_all(rows, ra, dec, conc=32):
    sem = asyncio.Semaphore(conc)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as s:
        async def one(r):
            async with sem:
                try:
                    return await hc.native(s, r, ra, dec, HALF)
                except Exception:  # noqa: BLE001
                    return None
        return await asyncio.gather(*(one(r) for r in rows))


def stack_field(field: dict, mode: str) -> dict:
    ra, dec = field["ra"], field["dec"]
    rows = search_rows(ra, dec)
    exps = asyncio.run(read_all(rows, ra, dec))
    gw = bp.out_grid(ra, dec, SIZE)
    labels = groups_of(rows, mode)
    per: dict[tuple[str, int], list] = {}
    edge_dropped = 0
    for r, e, g in zip(rows, exps, labels):
        if e is None:
            continue
        w_exp = WCS(fits.Header.fromstring(e["wcs_hdr"]))
        # The edge rule (prereg/slowmover/PLAN.md §8, 15 Nov): the field centre's own pixel
        # within EDGE_PX of the detector's edge leaves the photo out, whatever the photo list.
        nx, ny = w_exp.pixel_shape
        if min(e["xt"], e["yt"], nx - 1 - e["xt"], ny - 1 - e["yt"]) < EDGE_PX:
            edge_dropped += 1
            continue
        img, fl = pp.resample_frame(e, w_exp, gw, SIZE)
        if np.isfinite(img).mean() < 0.5:
            continue
        per.setdefault((g, e["det"]), []).append((img, fl, e["mjd"]))
    out = {}
    for (g, d), items in per.items():
        if len(items) < 3:
            continue
        ims = np.stack([np.where((fl & pp.REJ) != 0, np.nan, im) for im, fl, _ in items])
        fls = np.stack([fl for _, fl, _ in items])
        sfl = np.zeros((SIZE, SIZE), np.uint8)
        for bit in (pp.SAT, pp.REJ):
            sfl[((fls & bit) != 0).mean(0) >= 0.5] |= bit
        key = f"{g}_D{d}"
        out[key + "_img"] = np.nanmedian(ims, 0).astype("<f4")
        out[key + "_flags"] = sfl
        out[key + "_mjd"] = np.array([float(np.mean([m for _, _, m in items]))])
        out[key + "_n"] = np.array([len(items)])
    out["edge_dropped"] = np.array([edge_dropped])
    out["rows_from"] = np.array([ROWS_FROM])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fields", default=str(HERE.parent / "prereg" / "slowmover" / "fields_null.json"))
    ap.add_argument("--mode", choices=["passes", "halves"], default="halves")
    ap.add_argument("--first", type=int, default=0)
    ap.add_argument("--count", type=int, default=3)
    a = ap.parse_args()
    fields = json.loads(Path(a.fields).read_text())[a.first:a.first + a.count]
    OUT.mkdir(exist_ok=True)
    for f in fields:
        path = OUT / f"{f['field']}_{a.mode}.npz"
        if path.exists():
            continue
        t0 = time.time()
        st = stack_field(f, a.mode)
        np.savez_compressed(path, **st)
        groups = sorted({k.rsplit('_', 2)[0] for k in st if k.endswith('_img')})
        print(f"{f['field']} {a.mode}: {len(groups)} stacks, {time.time() - t0:.0f}s, {path.stat().st_size / 1e3:.0f} kB", flush=True)


if __name__ == "__main__":
    main()
