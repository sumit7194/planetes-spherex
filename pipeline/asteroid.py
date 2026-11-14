"""N5: a known asteroid seen moving in real SPHEREx photos (rules: prereg/asteroid/PLAN.md).

Steps (python asteroid.py <step>):
  query   SkyBoT per field and quarter-day bucket, only for fields with same-detector revisits in
          the registered window. Writes cache/asteroid_skybot.json (resumable; one query at a time).
  search  The registered tests on every candidate. Writes cache/asteroid_search.json with the
          count passing each test, and the candidates in order of V.
  confirm For the pick: SkyBoT re-queried at each photo's own time, tests re-run. Writes
          cache/asteroid_confirm.json.

Nothing here changes a rule. The window, the motion and the match radius are read from WINDOW_H,
MIN_MOVE_PX and MATCH_PX, which must match the plan's dated entries.
"""
from __future__ import annotations

import json
import math
import pickle
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
from collections import defaultdict

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

import fieldguide as fg

warnings.filterwarnings("ignore")
CACHE = fg.CACHE
PIX = fg.PIX_ARCSEC
VMAX = 18.0
MATCH_PX = 1.5
WINDOW_H = (1.0, 4.0)  # pending Physics' rule change (PLAN.md log); Viewer prefers 1-4 h
MIN_MOVE_PX = 5.0
SN_MIN, SN_GONE = 5.0, 3.0
GAIA_PX = 2.0


def skybot_cone(ra: float, dec: float, radius_deg: float, mjd: float) -> list[dict] | None:
    """Numbered and unnumbered asteroids in the cone at this time (geocentric, as the app asks).
    None if the service failed; [] if it found nothing."""
    q = urllib.parse.urlencode({"-ep": f"{mjd + 2400000.5:.5f}", "-ra": f"{ra:.6f}", "-dec": f"{dec:.6f}",
                                "-rd": f"{radius_deg:.4f}", "-mime": "json", "-output": "all",
                                "-loc": "500", "-filter": "120", "-objFilter": "100", "-from": "Planetes"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?{q}",
                                        timeout=60) as r:
                body = r.read().decode()
                return json.loads(body) if body.strip() else []
        except urllib.error.HTTPError as ex:
            if ex.code == 204:
                return []
        except Exception:  # noqa: BLE001
            pass
        time.sleep(5 * (attempt + 1))
    return None


def visits(rows: list[dict]) -> dict:
    """(obsId stem, det) -> its photos, in time order."""
    v: dict = defaultdict(list)
    for r in rows:
        v[(r["obs"].rsplit("_", 1)[0], r["det"])].append(r)
    return {k: sorted(x, key=lambda r: r["mjd"]) for k, x in v.items()}


def revisit_fields(flds: list[dict]) -> list[dict]:
    """Fields with two visits of the same detector WINDOW_H apart."""
    out = []
    for f in flds:
        vs = visits(f["rows"])
        pairs = []
        keys = sorted(vs, key=lambda k: vs[k][0]["mjd"])
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                if a[1] != b[1]:
                    continue
                dh = (vs[b][0]["mjd"] - vs[a][0]["mjd"]) * 24
                if WINDOW_H[0] <= dh <= WINDOW_H[1]:
                    pairs.append((a, b, dh))
        if pairs:
            out.append(dict(f, pairs=pairs, visits=vs))
    return out


def bucket(mjd: float) -> float:
    return math.floor(mjd * 4) / 4 + 0.125


def query() -> None:
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    flds = revisit_fields(fg.fields(idx["rows"]))
    path = CACHE / "asteroid_skybot.json"
    got = json.loads(path.read_text()) if path.exists() else {}
    need = sorted({(round(f["ra"], 4), round(f["dec"], 4), round(f["radius"], 3), bucket(r["mjd"]))
                   for f in flds for (a, b, _) in f["pairs"] for r in f["visits"][a] + f["visits"][b]})
    print(f"{len(flds)} fields with revisits {WINDOW_H} h; {len(need)} SkyBoT queries", flush=True)
    for ra, dec, rad, t in need:
        key = f"{ra},{dec},{rad},{t}"
        if key in got:
            continue
        res = skybot_cone(ra, dec, rad, t)
        if res is None:
            raise SystemExit(f"SkyBoT failed at {key}: stopping (no empty answer in place of a real one)")
        got[key] = res
        path.write_text(json.dumps(got))
        time.sleep(1.0)  # gently
    print("done", len(got))


def num(x) -> float:
    try:
        return float(str(x).split()[0])
    except (ValueError, IndexError):
        return math.nan


def radec(o: dict) -> tuple[float, float]:
    """SkyBoT's 'RA (hms)' and 'DEC (dms)' ("08 44 41.1394", "+18 06 52.192"), in degrees."""
    h, m, sec = (float(x) for x in str(o["RA (hms)"]).split())
    ds = str(o["DEC (dms)"]).strip()
    d, dm, dsec = (abs(float(x)) for x in ds.split())
    sg = -1 if ds.startswith("-") else 1
    return 15 * (h + m / 60 + sec / 3600), sg * (d + dm / 60 + dsec / 3600)


# SkyBoT's JSON field names (checked against a real answer, 15 Nov).
V_ = lambda o: num(o.get("VMag (mag)"))  # noqa: E731
DRA_ = lambda o: num(o.get("dRA (arcsec/h)"))  # noqa: E731  (RA rate x cos Dec)
DDEC_ = lambda o: num(o.get("dDEC (arcsec/h)"))  # noqa: E731
DG_ = lambda o: num(o.get("dg (ua)"))  # noqa: E731
ERR_ = lambda o: num(o.get("Err (arcsec)"))  # noqa: E731
NUM_ = lambda o: str(o.get("Num") or "").strip()  # noqa: E731  (absent for unnumbered objects)


def place_at(o: dict, t0: float, t: float) -> tuple[float, float]:
    """SkyBoT's place moved linearly (its ″/h rates) from the bucket time t0 to t."""
    ra, dec = radec(o)
    dra, ddec = DRA_(o), DDEC_(o)
    dh = (t - t0) * 24
    return ra + dra * dh / 3600 / math.cos(math.radians(dec)), dec + ddec * dh / 3600


AU_KM = 1.495978707e8


def from_spherex(ra: float, dec: float, dist_au: float, row: dict) -> tuple[float, float]:
    """A geocentric place seen from SPHEREx instead: the header's X_SC/Y_SC/Z_SC (km, geocentric,
    at mid-exposure) taken from the object's geocentric vector. Up to ~1 px for a main-belt
    asteroid, so it matters against a 1.5 px match (Physics asked, 15 Nov)."""
    if not (dist_au > 0):
        return ra, dec
    sc = sc_pos(row)
    a, d = math.radians(ra), math.radians(dec)
    v = np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]) * dist_au * AU_KM - sc
    return math.degrees(math.atan2(v[1], v[0])) % 360, math.degrees(math.asin(v[2] / np.linalg.norm(v)))


