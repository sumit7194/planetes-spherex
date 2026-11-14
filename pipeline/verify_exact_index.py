"""Check the exact sky index (queue item 2) against the real files, as Physics asked (14 Nov):

1. For a random sample of photos, the compact record vs astropy's WCS(full IMAGE header) on a
   grid of points across the whole detector: keep the record only if max |dpx| < 0.01 px.
   Two record recipes are tested: the reverse SIP polynomial alone (AP/BP), and, when the record
   carries the forward polynomial (A/B), the exact solve the browser reader now uses.
2. The stored IMAGE data offset and FLAGS header length match the file.
3. No other distortion tables (CPDIS, D2IM, DP, DQ, TPV) in the headers.

Usage: python verify_exact_index.py <exactindex dir> [--n 1500] [--conc 64]
"""

from __future__ import annotations

import argparse
import asyncio
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

import spherex as sx

BLOCK = 2880
DISTORTION = ("CPDIS", "D2IM", "DP1", "DP2", "DQ1", "DQ2", "PV1_", "PV2_")


def load(root: Path):
    meta = json.loads((root / "index.json").read_text())
    rec = meta["recordBytes"]
    rows = []
    for f in sorted((root / "t").glob("*.bin")):
        b = f.read_bytes()
        n = struct.unpack("<I", b[4:8])[0]
        for i in range(n):
            rows.append(b[8 + i * rec: 8 + (i + 1) * rec])
    return meta, rows


def decode(meta, raw: bytes) -> dict:
    fo, seq, exp, det, flags, _, mjd, ra, dec, pa, half = struct.unpack("<HHBBBBfffhh", raw[:24])
    folder = meta["folders"][fo]
    week, ver = folder.split("/")[2], folder.split("/")[3]
    obs = f"{week}_{seq:04d}_{exp}"
    url = f"{sx.BUCKET}{folder.strip('/')}/{det}/level2_{obs}D{det}_spx_{ver}.fits"
    fmt = meta.get("recordStruct", "<24sddffffff20fIHBx")
    vals = struct.unpack(fmt, raw)
    crval = vals[1:3]
    crpix = vals[3:5]
    pc = vals[5:9]
    poly = vals[9:29]
    img_off, fblocks, order = vals[29], vals[30], vals[31]
    kind = meta.get("sipKind", "reverse")  # what the 20 polynomial numbers are
    return dict(url=url, det=det, crval=crval, crpix=crpix, pc=pc, p1=poly[:10], p2=poly[10:],
                img_off=img_off, fblocks=fblocks, order=order, kind=kind)


def record_to_pixel(r: dict, terms, ra, dec):
    """0-based pixels of sky positions from the compact record alone (the browser's recipe)."""
    a = np.radians(ra - r["crval"][0])
    d = np.radians(dec)
    d0 = math.radians(r["crval"][1])
    cosc = math.sin(d0) * np.sin(d) + math.cos(d0) * np.cos(d) * np.cos(a)
    xi = np.degrees(np.cos(d) * np.sin(a) / cosc)
    eta = np.degrees((math.cos(d0) * np.sin(d) - math.sin(d0) * np.cos(d) * np.cos(a)) / cosc)
    p11, p12, p21, p22 = r["pc"]
    det = p11 * p22 - p12 * p21
    U = (p22 * xi - p12 * eta) / det
    V = (-p21 * xi + p11 * eta) / det

    def poly(c, u, v):
        return sum(ci * u**p * v**q for ci, (p, q) in zip(c, terms))

    if r["kind"] == "reverse":
        u = U + poly(r["p1"], U, V)
        v = V + poly(r["p2"], U, V)
    else:  # forward A/B: solve u + A(u, v) = U by fixed-point steps, as the reader does
        u, v = U.copy(), V.copy()
        for _ in range(12):
            u, v = U - poly(r["p1"], u, v), V - poly(r["p2"], u, v)
    return u + r["crpix"][0] - 1, v + r["crpix"][1] - 1


