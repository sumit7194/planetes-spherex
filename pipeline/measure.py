"""Measurements for a target, made during the event from today's DR1+QR3 photos.

Movers (Barnard's Star, WISE 0855, Epsilon Indi B):
  - For each pass ("season") and detector, a median stack of the photos with every artefact
    flag masked (saturated cores included, so only the unsaturated PSF wings are fitted;
    OUTLIER is never masked).
  - A 2D Gaussian plus background fitted around the predicted position gives the centre.
  - Still stars: isolated, unsaturated Gaia DR3 stars in the same stacks, fitted the same way.
    Their median shift between two passes (after their own small proper motions) is the
    common shift of the frame; their scatter about it says how far a shift can be trusted.
  - Shift of the target = its fitted shift minus the common shift, median over detectors.
    MEASURED only if at least two detectors and three still stars agree (still-star 90th
    percentile <= 0.2 px); otherwise NOT_RELIABLE, with no number.
  - Prediction: catalogue proper motion plus parallax (Earth's position from astropy), for the
    same photos.
Variables (RW Aurigae, R Draconis):
  - Per detector, the scatter of the target's photometry about a straight line in wavelength,
    divided by the largest such scatter among comparison stars in the same photos.
  - brightness-change is never given a number here: NOT_MEASURABLE_YET when the target is
    saturated or flagged in nearly every photo, otherwise NOT_RELIABLE (no light curve yet).
"""

from __future__ import annotations

import itertools
import math

import numpy as np
from astropy import units as u
from astropy.coordinates import get_body_barycentric
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from scipy.optimize import least_squares

import build_pack as bp
import catalogs
import spherex as sx

SAT, REJ = 1, 2
PIX = 6.15


def earth_xyz(mjd: float) -> np.ndarray:
    p = get_body_barycentric("earth", Time(mjd, format="mjd", scale="tdb"))
    return np.array([p.x.to(u.au).value, p.y.to(u.au).value, p.z.to(u.au).value])


def apparent(src: dict, mjd: float) -> tuple[float, float]:
    """Catalogue position moved to an epoch by proper motion and (if known) parallax."""
    ra, dec = catalogs.propagate(src, catalogs.mjd_to_year(mjd))
    plx = src.get("plx") or 0.0
    if plx:
        X, Y, Z = earth_xyz(mjd)
        a, d = math.radians(ra), math.radians(dec)
        dra = plx * (X * math.sin(a) - Y * math.cos(a)) / 3.6e6 / math.cos(d)
        ddec = plx * (X * math.cos(a) * math.sin(d) + Y * math.sin(a) * math.sin(d) - Z * math.cos(d)) / 3.6e6
        ra, dec = ra + dra, dec + ddec
    return ra, dec


def masked_stack(arrays: dict, ids: list[str]) -> np.ndarray:
    ims = []
    for i in ids:
        img, fl, _ = arrays[i]
        ims.append(np.where((fl & (SAT | REJ)) != 0, np.nan, img))
    return np.nanmedian(np.stack(ims), 0)


