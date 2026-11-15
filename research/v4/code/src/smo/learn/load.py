"""Load prepared pilot grids into a PatchSet, optionally restricted to a range of patch columns."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from smo.learn.data import PatchSet


def load_grid(path: Path) -> tuple[PatchSet, dict]:
    with np.load(path, allow_pickle=False) as z:
        a = {k: z[k] for k in z.files}
    ps = PatchSet(z=a["z"], lam=a["lam"], band=a["band"], detx=a["detx"], dety=a["dety"],
                  fracx=a["fracx"], fracy=a["fracy"], valid_frac=a["valid_frac"],
                  detector=a["detector"].astype(int), mjd=a["mjd"], visit=a["visit"])
    extra = {k: a[k] for k in ("psf", "obs_id", "expnum", "empty_sky")}
    return ps, extra


def items_for(ps: PatchSet, cols: range, min_ctx: int = 32) -> list[tuple[int, int, int]]:
    """Every (target, patch y, patch x) with a valid target patch and enough context, in given columns."""
    out = []
    for py in range(ps.m):
        for px in cols:
            for e in np.nonzero(ps.valid_frac[:, py, px] >= 0.95)[0]:
                if len(ps.context_ids(int(e), py, px)) >= min_ctx:
                    out.append((int(e), py, px))
    return out
