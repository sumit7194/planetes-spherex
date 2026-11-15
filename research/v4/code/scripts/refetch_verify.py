"""Re-fetch a discarded N patch's raw cutouts from its receipts, verify them, recompute the areas, and
delete them again (Sumit, 27 Oct: N-1 to N-3 lost their v0 maps, which held the FAR denominator).
For a V patch (first V look, Sumit 30 Oct) the verified cutouts are kept for the maps and runs, and no areas are written.

For every cutout in runs/yardstick/<patch>/discard.json:
  * the same S3 key (processing tag included) and the same pixel box are fetched; the box is reproduced
    exactly through fetch_cutout's own centring and clipping, and the cache path, which encodes the box,
    must equal the recorded one;
  * its content hash (discard_raw.content_sha256) must equal the recorded one. A mismatch is recorded
    and never substituted: the patch's areas are not written, and the null is reported as different.
Then scripts/save_map_areas.py computes the areas (and WCS) from the raw cutouts, and the re-fetched
files, exactly those listed, are deleted. runs/yardstick/<patch>/refetch.json records it all.

Usage: uv run python scripts/refetch_verify.py <patch> [parallel_files]   (patch N-* or V-*)
"""

from __future__ import annotations

import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
HALF = 292  # the fetch half-width of every N patch (scripts/fetch_patches.sh)


def centre_for(lo: int, size: int) -> int:
    """A centre that fetch_cutout clips back to [lo, lo + size): from the low edge unless that edge was clipped at 0."""
    return lo + HALF if lo > 0 else lo + size - (HALF + 1)


def main():
    from discard_raw import content_sha256

    from smo.data.exposure import fetch_cutout
    from smo.data.s3 import L2Key
    from smo.provenance import atomic_write_json

    patch = sys.argv[1]
    par = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    if not patch.startswith(("N-", "V-")):
        raise SystemExit("for discarded N and V patches only")
    keep = patch.startswith("V-")
    rec = json.loads((ROOT / "runs/yardstick" / patch / "discard.json").read_text())
    entries = rec["deleted"]
    cut_root = (ROOT / "cache" / "cutouts").resolve()
    results, mismatches, failures = [], [], []

    def one(e):
        ny, nx = e["shape"]
        cut, prov = fetch_cutout(client, L2Key(e["key"]), centre_for(e["x0"], nx), centre_for(e["y0"], ny), HALF, ROOT / "cache")
        if Path(prov["path"]).resolve() != Path(e["path"]).resolve():
            raise RuntimeError(f"box differs: {prov['path']} vs {e['path']}")
        h = content_sha256(cut)
        return {"path": e["path"], "key": e["key"], "content_sha256": h, "match": h == e["content_sha256"],
                "cache_hit": prov["cache_hit"]}

    with httpx.Client(timeout=120, limits=httpx.Limits(max_connections=8 * par)) as client, ThreadPoolExecutor(par) as pool:
        futs = {pool.submit(one, e): e for e in entries}
        for i, f in enumerate(as_completed(futs), 1):
            e = futs[f]
            try:
                r = f.result()
                results.append(r)
                if not r["match"]:
                    mismatches.append(r)
            except Exception as ex:  # noqa: BLE001 - recorded and reported
                failures.append({"path": e["path"], "error": repr(ex)})
            if i % 50 == 0 or i == len(entries):
                print(f"  {i}/{len(entries)} fetched, {len(mismatches)} hash mismatches, {len(failures)} failures", flush=True)
    areas_ok = not mismatches and not failures and not keep
    if areas_ok:
        subprocess.run([sys.executable, str(ROOT / "scripts/save_map_areas.py"), patch], check=True)
    deleted = 0
    for e in ([] if keep else entries):
        p = Path(e["path"]).resolve()
        if cut_root in p.parents and p.exists():
            p.unlink()
            deleted += 1
    atomic_write_json(ROOT / "runs/yardstick" / patch / "refetch.json",
                      {"patch": patch, "when": datetime.now(timezone.utc).isoformat(), "n": len(entries),
                       "verified": sum(r["match"] for r in results), "mismatches": mismatches, "failures": failures,
                       "areas_written": areas_ok, "deleted_again": deleted, "kept": keep})
    print(f"{patch}: {sum(r['match'] for r in results)}/{len(entries)} verified, {len(mismatches)} mismatches, "
          f"{len(failures)} failures; areas {'written' if areas_ok else 'NOT written'}; "
          f"{'kept' if keep else f'{deleted} re-fetched files deleted'}")
    if mismatches or failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
