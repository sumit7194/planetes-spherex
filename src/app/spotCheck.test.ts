import { describe, expect, it } from 'vitest';
import {
  apertureSN,
  distinctPlaces,
  majorityFlags,
  photoGrid,
  samePixelProbes,
  stuckOnDetector,
  ARTEFACT_FLAGS,
  flagNamesNear,
  INFO_FLAGS,
  MATCH_ARCSEC,
  recentre,
  verdict,
  type Grid,
  type SpotFacts,
  type SpotSource,
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
  it('counts a known asteroid only at a look where the spot is ≥ 5σ', () => {
    expect(verdict(facts({ sn: [12, 2], asteroids: [['(1) Ceres'], []] })).kind).toBe('asteroid');
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
  it("names the page's own target when it's the only source", () =>
    expect(verdict(facts({ sn: [30, 30], target: 'WISE 0855' }))).toEqual({
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

describe('D6, the detector test', () => {
  it('counts places on the detectors more than 2 px apart', () => {
    expect(
      distinctPlaces([
        { det: 1, x: 100, y: 100 },
        { det: 1, x: 101, y: 101 },
        { det: 1, x: 140, y: 100 },
        { det: 2, x: 100, y: 100 },
      ]),
    ).toBe(3);
  });
  it('probes only the same detector, where the spot itself lands elsewhere', () => {
    const ref = { det: 3, x: 500, y: 500 };
    const list = [
      { det: 3, x: 510, y: 501, id: 'too close' },
      { det: 4, x: 900, y: 900, id: 'other detector' },
      { det: 3, x: 530, y: 500, id: 'a' },
      { det: 3, x: 300, y: 700, id: 'b' },
    ];
    expect(samePixelProbes(ref, list).map((p) => p.id)).toEqual(['a', 'b']);
    expect(samePixelProbes(ref, list, 1).map((p) => p.id)).toEqual(['a']);
  });
});

describe("Physics' second rule: two or more known sources are a blend (15 Nov)", () => {
  const target: SpotSource = { name: 'WISE 0855', sep: 6.0, kind: 'target' };
  const star: SpotSource = { name: 'Gaia DR3 1 (G 16.3)', sep: 0.5, kind: 'star' };
  const sources = [target, star];
  it('gives the target no priority and lists the sources nearest first', () =>
    expect(verdict(facts({ sn: [30, 34], sources }))).toEqual({
      kind: 'blend',
      sources: [star, target],
    }));
  it('a blend even when the target is nearest', () =>
    expect(verdict(facts({ sn: [30, 34], sources: [{ ...target, sep: 0.4 }, star] })).kind).toBe(
      'blend',
    ));
  it('one source is the headline', () =>
    expect(verdict(facts({ sn: [30, 34], sources: [star] })).kind).toBe('star'));
});

describe("D6, Physics' rule", () => {
  it('stays put: at most 2 places, and bright in more than half of at least 3 probes', () => {
    expect(stuckOnDetector(1, [{ bright: 3, n: 4 }])).toBe(true);
    expect(
      stuckOnDetector(2, [
        { bright: 0, n: 8 },
        { bright: 5, n: 8 },
      ]),
    ).toBe(true);
  });
  it("doesn't fire on many places, few probes, or half", () => {
    expect(stuckOnDetector(3, [{ bright: 8, n: 8 }])).toBe(false);
    expect(stuckOnDetector(1, [{ bright: 2, n: 2 }])).toBe(false);
    expect(stuckOnDetector(1, [{ bright: 4, n: 8 }])).toBe(false);
  });
  it('a spot stuck on the detector is an artefact', () =>
    expect(verdict(facts({ sn: [9, 1], stuck: true }))).toEqual({
      kind: 'artefact',
      flags: [],
      stuck: true,
    }));
});

describe('masked pixels in a photo (15 Nov)', () => {
  it('leaves out a flagged dead pixel instead of reading it as a star', () => {
    const w = 32;
    const img = new Float32Array(w * w);
    for (let k = 0; k < img.length; k++) img[k] = 0.3 + ((k * 7) % 5) * 0.02;
    const flags = new Int32Array(w * w);
    img[16 * w + 16] = 563;
    flags[16 * w + 16] = (1 << 0) | (1 << 2) | (1 << 6);
    const bits = { TRANSIENT: 0, SUR_ERROR: 2, NONFUNC: 6, OUTLIER: 19 };
    const raw = { w, h: w, at: (x: number, y: number) => img[y * w + x] ?? NaN };
    expect(apertureSN(raw, 16, 16) ?? 0).toBeGreaterThan(100);
    expect(Math.abs(apertureSN(photoGrid(img, flags, w, w, bits), 16, 16) ?? 99)).toBeLessThan(5);
  });
  it('an OUTLIER flag alone masks nothing (it fires on real asteroids)', () => {
    const img = new Float32Array(4).fill(1);
    const flags = new Int32Array(4).fill(1 << 19);
    expect(photoGrid(img, flags, 2, 2, { OUTLIER: 19 }).at(0, 0)).toBe(1);
  });
});
