import { describe, expect, it } from 'vitest';
import { angleFromRadius } from './sky';

// The inside view's radial law: (1 − k)·tan c + k·2·tan(c/2), the inverse found by Newton.
const radius = (c: number, k: number) => (1 - k) * Math.tan(c) + 2 * k * Math.tan(c / 2);

describe('stereographic–pinhole blend', () => {
  it('inverts the forward law at every blend and angle', () => {
    for (const k of [0, 0.1, 0.5, 0.9, 1])
      for (const deg of [0.01, 1, 10, 30, 60, 75, 100]) {
        const c = (deg * Math.PI) / 180;
        if (k < 1 && deg > 85) continue; // any pinhole share is cut off before 88°
        if (k === 0 && deg > 75) continue; // the pinhole camera alone stops at 78°
        expect(angleFromRadius(radius(c, k), k)).toBeCloseTo(c, 9);
      }
  });
  it('keeps the same scale at the centre', () => {
    const c = 1e-4;
    expect(radius(c, 0) / radius(c, 1)).toBeCloseTo(1, 6);
  });
});
