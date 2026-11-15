"""The position-locked scene fit: free flux per source per exposure, solved exactly.

Model for one exposure cutout, over unflagged pixels p with weights w_p = 1/variance_p:

    d_p = sum_i f_i P_i(p) + sum_k b_k B_k(p) + noise,      d = IMAGE - ZODI

P_i is the ePSF at source i's position (plus one global shift and width scale per exposure),
B_k are bilinear tent functions on a coarse grid. The weighted normal equations are solved
with a direct sparse factorisation, so there is no iterative tolerance to tune. Every solve
records its own residual diagnostics.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import splu

from smo.scene.psf import EPSFGrid


@dataclass
class SceneInputs:
    data: np.ndarray  # IMAGE - ZODI, float64
    variance: np.ndarray
    valid: np.ndarray  # bool: pixel constrains the fit
    epsf: EPSFGrid
    x: np.ndarray  # source positions, cutout pixel coordinates
    y: np.ndarray
    half: int = 5
    bg_spacing: int = 64

    @property
    def shape(self) -> tuple[int, int]:
        return self.data.shape


@dataclass
class SceneSolution:
    flux: np.ndarray  # per source (NaN for sources with no valid pixels)
    bg: np.ndarray
    dx: float
    dy: float
    scale: float
    chi2: float
    n_valid: int
    n_params: int
    rel_residual: float
    iterations: int
    converged: bool
    dropped: np.ndarray  # indices of sources without constraining pixels
    history: list = field(default_factory=list)


class _System:
    """Design matrix and factorisation for fixed (dx, dy, scale)."""

    def __init__(self, inp: SceneInputs, dx: float, dy: float, scale: float):
        ny, nx = inp.shape
        self.inp = inp
        self.row_of = -np.ones(ny * nx, dtype=np.int64)
        valid_flat = inp.valid.ravel()
        self.rows = np.nonzero(valid_flat)[0]
        self.row_of[self.rows] = np.arange(len(self.rows))
        self.w = 1.0 / inp.variance.ravel()[self.rows]
        self.d = inp.data.ravel()[self.rows]

        stamps, ix0, iy0 = inp.epsf.render(inp.x + dx, inp.y + dy, inp.half, scale)
        self.stamps, self.ix0, self.iy0 = stamps, ix0, iy0
        n_src = len(inp.x)
        W = 2 * inp.half + 1
        jj, ii = np.meshgrid(np.arange(W), np.arange(W), indexing="ij")
        py = iy0[:, None, None] + jj[None]
        px = ix0[:, None, None] + ii[None]
        inside = (py >= 0) & (py < ny) & (px >= 0) & (px < nx)
        flat = np.where(inside, py * nx + px, 0)
        r = np.where(inside, self.row_of[flat], -1)
        keep = r >= 0
        src_idx = np.broadcast_to(np.arange(n_src)[:, None, None], keep.shape)
        A_src = sparse.coo_matrix((stamps[keep], (r[keep], src_idx[keep])), shape=(len(self.rows), n_src)).tocsc()

        # Background: bilinear tents on a grid with nodes at 0, s, 2s, ..., and the last pixel.
        def nodes(n: int) -> np.ndarray:
            g = np.arange(0, n, inp.bg_spacing, dtype=float)
            return g if g[-1] == n - 1 else np.append(g, n - 1)

        gx, gy = nodes(nx), nodes(ny)
        pyv, pxv = np.divmod(self.rows, nx)
        cols, vals, rws = [], [], []
        jx = np.clip(np.searchsorted(gx, pxv, side="right") - 1, 0, len(gx) - 2)
        jy = np.clip(np.searchsorted(gy, pyv, side="right") - 1, 0, len(gy) - 2)
        tx = (pxv - gx[jx]) / (gx[jx + 1] - gx[jx])
        ty = (pyv - gy[jy]) / (gy[jy + 1] - gy[jy])
        for dxn, wx in ((0, 1 - tx), (1, tx)):
            for dyn, wy in ((0, 1 - ty), (1, ty)):
                cols.append((jy + dyn) * len(gx) + (jx + dxn))
                vals.append(wx * wy)
                rws.append(np.arange(len(self.rows)))
        A_bg = sparse.coo_matrix((np.concatenate(vals), (np.concatenate(rws), np.concatenate(cols))),
                                 shape=(len(self.rows), len(gx) * len(gy))).tocsc()
        A = sparse.hstack([A_src, A_bg], format="csc")
        A.eliminate_zeros()

        # Drop columns with no constraining pixels (sources fully masked or off the cutout).
        colnorm = np.asarray(A.multiply(A).sum(axis=0)).ravel()
        self.active = np.nonzero(colnorm > 0)[0]
        self.n_src = n_src
        self.A = A[:, self.active]
        WA = sparse.diags(self.w) @ self.A
        self.N = (self.A.T @ WA).tocsc()
        self.rhs = WA.T @ self.d
        self.lu = splu(self.N, permc_spec="MMD_AT_PLUS_A")
        theta = self.lu.solve(self.rhs)
        # Iterative refinement on the original least-squares residual (corrected semi-normal
        # equations). Forming A^T W A squares the condition number; refinement recovers the
        # accuracy of a direct least-squares solve. Stops when the correction is at round-off.
        self.refinements = 0
        for _ in range(5):
            delta = self.lu.solve(WA.T @ (self.d - self.A @ theta))
            theta = theta + delta
            self.refinements += 1
            if np.linalg.norm(delta) <= 1e-15 * np.linalg.norm(theta):
                break
        self.rel_residual = float(np.linalg.norm(self.N @ theta - self.rhs) / np.linalg.norm(self.rhs))
        self.theta = theta
        self.model = self.A @ theta
        self.resid = self.d - self.model
        self.chi2 = float(np.sum(self.w * self.resid ** 2))

    def split(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        flux = np.full(self.n_src, np.nan)
        src_mask = self.active < self.n_src
        flux[self.active[src_mask]] = self.theta[src_mask]
        bg = self.theta[~src_mask]
        dropped = np.setdiff1d(np.arange(self.n_src), self.active[src_mask])
        return flux, bg, dropped

    def residual_image(self) -> np.ndarray:
        ny, nx = self.inp.shape
        out = np.full(ny * nx, np.nan)
        out[self.rows] = self.resid
        return out.reshape(ny, nx)

    def point_snr(self, qx: np.ndarray, qy: np.ndarray, dx: float, dy: float, scale: float,
                  block: int = 256) -> tuple[np.ndarray, np.ndarray]:
        """Exact significance of an extra point source at each (qx, qy), all other parameters refitted.

        snr = a^T W r / sqrt(a^T W a - t^T N^-1 t),  t = A^T W a.
        Returns (snr, flux_estimate). Leverage near fitted sources is handled exactly.
        """
        inp = self.inp
        ny, nx = inp.shape
        snr = np.empty(len(qx))
        amp = np.empty(len(qx))
        for s in range(0, len(qx), block):
            sl = slice(s, s + block)
            st, ix0, iy0 = inp.epsf.render(qx[sl] + dx, qy[sl] + dy, inp.half, scale)
            m = len(st)
            W = 2 * inp.half + 1
            jj, ii = np.meshgrid(np.arange(W), np.arange(W), indexing="ij")
            py = iy0[:, None, None] + jj[None]
            px = ix0[:, None, None] + ii[None]
            inside = (py >= 0) & (py < ny) & (px >= 0) & (px < nx)
            r = np.where(inside, self.row_of[np.where(inside, py * nx + px, 0)], -1)
            keep = r >= 0
            q = np.broadcast_to(np.arange(m)[:, None, None], keep.shape)
            Q = sparse.coo_matrix((st[keep], (r[keep], q[keep])), shape=(len(self.rows), m)).tocsc()
            WQ = sparse.diags(self.w) @ Q
            num = WQ.T @ self.resid
            aWa = np.asarray(Q.multiply(WQ).sum(axis=0)).ravel()
            T = (self.A.T @ WQ).toarray()
            Z = self.lu.solve(T)
            den = aWa - np.einsum("ij,ij->j", T, Z)
            with np.errstate(invalid="ignore", divide="ignore"):
                snr[sl] = num / np.sqrt(den)
                amp[sl] = num / den
        return snr, amp

    def flux_sigma(self, idx: np.ndarray) -> np.ndarray:
        """Exact 1-sigma flux errors (sqrt of the inverse normal matrix diagonal) for sources idx."""
        pos = {c: j for j, c in enumerate(self.active)}
        out = np.full(len(idx), np.nan)
        cols = [(k, pos[i]) for k, i in enumerate(idx) if i in pos]
        for s in range(0, len(cols), 256):
            chunk = cols[s:s + 256]
            E = np.zeros((self.N.shape[0], len(chunk)))
            for j, (_, c) in enumerate(chunk):
                E[c, j] = 1.0
            X = self.lu.solve(E)
            for j, (k, c) in enumerate(chunk):
                out[k] = np.sqrt(X[c, j])
        return out


def solve_fixed(inp: SceneInputs, dx: float = 0.0, dy: float = 0.0, scale: float = 1.0) -> _System:
    return _System(inp, dx, dy, scale)


def _snr_above(sys_: _System, flux: np.ndarray, snr_min: float) -> np.ndarray:
    """Exact S/N for every source, computed only where it could exceed snr_min (NaN elsewhere).

    For a symmetric positive-definite N, (N^-1)_ii >= 1 / N_ii, so f / sigma_exact <= f sqrt(N_ii).
    Sources whose bound is <= snr_min cannot pass and are skipped. The returned selection
    (snr > snr_min) is identical to computing every exact sigma.
    """
    snr = np.full(sys_.n_src, np.nan)
    diag = sys_.N.diagonal()
    src_cols = np.nonzero(sys_.active < sys_.n_src)[0]
    bound = np.full(sys_.n_src, -np.inf)
    bound[sys_.active[src_cols]] = flux[sys_.active[src_cols]] * np.sqrt(diag[src_cols])
    need = np.nonzero(bound > snr_min)[0]
    if len(need):
        snr[need] = flux[need] / sys_.flux_sigma(need)
    return snr


def _tuning_stars(sys_: _System, flux: np.ndarray, snr_min: float, iso_px: float, iso_frac: float) -> np.ndarray:
    inp = sys_.inp
    snr = _snr_above(sys_, flux, snr_min)
    ny, nx = inp.shape
    h = inp.half
    ok = (np.nan_to_num(snr, nan=-np.inf) > snr_min) & (inp.x > h) & (inp.x < nx - 1 - h) & (inp.y > h) & (inp.y < ny - 1 - h)
    cand = np.nonzero(ok)[0]
    keep = []
    for i in cand:
        d2 = (inp.x - inp.x[i]) ** 2 + (inp.y - inp.y[i]) ** 2
        near = (d2 < iso_px ** 2) & (d2 > 0)
        if np.any(np.nan_to_num(flux[near]) > iso_frac * flux[i]):
            continue
        yi, xi = int(round(inp.y[i])), int(round(inp.x[i]))
        if not inp.valid[yi - 2:yi + 3, xi - 2:xi + 3].all():
            continue
        keep.append(i)
    return np.array(keep, dtype=int)


def tune_and_solve(inp: SceneInputs, tune: bool = True, max_iter: int = 30, tol: float = 1e-6,
                   snr_min: float = 50.0, iso_px: float = 4.0, iso_frac: float = 0.01,
                   eps: tuple[float, float] = (1e-3, 1e-3)) -> tuple[SceneSolution, _System]:
    """Fit fluxes; optionally tune a global shift (dx, dy) and ePSF width scale per exposure.

    Gauss-Newton on (dx, dy, scale) with every flux re-solved exactly at each step, accepting a
    step only if the total chi^2 decreases (step halving otherwise). Converged when the relative
    chi^2 change falls below `tol`. Hitting `max_iter` is reported as not converged.
    """
    p = np.array([0.0, 0.0, 1.0])
    sys_ = solve_fixed(inp, *p)
    history = [(p.copy(), sys_.chi2)]
    if not tune:
        flux, bg, dropped = sys_.split()
        return SceneSolution(flux, bg, *p, sys_.chi2, len(sys_.rows), len(sys_.active),
                             sys_.rel_residual, 0, True, dropped, history), sys_
    converged = False
    it = 0
    for it in range(1, max_iter + 1):  # noqa: B007 - `it` is reported after the loop
        flux, _, _ = sys_.split()
        stars = _tuning_stars(sys_, flux, snr_min, iso_px, iso_frac)
        if len(stars) < 5:
            break
        # Jacobian of the model w.r.t. (dx, dy, scale) on the tuning stars' pixels, with each
        # tuning star's flux also free (local refit), other parameters held at current values.
        sub = SceneInputs(inp.data, inp.variance, inp.valid, inp.epsf, inp.x[stars], inp.y[stars], inp.half, inp.bg_spacing)
        base, ix0, iy0 = inp.epsf.render(sub.x + p[0], sub.y + p[1], inp.half, p[2])
        derivs = []
        for k, e in enumerate((eps[0], eps[0], eps[1])):
            dp = np.zeros(3)
            dp[k] = e
            plus, _, _ = inp.epsf.render(sub.x + p[0] + dp[0], sub.y + p[1] + dp[1], inp.half, p[2] + dp[2])
            minus, _, _ = inp.epsf.render(sub.x + p[0] - dp[0], sub.y + p[1] - dp[1], inp.half, p[2] - dp[2])
            derivs.append((plus - minus) / (2 * e))
        res_img = sys_.residual_image()
        W = 2 * inp.half + 1
        jj, ii = np.meshgrid(np.arange(W), np.arange(W), indexing="ij")
        rows_r, rows_w, cols_J = [], [], []
        ns = len(stars)
        for s_i, i in enumerate(stars):
            py = iy0[s_i] + jj
            px = ix0[s_i] + ii
            r = res_img[py, px].ravel()
            wv = 1.0 / inp.variance[py, px].ravel()
            good = np.isfinite(r) & inp.valid[py, px].ravel()
            J = np.zeros((W * W, ns + 3))
            J[:, s_i] = base[s_i].ravel()
            for k in range(3):
                J[:, ns + k] = flux[i] * derivs[k][s_i].ravel()
            rows_r.append(r[good])
            rows_w.append(wv[good])
            cols_J.append(J[good])
        r = np.concatenate(rows_r)
        wv = np.concatenate(rows_w)
        J = np.vstack(cols_J)
        sw = np.sqrt(wv)
        delta, *_ = np.linalg.lstsq(J * sw[:, None], r * sw, rcond=None)
        step = delta[ns:]
        accepted = False
        for _ in range(8):
            trial = p + step
            new = solve_fixed(inp, *trial)
            if new.chi2 < sys_.chi2:
                accepted = True
                break
            step = step / 2
        if not accepted:
            converged = True  # no descent direction left: at the optimum to numerical precision
            break
        rel = (sys_.chi2 - new.chi2) / sys_.chi2
        p, sys_ = trial, new
        history.append((p.copy(), sys_.chi2))
        if rel < tol:
            converged = True
            break
    flux, bg, dropped = sys_.split()
    return SceneSolution(flux, bg, float(p[0]), float(p[1]), float(p[2]), sys_.chi2, len(sys_.rows),
                         len(sys_.active), sys_.rel_residual, it, converged, dropped, history), sys_
