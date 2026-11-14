import { describe, expect, it } from 'vitest';
import { hammer, unhammer } from './hammer';

const RAD = Math.PI / 180;

describe('the Hammer–Aitoff all-sky map', () => {
  it('fills a 2:1 ellipse', () => {
    expect(hammer(Math.PI, 0)[0]).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(hammer(0, Math.PI / 2)[1]).toBeCloseTo(Math.SQRT2, 9);
  });

  it('round-trips positions', () => {
    for (const [l, p] of [
      [0, 0],
      [120, 40],
      [-170, -75],
      [45, 89],
    ] as const) {
      const [x, y] = hammer(l * RAD, p * RAD);
      const back = unhammer(x, y);
      expect(back?.[0] ?? NaN).toBeCloseTo(l * RAD, 9);
      expect(back?.[1] ?? NaN).toBeCloseTo(p * RAD, 9);
    }
  });

  it('is equal-area: a 10° square near the pole covers the same map area as at the equator', () => {
    const area = (l0: number, p0: number) => {
      // Shoelace over the projected outline of a small lat-long cell, scaled by the true area.
      const pts: [number, number][] = [];
      for (let i = 0; i <= 20; i++) pts.push(hammer((l0 + i * 0.5) * RAD, p0 * RAD));
      for (let i = 0; i <= 20; i++) pts.push(hammer((l0 + 10) * RAD, (p0 + i * 0.5) * RAD));
      for (let i = 20; i >= 0; i--) pts.push(hammer((l0 + i * 0.5) * RAD, (p0 + 10) * RAD));
      for (let i = 20; i >= 0; i--) pts.push(hammer(l0 * RAD, (p0 + i * 0.5) * RAD));
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i] ?? [0, 0];
        const [x2, y2] = pts[(i + 1) % pts.length] ?? [0, 0];
        a += x1 * y2 - x2 * y1;
      }
      const sphere = 10 * RAD * (Math.sin((p0 + 10) * RAD) - Math.sin(p0 * RAD));
      return Math.abs(a / 2) / sphere;
    };
    expect(area(0, 0)).toBeCloseTo(area(30, 70), 2);
  });

  it('says when a point is off the map', () => {
    expect(unhammer(3, 0)).toBeNull();
  });
});
