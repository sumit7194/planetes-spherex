"""G3 (15 Nov 2026): keep our sky index (public/data/index/dr1qr3) up to date as NASA adds photos,
without depending on IRSA's services (its TAP was down all night on 14-15 Nov).

New photos are found by listing NASA's bucket (the same listing as build_index.py), and each new
photo's record is made from its own file: the first 12 FITS blocks hold the primary and IMAGE
headers (the WCS gives the footprint's corners; MJD-BEG is ObsCore's t_min; SPS_FLAGS says
all_sky / deep_north / deep_south). Records use the same 24-byte format and tiles as build_index.py.
A photo NASA has reprocessed (a newer version folder) gets its record rebuilt.

Before anything is written: the recipe is re-checked against records made from IRSA's footprints
(a fixed draw, for regression, and a draw seeded by the date, so a quiet failure shows up), and
every new record passes sanity checks. Any failure stops the run and writes nothing.

Usage: python update_index.py --check 50     (the two re-check draws, 50 each)
       python update_index.py                (report only)
       python update_index.py --write        (report, then add or update records)
Writes update_index_report.json and update_index_summary.md (sentences for a person, for the
GitHub Action's run summary).
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import glob
import json
import math
import random
import re
import struct
import sys
from pathlib import Path

import aiohttp
from astropy.io import fits
from astropy.wcs import WCS

import build_index as bi

HERE = Path(__file__).parent
BASE = bi.OUT
BLOCK = 2880
NAXIS = 2040
REPORT = HERE / "update_index_report.json"
SUMMARY = HERE / "update_index_summary.md"
REC = struct.Struct("<HHBBBBfffhh")
MAX_PER_RUN = 200_000
# Seen in the files (15 Nov, 600+ photos), each matching IRSA's deep collections; any other value stops the run.
SPS_DEEP = {"deep_north": True, "deep_south": True, "all_sky": False, "special": False}
# Release folders in the bucket we deliberately don't index (IRSA: QR3 and DR1 supersede QR2).
SKIPPED = {"qr2/": "QR2, superseded by QR3 and DR1"}
# Products made from the same photo list that this job doesn't rebuild (yet), said plainly.
NOT_REBUILT = "the sky coverage map and the survey line on the home page (built 13 Nov 2026)"


class Stop(Exception):
    """A check failed: nothing is written."""


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


def processed(folder: str) -> tuple[int, int]:
    """A version folder's processing date (l2b-v27-2026-196, l2b_retry-v27-2026-261 → (2026, 261))."""
    m = re.search(r"-(\d{4})-(\d{3})$", folder)
    return (int(m[1]), int(m[2])) if m else (0, 0)


def week_start(folder: str) -> float:
    """MJD of the Monday of the folder's ISO week (2025W17_4B → 2025 week 17)."""
    m = re.match(r"(\d{4})W(\d{2})_", folder.split("/")[2])
    d = dt.date.fromisocalendar(int(m[1]), int(m[2]), 1)
    return (d - dt.date(1858, 11, 17)).days


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
    sps = str(hi.get("SPS_FLAGS", h0.get("SPS_FLAGS", ""))).strip()
    if sps not in SPS_DEEP:
        raise Stop(f"{obs}D{det}: SPS_FLAGS is {sps!r}, not one we know ({", ".join(SPS_DEEP)})")
    flags = (1 if folder.startswith("qr3/") else 0) | (2 if SPS_DEEP[sps] else 0)
    return (0, int(m["seq"]), int(m["exp"]), det, flags, 0, float(hi.get("MJD-BEG", h0.get("MJD-BEG"))),
            cra, cdec, round(pa * 100), round(half * 1000))


def sane(folder: str, obs: str, det: int, rec: tuple, hi: fits.Header, half_range: tuple[int, int]) -> None:
    """Cheap checks on a new record before it's written (Viewer, 15 Nov); a failure stops the run."""
    lo, hi_half = half_range
    if not (lo - 5 <= rec[10] <= hi_half + 5):
        raise Stop(f"{obs}D{det}: half-diagonal {rec[10] / 1000:.3f}° outside the index's {lo / 1000:.3f}–{hi_half / 1000:.3f}°")
    ws = week_start(folder)
    if not (ws - 1 <= rec[6] <= ws + 8):
        raise Stop(f"{obs}D{det}: MJD-BEG {rec[6]:.2f} isn't in its folder's week (starts {ws})")
    crval = (float(hi["CRVAL1"]), float(hi["CRVAL2"]))
    if sep_deg(rec[7], rec[8], *crval) > 0.1:
        raise Stop(f"{obs}D{det}: footprint centre {sep_deg(rec[7], rec[8], *crval):.3f}° from CRVAL")


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


