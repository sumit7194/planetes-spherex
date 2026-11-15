"""Fake-mover photometry for the slow-mover yardstick (prereg/slowmover/PLAN.md §3, §8 of 15 Nov).

Each fake has a W2 magnitude (Vega, uniform 12-18) and a spectral family:
  - brown-dwarf-like: Sonora Bobcat, Teff 900 K or 500 K (alternating), from prereg/slowmover/sonora;
  - star-like: a 4000 K blackbody.
Only each spectrum's shape is used. Its level is set by synthetic photometry against Vega with the
WISE W2 relative spectral response, which the WISE team gives *per photon* (Wright et al. 2010,
RSR-W2.txt header), so the photon-weighted form is used:
    m = -2.5 log10( ∫ F_λ R λ dλ / ∫ F_λ,Vega R λ dλ )
(Physics, 15 Nov: this avoids WISE's ν⁻² colour-correction convention, which is 10-20% off for
Y-dwarf spectra.) Vega is CALSPEC alpha_lyr_stis_012. Both files are in
prereg/slowmover/photometry with their sha256 in PLAN §8.

Per photo the flux is F_ν averaged over [CWAVE − CBAND/2, CWAVE + CBAND/2] at the fake's pixel
(uniform in λ), in Jy; the renderer's image units come from flux_img = F_ν[Jy] × 1e-6 / Ω_pix
(smo/inject/plan.py).
"""
from __future__ import annotations

import gzip
from functools import lru_cache
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
PRE = HERE.parent / "prereg" / "slowmover"
C_UM_HZ = 2.99792458e14  # speed of light in µm/s
H, K = 6.62607015e-34, 1.380649e-23
W2_ZP_JY = 171.787  # Jarrett et al. 2011, for the unit test only
W2_ISO_UM = 4.6028


@lru_cache(maxsize=1)
def w2() -> tuple[np.ndarray, np.ndarray]:
    lam, r = [], []
    for line in (PRE / "photometry" / "RSR-W2.txt").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            a, b, *_ = line.split()
            lam.append(float(a))
            r.append(float(b))
    return np.array(lam), np.array(r)


@lru_cache(maxsize=1)
def vega() -> tuple[np.ndarray, np.ndarray]:
    """Vega: wavelength (µm) and F_ν (Jy)."""
    from astropy.io import fits
    d = fits.open(PRE / "photometry" / "alpha_lyr_stis_012.fits")[1].data
    lam_um = np.asarray(d["WAVELENGTH"], float) / 1e4
    flam = np.asarray(d["FLUX"], float)  # erg/s/cm²/Å
    fnu_jy = flam * (lam_um * 1e4) ** 2 / 2.99792458e18 * 1e23
    return lam_um, fnu_jy


@lru_cache(maxsize=4)
def sonora(teff: int) -> tuple[np.ndarray, np.ndarray]:
    """A Sonora Bobcat spectrum: wavelength (µm, increasing) and F_ν (arbitrary units)."""
    name = {900: "sp_t900g1000nc_m0.0.gz", 500: "sp_t500g1000nc_m0.0.gz"}[teff]
    rows = []
    with gzip.open(PRE / "sonora" / name, "rt") as f:
        for i, line in enumerate(f):
            if i < 2:
                continue
            a, b = line.split()[:2]
            rows.append((float(a), float(b)))
    a = np.array(rows)
    o = np.argsort(a[:, 0])
    return a[o, 0], a[o, 1]


def blackbody(teff: float, lam_um: np.ndarray) -> np.ndarray:
    """F_ν of a blackbody (arbitrary units)."""
    nu = C_UM_HZ / np.asarray(lam_um, float)
    return nu ** 3 / np.expm1(H * nu / (K * teff))


def shape(family: str) -> tuple[np.ndarray, np.ndarray]:
    """(λ µm, F_ν arbitrary) on a fine grid covering SPHEREx (0.7-5.1 µm) and W2."""
    if family == "bd900":
        return sonora(900)
    if family == "bd500":
        return sonora(500)
    if family == "bb4000":
        lam = np.linspace(0.5, 6.0, 20000)
        return lam, blackbody(4000.0, lam)
    raise ValueError(family)


def photon_mean(lam: np.ndarray, fnu: np.ndarray) -> float:
    """∫ F_λ R λ dλ (photon-weighted) for a spectrum given as F_ν on lam (µm)."""
    lr, r = w2()
    f = np.interp(lr, lam, fnu)  # F_ν on the response grid
    flam = f / lr ** 2  # F_λ ∝ F_ν / λ² (constants cancel in the ratio)
    return float(np.trapezoid(flam * r * lr, lr))


def scale_to_w2(lam: np.ndarray, fnu: np.ndarray, w2_mag: float) -> float:
    """The factor that makes this F_ν spectrum (in Jy after scaling) have W2 = w2_mag (Vega)."""
    lv, fv = vega()
    ratio = photon_mean(lam, fnu) / photon_mean(lv, fv)
    return 10 ** (-0.4 * w2_mag) / ratio


def band_fnu_jy(lam: np.ndarray, fnu_jy: np.ndarray, cwave_um: float, cband_um: float) -> float:
    """F_ν averaged (uniform in λ) over the pixel's band [CWAVE ± CBAND/2]."""
    a, b = cwave_um - cband_um / 2, cwave_um + cband_um / 2
    grid = np.linspace(a, b, 64)
    return float(np.mean(np.interp(grid, lam, fnu_jy)))


def family_colours() -> dict:
    """For the log (Physics): each family's F_ν at 1.1, 2.2 and 4.6 µm relative to 4.6 µm, each
    averaged over a SPHEREx-like band (λ/40 wide, as the injection does per photo). A single point
    on the model's fine grid can sit in a deep line (bd900 at 2.2 µm: 0.003 at a point, 0.070
    averaged), so points are not used."""
    out = {}
    for fam in ("bd900", "bd500", "bb4000"):
        lam, f = shape(fam)
        ref = band_fnu_jy(lam, f, 4.6, 4.6 / 40)
        out[fam] = {f"{w} um": band_fnu_jy(lam, f, w, w / 40) / ref for w in (1.1, 2.2, 4.6)}
    return out