async def fetch(s, sem, r):
    async with sem:
        for attempt in range(5):
            try:
                async with s.get(r["url"], headers={"Range": f"bytes=0-{12 * BLOCK - 1}"}) as resp:
                    buf = await resp.read()
                i = buf.index(b"XTENSION")
                e = i
                while buf[e:e + 8] != b"END     ":
                    e += 80
                    if e >= len(buf):
                        raise ValueError("IMAGE header longer than 12 blocks")
                hl = (e - i) // BLOCK * BLOCK + BLOCK
                h = fits.Header.fromstring(buf[i:i + hl].decode("ascii"))
                img_off = i + hl
                foff = img_off + sx.data_bytes(h)
                async with s.get(r["url"], headers={"Range": f"bytes={foff}-{foff + 8 * BLOCK - 1}"}) as resp:
                    fb = await resp.read()
                fblocks = next(k // BLOCK + 1 for k in range(0, len(fb), 80) if fb[k:k + 8] == b"END     ")
                return h, img_off, fblocks
            except Exception:  # noqa: BLE001
                await asyncio.sleep(0.5 * (attempt + 1))
        return None


async def main_async(root: Path, n: int, conc: int):
    meta, rows = load(root)
    terms = [tuple(t) for t in meta["sipTerms"]]
    random.seed(20261114)
    sample = [decode(meta, raw) for raw in random.sample(rows, min(n, len(rows)))]
    print(f"{len(rows)} records; checking {len(sample)}", file=sys.stderr)
    sem = asyncio.Semaphore(conc)
    async with aiohttp.ClientSession() as s:
        got = await asyncio.gather(*(fetch(s, sem, r) for r in sample))
    g = np.linspace(0, 2039, 9)
    gx, gy = np.meshgrid(g, g)
    worst, by_det, bad_off, bad_fb, dist, failed, fwd = [], {}, 0, 0, set(), 0, []
    for r, x in zip(sample, got):
        if x is None:
            failed += 1
            continue
        h, img_off, fblocks = x
        w = WCS(h)
        ra, dec = w.all_pix2world(gx, gy, 0)
        tx, ty = w.all_world2pix(ra, dec, 0, tolerance=1e-10, maxiter=100)
        px, py = record_to_pixel(r, terms, ra, dec)
        err = float(np.max(np.hypot(px - tx, py - ty)))
        worst.append((err, r["url"]))
        # The same record with the forward A/B instead (what a rebuilt index would carry).
        fw = dict(r, kind="forward", p1=[float(h.get(f"A_{p}_{q}", 0.0)) for p, q in terms],
                  p2=[float(h.get(f"B_{p}_{q}", 0.0)) for p, q in terms])
        fx, fy = record_to_pixel(fw, terms, ra, dec)
        fwd.append(float(np.max(np.hypot(fx - tx, fy - ty))))
        by_det.setdefault(r["det"], []).append(err)
        bad_off += img_off != r["img_off"]
        bad_fb += fblocks != r["fblocks"]
        dist |= {k for k in h if k.startswith(DISTORTION) and not k.endswith("W")}
    errs = np.array([e for e, _ in worst])
    out = dict(
        records=len(rows), checked=len(errs), fetchFailed=failed, sipKind=sample[0]["kind"],
        maxDpx=float(errs.max()), p99Dpx=float(np.percentile(errs, 99)), medianDpx=float(np.median(errs)),
        over001=int((errs >= 0.01).sum()),
        forwardABIfStored=dict(max=float(max(fwd)), median=float(np.median(fwd))),
        byDetector={d: dict(n=len(v), max=float(max(v)), median=float(np.median(v))) for d, v in sorted(by_det.items())},
        imageOffsetMismatch=int(bad_off), flagsHeaderMismatch=int(bad_fb), distortionKeys=sorted(dist),
        worst=[dict(dpx=e, url=u) for e, u in sorted(worst, reverse=True)[:5]],
    )
    print(json.dumps(out, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--n", type=int, default=1500)
    ap.add_argument("--conc", type=int, default=64)
    a = ap.parse_args()
    asyncio.run(main_async(Path(a.root), a.n, a.conc))


if __name__ == "__main__":
    main()
