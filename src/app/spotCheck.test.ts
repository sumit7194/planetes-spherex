import { describe, expect, it } from 'vitest';
import {
  apertureSN,
  majorityFlags,
  ARTEFACT_FLAGS,
  flagNamesNear,
  INFO_FLAGS,
  MATCH_ARCSEC,
  recentre,
  verdict,
  type Grid,
  type SpotFacts,
} from './spotCheck';

/** A 32×32 image: flat background with small noise, and a star at (sx, sy). */
function image(sx: number, sy: number, amp = 50): Grid {
  const w = 32;
  const px = new Float32Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const noise = ((x * 7 + y * 13) % 5) - 2; // a fixed, small scatter
      px[y * w + x] = 10 + noise + amp * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / 2);
    }
  return {
    w,
    h: w,
    at: (x, y) => (x < 0 || y < 0 || x >= w || y >= w ? NaN : (px[y * w + x] ?? NaN)),
  };
}

const facts = (o: Partial<SpotFacts>): SpotFacts => ({
  sn: [null, null],
  asteroids: [[], []],
  stars: [[], []],
  artefacts: [[], []],
  info: [],
  ...o,
});

describe("Physics' fixed rules", () => {
  it('matches within 1.5 px (v4)', () => expect(MATCH_ARCSEC).toBeCloseTo(9.225, 3));
  it('counts only the FIT_REJECT names; OUTLIER and SOURCE are information', () => {
    expect(ARTEFACT_FLAGS.has('OUTLIER')).toBe(false);
    expect(ARTEFACT_FLAGS.has('SOURCE')).toBe(false);
    expect(ARTEFACT_FLAGS.has('PERSIST')).toBe(true);
    expect(ARTEFACT_FLAGS.size).toBe(22);
    expect([...INFO_FLAGS]).toEqual(['OUTLIER', 'SOURCE']);
  });
});

describe('recentring and the S/N gate', () => {
  it('moves a click a pixel off onto the star', () => {
    const c = recentre(image(15.3, 16), 16, 17);
    expect(c.x).toBeCloseTo(15.3, 0);
    expect(c.y).toBeCloseTo(16, 0);
  });
  it('a star clears S/N 5; empty sky does not', () => {
    expect(apertureSN(image(16, 16), 16, 16) ?? 0).toBeGreaterThan(5);
    expect(apertureSN(image(16, 16, 0), 16, 16) ?? 0).toBeLessThan(5);
  });
  it('gives no number off the data', () => expect(apertureSN(image(1, 1), 0.5, 0.5)).toBeNull());
});

describe('flags by name', () => {
  it("decodes the 3×3's flags from the file's own bit names", () => {
    const words = new Int32Array(9);
    words[4] = (1 << 3) | (1 << 21);
    const names = flagNamesNear(words, 3, 3, 1, 1, { HOT: 3, OUTLIER: 21, COLD: 4 });
    expect([...names].sort()).toEqual(['HOT', 'OUTLIER']);
  });
});

describe('the verdict, in order', () => {
  it('says nothing clear below S/N 5 in both looks', () =>
    expect(verdict(facts({ sn: [4.9, 3] })).kind).toBe('nothing'));
  it('puts a known asteroid first, but only at a look where the spot is ≥ 5σ', () => {
    expect(
      verdict(facts({ sn: [12, 2], asteroids: [['(1) Ceres'], []], stars: [['Gaia'], []] })).kind,
    ).toBe('asteroid');
    expect(verdict(facts({ sn: [2, 12], asteroids: [['(1) Ceres'], []] })).kind).toBe('unknown');
  });
  it('keeps a flagged known star a known star, with the flag noted', () => {
    const v = verdict(
      facts({ sn: [20, 20], stars: [['Gaia DR3 1'], []], artefacts: [['BLOOM'], []] }),
    );
    expect(v).toEqual({ kind: 'star', names: ['Gaia DR3 1'], flagged: ['BLOOM'] });
  });
  it('calls an unexplained flagged spot an artefact', () =>
    expect(verdict(facts({ sn: [8, 1], artefacts: [['PERSIST'], []] })).kind).toBe('artefact'));
  it('marks an unknown between 5 and 7 as faint', () => {
    expect(verdict(facts({ sn: [6, 2] }))).toEqual({ kind: 'unknown', faint: true });
    expect(verdict(facts({ sn: [9, 2] }))).toEqual({ kind: 'unknown', faint: false });
  });
});

describe("Physics' later rules (15 Nov)", () => {
  it("names the page's own target first", () =>
    expect(
      verdict(facts({ sn: [30, 30], target: 'WISE 0855', stars: [['Gaia DR3 1'], []] })),
    ).toEqual({
      kind: 'target',
      name: 'WISE 0855',
    }));
  it('counts a flag only in more than half of the photos that show the spot', () => {
    const photos = [new Set(['PERSIST', 'TRANSIENT']), new Set(['PERSIST']), new Set(['OUTLIER'])];
    const m = majorityFlags(photos);
    expect(m.counted).toEqual(['PERSIST']);
    expect(m.fractions).toContainEqual(['TRANSIENT', 1]);
    expect(m.fractions).toContainEqual(['OUTLIER', 1]);
    // Exactly half is not more than half; OUTLIER never counts.
    expect(majorityFlags([new Set(['HOT']), new Set()]).counted).toEqual([]);
    expect(majorityFlags([new Set(['OUTLIER']), new Set(['OUTLIER'])]).counted).toEqual([]);
  });
});
