"""Field guide ("What fools you"): find real examples by the fixed rules in prereg/fieldguide/PLAN.md.

Step 1 (`index`): every cached photo box, placed on the sky from its own WCS, with any box within 1 deg
of a V or T patch centre dropped BEFORE its pixels are read (T is reserved for the ranker's one
locked score). Writes cache/fieldguide_index.json: one row per allowed box (path, photo, detector,
MJD, box-centre RA/Dec).

Step 2 (`search`): per kind, every connected flagged region in every allowed box; its excess light
(image minus the median of the unflagged pixels 3-8 px outside it) and S/N (excess over the ring's
robust scatter times sqrt(pixels)). The instance with the largest excess at S/N >= 5 is the
example; written to cache/fieldguide_search.json with the top 5 per kind for the record.

Usage: uv run python fieldguide.py index | search
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


def regions(e: dict, names) -> list[dict]:
    """Every connected flagged region of these names, with its excess light and S/N."""
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


if __name__ == "__main__":
    {"index": index, "search": search}[sys.argv[1]]()
