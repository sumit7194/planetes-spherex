"""The v2 detector (and v3): v0's search with a per-frame static mask, a persistence score and a cheap screen.

Same seeds, motion grid, duplicate suppression and local refinement as v0. Then:

1. Per-frame static mask: at the track's position in each frame, the registered time-rule
   statistic (zero-motion linear stack, median over every other visit); frames where it is
   >= STATIC_VETO_NU are dropped, so a track cannot be built from pixels that are always bright.
2. Persistence score: the minimum over exposure times of the linear stack recomputed without that
   time's frames (both detectors), on the unmasked frames. A track carried by one exposure, such as
   a cosmic ray, a glint or one pass through a static source, collapses; a real mover loses about
   sqrt(3/4) of nu.
3. Hard requirement (Z >= FRAME_Z at >= 2 exposure times), the partner veto and the anchor
   time-rule veto as in v0, all on the unmasked frames with exact significance.
4. Cheap screen: steps 1-2 are first computed on the convolution significance maps, and only
   candidates whose cheap persistence score is >= SCREEN_NU get the exact refit (`point_snr`).
   Its safety is measured on D patches against refitting everything (`screen=False`) and recorded
   in FINDINGS; it must be re-checked whenever the threshold or the noise model changes.

v3 (`exact=False`) is v2 scored entirely on the convolution maps. On the development yardstick it
matched v2's depth within errors (FINDINGS), avoids the exact refit's inflation next to fitted
sources, and needs no screen.

Input is only frame maps: this module never reads injection truth or known-asteroid lists.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from smo.data.patch import PARTNER
from smo.detect.maps import FrameMap, Plane
from smo.detect.v0 import (FRAME_Z, MATCH_PX, PARTNER_VETO_FRAC, PARTNER_VETO_Z, PIXEL_ARCSEC, PRE_NU, SEED_Z,
                           STATIC_VETO_NU, _motion_grid, _parabolic, _static_median, grid_search, local_search,
                           suppress_duplicates)

SCREEN_NU = 3.0


def track_suppress(records: list[dict], pos: np.ndarray, tau_unique: np.ndarray, tau: np.ndarray, radius_px: float) -> None:
    """Track-level suppression (method v4): passing candidates in descending score order; a candidate
    is suppressed (passes = False, suppressed = True) if, at any of the visit's exposure times, its
    track lies within `radius_px` of a stronger kept candidate's track. Positions per unique time are
    looked up in a grid of radius-sized cells, which gives the brute-force result (unit test)."""
    r = radius_px * PIXEL_ARCSEC
    first = [int(np.nonzero(tau == t)[0][0]) for t in tau_unique]  # pair frames share a time
    order = sorted((i for i, rec in enumerate(records) if rec["passes"]), key=lambda i: (-records[i]["score"], i))
    cells: list[dict] = [{} for _ in first]
    for i in order:
        clash = False
        for k, j in enumerate(first):
            x, y = pos[i, j]
            cx, cy = int(np.floor(x / r)), int(np.floor(y / r))
            for ix in (cx - 1, cx, cx + 1):
                for iy in (cy - 1, cy, cy + 1):
                    for (ax, ay) in cells[k].get((ix, iy), ()):
                        if (x - ax) ** 2 + (y - ay) ** 2 <= r * r:
                            clash = True
                            break
                    if clash:
                        break
                if clash:
                    break
            if clash:
                break
        if clash:
            records[i]["passes"] = False
            records[i]["suppressed"] = True
        else:
            for k, j in enumerate(first):
                x, y = pos[i, j]
                cells[k].setdefault((int(np.floor(x / r)), int(np.floor(y / r))), []).append((x, y))


def persistence(z: np.ndarray, times: np.ndarray) -> float:
    """min over exposure times t of sum(z[times != t]) / sqrt(count); -inf if fewer than 2 times."""
    ut = np.unique(times)
    if len(ut) < 2:
        return float("-inf")
    best = np.inf
    for t in ut:
        keep = times != t
        best = min(best, z[keep].sum() / np.sqrt(keep.sum()))
    return float(best)


def _track_positions(anchors, vels, tau):
    return anchors[:, None, :] + vels[:, None, :] * tau[None, :, None]  # (K, F, 2)


def detect_visit_v2(target: list[FrameMap], context: dict[str, list[FrameMap]], plane: Plane,
                    screen: bool = True, exact: bool = True, suppress_px: float | None = None) -> list[dict]:
    """`exact=False` is method v3: every quantity (score, hard rule, partner veto) is computed on the
    convolution significance maps, with no exact refit and therefore no screen."""
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
    times = np.array([fm.frame.exposure for fm in target])
    cheap = np.full(K, -np.inf)
    for i in range(K):
        ok = np.isfinite(zc[i]) & ~masked[i]
        if ok.any():
            cheap[i] = persistence(zc[i, ok], times[ok])
    todo = np.nonzero(cheap >= SCREEN_NU)[0] if (screen and exact) else np.arange(K)
    zex = np.full((K, F), np.nan) if exact else zc.copy()
    for j, fm in enumerate(target):
        if not exact or not len(todo):
            break
        x, y = fm.pmap.to_pix(pos[todo, j, 0], pos[todo, j, 1])
        ny, nx = fm.z.shape
        inb = (x + fm.dx >= 0) & (x + fm.dx <= nx - 1) & (y + fm.dy >= 0) & (y + fm.dy <= ny - 1)
        if inb.any():
            snr, _ = fm.fit.system.point_snr(x[inb], y[inb], fm.dx, fm.dy, fm.scale)
            zex[todo[inb], j] = snr
    anchor_static = _static_median(context, anchors)
    ra, dec = plane.to_sky(anchors[:, 0], anchors[:, 1])
    out = []
    todo_set = set(todo.tolist())
    for i in range(K):
        rec = {"ra": float(ra[i]), "dec": float(dec[i]), "xi": float(anchors[i, 0]), "eta": float(anchors[i, 1]),
               "v_xi": float(vels[i, 0]), "v_eta": float(vels[i, 1]), "t0": t0, "visit": target[0].frame.visit,
               "nu_grid": kept[i][0], "cheap_score": float(cheap[i]), "screened_out": i not in todo_set,
               "static_median": float(anchor_static[i]),
               "veto_static": bool(np.isfinite(anchor_static[i]) and anchor_static[i] >= STATIC_VETO_NU)}
        if i not in todo_set:
            rec.update({"score": float("-inf"), "passes": False})
            out.append(rec)
            continue
        ok = np.isfinite(zex[i]) & ~masked[i]
        z = zex[i, ok]
        fr = [fm.frame for fm, o in zip(target, ok, strict=True) if o]
        tt = times[ok]
        score = persistence(z, tt) if len(z) else float("-inf")
        n_times = len({f.exposure for f, zz in zip(fr, z, strict=True) if zz >= FRAME_Z})
        veto_partner = False
        if len(z):
            pos2 = np.clip(z, 0, None) ** 2
            top = int(np.argmax(z))
            if z[top] >= PARTNER_VETO_Z and pos2[top] >= PARTNER_VETO_FRAC * pos2.sum():
                ft = fr[top]
                partner = [zz for f, zz in zip(fr, z, strict=True) if f.exposure == ft.exposure and f.detector == PARTNER[ft.detector]]
                veto_partner = bool(partner) and partner[0] < 1.0
        rec.update({"score": score, "nu_masked": float(z.sum() / np.sqrt(len(z))) if len(z) else float("-inf"),
                    "z_frames": [float(v) for v in zex[i]], "frame_ids": [[fm.frame.exposure, fm.frame.detector] for fm in target],
                    "masked": [bool(m) for m in masked[i]], "n_frames": int(ok.sum()), "n_times_z2": n_times,
                    "hard_ok": n_times >= 2, "veto_partner": veto_partner})
        rec["passes"] = bool(rec["hard_ok"] and not veto_partner and not rec["veto_static"] and np.isfinite(score))
        out.append(rec)
    if suppress_px is not None:
        track_suppress(out, pos, np.unique(tau), tau, suppress_px)
    return out
