"""Cutouts of SPHEREx L2 exposures: fetch by range reads, cache atomically, load.

A cutout holds IMAGE, VARIANCE, ZODI and FLAGS for a box of rows/columns, the ePSF planes
needed to model every pixel in it, the full IMAGE header (for WCS and metadata) and the FLAGS
and PSF headers. The 70 MB source file is never stored.
"""

from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from smo.data.fitsrange import RangeReader, read_planes, read_rows, walk_hdus
from smo.data.s3 import L2Key
from smo.provenance import atomic_write_bytes, sha256_bytes

EXPECTED_HDUS = (None, "IMAGE", "FLAGS", "VARIANCE", "ZODI", "PSF", "WCS-WAVE")


def psf_version_ok(version: str) -> bool:
    """Files must carry the corrected PSF plane ordering: '+psffix1' tag or pipeline >= 6.5.6."""
    if "psffix" in version:
        return True
    m = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", version)
    if not m:
        return False
    return tuple(int(g or 0) for g in m.groups()) >= (6, 5, 6)


@dataclass
class Cutout:
    key: str
    x0: int  # column of cutout pixel [0, 0] in the full 0-based detector frame
    y0: int  # row of cutout pixel [0, 0]
    image: np.ndarray  # MJy/sr, float32 as stored
    variance: np.ndarray  # (MJy/sr)^2
    zodi: np.ndarray  # MJy/sr
    flags: np.ndarray  # uint32
    image_header: fits.Header
    flags_header: fits.Header
    psf_header: fits.Header
    psf_planes: dict[int, np.ndarray]  # plane index (0-based) -> oversampled ePSF (ny, nx)
    meta: dict = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return self.image.shape

    def wcs(self) -> WCS:
        """WCS of the cutout (pixel [0, 0] = cutout corner), SIP distortions included."""
        full = WCS(self.image_header)
        return full[self.y0:self.y0 + self.shape[0], self.x0:self.x0 + self.shape[1]]

    @property
    def mjd_mid(self) -> float:
        return float(self.image_header["MJD-AVG"])

    @property
    def detector(self) -> int:
        return int(self.image_header["DETECTOR"])


def _cache_path(cache: Path, key: L2Key, x0: int, y0: int, nx: int, ny: int) -> Path:
    return cache / "cutouts" / key.period / f"{key.obsid}_D{key.detector}_x{x0}_y{y0}_{nx}x{ny}.npz"


ZONE_MARGIN_PX = 8  # sources up to the stamp half-width (5 px) outside the cutout are modelled too


def _zones_needed(psf_header: fits.Header, x0: int, x1: int, y0: int, y1: int,
                  margin: int = ZONE_MARGIN_PX) -> list[int]:
    """Planes needed for bilinear zone interpolation anywhere in [x0,x1) x [y0,y1) expanded by
    `margin` pixels, in the zone-centre convention of `EPSFGrid` (pixel centre i at i + 0.5)."""
    x0, x1, y0, y1 = x0 - margin + 0.5, x1 + margin + 0.5, y0 - margin + 0.5, y1 + margin + 0.5
    n = psf_header["NAXIS3"]
    xc = np.array([psf_header[f"XCTR_{k + 1}"] for k in range(n)])
    yc = np.array([psf_header[f"YCTR_{k + 1}"] for k in range(n)])
    ux, uy = np.unique(np.round(xc, 6)), np.unique(np.round(yc, 6))

    def bracket(u: np.ndarray, a: float, b: float) -> tuple[float, float]:
        lo = u[u <= a].max() if (u <= a).any() else u.min()
        hi = u[u >= b].min() if (u >= b).any() else u.max()
        return lo, hi

    xlo, xhi = bracket(ux, x0, x1 - 1)
    ylo, yhi = bracket(uy, y0, y1 - 1)
    sel = (np.round(xc, 6) >= xlo) & (np.round(xc, 6) <= xhi) & (np.round(yc, 6) >= ylo) & (np.round(yc, 6) <= yhi)
    return [int(k) for k in np.nonzero(sel)[0]]


