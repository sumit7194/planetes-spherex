"""Training and evaluation samples for option 1b, with the leakage rules enforced in code.

A sample is (patch p, target exposure e). The context is every other exposure of patch p that
  * belongs to a different visit (target group) than e, which also removes the simultaneous
    partner detector, and
  * is more than MIN_DT_DAYS away from e in time,
and whose patch is almost fully valid. The network sees only NETWORK_FEATURES for each token;
time-like quantities (MJD, visit) are used here for masking and never become network inputs.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

PATCH = 16
MIN_DT_DAYS = 0.25
MIN_VALID = 0.95
# The only per-token quantities the network may see. Nothing here may correlate with time.
NETWORK_FEATURES = ("loglam", "band_over_lam", "detector", "detx", "dety", "fracx", "fracy")
FORBIDDEN = ("mjd", "visit", "date", "survey", "zodi", "time", "obs_id", "sun")


@dataclass
class PatchSet:
    z: np.ndarray  # (E, n, n) float32 residual S/N on the grid, NaN invalid
    lam: np.ndarray  # (E, m, m) central wavelength at patch centre, um
    band: np.ndarray  # (E, m, m)
    detx: np.ndarray  # (E, m, m) full-frame detector x of patch centre
    dety: np.ndarray
    fracx: np.ndarray  # (E, m, m) sub-pixel offset of the grid relative to native pixels
    fracy: np.ndarray
    valid_frac: np.ndarray  # (E, m, m)
    detector: np.ndarray  # (E,) 1..6
    mjd: np.ndarray  # (E,) masking/audit only
    visit: np.ndarray  # (E,) str, masking only

    @property
    def m(self) -> int:
        return self.lam.shape[1]

    def context_ids(self, e: int, py: int, px: int) -> np.ndarray:
        ok = (self.visit != self.visit[e]) & (np.abs(self.mjd - self.mjd[e]) > MIN_DT_DAYS)
        ok &= self.valid_frac[:, py, px] >= MIN_VALID
        ok[e] = False
        return np.nonzero(ok)[0]

    def pixels(self, e: int, py: int, px: int) -> np.ndarray:
        return self.z[e, py * PATCH:(py + 1) * PATCH, px * PATCH:(px + 1) * PATCH]

    def features(self, ids: np.ndarray, py: int, px: int) -> np.ndarray:
        """(len(ids), F) network features; see NETWORK_FEATURES."""
        lam = self.lam[ids, py, px]
        loglam = np.log(lam / 2.0)
        f = [loglam[:, None]]
        for k in range(1, 9):  # Fourier features of log wavelength over the 0.75-5 um span
            f += [np.sin(np.pi * k * loglam / 2.0)[:, None], np.cos(np.pi * k * loglam / 2.0)[:, None]]
        f.append((self.band[ids, py, px] / lam)[:, None] * 10.0)
        f.append(np.eye(6)[self.detector[ids] - 1])
        dx = self.detx[ids, py, px] / 2040.0
        dy = self.dety[ids, py, px] / 2040.0
        f += [dx[:, None], dy[:, None]]
        for k in (1, 2, 4, 8):
            f += [np.sin(np.pi * k * dx)[:, None], np.cos(np.pi * k * dx)[:, None],
                  np.sin(np.pi * k * dy)[:, None], np.cos(np.pi * k * dy)[:, None]]
        f += [self.fracx[ids, py, px][:, None], self.fracy[ids, py, px][:, None]]
        return np.concatenate(f, axis=1).astype(np.float32)


N_FEATURES = 1 + 16 + 1 + 6 + 2 + 16 + 2


def make_batch(ps: PatchSet, items: list[tuple[int, int, int]], k_ctx: int, rng: np.random.Generator):
    """items: (target exposure, patch y, patch x). Returns numpy arrays for the model."""
    B = len(items)
    ctx_pix = np.zeros((B, k_ctx, 2, PATCH, PATCH), np.float32)
    ctx_feat = np.zeros((B, k_ctx, N_FEATURES), np.float32)
    ctx_mask = np.zeros((B, k_ctx), bool)
    q_feat = np.zeros((B, N_FEATURES), np.float32)
    tgt = np.zeros((B, PATCH, PATCH), np.float32)
    tgt_mask = np.zeros((B, PATCH, PATCH), bool)
    for b, (e, py, px) in enumerate(items):
        ids = ps.context_ids(e, py, px)
        if len(ids) > k_ctx:
            ids = rng.choice(ids, k_ctx, replace=False)
        n = len(ids)
        pix = np.stack([ps.pixels(i, py, px) for i in ids]) if n else np.zeros((0, PATCH, PATCH))
        ok = np.isfinite(pix)
        ctx_pix[b, :n, 0] = np.where(ok, pix, 0.0)
        ctx_pix[b, :n, 1] = ok
        ctx_feat[b, :n] = ps.features(ids, py, px)
        ctx_mask[b, :n] = True
        q_feat[b] = ps.features(np.array([e]), py, px)[0]
        t = ps.pixels(e, py, px)
        tgt_mask[b] = np.isfinite(t)
        tgt[b] = np.where(tgt_mask[b], t, 0.0)
    return ctx_pix, ctx_feat, ctx_mask, q_feat, tgt, tgt_mask
