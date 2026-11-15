"""A dwarf planet's parallax loop in SPHEREx photos (prereg/parallaxloop/PLAN.md, registered 15 Nov).

For each visit (a run of photos < 20 d apart, >= 20 photos) and detector:
  stack the photos in the object's own frame (bilinear onto a 45 x 45 px grid at 6.15", centred on
  the Horizons @399 place at each photo's MJD-AVG, moved to SPHEREx's own position), then measure
  aperture S/N and centroid at the centre, the six perpendicular controls (+-5, 10, 15 px), and the
  static-sky (Gaia G < 19) overlap. The nulls (b) heliocentric @10 track and (c) "gone later" are
  stacked the same way. Writes parallaxloop/<object>/result.json, stacks.npz and thumbnails.

Usage: python parallax_loop.py Makemake [--nulls]
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import pickle
import urllib.parse
import urllib.request
from pathlib import Path

import aiohttp
import numpy as np
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from scipy.interpolate import CubicSpline

import build_pack as bp
import catalogs
import helper_client as hc
import planetes_pack as pp
import season_pairs as sp
import sky_index as si

HERE = Path(__file__).parent
PRE = HERE.parent / "prereg" / "parallaxloop"
OUT = HERE / "parallaxloop"
CACHE = HERE / "cache" / "parallaxloop"
N = 45
C = (N - 1) / 2
PIX = 6.15
EDGE_PX = 8
AU_KM = 1.495978707e8
OBJECTS = {"Makemake": 136472, "Haumea": 136108, "Eris": 136199}
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"


# ---------- ephemeris (§3) ----------
def horizons(num: int, observer: str, start: str, stop: str) -> tuple[np.ndarray, str]:
    """(mjd, ra, dec, delta_au) rows at 30 min; the raw answer is saved with its sha256."""
    d = PRE / "ephem"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{num}_{observer.replace('@', 'at')}_{start}_{stop}.txt"
    if not f.exists():
        q = dict(format="text", COMMAND=f"'{num};'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'OBSERVER'",
                 CENTER=f"'500{observer}'", START_TIME=f"'{start}'", STOP_TIME=f"'{stop}'", STEP_SIZE="'30 m'",
                 QUANTITIES="'1,20'", ANG_FORMAT="'DEG'", CSV_FORMAT="'YES'", EXTRA_PREC="'YES'")
        url = HORIZONS + "?" + urllib.parse.urlencode(q, safe="'@")
        f.write_bytes(urllib.request.urlopen(url, timeout=120).read())
    raw = f.read_bytes()
    rows, on = [], False
    for line in raw.decode().splitlines():
        if line.startswith("$$SOE"):
            on = True
            continue
        if line.startswith("$$EOE"):
            break
        if on:
            p = [x.strip() for x in line.split(",")]
            t = Time.strptime(p[0], "%Y-%b-%d %H:%M").mjd
            rows.append((t, float(p[3]), float(p[4]), float(p[5])))
    if not rows:
        raise RuntimeError(f"Horizons gave no rows: {raw[:300]!r}")
    return np.array(rows), hashlib.sha256(raw).hexdigest()


class Track:
    def __init__(self, a: np.ndarray):
        ra = np.degrees(np.unwrap(np.radians(a[:, 1])))
        self.ra, self.dec, self.d = CubicSpline(a[:, 0], ra), CubicSpline(a[:, 0], a[:, 2]), CubicSpline(a[:, 0], a[:, 3])
        self.t0, self.t1 = a[0, 0], a[-1, 0]

    def at(self, mjd: float, sc_km: np.ndarray | None = None) -> tuple[float, float]:
        if not self.t0 <= mjd <= self.t1:
            raise ValueError(f"mjd {mjd} outside the ephemeris {self.t0}-{self.t1}")
        ra, dec, dist = float(self.ra(mjd)) % 360, float(self.dec(mjd)), float(self.d(mjd))
        if sc_km is None:
            return ra, dec
        a, d = math.radians(ra), math.radians(dec)
        v = np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]) * dist * AU_KM - sc_km
        return math.degrees(math.atan2(v[1], v[0])) % 360, math.degrees(math.asin(v[2] / np.linalg.norm(v)))


def sep_arcsec(a, b) -> float:
    r1, d1, r2, d2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(r1 - r2)
    return math.degrees(math.acos(min(1.0, c))) * 3600


# ---------- photos (§2) ----------
def coverage(track_daily: np.ndarray, track: Track | None = None) -> list[dict]:
    """Index photos whose footprint holds the place at the photo's own time (margin 0)."""
    hits: dict[str, dict] = {}
    t, ra, de = track_daily[:, 0], track_daily[:, 1], track_daily[:, 2]
    rau = np.degrees(np.unwrap(np.radians(ra)))
    for k in range(len(t)):
        for r in si.search(ra[k], de[k], margin_deg=-0.1):
            if abs(r["t"] - t[k]) > 0.5 or r["obs_id"] in hits:
                continue
            rt, dt = float(np.interp(r["t"], t, rau)) % 360, float(np.interp(r["t"], t, de))
            if any(q["obs_id"] == r["obs_id"] for q in si.search(rt, dt, 0.0)):
                hits[r["obs_id"]] = r
    return sorted(hits.values(), key=lambda r: r["t"])


