"""Field guide ("What fools you"): find real examples by the fixed rules in prereg/fieldguide/PLAN.md.

Step 1 (`index`): every cached photo box, placed on the sky from its own WCS, with any box within 1 deg
of a V or T patch centre dropped BEFORE its pixels are read (T is reserved for the ranker's one
locked score). Writes cache/fieldguide_index.json: one row per allowed box (path, photo, detector,
MJD, box-centre RA/Dec).

Step 2 (`search`): per kind, every connected flagged region in every allowed box; its excess light
(image minus the median of the unflagged pixels 3-8 px outside it) and S/N (excess over the ring's
robust scatter times sqrt(pixels)). The instance with the largest excess at S/N >= 5 is the
example; written to cache/fieldguide_search.json with the top 5 per kind for the record.

Step 3 (`select`, Physics' rule change after the first result): a region counts only if its
excess isn't explained by a known source: no SOURCE-flagged pixel, no Gaia DR3 (G < 19) within 2 px
at the photo's date, no SkyBoT asteroid within 2 px (checked on the survivors, best first). CatWISE
is skipped tonight (IRSA down). Also picks the star-hit example: the largest-excess TRANSIENT region
excluded because of a Gaia match. Then the confirmation tests per kind. Writes
cache/fieldguide_select.json.

Step 4 (`confirm`): Physics' confirmation tests on each chosen example, using the other cached
photos: (same sky) other photos of the same sky position, same detector, within 5 days: is
anything there (S/N >= 5) or nothing (S/N < 3)?; (detector place) other photos of the same detector
where the same detector pixel looks at different sky (> 2 px away): is that pixel bright there too?
Writes cache/fieldguide_confirm.json.

Usage: uv run python fieldguide.py index | search | select | confirm
"""
from __future__ import annotations

import csv
import json
import math
import pickle
import sys
import warnings
from pathlib import Path

import numpy as np
from astropy.io import fits
from scipy import ndimage
from astropy.wcs import WCS

warnings.simplefilter("ignore")
HERE = Path(__file__).parent
CACHE = HERE / "cache"
PATCHES = Path("/Users/sumit/Github/SphereXVision/prereg/patches.csv")
EXCLUDE_DEG = 1.0


def reserved() -> list[tuple[str, float, float]]:
    """V and T patch centres (Physics' registered list)."""
    with PATCHES.open() as f:
        return [(r["patch"], float(r["ra"]), float(r["dec"])) for r in csv.DictReader(f)
                if r["patch"].startswith(("V-", "T-"))]


def sep_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r = math.radians
    c = math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def box_centre(e: dict) -> tuple[float, float]:
    """The box's centre on the sky, from the photo's own IMAGE header (0-based detector pixels)."""
    w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
    h, wd = e["img"].shape
    ra, dec = w.all_pix2world(e["x0"] + (wd - 1) / 2, e["y0"] + (h - 1) / 2, 0)
    return float(ra), float(dec)


def index() -> None:
    res = reserved()
    rows, dropped, empty = [], 0, 0
    for p in sorted(CACHE.glob("*.pkl")):
        # Our own cache, written only by this pipeline on this machine.
        e = pickle.loads(p.read_bytes())
        if not e:
            empty += 1
            continue
        # Only the header is read before the exclusion; the pixels are not looked at here.
        ra, dec = box_centre(e)
        if any(sep_deg(ra, dec, pra, pdec) < EXCLUDE_DEG for _, pra, pdec in res):
            dropped += 1
            continue
        rows.append(dict(path=p.name, obs=e["obs_id"], det=int(e["det"]), mjd=float(e["mjd"]),
                         release=e.get("release"), ra=round(ra, 6), dec=round(dec, 6),
                         lam=float(e.get("lam") or 0)))
    out = CACHE / "fieldguide_index.json"
    out.write_text(json.dumps(dict(rule=f"box centre >= {EXCLUDE_DEG} deg from every V/T patch",
                                   reserved=[r[0] for r in res], kept=len(rows), dropped=dropped,
                                   empty=empty, rows=rows)))
    print(json.dumps(dict(kept=len(rows), dropped=dropped, empty=empty, out=str(out))))


