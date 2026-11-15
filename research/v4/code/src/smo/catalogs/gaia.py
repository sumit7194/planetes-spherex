"""Gaia DR3 sources for a sky region, with positions propagated to an observation epoch."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pyvo

from smo.provenance import atomic_write_bytes

GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap"
_COLS = "source_id, ra, dec, pmra, pmdec, parallax, ref_epoch, phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag"


def cone(ra: float, dec: float, radius_deg: float, cache: Path) -> pa.Table:
    tag = hashlib.sha256(f"{ra:.6f},{dec:.6f},{radius_deg:.6f}".encode()).hexdigest()[:16]
    path = cache / "gaia" / f"dr3_{tag}.parquet"
    if path.exists():
        return pq.read_table(path)
    q = (f"SELECT {_COLS} FROM gaiadr3.gaia_source "
         f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.8f}, {dec:.8f}, {radius_deg:.8f}))")
    res = pyvo.dal.TAPService(GAIA_TAP).run_async(q, maxrec=2_000_000)
    t = res.to_table()
    cols = {}
    for c in t.colnames:
        col = t[c]
        if hasattr(col, "filled"):
            if np.issubdtype(col.dtype, np.floating):
                col = col.filled(np.nan)
            elif np.any(col.mask):
                raise ValueError(f"unexpected masked values in integer column {c}")
            else:
                col = col.filled(0)
        cols[c] = np.asarray(col)
    table = pa.table(cols)
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink)
    atomic_write_bytes(path, sink.getvalue().to_pybytes())
    return table


def propagate(table: pa.Table, mjd: float) -> tuple[np.ndarray, np.ndarray]:
    """RA, Dec (deg) at the given MJD, by linear proper motion from each source's reference epoch.

    Linear propagation is accurate to far below a SPHEREx pixel over a decade. Annual parallax
    (< 1 arcsec, 0.15 px, for the nearest stars) is not applied.
    """
    ra = table["ra"].to_numpy()
    dec = table["dec"].to_numpy()
    pmra = np.nan_to_num(table["pmra"].to_numpy())  # mas/yr, includes cos(dec)
    pmdec = np.nan_to_num(table["pmdec"].to_numpy())
    epoch = table["ref_epoch"].to_numpy()
    dt = (2000.0 + (mjd - 51544.5) / 365.25) - epoch
    dec_new = dec + pmdec * dt / 3.6e6
    ra_new = ra + pmra * dt / 3.6e6 / np.cos(np.deg2rad(dec))
    return ra_new, dec_new
