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
      expect(Math.abs(p.x - expected.pixels0[i]![0])).toBeLessThan(0.0001);
      expect(Math.abs(p.y - expected.pixels0[i]![1])).toBeLessThan(0.0001);
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

describe('the cloud helper frame', () => {
  it('decodes a PLF1 frame into a LiveFrame', async () => {
    const { decodeHelperFrame } = await import('./dr1qr3');
    let json = JSON.stringify({
      obsId: 'X',
      size: 2,
      lambdaUm: 1.5,
      bandwidthUm: 0.02,
      mjd: 60900.5,
    });
    while (json.length % 4) json += ' ';
    const j = new TextEncoder().encode(json);
    const buf = new ArrayBuffer(8 + j.length + 4 * 4 + 4);
    const u8 = new Uint8Array(buf);
    u8.set([0x50, 0x4c, 0x46, 0x31], 0);
    new DataView(buf).setUint32(4, j.length, true);
    u8.set(j, 8);
    new Float32Array(buf, 8 + j.length, 4).set([1, 2, NaN, 4]);
    u8.set([0, 1, 2, 3], 8 + j.length + 16);
    const photo = {
      key: 'k',
      obsId: 'X',
      det: 1,
      mjd: 0,
      release: 'DR1',
      deep: false,
      centre: { ra: 0, dec: 0 },
      paDeg: 0,
      halfDeg: 0,
    } as const;
    const f = decodeHelperFrame(buf, photo);
    expect(f.tile.size).toBe(2);
    expect(Array.from(f.tile.pixels.slice(0, 2))).toEqual([1, 2]);
    expect(Number.isNaN(f.tile.pixels[2])).toBe(true);
    expect(Array.from(f.tile.flags)).toEqual([0, 1, 2, 3]);
    expect(f.lambdaUm).toBe(1.5);
    expect(f.mjd).toBe(60900.5);
    expect(() => decodeHelperFrame(buf.slice(0, buf.byteLength - 1), photo)).toThrow();
    expect(() => decodeHelperFrame(buf, { ...photo, obsId: 'Y' })).toThrow();
    expect(() => decodeHelperFrame(buf, photo, 4)).toThrow();
    expect(decodeHelperFrame(buf, photo, 2).tile.size).toBe(2);
  });
});

describe('the live spectrum blend rule', () => {
  it('flags a neighbour inside the aperture within 3.3 mag of the target, like the pipeline', async () => {
    const { blendNeighbours } = await import('./dr1qr3');
    const at = { ra: 10, dec: 20 };
    const star = (id: string, dEastArcsec: number, dNorthArcsec: number, g: number | null) => ({
      id,
      ra: at.ra + dEastArcsec / 3600 / Math.cos((20 * Math.PI) / 180),
      dec: at.dec + dNorthArcsec / 3600,
      pmra: 0,
      pmdec: 0,
      g,
    });
    const stars = [
      star('target', 0.3, 0, 15),
      star('close-bright', 8, 0, 17), // inside, within 3.3 mag: counts
      star('close-faint', 0, -9, 19), // inside, 4 mag fainter: ignored
      star('outside', 20, 0, 12), // outside the 15.4" aperture: ignored
    ];
    const n = blendNeighbours(at, stars, 15.375);
    expect(n).toHaveLength(1);
    expect(n[0]).toContain('close-bright');
    // Target not in Gaia: anything brighter than G 19.5 inside counts.
    const n2 = blendNeighbours(at, stars.slice(1), 15.375);
    expect(n2.map((s) => s.split(' ')[2])).toEqual(['close-bright', 'close-faint']);
  });
});