def visits(rows: list[dict]) -> list[list[dict]]:
    g: list[list[dict]] = []
    for r in rows:
        if g and r["t"] - g[-1][-1]["t"] < 20:
            g[-1].append(r)
        else:
            g.append([r])
    return [v for v in g if len(v) >= 20]


async def read_boxes(jobs: list[tuple[dict, float, float]], conc=16) -> list[dict | None]:
    """Native boxes (extra=1) at each (row, ra, dec); cached by key and position."""
    CACHE.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(conc)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as s:
        async def one(r, ra, dec):
            f = CACHE / (hashlib.sha1(f"{r['url']}|{ra:.5f}|{dec:.5f}".encode()).hexdigest() + ".pkl")
            if f.exists():
                return pickle.loads(f.read_bytes())  # our own cache, written only by this script
            async with sem:
                try:
                    e = await hc.native(s, r, ra, dec, 34, extra=True)
                except Exception:  # noqa: BLE001
                    return None
            f.write_bytes(pickle.dumps(e))
            return e
        return await asyncio.gather(*(one(*j) for j in jobs))


def hdr_of(e: dict) -> fits.Header:
    return fits.Header.fromstring(e["wcs_hdr"])


def mjd_avg(e: dict) -> float:
    for h in (hdr_of(e), fits.Header.fromstring(e["primary_hdr"])):
        if "MJD-AVG" in h:
            return float(h["MJD-AVG"])
    raise KeyError("MJD-AVG")


def sc_km(e: dict) -> np.ndarray:
    h = hdr_of(e)
    assert h.get("XYZ_SC_SYSTEM", "").strip() == "GEOCENTER", h.get("XYZ_SC_SYSTEM")
    return np.array([h["X_SC"], h["Y_SC"], h["Z_SC"]], float)


def grid_of(e: dict, ra: float, dec: float) -> tuple[np.ndarray, str | None]:
    """The photo on the 45 px grid centred on (ra, dec), FIT_REJECT as NaN; or a reason it's dropped."""
    w = WCS(hdr_of(e))
    x, y = w.world_to_pixel_values(ra, dec)
    nx, ny = w.pixel_shape
    if min(x, y, nx - 1 - x, ny - 1 - y) < EDGE_PX:
        return None, "edge"
    img, fl = pp.resample_frame(e, w, bp.out_grid(ra, dec, N), N)
    img = np.where((fl & pp.REJ) != 0, np.nan, img)
    if np.isfinite(img).mean() < 0.5:
        return None, "blank"
    return img, None


# ---------- measure (§5) ----------
YY, XX = np.mgrid[0:N, 0:N]


def ap_sum(st: np.ndarray, x: float, y: float) -> float:
    r = np.hypot(XX - x, YY - y)
    ann = st[(r >= 6) & (r <= 9)]
    bg = np.nanmedian(ann) if np.isfinite(ann).any() else 0.0
    ap = st[r <= 2]
    return float(np.nansum(ap - bg)) if np.isfinite(ap).sum() >= 0.8 * ap.size else float("nan")


NOISE_POS = [(C + r * math.cos(math.radians(a)), C + r * math.sin(math.radians(a))) for r in (12, 18) for a in range(0, 360, 30)]


def noise(st: np.ndarray) -> float:
    v = np.array([ap_sum(st, x, y) for x, y in NOISE_POS])
    v = v[np.isfinite(v)]
    return float(1.4826 * np.median(np.abs(v - np.median(v)))) if len(v) >= 12 else float("nan")


def measure(st: np.ndarray, perp: np.ndarray) -> dict:
    sig = noise(st)
    sn = ap_sum(st, C, C) / sig if sig > 0 else float("nan")
    c = sp.fit(st, C, C)
    off = None if c is None else [round(-(c[0] - C) * PIX, 2), round((c[1] - C) * PIX, 2)]  # east, north ″
    ctrl = {}
    for k in (-15, -10, -5, 5, 10, 15):
        x, y = C + k * perp[0], C + k * perp[1]
        ctrl[str(k)] = round(ap_sum(st, x, y) / sig, 2) if sig > 0 else None
    return dict(sn=round(sn, 2), noise=sig, centroid_offset_arcsec=off,
                centre_within_2px=bool(c is not None and math.hypot(c[0] - C, c[1] - C) <= 2), controls_sn=ctrl)