_SC: dict = {}


def sc_pos(row: dict) -> np.ndarray:
    if row["path"] not in _SC:
        # Our own cache, written only by this pipeline on this machine (as build_pack's).
        e = pickle.loads((CACHE / row["path"]).read_bytes())
        h = fits.Header.fromstring(e["wcs_hdr"])
        assert h.get("XYZ_SC_SYSTEM", "").strip() == "GEOCENTER", h.get("XYZ_SC_SYSTEM")
        _SC[row["path"]] = np.array([h["X_SC"], h["Y_SC"], h["Z_SC"]], float)
    return _SC[row["path"]]


def predicted(o: dict, t0: float, row: dict) -> tuple[float, float]:
    """SkyBoT's place at this photo's time, as SPHEREx sees it."""
    ra, dec = place_at(o, t0, row["mjd"])
    return from_spherex(ra, dec, DG_(o), row)


def measure_at(row: dict, ra: float, dec: float) -> dict | None:
    """S/N (masked aperture) and recentred position at a sky place in one cached photo."""
    # Our own cache, written only by this pipeline on this machine (as build_pack's).
    e = pickle.loads((CACHE / row["path"]).read_bytes())
    w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
    px, py = w.all_world2pix(ra, dec, 0)
    x, y = float(px) - e["x0"], float(py) - e["y0"]
    h, W = e["img"].shape
    if not (2 <= x < W - 2 and 2 <= y < h - 2):
        return None
    m = fg.measure_masked(e, x, y)
    if not m:
        return None
    cx, cy = fg.recentre(e["img"].astype(float), x, y)
    cra, cdec = w.all_pix2world(cx + e["x0"], cy + e["y0"], 0)
    return dict(m, x=x, y=y, cx=cx, cy=cy, ra=float(cra), dec=float(cdec), mjd=row["mjd"], obs=row["obs"],
                off_px=math.hypot(cx - x, cy - y))


def line_fit(pts: list[dict]) -> dict:
    """Straight line in time to the positions (arcsec, tangent plane at the first point), with errors
    from the scatter (at least the 0.25 px floor per position, Physics)."""
    ra0, dec0 = pts[0]["ra"], pts[0]["dec"]
    t = np.array([p["mjd"] for p in pts]) * 24  # hours
    t = t - t.mean()
    X = np.array([(p["ra"] - ra0) * math.cos(math.radians(dec0)) * 3600 for p in pts])
    Y = np.array([(p["dec"] - dec0) * 3600 for p in pts])
    A = np.vstack([np.ones_like(t), t]).T
    out = {}
    for name, v in (("x", X), ("y", Y)):
        coef, *_ = np.linalg.lstsq(A, v, rcond=None)
        resid = v - A @ coef
        dof = max(len(v) - 2, 1)
        s = max(float(np.sqrt((resid ** 2).sum() / dof)), 0.25 * PIX)
        cov = s ** 2 * np.linalg.inv(A.T @ A)
        out[name] = (float(coef[1]), float(math.sqrt(cov[1, 1])))
    return dict(rate_x=out["x"][0], err_x=out["x"][1], rate_y=out["y"][0], err_y=out["y"][1],
                span_h=float(t.max() - t.min()))


