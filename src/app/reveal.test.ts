import { describe, expect, it } from 'vitest';
import { arrowAt } from './reveal';

describe('arrowAt', () => {
  it('stays at true size for the first cuts, then grows to the enlargement', () => {
    expect(arrowAt(1, 6, 8, 2)).toEqual({ scale: 1, progress: 1 / 6 });
    expect(arrowAt(2, 6, 8, 2).scale).toBe(1);
    expect(arrowAt(4, 6, 8, 2).scale).toBeCloseTo(4.5, 6);
    expect(arrowAt(6, 6, 8, 2)).toEqual({ scale: 8, progress: 1 });
  });

  it('never overshoots', () => {
    expect(arrowAt(9, 6, 8, 2)).toEqual({ scale: 8, progress: 1 });
  });
});
