"""Read SPHEREx boxes through the cloud helper (/v1/native), next to NASA's bucket, instead of from
this machine (~85 ms per S3 read there, against seconds per box from a home link).

`fetch_all_helper` is a drop-in for build_pack.fetch_all: the same per-exposure dict as
spherex.read_box (+ lam, bw, wcs_hdr, as fetch_all adds), and the same cache files, so either
path can fill or reuse the cache. `python helper_client.py --check` compares the two readers on a
few real exposures (arrays must be identical) before any job relies on the helper.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import pickle
import struct
import time
from pathlib import Path

import aiohttp
import numpy as np

import build_pack as bp

HELPER = "https://planetes-edge.planetes.workers.dev"
BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
UA = {"User-Agent": "planetes-pipeline/1 (Space Apps 2026)"}


def s3_key(url: str) -> str:
    return url.split(".amazonaws.com/", 1)[1] if ".amazonaws.com/" in url else url


def decode(buf: bytes) -> dict:
    """A 'PLN1' answer: JSON head, then float32 image and int32 flags (row 0 = y0)."""
    if buf[:4] != b"PLN1":
        raise ValueError("not a native box")
    j = struct.unpack("<I", buf[4:8])[0]
    m = json.loads(buf[8:8 + j])
    n = m["w"] * m["h"]
    img = np.frombuffer(buf, "<f4", n, 8 + j).reshape(m["h"], m["w"]).astype(np.float32)
    fl = np.frombuffer(buf, "<i4", n, 8 + j + 4 * n).reshape(m["h"], m["w"]).astype(np.int64)
    return dict(meta=m, img=img, fl=fl)


async def native(s: aiohttp.ClientSession, row: dict, ra: float, dec: float, half: int) -> dict | None:
    """One box, as spherex.read_box returns it (plus lam, bw, wcs_hdr); None when off the photo."""
    q = dict(key=s3_key(row["url"]), ra=f"{ra:.6f}", dec=f"{dec:.6f}", half=str(half), mjd=str(row.get("t", 0)))
    for attempt in range(4):
        try:
            async with s.get(f"{HELPER}/v1/native", params=q, headers=UA) as r:
                if r.status == 204:
                    return None
                if r.status == 200:
                    d = decode(await r.read())
                    break
                if r.status < 500:
                    raise RuntimeError(f"helper {r.status}: {(await r.text())[:120]}")
        except (aiohttp.ClientError, asyncio.TimeoutError):
            pass
        await asyncio.sleep(1.5 * (attempt + 1))
    else:
        raise RuntimeError("helper unreachable")
    m = d["meta"]
    return dict(row, img=d["img"], fl=d["fl"], bits=m["bits"], x0=m["x0"], y0=m["y0"], xt=m["xt"], yt=m["yt"],
                mjd=float(m["mjd"]), bunit="", lam=float(m["lambdaUm"]), bw=float(m["bandwidthUm"]),
                wcs_hdr=m["header"])


async def fetch_all_helper(rows, ra, dec, half, conc, cache: Path):
    """build_pack.fetch_all through the helper: same cache keys, same exposure dicts."""
    cache.mkdir(parents=True, exist_ok=True)
    out, todo = [], []
    for r in rows:
        p = bp.cache_path(cache, r, ra, dec, half)
        if p.exists():
            # Our own cache, written only by this pipeline on this machine (as build_pack's).
            e = pickle.loads(p.read_bytes())
            if e is not None:
                e.update({k: r[k] for k in ("pass",)})
                out.append(e)
        else:
            todo.append(r)
    bp.log(f"  {len(out)} exposures from cache, {len(todo)} via the helper")
    if not todo:
        return out, dict(requests=0)
    t0 = time.time()
    sem = asyncio.Semaphore(conc)
    done = [0]
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as s:
        async def one(r):
            async with sem:
                try:
                    e = await native(s, r, ra, dec, half)
                except Exception as ex:  # noqa: BLE001
                    bp.log("  skip", r["obs_id"], r["det"], repr(ex)[:140])
                    return None
                bp.cache_path(cache, r, ra, dec, half).write_bytes(pickle.dumps(e))
                done[0] += 1
                if done[0] % 50 == 0:
                    bp.log(f"  {done[0]}/{len(todo)}  {time.time() - t0:.0f}s")
                return e
        got = await asyncio.gather(*(one(r) for r in todo))
    out += [e for e in got if e is not None]
    return out, dict(requests=len(todo), seconds=round(time.time() - t0, 1))


async def check(n: int = 3):
    """The helper's boxes against spherex.read_box on real exposures: arrays must be identical."""
    import spherex as sx
    t = bp.load_targets()["w0855"]
    rows = sx.search(t["ra"], t["dec"])
    sx.group_passes(rows)
    picks = [rows[0], rows[len(rows) // 2], rows[-1]][:n]
    async with aiohttp.ClientSession() as s:
        rd = sx.RangeReader(s)
        for r in picks:
            a = await sx.read_box(rd, r, t["ra"], t["dec"], 20)
            tab = await sx.read_wave(rd, r["url"])
            b = await native(s, r, t["ra"], t["dec"], 20)
            lam = sx.wave_at(tab, a["xt"], a["yt"])[0]
            same_img = np.array_equal(a["img"], b["img"], equal_nan=True)
            same_fl = np.array_equal(a["fl"].astype(np.int64), b["fl"])
            print(r["obs_id"], r["det"], r["release"] if "release" in r else "", "box", (a["x0"], a["y0"]) == (b["x0"], b["y0"]),
                  "img", same_img, "flags", same_fl, "bits", a["bits"] == b["bits"],
                  f"xt {a['xt'] - b['xt']:+.2e} yt {a['yt'] - b['yt']:+.2e} lam {lam:.5f} vs {b['lam']:.5f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        asyncio.run(check())
