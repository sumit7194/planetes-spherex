import { describe, expect, it } from 'vitest';
import {
  colourPanels,
  colourRatio,
  pixelSepArcsec,
  skyToPixel,
  type ColourShiftCase,
} from './colourShift';
import type { Grid } from './spotCheck';

const g = { size: 32, scaleArcsec: 6, centre: { ra: 100, dec: 0 } };

/** A flat image with Gaussian sources at (x, y, amplitude). */
function image(sources: [number, number, number][]): Grid {
  return {
    w: 32,
    h: 32,
    at: (x, y) =>
      x < 0 || y < 0 || x >= 32 || y >= 32
        ? NaN
        : 1 +
          sources.reduce(
            (s, [sx, sy, a]) => s + a * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / 2),
            0,
          ),
  };
}

describe('sky to tile pixels', () => {
  it('puts the grid centre at the middle, east to the left, north up', () => {
    expect(skyToPixel(g.centre, g)).toEqual({ x: 15.5, y: 15.5 });
    const east = skyToPixel({ ra: 100 + 6 / 3600, dec: 0 }, g);
    expect(east.x).toBeCloseTo(14.5, 6);
    const north = skyToPixel({ ra: 100, dec: 6 / 3600 }, g);
    expect(north.y).toBeCloseTo(16.5, 6);
  });
  it('measures distances in arcsec', () =>
    expect(pixelSepArcsec({ x: 0, y: 0 }, { x: 3, y: 4 }, g)).toBe(30));
});

describe('the two panels', () => {
  // The neighbour sits at the centre; the target 1.5 px west (larger x). A short colour shows
  // only the neighbour; a long one is dominated by the target.
  const neighbourAt = { ra: 100, dec: 0 };
  const c: ColourShiftCase = {
    neighbour: { id: '1', ra: 100, dec: 0, pmra: 0, pmdec: 0, g: 16, bpRp: 0.7 },
    detectors: [2, 6],
  };
  const target = { at: { ra: 100 - 9 / 3600, dec: 0 }, pmRa: 0, pmDec: 0, epoch: 2016 };
  const short = image([[15.5, 15.5, 100]]);
  const long = image([
    [15.5, 15.5, 20],
    [17, 15.5, 100],
  ]);
  const both = image([
    [15.5, 15.5, 100],
    [17, 15.5, 30],
  ]);
  const [a, b] = colourPanels(c, [short, long], both, g, target, 2016);
  it('finds the light on the neighbour in the short colour', () => {
    expect(a.fromNeighbour).toBeLessThan(2);
    expect(skyToPixel(neighbourAt, g).x).toBeCloseTo(15.5, 6);
  });
  it('finds it moved towards the target in the long colour', () => {
    expect(b.fromNeighbour).toBeGreaterThan(a.fromNeighbour + 3);
    expect(b.fromTarget).toBeLessThan(a.fromTarget);
  });
  it('keeps the detectors in order', () => expect([a.detector, b.detector]).toEqual([2, 6]));
});

describe('the colour ratio (N2)', () => {
  const tile = (vals: number[], flags: number[] = []) => ({
    size: 4,
    pixels: Float32Array.from(vals),
    flags: Uint8Array.from(flags.length ? flags : vals.map(() => 0)),
  });
  // Mostly background (a little scatter), one bright pixel in both colours at index 5.
  const bg = [0, 1, -1, 0, 1, 0, -1, 0, 1, -1, 0, 1, 0, -1, 1, 0];
  it('gives long ÷ short where both are bright, and nothing where either is faint', () => {
    const s = tile(bg.map((v, i) => (i === 5 ? 50 : v)));
    const l = tile(bg.map((v, i) => (i === 5 ? 100 : i === 6 ? 80 : v)));
    const r = colourRatio(s, l);
    expect(r.ratio[5]).toBeCloseTo(2, 6);
    expect(Number.isNaN(r.ratio[6] ?? 0)).toBe(true); // bright only in the long colour: masked
    expect(Number.isNaN(r.ratio[0] ?? 0)).toBe(true);
  });
  it('masks saturated or rejected pixels in either colour', () => {
    const s = tile(
      bg.map((v, i) => (i === 5 ? 50 : v)),
      bg.map((_, i) => (i === 5 ? 1 : 0)),
    );
    const l = tile(bg.map((v, i) => (i === 5 ? 100 : v)));
    expect(Number.isNaN(colourRatio(s, l).ratio[5] ?? 0)).toBe(true);
  });
});
