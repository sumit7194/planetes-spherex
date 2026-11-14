import { describe, expect, it } from 'vitest';
import { EE_XMAX, EE_YMAX, equalEarth, unEqualEarth } from './equalEarth';

describe('Equal Earth', () => {
  it('fits a box close to 2:1', () => {
    expect(EE_XMAX / EE_YMAX).toBeGreaterThan(2.0);
    expect(EE_XMAX / EE_YMAX).toBeLessThan(2.1);
  });
  it('inverts itself across the sphere', () => {
    for (const lon of [-179, -120, -45, 0, 30, 90, 179])
      for (const lat of [-89, -60, -20, 0, 15, 45, 80, 89]) {
        const [x, y] = equalEarth((lon * Math.PI) / 180, (lat * Math.PI) / 180);
        const back = unEqualEarth(x, y);
        expect(back).not.toBeNull();
        expect(((back?.[0] ?? 0) * 180) / Math.PI).toBeCloseTo(lon, 6);
        expect(((back?.[1] ?? 0) * 180) / Math.PI).toBeCloseTo(lat, 6);
      }
  });
  it('is null outside its outline', () => {
    expect(unEqualEarth(EE_XMAX * 1.01, 0)).toBeNull();
    expect(unEqualEarth(0, EE_YMAX * 1.01)).toBeNull();
  });
});
