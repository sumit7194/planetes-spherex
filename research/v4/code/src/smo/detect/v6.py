"""The v6 detector: v4 (v3 scoring with track suppression) plus three per-frame noise models.

v4's search, static mask, persistence score, hard rule, partner and anchor vetoes and track
suppression are unchanged (smo.detect.v2, convolution scoring). Added:

1. Per-band noise normalisation: each frame's significance map is divided by its robust standard
   deviation in bands of BAND_ROWS rows (the LVF puts wavelength, and the row banding seen on D1 and
   D2, along rows). On D the raw maps' noise was 1.02-1.16, with bands up to 1.36 (FINDINGS). Target
   maps are normalised here; context maps must be normalised once by the caller (`normalise`), and
   the detector refuses context maps that are not.
2. Per-frame sharpness drop: at the track's position in each frame with Z >= SHARP_Z, a point
   source with the telescope's PSF is compared with a one-pixel spike (smo.detect.sharpness); frames
   where the spike is preferred by dchi2 > SHARP_DCHI2 drop out of the sum, as masked frames do. On
   D, 56% of v4 null-candidate frames failed, against 1% of fake and known-asteroid frames; for known
   asteroids dchi2 falls with Z, so a fixed threshold suffices (FINDINGS 2026-10-25).
3. Brightness consistency: the per-detector chi2 of the unmasked frames' Z about their detector's
   mean, with per-frame variance CONS_S0**2 + (CONS_F * mean)**2; a candidate passes only if its
   p-value is >= CONS_PMIN. It is applied before track suppression, so an inconsistent candidate
   does not suppress a consistent one.

Input is frame maps and the target cutouts: this module never reads injection truth or
known-asteroid lists.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
from scipy import ndimage, stats

from smo.data.patch import PARTNER
from smo.detect.maps import FrameMap, Plane
from smo.detect.sharpness import dchi2
from smo.detect.v0 import (FRAME_Z, MATCH_PX, PARTNER_VETO_FRAC, PARTNER_VETO_Z, PIXEL_ARCSEC, PRE_NU, SEED_Z,
                           STATIC_VETO_NU, _motion_grid, _parabolic, _static_median, grid_search, local_search,
                           suppress_duplicates)
from smo.detect.v2 import _track_positions, persistence, track_suppress

BAND_ROWS = 16
CLIP = 5.0
SHARP_Z = 4.0
SHARP_DCHI2 = 10.0
CONS_S0 = 1.2
CONS_F = 0.15
CONS_PMIN = 1e-3
SUPPRESS_PX = 1.5


def band_sigma(z: np.ndarray) -> np.ndarray:
    """Robust standard deviation of z in each band of BAND_ROWS rows: 1.4826 * MAD about the median,
    recomputed once without pixels beyond CLIP of those (sources). NaN for a band with < 100 pixels."""
    out = []
    for r0 in range(0, z.shape[0], BAND_ROWS):
        v = z[r0:r0 + BAND_ROWS]
        v = v[np.isfinite(v)]
        s = np.nan
        for _ in range(2):
            if len(v) < 100:
                s = np.nan
                break
            med = np.median(v)
            s = 1.4826 * np.median(np.abs(v - med))
            v = v[np.abs(v - med) <= CLIP * s]
        out.append(s)
    return np.array(out)


def normalise(fm: FrameMap) -> FrameMap:
    """A copy of the frame map with z divided by its band sigma; bands without one are left NaN."""
    s = band_sigma(fm.z.astype(np.float64))
    per_row = np.repeat(s, BAND_ROWS)[:fm.z.shape[0]]
    z = (fm.z / per_row[:, None]).astype(np.float32)
    return replace(fm, z=z, meta={**fm.meta, "band_sigma": [float(x) for x in s]}, _coef=None, _m=None)


def consistency_p(z: np.ndarray, det: np.ndarray) -> float:
    """p-value of the per-detector chi2 of z about each detector's mean; 1.0 with no degrees of freedom."""
    chi2, dof = 0.0, 0
    for d in np.unique(det):
        zz = z[det == d]
        if len(zz) >= 2:
            mu = zz.mean()
            chi2 += np.sum((zz - mu) ** 2) / (CONS_S0 ** 2 + (CONS_F * max(mu, 0.0)) ** 2)
            dof += len(zz) - 1
    return float(stats.chi2.sf(chi2, dof)) if dof else 1.0


