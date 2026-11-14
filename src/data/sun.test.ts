import { describe, expect, it } from 'vitest';
import { eclipticPoint, sunPosition } from './sun';

describe('sunPosition', () => {
  it('puts the Sun on the equator at the March equinox', () => {
    const p = sunPosition(new Date(Date.UTC(2026, 2, 20, 14, 46)));
    expect(Math.abs(p.dec)).toBeLessThan(0.05);
    expect(p.ra < 0.3 || p.ra > 359.7).toBe(true);
  });

  it('puts the Sun at its highest in June', () => {
    const p = sunPosition(new Date(Date.UTC(2026, 5, 21, 8, 24)));
    expect(p.ra).toBeCloseTo(90, 0);
    expect(p.dec).toBeCloseTo(23.44, 1);
  });
});

describe('eclipticPoint', () => {
  it('reaches the obliquity at longitude 90', () => {
    expect(eclipticPoint(90).dec).toBeCloseTo(23.44, 1);
    expect(eclipticPoint(270).dec).toBeCloseTo(-23.44, 1);
  });
});
