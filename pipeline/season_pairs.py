"""Season-pair search for slow movers: a prototype (queue #9; the engine piece both Physics and
Neural named as missing; v4 finds fast movers within a visit, not stars moving between seasons).

Blind on purpose: it is NOT told where the target is. For each pack field (64 x 64 px at 6.15",
the five targets' packs), for each pair of seasons:
  1. Find point sources in the all-seasons median of the one-detector stacks (local maxima above
     5 robust sigma, away from edges, not saturated or flagged).
  2. Fit each source's position (2-D Gaussian on a 7 x 7 box, free background) in each season's
     stack, per detector.
  3. Remove the common shift per detector: the median shift of sources matched to Gaia stars
     moving < 50 mas/yr (Physics: so a crowd of real movers can't bias it; all sources if fewer
     than 3 match). The removed shift is reported per detector.
  4. Sources inside a bright star's glare (a saturated blob of >= 6 px; radius 3*sqrt(area),
     6-16 px) are vetoed:
     a bright mover's moving halo drags a faint neighbour's fitted position along with it (seen
     on Barnard's field: a steady G 16.7 star 65" away "moved" 5"/yr north, Barnard's direction).
  5. A source is a CANDIDATE when its shift is consistent across >= 2 detectors (each detector's
     shift within 3 sigma of the others' mean) and the mean shift exceeds 5x the steady stars'
     robust scatter for that pair (and 0.3 px, the registration floor Physics uses).

Reports, per field and season pair: sources found, the steady-star scatter, the candidates with
their shift (px and arcsec/yr), and whether the field's own target is among them (checked only
afterwards, against its known position).

Usage: python season_pairs.py [--out ../notes/season_pairs.json]
"""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter
from scipy.optimize import least_squares

PACKS = Path(__file__).parent.parent / "public" / "data" / "packs" / "dr1qr3"
PIX = 6.15
BAD = 1 | 2  # FlagMask: saturated, rejected
SAT = 1


def load(slug: str):
    m = json.loads((PACKS / slug / "manifest.json").read_text())
    n = m["grid"]["size"]
    frames = {f["id"]: f for f in m["frames"]}
    stacks = {}
    for s in m["stacks"]:
        if s["kind"] != "one-detector":
            continue
        img = np.fromfile(PACKS / slug / s["image"], "<f4").reshape(n, n).astype(float)
        fl = np.fromfile(PACKS / slug / s["flags"], "u1").reshape(n, n)
        mjd = float(np.mean([frames[i]["mjd"] for i in s["frameIds"] if i in frames]))
        stacks[(s["season"], s["detectors"][0])] = dict(img=np.where(fl & BAD, np.nan, img), mjd=mjd, sat=(fl & SAT) > 0)
    return m, stacks


def robust_sigma(a):
    a = a[np.isfinite(a)]
    return 1.4826 * np.median(np.abs(a - np.median(a))) if a.size else np.nan


def find_sources(ref: np.ndarray, nsig=5.0, edge=5):
    s = robust_sigma(ref)
    z = np.nan_to_num(ref, nan=-np.inf)
    pk = (z == maximum_filter(z, 5)) & (z > np.nanmedian(ref) + nsig * s)
    pk[:edge] = pk[-edge:] = False
    pk[:, :edge] = pk[:, -edge:] = False
    ys, xs = np.nonzero(pk)
    return list(zip(xs.astype(float), ys.astype(float), ref[ys, xs]))


def fit(img: np.ndarray, x0: float, y0: float, r=3):
    """2-D Gaussian (sigma free, round) + background on a (2r+1)^2 box; None if it fails."""
    xi, yi = int(round(x0)), int(round(y0))
    box = img[yi - r: yi + r + 1, xi - r: xi + r + 1]
    if box.shape != (2 * r + 1, 2 * r + 1) or np.isnan(box).sum() > 4:
        return None
    yy, xx = np.mgrid[-r: r + 1, -r: r + 1]
    ok = np.isfinite(box)

    def model(p):
        # A sloped background, so a neighbour's halo gradient doesn't pull the centre.
        a, dx, dy, sg, b, bx, by = p
        return a * np.exp(-((xx - dx) ** 2 + (yy - dy) ** 2) / (2 * sg * sg)) + b + bx * xx + by * yy

    p0 = [np.nanmax(box) - np.nanmedian(box), 0, 0, 0.9, np.nanmedian(box), 0, 0]
    try:
        res = least_squares(lambda p: (model(p) - box)[ok], p0,
                            bounds=([0, -2, -2, 0.4, -np.inf, -np.inf, -np.inf],
                                    [np.inf, 2, 2, 3, np.inf, np.inf, np.inf]))
    except Exception:  # noqa: BLE001
        return None
    if not res.success:
        return None
    return xi + res.x[1], yi + res.x[2]