def stack(grids: list[np.ndarray]) -> np.ndarray:
    return np.nanmedian(np.stack(grids), 0)


def bootstrap(grids: list[np.ndarray], n=200, seed=15) -> list[float] | None:
    rng = np.random.default_rng(seed)
    offs = []
    for _ in range(n):
        c = sp.fit(stack([grids[i] for i in rng.integers(0, len(grids), len(grids))]), C, C)
        if c is not None:
            offs.append((-(c[0] - C) * PIX, (c[1] - C) * PIX))
    if len(offs) < n / 2:
        return None
    a = np.array(offs)
    return [round(float(a[:, 0].std()), 2), round(float(a[:, 1].std()), 2)]


def gaia_near_track(places: list[tuple[float, float, float]]) -> list[dict]:
    """Gaia G < 19 near the track: cones every <= 100″ (radius 120″)."""
    stars, seen, last = [], set(), None
    for t, ra, dec in places:
        if last is not None and sep_arcsec(last, (ra, dec)) < 100:
            continue
        last = (ra, dec)
        for s in catalogs.gaia_dr3_vizier(ra, dec, 120 / 3600, 19.0):
            k = s["id"]
            if k not in seen:
                seen.add(k)
                stars.append(s)
    return stars


def overlap_fraction(places, stars) -> float:
    if not places:
        return 0.0
    hit = 0
    for t, ra, dec in places:
        yr = catalogs.mjd_to_year(t)
        for s in stars:
            pr, pd = catalogs.propagate(s, yr)
            if sep_arcsec((pr, pd), (ra, dec)) <= 2 * PIX:
                hit += 1
                break
    return hit / len(places)


def perp_dir(places) -> np.ndarray:
    """Unit vector perpendicular to the visit's motion, in grid pixels (x east-left, y north-up)."""
    (t0, r0, d0), (t1, r1, d1) = places[0], places[-1]
    de = ((r1 - r0 + 540) % 360 - 180) * math.cos(math.radians(d0))
    dn = d1 - d0
    vx, vy = -de, dn  # grid x grows west
    n = math.hypot(vx, vy) or 1.0
    return np.array([-vy / n, vx / n])


