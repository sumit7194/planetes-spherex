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
# Batch jobs that never re-read a box go straight to the helper (no edge cache to fill), which
# also keeps them to one Worker request per box.
DIRECT = "https://planetes-live.planetes.workers.dev"
BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
UA = {"User-Agent": "planetes-pipeline/1 (Space Apps 2026)"}


def s3_key(url: str) -> str:
    return url.split(".amazonaws.com/", 1)[1] if ".amazonaws.com/" in url else url


def decode(buf: bytes) -> dict:
    """A 'PLN1' answer: JSON head, then float32 image and int32 flags (row 0 = y0); 'PLN2' adds
    float32 variance and zodi."""
    if buf[:4] not in (b"PLN1", b"PLN2"):
        raise ValueError("not a native box")
    j = struct.unpack("<I", buf[4:8])[0]
    m = json.loads(buf[8:8 + j])
    n = m["w"] * m["h"]
    shape = (m["h"], m["w"])
    img = np.frombuffer(buf, "<f4", n, 8 + j).reshape(shape).astype(np.float32)
    fl = np.frombuffer(buf, "<i4", n, 8 + j + 4 * n).reshape(shape).astype(np.int64)
    out = dict(meta=m, img=img, fl=fl)
    if buf[:4] == b"PLN2":
        out["variance"] = np.frombuffer(buf, "<f4", n, 8 + j + 8 * n).reshape(shape).astype(np.float32)
        out["zodi"] = np.frombuffer(buf, "<f4", n, 8 + j + 12 * n).reshape(shape).astype(np.float32)
    return out


async def native(s: aiohttp.ClientSession, row: dict, ra: float, dec: float, half: int,
                 extra: bool = False) -> dict | None:
    """One box, as spherex.read_box returns it (plus lam, bw, wcs_hdr); None when off the photo.
    With extra: also variance, zodi, primary_hdr, flags_hdr and psf_sha256 (for injection)."""
    q = dict(key=s3_key(row["url"]), ra=f"{ra:.6f}", dec=f"{dec:.6f}", half=str(half), mjd=str(row.get("t", 0)))
    if extra:
        q["extra"] = "1"
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
    e = dict(row, img=d["img"], fl=d["fl"], bits=m["bits"], x0=m["x0"], y0=m["y0"], xt=m["xt"], yt=m["yt"],
             mjd=float(m["mjd"]), bunit="", lam=float(m["lambdaUm"]), bw=float(m["bandwidthUm"]),
             wcs_hdr=m["header"])
    if "variance" in d:
        e.update(variance=d["variance"], zodi=d["zodi"], primary_hdr=m["primaryHeader"],
                 flags_hdr=m["flagsHeader"], psf_sha256=m["psfHeaderSha256"])
    return e


async def psf(s: aiohttp.ClientSession, key: str) -> dict:
    """One file's EPSF extension, exactly as stored: {hdu_bytes, header_sha256, version}. One per
    detector and pipeline version (Physics, 14 Nov); compare each photo's psf_sha256 to it."""
    async with s.get(f"{HELPER}/v1/psf", params=dict(key=s3_key(key)), headers=UA) as r:
        r.raise_for_status()
        buf = await r.read()
    if buf[:4] != b"PLP1":
        raise ValueError("not a PSF answer")
    j = struct.unpack("<I", buf[4:8])[0]
    m = json.loads(buf[8:8 + j])
    return dict(hdu_bytes=buf[8 + j:], header_sha256=m["headerSha256"], version=m["version"])


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


def row_for_key(key: str) -> dict:
    """A search-row stand-in for one bucket key (when IRSA's image search is down)."""
    name = key.rsplit("/", 1)[1]
    core = name[len("level2_"): name.index("_spx")]  # e.g. 2026W21_2A_0001_2D2
    return dict(url=BUCKET + key, obs_id=core[:-2], det=int(core[-1]), t=0)