def quiet_gaia(slug: str, n: int, season: int):
    """Grid pixels of Gaia stars moving < 50 mas/yr at a season's mean epoch (overlay file)."""
    path = Path(__file__).parent.parent / "public" / "data" / "overlays" / f"overlay_{slug}.json"
    if not path.exists():
        return []
    d = json.loads(path.read_text().replace("NaN", "null"))
    c = (n - 1) / 2
    out = []
    for r in d.get("gaia_dr3", []):
        pm = np.hypot(r.get("pmra_mas_yr") or 0, r.get("pmdec_mas_yr") or 0)
        at = r.get("at_season", {}).get(str(season))
        if at and pm < 50 and not r.get("target"):
            out.append((c - at[2] / PIX, c + at[3] / PIX))
    return out


def search(slug: str):
    m, stacks = load(slug)
    n = m["grid"]["size"]
    return search_stacks(stacks, n, lambda season: quiet_gaia(slug, n, season))


def search_stacks(stacks: dict, n: int, quiet_for, pairs=None, keep_all: bool = False):
    """The search on any one-detector stacks {(season, det): {img, mjd, sat}}: the packs' seasons,
    or the yardstick's helper-read fields (field_stacks.py). quiet_for(season) gives the grid
    pixels of Gaia stars moving < 50 mas/yr; pairs limits which season pairs are compared (the
    split-pass null N-A compares only each pass's two halves)."""
    seasons = sorted({s for s, _ in stacks})
    dets = sorted({d for _, d in stacks})
    ref = np.nanmedian(np.stack([v["img"] for v in stacks.values()]), axis=0)
    srcs = find_sources(ref)
    # Glare veto: only near big saturated blobs (bright stars), radius growing with the blob,
    # and never a star vetoing itself (a source within 3 px of a blob's centre IS that star).
    from scipy.ndimage import label
    sat_any = np.any(np.stack([v["sat"] for v in stacks.values()]), axis=0)
    lab, nb = label(sat_any)
    blobs = []
    for k in range(1, nb + 1):
        yy_, xx_ = np.nonzero(lab == k)
        if len(yy_) >= 6:
            blobs.append((xx_.mean(), yy_.mean(), float(np.clip(3 * np.sqrt(len(yy_)), 6, 16))))

    def in_glare(x, y):
        return any(3 < np.hypot(x - bx, y - by) < r for bx, by, r in blobs)

    vetoed = sum(1 for x, y, _ in srcs if in_glare(x, y))
    yy_g, xx_g = np.mgrid[0:n, 0:n]
    not_searched = float(np.mean([in_glare(x, y) or sat_any[y, x] for y, x in zip(yy_g.ravel(), xx_g.ravel())]))
    srcs = [s_ for s_ in srcs if not in_glare(s_[0], s_[1])]
    c = (n - 1) / 2
    out = []
    for a, b in (pairs if pairs is not None else itertools.combinations(seasons, 2)):
        per = {}  # source index -> {det: (dx, dy)}
        years = []
        for d in dets:
            if (a, d) not in stacks or (b, d) not in stacks:
                continue
            years.append((stacks[(b, d)]["mjd"] - stacks[(a, d)]["mjd"]) / 365.25)
            for i, (x, y, _) in enumerate(srcs):
                pa = fit(stacks[(a, d)]["img"], x, y)
                pb = fit(stacks[(b, d)]["img"], x, y)
                if pa and pb:
                    per.setdefault(i, {})[d] = (pb[0] - pa[0], pb[1] - pa[1])
        if not per:
            continue
        # common shift per detector, from Gaia-quiet stars, then each source's residual shift
        quiet = quiet_for(a)
        is_quiet = {i for i, (x, y, _) in enumerate(srcs) if any(np.hypot(x - qx, y - qy) < 1.5 for qx, qy in quiet)}
        removed = {}
        for d in dets:
            vq = np.array([s[d] for i, s in per.items() if d in s and i in is_quiet])
            v = vq if len(vq) >= 3 else np.array([s[d] for s in per.values() if d in s])
            if len(v) < 3:
                continue
            common = np.median(v, axis=0)
            removed[d] = dict(px=[round(float(common[0]), 3), round(float(common[1]), 3)], fromGaiaQuiet=len(vq) >= 3, n=len(v))
            for s in per.values():
                if d in s:
                    s[d] = (s[d][0] - common[0], s[d][1] - common[1])
        mean = {i: np.mean(list(s.values()), axis=0) for i, s in per.items() if len(s) >= 2}
        mags = np.array([np.hypot(*v) for v in mean.values()])
        sig = 1.4826 * np.median(np.abs(mags - np.median(mags))) + np.median(mags) if len(mags) else np.nan
        dt = float(np.median(years)) if years else np.nan
        cands = []
        # Every cross-detector-consistent source's significance over 0.3 px, whatever the
        # threshold: the null calibration (yardstick N-A) sets the threshold from these.
        consistent_sig = []
        for i, v in mean.items():
            shifts = np.array(list(per[i].values()))
            spread = np.max(np.hypot(*(shifts - v).T)) if len(shifts) else 0
            mag = float(np.hypot(*v))
            consistent = spread < max(0.5 * mag, 0.3)
            if consistent and mag > 0.3 and sig > 0:
                consistent_sig.append(round(mag / sig, 2))
            if consistent and mag > max(5 * sig, 0.3):
                x, y, peak = srcs[i]
                cands.append(dict(x=round(x, 1), y=round(y, 1), fromCentrePx=round(float(np.hypot(x - c, y - c)), 1),
                                  shiftPx=round(mag, 2), shiftEastNorth=[round(-float(v[0]) * PIX, 2), round(float(v[1]) * PIX, 2)],
                                  arcsecPerYr=round(mag * PIX / abs(dt), 2) if dt else None,
                                  detectors=len(per[i]), significance=round(mag / sig, 1), peak=round(float(peak), 2)))
        cands.sort(key=lambda r: -r["significance"])
        target = next((k for k, r in enumerate(cands) if r["fromCentrePx"] < 3), None)
        out.append(dict(seasons=[a, b], years=round(dt, 2), sources=len(srcs), glareVetoed=vetoed,
                        notSearchedFraction=round(not_searched, 3), commonShiftRemoved=removed, measured=len(mean),
                        steadyScatterPx=round(float(sig), 3), candidates=cands if keep_all else cands[:8],
                        targetRank=None if target is None else target + 1, nCandidates=len(cands),
                        consistentSignificance=sorted(consistent_sig, reverse=True)[:20]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent.parent / "notes" / "season_pairs.json"))
    a = ap.parse_args()
    res = {}
    for slug in ["barnard", "epsind-b", "w0855", "rw-aur", "r-dra"]:
        res[slug] = search(slug)
        for r in res[slug]:
            top = r["candidates"][0] if r["candidates"] else None
            print(f"{slug:9s} seasons {r['seasons']} ({r['years']} yr): {r['sources']} sources, {r['measured']} measured, "
                  f"glare-vetoed {r['glareVetoed']} (not searched {r['notSearchedFraction']:.0%}), common shift from Gaia-quiet {sum(v['fromGaiaQuiet'] for v in r['commonShiftRemoved'].values())}/{len(r['commonShiftRemoved'])} dets, max {max([abs(x) for v in r['commonShiftRemoved'].values() for x in v['px']] or [0]):.3f} px, steady scatter {r['steadyScatterPx']} px, {r['nCandidates']} candidates; target rank {r['targetRank']}; "
                  f"top {top and (top['fromCentrePx'], top['shiftPx'], top['arcsecPerYr'], top['significance'])}")
    Path(a.out).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