# v4's FIT_REJECT names (SphereXVision smo/data/flags.py): never counted as background.
FIT_REJECT = ("TRANSIENT", "OVERFLOW", "SUR_ERROR", "PHANTOM", "REFERENCE", "NONFUNC", "DICHROIC",
              "MISSING_DATA", "HOT", "COLD", "PHANMISS", "NONLINEAR", "PERSIST", "CROSSTALK", "GHOST",
              "GHOST_FPA", "GHOST_EXT", "STREAK", "BLOOM", "SNOWBALL", "HALO", "SATELLITE_HALO")
# The kinds searched by flag name (PLAN.md 1-2); saturation, blend, asteroid and the control star
# have their own named examples and are not searched here.
KINDS = {
    "cosmic-ray": ("TRANSIENT",),
    "hot-or-dead-pixel": ("HOT", "NONFUNC"),
    "persistence": ("PERSIST",),
    "ghost": ("GHOST", "GHOST_FPA", "GHOST_EXT"),
    "halo": ("HALO",),
    "streak": ("STREAK", "SATELLITE_HALO"),
}
SN_MIN = 5.0
RING = (3, 8)


def mask_of(e: dict, names) -> np.ndarray:
    bits = e.get("bits") or {}
    m = np.zeros(e["fl"].shape, bool)
    for n in names:
        if n in bits:
            m |= (e["fl"] >> int(bits[n])) & 1 == 1
    return m


def regions(e: dict, names, touch=None) -> list[dict]:
    """Every connected flagged region of these names, with its excess light and S/N (and whether it
    touches the `touch` mask, e.g. SOURCE)."""
    m = mask_of(e, names)
    if not m.any():
        return []
    img = e["img"].astype(float)
    bad = mask_of(e, FIT_REJECT) | ~np.isfinite(img)
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    out = []
    for k in range(1, n + 1):
        reg = lab == k
        inner = ndimage.binary_dilation(reg, iterations=RING[0])
        outer = ndimage.binary_dilation(reg, iterations=RING[1])
        ring = outer & ~inner & ~bad
        vals = img[ring]
        pix = img[reg]
        pix = pix[np.isfinite(pix)]
        if vals.size < 20 or pix.size == 0:
            continue
        bk = float(np.median(vals))
        sd = 1.4826 * float(np.median(np.abs(vals - bk)))
        if not sd > 0:
            continue
        excess = float(np.sum(pix - bk))
        yy, xx = np.nonzero(reg)
        out.append(dict(excess=excess, sn=excess / (sd * math.sqrt(pix.size)), npix=int(reg.sum()),
                        x=float(xx.mean()), y=float(yy.mean()), bk=bk, sd=sd,
                        touch=bool(touch is not None and (touch & reg).any()),
                        names=sorted({nm for nm in names if mask_of(e, (nm,))[reg].any()})))
    return out


def search() -> None:
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    best: dict[str, list] = {k: [] for k in KINDS}
    for i, row in enumerate(idx["rows"]):
        # Our own cache, written only by this pipeline on this machine (as build_pack's).
        e = pickle.loads((CACHE / row["path"]).read_bytes())
        for kind, names in KINDS.items():
            for r in regions(e, names):
                if r["sn"] >= SN_MIN:
                    best[kind].append(dict(r, path=row["path"], obs=row["obs"], det=row["det"],
                                           mjd=row["mjd"], lam=row["lam"], ra=row["ra"], dec=row["dec"],
                                           x0=int(e["x0"]), y0=int(e["y0"])))
        if i % 2000 == 0:
            print(i, {k: len(v) for k, v in best.items()}, flush=True)
    summary = {}
    for kind, lst in best.items():
        lst.sort(key=lambda r: -r["excess"])
        summary[kind] = dict(n_at_sn5=len(lst), chosen=lst[0] if lst else None, next4=lst[1:5])
    rule = ("largest excess light inside the flagged region (image - median of unflagged pixels "
            f"{RING[0]}-{RING[1]} px outside), among regions with S/N >= {SN_MIN}")
    (CACHE / "fieldguide_search.json").write_text(json.dumps(dict(rule=rule, kinds=summary), indent=1))
    for kind, v in summary.items():
        c = v["chosen"]
        print(kind, v["n_at_sn5"], c and (c["obs"], c["det"], round(c["excess"], 1), round(c["sn"], 1), c["names"]))


