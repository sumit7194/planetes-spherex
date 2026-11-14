import { describe, expect, it } from 'vitest';
import { targetPlaceAt, type PassPlaces } from './targetPlace';

// 6.15″ pixels; the star moves 6.15″ east per 100 days.
const p: PassPlaces = {
  seasonMjd: { '0': 100, '1': 200, '2': 300 },
  atSeason: { '0': [0, 0, 0, 0], '1': [0, 0, 6.15, 0], '2': [0, 0, 12.3, 6.15] },
};

describe("the target's place at a photo's time", () => {
  it('is the pass place at a pass mean, and on the line between passes', () => {
    expect(targetPlaceAt(p, 200, 6.15)).toEqual({ east: 1, north: 0 });
    const mid = targetPlaceAt(p, 250, 6.15);
    expect(mid?.east).toBeCloseTo(1.5, 9);
    expect(mid?.north).toBeCloseTo(0.5, 9);
  });

  it('carries the nearest two passes beyond either end', () => {
    expect(targetPlaceAt(p, 50, 6.15)?.east).toBeCloseTo(-0.5, 9);
    expect(targetPlaceAt(p, 350, 6.15)?.north).toBeCloseTo(1.5, 9);
  });

  it('has nothing to say without pass places', () => {
    expect(targetPlaceAt({ seasonMjd: {}, atSeason: {} }, 100, 6.15)).toBeNull();
  });
});
