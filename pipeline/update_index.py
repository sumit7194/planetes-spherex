"""G3 (15 Nov 2026): keep our sky index (public/data/index/dr1qr3) up to date as NASA adds photos,
without depending on IRSA's services (its TAP was down all night on 14-15 Nov).

New photos are found by listing NASA's bucket (the same listing as build_index.py), and each new
photo's index record is made from its own file: the first 12 FITS blocks hold the primary header
(SPS_FLAGS says a deep-field photo) and the IMAGE header (the WCS gives the footprint's corners;
MJD-BEG is ObsCore's t_min). Records go into the same 24-byte format and tiles as build_index.py.

Steps:
  --check N    Rebuild N existing records from their files and compare with the index (made from
               IRSA's ObsCore footprints). Stops if they disagree beyond a small tolerance.
  (default)    List the bucket, report what's new (and any release folder we don't index yet),
               and with --write add the new photos to the index.

Usage: python update_index.py --check 200
       python update_index.py                (report only)
       python update_index.py --write        (report, then add the new photos)
Writes a short report to update_index_report.json (for the GitHub Action's pull request).
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import glob
import json
import math
import random
import struct
import sys
from pathlib import Path

import aiohttp
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

import build_index as bi

HERE = Path(__file__).parent
BASE = bi.OUT
BLOCK = 2880
NAXIS = 2040
REPORT = HERE / "update_index_report.json"
REC = struct.Struct("<HHBBBBfffhh")


def load_index() -> tuple[dict, dict[str, list[tuple]]]:
    meta = json.loads((BASE / "index.json").read_text())
    tiles: dict[str, list[tuple]] = {}
    for f in glob.glob(str(BASE / "t" / "*.bin")):
        buf = Path(f).read_bytes()
        magic, n = struct.unpack_from("<II", buf, 0)
        if magic != 0x31455850 or len(buf) != 8 + n * 24:
            raise SystemExit(f"{f}: bad tile")
        tiles[Path(f).stem] = [REC.unpack_from(buf, 8 + i * 24) for i in range(n)]
    return meta, tiles


def key_of(folder: str, seq: int, exp: int, det: int) -> tuple[str, int]:
    week = folder.split("/")[2]
    return f"{week}_{seq:04d}_{exp}", det


def url_of(folder: str, obs: str, det: int) -> str:
    ver = folder.split("/")[3]
    return f"{bi.BUCKET}{folder}/{det}/level2_{obs}D{det}_spx_{ver}.fits"


def headers_from(buf: bytes) -> tuple[fits.Header, fits.Header]:
    text = buf.decode("ascii", "replace")
    h0_end = text.index("END" + " " * 77) + 80
    h0_len = math.ceil(h0_end / BLOCK) * BLOCK
    h0 = fits.Header.fromstring(text[:h0_end])
    rest = text[h0_len:]
    hi = fits.Header.fromstring(rest[: rest.index("END" + " " * 77) + 80])
    return h0, hi


def record_from(folder: str, obs: str, det: int, h0: fits.Header, hi: fits.Header) -> tuple:
    """The 24-byte record build_index.py would write, from the photo's own headers."""
    w = WCS(hi)
    nx, ny = int(hi.get("NAXIS1", NAXIS)), int(hi.get("NAXIS2", NAXIS))
    xs = [-0.5, nx - 0.5, nx - 0.5, -0.5]
    ys = [-0.5, -0.5, ny - 0.5, ny - 0.5]
    ra, dec = w.all_pix2world(xs, ys, 0)
    corners = " ".join(f"{a:.7f} {d:.7f}" for a, d in zip(ra, dec))
    cra, cdec, pa, half = bi.footprint("POLYGON ICRS " + corners)
    m = bi.FILE_RE.search(url_of(folder, obs, det))
    sps = str(hi.get("SPS_FLAGS", h0.get("SPS_FLAGS", "")))
    flags = (1 if folder.startswith("qr3/") else 0) | (2 if "deep" in sps.lower() else 0)
    return (0, int(m["seq"]), int(m["exp"]), det, flags, 0, float(hi.get("MJD-BEG", h0.get("MJD-BEG"))),
            cra, cdec, round(pa * 100), round(half * 1000))


async def read_headers(s: aiohttp.ClientSession, url: str) -> tuple[fits.Header, fits.Header]:
    for attempt in range(4):
        try:
            async with s.get(url, headers={"Range": f"bytes=0-{12 * BLOCK - 1}"}) as r:
                buf = await r.read()
            return headers_from(buf)
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            await asyncio.sleep(1 + attempt)
    raise RuntimeError("unreachable")


def sep_deg(a1, d1, a2, d2) -> float:
    a1, d1, a2, d2 = map(math.radians, (a1, d1, a2, d2))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