SELECT_KINDS = {
    "cosmic-ray": ("TRANSIENT",),
    "hot-or-dead-pixel": ("HOT", "NONFUNC"),
    "persistence": ("PERSIST",),
    "streak": ("STREAK", "SATELLITE_HALO"),
}
PIX_ARCSEC = 6.15
NEAR_PX = 2.0


def year_of(mjd: float) -> float:
    return 2000.0 + (mjd - 51544.5) / 365.25


def fields(rows: list[dict]) -> list[dict]:
    """Group the boxes into fields: a box joins the first field whose centre is within 0.5 deg."""
    out: list[dict] = []
    for r in rows:
        for f in out:
            if sep_deg(r["ra"], r["dec"], f["ra"], f["dec"]) < 0.5:
                f["rows"].append(r)
                break
        else:
            out.append(dict(ra=r["ra"], dec=r["dec"], rows=[r]))
    for f in out:
        f["radius"] = max(sep_deg(f["ra"], f["dec"], r["ra"], r["dec"]) for r in f["rows"]) + 0.15
    return out


def gaia_for_fields(flds: list[dict]) -> dict:
    """Gaia DR3 (G < 19) per field, cached in cache/fieldguide_gaia.json (ESA's archive)."""
    import catalogs
    path = CACHE / "fieldguide_gaia.json"
    got = json.loads(path.read_text()) if path.exists() else {}
    for f in flds:
        key = f"{f['ra']:.4f},{f['dec']:.4f},{f['radius']:.3f}"
        if key not in got:
            # A failed query stops the step: never an empty catalogue in place of a real one.
            got[key] = catalogs.gaia_dr3(f["ra"], f["dec"], f["radius"], gmax=19.0)
            path.write_text(json.dumps(got))
            print("gaia", key, len(got[key]), flush=True)
        f["gaia"] = got[key]
    return got


def sky_of(e: dict, x: float, y: float) -> tuple[float, float]:
    w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
    ra, dec = w.all_pix2world(e["x0"] + x, e["y0"] + y, 0)
    return float(ra), float(dec)


def gaia_near(gaia: list[dict], ra: float, dec: float, mjd: float) -> dict | None:
    import catalogs
    yr = year_of(mjd)
    best = None
    for g in gaia:
        if abs(g["dec"] - dec) > 0.05:
            continue
        gra, gdec = catalogs.propagate(g, yr)
        d = sep_deg(ra, dec, gra, gdec) * 3600 / PIX_ARCSEC
        if d <= NEAR_PX and (best is None or d < best[0]):
            best = (d, g)
    return None if best is None else dict(best[1], sep_px=round(best[0], 2))


def skybot_near(ra: float, dec: float, mjd: float) -> list[dict] | None:
    """SkyBoT asteroids within 2 px at this time (geocentric, as the app asks); None if it failed."""
    import urllib.parse
    import urllib.request
    q = urllib.parse.urlencode({"-ep": f"{mjd + 2400000.5:.5f}", "-ra": f"{ra:.6f}", "-dec": f"{dec:.6f}",
                                "-rd": f"{NEAR_PX * PIX_ARCSEC / 3600:.5f}", "-mime": "json",
                                "-output": "basic", "-loc": "500", "-filter": "120", "-objFilter": "111",
                                "-from": "Planetes"})
    try:
        with urllib.request.urlopen(f"https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?{q}",
                                    timeout=30) as r:
            body = r.read().decode()
            return json.loads(body) if body.strip() else []
    except urllib.error.HTTPError as ex:
        return [] if ex.code == 204 else None
    except Exception:  # noqa: BLE001
        return None