def fit_centre(img: np.ndarray, x0: float, y0: float, rad: float = 3.5, fixed: list | None = None):
    """Centre of the source near (x0, y0): a 2D Gaussian plus background, fitted together with
    Gaussians at the fixed positions of known neighbours (catalogue stars), whose brightness is
    free. A neighbour left out would drag the centre towards it, and a moving source's blend
    with a still neighbour moves less than the source does."""
    fixed = [p for p in (fixed or []) if math.hypot(p[0] - x0, p[1] - y0) < rad + 1.5]
    n = img.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    r_all = np.hypot(xx - x0, yy - y0)
    m = (r_all <= rad) & np.isfinite(img)
    if m.sum() < 12 and rad >= 6:
        return None
    if m.sum() < 12:
        return fit_centre(img, x0, y0, rad=6.0, fixed=fixed)
    if (r_all <= 1.5).sum() and not np.isfinite(img[r_all <= 1.5]).any() and rad < 6:
        # A saturated core is masked out: fit the unsaturated wings over a wider area.
        return fit_centre(img, x0, y0, rad=6.0, fixed=fixed)
    X, Y, V = xx[m], yy[m], img[m]
    ring = (r_all > rad + 1.5) & (r_all < rad + 5.5) & np.isfinite(img)
    bg0 = float(np.median(img[ring])) if ring.sum() > 10 else float(np.median(V))
    amp0 = max(float(np.nanmax(V) - bg0), 1e-6)
    k = len(fixed)

    def model(p):
        a, cx, cy, s, b = p[:5]
        v = a * np.exp(-((X - cx) ** 2 + (Y - cy) ** 2) / (2 * s * s)) + b
        for j, (fx, fy) in enumerate(fixed):
            v = v + p[5 + j] * np.exp(-((X - fx) ** 2 + (Y - fy) ** 2) / (2 * s * s))
        return v

    lo = [0, x0 - 2, y0 - 2, 0.35, -np.inf] + [0] * k
    hi = [np.inf, x0 + 2, y0 + 2, 3.0, np.inf] + [np.inf] * k
    p0 = [amp0, x0, y0, 0.8, bg0] + [amp0 * 0.5] * k
    try:
        r = least_squares(lambda p: model(p) - V, p0, bounds=(lo, hi))
    except Exception:  # noqa: BLE001
        return None
    a, cx, cy, s, b = r.x[:5]
    noise = 1.4826 * np.median(np.abs(img[ring] - np.median(img[ring]))) if ring.sum() > 10 else np.std(V)
    if a < 5 * noise or not r.success:
        return None
    return float(cx), float(cy)


def grid_xy(gw: WCS, ra: float, dec: float) -> tuple[float, float]:
    x, y = gw.world_to_pixel_values(ra, dec)
    return float(x), float(y)


def m_entry(key, value, unit, status, method, basis, error=None, prediction=None):
    e = dict(key=key, value=None if value is None else round(float(value), 4), unit=unit, status=status,
             method=method, basis=basis, provenance="SpaceAppChallenge pipeline/measure.py, DR1+QR3 fetched 14 Nov 2026")
    if error is not None:
        e["error"] = round(float(error), 4)
    if prediction is not None:
        e["prediction"] = prediction
    return e


def pair_result(a, b, dets_ok, fits_t, fits_s, still, gw, mid, src):
    dxs, dys, rel_x, rel_y, still_res, used = [], [], [], [], [], []
    for d in dets_ok:
        fa, fb = fits_t.get((a, d)), fits_t.get((b, d))
        if not fa or not fb:
            continue
        sh = []
        for k, s_ in enumerate(still):
            pa, pb = fits_s.get((a, d, k)), fits_s.get((b, d, k))
            if not pa or not pb:
                continue
            ea = grid_xy(gw, *catalogs.propagate(s_, catalogs.mjd_to_year(mid[a])))
            eb = grid_xy(gw, *catalogs.propagate(s_, catalogs.mjd_to_year(mid[b])))
            sh.append(((pb[0] - pa[0]) - (eb[0] - ea[0]), (pb[1] - pa[1]) - (eb[1] - ea[1])))
        dx, dy = fb[0] - fa[0], fb[1] - fa[1]
        dxs.append(dx)
        dys.append(dy)
        if len(sh) >= 3:
            cx = float(np.median([v[0] for v in sh]))
            cy = float(np.median([v[1] for v in sh]))
            rel_x.append(dx - cx)
            rel_y.append(dy - cy)
            still_res += [math.hypot(v[0] - cx, v[1] - cy) for v in sh]
            used.append(d)
    if not dxs:
        return None
    p90 = float(np.percentile(still_res, 90)) if still_res else None
    return dict(dxs=dxs, dys=dys, rel_x=rel_x, rel_y=rel_y, still_res=still_res, used=used,
                reliable=len(used) >= 2 and p90 is not None and p90 <= 0.2)


