import { describe, expect, it } from 'vitest';
import { loudness, notesFrom, pitchHz } from './listen';

describe('Listen (N8)', () => {
  it('plays short wavelengths high and long ones low, over two octaves', () => {
    expect(pitchHz(0.75)).toBeCloseTo(880, 6);
    expect(pitchHz(5)).toBeCloseTo(220, 6);
    expect(pitchHz(2)).toBeLessThan(pitchHz(1));
  });
  it('groups points in narrow bands by median, leaving empty bands silent', () => {
    const n = notesFrom([
      { um: 1.001, flux: 1 },
      { um: 1.002, flux: 9 },
      { um: 1.003, flux: 3 },
      { um: 3.0, flux: 5 },
    ]);
    expect(n).toHaveLength(2);
    expect(n[0]?.flux).toBe(3);
    // Nothing between 1.05 and 3.0 µm: no note there.
    expect(n.every((x) => x.um < 1.05 || x.um > 2.95)).toBe(true);
  });
  it('ignores points outside 0.75–5 µm or not finite', () => {
    expect(
      notesFrom([
        { um: 6, flux: 1 },
        { um: NaN, flux: 1 },
        { um: 1, flux: NaN },
      ]),
    ).toEqual([]);
  });
  it('keeps faint and negative points audible, brightest loudest', () => {
    const g = loudness([
      { um: 1, flux: -2 },
      { um: 2, flux: 1 },
      { um: 3, flux: 100 },
    ]);
    expect(g[0]).toBe(0.15);
    expect(g[1]).toBeCloseTo(0.15, 6);
    expect(g[2]).toBeCloseTo(1, 6);
  });
});
