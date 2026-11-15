"""Fetch 1 deg^2 cutouts of every QR2 exposure covering a sky position (several files at once).

Usage: uv run python scripts/fetch_region.py <ra> <dec> <half_px> <sia_cache_csv> [parallel_files]
Writes a manifest (key, cache path, sha256, bytes read) to runs/.
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from smo.data.exposure import fetch_cutout_sky
from smo.data.irsa import exposures_covering
from smo.provenance import atomic_write_json, environment_stamp

ROOT = Path(__file__).resolve().parents[1]


def main():
    ra, dec, half, csv_path = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
    nfiles = int(sys.argv[5]) if len(sys.argv) > 5 else 4
    out, failures, t0 = [], [], time.time()
    with httpx.Client(timeout=120, limits=httpx.Limits(max_connections=8 * nfiles)) as client:
        rows = exposures_covering(client, ra, dec, csv_path)
        print(f"{len(rows)} exposures to fetch", flush=True)

        def one(r):
            cut, prov = fetch_cutout_sky(client, r["l2key"], ra, dec, half, ROOT / "cache")
            return {"key": r["s3_key"], "obs_id": r["obs_id"], "shape": list(cut.shape), **prov}

        with ThreadPoolExecutor(max_workers=nfiles) as pool:
            futs = {pool.submit(one, r): r for r in rows}
            for i, f in enumerate(as_completed(futs), 1):
                try:
                    out.append(f.result())
                except Exception as e:  # noqa: BLE001 - record and continue; reported at the end
                    failures.append({"key": futs[f]["s3_key"], "error": repr(e)})
                if i % 10 == 0 or i == len(rows):
                    gb = sum(o.get("bytes_read") or 0 for o in out) / 1e9
                    print(f"{i}/{len(rows)} done, {gb:.2f} GB read, {time.time() - t0:.0f}s, {len(failures)} failed", flush=True)
    path = ROOT / "runs" / f"fetch_region_{ra:.4f}_{dec:.4f}_{half}.json"
    atomic_write_json(path, {"ra": ra, "dec": dec, "half": half, "fetched": out, "failures": failures,
                             "env": environment_stamp()})
    print("wrote", path, "| failures:", len(failures))


if __name__ == "__main__":
    main()
