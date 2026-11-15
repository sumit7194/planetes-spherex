"""SPHEREx calibration products: the per-pixel spectral WCS (CWAVE, CBAND).

The WCS-WAVE table inside each L2 file is an approximation "suitable for visualization"; science
uses these calibration files (Explanatory Supplement sect. 4.3.1). Files are downloaded once from
the public bucket, checksummed, and cached.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
from astropy.io import fits

from smo.data.s3 import BUCKET_URL
from smo.provenance import atomic_write_bytes, sha256_file

SPECTRAL_WCS = {"qr2": "qr2/spectral_wcs/cal-wcs-v4-2025-254/{d}/spectral_wcs_D{d}_spx_cal-wcs-v4-2025-254.fits"}


def spectral_wcs_path(cache: Path, detector: int, release: str = "qr2") -> Path:
    key = SPECTRAL_WCS[release].format(d=detector)
    path = cache / "calib" / key
    if not path.exists():
        with httpx.Client(timeout=600) as c:
            r = c.get(f"{BUCKET_URL}/{key}")
            r.raise_for_status()
            atomic_write_bytes(path, r.content)
    return path


@lru_cache(maxsize=12)
def spectral_wcs(cache: Path, detector: int, release: str = "qr2") -> tuple[np.ndarray, np.ndarray, str]:
    """(CWAVE, CBAND) in microns as 2040 x 2040 arrays in L2 pixel order, and the file's SHA-256."""
    path = spectral_wcs_path(cache, detector, release)
    with fits.open(path, memmap=False) as h:
        cw = np.asarray(h["CWAVE"].data, dtype=np.float64)
        cb = np.asarray(h["CBAND"].data, dtype=np.float64)
    return cw, cb, sha256_file(path)
