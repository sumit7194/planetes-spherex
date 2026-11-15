"""The v0 detector, the yardstick's baseline method (prereg/YARDSTICK.md §9 as amended by Y1).

Input is only cutouts: this module never reads injection truth or known-asteroid lists.

1. Per frame: the plain Gaia scene fit, and a PSF-matched-filter significance map
   Z = (r w * P) / sqrt(w * P^2), with r the residual, w = 1/VARIANCE on fitted pixels (0
   elsewhere) and P the frame's ePSF at its tuned width (correlation, not convolution).
2. Within a visit: seeds are local maxima with Z >= SEED_Z in any frame. For every seed and every
   trial linear motion on a grid out to MAX_RATE_PX per exposure step, the track's linear stack
   nu = sum_f Z_f / sqrt(N) over the N frames it falls on (a within-visit shift-and-stack). The best
   motion per seed is kept and duplicates within MATCH_PX are suppressed.
3. Survivors are re-measured exactly (`_System.point_snr`, which refits every other parameter, so
   leverage near fitted stars is handled) at their track position in each frame.
4. Hard requirement: exact Z >= FRAME_Z at >= 2 distinct exposure times (the simultaneous partner
   is the same time and does not count as a second one).
5. Partner veto: the strongest frame has Z >= PARTNER_VETO_Z, carries >= 80% of the positive
   signal (sum of max(Z, 0)^2), and its simultaneous partner has Z < 1 at that position.
6. Time-rule veto: the same linear stack at the same sky position, zero motion, in every other
   visit; vetoed if the median over those visits is >= STATIC_VETO_NU.

Frame maps, the patch plane and the position convention live in `smo.detect.maps`.
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy import ndimage

from smo.data.patch import PARTNER
from smo.detect import kernel
from smo.detect.maps import FrameMap, Plane, PlaneMap, frame_map, matched_filter  # noqa: F401 - re-exported

SEED_Z = 2.0
FRAME_Z = 2.0
MAX_RATE_PX = 3.0  # per exposure step
RATE_STEP_PX = 0.25
STEP_S = 129.0  # nominal exposure step, used only to express the motion grid in arcsec/s
PIXEL_ARCSEC = 6.15
MATCH_PX = 1.5
PRE_NU = 3.0  # candidates below this linear stack are not kept at all
PARTNER_VETO_Z = 8.0
PARTNER_VETO_FRAC = 0.8
STATIC_VETO_NU = 2.0
SEED_CHUNK = 128


# ----------------------------------------------------------------------------- one visit

def _motion_grid() -> np.ndarray:
    g = np.arange(-MAX_RATE_PX, MAX_RATE_PX + 1e-9, RATE_STEP_PX) * PIXEL_ARCSEC / STEP_S
    vx, vy = np.meshgrid(g, g, indexing="ij")
    return np.stack([vx.ravel(), vy.ravel()], axis=1)  # arcsec / s


def _stack(maps: list[FrameMap], tau: np.ndarray, anchor: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Linear stack nu and frame count for anchors (S, 2) x motions (S, M, 2)."""
    num = np.zeros(v.shape[:2])
    cnt = np.zeros(v.shape[:2])
    for fm, t in zip(maps, tau, strict=True):
        xi = anchor[:, None, 0] + v[..., 0] * t
        eta = anchor[:, None, 1] + v[..., 1] * t
        z = fm.z_at(xi, eta)
        ok = np.isfinite(z)
        num += np.where(ok, z, 0.0)
        cnt += ok
    with np.errstate(invalid="ignore", divide="ignore"):
        nu = np.where(cnt > 0, num / np.sqrt(cnt), -np.inf)
    return nu, cnt


def grid_search(target: list[FrameMap], tau: np.ndarray, seeds: np.ndarray, grid: np.ndarray,
                use_kernel: bool | None = None) -> tuple[np.ndarray, np.ndarray]:
    """For each seed (xi, eta, t), the best linear stack over the motion grid (anchor at t0 =
    seed - v t) and the first motion index reaching it. Rust kernel if available, else Python."""
    if use_kernel is None:
        use_kernel = kernel.available()
    if len(seeds) == 0:
        return np.zeros(0), np.zeros(0, dtype=np.int64)
    if use_kernel:
        return kernel.grid_best(target, tau, seeds, grid)
    nu_best = np.empty(len(seeds))
    k_best = np.empty(len(seeds), dtype=np.int64)
    for s in range(0, len(seeds), SEED_CHUNK):
        sd = seeds[s:s + SEED_CHUNK]
        v = np.broadcast_to(grid[None], (len(sd), len(grid), 2))
        anchor_all = sd[:, None, :2] - v * sd[:, None, 2:3]  # position at t0 for each motion
        nu, _ = _stack(target, tau, anchor_all.reshape(-1, 2), v.reshape(-1, 1, 2))
        nu = nu.reshape(len(sd), len(grid))
        k = np.argmax(nu, axis=1)
        k_best[s:s + len(sd)] = k
        nu_best[s:s + len(sd)] = nu[np.arange(len(sd)), k]
    return nu_best, k_best