async def check_extra(keys: list[str] | None = None):
    """VARIANCE, ZODI and the EPSF extension through the helper against direct S3 reads, on a DR1
    exposure, a QR3 exposure and one near a detector edge (Physics' rule before any injection).
    With keys: those bucket photos, at their centres (no IRSA search needed)."""
    import hashlib
    import spherex as sx
    from astropy.io import fits
    from astropy.wcs import WCS as _WCS
    picks = []
    if keys:
        async with aiohttp.ClientSession() as s:
            rd = sx.RangeReader(s)
            for k in keys:
                r = row_for_key(k)
                _, l0 = await rd.header(r["url"], 0, guess=2)
                hi, _ = await rd.header(r["url"], l0, guess=30)
                ra, dec = (float(v) for v in _WCS(hi).pixel_to_world_values(hi["NAXIS1"] / 2, hi["NAXIS2"] / 2))
                picks.append((k.split("/", 1)[0].upper(), r, ra, dec))
        dr1 = picks[0][1]
    else:
        t = bp.load_targets()["w0855"]
        rows = sx.search(t["ra"], t["dec"])
        dr1 = next(r for r in rows if "/dr1/" in r["url"] or "dr1/" in s3_key(r["url"])[:4])
        qr3 = next((r for r in rows if s3_key(r["url"]).startswith("qr3/")), None)
        picks = [("DR1", dr1, t["ra"], t["dec"])]
        if qr3:
            picks.append(("QR3", qr3, t["ra"], t["dec"]))
    async with aiohttp.ClientSession() as s:
        rd = sx.RangeReader(s)
        # A detector edge: a position 30 px inside the first photo's corner (box clipped by the edge).
        h0, l0 = await rd.header(dr1["url"], 0, guess=2)
        hi, li = await rd.header(dr1["url"], l0, guess=30)
        from astropy.wcs import WCS
        ra_e, dec_e = (float(v) for v in WCS(hi).pixel_to_world_values(8, 8))
        picks.append(("edge", dr1, ra_e, dec_e))
        for name, r, ra, dec in picks:
            b = await native(s, r, ra, dec, 20, extra=True)
            a = await sx.read_box(rd, r, ra, dec, 20)
            url = r["url"]
            # Walk the HDUs directly: IMAGE, FLAGS, VARIANCE, ZODI, EPSF.
            off = 0
            hdus = {}
            for _ in range(6):
                h, ln = await rd.header(url, off, guess=4)
                hdus[h.get("EXTNAME", "PRIMARY")] = (off, h, ln)
                off += ln + sx.data_bytes(h)
            nx = hdus["IMAGE"][1]["NAXIS1"]
            y0, y1 = a["y0"], a["y0"] + a["img"].shape[0]
            x0, x1 = a["x0"], a["x0"] + a["img"].shape[1]
            def rows_of(ext):
                o, h, ln = hdus[ext]
                return o + ln
            got = {}
            for ext in ("VARIANCE", "ZODI"):
                o = rows_of(ext)
                raw = await rd.get(url, o + y0 * nx * 4, o + y1 * nx * 4 - 1)
                got[ext] = np.frombuffer(raw, ">f4").reshape(y1 - y0, nx)[:, x0:x1].astype(np.float32)
            po, ph, pl = hdus["EPSF"]
            psf_direct = await rd.get(url, po, po + pl + sx.data_bytes(ph) - 1)
            p = await psf(s, r["url"])
            direct_sha = hashlib.sha256(psf_direct[:pl]).hexdigest()
            print(name, r["obs_id"], r["det"], "box", a["img"].shape,
                  "| image", np.array_equal(a["img"], b["img"], equal_nan=True),
                  "flags", np.array_equal(a["fl"].astype(np.int64), b["fl"]),
                  "variance", np.array_equal(got["VARIANCE"], b["variance"], equal_nan=True),
                  "zodi", np.array_equal(got["ZODI"], b["zodi"], equal_nan=True),
                  "| psf bytes", p["hdu_bytes"] == psf_direct,
                  "psf sha (photo/route/direct)", b["psf_sha256"][:10], p["header_sha256"][:10], direct_sha[:10],
                  "version", p["version"], fits.Header.fromstring(b["primary_hdr"]).get("VERSION"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--check-extra", action="store_true")
    ap.add_argument("--keys", nargs="*", help="bucket keys for --check-extra (no IRSA search)")
    a = ap.parse_args()
    if a.check:
        asyncio.run(check())
    if a.check_extra:
        asyncio.run(check_extra(a.keys))
