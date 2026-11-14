/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures have known shapes */
import { describe, expect, it } from 'vitest';
import {
  footprintHolds,
  parseHeader,
  riceDecode32,
  seasonsOf,
  Wcs,
  type LivePhoto,
} from './dr1qr3';
import headerText from './fixtures/dr1_image_header.txt?raw';
import expectedJson from './fixtures/dr1_wcs_expected.json';
import riceJson from './fixtures/dr1_flags_rice.json';

describe('Wcs (TAN-SIP with the reverse polynomial)', () => {
  // A real DR1 IMAGE header; expected pixels from astropy.wcs (world_to_pixel, 0-based).
  const header = parseHeader(new TextEncoder().encode(headerText));
  const expected = expectedJson as {
    points: [number, number][];
    pixels0: [number, number][];
  };
  it('parses the header', () => {
    expect(header).not.toBeNull();
    expect(header!.header.get('CTYPE1')).toBe('RA---TAN-SIP');
  });
  it('matches astropy to within 0.01 px across the detector', () => {
    const w = new Wcs(header!.header);
    expected.points.forEach(([ra, dec], i) => {
      const p = w.toPixel(ra, dec)!;
      expect(Math.abs(p.x - expected.pixels0[i]![0])).toBeLessThan(0.01);
      expect(Math.abs(p.y - expected.pixels0[i]![1])).toBeLessThan(0.01);
    });
  });
});

describe('riceDecode32', () => {
  // Three FLAGS rows of a real DR1 file, compressed bytes and astropy's decoding.
  const fx = riceJson as {
    nx: number;
    rows: { compressed: string; decoded_nonzero: Record<string, number>; sum: number }[];
  };
  it('decodes exactly as astropy does', () => {
    for (const row of fx.rows) {
      const bytes = Uint8Array.from(atob(row.compressed), (ch) => ch.charCodeAt(0));
      const out = riceDecode32(bytes, fx.nx);
      let sum = 0;
      for (let i = 0; i < out.length; i++) {
        sum += out[i]!;
        expect(out[i]).toBe(row.decoded_nonzero[String(i)] ?? 0);
      }
      expect(sum).toBe(row.sum);
    }
  });
});

describe('index helpers', () => {
  const photo = (ra: number, dec: number, pa: number): LivePhoto => ({
    key: '',
    obsId: '',
    det: 1,
    mjd: 0,
    release: 'DR1',
    deep: false,
    centre: { ra, dec },
    paDeg: pa,
    halfDeg: 2.47,
  });
  it('a footprint holds its centre and not a point 3 degrees away', () => {
    expect(footprintHolds(photo(100, 10, 30), { ra: 100, dec: 10 })).toBe(true);
    expect(footprintHolds(photo(100, 10, 30), { ra: 100, dec: 13 })).toBe(false);
  });
  it('splits passes at gaps over 60 days', () => {
    expect(seasonsOf([{ mjd: 10 }, { mjd: 300 }, { mjd: 20 }, { mjd: 500 }])).toEqual([0, 1, 0, 2]);
  });
  it('cuts a deep field (no gaps) into quarter-year steps', () => {
    const photos = Array.from({ length: 50 }, (_, i) => ({ mjd: 60800 + i * 10 })); // 490 days, no gap
    const s = seasonsOf(photos);
    expect(new Set(s).size).toBeGreaterThanOrEqual(5);
    expect(s).toEqual([...s].sort((a, b) => a - b));
  });
});
