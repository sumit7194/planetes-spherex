"""ePSF rendering from SPHEREx's oversampled, zone-gridded ePSF cube.

* Zone centres and the oversampling factor are read from the PSF header, never assumed.
* The ePSF at a detector position is the bilinear interpolation of the four surrounding zones
  (constant beyond the outermost zone centres), so the model varies smoothly across the detector.
* Each zone is sampled with cubic splines. Splines are linear, so interpolating spline
  coefficients between zones is identical to interpolating the ePSFs themselves.
* Normalisation follows the file: each oversampled plane sums to 1, so native-pixel samples are
  multiplied by OVERSAMP**2. A flux f is then the total source flux in image units x pixel.
* Pixel response. QR2 files (pipeline 6.x) carry an optical PSF with the detector-pixel response
  deconvolved ("stacking used 10x oversampling, followed by deconvolution with the pixel grid
  function", pipeline paper arXiv 2511.15823). Pixel values are then the PSF integrated over each
  pixel, so each plane is convolved with a one-pixel box before sampling (`pixel_response=True`).
  The R7 / QR3 product is a true ePSF that already includes the pixel response (Explanatory
  Supplement v2.0, sect. 4.2.3) and must be point-sampled; see `psf_kind`.
"""

from __future__ import annotations

import numpy as np
from astropy.io import fits
from scipy import ndimage


def psf_kind(pipeline_version: str) -> str:
    """'optical' (needs pixel-response convolution) for pipeline 6.x; anything else is refused
    until its PSF convention has been checked against a real file."""
    major = pipeline_version.strip().split(".")[0]
    if major == "6":
        return "optical"
    raise NotImplementedError(f"PSF convention for pipeline {pipeline_version!r} not yet verified")


def pixel_integrate(plane: np.ndarray, os: int) -> np.ndarray:
    """Convolve an oversampled PSF with a one-native-pixel box, exactly, in Fourier space.

    The box's transfer function is sinc(f) per axis, with f in cycles per native pixel. Padding
    by one native pixel on every side prevents wrap-around (the box extends half a pixel).
    """
    pad = os
    p = np.pad(np.asarray(plane, dtype=np.float64), pad)
    fy = np.fft.fftfreq(p.shape[0], d=1.0 / os)
    fx = np.fft.rfftfreq(p.shape[1], d=1.0 / os)
    tf = np.sinc(fy)[:, None] * np.sinc(fx)[None, :]
    out = np.fft.irfft2(np.fft.rfft2(p) * tf, s=p.shape)
    return out[pad:-pad, pad:-pad]


