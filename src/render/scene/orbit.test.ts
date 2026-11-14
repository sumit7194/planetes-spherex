import { describe, expect, it } from 'vitest';
import { sunPosition } from '../../data/sun';
import {
  gmstDeg,
  nearestU,
  orbitFrame,
  orbitPoint,
  SPHEREX_ALT_KM,
  SPHEREX_ORBIT,
  type Vec3,
} from './orbit';

const RAD = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const toVec = (ra: number, dec: number): Vec3 => [
  Math.cos(dec * RAD) * Math.cos(ra * RAD),
  Math.cos(dec * RAD) * Math.sin(ra * RAD),
  Math.sin(dec * RAD),
];
const mjdOf = (d: Date) => d.getTime() / 86_400_000 + 40587;

describe("SPHEREx's orbit", () => {
  it('is about 659 km up and takes about 98 minutes', () => {
    expect(SPHEREX_ALT_KM).toBeCloseTo(659.3, 0);
    expect(SPHEREX_ORBIT.periodMin).toBeCloseTo(97.9, 0);
  });

  it('gives Greenwich sidereal time at J2000.0', () => {
    expect(gmstDeg(51544.5)).toBeCloseTo(280.4606, 3);
  });

  it('runs near the day-night line: the Sun stays within ~32° of its axis all year', () => {
    // The plane is fixed to the equator (inclination 98°) while the Sun's declination swings
    // ±23.4°, so the Sun drifts off the orbit's axis by up to 23.4° + 8° through the year.
    const off: number[] = [];
    for (const iso of ['2025-03-20', '2025-06-21', '2025-09-22', '2025-12-21']) {
      const date = new Date(`${iso}T12:00:00Z`);
      const sun = sunPosition(date);
      const n = orbitFrame(mjdOf(date)).normal;
      off.push(Math.acos(Math.abs(dot(n, toVec(sun.ra, sun.dec)))) / RAD);
    }
    for (const a of off) expect(a).toBeLessThan(32.5);
    expect(Math.max(...off)).toBeGreaterThan(29); // December: Sun at −23.4°, axis at +8°
    expect(Math.min(...off)).toBeLessThan(16); // June: the two on the same side
  });

  it('crosses the equator heading north on the dawn side (6 AM node)', () => {
    const date = new Date('2025-09-10T12:00:00Z');
    const mjd = mjdOf(date);
    const sun = sunPosition(date);
    const node = orbitFrame(mjd).node;
    // The node is 90° west of the Sun: dawn. A little later along the orbit, it is north.
    const sunRa = toVec(sun.ra, 0);
    const west: Vec3 = [sunRa[1], -sunRa[0], 0];
    expect(dot(node, west)).toBeGreaterThan(0.99);
    expect(orbitPoint(mjd, 10)[2]).toBeGreaterThan(0);
  });

  it('is nearly polar: it reaches 82° of latitude', () => {
    const p = orbitPoint(51544.5, 90);
    const lat = Math.asin(p[2] / Math.hypot(...p)) / RAD;
    expect(lat).toBeCloseTo(180 - SPHEREX_ORBIT.inclinationDeg, 3);
  });

  it('finds the orbit point whose zenith is nearest a line of sight', () => {
    const mjd = 60928.5;
    const target = orbitPoint(mjd, 137);
    const r = Math.hypot(...target);
    const look: Vec3 = [target[0] / r, target[1] / r, target[2] / r];
    expect(nearestU(mjd, look)).toBeCloseTo(137, 6);
  });
});

describe("the Sun's size", () => {
  it('is largest in early January and smallest in early July', async () => {
    const { sunDiameterDeg } = await import('./light');
    const jan = sunDiameterDeg(mjdOf(new Date('2025-01-04T00:00:00Z')));
    const jul = sunDiameterDeg(mjdOf(new Date('2025-07-04T00:00:00Z')));
    expect(jan).toBeCloseTo(0.542, 3);
    expect(jul).toBeCloseTo(0.524, 3);
  });
});