def detect_visit_v6(target: list[FrameMap], context: dict[str, list[FrameMap]], plane: Plane,
                    cuts: dict, epsfs: dict) -> list[dict]:
    """`target`: raw (un-normalised) target frame maps; `context`: normalised context maps;
    `cuts` and `epsfs`: each target frame's cutout (as injected) and ePSF, by frame path."""
    if any("band_sigma" not in fm.meta for ms in context.values() for fm in ms):
        raise ValueError("v6 context maps must be normalised (smo.detect.v6.normalise)")
    target = [normalise(fm) for fm in target]
    t0 = float(np.mean([fm.frame.mjd_avg for fm in target]))
    tau = np.array([(fm.frame.mjd_avg - t0) * 86400.0 for fm in target])
    grid = _motion_grid()
    seeds = []
    for fm, t in zip(target, tau, strict=True):
        z = np.where(np.isfinite(fm.z), fm.z, -np.inf)
        peak = (z == ndimage.maximum_filter(z, size=3)) & (z >= SEED_Z)
        peak[[0, -1], :] = False
        peak[:, [0, -1]] = False
        py, px = np.nonzero(peak)
        ox, oy = _parabolic(np.where(np.isfinite(fm.z), fm.z, 0.0).astype(np.float64), px, py)
        xi, eta = fm.pmap.to_plane(px + ox - fm.dx, py + oy - fm.dy)
        seeds.append(np.stack([xi, eta, np.full(len(xi), t)], axis=1))
    seeds = np.concatenate(seeds) if seeds else np.zeros((0, 3))
    nu_best, k_best = grid_search(target, tau, seeds, grid)
    best = []
    for i in np.nonzero(nu_best >= PRE_NU)[0]:
        vel = grid[k_best[i]].copy()
        best.append((float(nu_best[i]), seeds[i, :2] - vel * seeds[i, 2], vel))
    best.sort(key=lambda b: -b[0])
    kept = suppress_duplicates(best, MATCH_PX * PIXEL_ARCSEC)
    if not kept:
        return []
    anchors, vels = local_search(target, tau, np.array([b[1] for b in kept]), np.array([b[2] for b in kept]))
    K, F = len(anchors), len(target)
    pos = _track_positions(anchors, vels, tau)
    zc = np.stack([fm.z_at(pos[:, j, 0], pos[:, j, 1]) for j, fm in enumerate(target)], axis=1)
    st = _static_median(context, pos.reshape(-1, 2)).reshape(K, F)
    masked = np.isfinite(st) & (st >= STATIC_VETO_NU)
    # Sharpness at the track's pixel position (cutout pixels, frame shift applied) where Z >= SHARP_Z.
    dc = np.full((K, F), np.nan)
    phase = np.full((K, F, 2), np.nan)
    for j, fm in enumerate(target):
        x, y = fm.pmap.to_pix(pos[:, j, 0], pos[:, j, 1])
        x, y = x + fm.dx, y + fm.dy
        phase[:, j, 0], phase[:, j, 1] = x - np.rint(x), y - np.rint(y)
        for i in np.nonzero(np.isfinite(zc[:, j]) & (zc[:, j] >= SHARP_Z) & ~masked[:, j])[0]:
            dc[i, j] = dchi2(cuts[fm.frame.path], epsfs[fm.frame.path], float(x[i]), float(y[i]))
    sharp = np.isfinite(dc) & (dc > SHARP_DCHI2)
    times = np.array([fm.frame.exposure for fm in target])
    dets = np.array([fm.frame.detector for fm in target])
    anchor_static = _static_median(context, anchors)
    ra, dec = plane.to_sky(anchors[:, 0], anchors[:, 1])
    out = []
    for i in range(K):
        ok = np.isfinite(zc[i]) & ~masked[i] & ~sharp[i]
        z = zc[i, ok]
        fr = [fm.frame for fm, o in zip(target, ok, strict=True) if o]
        score = persistence(z, times[ok]) if len(z) else float("-inf")
        n_times = len({f.exposure for f, zz in zip(fr, z, strict=True) if zz >= FRAME_Z})
        veto_partner = False
        if len(z):
            pos2 = np.clip(z, 0, None) ** 2
            top = int(np.argmax(z))
            if z[top] >= PARTNER_VETO_Z and pos2[top] >= PARTNER_VETO_FRAC * pos2.sum():
                ft = fr[top]
                partner = [zz for f, zz in zip(fr, z, strict=True) if f.exposure == ft.exposure and f.detector == PARTNER[ft.detector]]
                veto_partner = bool(partner) and partner[0] < 1.0
        p_cons = consistency_p(z, dets[ok]) if len(z) else 1.0
        veto_static = bool(np.isfinite(anchor_static[i]) and anchor_static[i] >= STATIC_VETO_NU)
        rec = {"ra": float(ra[i]), "dec": float(dec[i]), "xi": float(anchors[i, 0]), "eta": float(anchors[i, 1]),
               "v_xi": float(vels[i, 0]), "v_eta": float(vels[i, 1]), "t0": t0, "visit": target[0].frame.visit,
               "nu_grid": kept[i][0], "static_median": float(anchor_static[i]), "veto_static": veto_static,
               "score": score, "nu_masked": float(z.sum() / np.sqrt(len(z))) if len(z) else float("-inf"),
               "z_frames": [float(v) for v in zc[i]], "frame_ids": [[fm.frame.exposure, fm.frame.detector] for fm in target],
               "masked": [bool(m) for m in masked[i]], "sharp": [bool(s) for s in sharp[i]],
               "dchi2": [None if not np.isfinite(v) else float(v) for v in dc[i]],
               "phase": [[float(a), float(b)] for a, b in phase[i]],
               "n_frames": int(ok.sum()), "n_times_z2": n_times, "hard_ok": n_times >= 2,
               "veto_partner": veto_partner, "p_cons": p_cons, "veto_cons": p_cons < CONS_PMIN}
        rec["passes"] = bool(rec["hard_ok"] and not veto_partner and not veto_static and np.isfinite(score)
                             and not rec["veto_cons"])
        out.append(rec)
    track_suppress(out, pos, np.unique(tau), tau, SUPPRESS_PX)
    return out