# ---------- run ----------
def run(name: str, with_nulls: bool) -> dict:
    num = OBJECTS[name]
    odir = OUT / name
    odir.mkdir(parents=True, exist_ok=True)
    daily, _ = horizons(num, "@399", "2025-04-01", "2026-11-15")  # coverage only (30 min rows)
    rows = coverage(daily[::48])
    vs = visits(rows)
    result = dict(object=name, number=num, photo_source="our sky index (DR1 + QR3), IRSA's search down",
                  ephemeris=[], visits=[])
    thumbs = {}
    for vi, v in enumerate(vs, 1):
        start = Time(v[0]["t"] - 1, format="mjd").strftime("%Y-%m-%d")
        stop = Time(v[-1]["t"] + 2, format="mjd").strftime("%Y-%m-%d")
        a399, h399 = horizons(num, "@399", start, stop)
        a10, h10 = horizons(num, "@10", start, stop)
        result["ephemeris"] += [dict(visit=vi, observer="@399", sha256=h399), dict(visit=vi, observer="@10", sha256=h10)]
        tr, tr10 = Track(a399), Track(a10)
        jobs = [(r, *tr.at(r["t"])) for r in v]
        boxes = asyncio.run(read_boxes(jobs))
        per_det: dict[int, list] = {}
        dropped = dict(unread=0, edge=0, blank=0)
        places_by_det: dict[int, list] = {}
        arc = []
        for r, e in zip(v, boxes):
            if e is None:
                dropped["unread"] += 1
                continue
            t = mjd_avg(e)
            ra, dec = tr.at(t, sc_km(e))
            g, why = grid_of(e, ra, dec)
            if g is None:
                dropped[why] += 1
                continue
            per_det.setdefault(r["det"], []).append(g)
            places_by_det.setdefault(r["det"], []).append((t, ra, dec))
            sg = noise(g)
            arc.append(dict(t=round(t, 5), det=r["det"], ra=round(ra, 6), dec=round(dec, 6),
                            sn=round(ap_sum(g, C, C) / sg, 2) if sg > 0 else None))
        allplaces = sorted(p for ps in places_by_det.values() for p in ps)
        stars = gaia_near_track(allplaces) if allplaces else []
        vres = dict(visit=vi, first=Time(v[0]["t"], format="mjd").iso[:10], photos=len(v), dropped=dropped,
                    parallax_arcsec=None, stacks={})
        mid = allplaces[len(allplaces) // 2] if allplaces else None
        if mid:
            vres["parallax_arcsec"] = round(sep_arcsec(mid[1:], tr10.at(mid[0])), 1)
            vres["mid"] = dict(t=mid[0], ra399=mid[1], dec399=mid[2], ra10=tr10.at(mid[0])[0], dec10=tr10.at(mid[0])[1])
        for det, grids in sorted(per_det.items()):
            places = places_by_det[det]
            st = stack(grids)
            m = measure(st, perp_dir(places))
            m["n"] = len(grids)
            m["star_overlap_fraction"] = round(overlap_fraction(places, stars), 3)
            m["star_overlap"] = m["star_overlap_fraction"] > 0.20
            m["detects"] = bool(m["sn"] >= 5 and m["centre_within_2px"])
            m["controls_clean"] = all(x is not None and x < 5 for x in m["controls_sn"].values())
            m["counts"] = bool(m["detects"] and m["controls_clean"] and not m["star_overlap"])
            if m["detects"]:
                m["centroid_err_arcsec"] = bootstrap(grids)
            vres["stacks"][f"D{det}"] = m
            thumbs[f"v{vi}_D{det}"] = st.astype("<f4")
        vres["arc"] = arc
        vres["visit_detects"] = any(s["counts"] for s in vres["stacks"].values())
        if with_nulls:
            vres["null_heliocentric"] = null_helio(v, tr10)
            vres["null_gone_later"] = null_gone(v, tr, [x for x in vs if x is not v])
        result["visits"].append(vres)
        print(name, "visit", vi, vres["first"], {k: (s["n"], s["sn"], s["counts"]) for k, s in vres["stacks"].items()},
              "parallax", vres["parallax_arcsec"], flush=True)
    np.savez_compressed(odir / "stacks.npz", **thumbs)
    nd = sum(v["visit_detects"] for v in result["visits"])
    result["passes"] = bool(nd >= 2)
    result["visits_detected"] = nd
    (odir / "result.json").write_text(json.dumps(result, indent=1, default=float))
    return result


def _stack_measure(jobs_places) -> dict:
    """jobs_places: [(row, ra, dec)] read and stacked per detector at those places."""
    boxes = asyncio.run(read_boxes(jobs_places))
    per: dict[int, list] = {}
    for (r, ra, dec), e in zip(jobs_places, boxes):
        if e is None:
            continue
        g, _ = grid_of(e, ra, dec)
        if g is not None:
            per.setdefault(r["det"], []).append(g)
    out = {}
    for det, grids in sorted(per.items()):
        if len(grids) >= 3:
            st = stack(grids)
            out[f"D{det}"] = dict(n=len(grids), sn=round(ap_sum(st, C, C) / noise(st), 2))
    return out


def null_helio(v, tr10: Track) -> dict:
    """(b): photos at the same times (±0.5 d) and detector holding the @10 place."""
    jobs = []
    for r in v:
        ra, dec = tr10.at(r["t"])
        cands = [q for q in si.search(ra, dec, 0.0) if abs(q["t"] - r["t"]) <= 0.5 and q["det"] == r["det"]]
        if cands:
            q = min(cands, key=lambda q: abs(q["t"] - r["t"]))
            jobs.append((q, *tr10.at(q["t"])))
    seen, uniq = set(), []
    for j in jobs:
        if j[0]["obs_id"] not in seen:
            seen.add(j[0]["obs_id"])
            uniq.append(j)
    return dict(photos=len(uniq), stacks=_stack_measure(uniq))


def null_gone(v, tr: Track, others) -> dict:
    """(c): for each photo, another visit's photo on the same detector covering the same sky place."""
    other_ids = {r["obs_id"] for x in others for r in x}
    jobs = []
    for r in v:
        ra, dec = tr.at(r["t"])
        cands = [q for q in si.search(ra, dec, 0.0) if q["obs_id"] in other_ids and q["det"] == r["det"]]
        if cands:
            jobs.append((cands[0], ra, dec))
    if len(jobs) < 20:
        return dict(photos=len(jobs), skipped="fewer than 20 photos cover it")
    return dict(photos=len(jobs), stacks=_stack_measure(jobs))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name", choices=list(OBJECTS))
    ap.add_argument("--nulls", action="store_true")
    a = ap.parse_args()
    r = run(a.name, a.nulls)
    print(json.dumps({k: v for k, v in r.items() if k != "visits"}, indent=1))