async def recheck(meta: dict, tiles: dict, n: int) -> dict:
    """Records rebuilt from their files vs the index's (IRSA ObsCore): a fixed draw (regression)
    and one seeded by today's date (so each run looks at different photos)."""
    allr = [r for rs in tiles.values() for r in rs]
    today = dt.date.today().isoformat()
    sample = random.Random(15).sample(allr, n) + random.Random(today).sample(allr, n)
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
    ok = (worst["centre_arcsec"] < 1 and worst["half_deg"] <= 0.001 and worst["mjd_s"] < 1
          and worst["flags_differ"] == 0 and worst["pa_mod90_deg"] < 0.1)
    return dict(checked=2 * n, seeds=["fixed", today], ok=ok, worst=worst)


async def run(write: bool, check_n: int) -> None:
    meta, tiles = load_index()
    report: dict = dict(checked_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                        index_updated=meta.get("updated") or meta.get("built"), not_rebuilt=NOT_REBUILT)
    lines: list[str] = []
    try:
        if check_n:
            rc = await recheck(meta, tiles, check_n)
            report["recheck"] = rc
            if not rc["ok"]:
                raise Stop(f"records made from the files don't match IRSA's (worst centre "
                           f"{rc['worst']['centre_arcsec']:.2f}″, flags differing {rc['worst']['flags_differ']})")
        where: dict[tuple, tuple[str, int]] = {}
        for name, rs in tiles.items():
            for i, r in enumerate(rs):
                where[key_of(meta["folders"][r[0]], r[1], r[2], r[3])] = (name, i)
        listing = await bi.list_all(newest=processed)  # (obs, det) -> folder, newest version kept
        new = {k: v for k, v in listing.items() if k not in where}
        reproc = {k: v for k, v in listing.items()
                  if k in where and v != meta["folders"][tiles[where[k][0]][where[k][1]][0]]}
        gone = sorted(set(where) - set(listing))
        async with aiohttp.ClientSession() as s:
            _, top = await bi.list_prefix(s, "", "/")
        indexed = {f.split("/")[0] + "/" for f in meta["folders"]}
        others = sorted(p for p in top if p not in indexed and p not in SKIPPED)
        todo = sorted(new.items())[:MAX_PER_RUN] + sorted(reproc.items())
        report.update(indexed_photos=len(where), new_photos=len(new), reprocessed=len(reproc),
                      missing_from_bucket=len(gone), missing_examples=[f"{o}D{d}" for o, d in gone[:5]],
                      new_weeks=sorted({v.split("/")[0] + ":" + v.split("/")[2] for v in new.values()}),
                      releases_not_indexed=others, skipped_on_purpose=SKIPPED,
                      deferred=max(0, len(new) - MAX_PER_RUN))
        if write and todo:
            half_range = (min(r[10] for rs in tiles.values() for r in rs), max(r[10] for rs in tiles.values() for r in rs))
            async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=32),
                                             timeout=aiohttp.ClientTimeout(total=60)) as s:
                sem = asyncio.Semaphore(32)

                async def one(k, folder):
                    obs, det = k
                    async with sem:
                        h0, hi = await read_headers(s, url_of(folder, obs, det))
                    rec = record_from(folder, obs, det, h0, hi)
                    sane(folder, obs, det, rec, hi, half_range)
                    return k, folder, rec

                made = await asyncio.gather(*(one(k, f) for k, f in todo))
            folders = list(meta["folders"])
            for k, folder, rec in made:
                if folder not in folders:
                    folders.append(folder)
                rec = (folders.index(folder),) + rec[1:]
                if k in where:  # reprocessed: drop the old record first
                    name, i = where[k]
                    tiles[name][i] = None  # type: ignore[call-overload]
                t, b = bi.tile_of(rec[7], rec[8])
                tiles.setdefault(f"{t}_{b}", []).append(rec)
                meta["maxHalfDeg"] = max(meta["maxHalfDeg"], rec[10] / 1000)
            if len(folders) > 65535:
                raise Stop("too many folders for the index's u16 folder field")
            # Order inside a tile doesn't matter: readers test every record's footprint
            # (src/data/live/dr1qr3.ts parseTile + footprintHolds; pipeline/sky_index.py).
            for name, rs in tiles.items():
                rs = [r for r in rs if r is not None]
                buf = struct.pack("<II", 0x31455850, len(rs)) + b"".join(REC.pack(*r) for r in rs)
                (BASE / "t" / f"{name}.bin").write_bytes(buf)
                tiles[name] = rs
            meta["folders"] = folders
            meta["photos"] = sum(len(rs) for rs in tiles.values())
            meta["tiles"] = len(tiles)
            meta["updated"] = report["checked_at"]
            meta["source"] = (meta["source"].split(";")[0] +
                              "; later photos added from their own headers by pipeline/update_index.py")
            (BASE / "index.json").write_text(json.dumps(meta, separators=(",", ":")))
            report["written"] = dict(added=sum(1 for k, _, _ in made if k not in where),
                                     updated=sum(1 for k, _, _ in made if k in where), photos_now=meta["photos"])
    except Stop as e:
        report["stopped"] = str(e)
    REPORT.write_text(json.dumps(report, indent=1))
    SUMMARY.write_text(summary(report))
    print(SUMMARY.read_text())
    if "stopped" in report:
        raise SystemExit(1)