class EPSFGrid:
    def __init__(self, planes: dict[int, np.ndarray], header: fits.Header, x0: int, y0: int,
                 pixel_response: bool = False):
        self.os = int(header["OVERSAMP"])
        self.pixel_response = pixel_response
        self.cx = float(header["CRPIX1"]) - 1.0  # 0-based oversampled index of the PSF centre
        self.cy = float(header["CRPIX2"]) - 1.0
        n = int(header["NAXIS3"])
        # Zone centres are in detector coordinates with 0 at the outer edge of pixel 0, so a
        # 0-based pixel centre i sits at i + 0.5.
        self.xc_all = np.array([header[f"XCTR_{k + 1}"] for k in range(n)], dtype=float)
        self.yc_all = np.array([header[f"YCTR_{k + 1}"] for k in range(n)], dtype=float)
        self.ux = np.unique(np.round(self.xc_all, 6))
        self.uy = np.unique(np.round(self.yc_all, 6))
        self.plane_at = {(round(float(self.xc_all[k]), 6), round(float(self.yc_all[k]), 6)): k for k in range(n)}
        self.x0, self.y0 = x0, y0
        self.raw = {k: np.asarray(p, dtype=np.float64) for k, p in planes.items()}
        self._raw_coef = {k: ndimage.spline_filter(p, order=3, mode="grid-constant") for k, p in self.raw.items()}
        self._coef_cache: dict[float, dict[int, np.ndarray]] = {}
        self.coef = self._coefficients(1.0)
        self.half_os = (next(iter(planes.values())).shape[0] - 1) / 2

    def _coefficients(self, scale: float) -> dict[int, np.ndarray]:
        """Spline coefficients of the model sampled per native pixel, for a given width scale.

        With pixel_response, the width scale stretches the *optical* PSF, P_s(r) = P(r/s)/s^2,
        which is then integrated over a fixed one-pixel box: the detector pixel does not change
        size. Without pixel_response (a true ePSF), there is no separate optical PSF, and the
        scale is applied to the ePSF coordinates in `render` (an approximation for that case).
        """
        key = round(float(scale), 12)
        if key in self._coef_cache:
            return self._coef_cache[key]
        out = {}
        for k, raw in self.raw.items():
            p = raw
            if self.pixel_response:
                if key != 1.0:
                    ny, nx = raw.shape
                    jj, ii = np.mgrid[0:ny, 0:nx].astype(float)
                    src_y = self.cy + (jj - self.cy) / key
                    src_x = self.cx + (ii - self.cx) / key
                    p = ndimage.map_coordinates(self._raw_coef[k], [src_y, src_x], order=3,
                                                mode="grid-constant", cval=0.0, prefilter=False) / key ** 2
                p = pixel_integrate(p, self.os)
            out[k] = ndimage.spline_filter(p, order=3, mode="grid-constant")
        if len(self._coef_cache) >= 8:
            self._coef_cache.pop(next(iter(self._coef_cache)))
        self._coef_cache[key] = out
        return out

    @property
    def max_half_width(self) -> int:
        """Largest native-pixel radius the ePSF array supports."""
        return int(np.floor(self.half_os / self.os))

    def zone_weights(self, x: np.ndarray, y: np.ndarray) -> list[tuple[int, np.ndarray]]:
        """(plane, weight-per-source) pairs for bilinear interpolation between zone centres."""
        fx = np.asarray(x, float) + self.x0 + 0.5
        fy = np.asarray(y, float) + self.y0 + 0.5

        def axis(u: np.ndarray, v: np.ndarray):
            if len(u) == 1:  # a single zone along this axis: constant
                z = np.zeros(len(v), dtype=int)
                return z, z, np.zeros(len(v))
            vc = np.clip(v, u[0], u[-1])
            i1 = np.clip(np.searchsorted(u, vc, side="right"), 1, len(u) - 1)
            i0 = i1 - 1
            t = (vc - u[i0]) / (u[i1] - u[i0])
            return i0, i1, t

        ix0, ix1, tx = axis(self.ux, fx)
        iy0, iy1, ty = axis(self.uy, fy)
        acc: dict[int, np.ndarray] = {}
        x_pairs = ((ix0, 1 - tx),) if len(self.ux) == 1 else ((ix0, 1 - tx), (ix1, tx))
        y_pairs = ((iy0, 1 - ty),) if len(self.uy) == 1 else ((iy0, 1 - ty), (iy1, ty))
        for ia, wa in x_pairs:
            for ib, wb in y_pairs:
                w = wa * wb
                for k_x, k_y in set(zip(ia.tolist(), ib.tolist(), strict=True)):
                    plane = self.plane_at[(self.ux[k_x], self.uy[k_y])]
                    sel = (ia == k_x) & (ib == k_y)
                    if plane not in acc:
                        acc[plane] = np.zeros(len(fx))
                    acc[plane][sel] += w[sel]
        missing = [p for p in acc if p not in self.raw and np.any(acc[p] > 0)]
        if missing:
            raise KeyError(f"ePSF planes {missing} needed but not loaded")
        total = sum(acc.values())
        if not np.allclose(total, 1.0, atol=1e-12):
            raise AssertionError("zone interpolation weights do not sum to 1")
        return [(p, w) for p, w in acc.items() if np.any(w > 0)]

    def render(self, x: np.ndarray, y: np.ndarray, half: int, scale: float = 1.0
               ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Native-pixel stamps for point sources at cutout coordinates (x, y).

        Returns (stamps[N, 2h+1, 2h+1], ix0[N], iy0[N]) where stamp pixel [j, i] is cutout pixel
        (iy0 + j, ix0 + i). `scale` > 1 broadens the ePSF while conserving its integral.
        """
        if half > self.max_half_width:
            raise ValueError(f"half-width {half} exceeds ePSF support {self.max_half_width}")
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        ixc = np.rint(x).astype(int)
        iyc = np.rint(y).astype(int)
        off = np.arange(-half, half + 1)
        # Offsets of each stamp pixel centre from the source, in native pixels.
        u = (ixc[:, None] + off[None, :]) - x[:, None]  # (N, W) along x
        v = (iyc[:, None] + off[None, :]) - y[:, None]  # (N, W) along y
        coord_scale = 1.0 if self.pixel_response else scale
        coef = self._coefficients(scale) if self.pixel_response else self.coef
        X = self.cx + self.os * u / coord_scale
        Y = self.cy + self.os * v / coord_scale
        W = len(off)
        XX = np.broadcast_to(X[:, None, :], (len(x), W, W))
        YY = np.broadcast_to(Y[:, :, None], (len(x), W, W))
        stamps = np.zeros((len(x), W, W))
        for plane, w in self.zone_weights(x, y):
            sel = w > 0
            vals = ndimage.map_coordinates(coef[plane], [YY[sel].ravel(), XX[sel].ravel()],
                                           order=3, mode="grid-constant", cval=0.0, prefilter=False)
            stamps[sel] += w[sel, None, None] * vals.reshape(-1, W, W)
        stamps *= (self.os ** 2) / (coord_scale ** 2)
        return stamps, ixc - half, iyc - half
