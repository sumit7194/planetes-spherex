"""Exposure index built from S3 listings and IMAGE-header range reads.

Used when IRSA's query services are unavailable, and as an independent check on them.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from astropy.wcs import WCS

from smo.data.exposure import read_image_header
from smo.data.s3 import L2Key, list_keys, period_processing_prefix
from smo.provenance import atomic_write_bytes

_FIELDS = ("OBSID", "DETECTOR", "MJD-AVG", "XPOSURE", "SPS_TARGET", "SPS_ELON", "SPS_ELAT",
           "SPS_EPA", "SPS_FLAGS", "PSF_FWHM", "PVERSION", "L2DQAFLG", "FINAST")


def index_period(client: httpx.Client, period: str, cache: Path, detectors=(1,), exposures=(1, 2, 3, 4),
                 workers: int = 16, release: str = "qr2") -> pa.Table:
    out_path = cache / "index" / release / f"{period}_D{''.join(map(str, detectors))}.parquet"
    if out_path.exists():
        return pq.read_table(out_path)
    prefix = period_processing_prefix(client, period, release)
    keys: list[L2Key] = []
    for d in detectors:
        keys += [k for k in list_keys(client, f"{prefix}{d}/") if k.exposure in exposures]

    def one(k: L2Key) -> dict:
        h = read_image_header(client, k)
        w = WCS(h)
        ny, nx = h["NAXIS2"], h["NAXIS1"]
        c = w.pixel_to_world((nx - 1) / 2, (ny - 1) / 2)
        g = c.galactic
        e = c.transform_to("geocentrictrueecliptic")
        row = {f: h.get(f) for f in _FIELDS}
        row.update(key=k.key, size=k.size, ra=float(c.ra.deg), dec=float(c.dec.deg),
                   glon=float(g.l.deg), glat=float(g.b.deg), elon=float(e.lon.deg), elat=float(e.lat.deg),
                   x_sc=h.get("X_SC"), y_sc=h.get("Y_SC"), z_sc=h.get("Z_SC"))
        return row

    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = list(pool.map(one, keys))
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    table = pa.table({k: pa.array([None if (isinstance(v, float) and np.isnan(v)) else v for v in vals])
                      for k, vals in cols.items()})
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink)
    atomic_write_bytes(out_path, sink.getvalue().to_pybytes())
    return table