def summary(r: dict) -> str:
    """The run summary, in sentences for a person (Viewer, 15 Nov); the JSON folded at the end."""
    out = ["### SPHEREx data check", ""]
    if r.get("releases_not_indexed"):
        out += [f"**A data release we don't read yet: {', '.join(r['releases_not_indexed'])}**. "
                "A person needs to add it (pipeline/build_index.py and the app's release list).", ""]
    if "stopped" in r:
        out += [f"**Stopped: {r['stopped']}.** Nothing was added. A person should look at a new photo's headers.", ""]
    rc = r.get("recheck")
    if rc and rc["ok"]:
        w = rc["worst"]
        out += [f"Recipe check: {rc['checked']} records rebuilt from their own files match IRSA's "
                f"(worst centre {w['centre_arcsec']:.2f}″, times equal, flags {rc['checked']}/{rc['checked']}).", ""]
    if "new_photos" in r:
        wr = r.get("written")
        if r["new_photos"] or r.get("reprocessed"):
            weeks = ", ".join(r["new_weeks"][:6]) + ("…" if len(r["new_weeks"]) > 6 else "")
            out += [f"**{r['new_photos']:,} new SPHEREx photos**" + (f" ({weeks})" if weeks else "") +
                    (f", added to our sky index; it now holds {wr['photos_now']:,}." if wr else "."),
                    f"{r.get('reprocessed', 0):,} reprocessed by NASA (records updated)." if r.get("reprocessed") else "",
                    f"Partial: {r['deferred']:,} more next run." if r.get("deferred") else "",
                    "**Review and merge** with the link below. Nothing is live until a person merges; "
                    "this replaces any earlier unmerged update, which it includes.", ""]
        else:
            out += [f"No new photos since {r.get('index_updated')}. Nothing to merge. "
                    f"Checked {r['indexed_photos']:,} photos against NASA's bucket.", ""]
        if r.get("missing_from_bucket"):
            out += [f"**{r['missing_from_bucket']:,} photos are no longer in NASA's bucket** (left in the index; "
                    f"live looks will fail on them), e.g. {', '.join(r['missing_examples'])}.", ""]
        if r.get("skipped_on_purpose"):
            out += ["Not indexed on purpose: " + "; ".join(f"{k} ({v})" for k, v in r["skipped_on_purpose"].items()) + ".", ""]
    out += [f"Not updated by this job: {r['not_rebuilt']}.", "",
            "<details><summary>Report (JSON)</summary>", "", "```json", json.dumps(r, indent=1), "```", "", "</details>", ""]
    return "\n".join(x for x in out if x is not None)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", type=int, default=0)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    asyncio.run(run(a.write, a.check))


if __name__ == "__main__":
    sys.exit(main())
