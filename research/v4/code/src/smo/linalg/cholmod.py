"""Optional CHOLMOD factorisation of the scene fit's normal matrix (via cholespy), as a drop-in for
scipy's `splu` in smo.scene.fit.

The normal matrix N = A^T W A is symmetric positive definite, so a Cholesky factorisation replaces
the general LU. The fit refines every solution on the original least-squares residual until the
correction is at round-off, so the fitted parameters do not depend on which factorisation is used,
up to rounding. `install()` swaps it in at run time; smo/scene/fit.py itself is unchanged. It lives outside smo/scene so that adding it does not change the source hash that keys cached frame maps.
Adopted only if a full development run gives the same candidates within rounding.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse


class CholmodFactor:
    def __init__(self, N):
        from cholespy import CholeskySolverD, MatrixType

        N = sparse.csr_matrix(N)
        self.shape = N.shape
        self._solver = CholeskySolverD(N.shape[0], N.indptr.astype(np.int32), N.indices.astype(np.int32),
                                       N.data.astype(np.float64), MatrixType.CSR)

    def solve(self, b: np.ndarray) -> np.ndarray:
        b = np.ascontiguousarray(b, dtype=np.float64)
        x = np.empty_like(b)
        self._solver.solve(b, x)
        return x


PROBE_RTOL = 1e-10


def factor(N, permc_spec: str | None = None):
    """Same call signature as scipy.sparse.linalg.splu as used by smo.scene.fit.

    CHOLMOD needs N positive definite. Where it is not (cholespy raises; seen on 1 of ~280 injected
    D-1 frames), or where a probe solve does not reproduce its right-hand side to rounding level,
    the factorisation falls back to scipy's splu with the caller's permc_spec, exactly as without
    this module. `FALLBACKS` counts those cases."""
    global FALLBACKS
    from scipy.sparse.linalg import splu

    try:
        f = CholmodFactor(N)
    except ValueError:
        FALLBACKS += 1
        return splu(N, permc_spec=permc_spec)
    v = np.random.default_rng(0).normal(size=N.shape[0])
    b = N @ v
    r = f.solve(b)
    if not np.all(np.isfinite(r)) or np.linalg.norm(N @ r - b) > PROBE_RTOL * np.linalg.norm(b):
        FALLBACKS += 1
        return splu(N, permc_spec=permc_spec)
    return f


FALLBACKS = 0


def install() -> None:
    from smo.scene import fit

    fit.splu = factor