def measure_mover(t, frames, arrays, size, gw, catalog):
    seasons = sorted({f["season"] for f in frames})
    dets_ok = t.get("motionDets") or [1, 2, 3, 4, 5, 6]
    # Each pass's time: the median time of the photos actually fitted (the motion detectors only).
    mid = {s: float(np.median([f["mjd"] for f in frames if f["season"] == s and f["detector"] in dets_ok]
                              or [f["mjd"] for f in frames if f["season"] == s])) for s in seasons}
    stacks, ids_of = {}, {}
    for s in seasons:
        for d in dets_ok:
            ids = [f["id"] for f in frames if f["season"] == s and f["detector"] == d]
            if len(ids) >= 3:
                stacks[(s, d)] = (masked_stack(arrays, ids), len(ids))
                ids_of[(s, d)] = ids
    src = dict(ra=t["ra"], dec=t["dec"], pmra=t.get("pmra", 0), pmdec=t.get("pmdec", 0), epoch=t.get("epoch", 2026.0), plx=t.get("plx"))
    # Still stars: unsaturated-looking, isolated, slow Gaia stars, away from the target and the edges.
    tx, ty = grid_xy(gw, *apparent(src, mid[seasons[0]]))
    still = []
    gpos = [(s_, grid_xy(gw, *catalogs.propagate(s_, 2026.0))) for s_ in catalog]
    for s_, (x, y) in gpos:
        if s_["mag"] is None or not (9.5 <= s_["mag"] <= 17.0):
            continue
        if not (6 <= x <= size - 7 and 6 <= y <= size - 7):
            continue
        if math.hypot(x - tx, y - ty) < 6:
            continue
        # Neighbours are fitted together with the star; only a comparably bright one very close is fatal.
        if any(o is not s_ and math.hypot(x - ox, y - oy) < 2.0 for o, (ox, oy) in gpos if (o["mag"] or 99) < s_["mag"] + 1.5):
            continue
        if abs(s_["pmra"]) > 200 or abs(s_["pmdec"]) > 200:
            continue
        still.append(s_)
    fits_t, fits_s = {}, {}
    fit_setup = {}  # (s, d) -> (predicted x, y, fixed neighbour positions), reused by the bootstrap
    neigh_used = set()
    for (s, d), (img, _n) in stacks.items():
        px, py = grid_xy(gw, *apparent(src, mid[s]))
        year = catalogs.mjd_to_year(mid[s])
        others = [(o, grid_xy(gw, *catalogs.propagate(o, year))) for o in catalog if (o["mag"] or 99) < 19.5]
        # Catalogue stars near the target (but not the target itself, if it is catalogued).
        near_t = [(o, p) for o, p in others if 0.5 < math.hypot(p[0] - px, p[1] - py) < 5]
        neigh_used |= {o["id"] for o, _ in near_t if math.hypot(_[0] - px, _[1] - py) < 5}
        fits_t[(s, d)] = fit_centre(img, px, py, fixed=[p for _, p in near_t])
        fit_setup[(s, d)] = (px, py, [p for _, p in near_t])
        if fits_t[(s, d)] is None:
            nn = img.shape[0]
            yy_, xx_ = np.mgrid[0:nn, 0:nn]
            ok = int((np.hypot(xx_ - px, yy_ - py) <= 3.5).sum() - (~np.isfinite(img[np.hypot(xx_ - px, yy_ - py) <= 3.5])).sum())
            print(f"  target fit failed: pass {s} D{d}, finite pixels within 3.5 px: {ok}, neighbours fixed: {len(near_t)}")
        for k, s_ in enumerate(still):
            sx_, sy_ = grid_xy(gw, *catalogs.propagate(s_, year))
            near_s = [p for o, p in others if o is not s_ and math.hypot(p[0] - sx_, p[1] - sy_) < 5]
            fits_s[(s, d, k)] = fit_centre(img, sx_, sy_, rad=3.0, fixed=near_s)

    out = []
    first, last = seasons[0], seasons[-1]
    pm_total = math.hypot(src["pmra"], src["pmdec"]) / 1000
    out.append(m_entry("proper-motion-arcsec-per-yr", pm_total, "arcsec/yr", "PREDICTED",
                       f"catalogue proper motion ({t.get('pmSource', 'catalogue')})", [t.get("pmSource", "catalogue")]))
    pairs = list(itertools.combinations(seasons, 2))
    results = {}
    for a, b in pairs:
        results[(a, b)] = pair_result(a, b, dets_ok, fits_t, fits_s, still, gw, mid, src)
    for p_, r_ in results.items():
        if r_:
            p90_ = float(np.percentile(r_["still_res"], 90)) if r_["still_res"] else None
            print(f"  pair {p_}: fits in {len(r_['dxs'])} detectors, still-star-corrected in {r_['used']}, still stars {len(still)}, p90 {p90_}")
        else:
            print(f"  pair {p_}: no fits")
    def bootstrap(a, b, r, n_boot=30):
        """Spread of the still-star-corrected shift when each stack's photos are resampled with
        replacement (the still stars' common shift is held at its fitted value)."""
        rng = np.random.default_rng(20261114)
        fitted = [d for d in dets_ok if fits_t.get((a, d)) and fits_t.get((b, d))]
        common = {}
        k = 0
        for d in fitted:
            if d in r["used"]:
                i = r["used"].index(d)
                common[d] = ((fits_t[(b, d)][0] - fits_t[(a, d)][0]) - r["rel_x"][i],
                             (fits_t[(b, d)][1] - fits_t[(a, d)][1]) - r["rel_y"][i])
            k += 1
        es, ns = [], []
        for _ in range(n_boot):
            xs, ys = [], []
            for d, (cx, cy) in common.items():
                got = []
                for s_ in (a, b):
                    ids = ids_of[(s_, d)]
                    img = masked_stack(arrays, list(rng.choice(ids, len(ids))))
                    px, py, fixed = fit_setup[(s_, d)]
                    got.append(fit_centre(img, px, py, fixed=fixed))
                if got[0] and got[1]:
                    xs.append(got[1][0] - got[0][0] - cx)
                    ys.append(got[1][1] - got[0][1] - cy)
            if xs:
                es.append(-float(np.median(xs)))
                ns.append(float(np.median(ys)))
        if len(es) < 10:
            return None, None
        return float(np.std(es, ddof=1)), float(np.std(ns, ddof=1))

    good = [p for p in pairs if results[p] and results[p]["reliable"]]
    headline = max(good, key=lambda p: mid[p[1]] - mid[p[0]]) if good else (first, last)
    for a, b in pairs:
        r = results[(a, b)]
        if not r:
            continue
        suffix = "" if (a, b) == headline else f"-s{a}s{b}"
        dxs, dys, rel_x, rel_y, still_res, used = r["dxs"], r["dys"], r["rel_x"], r["rel_y"], r["still_res"], r["used"]
        pa_ = grid_xy(gw, *apparent(src, mid[a]))
        pb_ = grid_xy(gw, *apparent(src, mid[b]))
        pred_e, pred_n = -(pb_[0] - pa_[0]), pb_[1] - pa_[1]
        span = mid[b] - mid[a]
        med = lambda v: float(np.median(v))  # noqa: E731
        def err(v):
            # Scatter between detectors, with a floor from the still stars' own residuals.
            if len(v) < 2:
                return 0.3
            stat = float(np.std(v, ddof=1)) / math.sqrt(len(v))
            floor = (float(np.median(still_res)) if still_res else 0.1) / math.sqrt(len(v))
            return max(0.05, math.hypot(stat, floor))
        p90 = float(np.percentile(still_res, 90)) if still_res else None
        reliable = r["reliable"]
        basis = [f"one-detector stacks, passes {a + 1} and {b + 1}, detectors {', '.join(map(str, used or dets_ok))}",
                 *([f"fitted together with {len(neigh_used)} catalogued neighbour(s) within 5 px"] if neigh_used else []),
                 f"{len(still)} Gaia DR3 still stars in the field",
                 "flags masked: saturated and artefact pixels (OUTLIER kept)"]
        method = (f"2D Gaussian fit to the unsaturated PSF of each pass's stack, minus the still stars' common shift; "
                  f"median over detectors (season {a} -> {b})")
        n_a = sum(stacks[(a, d)][1] for d in (used or dets_ok) if (a, d) in stacks)
        n_b = sum(stacks[(b, d)][1] for d in (used or dets_ok) if (b, d) in stacks)
        basis = basis + [f"season {a}: {n_a} exposures", f"season {b}: {n_b} exposures"]
        pred_src = f"{t.get('pmSource', 'catalogue')} proper motion" + (" plus parallax" if src.get("plx") else "")
        if reliable:
            e_val, n_val = -med(rel_x), med(rel_y)
            be, bn = bootstrap(a, b, r)
            # The larger of: the scatter between detectors (with the still-star floor), and the
            # spread when each stack's photos are resampled.
            ex = max(err(rel_x), be or 0.0)
            ny = max(err(rel_y), bn or 0.0)
            method = method.replace(" (season", "; error: the larger of the detector scatter and a 30-draw bootstrap over photos (season")
            st = "MEASURED"
        else:
            e_val = n_val = None
            ex = ny = None
            st = "NOT_RELIABLE"
        for key, val, er, pr in (("shift-east-px", e_val, ex, pred_e), ("shift-north-px", n_val, ny, pred_n)):
            out.append(m_entry(key + suffix, val, "px", st, method, basis, er, dict(value=round(pr, 4), source=pred_src)))
            out.append(m_entry(key.replace("-px", "-arcsec") + suffix, None if val is None else val * PIX, "arcsec", st,
                               f"{key + suffix} x {PIX} arcsec per pixel (season {a} -> {b})", [key + suffix], None if er is None else er * PIX,
                               dict(value=round(pr * PIX, 3), source=pred_src)))
        out.append(m_entry("season-span-days" + suffix, span, "days", "MEASURED", f"difference of the passes' median photo times (season {a} -> {b})", basis[:1]))
        # Raw (uncorrected) shift and the still stars' behaviour, for the "how sure" line.
        out.append(m_entry("shift-east-px-raw" + suffix, -med(dxs), "px", "MEASURED", f"fitted shift before the still-star correction (season {a} -> {b})", basis[:1]))
        out.append(m_entry("shift-north-px-raw" + suffix, med(dys), "px", "MEASURED", f"fitted shift before the still-star correction (season {a} -> {b})", basis[:1]))
        if still_res:
            out.append(m_entry("still-star-shift-px" + suffix, float(np.median(still_res)), "px", "MEASURED",
                               f"median distance of still stars from their common shift (season {a} -> {b})", basis[1:2]))
            out.append(m_entry("still-star-shift-p90-px" + suffix, p90, "px", "MEASURED",
                               f"90th percentile distance of still stars from their common shift (season {a} -> {b})", basis[1:2]))
    return out


