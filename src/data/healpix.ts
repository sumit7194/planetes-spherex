/**
 * HEALPix, NESTED scheme: the sky tiled into equal-area pixels. Only what the viewer needs:
 * a pixel's centre and its four corners, for drawing coverage maps. Follows the reference
 * implementation (Górski et al. 2005; Healpix_Base::xyf2loc and boundaries).
 */

import type { SkyPosition } from './coords';

const RAD = Math.PI / 180;
/** Row index of each base face's northern corner, and its longitude offset, in units of π/4. */
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];

export function npix(nside: number): number {
  return 12 * nside * nside;
}

/** Splits a NESTED pixel number into its base face and its (x, y) within the face. */
function nest2xyf(nside: number, pix: number): { face: number; ix: number; iy: number } {
  const order = Math.log2(nside);
  const face = pix >>> (2 * order);
  let bits = pix & (nside * nside - 1);
  let ix = 0;
  let iy = 0;
  for (let b = 0; bits !== 0; b++) {
    ix |= (bits & 1) << b;
    bits >>>= 1;
    iy |= (bits & 1) << b;
    bits >>>= 1;
  }
  return { face, ix, iy };
}

/** A position for fractional face coordinates x, y in [0, 1]. */
function xyf2ang(x: number, y: number, face: number): SkyPosition {
  const jr = (JRLL[face] ?? 2) - x - y;
  let nr: number;
  let z: number;
  if (jr < 1) {
    nr = jr;
    z = 1 - (nr * nr) / 3;
  } else if (jr > 3) {
    nr = 4 - jr;
    z = (nr * nr) / 3 - 1;
  } else {
    nr = 1;
    z = ((2 - jr) * 2) / 3;
  }
  let t = (JPLL[face] ?? 0) * nr + x - y;
  if (t < 0) t += 8;
  if (t >= 8) t -= 8;
  const phi = nr < 1e-15 ? 0 : ((Math.PI / 4) * t) / nr;
  return { ra: phi / RAD, dec: Math.asin(Math.max(-1, Math.min(1, z))) / RAD };
}

/** The NESTED pixel holding a sky position (Healpix_Base::loc2pix, NESTED branch). */
export function ang2pixNest(nside: number, p: SkyPosition): number {
  const z = Math.sin(p.dec * RAD);
  const za = Math.abs(z);
  let tt = ((p.ra % 360) + 360) % 360;
  tt = (tt / 90) % 4; // in [0, 4)
  let face: number;
  let ix: number;
  let iy: number;
  if (za <= 2 / 3) {
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  // Interleave: x in the even bits, y in the odd bits, as nest2xyf reads them.
  let bits = 0;
  for (let b = 0; 1 << b < nside; b++) {
    bits += (((ix >> b) & 1) << (2 * b)) + (((iy >> b) & 1) << (2 * b + 1));
  }
  return face * nside * nside + bits;
}

/** Centre of a NESTED pixel. */
export function pixelCentre(nside: number, pix: number): SkyPosition {
  const { face, ix, iy } = nest2xyf(nside, pix);
  return xyf2ang((ix + 0.5) / nside, (iy + 0.5) / nside, face);
}

/** The four corners of a NESTED pixel, in order: north, west, south, east. */
export function pixelCorners(
  nside: number,
  pix: number,
): [SkyPosition, SkyPosition, SkyPosition, SkyPosition] {
  const { face, ix, iy } = nest2xyf(nside, pix);
  const xc = (ix + 0.5) / nside;
  const yc = (iy + 0.5) / nside;
  const d = 0.5 / nside;
  return [
    xyf2ang(xc + d, yc + d, face),
    xyf2ang(xc - d, yc + d, face),
    xyf2ang(xc - d, yc - d, face),
    xyf2ang(xc + d, yc - d, face),
  ];
}
