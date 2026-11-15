"""One call from a cached cutout to a tuned scene fit with Gaia positions."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord

from smo.catalogs import gaia
from smo.catalogs.sources import merge_close
from smo.data.exposure import Cutout
from smo.data.flags import FIT_REJECT, bit_map, mask_for
from smo.scene.fit import SceneInputs, SceneSolution, tune_and_solve
from smo.scene.psf import EPSFGrid, psf_kind

STAMP_HALF = 5


@dataclass
class CutoutFit:
    cut: Cutout
    inp: SceneInputs
    sol: SceneSolution
    system: object  # smo.scene.fit._System

    def residual_sn(self) -> np.ndarray:
        """Residual / sqrt(VARIANCE) on valid pixels, NaN elsewhere (not leverage-corrected)."""
        r = self.system.residual_image()
        return r / np.sqrt(self.inp.variance)


def fit_cutout(cut: Cutout, cache: Path, tune: bool = True, gaia_radius_deg: float = 0.75,
               gaia_center: tuple[float, float] | None = None) -> CutoutFit:
    """Fit a cutout with Gaia DR3 positions. `gaia_center` lets many cutouts of one region share a
    single cached Gaia query; the caller must make sure the cone covers every cutout (+ margin)."""
    w = cut.wcs()
    ny, nx = cut.shape
    if gaia_center is None:
        c = w.pixel_to_world((nx - 1) / 2, (ny - 1) / 2)
        gaia_center = (float(c.ra.deg), float(c.dec.deg))
    cat = gaia.cone(gaia_center[0], gaia_center[1], gaia_radius_deg, cache)
    corners = w.pixel_to_world([0, nx - 1, nx - 1, 0], [0, 0, ny - 1, ny - 1])
    centre = SkyCoord(gaia_center[0] * u.deg, gaia_center[1] * u.deg)
    margin = (STAMP_HALF + 1) * 6.2 / 3600
    if float(centre.separation(corners).deg.max()) + margin > gaia_radius_deg:
        raise ValueError("Gaia cone does not cover the cutout plus its stamp margin")
    ra, dec = gaia.propagate(cat, cut.mjd_mid)
    px, py = w.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    sel = (px > -STAMP_HALF) & (px < nx - 1 + STAMP_HALF) & (py > -STAMP_HALF) & (py < ny - 1 + STAMP_HALF)
    g = cat["phot_g_mean_mag"].to_numpy()[sel]
    x, y, _, _ = merge_close(px[sel], py[sel], 10 ** (-0.4 * (np.nan_to_num(g, nan=21.0) - 21.0)))
    rej, _ = mask_for(cut.flags, bit_map(cut.flags_header), FIT_REJECT)
    data = cut.image.astype(np.float64) - cut.zodi.astype(np.float64)
    var = cut.variance.astype(np.float64)
    valid = np.isfinite(data) & np.isfinite(var) & (var > 0) & ~rej
    data = np.where(np.isfinite(data), data, 0.0)
    var = np.where(valid, var, 1.0)
    ep = EPSFGrid(cut.psf_planes, cut.psf_header, cut.x0, cut.y0,
                  pixel_response=psf_kind(cut.meta["version"]) == "optical")
    inp = SceneInputs(data, var, valid, ep, x, y, half=STAMP_HALF)
    sol, system = tune_and_solve(inp, tune=tune)
    return CutoutFit(cut, inp, sol, system)
