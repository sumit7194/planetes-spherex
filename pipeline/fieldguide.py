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

Step 5 (`named`): the named examples' instances, by the rules fixed in PLAN.md before searching:
the control star (Physics' conditions; S/N closest to 50) and Barnard's Star's saturation (the
photo with the largest saturation-flagged area connected to the star). Writes
cache/fieldguide_named.json.

Step 6 (`export`): 32x32 panels (f32 image, u8 mask of the card's own flag, u8 other-masked) and
public/data/fieldguide/cards.json with each card's draft wording and evidence (Physics signs the
labels and evidence before anything is pushed).

Step 7 (`repick`, Physics' decisions after the confirmation results): the cosmic-ray card from
TRANSIENT regions touching no SOURCE, NONFUNC or HOT pixel and with no Gaia star within 2 px; the
star-hit card from TRANSIENT regions with a Gaia match, keeping the first (largest excess) whose
star shows at S/N >= 5 in at least 2 other photos of the same detector and whose light in the
picked photo is within a factor of 2 of the star's median there (all measured in the same 3x3
aperture at the star's place). Writes cache/fieldguide_repick.json.

Usage: uv run python fieldguide.py index | search | select | confirm | named | export | repick
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
                        touch=bool(touch is not None and not isinstance(touch, dict) and (touch & reg).any()),
                        touches={k: bool((m_ & reg).any()) for k, m_ in touch.items()} if isinstance(touch, dict) else {},
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


SATURATION = ("OVERFLOW", "NONLINEAR", "BLOOM")
BARNARD = (269.4463, 4.7682)  # its 2026 place; boxes were cut around it


def named() -> None:
    import catalogs
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    flds = fields(idx["rows"])
    gaia_for_fields(flds)
    field_of = {r["path"]: f for f in flds for r in f["rows"]}
    controls, barnard = [], []
    for i, row in enumerate(idx["rows"]):
        # Our own cache, written only by this pipeline on this machine (as build_pack's).
        e = pickle.loads((CACHE / row["path"]).read_bytes())
        h, wd = e["img"].shape
        w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
        yr = year_of(row["mjd"])
        gaia = field_of[row["path"]]["gaia"]
        pos = [catalogs.propagate(g, yr) for g in gaia]
        if pos:
            xs, ys = w.all_world2pix([p_[0] for p_ in pos], [p_[1] for p_ in pos], 0)
            bx, by = np.asarray(xs) - e["x0"], np.asarray(ys) - e["y0"]
            inside = (bx >= 9) & (by >= 9) & (bx < wd - 9) & (by < h - 9)
            rej = mask_of(e, FIT_REJECT)
            for k in np.nonzero(inside)[0]:
                others = np.hypot(bx - bx[k], by - by[k])
                others[k] = 1e9
                if others.min() <= 3:
                    continue
                xi, yi = int(round(bx[k])), int(round(by[k]))
                if rej[yi - 1:yi + 2, xi - 1:xi + 2].any():
                    continue
                m = measure(e, bx[k], by[k], 1)
                if m and 20 <= m["sn"] <= 100:
                    controls.append(dict(obs=row["obs"], det=row["det"], mjd=row["mjd"], path=row["path"],
                                         x=float(bx[k]), y=float(by[k]), x0=int(e["x0"]), y0=int(e["y0"]),
                                         gaia=dict(id=gaia[k]["id"], G=gaia[k]["mag"]), lam=row["lam"], **m))
        if sep_deg(row["ra"], row["dec"], *BARNARD) < 0.3:
            sat = mask_of(e, SATURATION)
            if sat.any():
                lab, n = ndimage.label(sat, structure=np.ones((3, 3)))
                px, py = w.all_world2pix(BARNARD[0], BARNARD[1], 0)
                cx, cy = float(px) - e["x0"], float(py) - e["y0"]
                best = None
                for k in range(1, n + 1):
                    yy, xx = np.nonzero(lab == k)
                    d = float(np.min(np.hypot(xx - cx, yy - cy)))
                    if d <= 3 and (best is None or (lab == k).sum() > best[0]):
                        best = (int((lab == k).sum()), k)
                if best:
                    names = sorted({nm for nm in SATURATION if mask_of(e, (nm,))[lab == best[1]].any()})
                    barnard.append(dict(obs=row["obs"], det=row["det"], mjd=row["mjd"], path=row["path"],
                                        area=best[0], names=names, x=cx, y=cy, x0=int(e["x0"]),
                                        y0=int(e["y0"]), lam=row["lam"],
                                        halo_px=int(mask_of(e, ("HALO",)).sum())))
        if i % 3000 == 0:
            print(i, len(controls), len(barnard), flush=True)
    controls.sort(key=lambda c: abs(c["sn"] - 50))
    barnard.sort(key=lambda b: -b["area"])
    out = dict(control=dict(n=len(controls), chosen=controls[0] if controls else None, next=controls[1:4]),
               barnard=dict(n=len(barnard), chosen=barnard[0] if barnard else None, next=barnard[1:4]))
    (CACHE / "fieldguide_named.json").write_text(json.dumps(out, indent=1, default=float))
    c, b = out["control"]["chosen"], out["barnard"]["chosen"]
    print("control", len(controls), c and (c["obs"], c["det"], c["sn"], c["gaia"]))
    print("barnard", len(barnard), b and (b["obs"], b["det"], b["area"], b["names"], b["halo_px"]))


OUT = HERE.parent / "public" / "data" / "fieldguide"
CUT = 32
DET_RANGE = {1: "0.75–1.1 µm", 2: "1.1–1.6 µm", 3: "1.6–2.4 µm", 4: "2.4–3.8 µm", 5: "3.8–4.4 µm", 6: "4.4–5 µm"}


def date_of(mjd: float) -> str:
    import datetime as dt
    d = dt.datetime(1858, 11, 17) + dt.timedelta(days=mjd)
    return f"{d.day} {d:%B %Y}"


def crop(arr: np.ndarray, x: float, y: float, fill) -> np.ndarray:
    """A CUT x CUT square centred on (x, y), padded with `fill` off the box."""
    out = np.full((CUT, CUT), fill, dtype=arr.dtype)
    xi, yi = int(round(x)) - CUT // 2, int(round(y)) - CUT // 2
    h, w = arr.shape
    for j in range(CUT):
        for i in range(CUT):
            yy, xx = yi + j, xi + i
            if 0 <= yy < h and 0 <= xx < w:
                out[j, i] = arr[yy, xx]
    return out


def write_panel(name: str, img, mark, masked) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    np.asarray(img, "<f4").tofile(OUT / f"{name}.f32")
    np.asarray(mark, np.uint8).tofile(OUT / f"{name}.mark.u8")
    np.asarray(masked, np.uint8).tofile(OUT / f"{name}.masked.u8")
    return dict(size=CUT, image=f"{name}.f32", mark=f"{name}.mark.u8", masked=f"{name}.masked.u8")


def photo_panel(name: str, path: str, x: float, y: float, mark_names, caption: str, alt: str,
                ring=False) -> dict:
    # Our own cache, written only by this pipeline on this machine (as build_pack's).
    e = pickle.loads((CACHE / path).read_bytes())
    img = crop(e["img"].astype("f4"), x, y, np.nan)
    mark = crop(mask_of(e, mark_names).astype(np.uint8), x, y, 0) if mark_names else np.zeros((CUT, CUT), np.uint8)
    masked = crop(mask_of(e, FIT_REJECT).astype(np.uint8), x, y, 1)
    p = dict(write_panel(name, img, mark, masked), caption=caption, alt=alt)
    if ring:
        p["ring"] = [CUT // 2 + (x - round(x)), CUT // 2 + (y - round(y))]
    return p


def other_photo(c: dict, rows: list[dict], want_sn) -> tuple[dict, float, float] | None:
    """The other photo of the same sky, same detector, nearest in time, meeting want_sn(sn)."""
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    best = None
    for row in idx["rows"]:
        if row["det"] != c["det"] or row["obs"] == c["obs"] or sep_deg(row["ra"], row["dec"], c["ra"], c["dec"]) > 0.3:
            continue
        e = pickle.loads((CACHE / row["path"]).read_bytes())
        w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
        px, py = w.all_world2pix(c["ra"], c["dec"], 0)
        bx, by = float(px) - e["x0"], float(py) - e["y0"]
        m = measure(e, bx, by, 1)
        if not m or not want_sn(m["sn"]):
            continue
        dt_ = abs(row["mjd"] - c["mjd"])
        if best is None or dt_ < best[0]:
            best = (dt_, row, bx, by, m)
    return None if best is None else (dict(best[1], m=best[4]), best[2], best[3])


def recentre(img: np.ndarray, x: float, y: float) -> tuple[float, float]:
    """The app's recentre (spotCheck.ts): brightest pixel within 1 px, then the 3x3 flux-weighted
    centroid of values above the 3x3's minimum."""
    xi, yi = int(round(x)), int(round(y))
    best, bx, by = -np.inf, xi, yi
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            v = img[yi + dy, xi + dx]
            if np.isfinite(v) and v > best:
                best, bx, by = v, xi + dx, yi + dy
    box = img[by - 1:by + 2, bx - 1:bx + 2]
    w = np.where(np.isfinite(box), box - np.nanmin(box), 0)
    if w.sum() <= 0:
        return float(bx), float(by)
    yy, xx = np.mgrid[-1:2, -1:2]
    return float(bx + (w * xx).sum() / w.sum()), float(by + (w * yy).sum() / w.sum())


def blend_marks(img, all_late, man, mjd, c0) -> list[dict]:
    """+ light centre, o the Gaia neighbour, diamond WISE 0855 predicted: as Two colours draws them,
    in the 32x32 panel's pixels (the panel is centred on the grid centre)."""
    import catalogs
    g = man["grid"]
    cosd = math.cos(math.radians(g["centre"]["dec"]))
    def to_px(ra, dec):
        dra = (ra - g["centre"]["ra"] + 540) % 360 - 180
        return c0 - dra * cosd * 3600 / g["pixelScaleArcsec"], c0 + (dec - g["centre"]["dec"]) * 3600 / g["pixelScaleArcsec"]
    sx, sy = recentre(all_late, c0, c0)
    lx, ly = recentre(img, sx, sy)
    yr = year_of(mjd)
    nb = dict(ra=133.75818250493919, dec=-7.241155906974705, pmra=-6.187834849360848,
              pmdec=1.9308548733514355, epoch=2016.0)
    nx, ny = to_px(*catalogs.propagate(nb, yr))
    t = json.loads((HERE / "targets.json").read_text())
    tl = t["targets"] if isinstance(t, dict) and "targets" in t else t
    w0855 = [x for x in tl if x.get("slug") == "w0855"][0]
    tx, ty = to_px(*catalogs.propagate(dict(ra=w0855["ra"], dec=w0855["dec"], pmra=w0855["pmra"],
                                            pmdec=w0855["pmdec"], epoch=w0855["epoch"]), yr))
    off = c0 - CUT // 2 + 0.5  # grid pixel -> panel pixel (the panel starts at round(c0) - 16)
    off = round(c0) - CUT // 2
    return [dict(kind="light", x=lx - off, y=ly - off), dict(kind="neighbour", x=nx - off, y=ny - off),
            dict(kind="target", x=tx - off, y=ty - off)]


def export() -> None:
    conf = json.loads((CACHE / "fieldguide_confirm.json").read_text())
    named_ = json.loads((CACHE / "fieldguide_named.json").read_text())
    sel = json.loads((CACHE / "fieldguide_select.json").read_text())
    cards = []

    def det_line(det, lam):
        return f"detector D{det} ({DET_RANGE[det]})", f"{lam:.2f} µm"

    # 1. A pixel the pipeline marks as not working (flag-only; Physics to sign).
    c = sel["kinds"]["hot-or-dead-pixel"]["chosen"]
    cf = conf["hot-or-dead-pixel"]["same_sky"]
    other = other_photo(c, [], lambda sn: sn < 3)
    panels = [photo_panel("stuck-a", c["path"], c["x"], c["y"], ("NONFUNC", "TRANSIENT"),
                          f"{date_of(c['mjd'])}: one pixel", f"{date_of(c['mjd'])}: one very bright pixel, outlined", True)]
    if other:
        o, ox, oy = other
        panels.append(photo_panel("stuck-b", o["path"], ox, oy, (), f"{date_of(o['mjd'])}: the same sky",
                                  f"{date_of(o['mjd'])}: the same sky, nothing there", True))
    d, lam = det_line(c["det"], c["lam"])
    cards.append(dict(
        id="bad-pixel", section="not-in-sky", title="A pixel that isn’t working",
        looksLike="a new point of light", label="flagged",
        evidence=["Flagged by the pipeline as not working (NONFUNC) and transient (TRANSIENT)",
                  f"About {c['excess']:,.0f} MJy/sr in one pixel, about {c['excess'] / c['bk']:,.0f} times its neighbours (about {c['bk']:.1f})"
                  if c["bk"] > 0 else f"About {c['excess']:,.0f} MJy/sr in one pixel, while the pixels around it read about {c['bk']:.1f}",
                  f"Nothing there in {cf['nothing_sn_lt3']} of {cf['n']} other photos of the same sky within 5 days"],
        howToTell="A real source stays with the sky, so it shows in other photos of the same spot. A bad pixel stays with the detector, so other photos of the same spot don’t show it.",
        source=dict(photos=[c["obs"]] + ([other[0]["obs"]] if other else []), date=date_of(c["mjd"]),
                    detector=d, **{"lambda": lam}, at=f"{c['ra']:.5f},{c['dec']:.5f}"),
        panels=panels))

    # 2. Persistence (flag-only; Physics to sign).
    c = sel["kinds"]["persistence"]["chosen"]
    cf = conf["persistence"]["same_sky"]
    other = other_photo(c, [], lambda sn: sn < 3)
    panels = [photo_panel("persist-a", c["path"], c["x"], c["y"], ("PERSIST",),
                          f"{date_of(c['mjd'])}: flagged", f"{date_of(c['mjd'])}: a pixel flagged as persistence, outlined", True)]
    if other:
        o, ox, oy = other
        panels.append(photo_panel("persist-b", o["path"], ox, oy, (), f"{date_of(o['mjd'])}: the same sky",
                                  f"{date_of(o['mjd'])}: the same sky, nothing there", True))
    d, lam = det_line(c["det"], c["lam"])
    cards.append(dict(
        id="persistence", section="not-in-sky", title="An afterglow on the detector",
        looksLike="a faint new source", label="flagged",
        evidence=["Flagged as an afterglow (PERSIST): the pipeline’s flag for light left on the detector by something bright it saw before",
                  f"Nothing there in {cf['nothing_sn_lt3']} of {cf['n']} other photos of the same sky within 5 days",
                  "The earlier photo that left it isn’t among the photos we have, so the bright source itself can’t be shown"],
        howToTell="If it isn’t in the other photos of the same spot and carries a persistence flag, it’s the detector remembering, not the sky.",
        source=dict(photos=[c["obs"]] + ([other[0]["obs"]] if other else []), date=date_of(c["mjd"]),
                    detector=d, **{"lambda": lam}, at=f"{c['ra']:.5f},{c['dec']:.5f}"),
        panels=panels))

    # 3. Saturation and its halo: Barnard's Star.
    b = named_["barnard"]["chosen"]
    d, lam = det_line(b["det"], b["lam"])
    cards.append(dict(
        id="saturated", section="in-sky", title="A star too bright for the detector",
        looksLike="a strange blob or a spike", label="confirmed",
        evidence=["Barnard’s Star, Gaia DR3 G 8.2: far brighter at its centre than SPHEREx can measure",
                  f"Flagged at its centre as saturated ({', '.join(b['names'])}; {b['area']} pixels) and around it as a bright star’s halo (HALO; {b['halo_px']} pixels)",
                  "Its light is real; only the centre’s numbers can’t be trusted"],
        howToTell="A blob on a bright catalogued star with saturation flags is the star itself, not something new.",
        source=dict(photos=[b["obs"]], date=date_of(b["mjd"]), detector=d, **{"lambda": lam},
                    at="269.44630,4.76820"),
        panels=[photo_panel("sat-a", b["path"], b["x"], b["y"], SATURATION,
                            f"outlined: saturation ({', '.join(b['names'])})",
                            "Barnard's Star: the saturated centre outlined"),
                photo_panel("sat-b", b["path"], b["x"], b["y"], ("HALO",), "outlined: halo (HALO)",
                            "Barnard's Star: the halo flags outlined")]))

    # 4. The control: an ordinary star.
    c = named_["control"]["chosen"]
    # Its sky position, for the second photo.
    e = pickle.loads((CACHE / c["path"]).read_bytes())
    ra, dec = sky_of(e, c["x"], c["y"])
    c2 = dict(c, ra=ra, dec=dec)
    other = other_photo(c2, [], lambda sn: sn >= 5)
    panels = [photo_panel("star-a", c["path"], c["x"], c["y"], (), date_of(c["mjd"]),
                          f"{date_of(c['mjd'])}: an ordinary star, ringed", True)]
    if other:
        o, ox, oy = other
        panels.append(photo_panel("star-b", o["path"], ox, oy, (), date_of(o["mjd"]),
                                  f"{date_of(o['mjd'])}: the same star again", True))
    d, lam = det_line(c["det"], c["lam"])
    cards.append(dict(
        id="ordinary-star", section="in-sky", title="An ordinary star (for comparison)",
        looksLike="exactly what it is", label="confirmed",
        evidence=[f"Gaia DR3 {c['gaia']['id']}, G {c['gaia']['G']:.1f}, within 1 pixel",
                  f"S/N {c['sn']:.0f}; no artefact flags; no other Gaia star within 3 pixels",
                  ("Also seen in another photo of the same spot (S/N "
                   f"{other[0]['m']['sn']:.0f})") if other else "Not checked in another photo"],
        howToTell="A catalogued star that shows in every photo of the spot is just a star.",
        source=dict(photos=[c["obs"]] + ([other[0]["obs"]] if other else []), date=date_of(c["mjd"]),
                    detector=d, **{"lambda": lam}, at=f"{ra:.5f},{dec:.5f}"),
        panels=panels))

    # 5. A blend: WISE 0855 and its G 16.3 neighbour (the pack's own stacks; measured centres).
    pk = HERE.parent / "public" / "data" / "packs" / "dr1qr3" / "w0855"
    man = json.loads((pk / "manifest.json").read_text())
    n = man["grid"]["size"]
    later = 2
    frames = [f for f in man["frames"] if f["season"] == later]
    mjd = sum(f["mjd"] for f in frames) / len(frames)
    shift = json.loads((HERE / "targets.json").read_text())
    tl = shift["targets"] if isinstance(shift, dict) and "targets" in shift else shift
    cs = [x for x in tl if x.get("slug") == "w0855"][0]["spotFact"]["centreShift"]["may2026"]
    blend_panels, nstack = [], []
    st_all = [x for x in man["stacks"] if x["kind"] == "all-colour" and x["season"] == later][0]
    all_late = np.fromfile(pk / st_all["image"], "<f4").reshape(n, n)
    for det, lab in ((2, "D2 · 1.1–1.6 µm"), (6, "D6 · 4.4–5 µm")):
        st = [x for x in man["stacks"] if x["kind"] == "one-detector" and x["season"] == later and x["detectors"] == [det]][0]
        nstack.append(len(st["frameIds"]))
        img = np.fromfile(pk / st["image"], "<f4").reshape(n, n)
        fl = np.fromfile(pk / st["flags"], np.uint8).reshape(n, n)
        c0 = n / 2 - 0.5
        pimg = crop(img, c0, c0, np.nan)
        pmask = crop(((fl & 3) > 0).astype(np.uint8), c0, c0, 1)
        blend_panels.append(dict(write_panel(f"blend-d{det}", pimg, np.zeros((CUT, CUT), np.uint8), pmask),
                                 caption=lab, alt=f"WISE 0855's spot in {lab}, May 2026 stack",
                                 marks=blend_marks(img, all_late, man, mjd, c0)))
    cards.append(dict(
        id="blend", section="in-sky", title="Two sources in one pixel",
        looksLike="one object, maybe a new one", label="confirmed",
        evidence=["On 1 May 2026, WISE 0855’s predicted place and a Gaia star (G 16.3) are 6.4″ apart, about one SPHEREx pixel (6.15″); in November 2025 they were 9.5″ apart, because WISE 0855 moves",
                  "From the short colour to the long one, the light moves off the star, towards WISE 0855’s place",
                  f"Light centre: within {cs['D1_D4_fromGaia'].split('-')[-1]}″ of the star at 1.1–1.6 µm; {cs['D6']['fromGaia']}″ from it and {cs['D6']['fromW0855']}″ from WISE 0855 at 4.4–5 µm (centres good to about 1″)"],
        howToTell="If a catalogued star sits within a pixel or two, the spot is a blend: look at its colours, as “Two colours” does on WISE 0855’s page.",
        source=dict(photos=[f"stacks of {nstack[0]} (D2) and {nstack[1]} (D6) photos"], date=date_of(mjd),
                    detector="D2 and D6", **{"lambda": "1.1–1.6 and 4.4–5 µm"}, at=None),
        panels=blend_panels))

    (OUT / "cards.json").write_text(json.dumps(dict(
        note="Draft wording; Physics signs the labels and evidence before this is pushed.",
        rules="prereg/fieldguide/PLAN.md", cards=cards), indent=1, ensure_ascii=False))
    print(len(cards), "cards;", sorted(p_.name for p_ in OUT.iterdir())[:20])


def repick() -> None:
    import catalogs
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    flds = fields(idx["rows"])
    gaia_for_fields(flds)
    field_of = {r["path"]: f for f in flds for r in f["rows"]}
    cosmic, hits = [], []
    for i, row in enumerate(idx["rows"]):
        # Our own cache, written only by this pipeline on this machine (as build_pack's).
        e = pickle.loads((CACHE / row["path"]).read_bytes())
        src = mask_of(e, ("SOURCE",))
        badpx = mask_of(e, ("NONFUNC", "HOT"))
        for r in regions(e, ("TRANSIENT",), touch={"source": src, "badpx": badpx}):
            if r["sn"] < SN_MIN or r["touches"]["source"]:
                continue
            ra, dec = sky_of(e, r["x"], r["y"])
            g = gaia_near(field_of[row["path"]]["gaia"], ra, dec, row["mjd"])
            rec = dict(r, path=row["path"], obs=row["obs"], det=row["det"], mjd=row["mjd"], lam=row["lam"],
                       x0=int(e["x0"]), y0=int(e["y0"]), ra=round(ra, 6), dec=round(dec, 6))
            if g:
                # Star-hit candidates: the original rule (no SOURCE pixel) plus a Gaia match.
                hits.append(dict(rec, gaia=dict(id=g["id"], G=g["mag"], ra=g["ra"], dec=g["dec"],
                                               pmra=g["pmra"], pmdec=g["pmdec"], epoch=g["epoch"],
                                               sep_px=g["sep_px"])))
            elif not r["touches"]["badpx"]:
                # Cosmic ray: no SOURCE, no NONFUNC/HOT pixel, no Gaia star (Physics' re-pick).
                cosmic.append(rec)
        if i % 3000 == 0:
            print(i, len(cosmic), len(hits), flush=True)
    cosmic.sort(key=lambda r: -r["excess"])
    hits.sort(key=lambda r: -r["excess"])
    # Cosmic ray: the largest excess with no SkyBoT asteroid within 2 px (an unchecked one is skipped).
    chosen_c, checked = None, []
    for cand in cosmic[:15]:
        sb = skybot_near(cand["ra"], cand["dec"], cand["mjd"])
        checked.append(dict(obs=cand["obs"], skybot=None if sb is None else len(sb)))
        if sb == []:
            chosen_c = cand
            break
    # Star-hit: the star must show in >= 2 other photos, and the light here must match it within x2.
    idx_rows = idx["rows"]
    chosen_h, tried = None, []
    for cand in hits[:40]:
        g = cand["gaia"]
        here = pickle.loads((CACHE / cand["path"]).read_bytes())
        w = WCS(fits.Header.fromstring(here["wcs_hdr"]))
        gr, gd = catalogs.propagate(g, year_of(cand["mjd"]))
        px, py = w.all_world2pix(gr, gd, 0)
        m_here = measure(here, float(px) - here["x0"], float(py) - here["y0"], 1)
        seen = []
        for row in idx_rows:
            if row["det"] != cand["det"] or row["obs"] == cand["obs"] or sep_deg(row["ra"], row["dec"], gr, gd) > 0.3:
                continue
            e = pickle.loads((CACHE / row["path"]).read_bytes())
            w2 = WCS(fits.Header.fromstring(e["wcs_hdr"]))
            r2, d2 = catalogs.propagate(g, year_of(row["mjd"]))
            qx, qy = w2.all_world2pix(r2, d2, 0)
            m = measure(e, float(qx) - e["x0"], float(qy) - e["y0"], 1)
            if m and m["sn"] >= 5:
                seen.append(m["excess"])
        med = float(np.median(seen)) if seen else None
        ok = bool(m_here and len(seen) >= 2 and med and med > 0 and 0.5 <= m_here["excess"] / med <= 2)
        tried.append(dict(obs=cand["obs"], gaia=g["id"], G=g["G"], seen_in=len(seen), median_excess=med,
                          here_excess=m_here and m_here["excess"], ok=ok))
        if ok:
            chosen_h = dict(cand, star_median_excess=med, star_seen_in=len(seen), here_excess=m_here["excess"])
            break
    out = dict(cosmic=dict(n=len(cosmic), chosen=chosen_c, skybot_checked=checked),
               star_hit=dict(n=len(hits), chosen=chosen_h, tried=tried))
    (CACHE / "fieldguide_repick.json").write_text(json.dumps(out, indent=1, default=float))
    print("cosmic", len(cosmic), chosen_c and (chosen_c["obs"], chosen_c["det"], chosen_c["npix"],
                                               round(chosen_c["excess"], 2), round(chosen_c["sn"], 1)))
    print("star-hit", len(hits), "tried", len(tried), chosen_h and (chosen_h["obs"], chosen_h["gaia"]["G"],
                                                                   chosen_h["star_seen_in"]))


if __name__ == "__main__":
    {"index": index, "search": search, "select": select, "confirm": confirm,
     "named": named, "export": export, "repick": repick}[sys.argv[1]]()