def select() -> None:
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    flds = fields(idx["rows"])
    print("fields", len(flds), flush=True)
    gaia_for_fields(flds)
    field_of = {r["path"]: f for f in flds for r in f["rows"]}
    survivors = {k: [] for k in SELECT_KINDS}
    star_hits = []
    counts = {k: dict(at_sn5=0, source_flag=0, gaia=0) for k in SELECT_KINDS}
    for i, row in enumerate(idx["rows"]):
        # Our own cache, written only by this pipeline on this machine (as build_pack's).
        e = pickle.loads((CACHE / row["path"]).read_bytes())
        src = mask_of(e, ("SOURCE",))
        for kind, names in SELECT_KINDS.items():
            for r in regions(e, names, touch=src):
                if r["sn"] < SN_MIN:
                    continue
                counts[kind]["at_sn5"] += 1
                rec = dict(r, path=row["path"], obs=row["obs"], det=row["det"], mjd=row["mjd"],
                           lam=row["lam"], x0=int(e["x0"]), y0=int(e["y0"]))
                if r["touch"]:
                    counts[kind]["source_flag"] += 1
                    continue
                ra, dec = sky_of(e, r["x"], r["y"])
                rec.update(ra=round(ra, 6), dec=round(dec, 6))
                g = gaia_near(field_of[row["path"]]["gaia"], ra, dec, row["mjd"])
                if g:
                    counts[kind]["gaia"] += 1
                    if kind == "cosmic-ray":
                        star_hits.append(dict(rec, gaia=dict(id=g["id"], G=g["mag"], sep_px=g["sep_px"])))
                    continue
                survivors[kind].append(rec)
        if i % 2000 == 0:
            print(i, {k: len(v) for k, v in survivors.items()}, len(star_hits), flush=True)
    out = dict(rule_change="Physics, after the first result: no SOURCE pixel, no Gaia G<19 within 2 px, "
                           "no SkyBoT asteroid within 2 px; CatWISE skipped (IRSA down)",
               counts=counts, kinds={})
    for kind, lst in survivors.items():
        lst.sort(key=lambda r: -r["excess"])
        chosen, checked = None, []
        for cand in lst[:10]:
            sb = skybot_near(cand["ra"], cand["dec"], cand["mjd"])
            checked.append(dict(obs=cand["obs"], skybot=None if sb is None else len(sb)))
            if sb is None:
                continue  # SkyBoT didn't answer: not chosen on an unchecked basis
            if sb:
                continue
            chosen = cand
            break
        out["kinds"][kind] = dict(survivors=len(lst), chosen=chosen, skybot_checked=checked)
        print(kind, len(lst), chosen and (chosen["obs"], chosen["det"], chosen["npix"],
                                          round(chosen["excess"], 1), round(chosen["sn"], 1)), flush=True)
    star_hits.sort(key=lambda r: -r["excess"])
    out["star_hit"] = star_hits[0] if star_hits else None
    out["star_hits_n"] = len(star_hits)
    (CACHE / "fieldguide_select.json").write_text(json.dumps(out, indent=1))
    print("star-hit", len(star_hits), out["star_hit"] and (out["star_hit"]["obs"], out["star_hit"]["gaia"]))


