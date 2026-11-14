import { describe, expect, it } from 'vitest';
import {
  nearestRow,
  pointingAt,
  RIDE_SPEEDUP,
  separationDeg,
  slewSeconds,
  speedAfter,
  type PointingRow,
} from './ride';

const S = 1 / 86_400;
// Three exposures 129 s apart, hopping 8° north each time, then a 20-minute downlink gap.
const rows: PointingRow[] = [
  [60000, 100, 0, 0, 6, 'detectors 2 and 5'],
  [60000 + 129 * S, 100, 8, 0, 6, 'detectors 2 and 5'],
  [60000 + 258 * S, 100, 16, 0, 6, 'detectors 2 and 5'],
  [60000 + 1458 * S, 100, 24, 0, 6, 'detectors 2 and 5'],
];

describe('riding along the real pointing', () => {
  it('holds still through an exposure, then slews to the next', () => {
    const early = pointingAt(rows, 60000 + 10 * S);
    expect(early).toMatchObject({ ra: 100, dec: 0, slewing: false, row: 0 });
    // An 8° slew takes 19.7 + 8.7 = 28.4 s, capped at a third of the 129 s gap (43 s): 28.4 s.
    expect(slewSeconds(8, 129)).toBeCloseTo(28.4, 1);
    const mid = pointingAt(rows, 60000 + (129 - 14.2) * S);
    expect(mid.slewing).toBe(true);
    expect(mid.dec).toBeGreaterThan(3);
    expect(mid.dec).toBeLessThan(5);
    expect(pointingAt(rows, 60000 + 129 * S).dec).toBeCloseTo(8, 6);
  });

  it("doesn't slew when the pointing repeats", () => {
    expect(slewSeconds(0, 129)).toBe(0);
  });

  it('runs at the stated speed-up, and through long gaps faster', () => {
    expect(speedAfter(rows, 0)).toBe(RIDE_SPEEDUP);
    expect(speedAfter(rows, 2)).toBeCloseTo(1200 / 6, 6);
    expect(pointingAt(rows, 60000 + 500 * S).gap).toBe(true);
  });

  it('starts from the exposure nearest where the visitor looks', () => {
    expect(nearestRow(rows, [101, 15])).toBe(2);
    expect(separationDeg([0, 0], [90, 0])).toBeCloseTo(90, 9);
  });
});
