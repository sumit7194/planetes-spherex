import { describe, expect, it } from 'vitest';
import { arcsecAboutText, coinDistanceMetres, monthYear, utcTime, withError } from './numbers';

describe('public numbers', () => {
  it('prints the measured move as a whole number of arcseconds', () => {
    expect(arcsecAboutText(6.1)).toBe('about 6 arcseconds');
    expect(arcsecAboutText(8.7)).toBe('about 9 arcseconds');
  });

  it('derives the coin from the printed range, landing inside it (Physics rule)', () => {
    // Barnard: "about 6 to 7": midpoint 6.5″ → 635 m → 650 m, which is 6.35″.
    expect(coinDistanceMetres(6, 7)).toBe(650);
    const angle = (lo: number, hi: number) => (0.02 / coinDistanceMetres(lo, hi)) * 206_265;
    for (const [lo, hi] of [
      [4, 5],
      [7, 9],
      [1, 2],
    ] as const) {
      expect(angle(lo, hi)).toBeGreaterThanOrEqual(lo);
      expect(angle(lo, hi)).toBeLessThanOrEqual(hi);
    }
    // "About 6" (one whole number printed) means 6 ± 0.5.
    expect(Math.abs(angle(6, 6) - 6)).toBeLessThanOrEqual(0.5);
  });

  it('formats a value with its error and refuses a null value', () => {
    const base = {
      key: 'k',
      unit: 'px' as const,
      method: '',
      basis: [] as string[],
      provenance: '',
    };
    expect(withError({ ...base, value: 1.1, error: 0.05, status: 'MEASURED' })).toBe('1.10 ± 0.05');
    expect(() => withError({ ...base, value: null, status: 'NOT_RELIABLE' })).toThrow();
  });

  it('turns a Modified Julian Date into a month', () => {
    expect(monthYear(60902.87)).toBe('August 2025');
  });
});

describe('time of day', () => {
  it('gives UTC hours and minutes from a modified Julian date', () => {
    expect(utcTime(60789.856188)).toBe('20:32');
    expect(utcTime(60000)).toBe('00:00');
  });
});