def fetch_cutout(client: httpx.Client, key: L2Key, cx: float, cy: float, half: int,
                 cache: Path) -> tuple[Cutout, dict]:
    """Fetch (or load from cache) a square cutout centred on full-frame pixel (cx, cy).

    The box is clipped to the detector. Returns the cutout and a provenance record.
    """
    rr = RangeReader(client, key.url)
    return _fetch(rr, walk_hdus(rr, EXPECTED_HDUS), key, cx, cy, half, cache)


def fetch_cutout_sky(client: httpx.Client, key: L2Key, ra: float, dec: float, half: int,
                     cache: Path) -> tuple[Cutout, dict]:
    """As fetch_cutout, centred on a sky position (deg), located through the file's own WCS."""
    from astropy.coordinates import SkyCoord
    import astropy.units as u

    rr = RangeReader(client, key.url)
    hdus = walk_hdus(rr, EXPECTED_HDUS)
    cx, cy = WCS(hdus[1].header).world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    return _fetch(rr, hdus, key, float(cx), float(cy), half, cache)


def _fetch(rr: RangeReader, hdus, key: L2Key, cx: float, cy: float, half: int,
           cache: Path) -> tuple[Cutout, dict]:
    version = hdus[0].header.get("VERSION", "")
    if not psf_version_ok(version):
        raise ValueError(f"{key.key}: pipeline version {version!r} lacks the PSF plane-order fix")
    img_h = hdus[1].header
    ny_full, nx_full = hdus[1].shape
    x0 = max(0, int(round(cx)) - half)
    x1 = min(nx_full, int(round(cx)) + half + 1)
    y0 = max(0, int(round(cy)) - half)
    y1 = min(ny_full, int(round(cy)) + half + 1)
    path = _cache_path(cache, key, x0, y0, x1 - x0, y1 - y0)
    if path.exists():
        return load_cutout(path), {"cache_hit": True, "path": str(path)}

    arrays = {}
    for name, hdu in (("image", hdus[1]), ("flags", hdus[2]), ("variance", hdus[3]), ("zodi", hdus[4])):
        arrays[name] = read_rows(rr, hdu, y0, y1)[:, x0:x1]
    psf_h = hdus[5].header
    planes = read_planes(rr, hdus[5], _zones_needed(psf_h, x0, x1, y0, y1))

    meta = {
        "key": key.key, "x0": x0, "y0": y0, "version": version,
        "bytes_read": rr.bytes_read, "requests": rr.requests,
    }
    buf = io.BytesIO()
    np.savez_compressed(
        buf,
        image=arrays["image"], variance=arrays["variance"], zodi=arrays["zodi"],
        flags=arrays["flags"].astype(np.uint32),
        psf_index=np.array(sorted(planes), dtype=np.int32),
        psf_cube=np.stack([planes[k] for k in sorted(planes)]),
        image_header=np.array(img_h.tostring()), flags_header=np.array(hdus[2].header.tostring()),
        psf_header=np.array(psf_h.tostring()), meta=np.array(json.dumps(meta)),
    )
    data = buf.getvalue()
    atomic_write_bytes(path, data)
    return load_cutout(path), {"cache_hit": False, "path": str(path), "sha256": sha256_bytes(data), **meta}


def load_cutout(path: Path) -> Cutout:
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        idx = [int(i) for i in z["psf_index"]]
        cube = z["psf_cube"]
        return Cutout(
            key=meta["key"], x0=int(meta["x0"]), y0=int(meta["y0"]),
            image=z["image"], variance=z["variance"], zodi=z["zodi"], flags=z["flags"],
            image_header=fits.Header.fromstring(str(z["image_header"])),
            flags_header=fits.Header.fromstring(str(z["flags_header"])),
            psf_header=fits.Header.fromstring(str(z["psf_header"])),
            psf_planes={k: cube[j] for j, k in enumerate(idx)}, meta=meta,
        )


def read_image_header(client: httpx.Client, key: L2Key) -> fits.Header:
    """Primary + IMAGE header only (two small range reads), for indexing."""
    rr = RangeReader(client, key.url)
    from smo.data.fitsrange import _read_header

    prim, plen = _read_header(rr, 0)
    img, _ = _read_header(rr, plen)
    img["PVERSION"] = prim.get("VERSION", "")
    return img
