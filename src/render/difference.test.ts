import { describe, expect, it } from 'vitest';
import type { Tile } from '../data/pack/load';
import { FlagMask } from '../data/pack/types';
import { DIFF_LIMIT, diffColour, difference, inSigma, strictLook } from './difference';

const SIZE = 16;
function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('missing');
  return x;
}
function tile(fn: (i: number) => number, flags: (i: number) => number = () => 0): Tile {
  const n = SIZE * SIZE;
  return {
    id: 't',
    size: SIZE,
    pixels: Float32Array.from({ length: n }, (_, i) => fn(i)),
    flags: Uint8Array.from({ length: n }, (_, i) => flags(i)),
  };
}
// Deterministic "noise": ±1 alternating, so the MAD is exactly 1.
const noise = (i: number) => (i % 2 ? 1 : -1);

describe('difference', () => {
  it('measures change in units of its own noise, after removing the sky level', () => {
    const early = tile(() => 0);
    const late = tile((i) => 10 + noise(i) + (i === 40 ? 20 : 0));
    const d = difference(early, late);
    expect(d).not.toBeNull();
    expect(must(d).sigma).toBeCloseTo(1.4826, 3);
    // The 10-unit sky offset is gone; the 20-unit jump stands out at over 10σ.
    expect(must(d).tile.pixels[40]).toBeGreaterThan(10);
    expect(Math.abs(must(d).tile.pixels[41] ?? NaN)).toBeLessThan(1);
  });

  it('never compares a pixel flagged in either look', () => {
    const early = tile(noise, (i) => (i === 5 ? FlagMask.saturated : 0));
    const late = tile(
      (i) => -noise(i),
      (i) => (i === 6 ? FlagMask.rejected : 0),
    );
    const d = must(difference(early, late));
    expect(d.masked).toBe(2);
    expect(Number.isNaN(d.tile.pixels[5])).toBe(true);
    expect(Number.isNaN(d.tile.pixels[6])).toBe(true);
    expect(d.tile.flags[5]).toBe(FlagMask.saturated);
  });

  it('gives up when too few pixels are left to estimate the noise', () => {
    const early = tile(noise, () => FlagMask.saturated);
    expect(difference(early, tile(noise))).toBeNull();
  });

  it('clamps the colour scale at ±5σ', () => {
    expect(diffColour(DIFF_LIMIT)).toEqual(diffColour(50));
    expect(diffColour(-DIFF_LIMIT)).toEqual(diffColour(-50));
    expect(diffColour(0)).not.toEqual(diffColour(1));
  });
});

describe('strictLook', () => {
  it('leaves out a flagged pixel photo by photo, and weighs detectors equally', () => {
    const a = tile(
      () => 1,
      (i) => (i === 3 ? FlagMask.rejected : 0),
    );
    const b = tile((i) => (i === 3 ? 100 : 3));
    const c = tile(() => 10);
    const look = must(
      strictLook(
        'x',
        [
          { detector: 1, tile: a },
          { detector: 1, tile: b },
          { detector: 2, tile: c },
        ],
        [1, 2],
      ),
    );
    // Detector 1: mean(1, 3) = 2, detector 2: 10 → 6. At pixel 3, b alone is half of
    // detector 1's photos, enough: (100 + 10) / 2.
    expect(look.pixels[0]).toBe(6);
    expect(look.pixels[3]).toBe(55);
    expect(look.flags[3]).toBe(0);
    expect(look.flags[0]).toBe(0);
  });

  it('leaves a pixel out when one detector has nothing usable there', () => {
    const a = tile(
      () => 1,
      (i) => (i === 7 ? FlagMask.saturated : 0),
    );
    const look = must(
      strictLook(
        'x',
        [
          { detector: 1, tile: a },
          { detector: 2, tile: tile(() => 2) },
        ],
        [1, 2],
      ),
    );
    expect(Number.isNaN(look.pixels[7])).toBe(true);
    expect((look.flags[7] ?? 0) & FlagMask.saturated).toBeTruthy();
    expect((look.flags[7] ?? 0) & FlagMask.rejected).toBeTruthy();
  });

  it("leaves a pixel out where fewer than half of a detector's photos could use it", () => {
    const sat = (i: number) => (i === 9 ? FlagMask.saturated : 0);
    const look = must(
      strictLook(
        'x',
        [
          { detector: 1, tile: tile(() => 1, sat) },
          { detector: 1, tile: tile(() => 1, sat) },
          { detector: 1, tile: tile(() => 1) },
        ],
        [1],
      ),
    );
    expect(Number.isNaN(look.pixels[9])).toBe(true);
    expect(look.pixels[8]).toBe(1);
  });
});

describe('inSigma', () => {
  it('scales a film frame by its own noise, keeping unusable pixels unusable', () => {
    const size = 10;
    const values = new Float32Array(size * size).map((_, i) => 5 + ((i % 3) - 1));
    values[0] = NaN;
    values[55] = 45; // a bright change: (45 - 5) / σ
    const d = inSigma('f', size, values);
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.sigma).toBeCloseTo(1.4826, 6);
    expect(Number.isNaN(d.tile.pixels[0])).toBe(true);
    expect(d.masked).toBe(1);
    expect(d.tile.pixels[55]).toBeGreaterThan(DIFF_LIMIT);
  });

  it('refuses a frame with too few usable pixels', () => {
    expect(inSigma('f', 4, new Float32Array(16).fill(1))).toBeNull();
  });
});
