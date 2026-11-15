"""Per-frame significance maps and the patch-plane geometry used by detection methods.

Kept separate from the detection logic so that cached maps depend only on what makes them (the
scene fit, the matched filter and the plane map), not on how a detector uses them.

* Matched filter: Z = (r w * P) / sqrt(w * P^2), with r the scene-fit residual, w = 1/VARIANCE on
  fitted pixels (0 elsewhere) and P the frame's ePSF at its tuned width (correlation).
* Positions: a sky position s lands at pixel WCS(s) + (dx, dy), where (dx, dy) is the frame's fitted
  global shift, as the fitted stars do. Tracks live in a gnomonic plane about the patch centre
  (arcsec); each frame maps that plane to pixels with a cubic polynomial fitted to its WCS.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from scipy import ndimage
from scipy.signal import fftconvolve

from smo.data.exposure import Cutout
from smo.data.patch import Frame


# ----------------------------------------------------------------------------- geometry

class Plane:
    """Gnomonic plane about (ra0, dec0), coordinates in arcsec."""

    def __init__(self, ra0: float, dec0: float):
        self.c = SkyCoord(ra0 * u.deg, dec0 * u.deg)
        self.frame = self.c.skyoffset_frame()

    def from_sky(self, ra, dec) -> tuple[np.ndarray, np.ndarray]:
        o = SkyCoord(np.asarray(ra) * u.deg, np.asarray(dec) * u.deg).transform_to(self.frame)
        lon, lat = np.radians(o.lon.deg), np.radians(o.lat.deg)
        cosc = np.cos(lat) * np.cos(lon)
        k = 206264.80624709636 / cosc
        return k * np.cos(lat) * np.sin(lon), k * np.sin(lat)

    def to_sky(self, xi, eta) -> tuple[np.ndarray, np.ndarray]:
        x, y = np.asarray(xi) / 206264.80624709636, np.asarray(eta) / 206264.80624709636
        rho = np.hypot(x, y)
        c = np.arctan(rho)
        with np.errstate(invalid="ignore", divide="ignore"):
            lat = np.arcsin(np.where(rho > 0, y * np.sin(c) / np.where(rho > 0, rho, 1), 0.0))
        lon = np.arctan2(x * np.sin(c), rho * np.cos(c))
        o = SkyCoord(lon=np.degrees(lon) * u.deg, lat=np.degrees(lat) * u.deg, frame=self.frame).icrs
        return o.ra.deg, o.dec.deg


def _poly_terms(a: np.ndarray, b: np.ndarray, deg: int = 3) -> np.ndarray:
    return np.stack([a ** i * b ** j for i in range(deg + 1) for j in range(deg + 1 - i)], axis=-1)


@dataclass
class PlaneMap:
    """Cubic polynomials between the patch plane (arcsec) and one frame's WCS pixels."""
    cx: np.ndarray
    cy: np.ndarray
    ci: np.ndarray
    ce: np.ndarray
    s: float = 3600.0  # arcsec normalisation for conditioning
    p: float = 300.0  # pixel normalisation

    @classmethod
    def fit(cls, cut: Cutout, plane: Plane, n: int = 21) -> "PlaneMap":
        ny, nx = cut.shape
        gy, gx = np.meshgrid(np.linspace(-5, ny + 4, n), np.linspace(-5, nx + 4, n), indexing="ij")
        sky = cut.wcs().pixel_to_world(gx.ravel(), gy.ravel())
        xi, eta = plane.from_sky(sky.ra.deg, sky.dec.deg)
        s, p = 3600.0, 300.0
        T = _poly_terms(xi / s, eta / s)
        cx = np.linalg.lstsq(T, gx.ravel() / p, rcond=None)[0]
        cy = np.linalg.lstsq(T, gy.ravel() / p, rcond=None)[0]
        Ti = _poly_terms(gx.ravel() / p, gy.ravel() / p)
        ci = np.linalg.lstsq(Ti, xi / s, rcond=None)[0]
        ce = np.linalg.lstsq(Ti, eta / s, rcond=None)[0]
        return cls(cx, cy, ci, ce, s, p)

    def to_pix(self, xi, eta) -> tuple[np.ndarray, np.ndarray]:
        T = _poly_terms(np.asarray(xi) / self.s, np.asarray(eta) / self.s)
        return (T @ self.cx) * self.p, (T @ self.cy) * self.p

    def to_plane(self, x, y) -> tuple[np.ndarray, np.ndarray]:
        T = _poly_terms(np.asarray(x) / self.p, np.asarray(y) / self.p)
        return (T @ self.ci) * self.s, (T @ self.ce) * self.s


