"""CatWISE2020 sources for a sky region (IRSA TAP), positioned at an observation epoch.

CatWISE2020 (Marocco et al. 2021) detects infrared sources that Gaia misses: red and brown dwarfs,
dusty stars and galaxies. Positions are `ra_pm`, `dec_pm` at MJD 57170 (2015.405) with apparent
motions `pmra`, `pmdec` in arcsec/yr. Faint sources have noisy motions, and propagating noise over
a decade would move positions by more than it corrects, so motion is applied only where it is
significant (|pm| / sigma > PM_SNR_MIN in either axis); otherwise the 2015.4 position is used.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pyvo

from smo.provenance import atomic_write_bytes

IRSA_TAP = "https://irsa.ipac.caltech.edu/TAP"
_COLS = "source_name, ra_pm, dec_pm, pmra, pmdec, sigpmra, sigpmdec, w1mpro, w2mpro, w1snr, w2snr, nb"
EPOCH_MJD = 57170.0
PM_SNR_MIN = 5.0


def cone(ra: float, dec: float, radius_deg: float, cache: Path) -> pa.Table:
    tag = hashlib.sha256(f"{ra:.6f},{dec:.6f},{radius_deg:.6f}".encode()).hexdigest()[:16]
    path = cache / "catwise" / f"catwise2020_{tag}.parquet"
    if path.exists():
        return pq.read_table(path)
    q = (f"SELECT {_COLS} FROM catwise_2020 "
         f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.8f}, {dec:.8f}, {radius_deg:.8f}))")
    t = pyvo.dal.TAPService(IRSA_TAP).run_async(q, maxrec=2_000_000).to_table()
    cols = {}
    for c in t.colnames:
        col = t[c]
        if hasattr(col, "filled"):
            col = col.filled(np.nan) if np.issubdtype(col.dtype, np.floating) else col.filled(0 if col.dtype.kind in "iu" else "")
        cols[c] = np.asarray(col)
    table = pa.table(cols)
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink)
    atomic_write_bytes(path, sink.getvalue().to_pybytes())
    return table


def propagate(table: pa.Table, mjd: float) -> tuple[np.ndarray, np.ndarray]:
    ra = table["ra_pm"].to_numpy().astype(float)
    dec = table["dec_pm"].to_numpy().astype(float)
    pmra = np.nan_to_num(table["pmra"].to_numpy().astype(float))  # arcsec/yr, includes cos(dec)
    pmdec = np.nan_to_num(table["pmdec"].to_numpy().astype(float))
    with np.errstate(invalid="ignore", divide="ignore"):
        sig = (np.abs(pmra) / table["sigpmra"].to_numpy().astype(float) > PM_SNR_MIN) | \
              (np.abs(pmdec) / table["sigpmdec"].to_numpy().astype(float) > PM_SNR_MIN)
    dt = (mjd - EPOCH_MJD) / 365.25
    dec_new = dec + np.where(sig, pmdec, 0.0) * dt / 3600.0
    ra_new = ra + np.where(sig, pmra, 0.0) * dt / 3600.0 / np.cos(np.deg2rad(dec))
    return ra_new, dec_new
