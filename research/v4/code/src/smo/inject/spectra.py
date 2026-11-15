"""Fake-mover brightness across a visit's frames (prereg/YARDSTICK.md §4).

Shape across wavelength: kete's NEATM (thermal emission plus HG reflected sunlight) at the
clone's real geometry, with band albedos from a simple taxonomic reflectance slope. Only the
shape is used. The level is set by the drawn reference magnitude m_ref: the AB magnitude in the
visit's short-wavelength detector (D1-D3) at each exposure's wavelength, averaged in flux over
the visit's exposures. NEATM's thermal/reflected ratio depends on albedo, beaming and distance,
not on diameter, so a nominal 1 km diameter is used.

Simplifications, stated so the realism gate can be read against them: reflectance is linear in
wavelength per class (no 1 or 2 um silicate bands, no 3 um hydration band), and the beaming
parameter is fixed at NEATM's default of 1.0.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import kete

AB_ZERO_JY = 3631.0

# Reflectance relative to V, per micron of wavelength beyond 0.55 um, and the geometric-albedo
# distribution (log-normal: median, dex scatter). Values are representative, not fitted.
CLASSES = {
    "S": {"slope_per_um": 0.40, "pv_median": 0.25, "pv_dex": 0.15},
    "C": {"slope_per_um": 0.05, "pv_median": 0.06, "pv_dex": 0.15},
}
S_FRACTION = 1.0 / 3.0  # S : C = 1 : 2 (registered)
MAX_REL_REFLECTANCE = 2.0


@dataclass
class FakePhotometry:
    cls: str
    pv: float
    lc_amp_mag: float  # peak to peak
    lc_period_h: float
    lc_phase: float

    def band_albedos(self, wavelength_um: np.ndarray) -> np.ndarray:
        slope = CLASSES[self.cls]["slope_per_um"]
        rel = np.clip(1.0 + slope * (np.asarray(wavelength_um, float) - 0.55), 0.1, MAX_REL_REFLECTANCE)
        return np.clip(self.pv * rel, 1e-4, 0.99)

    def lightcurve(self, mjd: np.ndarray) -> np.ndarray:
        """Flux multiplier exp(-0.4 ln10 dm) for a sinusoid of the stated peak-to-peak amplitude."""
        dm = 0.5 * self.lc_amp_mag * np.sin(2 * np.pi * np.asarray(mjd, float) * 24.0 / self.lc_period_h + self.lc_phase)
        return 10 ** (-0.4 * dm)


def draw_photometry(rng: np.random.Generator) -> FakePhotometry:
    cls = "S" if rng.uniform() < S_FRACTION else "C"
    c = CLASSES[cls]
    pv = float(np.clip(c["pv_median"] * 10 ** (c["pv_dex"] * rng.standard_normal()), 0.01, 0.8))
    return FakePhotometry(cls, pv, float(rng.uniform(0.0, 0.3)), float(rng.uniform(2.0, 20.0)),
                          float(rng.uniform(0, 2 * np.pi)))


def spectral_shape(phot: FakePhotometry, sun2obj: np.ndarray, sun2obs: np.ndarray,
                   wavelength_um: np.ndarray) -> np.ndarray:
    """Relative flux density (F_nu, arbitrary units) at each wavelength, thermal plus reflected."""
    wl = np.asarray(wavelength_um, float)
    res = kete.flux.neatm_model_flux(list(map(float, sun2obj)), list(map(float, sun2obs)),
                                     list(map(float, phot.band_albedos(wl))), diameter=1.0,
                                     vis_albedo=phot.pv, band_wavelengths=list(map(float, wl * 1000.0)))
    out = np.asarray(res.fluxes, float)
    if not np.all(np.isfinite(out) & (out > 0)):
        raise ValueError("NEATM returned a non-positive or non-finite flux")
    return out


def frame_fluxes_jy(m_ref: float, shape: np.ndarray, is_short: np.ndarray, lc: np.ndarray) -> np.ndarray:
    """Flux density in Jy per frame. `shape` and `lc` are per frame; the short-detector frames'
    mean of shape x lightcurve is pinned to m_ref, so m_ref is the visit-averaged AB magnitude
    in the short detector as registered."""
    is_short = np.asarray(is_short, bool)
    if not is_short.any():
        raise ValueError("visit has no short-wavelength frame to define m_ref")
    level = AB_ZERO_JY * 10 ** (-0.4 * m_ref)
    rel = shape * lc
    return level * rel / rel[is_short].mean()
