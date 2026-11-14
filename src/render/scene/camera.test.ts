import { describe, expect, it } from 'vitest';
import { CLOSE_M, END_RE, stepOut, stepOutDistanceM } from './camera';
import type { Vec3 } from './orbit';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sat: Vec3 = [0, 0, 1];
const look: Vec3 = [0, 0.05 / Math.hypot(0.05, 1), 1 / Math.hypot(0.05, 1)];
const sun: Vec3 = [1, 0, 0];

describe('stepping out from SPHEREx', () => {
  it('starts at SPHEREx, looking where it looks', () => {
    const s = stepOut(0, sat, look, sun, 1.1);
    expect(s.cam[2]).toBeCloseTo(1.1, 9);
    expect(dot(s.aim, look)).toBeCloseTo(1, 6);
  });

  it('holds a close-up a few metres out, on the sunlit side', () => {
    const s = stepOut(0.14, sat, look, sun, 1.1, [0, 1, 0]);
    expect(s.fromSpherexM).toBeGreaterThanOrEqual(CLOSE_M);
    expect(s.fromSpherexM).toBeLessThan(10);
    expect(s.cam[0]).toBeGreaterThan(0); // towards the Sun
    expect(s.cam[1]).toBeLessThan(0); // behind it along its track
    expect(s.cam[2]).toBeGreaterThan(1.1); // a little above it
    expect(s.toEarth).toBe(0);
  });

  it('costs the same scroll for each tenfold step in the middle', () => {
    const endM = 3e7;
    const r1 = stepOutDistanceM(0.3, endM) / stepOutDistanceM(0.2, endM);
    const r2 = stepOutDistanceM(0.8, endM) / stepOutDistanceM(0.7, endM);
    expect(r1).toBeCloseTo(r2, 6);
  });

  it('never goes backwards', () => {
    let last = 0;
    for (let n = 0; n <= 1; n += 0.01) {
      const d = stepOutDistanceM(n, 3e7);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });

  it("ends on the Sun's side of Earth, looking at Earth's centre", () => {
    const s = stepOut(1, sat, look, sun, 1.1);
    expect(Math.hypot(...s.cam)).toBeCloseTo(END_RE, 6);
    expect(s.cam[0]).toBeCloseTo(END_RE, 6);
    expect(dot(s.aim, [-1, 0, 0])).toBeCloseTo(1, 6);
  });
});
