"""Method entry v1: the v0 detector on a better static model (prereg/YARDSTICK.md §10 ledger).

Two upstream changes to the scene fit, everything downstream identical to v0:

1. **Static sources SPHEREx sees.** The fit list is Gaia DR3 (as v0) plus the leave-half-out stack
   sources of `smo.catalogs.stack` from the *other* half of the patch's visits, so the visit being
   scored never contributes to its own static reference (cache/v1/<patch>/static.json).
2. **PSF-model error floor.** The shift and width are tuned exactly as in v0 (Gaia-only list), the
   full list is solved at them, and then the variance becomes
   VARIANCE + (eps_d x source model)^2, with eps_d per detector measured once on isolated bright
   Gaia stars in D-1 (`scripts/v1_psf_floor.py`, cache/v1/psf_floor.json), and the fit is re-solved
   at the same shift and width. Both the significance map and the exact refit then carry the
   PSF-model error near bright sources.
"""

from __future__ import annotations

import json
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord

from smo.catalogs import gaia
from smo.catalogs.sources import merge_close
from smo.data.exposure import Cutout
from smo.data.flags import FIT_REJECT, bit_map, mask_for
from smo.scene.fit import SceneInputs, solve_fixed, tune_and_solve
from smo.scene.pipeline import STAMP_HALF, CutoutFit
from smo.scene.psf import EPSFGrid, psf_kind

EXTRA_WEIGHT = 1e-3  # relative weight of a stack source when merging with a Gaia source within 1 px


def static_reference(cache: Path, patch: str) -> dict:
    return json.loads((cache / "v1" / patch / "static.json").read_text())


def psf_floor(cache: Path) -> dict[int, float]:
    d = json.loads((cache / "v1" / "psf_floor.json").read_text())["per_detector"]
    return {int(k): float(v["eps"]) for k, v in d.items()}


def reference_for(static: dict, visit: str) -> dict:
    """The static source list a visit is fitted with: always the one built from the other half."""
    half = static["halves"][visit]
    other = "B" if half == "A" else "A"
    ref = static["lists"][other]
    if visit in ref.get("built_from", ()):
        raise AssertionError(f"static reference for {visit} was built from that visit")
    return ref


def fit_cutout_v1(cut: Cutout, cache: Path, visit: str, static: dict, eps: dict[int, float],
                  gaia_center: tuple[float, float], gaia_radius_deg: float = 0.75) -> CutoutFit:
    other = reference_for(static, visit)
    w = cut.wcs()
    ny, nx = cut.shape
    cat = gaia.cone(gaia_center[0], gaia_center[1], gaia_radius_deg, cache)
    corners = w.pixel_to_world([0, nx - 1, nx - 1, 0], [0, 0, ny - 1, ny - 1])
    centre = SkyCoord(gaia_center[0] * u.deg, gaia_center[1] * u.deg)
    margin = (STAMP_HALF + 1) * 6.2 / 3600
    if float(centre.separation(corners).deg.max()) + margin > gaia_radius_deg:
        raise ValueError("Gaia cone does not cover the cutout plus its stamp margin")
    ra, dec = gaia.propagate(cat, cut.mjd_mid)
    gx, gy = w.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    sx, sy = w.world_to_pixel(SkyCoord(np.array(other["ra"]) * u.deg, np.array(other["dec"]) * u.deg))
    gmag = np.nan_to_num(cat["phot_g_mean_mag"].to_numpy(), nan=21.0)
    rej, _ = mask_for(cut.flags, bit_map(cut.flags_header), FIT_REJECT)
    data = cut.image.astype(np.float64) - cut.zodi.astype(np.float64)
    var = cut.variance.astype(np.float64)
    valid = np.isfinite(data) & np.isfinite(var) & (var > 0) & ~rej
    data = np.where(np.isfinite(data), data, 0.0)
    var = np.where(valid, var, 1.0)
    ep = EPSFGrid(cut.psf_planes, cut.psf_header, cut.x0, cut.y0,
                  pixel_response=psf_kind(cut.meta["version"]) == "optical")

    def inside(px, py):
        return (px > -STAMP_HALF) & (px < nx - 1 + STAMP_HALF) & (py > -STAMP_HALF) & (py < ny - 1 + STAMP_HALF)

    # 1. Shift and width tuned exactly as v0 (Gaia-only list; the tuning uses bright isolated stars).
    g_in = inside(gx, gy)
    x0, y0, _, _ = merge_close(gx[g_in], gy[g_in], 10 ** (-0.4 * (gmag[g_in] - 21.0)))
    sol, _ = tune_and_solve(SceneInputs(data, var, valid, ep, x0, y0, half=STAMP_HALF), tune=True)
    # 2. Full list (Gaia + other-half stack sources) at the tuned shift and width.
    px = np.concatenate([gx, sx])
    py = np.concatenate([gy, sy])
    wts = np.concatenate([10 ** (-0.4 * (gmag - 21.0)), np.full(len(sx), EXTRA_WEIGHT)])
    sel = inside(px, py)
    x, y, _, _ = merge_close(px[sel], py[sel], wts[sel])
    inp1 = SceneInputs(data, var, valid, ep, x, y, half=STAMP_HALF)
    system1 = solve_fixed(inp1, sol.dx, sol.dy, sol.scale)
    # 3. PSF-model error floor from the source model (background tents excluded), and re-solve.
    src = system1.active < system1.n_src
    model = np.zeros(ny * nx)
    model[system1.rows] = system1.A[:, src] @ system1.theta[src]
    e = eps[cut.detector]
    var2 = var + (e * model.reshape(ny, nx)) ** 2
    inp2 = SceneInputs(data, var2, valid, ep, x, y, half=STAMP_HALF)
    system2 = solve_fixed(inp2, sol.dx, sol.dy, sol.scale)
    return CutoutFit(cut, inp2, sol, system2)
