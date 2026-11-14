"""Build a compact sky index of every SPHEREx DR1 + QR3 photo, so the browser can find the photos
of any spot without asking IRSA (whose search services don't allow browser calls).

Inputs:
  - the S3 listing of s3://nasa-irsa-spherex/{dr1,qr3}/level2/  (every file's exact path), and
  - IRSA's ObsCore footprints (obs_id, detector, collection, t_min, s_region polygon) for the
    collections spherex_dr1, spherex_dr1_deep, spherex_qr3 and spherex_qr3_deep, fetched from IRSA
    TAP (see --footprints; a CSV with those columns).

Output (public/data/index/dr1qr3/):
  index.json          format, record layout, tiling, folder list, counts
  t/<band>_<bin>.bin  "PXE1", uint32 count, then count x 24-byte records (little-endian):
                        u16 folder   index into index.json "folders" ("dr1/level2/2025W19_1B/l2b-v27-2026-197")
                        u16 seq      the 4-digit sequence in the obs_id
                        u8  exp      the exposure number in the obs_id
                        u8  det      detector 1-6
                        u8  flags    bit 0: QR3 (else DR1), bit 1: deep-field collection
                        u8  pad
                        f32 mjd      t_min
                        f32 ra       footprint centre, degrees
                        f32 dec
                        i16 pa       position angle of the footprint's first edge, 0.01 degree
                        i16 half     half-diagonal of the footprint, 0.001 degree
  The file is s3://nasa-irsa-spherex/<folder>/<det>/level2_<obs_id>D<det>_spx_<version>.fits,
  where obs_id = <week folder>_<seq:04d>_<exp> and version is the folder's last path part.
  Tiling: declination bands 4 degrees tall; band k has bins = max(1, round(360 cos(dec_mid) / 4))
  equal RA bins. A photo is stored once, in the tile holding its centre; a reader loads every
  tile within (half-diagonal max + margin) of the position and tests each footprint.

Usage: uv run python build_index.py --footprints footprints.csv
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import csv
import json
import math
import re
import struct
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import aiohttp
import numpy as np

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
OUT = Path(__file__).parent.parent / "public" / "data" / "index" / "dr1qr3"
BAND_DEG = 4.0
FILE_RE = re.compile(r"level2_(?P<obs>(?P<folder>\d{4}W\d{2}_\w{2})_(?P<seq>\d{4})_(?P<exp>\d+))D(?P<det>\d)_spx_(?P<ver>[^/]+)\.fits$")


async def list_prefix(s: aiohttp.ClientSession, prefix: str, delimiter: str | None = None):
    keys, prefixes, token = [], [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if delimiter:
            params["delimiter"] = delimiter
        if token:
            params["continuation-token"] = token
        for attempt in range(5):
            try:
                async with s.get(BUCKET, params=params) as r:
                    x = await r.text()
                break
            except Exception:  # noqa: BLE001
                await asyncio.sleep(1 + attempt)
        root = ET.fromstring(x)
        keys += [c.find(NS + "Key").text for c in root.findall(NS + "Contents")]
        prefixes += [c.find(NS + "Prefix").text for c in root.findall(NS + "CommonPrefixes")]
        if root.find(NS + "IsTruncated").text != "true":
            return keys, prefixes
        token = root.find(NS + "NextContinuationToken").text


async def list_all() -> dict:
    """(obs_id, det) -> folder path 'dr1/level2/<week>/<version>'"""
    out = {}
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=16), timeout=aiohttp.ClientTimeout(total=120)) as s:
        weeks = []
        for rel in ("dr1", "qr3"):
            _, p = await list_prefix(s, f"{rel}/level2/", "/")
            weeks += p
        print(f"{len(weeks)} week folders", file=sys.stderr)
        vers = []
        for chunk in [weeks[i:i + 32] for i in range(0, len(weeks), 32)]:
            for _, p in await asyncio.gather(*(list_prefix(s, w, "/") for w in chunk)):
                vers += p
        print(f"{len(vers)} version folders", file=sys.stderr)
        sem = asyncio.Semaphore(16)
        done = [0]

        async def one(v):
            async with sem:
                k, _ = await list_prefix(s, v)
                done[0] += 1
                if done[0] % 100 == 0:
                    print(f"  listed {done[0]}/{len(vers)}", file=sys.stderr)
                return v, k

        for v, keys in await asyncio.gather(*(one(v) for v in vers)):
            for k in keys:
                m = FILE_RE.search(k)
                if m:
                    out[(m["obs"], int(m["det"]))] = v.rstrip("/")
    print(f"{len(out)} files", file=sys.stderr)
    return out


def unit(ra, dec):
    a, d = math.radians(ra), math.radians(dec)
    return np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)])


def footprint(poly: str):
    v = [float(x) for x in poly.replace("POLYGON ICRS", "").split()]
    pts = list(zip(v[0::2], v[1::2]))[:4]
    c = sum(unit(*p) for p in pts)
    c /= np.linalg.norm(c)
    ra = math.degrees(math.atan2(c[1], c[0])) % 360
    dec = math.degrees(math.asin(c[2]))
    # Position angle of the first edge, and the largest corner distance (half-diagonal).
    (r1, d1), (r2, d2) = pts[0], pts[1]
    pa = math.degrees(math.atan2((r2 - r1) * math.cos(math.radians((d1 + d2) / 2)), d2 - d1))
    half = max(math.degrees(math.acos(max(-1, min(1, float(np.dot(unit(*p), c)))))) for p in pts)
    return ra, dec, pa, half


def bins_in_band(k: int) -> int:
    mid = -90 + (k + 0.5) * BAND_DEG
    return max(1, round(360 * math.cos(math.radians(mid)) / BAND_DEG))


def tile_of(ra: float, dec: float) -> tuple[int, int]:
    k = min(int((dec + 90) // BAND_DEG), int(180 / BAND_DEG) - 1)
    n = bins_in_band(k)
    return k, min(int(ra / 360 * n), n - 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--footprints", required=True)
    a = ap.parse_args()
    t0 = time.time()
    paths = asyncio.run(list_all())
    print(f"listing took {time.time() - t0:.0f}s", file=sys.stderr)
    folders: list[str] = []
    fidx: dict[str, int] = {}
    tiles = collections.defaultdict(list)
    missing = 0
    max_half = 0.0
    with open(a.footprints) as f:
        r = csv.DictReader(f)
        for row in r:
            det = int(row["energy_bandpassname"][-1])
            obs = row["obs_id"]
            path = paths.get((obs, det))
            if path is None:
                missing += 1
                continue
            if path not in fidx:
                fidx[path] = len(folders)
                folders.append(path)
            m = re.match(r"(\d{4}W\d{2}_\w{2})_(\d{4})_(\d+)$", obs)
            ra, dec, pa, half = footprint(row["s_region"])
            max_half = max(max_half, half)
            flags = (1 if "qr3" in row["obs_collection"] else 0) | (2 if row["obs_collection"].endswith("_deep") else 0)
            rec = struct.pack("<HHBBBBfffhh", fidx[path], int(m[2]), int(m[3]), det, flags, 0, float(row["t_min"]),
                              ra, dec, int(round(pa * 100)), int(round(half * 1000)))
            tiles[tile_of(ra, dec)].append(rec)
    (OUT / "t").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "t").glob("*.bin"):
        old.unlink()
    n = 0
    for (k, b), recs in tiles.items():
        (OUT / "t" / f"{k}_{b}.bin").write_bytes(b"PXE1" + struct.pack("<I", len(recs)) + b"".join(recs))
        n += len(recs)
    meta = dict(format="planetes-eventindex/1", release="dr1qr3",
                collections=["spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep"],
                recordBytes=24, recordLayout="u16 folder, u16 seq, u8 exp, u8 det, u8 flags (1 qr3, 2 deep), u8 pad, f32 mjd, f32 ra, f32 dec, i16 pa (0.01 deg), i16 half (0.001 deg)",
                bandDeg=BAND_DEG, bins=[bins_in_band(k) for k in range(int(180 / BAND_DEG))], maxHalfDeg=round(max_half, 4),
                folders=folders, photos=n, missingPaths=missing, tiles=len(tiles),
                built=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                source="IRSA ObsCore footprints (TAP) joined with the S3 listing of nasa-irsa-spherex")
    (OUT / "index.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(json.dumps({k: v for k, v in meta.items() if k not in ("folders", "bins")}), file=sys.stderr)


if __name__ == "__main__":
    main()
