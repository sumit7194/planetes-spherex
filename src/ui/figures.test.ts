import { describe, expect, it } from 'vitest';
import { binSpectrum, niceStep, type SpectrumPoint } from './figures';

describe('niceStep', () => {
  it('gives a round step for about four gridlines', () => {
    expect(niceStep(80)).toBe(20);
    expect(niceStep(3)).toBe(1);
    expect(niceStep(0.9)).toBeCloseTo(0.5, 9);
    expect(niceStep(0.03)).toBeCloseTo(0.01, 9);
    expect(niceStep(0)).toBe(1);
  });
});

describe('binSpectrum', () => {
  it('averages runs of photos per detector, by wavelength, weighting by error', () => {
    const pts: SpectrumPoint[] = Array.from({ length: 12 }, (_, i) => [1 + i * 0.01, 10, 2, 1, 0]);
    pts.push([3, 100, 1, 4, 0]);
    const bins = binSpectrum(pts, 10);
    // Twelve detector-1 photos make one bin (the short run of two joins it), plus one on D4.
    expect(bins.length).toBe(2);
    const [b] = bins;
    expect(b?.[1]).toBeCloseTo(10, 9);
    expect(b?.[2]).toBeCloseTo(2 / Math.sqrt(12), 9);
    expect(b?.[3]).toBe(1);
  });
});
