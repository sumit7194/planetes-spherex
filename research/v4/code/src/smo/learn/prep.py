"""Pilot data for option 1b: scene-fit residuals of many exposures of one sky patch, on a common grid.

For every exposure covering the region: fit the scene, convert the residual to S/N units, and
resample it onto a shared north-up tangent grid at the native 6.15" scale (bilinear; a pixel is
kept only if all four source pixels are valid). Per (exposure, 16 x 16 patch) the metadata the
network may see is recorded: wavelength, bandwidth, detector, detector position, sub-pixel offset.
Time-like quantities (date, visit) are stored separately and are used only for masking and audits.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from astropy.wcs import WCS
from scipy import ndimage

PATCH = 16
PIX_DEG = 6.15 / 3600.0


def grid_wcs(ra0: float, dec0: float, n: int) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra0, dec0]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    w.wcs.cdelt = [-PIX_DEG, PIX_DEG]
    return w


@dataclass
class Resampled:
    z: np.ndarray  # (n, n) float32, NaN where invalid
    valid: np.ndarray  # (n, n) bool
    src_x: np.ndarray  # (n, n) float64 exposure cutout pixel coordinates of each grid pixel
    src_y: np.ndarray


def resample(z_native: np.ndarray, valid_native: np.ndarray, cut_wcs: WCS, target: WCS, n: int) -> Resampled:
    jj, ii = np.mgrid[0:n, 0:n]
    world = target.pixel_to_world(ii.ravel(), jj.ravel())
    sx, sy = cut_wcs.world_to_pixel(world)
    sx = np.asarray(sx).reshape(n, n)
    sy = np.asarray(sy).reshape(n, n)
    filled = np.where(valid_native, z_native, 0.0)
    zr = ndimage.map_coordinates(filled, [sy, sx], order=1, mode="constant", cval=0.0)
    # A grid pixel is valid only if every one of its four bilinear source pixels is valid.
    x0 = np.floor(sx).astype(int)
    y0 = np.floor(sy).astype(int)
    ny, nx = z_native.shape
    ok = (x0 >= 0) & (y0 >= 0) & (x0 + 1 < nx) & (y0 + 1 < ny)
    v = np.zeros((n, n), bool)
    xi, yi = np.clip(x0, 0, nx - 2), np.clip(y0, 0, ny - 2)
    v[ok] = (valid_native[yi, xi] & valid_native[yi, xi + 1] & valid_native[yi + 1, xi] & valid_native[yi + 1, xi + 1])[ok]
    zr = np.where(v, zr, np.nan).astype(np.float32)
    return Resampled(zr, v, sx, sy)


def patch_metadata(res: Resampled, cut, cwave: np.ndarray, cband: np.ndarray) -> dict[str, np.ndarray]:
    """Per-patch values at each patch centre: wavelength, bandwidth, detector position, sub-pixel offset."""
    n = res.z.shape[0]
    m = n // PATCH
    c = PATCH // 2
    cy = (np.arange(m) * PATCH + c)[:, None].repeat(m, 1)
    cx = (np.arange(m) * PATCH + c)[None, :].repeat(m, 0)
    sx = res.src_x[cy, cx]
    sy = res.src_y[cy, cx]
    fx = sx + cut.x0
    fy = sy + cut.y0
    ixf = np.clip(np.rint(fx).astype(int), 0, 2039)
    iyf = np.clip(np.rint(fy).astype(int), 0, 2039)
    vfrac = res.valid.reshape(m, PATCH, m, PATCH).mean(axis=(1, 3))
    return {"lam": cwave[iyf, ixf], "band": cband[iyf, ixf], "detx": fx, "dety": fy,
            "fracx": sx - np.floor(sx), "fracy": sy - np.floor(sy), "valid_frac": vfrac}
