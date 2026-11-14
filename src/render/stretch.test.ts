import { describe, expect, it } from 'vitest';
import { sharedStretch, toGrey } from './stretch';

describe('sharedStretch', () => {
  it('maps the floor to black, the ceiling to white, and NaN to no data', () => {
    const tile = Float32Array.from({ length: 1000 }, (_, i) => i);
    const s = sharedStretch([tile]);
    expect(toGrey(s.floor, s)).toBe(0);
    expect(toGrey(s.ceiling, s)).toBe(255);
    expect(toGrey(NaN, s)).toBeNull();
  });

  it('keeps a real brightness difference between two tiles visible', () => {
    const dim = Float32Array.from({ length: 400 }, (_, i) => (i === 0 ? 50 : i % 7));
    const bright = Float32Array.from({ length: 400 }, (_, i) => (i === 0 ? 100 : i % 7));
    const s = sharedStretch([dim, bright]);
    expect(toGrey(100, s) ?? 0).toBeGreaterThan(toGrey(50, s) ?? 0);
  });

  it('ignores NaN pixels when choosing the stretch', () => {
    const t = Float32Array.from([NaN, 1, 2, 3, NaN, 4]);
    const s = sharedStretch([t]);
    expect(Number.isFinite(s.floor) && Number.isFinite(s.ceiling)).toBe(true);
  });
});