WING_BAD = sx.SATURATION + ["TRANSIENT", "NONFUNC", "HOT", "COLD", "PERSIST", "CROSSTALK", "STREAK", "MISSING_DATA"]


def wing_index(e: dict, ra: float, dec: float, r_in: float, r_out: float):
    """Background-subtracted median surface brightness of a star's PSF wings (r_in..r_out native
    px), from pixels with no saturation or artefact flag. Proportional to the star's brightness
    for a fixed PSF, i.e. at one wavelength on one detector."""
    w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
    x, y = (float(v) for v in w.world_to_pixel_values(ra, dec))
    x -= e["x0"]
    y -= e["y0"]
    img = e["img"]
    H, W = img.shape
    edge = r_out + 7
    if not (edge < x < W - edge and edge < y < H - edge):
        return None
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.hypot(xx - x, yy - y)
    bad = sx.mask_of(e, WING_BAD)
    ring_all = (r >= r_in) & (r <= r_out)
    ring = ring_all & ~bad & np.isfinite(img)
    bg = (r >= r_out + 3) & (r <= r_out + 6) & ~bad & np.isfinite(img)
    if ring.sum() < 0.6 * ring_all.sum() or bg.sum() < 30:
        return None
    return float(np.median(img[ring]) - np.median(img[bg]))


