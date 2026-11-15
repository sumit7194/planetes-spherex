"""IRSA Simple Image Access (SIA v2) queries for SPHEREx, with the answer cached on disk.

IRSA is sometimes unavailable (HTTP 502 seen on 24 and 25 Oct 2026); the cached answer keeps a
run reproducible, and the S3 index (`smo.data.index`) is the fallback for discovery.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import httpx

from smo.data.s3 import L2Key
from smo.provenance import atomic_write_bytes, sha256_bytes

SIA = "https://irsa.ipac.caltech.edu/SIA"


def exposures_covering(client: httpx.Client, ra: float, dec: float, cache_csv: Path,
                       collection: str = "spherex_qr2") -> list[dict]:
    """Every exposure whose footprint contains (ra, dec). Cached as CSV; returns rows with an L2 key."""
    if cache_csv.exists():
        raw = cache_csv.read_bytes()
    else:
        params = {"COLLECTION": collection, "POS": f"circle {ra:.6f} {dec:.6f} 0.0001",
                  "RESPONSEFORMAT": "CSV", "MAXREC": "100000"}
        raw = client.get(SIA, params=params, timeout=300).raise_for_status().content
        atomic_write_bytes(cache_csv, raw)
    rows = list(csv.DictReader(io.StringIO(raw.decode())))
    for r in rows:
        # access_url is IRSA's copy; the S3 key mirrors the path after /data/spherex/.
        r["s3_key"] = r["access_url"].split("/data/spherex/", 1)[1]
        r["l2key"] = L2Key(r["s3_key"])
    for r in rows:
        r["_csv_sha256"] = sha256_bytes(raw)
    return rows
