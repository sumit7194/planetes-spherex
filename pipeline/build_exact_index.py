"""Build the EXACT sky index (plan item A1 / queue #2): for every DR1 + QR3 photo, the full recipe
for turning a sky position into a pixel, plus where its data sits in the file. With it, and the six
per-detector colour tables (identical in every file, see notes), the browser knows every photo's
pixel and colour at any spot without asking NASA's server anything.

It reads the first 12 FITS blocks (primary + IMAGE headers) and the FLAGS header of each photo.
That's ~3.3 M small range requests in all, so run it next to the data: GitHub Actions or AWS.

Input:  public/data/index/dr1qr3/ (the 24-byte index: which photos exist, S3 paths, footprints)
Output: <out>/index.json, <out>/t/<band>_<bin>.bin with 152-byte records, little-endian:
          0  the 24-byte record of the basic index (folder u16, seq u16, exp u8, det u8, flags u8,
             pad u8, mjd f32, ra f32, dec f32, pa i16, half i16)
         24  crval1 f64, crval2 f64                 (deg)
         40  crpix1 f32, crpix2 f32                 (FITS 1-based)
         48  pc11 f32, pc12 f32, pc21 f32, pc22 f32 (CDELT folded in: deg per pixel)
         64  a[10] f32, then b[10] f32             (FORWARD SIP A/B, terms p+q <= 3 in the order
                                                    (0,0) (0,1) (0,2) (0,3) (1,0) (1,1) (1,2) (2,0) (2,1) (3,0))
        144  image_offset u32                       (byte where IMAGE data starts)
        148  flags_header_blocks u16               (FLAGS header length / 2880)
        150  sip_order u8 (A_ORDER), pad u8
        Pixel of a sky position: TAN projection with CRVAL -> (U, V) by the inverse PC, then solve
        u + A(u, v) = U, v + B(u, v) = V (a few fixed-point steps from u = U), x = u + crpix - 1.
        This is exact (astropy's inverse); the files' reverse polynomial AP/BP is ~0.003 px off.
        Tiles: 2-degree declination bands, RA bins of ~2 deg (bins[k] in index.json).
        Plus <out>/wave_<dr1|qr3>_d<1-6>.json: each detector's WCS-WAVE table per release
        (identical across photos of a release).

Usage: python build_exact_index.py --out public/data/index/dr1qr3x [--limit N] [--conc 256]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import struct
import sys
import time
from pathlib import Path

import aiohttp
import numpy as np
from astropy.io import fits

import spherex as sx

BLOCK = 2880
BASE = Path(__file__).parent.parent / "public" / "data" / "index" / "dr1qr3"
BAND_DEG = 2.0
SIP_TERMS = [(p, q) for p in range(4) for q in range(4 - p)]  # (0,0) (0,1) (0,2) (0,3) (1,0) ...
RECORD = struct.Struct("<24sddffffff20fIHBx")
assert RECORD.size == 152, RECORD.size


def bins_in_band(k: int) -> int:
    mid = -90 + (k + 0.5) * BAND_DEG
    return max(1, round(360 * math.cos(math.radians(mid)) / BAND_DEG))


def tile_of(ra: float, dec: float) -> tuple[int, int]:
    k = min(int((dec + 90) // BAND_DEG), int(180 / BAND_DEG) - 1)
    n = bins_in_band(k)
    return k, min(int(ra / 360 * n), n - 1)


def read_basic():
    meta = json.loads((BASE / "index.json").read_text())
    for f in sorted((BASE / "t").glob("*.bin")):
        b = f.read_bytes()
        n = struct.unpack("<I", b[4:8])[0]
        for i in range(n):
            raw = b[8 + i * 24: 32 + i * 24]
            fo, seq, exp, det, flags, _, mjd, ra, dec, pa, half = struct.unpack("<HHBBBBfffhh", raw)
            folder = meta["folders"][fo]
            week, ver = folder.split("/")[2], folder.split("/")[3]
            obs = f"{week}_{seq:04d}_{exp}"
            yield raw, ra, dec, det, f"{sx.BUCKET}{folder}/{det}/level2_{obs}D{det}_spx_{ver}.fits"


def parse(buf: bytes):
    h0 = None
    for i in range(0, len(buf), 80):
        if buf[i:i + 8] == b"END     ":
            h0 = (i // BLOCK + 1) * BLOCK
            break
    if h0 is None:
        return None
    for i in range(h0, len(buf), 80):
        if buf[i:i + 8] == b"END     ":
            hi_len = (i - h0) // BLOCK * BLOCK + BLOCK
            return h0, fits.Header.fromstring(buf[h0:h0 + hi_len].decode("ascii")), hi_len
    return None


async def one(s: aiohttp.ClientSession, url: str, sem: asyncio.Semaphore):
    async with sem:
        for attempt in range(6):
            try:
                async with s.get(url, headers={"Range": f"bytes=0-{12 * BLOCK - 1}"}) as r:
                    buf = await r.read()
                got = parse(buf)
                if got is None:
                    async with s.get(url, headers={"Range": f"bytes=0-{32 * BLOCK - 1}"}) as r:
                        buf = await r.read()
                    got = parse(buf)
                h0, h, hl = got
                img_off = h0 + hl
                flags_off = img_off + sx.data_bytes(h)
                async with s.get(url, headers={"Range": f"bytes={flags_off}-{flags_off + 8 * BLOCK - 1}"}) as r:
                    fb = await r.read()
                fblocks = next((i // BLOCK + 1 for i in range(0, len(fb), 80) if fb[i:i + 8] == b"END     "), 0)
                return h, img_off, fblocks
            except Exception:  # noqa: BLE001
                await asyncio.sleep(0.5 * (attempt + 1))
        return None


def record(raw: bytes, h: fits.Header, img_off: int, fblocks: int) -> bytes:
    c1, c2 = h.get("CDELT1", 1.0), h.get("CDELT2", 1.0)
    if "CD1_1" in h:
        pc = [h["CD1_1"], h.get("CD1_2", 0.0), h.get("CD2_1", 0.0), h["CD2_2"]]
    else:
        pc = [c1 * h.get("PC1_1", 1.0), c1 * h.get("PC1_2", 0.0), c2 * h.get("PC2_1", 0.0), c2 * h.get("PC2_2", 1.0)]
    ap = [float(h.get(f"A_{p}_{q}", 0.0)) for p, q in SIP_TERMS]
    bp = [float(h.get(f"B_{p}_{q}", 0.0)) for p, q in SIP_TERMS]
    return RECORD.pack(raw, h["CRVAL1"], h["CRVAL2"], h["CRPIX1"], h["CRPIX2"], *pc, *ap, *bp,
                       img_off, fblocks, int(h.get("A_ORDER", 0)))


async def main_async(out: Path, limit: int, conc: int):
    rows = list(read_basic())
    if limit:
        rows = rows[:limit]
    print(f"{len(rows)} photos", file=sys.stderr)
    tiles: dict[tuple[int, int], list[bytes]] = {}
    failed = 0
    t0 = time.time()
    sem = asyncio.Semaphore(conc)
    conn = aiohttp.TCPConnector(limit=conc, ttl_dns_cache=600)
    async with aiohttp.ClientSession(connector=conn, timeout=aiohttp.ClientTimeout(total=60)) as s:
        for start in range(0, len(rows), 20000):
            chunk = rows[start:start + 20000]
            got = await asyncio.gather(*(one(s, url, sem) for _, _, _, _, url in chunk))
            for (raw, ra, dec, det, url), g in zip(chunk, got):
                if g is None:
                    failed += 1
                    continue
                tiles.setdefault(tile_of(ra, dec), []).append(record(raw, *g))
            done = start + len(chunk)
            print(f"  {done}/{len(rows)}  {time.time() - t0:.0f}s  failed {failed}", file=sys.stderr, flush=True)
    (out / "t").mkdir(parents=True, exist_ok=True)
    n = 0
    for (k, b), recs in tiles.items():
        (out / "t" / f"{k}_{b}.bin").write_bytes(b"PXX1" + struct.pack("<I", len(recs)) + b"".join(recs))
        n += len(recs)
    # The colour tables, once per detector and release (Physics: key them by release; QR2 and DR1
    # differ by 0.0064 um in D5/D6, so a future release may too). Also records whether DR1 and
    # QR3 are identical here.
    same = {}
    async with aiohttp.ClientSession() as s:
        rd = sx.RangeReader(s)
        for d in range(1, 7):
            tabs = {}
            for rel in ("dr1", "qr3"):
                url = next((u for _, _, _, det, u in rows if det == d and f"/{rel}/" in u), None)
                if url is None:
                    continue
                t = await sx.read_wave(rd, url)
                tabs[rel] = t
                (out / f"wave_{rel}_d{d}.json").write_text(json.dumps(dict(
                    detector=d, release=rel.upper(), source=url, x=t["x"].tolist(), y=t["y"].tolist(),
                    values_um=np.round(t["vals"], 6).tolist(),
                    layout="values_um[y][x] = [wavelength, bandwidth]; x, y are 1-based FITS pixels")))
            if len(tabs) == 2:
                same[d] = bool(np.array_equal(tabs["dr1"]["vals"], tabs["qr3"]["vals"]))
    basic = json.loads((BASE / "index.json").read_text())
    (out / "index.json").write_text(json.dumps(dict(
        format="planetes-exactindex/2", release="dr1qr3", recordBytes=RECORD.size,
        recordStruct=RECORD.format, sipKind="forward",
        recordLayout=__doc__.split("Output:")[1].split("Plus")[0].strip(),
        sipTerms=SIP_TERMS, bandDeg=BAND_DEG, bins=[bins_in_band(k) for k in range(int(180 / BAND_DEG))],
        maxHalfDeg=basic["maxHalfDeg"], folders=basic["folders"], photos=n, failed=failed,
        waveTables="wave_<release>_d<detector>.json", waveSameDr1Qr3=same,
        built=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())), separators=(",", ":")))
    print(json.dumps(dict(photos=n, failed=failed, tiles=len(tiles), seconds=round(time.time() - t0))), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(BASE.parent / "dr1qr3x"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--conc", type=int, default=256)
    a = ap.parse_args()
    asyncio.run(main_async(Path(a.out), a.limit, a.conc))


if __name__ == "__main__":
    main()