def search() -> None:
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    flds = revisit_fields(fg.fields(idx["rows"]))
    fg.gaia_for_fields(flds)
    sb = json.loads((CACHE / "asteroid_skybot.json").read_text())
    counts = defaultdict(int)
    passed, near = [], []
    for f in flds:
        for a, b, dh in f["pairs"]:
            photos = f["visits"][a] + f["visits"][b]
            objs = {}
            for r in photos:
                key = f"{round(f['ra'], 4)},{round(f['dec'], 4)},{round(f['radius'], 3)},{bucket(r['mjd'])}"
                for o in sb.get(key, []):
                    n = NUM_(o)
                    if n and V_(o) <= VMAX and not str(o.get("Class", "")).startswith("NEA"):
                        objs.setdefault(n, (o, bucket(r["mjd"])))
            for n, (o, t0) in objs.items():
                counts["numbered V<=18 in a revisited field"] += 1
                p0, p1 = predicted(o, t0, photos[0]), predicted(o, t0, photos[-1])
                move = fg.sep_deg(*p0, *p1) * 3600 / PIX
                if move < MIN_MOVE_PX:
                    continue
                counts[f"moves >= {MIN_MOVE_PX} px between the visits"] += 1
                pts, gone = [], []
                for r in photos:
                    pra, pdec = predicted(o, t0, r)
                    m = measure_at(r, pra, pdec)
                    if m and m["sn"] >= SN_MIN and m["off_px"] <= MATCH_PX and m["profile"] >= 3:
                        pts.append(dict(m, pred_ra=pra, pred_dec=pdec))
                visits_hit = {p["obs"].rsplit("_", 1)[0] for p in pts}
                if len(pts) < 3 or len(visits_hit) < 2:
                    if pts:
                        near.append(dict(num=n, name=o.get("Name"), V=V_(o), n=len(pts)))
                    continue
                counts["S/N>=5 within 1.5 px in >= 3 photos over 2 visits"] += 1
                stars = [g for g in f["gaia"] for p in pts
                         if fg.sep_deg(g["ra"], g["dec"], p["ra"], p["dec"]) * 3600 / PIX < GAIA_PX]
                if stars:
                    continue
                counts["no Gaia star within 2 px"] += 1
                # Moved, not a star: each measured place is empty in the other visit's photos.
                for p in pts:
                    other = [r for r in photos if r["obs"].rsplit("_", 1)[0] != p["obs"].rsplit("_", 1)[0]]
                    ms = [measure_at(r, p["ra"], p["dec"]) for r in other]
                    gone.append(all(m_ is None or m_["sn"] < SN_GONE for m_ in ms) and any(m_ for m_ in ms))
                if not all(gone):
                    continue
                counts["each place empty in the other visit"] += 1
                fit = line_fit(pts)
                dra, ddec = DRA_(o), DDEC_(o)
                rate = math.hypot(fit["rate_x"], fit["rate_y"])
                err = math.hypot(fit["err_x"], fit["err_y"])
                nonzero = rate / err
                diff = math.hypot((fit["rate_x"] - dra) / fit["err_x"], (fit["rate_y"] - ddec) / fit["err_y"])
                sk = math.hypot(dra, ddec)
                ang = abs((math.degrees(math.atan2(fit["rate_y"], fit["rate_x"]) - math.atan2(ddec, dra) * 180 / math.pi
                           + 180) % 360 - 180))
                ok = nonzero >= 3 and diff <= 3 * math.sqrt(2) and abs(rate - sk) / sk <= 0.3 and ang <= 20
                rec = dict(num=n, name=o.get("Name"), V=V_(o), cls=o.get("Class"),
                           err_arcsec=ERR_(o), field=[f["ra"], f["dec"]],
                           visits=[a[0], b[0]], det=a[1], gap_h=round(dh, 2), move_px=round(move, 1),
                           fit=fit, skybot_rate=[dra, ddec], nonzero_sigma=round(nonzero, 1),
                           diff_sigma=round(diff, 2), angle_deg=round(ang, 1), passed=ok, points=pts)
                if ok:
                    counts["motion: nonzero >= 3 sigma, agrees with SkyBoT"] += 1
                    passed.append(rec)
                else:
                    near.append({k: rec[k] for k in ("num", "name", "V", "nonzero_sigma", "diff_sigma", "angle_deg")})
    passed.sort(key=lambda r: r["V"])
    out = dict(window_h=WINDOW_H, counts=dict(counts), passed=passed, near_misses=near[:30])
    (CACHE / "asteroid_search.json").write_text(json.dumps(out, indent=1, default=float))
    print(json.dumps(dict(counts), indent=1))
    for r in passed[:5]:
        print(r["num"], r["name"], r["V"], r["visits"], r["det"], r["gap_h"], r["nonzero_sigma"], r["diff_sigma"])


if __name__ == "__main__":
    {"query": query, "search": search}[sys.argv[1]]()
