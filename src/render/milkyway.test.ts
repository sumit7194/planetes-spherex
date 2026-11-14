import { describe, expect, it } from 'vitest';
import { glowAt, parseGlow } from './milkyway';
import { ang2pixNest, npix } from '../data/healpix';

/** A tiny nside-2 file whose G < 18 counts are high only in the pixel holding `bright`. */
function file(bright: { ra: number; dec: number }): ArrayBuffer {
  const nside = 2;
  const n = npix(nside);
  const buf = new ArrayBuffer(12 + 12 * n);
  const v = new DataView(buf);
  v.setUint32(0, 0x31574d47, true);
  v.setUint32(4, nside, true);
  v.setUint32(8, n, true);
  const hot = ang2pixNest(nside, bright);
  for (let p = 0; p < n; p++) v.setUint32(12 + 4 * n + 4 * p, p === hot ? 100_000 : 100, true);
  return buf;
}

describe('the Milky Way glow', () => {
  it('is bright where the counts are high and dark elsewhere', () => {
    const at = { ra: 266, dec: -29 };
    const map = parseGlow(file(at), 72);
    expect(glowAt(map, at)).toBeCloseTo(1, 3);
    expect(glowAt(map, { ra: 90, dec: 60 })).toBe(0);
  });

  it('refuses a file of the wrong size', () => {
    expect(() => parseGlow(file({ ra: 0, dec: 0 }).slice(0, 100))).toThrow();
  });
});