def local_search(target: list[FrameMap], tau: np.ndarray, anchors: np.ndarray, vels: np.ndarray,
                 use_kernel: bool | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Refined (anchor, motion) per candidate (see `_local_refine`). Rust kernel if available."""
    if use_kernel is None:
        use_kernel = kernel.available()
    if use_kernel:
        pos = LOCAL_POS_PX * PIXEL_ARCSEC
        rate = LOCAL_RATE_PX * PIXEL_ARCSEC / STEP_S
        _, k = kernel.local_best(target, tau, np.hstack([anchors, vels]), pos, rate)
        nr, npos = len(rate), len(pos)
        iy_v = k % nr
        ix_v = (k // nr) % nr
        iy_a = (k // (nr * nr)) % npos
        ix_a = k // (nr * nr * npos)
        a = np.stack([anchors[:, 0] + pos[ix_a], anchors[:, 1] + pos[iy_a]], axis=1)
        v = np.stack([vels[:, 0] + rate[ix_v], vels[:, 1] + rate[iy_v]], axis=1)
        return a, v
    out = [_local_refine(target, tau, a, v) for a, v in zip(anchors, vels, strict=True)]
    return np.array([a for a, _ in out]), np.array([v for _, v in out])


def split_context(maps_by_visit: dict[str, list[FrameMap]], visit: str) -> tuple[list[FrameMap], dict[str, list[FrameMap]]]:
    """Target frames and the static context for one visit. The context never contains the target."""
    target = maps_by_visit[visit]
    context = {v: m for v, m in maps_by_visit.items() if v != visit}
    if any(fm.frame.visit == visit for maps in context.values() for fm in maps):
        raise AssertionError("static context contains the target visit")
    return target, context


def detect_visit(target: list[FrameMap], context: dict[str, list[FrameMap]], plane: Plane) -> list[dict]:
    """Candidates for one visit. `target` frame maps must carry their fits (keep_fit=True);
    `context` maps every other visit of the patch to its (uninjected) frame maps."""
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
    recs = _refine(target, tau, anchors, vels)
    static = _static_median(context, anchors)
    ra, dec = plane.to_sky(anchors[:, 0], anchors[:, 1])
    out = []
    for i, rec in enumerate(recs):
        rec["nu_grid"] = kept[i][0]
        rec["static_median"] = float(static[i])
        rec["veto_static"] = bool(np.isfinite(static[i]) and static[i] >= STATIC_VETO_NU)
        rec.update({"ra": float(ra[i]), "dec": float(dec[i]), "xi": float(anchors[i, 0]), "eta": float(anchors[i, 1]),
                    "v_xi": float(vels[i, 0]), "v_eta": float(vels[i, 1]), "t0": t0,
                    "visit": target[0].frame.visit})
        rec["passes"] = bool(rec["hard_ok"] and not rec["veto_partner"] and not rec["veto_static"])
        out.append(rec)
    return out


def suppress_duplicates(best: list, radius: float) -> list:
    """Greedy suppression in the given (descending score) order: keep an item unless a kept item's
    anchor lies within `radius` (distance <= radius suppresses). Neighbours are looked up in a grid
    of `radius`-sized cells, which gives exactly the brute-force result (unit test)."""
    r2 = radius ** 2
    cells: dict[tuple[int, int], list[np.ndarray]] = {}
    kept = []
    for b in best:
        cx, cy = int(np.floor(b[1][0] / radius)), int(np.floor(b[1][1] / radius))
        clash = False
        for ix in (cx - 1, cx, cx + 1):
            for iy in (cy - 1, cy, cy + 1):
                for a in cells.get((ix, iy), ()):
                    if (b[1][0] - a[0]) ** 2 + (b[1][1] - a[1]) ** 2 <= r2:
                        clash = True
                        break
                if clash:
                    break
            if clash:
                break
        if not clash:
            kept.append(b)
            cells.setdefault((cx, cy), []).append(b[1])
    return kept


def _parabolic(z: np.ndarray, px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sub-pixel peak offsets from a 1-D parabola through each axis' three samples, clipped to +-0.5."""
    def axis(zm, z0, zp):
        den = zm - 2 * z0 + zp
        with np.errstate(invalid="ignore", divide="ignore"):
            o = np.where(den < 0, 0.5 * (zm - zp) / den, 0.0)
        return np.clip(np.nan_to_num(o), -0.5, 0.5)
    z0 = z[py, px]
    return axis(z[py, px - 1], z0, z[py, px + 1]), axis(z[py - 1, px], z0, z[py + 1, px])


LOCAL_POS_PX = np.arange(-0.5, 0.5 + 1e-9, 0.125)
LOCAL_RATE_PX = np.arange(-0.25, 0.25 + 1e-9, 0.125)


def _local_refine(target: list[FrameMap], tau: np.ndarray, anc: np.ndarray, vel: np.ndarray
                  ) -> tuple[np.ndarray, np.ndarray]:
    """Best (anchor, motion) on a sub-pixel grid around a grid detection: anchor +-0.5 px in steps
    of 0.125 px, motion +-0.25 px per step in steps of 0.125, by the same linear stack."""
    pos = LOCAL_POS_PX * PIXEL_ARCSEC
    rate = LOCAL_RATE_PX * PIXEL_ARCSEC / STEP_S
    ax, ay, vx, vy = np.meshgrid(pos, pos, rate, rate, indexing="ij")
    a = np.stack([anc[0] + ax.ravel(), anc[1] + ay.ravel()], axis=1)
    v = np.stack([vel[0] + vx.ravel(), vel[1] + vy.ravel()], axis=1)[:, None, :]
    nu, _ = _stack(target, tau, a, v)
    k = int(np.argmax(nu[:, 0]))
    return a[k], v[k, 0]


def _refine(target: list[FrameMap], tau: np.ndarray, anchors: np.ndarray, vels: np.ndarray) -> list[dict]:
    """Exact per-frame significance at each track (one batched `point_snr` call per frame, which
    is identical to one call per track; see test_point_snr_independent_of_batch_size), then the
    hard requirement and the partner veto."""
    K = len(anchors)
    zmat = np.full((K, len(target)), np.nan)
    for j, (fm, t) in enumerate(zip(target, tau, strict=True)):
        x, y = fm.pmap.to_pix(anchors[:, 0] + vels[:, 0] * t, anchors[:, 1] + vels[:, 1] * t)
        ny, nx = fm.z.shape
        inb = (x + fm.dx >= 0) & (x + fm.dx <= nx - 1) & (y + fm.dy >= 0) & (y + fm.dy <= ny - 1)
        if inb.any():
            snr, _ = fm.fit.system.point_snr(x[inb], y[inb], fm.dx, fm.dy, fm.scale)
            zmat[inb, j] = snr
    out = []
    for i in range(K):
        ok = np.isfinite(zmat[i])
        frames = [fm.frame for fm, o in zip(target, ok, strict=True) if o]
        z = zmat[i, ok]
        n = len(z)
        nu = float(z.sum() / np.sqrt(n)) if n else float("-inf")
        times = {f.exposure for f, zz in zip(frames, z, strict=True) if zz >= FRAME_Z}
        veto_partner = False
        if n:
            pos2 = np.clip(z, 0, None) ** 2
            top = int(np.argmax(z))
            if z[top] >= PARTNER_VETO_Z and pos2[top] >= PARTNER_VETO_FRAC * pos2.sum():
                ft = frames[top]
                partner = [zz for f, zz in zip(frames, z, strict=True)
                           if f.exposure == ft.exposure and f.detector == PARTNER[ft.detector]]
                veto_partner = bool(partner) and partner[0] < 1.0
        out.append({"score": nu, "n_frames": n, "z_frames": [float(v) for v in z],
                    "frame_ids": [[f.exposure, f.detector] for f in frames], "n_times_z2": len(times),
                    "hard_ok": len(times) >= 2, "veto_partner": bool(veto_partner)})
    return out


def _static_median(context: dict[str, list[FrameMap]], anchors: np.ndarray) -> np.ndarray:
    """Median over the other visits of the zero-motion linear stack at each anchor. Each context
    frame is prepared once for all anchors and released afterwards, to bound memory."""
    per_visit = []
    for maps in context.values():
        num = np.zeros(len(anchors))
        cnt = np.zeros(len(anchors))
        for fm in maps:
            z = fm.z_at(anchors[:, 0], anchors[:, 1])
            fm._coef = fm._m = None
            ok = np.isfinite(z)
            num += np.where(ok, z, 0.0)
            cnt += ok
        with np.errstate(invalid="ignore", divide="ignore"):
            per_visit.append(np.where(cnt > 0, num / np.sqrt(cnt), np.nan))
    if not per_visit:
        return np.full(len(anchors), np.nan)
    arr = np.array(per_visit)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN columns: anchors no context covers
        return np.nanmedian(arr, axis=0)
