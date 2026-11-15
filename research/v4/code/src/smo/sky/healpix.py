"""HEALPix NESTED pixelisation (Gorski et al. 2005, ApJ 622, 759), vectorised in numpy.

Written here rather than added as a dependency (healpy / astropy-healpix): no cp315 wheels, and SECURITY.md keeps
dependencies few. The algorithms follow the reference C implementation (ang2pix_nest / pix2ang_nest); tests check
the base-pixel centres against the published values, round trips, the nested hierarchy and equal areas.
Angles: theta = colatitude (0 at the north pole), phi = longitude, radians. nside must be a power of two.
"""

from __future__ import annotations

import numpy as np

_JRLL = np.array([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4])
_JPLL = np.array([1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7])


def _spread(v: np.ndarray) -> np.ndarray:
    """Interleave the bits of v with zeros (bit i -> bit 2i), for v < 2**16."""
    v = v.astype(np.int64)
    v = (v | (v << 8)) & 0x00FF00FF
    v = (v | (v << 4)) & 0x0F0F0F0F
    v = (v | (v << 2)) & 0x33333333
    return (v | (v << 1)) & 0x55555555


def _compress(v: np.ndarray) -> np.ndarray:
    """Inverse of _spread: keep the even bits."""
    v = v.astype(np.int64) & 0x55555555
    v = (v | (v >> 1)) & 0x33333333
    v = (v | (v >> 2)) & 0x0F0F0F0F
    v = (v | (v >> 4)) & 0x00FF00FF
    return (v | (v >> 8)) & 0x0000FFFF


def _order(nside: int) -> int:
    order = int(nside).bit_length() - 1
    if nside < 1 or 1 << order != nside or nside > 1 << 15:
        raise ValueError(f"nside must be a power of two up to 2**15, not {nside}")
    return order


def ang2pix_nest(nside: int, theta, phi) -> np.ndarray:
    order = _order(nside)
    theta, phi = np.broadcast_arrays(np.asarray(theta, float), np.asarray(phi, float))
    z = np.cos(theta)
    za = np.abs(z)
    tt = np.mod(phi, 2 * np.pi) / (np.pi / 2)  # in [0, 4)
    face = np.zeros(z.shape, np.int64)
    ix = np.zeros(z.shape, np.int64)
    iy = np.zeros(z.shape, np.int64)

    eq = za <= 2.0 / 3.0
    t1 = nside * (0.5 + tt[eq])
    t2 = nside * z[eq] * 0.75
    jp = (t1 - t2).astype(np.int64)
    jm = (t1 + t2).astype(np.int64)
    ifp, ifm = jp >> order, jm >> order
    face[eq] = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix[eq] = jm & (nside - 1)
    iy[eq] = nside - (jp & (nside - 1)) - 1

    po = ~eq
    ntt = np.minimum(3, tt[po].astype(np.int64))
    tp = tt[po] - ntt
    tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.minimum((tp * tmp).astype(np.int64), nside - 1)
    jm = np.minimum(((1 - tp) * tmp).astype(np.int64), nside - 1)
    north = z[po] >= 0
    face[po] = np.where(north, ntt, ntt + 8)
    ix[po] = np.where(north, nside - jm - 1, jp)
    iy[po] = np.where(north, nside - jp - 1, jm)
    return (face << (2 * order)) + _spread(ix) + (_spread(iy) << 1)


def pix2ang_nest(nside: int, pix) -> tuple[np.ndarray, np.ndarray]:
    """Pixel centres (theta, phi)."""
    order = _order(nside)
    pix = np.asarray(pix, np.int64)
    if np.any((pix < 0) | (pix >= 12 * nside * nside)):
        raise ValueError("pixel index out of range")
    face = pix >> (2 * order)
    ipf = pix & (nside * nside - 1)
    ix, iy = _compress(ipf), _compress(ipf >> 1)
    jr = _JRLL[face] * nside - ix - iy - 1
    nr = np.where(jr < nside, jr, np.where(jr > 3 * nside, 4 * nside - jr, nside))
    z = np.where(jr < nside, 1 - nr * nr / (3.0 * nside * nside),
                 np.where(jr > 3 * nside, nr * nr / (3.0 * nside * nside) - 1, (2 * nside - jr) * 2.0 / (3 * nside)))
    kshift = np.where((jr >= nside) & (jr <= 3 * nside), (jr - nside) & 1, 0)
    jp = (_JPLL[face] * nr + ix - iy + 1 + kshift) // 2
    jp = np.where(jp > 4 * nside, jp - 4 * nside, jp)
    jp = np.where(jp < 1, jp + 4 * nside, jp)
    phi = (jp - (kshift + 1) * 0.5) * (np.pi / 2) / nr
    return np.arccos(np.clip(z, -1, 1)), phi


def radec2pix_nest(nside: int, ra_deg, dec_deg) -> np.ndarray:
    return ang2pix_nest(nside, np.radians(90.0 - np.asarray(dec_deg, float)), np.radians(np.asarray(ra_deg, float)))


def pix2radec_nest(nside: int, pix) -> tuple[np.ndarray, np.ndarray]:
    theta, phi = pix2ang_nest(nside, pix)
    return np.degrees(phi), 90.0 - np.degrees(theta)