def wing_ratios(exps: list, ra: float, dec: float, r_in: float, r_out: float):
    """Brightness ratio between every pair of passes, per detector, from photos matched in
    wavelength (within half a resolution element, about lambda/80): median and its error."""
    pts = []
    for e in exps:
        v = wing_index(e, ra, dec, r_in, r_out)
        if v is not None and v > 0:
            pts.append((e["pass"], e["det"], e["lam"], v))
    out = {}
    passes = sorted({p[0] for p in pts})
    for a, b in itertools.combinations(passes, 2):
        for d in range(1, 7):
            A = [p for p in pts if p[0] == a and p[1] == d]
            B = [p for p in pts if p[0] == b and p[1] == d]
            rr = [pb[3] / pa[3] for pa in A for pb in B if abs(pa[2] - pb[2]) < pa[2] / 80]
            if len(rr) >= 3:
                rr = np.array(rr)
                m = float(np.median(rr))
                out[(a, b, d)] = (m, 1.4826 * float(np.median(np.abs(rr - m))) / math.sqrt(len(rr)), len(rr))
    return out, len(pts)


def measure_wings(t, exps, catalog):
    """Brightness change of a saturated star from its PSF wings, checked three ways: two rings must
    agree, the change must stand out from comparison stars measured the same way in the same
    photos, and enough matched photo pairs must exist."""
    out = []
    # The brighter the star, the further out its saturation reaches: use the innermost ring that
    # at least half the photos can measure, and check it against the next ring out.
    rings = [(3.0, 6.0), (5.0, 9.0), (8.0, 13.0), (12.0, 18.0), (16.0, 24.0), (22.0, 32.0)]
    inner, n_in, k_in = {}, 0, 0
    for k, (r0, r1) in enumerate(rings[:-1]):
        inner, n_in = wing_ratios(exps, t["ra"], t["dec"], r0, r1)
        k_in = k
        if n_in >= 0.5 * len(exps):
            break
    outer, _ = wing_ratios(exps, t["ra"], t["dec"], *rings[k_in + 1])
    ring_txt = (f"{rings[k_in][0]:g}-{rings[k_in][1]:g} px", f"{rings[k_in + 1][0]:g}-{rings[k_in + 1][1]:g} px")
    # Comparison stars: Gaia stars in the field, not the target, with plenty of usable photos.
    devs, n_ctrl = [], 0
    for s_ in sorted((g for g in catalog if g["mag"] is not None and g["mag"] < 14.0), key=lambda g: g["mag"])[:10]:
        ra, dec = catalogs.propagate(s_, 2026.0)
        if math.hypot((ra - t["ra"]) * math.cos(math.radians(dec)), dec - t["dec"]) * 3600 < 40:
            continue
        rc, nc = wing_ratios(exps, ra, dec, 3.0, 6.0)
        if nc < 200:
            continue
        n_ctrl += 1
        devs += [((v[0] - 1) ** 2, v[1] ** 2) for v in rc.values() if v[2] >= 10]
    # Systematic error: the comparison stars' scatter beyond their own statistical errors (they are
    # much fainter than a saturated target, so their raw scatter is mostly their own noise).
    sys_err = (math.sqrt(max(0.0, float(np.median([d2 - e2 for d2, e2 in devs])))) if len(devs) >= 6 else None)
    if sys_err is not None:
        sys_err = max(sys_err, 0.05)  # never claim better than 5%
    passes = sorted({k[0] for k in inner} | {k[1] for k in inner})
    if not passes:
        return out
    first, last = passes[0], passes[-1]
    measured_any = []
    import json as _json
    from pathlib import Path as _Path
    vpath = _Path(__file__).parent / "wing_validation.json"
    valid = _json.loads(vpath.read_text()) if vpath.exists() else None
    for (a, b, d), (m, e_stat, n) in sorted(inner.items()):
        o = outer.get((a, b, d))
        suffix = "" if (a, b) == (first, last) else f"-s{a}s{b}"
        agree = o is not None and abs(o[0] - m) <= 0.1 * m
        err = math.hypot(e_stat, sys_err or 0)
        steady = valid is not None and valid["detectors"][str(d)]["passes"]
        ok = steady and sys_err is not None and n_ctrl >= 2 and n >= 10 and agree and abs(m - 1) > 3 * err
        basis = [f"{n} photo pairs matched in wavelength (within lambda/80), detector {d}, passes {a + 1} and {b + 1}",
                 (f"ring {ring_txt[0]}: {m:.3f}; ring {ring_txt[1]}: {o[0]:.3f} ("
                  + ("agree within 10%" if agree else "disagree by more than 10%")
                  + "; a partial check that the result doesn't depend on which part of the wing is measured, "
                  "which matters because a dimmer star's saturated core is smaller)") if o else "outer ring: too few photos",
                 f"comparison stars: {n_ctrl} Gaia stars; systematic error {sys_err:.3f} (their scatter beyond their own noise, at least 0.05)" if sys_err is not None else "comparison stars: too few",
                 (("steady-star test passed: Barnard's Star, saturated but steady, gives "
                   + ", ".join(f"{k} {v[0]:.2f}" for k, v in valid["detectors"][str(d)]["ratios"].items()) + " in this detector")
                  if steady else
                  ("steady-star test failed: on Barnard's Star, saturated but steady, this detector gives "
                   + ", ".join(f"{k} {v[0]:.2f}" for k, v in valid["detectors"][str(d)]["ratios"].items()) + ", so its wing ratios are not trusted"))
                 if valid else "steady-star test not run"]
        if valid and steady:
            basis.append("the steady-star tolerance (1.00 +/- 0.06) was chosen after seeing that test's results")
        if t.get("blendNote"):
            basis.append(t["blendNote"])
        method = f"ratio of PSF-wing brightness between passes (saturated core left out), photos paired at matching wavelengths (season {a} -> {b})"
        if not ok:
            failed = [why for cond, why in (
                (steady, "fails the steady-star test"),
                (sys_err is not None and n_ctrl >= 2, "too few comparison stars"),
                (n >= 10, f"only {n} matched photo pairs (10 needed)"),
                (agree, "the two rings disagree by more than 10%"),
                (abs(m - 1) > 3 * err, f"the change ({m:.2f}) is within 3 errors of no change"),
            ) if not cond]
            basis.insert(0, "not reliable: " + "; ".join(failed))
        out.append(m_entry(f"brightness-ratio-detector-{d}{suffix}", m if ok else None, "ratio",
                           "MEASURED" if ok else "NOT_RELIABLE", method, basis, err if ok else None))
        if ok and suffix == "":
            measured_any.append((d, m, err))
    if measured_any:
        ds = ", ".join(f"D{d} {m:.2f}" for d, m, _ in measured_any)
        med = float(np.median([m for _, m, _ in measured_any]))
        out.append(m_entry("brightness-change", med, "ratio", "MEASURED",
                           f"median over the detectors that pass, of the wing-brightness ratio, last pass / first pass; it differs by wavelength (season {first} -> {last})",
                           [ds, f"passes {first + 1} -> {last + 1}"] + ([t["blendNote"]] if t.get("blendNote") else []),
                           float(np.median([e for _, _, e in measured_any]))))
    else:
        why = [f"{n_in} wing measurements of the star (ring {ring_txt[0]})"]
        if sys_err is not None and sys_err > 0.2:
            why.append(f"the comparison stars vary by {sys_err:.0%} between passes: in this field they sit in the star's own glare, so the method can't be checked here")
        elif sys_err is None:
            why.append("too few comparison stars in the field to check the method")
        out.append(m_entry("brightness-change", None, "ratio", "NOT_RELIABLE",
                           "PSF-wing brightness ratios did not pass the checks (ring agreement, comparison stars, photo pairs)", why))
    return out