# ----------------------------------------------------------------------------- per frame

@dataclass
class FrameMap:
    frame: Frame
    z: np.ndarray  # matched-filter significance (NaN where no fitted pixel contributes)
    dx: float
    dy: float
    scale: float
    pmap: PlaneMap
    fit: object | None = None  # smo.scene.pipeline.CutoutFit, kept only for target frames
    gaia_xy: np.ndarray | None = None  # fitted source positions (cutout px, before shift)
    meta: dict = field(default_factory=dict)

    _coef: np.ndarray | None = None
    _m: np.ndarray | None = None

    def _prepare(self):
        if self._coef is None:
            zz = np.where(np.isfinite(self.z), self.z, 0.0).astype(np.float64)
            self._coef = ndimage.spline_filter(zz, order=3, mode="nearest")
            self._m = np.isfinite(self.z).astype(np.float64)

    def z_at(self, xi: np.ndarray, eta: np.ndarray) -> np.ndarray:
        """Z at plane positions (shift applied), by cubic-spline interpolation: Z is PSF-smoothed,
        and bilinear interpolation of a peaked map would pull tracks towards pixel centres. NaN off
        the map, or where any of the four neighbouring pixels has no significance."""
        x, y = self.pmap.to_pix(xi, eta)
        x, y = x + self.dx, y + self.dy
        ny, nx = self.z.shape
        out = np.full(np.shape(x), np.nan)
        ok = (x >= 0) & (x <= nx - 1) & (y >= 0) & (y <= ny - 1)
        if ok.any():
            self._prepare()
            v = ndimage.map_coordinates(self._coef, [y[ok], x[ok]], order=3, mode="nearest", prefilter=False)
            m = ndimage.map_coordinates(self._m, [y[ok], x[ok]], order=1)
            out[ok] = np.where(m > 0.999, v, np.nan)
        return out


def matched_filter(resid: np.ndarray, variance: np.ndarray, valid: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    w = np.where(valid, 1.0 / variance, 0.0)
    r = np.where(valid & np.isfinite(resid), resid, 0.0)
    k = kernel[::-1, ::-1]
    num = fftconvolve(r * w, k, mode="same")
    den = fftconvolve(w, k ** 2, mode="same")
    with np.errstate(invalid="ignore", divide="ignore"):
        z = num / np.sqrt(den)
    # A position counts only if fitted pixels carry at least half the kernel's weight.
    cover = fftconvolve(valid.astype(float), k ** 2, mode="same") / np.sum(k ** 2)
    z[cover < 0.5] = np.nan
    return z


def frame_map(fit, frame: Frame, plane: Plane, keep_fit: bool = False) -> FrameMap:
    """From a CutoutFit (smo.scene.pipeline) to the frame's significance map."""
    sol, inp = fit.sol, fit.inp
    ny, nx = inp.shape
    # The kernel must be centred on its middle pixel, so it is rendered at an integer position
    # (a half-integer centre, as for an even-sized cutout, would shift the whole map by 0.5 px).
    st, _, _ = inp.epsf.render(np.array([float(nx // 2)]), np.array([float(ny // 2)]), inp.half, sol.scale)
    z = matched_filter(fit.system.residual_image(), inp.variance, inp.valid, st[0])
    return FrameMap(frame, z.astype(np.float32), float(sol.dx), float(sol.dy), float(sol.scale),
                    PlaneMap.fit(fit.cut, plane), fit if keep_fit else None,
                    np.stack([inp.x, inp.y], axis=1),
                    {"chi2_dof": float(sol.chi2 / max(sol.n_valid - sol.n_params, 1)), "converged": bool(sol.converged)})
