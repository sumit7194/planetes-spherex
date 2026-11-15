"""Static sources SPHEREx itself sees, from a leave-half-out multi-visit stack (method entry v1).

* A patch's visits are split in time at their median start into halves A and B. For each half,
  every visit's zero-motion linear stack nu (the registered time-rule statistic, from the
  uninjected v0 significance maps) is evaluated on a plane grid, and the median over the half's
  visits is the half's static map. A frame in half A is fitted with the sources found in half B,
  and the reverse, so the visit being scored never contributes to its own static reference.
* Sources are local maxima (3 x 3) of a half's static map with median nu >= MIN_NU, centroided
  with a parabola, kept only if at least MIN_VISITS visits of the half cover the position.
* Kept only if more than MIN_SEP_CAT_PX from every Gaia source, and more than MIN_SEP_BRIGHT_PX
  from Gaia stars brighter than G 14, so PSF-model residuals around catalogued stars are not
  turned into sources.
* Positions are snapped to the nearest CatWISE2020 source within SNAP_PX when there is one
  (CatWISE astrometry is better than a SPHEREx stack peak); otherwise the centroid is used.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

GRID_PX = 1.0
MIN_NU = 2.0
MIN_VISITS = 5
MIN_SEP_CAT_PX = 2.0
MIN_SEP_BRIGHT_PX = 4.0
BRIGHT_G = 14.0
SNAP_PX = 0.75
PIXEL_ARCSEC = 6.15


@dataclass
class StaticList:
    half: str  # the half whose visits built it
    xi: np.ndarray  # plane arcsec
    eta: np.ndarray
    nu: np.ndarray  # median nu at the peak
    snapped: np.ndarray  # bool: position taken from CatWISE


def split_halves(visit_t: dict[str, float]) -> dict[str, str]:
    """Visit -> 'A' (start before the median) or 'B'."""
    t_med = float(np.median(list(visit_t.values())))
    return {v: ("A" if t < t_med else "B") for v, t in visit_t.items()}


def static_map(maps_by_visit: dict, visits: list[str], half_width_arcsec: float, stack_fn) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(median nu, number of visits covering, grid axis in arcsec) over `visits` on a square grid."""
    ax = np.arange(-half_width_arcsec, half_width_arcsec + 1e-6, GRID_PX * PIXEL_ARCSEC)
    gx, gy = np.meshgrid(ax, ax, indexing="xy")
    pts = np.stack([gx.ravel(), gy.ravel()], axis=1)
    per = []
    for v in visits:
        maps = maps_by_visit[v]
        nu, _ = stack_fn(maps, np.zeros(len(maps)), pts, np.zeros((len(pts), 1, 2)))
        nu = nu[:, 0]
        per.append(np.where(np.isfinite(nu), nu, np.nan))
        for m in maps:
            m._coef = m._m = None  # release the prepared spline
    arr = np.array(per)
    cover = np.sum(np.isfinite(arr), axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # grid points no visit covers
        med = np.nanmedian(arr, axis=0)
    return med.reshape(gx.shape), cover.reshape(gx.shape), ax


def find_sources(med: np.ndarray, cover: np.ndarray, ax: np.ndarray, gaia_xy: np.ndarray, gaia_g: np.ndarray,
                 catwise_xy: np.ndarray, half: str) -> StaticList:
    z = np.where(np.isfinite(med) & (cover >= MIN_VISITS), med, -np.inf)
    peak = (z == ndimage.maximum_filter(z, size=3)) & (z >= MIN_NU)
    peak[[0, -1], :] = False
    peak[:, [0, -1]] = False
    iy, ix = np.nonzero(peak)
    zz = np.where(np.isfinite(z), z, 0.0)

    def para(zm, z0, zp):
        den = zm - 2 * z0 + zp
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.clip(np.nan_to_num(np.where(den < 0, 0.5 * (zm - zp) / den, 0.0)), -0.5, 0.5)

    ox = para(zz[iy, ix - 1], zz[iy, ix], zz[iy, ix + 1])
    oy = para(zz[iy - 1, ix], zz[iy, ix], zz[iy + 1, ix])
    step = ax[1] - ax[0]
    xi, eta, nu = ax[0] + (ix + ox) * step, ax[0] + (iy + oy) * step, med[iy, ix]
    keep = np.ones(len(xi), bool)
    if len(gaia_xy):
        d, _ = cKDTree(gaia_xy).query(np.stack([xi, eta], 1))
        keep &= d > MIN_SEP_CAT_PX * PIXEL_ARCSEC
        bright = gaia_xy[np.asarray(gaia_g) < BRIGHT_G]
        if len(bright):
            d, _ = cKDTree(bright).query(np.stack([xi, eta], 1))
            keep &= d > MIN_SEP_BRIGHT_PX * PIXEL_ARCSEC
    xi, eta, nu = xi[keep], eta[keep], nu[keep]
    snapped = np.zeros(len(xi), bool)
    if len(catwise_xy) and len(xi):
        d, j = cKDTree(catwise_xy).query(np.stack([xi, eta], 1))
        snapped = d <= SNAP_PX * PIXEL_ARCSEC
        xi = np.where(snapped, catwise_xy[j, 0], xi)
        eta = np.where(snapped, catwise_xy[j, 1], eta)
    return StaticList(half, xi, eta, nu, snapped)
