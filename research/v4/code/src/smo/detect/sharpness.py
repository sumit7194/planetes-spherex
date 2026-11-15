"""Per-frame sharpness test: a point source with the telescope's PSF against a one-pixel spike.

On the 7 x 7 stamp of (IMAGE - ZODI) around a position, two models, each with a free amplitude and a
free constant background, are fitted by inverse-variance least squares:
  PSF:   a * ePSF(position + shift) + b, with the shift the best of a 5 x 5 grid within +-0.5 px
  delta: a * (the brightest pixel of the central 3 x 3) + b
dchi2 = chi2_PSF - chi2_delta; positive means a single pixel explains the data better than a point
source. On development data (FINDINGS 2026-10-25), frames of v4 null candidates had dchi2 > 10 in 56%
of cases, against 1% for fakes and 1% for real known asteroids.
"""

from __future__ import annotations

import numpy as np

HALF = 3
SHIFTS = np.linspace(-0.5, 0.5, 5)


def _fit(template: np.ndarray, d: np.ndarray, w: np.ndarray) -> float:
    A = np.stack([template.ravel(), np.ones(template.size)], 1)
    W = w.ravel()
    M = A.T @ (A * W[:, None])
    coef = np.linalg.solve(M, A.T @ (W * d.ravel()))
    r = d.ravel() - A @ coef
    return float(np.sum(W * r * r))


def dchi2(cut, epsf, x: float, y: float) -> float:
    """dchi2 at cutout pixel position (x, y), the WCS position plus the frame's fitted shift. NaN where
    the stamp is off the cutout or has fewer than 30 usable pixels."""
    ny, nx = cut.shape
    ix, iy = int(round(x)), int(round(y))
    if not (HALF + 1 <= ix < nx - HALF - 1 and HALF + 1 <= iy < ny - HALF - 1):
        return float("nan")
    sl = (slice(iy - HALF, iy + HALF + 1), slice(ix - HALF, ix + HALF + 1))
    d = cut.image[sl].astype(np.float64) - cut.zodi[sl].astype(np.float64)
    v = cut.variance[sl].astype(np.float64)
    ok = np.isfinite(d) & np.isfinite(v) & (v > 0)
    if ok.sum() < 30:
        return float("nan")
    w = np.where(ok, 1.0 / np.where(ok, v, 1.0), 0.0)
    d = np.where(ok, d, 0.0)
    W = 2 * HALF + 1
    best = np.inf
    for ox in SHIFTS:
        for oy in SHIFTS:
            st, x0, y0 = epsf.render(np.array([x + ox]), np.array([y + oy]), HALF, 1.0)
            t = np.zeros((W, W))
            sx, sy = x0[0] - (ix - HALF), y0[0] - (iy - HALF)
            ys = slice(max(sy, 0), min(sy + W, W))
            xs = slice(max(sx, 0), min(sx + W, W))
            t[ys, xs] = st[0][ys.start - sy:ys.stop - sy, xs.start - sx:xs.stop - sx]
            best = min(best, _fit(t, d, w))
    core = np.where(ok, d, -np.inf)[HALF - 1:HALF + 2, HALF - 1:HALF + 2]
    jy, jx = np.unravel_index(np.argmax(core), core.shape)
    t = np.zeros((W, W))
    t[HALF - 1 + jy, HALF - 1 + jx] = 1.0
    return best - _fit(t, d, w)
