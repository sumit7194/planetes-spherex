"""Our own sky index (public/data/index/dr1qr3), read in Python: every DR1 + QR3 photo whose
footprint holds a position, without IRSA's image search.

The browser's live look already finds photos this way (src/data/live/dr1qr3.ts: tilesNear,
parseTile, footprintHolds; this is a line-for-line port). The index was built from IRSA's ObsCore
footprints joined with the bucket listing (1.63 M photos). The pipeline used IRSA's SIA search,
which went down on 14 Nov ~22:15 IST (HTTP 502 to every request).

`search(ra, dec)` returns rows shaped like spherex.search's: url, obs_id, det, t (MJD, float32 in
the index: ~10 minutes, plenty for passes), release, deep.
"""
from __future__ import annotations

import json
import math
import struct
from functools import lru_cache
from pathlib import Path

BASE = Path(__file__).parent.parent / "public" / "data" / "index" / "dr1qr3"
BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
RAD = math.pi / 180


@lru_cache(maxsize=1)
def meta() -> dict:
    return json.loads((BASE / "index.json").read_text())


@lru_cache(maxsize=4096)
def tile(k: int, b: int) -> tuple[dict, ...]:
    p = BASE / "t" / f"{k}_{b}.bin"
    if not p.exists():
        return ()
    buf = p.read_bytes()
    magic, n = struct.unpack_from("<II", buf, 0)
    if magic != 0x31455850 or len(buf) != 8 + n * 24:
        raise ValueError(f"sky index tile {k}_{b}: bad header")
    m = meta()
    out = []
    for i in range(n):
        folder_i, seq, exp, det, flags, _pad, mjd, ra, dec, pa, half = struct.unpack_from("<HHBBBBfffhh", buf, 8 + i * 24)
        folder = m["folders"][folder_i]
        week, version = folder.split("/")[2], folder.split("/")[3]
        obs = f"{week}_{seq:04d}_{exp}"
        out.append(dict(
            key=f"{folder}/{det}/level2_{obs}D{det}_spx_{version}.fits", obs_id=f"{obs}D{det}", det=det,
            t=mjd, release="QR3" if flags & 1 else "DR1", deep=bool(flags & 2),
            centre=(ra, dec), pa=pa / 100, half=half / 1000,
        ))
    return tuple(out)


def sep_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    s = (math.sin(a[1] * RAD) * math.sin(b[1] * RAD)
         + math.cos(a[1] * RAD) * math.cos(b[1] * RAD) * math.cos((a[0] - b[0]) * RAD))
    return math.acos(min(1.0, max(-1.0, s))) / RAD


def tiles_near(ra: float, dec: float, radius: float) -> list[tuple[int, int]]:
    m = meta()
    out = []
    for k, n in enumerate(m["bins"]):
        lo = -90 + k * m["bandDeg"]
        hi = lo + m["bandDeg"]
        if hi < dec - radius or lo > dec + radius:
            continue
        max_dec = min(89.9, max(abs(lo), abs(hi), abs(dec)))
        ra_rad = 180 if abs(dec) + radius >= 89.9 else radius / math.cos(min(89.9, max_dec + radius) * RAD)
        for b in range(n):
            r0, r1 = b / n * 360, (b + 1) / n * 360
            d = min(abs(((ra - r + 540) % 360) - 180) for r in (r0, r1, (r0 + r1) / 2))
            if n == 1 or r0 <= ra < r1 or d <= ra_rad + 360 / n:
                out.append((k, b))
    return out


def footprint_holds(p: dict, ra: float, dec: float, margin_deg: float = 0.02) -> bool:
    if sep_deg(p["centre"], (ra, dec)) > p["half"]:
        return False
    a = (ra - p["centre"][0]) * RAD
    d, d0 = dec * RAD, p["centre"][1] * RAD
    cosc = math.sin(d0) * math.sin(d) + math.cos(d0) * math.cos(d) * math.cos(a)
    xi = math.cos(d) * math.sin(a) / cosc / RAD
    eta = (math.cos(d0) * math.sin(d) - math.sin(d0) * math.cos(d) * math.cos(a)) / cosc / RAD
    t = p["pa"] * RAD
    u = xi * math.cos(t) - eta * math.sin(t)
    w = xi * math.sin(t) + eta * math.cos(t)
    half = p["half"] / math.sqrt(2) - margin_deg
    return abs(u) <= half and abs(w) <= half


def search(ra: float, dec: float, margin_deg: float = 0.02) -> list[dict]:
    """Every DR1 + QR3 photo whose footprint holds (ra, dec), in time order, as spherex.search rows.
    margin_deg: how far inside the footprint the point must be (the browser keeps 0.02°; the
    yardstick uses 0, as IRSA's search does, 14 Nov)."""
    m = meta()
    rows = []
    for k, b in tiles_near(ra, dec, m["maxHalfDeg"] + 0.05):
        for p in tile(k, b):
            if footprint_holds(p, ra, dec, margin_deg):
                rows.append(dict(url=BUCKET + p["key"], obs_id=p["obs_id"], det=p["det"], t=float(p["t"]),
                                 release=p["release"], deep=p["deep"]))
    rows.sort(key=lambda r: r["t"])
    return rows


if __name__ == "__main__":
    import sys
    ra, dec = float(sys.argv[1]), float(sys.argv[2])
    rows = search(ra, dec)
    print(len(rows), "photos;", sum(r["release"] == "QR3" for r in rows), "QR3;", rows[:1])
