"""Pixel flags, decoded from the FLAGS header's own MP_* keywords (never hard-coded bit numbers)."""

from __future__ import annotations

import numpy as np
from astropy.io import fits

# Pixels that must not constrain the scene fit: detector defects, saturation, cosmic rays and
# known artifacts. Names absent from an older pipeline version are simply not applied, and the
# applied set is recorded with every fit.
FIT_REJECT = (
    "TRANSIENT", "OVERFLOW", "SUR_ERROR", "PHANTOM", "REFERENCE", "NONFUNC", "DICHROIC",
    "MISSING_DATA", "HOT", "COLD", "PHANMISS", "NONLINEAR", "PERSIST",
    # R7 / newer pipeline additions (present only in newer files):
    "CROSSTALK", "GHOST", "GHOST_FPA", "GHOST_EXT", "STREAK", "BLOOM", "SNOWBALL", "HALO",
    "SATELLITE_HALO",
)
# Deliberately NOT rejected: OUTLIER (a real asteroid can be flagged as an outlier), SOURCE (a
# map of catalogued sources, not a defect) and FULLSAMPLE (informational).


def bit_map(flags_header: fits.Header) -> dict[str, int]:
    return {k[3:]: int(v) for k, v in flags_header.items() if k.startswith("MP_")}


def mask_for(flags: np.ndarray, bits: dict[str, int], names: tuple[str, ...]) -> tuple[np.ndarray, list[str]]:
    """Boolean mask of pixels with any of the named flags set, and the names actually applied."""
    applied = [n for n in names if n in bits]
    word = np.uint32(0)
    for n in applied:
        word |= np.uint32(1) << np.uint32(bits[n])
    return (flags.astype(np.uint32) & word) != 0, applied