async def check(n: int) -> None:
    """Our records from the files vs the index's (IRSA ObsCore) records, for n random photos."""
    meta, tiles = load_index()
    allr = [r for rs in tiles.values() for r in rs]
    random.seed(15)
    sample = random.sample(allr, n)
    worst = dict(centre_arcsec=0.0, half_deg=0.0, mjd_s=0.0, flags_differ=0, pa_mod90_deg=0.0)
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=32),
                                     timeout=aiohttp.ClientTimeout(total=60)) as s:
        sem = asyncio.Semaphore(32)

        async def one(r):
            folder = meta["folders"][r[0]]
            obs, det = key_of(folder, r[1], r[2], r[3])
            async with sem:
                h0, hi = await read_headers(s, url_of(folder, obs, det))
            return r, record_from(folder, obs, det, h0, hi)

        for r, mine in await asyncio.gather(*(one(r) for r in sample)):
            worst["centre_arcsec"] = max(worst["centre_arcsec"], sep_deg(r[7], r[8], mine[7], mine[8]) * 3600)
            worst["half_deg"] = max(worst["half_deg"], abs(r[10] - mine[10]) / 1000)
            # The index stores f32 (a step of ~337 s at MJD 61000): compare after the same rounding.
            mine_f32 = struct.unpack("<f", struct.pack("<f", mine[6]))[0]
            worst["mjd_s"] = max(worst["mjd_s"], abs(r[6] - mine_f32) * 86400)
            worst["flags_differ"] += int(r[4] != mine[4])
            # The footprint is a square, so its position angle only matters modulo 90 degrees.
            d = ((r[9] - mine[9]) / 100) % 90
            worst["pa_mod90_deg"] = max(worst["pa_mod90_deg"], min(d, 90 - d))
    print(json.dumps(dict(checked=n, worst=worst), indent=1))
    # Tolerances: the index stores f32 (centre ~0.1", mjd ~0.5 s at MJD 6e4) and i16 steps.
    ok = (worst["centre_arcsec"] < 30 and worst["half_deg"] <= 0.01 and worst["mjd_s"] < 2
          and worst["flags_differ"] == 0 and worst["pa_mod90_deg"] < 0.5)
    if not ok:
        raise SystemExit("records from the files don't match the index; not safe to add photos this way")
    print("records from the files match the index")


async def update(write: bool) -> None:
    meta, tiles = load_index()
    have = set()
    for rs in tiles.values():
        for r in rs:
            have.add(key_of(meta["folders"][r[0]], r[1], r[2], r[3]))
    listing = await bi.list_all()  # (obs, det) -> folder
    new = {k: v for k, v in listing.items() if k not in have}
    gone = len(have - set(listing))
    # Release folders we don't index yet (a new data release appears here first).
    async with aiohttp.ClientSession() as s:
        _, top = await bi.list_prefix(s, "", "/")
    indexed = {f.split("/")[0] + "/" for f in meta["folders"]}
    others = sorted(p for p in top if p not in indexed)
    report = dict(checked_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                  indexed_photos=len(have), new_photos=len(new), missing_from_bucket=gone,
                  new_folders=sorted({v for v in new.values()} - set(meta["folders"])),
                  release_folders_not_indexed=others)
    print(json.dumps(report, indent=1))
    REPORT.write_text(json.dumps(report, indent=1))
    if not write or not new:
        return
    folders = list(meta["folders"])
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=32),
                                     timeout=aiohttp.ClientTimeout(total=60)) as s:
        sem = asyncio.Semaphore(32)

        async def one(k, folder):
            obs, det = k
            async with sem:
                h0, hi = await read_headers(s, url_of(folder, obs, det))
            return folder, record_from(folder, obs, det, h0, hi)

        made = await asyncio.gather(*(one(k, f) for k, f in sorted(new.items())))
    for folder, rec in made:
        if folder not in folders:
            folders.append(folder)
        rec = (folders.index(folder),) + rec[1:]
        k, b = bi.tile_of(rec[7], rec[8])
        tiles.setdefault(f"{k}_{b}", []).append(rec)
        meta["maxHalfDeg"] = max(meta["maxHalfDeg"], rec[10] / 1000)
    if len(folders) > 65535:
        raise SystemExit("too many folders for u16")
    for name, rs in tiles.items():
        buf = struct.pack("<II", 0x31455850, len(rs)) + b"".join(REC.pack(*r) for r in rs)
        (BASE / "t" / f"{name}.bin").write_bytes(buf)
    meta["folders"] = folders
    meta["photos"] = sum(len(rs) for rs in tiles.values())
    meta["tiles"] = len(tiles)
    meta["updated"] = report["checked_at"]
    meta["source"] = (meta["source"].split(";")[0] +
                      "; later photos added from their own headers by pipeline/update_index.py")
    (BASE / "index.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"added {len(made)} photos; index now {meta['photos']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", type=int, default=0)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    if a.check:
        asyncio.run(check(a.check))
    else:
        asyncio.run(update(a.write))


if __name__ == "__main__":
    sys.exit(main())