def measure(e: dict, x: float, y: float, aper: int) -> dict | None:
    """Excess and S/N at box pixel (x, y): the (2*aper+1)^2 box minus the median of the unflagged
    ring 3-8 px outside it; None if off the box or too few background pixels."""
    img = e["img"].astype(float)
    h, w = img.shape
    xi, yi = int(round(x)), int(round(y))
    if not (aper <= xi < w - aper and aper <= yi < h - aper):
        return None
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.maximum(np.abs(xx - xi), np.abs(yy - yi))
    bad = mask_of(e, FIT_REJECT) | ~np.isfinite(img)
    ring = (d >= aper + 3) & (d <= aper + 8) & ~bad
    if ring.sum() < 20:
        return None
    bk = float(np.median(img[ring]))
    sd = 1.4826 * float(np.median(np.abs(img[ring] - bk)))
    core = img[(d <= aper)]
    if not np.all(np.isfinite(core)) or not sd > 0:
        return None
    exc = float(np.sum(core - bk))
    flags = sorted({n for n in (e.get("bits") or {}) if mask_of(e, (n,))[d <= aper].any()})
    return dict(excess=round(exc, 3), sn=round(exc / (sd * math.sqrt(core.size)), 2), flags=flags)


def confirm() -> None:
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    sel = json.loads((CACHE / "fieldguide_select.json").read_text())
    picks = {k: v["chosen"] for k, v in sel["kinds"].items() if v["chosen"]}
    if sel.get("star_hit"):
        picks["star-hit"] = sel["star_hit"]
    out = {}
    for kind, c in picks.items():
        X, Y = c["x0"] + c["x"], c["y0"] + c["y"]  # detector pixel (0-based)
        same_sky, det_place = [], []
        for row in idx["rows"]:
            if row["det"] != c["det"] or row["obs"] == c["obs"]:
                continue
            if sep_deg(row["ra"], row["dec"], c["ra"], c["dec"]) > 0.3:
                continue
            # Our own cache, written only by this pipeline on this machine (as build_pack's).
            e = pickle.loads((CACHE / row["path"]).read_bytes())
            w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
            # Same sky: where this photo sees the candidate's sky position.
            if abs(row["mjd"] - c["mjd"]) <= 5:
                px, py = w.all_world2pix(c["ra"], c["dec"], 0)
                m = measure(e, float(px) - e["x0"], float(py) - e["y0"], 1)
                if m:
                    same_sky.append(dict(obs=row["obs"], dt_days=round(row["mjd"] - c["mjd"], 3), **m))
            # Detector place: the same detector pixel, looking at different sky.
            bx, by = X - e["x0"], Y - e["y0"]
            if 0 <= bx < e["img"].shape[1] and 0 <= by < e["img"].shape[0]:
                ra, dec = w.all_pix2world(X, Y, 0)
                if sep_deg(float(ra), float(dec), c["ra"], c["dec"]) * 3600 / PIX_ARCSEC > NEAR_PX:
                    m = measure(e, bx, by, 0)
                    if m:
                        det_place.append(dict(obs=row["obs"], dt_days=round(row["mjd"] - c["mjd"], 3), **m))
        out[kind] = dict(
            pick=dict(obs=c["obs"], det=c["det"], detector_pixel=[round(X, 1), round(Y, 1)], ra=c["ra"],
                      dec=c["dec"], npix=c["npix"], excess=round(c["excess"], 1), names=c["names"]),
            same_sky=dict(n=len(same_sky), nothing_sn_lt3=sum(m["sn"] < 3 for m in same_sky),
                          something_sn_ge5=sum(m["sn"] >= 5 for m in same_sky), rows=same_sky[:12]),
            detector_place=dict(n=len(det_place), bright_sn_ge5=sum(m["sn"] >= 5 for m in det_place),
                                rows=det_place[:12]))
        print(kind, json.dumps({k: v for k, v in out[kind].items() if k != "pick"}, default=str)[:400], flush=True)
    (CACHE / "fieldguide_confirm.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    {"index": index, "search": search, "select": select, "confirm": confirm}[sys.argv[1]]()
