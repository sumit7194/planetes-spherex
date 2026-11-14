import { describe, expect, it } from 'vitest';
import { passCount, passStarts, weekCounts } from './passes';

// The same synthetic cells as pipeline/test_build_band.py: weekly mid-times from MJD 60803.5.
const mid = (k: number) => 60803.5 + 7 * k;
const at = (ks: number[]) => ks.map(mid);
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

describe('passCount (Physics, 14 Nov)', () => {
  it('is zero for a spot never photographed', () => expect(passCount([])).toBe(0));
  it('starts a new pass after a gap of more than 60 days', () => {
    expect(passCount(at([0, 1, 30, 31, 60]))).toBe(3);
    expect(passStarts(at([0, 1, 30, 31, 60]))).toEqual(at([0, 30, 60]));
  });
  it('keeps gaps of 60 days or less in one pass', () => {
    expect(passCount(at([0, 8]))).toBe(1); // 56 days
    expect(passCount(at([0, 9]))).toBe(2); // 63 days
  });
  it('counts a short continuous run as one pass', () =>
    expect(passCount(at(range(0, 21)))).toBe(1));
  it('counts a spot watched all the time once per six months', () => {
    expect(passCount(at(range(0, 76)))).toBe(3); // 525 days
    expect(passCount(at(range(0, 27)))).toBe(1); // 182 days: not over half a year
    expect(passCount(at(range(0, 28)))).toBe(2); // 189 days
  });
});

describe('weekCounts', () => {
  it('bins photos into their weeks and drops the rest', () => {
    const weeks = [0, 1, 2].map((k) => ({
      start: 60800 + 7 * k,
      end: 60807 + 7 * k,
      label: '',
      startUtc: '',
    }));
    expect(weekCounts([60800, 60806.9, 60807, 60830], weeks)).toEqual([2, 1, 0]);
  });
});
