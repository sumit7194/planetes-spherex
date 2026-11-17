"""Cutouts for smo.inject from the cloud helper (prereg/slowmover/PLAN.md §8, 15 Nov).

The helper's /v1/native?extra=1 box (IMAGE, FLAGS, VARIANCE, ZODI, headers) and /v1/psf (the
photo's EPSF extension exactly as stored) are what smo_identity.py checked bit-identical against
Physics' own reader on 14 Nov. Here they become an smo Cutout, so smo.inject.render.inject can draw
fakes into the photo exactly as Physics' pipeline does. Then the normal path (resample, stack,
search) runs unchanged on the injected image.
"""
from __future__ import annotations

import asyncio
import hashlib
import sys

import aiohttp
import numpy as np
from astropy.io import fits

import helper_client as hc

# Physics' QR3/DR1 tree: the one smo_identity.py checked bit-identical (it has the DR1/QR3 EPSF
# table reader, epsf_grid with QR3_PSF_FLIP, and smo.inject).
SMO = "/Users/sumit/Github/SphereXVision/runs/qr3/wt/src"
sys.path.insert(0, SMO)
from smo.data.exposure import Cutout  # noqa: E402
from smo.data.qr3 import QR3_PSF_FLIP, epsf_grid  # noqa: E402

_PSF: dict[str, tuple[fits.Header, dict[int, np.ndarray], str]] = {}


def psf_from_bytes(buf: bytes) -> tuple[fits.Header, dict[int, np.ndarray]]:
    """The EPSF extension (a binary table, header + data as stored) as Physics' reader makes it:
    smo.data.qr3.epsf_grid (QR2-shaped header, {plane: stamp}, flipped and padded)."""
    pad = buf + b"\0" * ((-len(buf)) % 2880)
    table = fits.BinTableHDU.fromstring(pad)
    return epsf_grid(table, QR3_PSF_FLIP)


def psf_complete(buf: bytes) -> bool:
    """True when buf holds the whole binary-table extension its own header declares."""
    end = buf.find(b"END" + b" " * 77)
    if end < 0 or end % 80:
        return False
    head = fits.Header.fromstring(buf[:end + 80].decode("ascii", "replace"))
    hlen = (end + 80 + 2879) // 2880 * 2880
    need = int(head["NAXIS1"]) * int(head["NAXIS2"]) + int(head.get("PCOUNT", 0))
    return len(buf) >= hlen + need


async def psf_for(s: aiohttp.ClientSession, e: dict) -> tuple[fits.Header, dict[int, np.ndarray]]:
    """The ePSF for this photo, fetched once per header hash (one per detector and pipeline
    version); the photo's own psf_sha256 must match, or this stops."""
    want = e["psf_sha256"]
    if want not in _PSF:
        # A download cut short on a slow line once gave a PSF with no planes (Y-36, 17 Nov 00:48,
        # StopIteration in smo.scene.psf). So the bytes must be the whole extension the header
        # declares and give planes; otherwise try again, and after 3 tries stop the field as a
        # read error (RuntimeError: the runner retries it). Transport check only.
        for attempt in range(3):
            try:
                p = await hc.psf(s, e["url"])
            except (aiohttp.ClientError, asyncio.TimeoutError):
                await asyncio.sleep(2 * (attempt + 1))
                continue
            if p["header_sha256"] != want:
                raise RuntimeError(f"{e.get('obs_id')}: ePSF header hash differs from the photo's")
            if psf_complete(p["hdu_bytes"]):
                hdr, planes = psf_from_bytes(p["hdu_bytes"])
                if planes:
                    break
            await asyncio.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError(f"{e.get('obs_id')}: ePSF download incomplete after 3 tries")
        _PSF[want] = (hdr, planes, p["version"])
    hdr, planes, _ = _PSF[want]
    return hdr, planes


def cutout_from(e: dict, psf_hdr: fits.Header, planes: dict[int, np.ndarray]) -> Cutout:
    """An smo Cutout from a helper box with extra=1."""
    return Cutout(
        key=hc.s3_key(e["url"]), x0=int(e["x0"]), y0=int(e["y0"]),
        image=np.asarray(e["img"], np.float32), variance=np.asarray(e["variance"], np.float32),
        zodi=np.asarray(e["zodi"], np.float32), flags=np.asarray(e["fl"], np.uint32),
        image_header=fits.Header.fromstring(e["wcs_hdr"]), flags_header=fits.Header.fromstring(e["flags_hdr"]),
        psf_header=psf_hdr, psf_planes=planes,
        meta={"version": fits.Header.fromstring(e["primary_hdr"]).get("VERSION", "")},
    )


def sha(e: dict) -> str:
    return hashlib.sha256(np.asarray(e["img"], np.float32).tobytes()).hexdigest()[:16]