def measure_variable(t, frames, arrays, catalog, gw, size, spec):
    out = []
    pts = spec
    n_all = len(pts)
    n_bad = sum(1 for p in pts if p["flagged"] or p["saturated"])
    if n_all == 0 or n_bad >= 0.9 * n_all:
        # Too bright for aperture photometry: measure the unsaturated PSF wings instead.
        exps = [arrays[f["id"]][2] | {"pass": f["season"]} for f in frames]
        wings = measure_wings(t, exps, catalog)
        if wings:
            return wings
        out.append(m_entry("brightness-change", None, "ratio", "NOT_MEASURABLE_YET",
                           "aperture photometry per photo", [f"{n_bad} of {n_all} photos saturated or flagged at the star"]))
        return out
    # Comparison stars: isolated Gaia stars, photometry in the same photos.
    tx, ty = grid_xy(gw, t["ra"], t["dec"])
    comps = []
    for s_ in catalog:
        if s_["mag"] is None or not (8.0 <= s_["mag"] <= 14.5):
            continue
        x, y = grid_xy(gw, *catalogs.propagate(s_, 2026.0))
        if not (8 <= x <= size - 9 and 8 <= y <= size - 9) or math.hypot(x - tx, y - ty) < 8:
            continue
        comps.append(s_)
    comps = comps[:30]
    by_frame = {f["id"]: f for f in frames}
    for d in range(1, 7):
        tgt = [p for p in pts if p["detector"] == d and not p["flagged"]]
        if len(tgt) < 10:
            out.append(m_entry(f"scatter-ratio-detector-{d}", None, "ratio", "NO_DATA", "too few clean photos", [f"{len(tgt)} target exposures"]))
            continue
        def frac_rms(lams, fl):
            lams, fl = np.asarray(lams), np.asarray(fl)
            if len(fl) < 8 or np.median(fl) <= 0:
                return None
            c = np.polyfit(lams, fl, 1)
            r = fl - np.polyval(c, lams)
            return 1.4826 * float(np.median(np.abs(r - np.median(r)))) / float(np.median(fl))
        t_rms = frac_rms([p["lambdaUm"] for p in tgt], [p["fluxUJy"] for p in tgt])
        c_rms = []
        for s_ in comps:
            lams, fl = [], []
            for p in tgt:
                e = arrays[p["frame"]][2]
                w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
                ra, dec = catalogs.propagate(s_, catalogs.mjd_to_year(e["mjd"]))
                strict_m = sx.mask_of(e, sx.STRICT)
                ph = bp.photometry(e, w, ra, dec, np.where(sx.mask_of(e, sx.DISPLAY), np.nan, e["img"]), strict_m, sx.mask_of(e, sx.SATURATION))
                if ph and not ph["flagged"]:
                    lams.append(e["lam"])
                    fl.append(ph["flux"])
            r = frac_rms(lams, fl)
            if r is not None:
                c_rms.append(r)
        if t_rms is None or len(c_rms) < 3:
            out.append(m_entry(f"scatter-ratio-detector-{d}", None, "ratio", "NOT_RELIABLE", "too few comparison stars",
                               [f"{len(tgt)} target exposures, {len(c_rms)} control stars"]))
            continue
        ratio = t_rms / max(c_rms)
        out.append(m_entry(f"scatter-ratio-detector-{d}", ratio, "ratio", "MEASURED",
                           "target's scatter about a straight line in wavelength, divided by the largest comparison star's",
                           [f"{len(tgt)} target exposures, {len(c_rms)} control stars"]))
    out.append(m_entry("brightness-change", None, "ratio", "NOT_RELIABLE",
                       "no light curve yet: each photo sees a different wavelength", [f"{n_all} photos"]))
    return out


def measure_target(t, frames, arrays, stacks, out_dir, gw, size, catalog, spec):
    if t.get("kind") == "mover":
        return measure_mover(t, frames, arrays, size, gw, catalog)
    return measure_variable(t, frames, arrays, catalog, gw, size, spec)
