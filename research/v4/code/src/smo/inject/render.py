"""Render fake movers into a cutout's raw IMAGE pixels (prereg/YARDSTICK.md §4).

* Light goes into IMAGE, before any method runs, with the exposure's zone-blended PSF at the
  width scale that exposure's own uninjected fit found, at the WCS position plus that fit's
  global shift (where a real object at that sky position would land).
* Motion smear: the exposure is split into equal sub-steps between MJD-BEG and MJD-END, each
  carrying an equal share of the flux.
* Photon noise for the fake's own light, and the matching VARIANCE increase. No gain keyword
  exists in the files, so the conversion comes from the cutout itself: VARIANCE is close to
  proportional to IMAGE on unflagged pixels (zodiacal light dominates), and the slope is measured
  by a straight-line fit to binned medians of the brighter half of the pixels.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from smo.data.exposure import Cutout
from smo.data.flags import FIT_REJECT, bit_map, mask_for
from smo.scene.psf import EPSFGrid, psf_kind

SMEAR_STEPS = 9


def variance_slope(cut: Cutout) -> tuple[float, float]:
    """(slope, intercept) of VARIANCE against IMAGE, from binned medians of the upper half of
    unflagged pixels. Slope is in MJy/sr per (MJy/sr)^2 of variance, i.e. variance per unit signal."""
    rej, _ = mask_for(cut.flags, bit_map(cut.flags_header), FIT_REJECT)
    x = cut.image.astype(np.float64)
    y = cut.variance.astype(np.float64)
    ok = np.isfinite(x) & np.isfinite(y) & (y > 0) & ~rej
    x, y = x[ok], y[ok]
    edges = np.quantile(x, np.linspace(0.5, 0.9995, 13))
    idx = np.digitize(x, edges)
    bx = np.array([np.median(x[idx == k]) for k in range(1, 13)])
    by = np.array([np.median(y[idx == k]) for k in range(1, 13)])
    slope, intercept = np.polyfit(bx, by, 1)
    if not slope > 0:
        raise ValueError(f"{cut.key}: non-positive variance slope {slope}")
    return float(slope), float(intercept)


def pixel_solid_angle_sr(cut: Cutout) -> float:
    from astropy.wcs.utils import proj_plane_pixel_area

    return float(proj_plane_pixel_area(cut.wcs().celestial)) * (np.pi / 180.0) ** 2


@dataclass
class FrameFake:
    """One fake in one frame: cutout-pixel positions of the smear sub-steps (WCS, before the
    frame's global shift) and total flux in image units x pixel (MJy/sr x px)."""
    fake_id: int
    x_sub: np.ndarray
    y_sub: np.ndarray
    flux_img: float


def inject(cut: Cutout, fakes: list[FrameFake], rng: np.random.Generator, scale: float = 1.0,
           dx: float = 0.0, dy: float = 0.0, slope: float | None = None) -> tuple[Cutout, dict]:
    """A copy of `cut` with the fakes added (photon noise included), and a record of what was added."""
    ep = EPSFGrid(cut.psf_planes, cut.psf_header, cut.x0, cut.y0,
                  pixel_response=psf_kind(cut.meta["version"]) == "optical")
    half = ep.max_half_width
    ny, nx = cut.shape
    added = np.zeros((ny, nx))
    for f in fakes:
        n = len(f.x_sub)
        st, ix0, iy0 = ep.render(np.asarray(f.x_sub, float) + dx, np.asarray(f.y_sub, float) + dy, half, scale)
        for k in range(n):
            ya, xa = iy0[k], ix0[k]
            y0c, x0c = max(ya, 0), max(xa, 0)
            y1c, x1c = min(ya + 2 * half + 1, ny), min(xa + 2 * half + 1, nx)
            if y1c <= y0c or x1c <= x0c:
                continue
            added[y0c:y1c, x0c:x1c] += (f.flux_img / n) * st[k, y0c - ya:y1c - ya, x0c - xa:x1c - xa]
    if slope is None:
        slope, _ = variance_slope(cut)
    lam = slope * np.clip(added, 0.0, None)
    noise = rng.standard_normal(added.shape) * np.sqrt(lam)
    image = (cut.image.astype(np.float64) + added + noise).astype(cut.image.dtype)
    variance = (cut.variance.astype(np.float64) + lam).astype(cut.variance.dtype)
    out = replace(cut, image=image, variance=variance, meta={**cut.meta, "injected": len(fakes)})
    return out, {"variance_slope": slope, "added_total": float(added.sum()), "n_fakes": len(fakes),
                 "scale": scale, "dx": dx, "dy": dy}
