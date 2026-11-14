import { describe, expect, it } from 'vitest';
import { parseSkyPosition, positionFromQuery, separationDeg } from './coords';

const WISE_0855 = { ra: 133.795129, dec: -7.245147 };

function parsed(input: string) {
  const r = parseSkyPosition(input);
  if (!r.ok) throw new Error(`failed to parse "${input}": ${r.reason}`);
  return r.position;
}

describe('parseSkyPosition', () => {
  it.each([
    ['08h55m10.831s −07d14m42.53s', 'challenge page, unit letters and typographic minus'],
    ['08h55m10.831s, -7°14′42.53″', 'degree sign and prime marks'],
    ['08:55:10.831 -07:14:42.53', 'colons'],
    ['08 55 10.831 -07 14 42.53', 'spaces'],
    ['133.79513 −7.24515', 'decimal degrees with typographic minus'],
    ['133.79513, -7.24515', 'decimal degrees with a comma'],
  ])('reads %s (%s)', (input) => {
    const p = parsed(input);
    expect(separationDeg(p, WISE_0855) * 3600).toBeLessThan(0.05);
  });

  it('reads a positive declination with an explicit sign', () => {
    const p = parsed('17 57 48.5 +04 41 36');
    expect(p.ra).toBeCloseTo(269.452, 3);
    expect(p.dec).toBeCloseTo(4.6933, 3);
  });

  it('wraps right ascension into [0, 360)', () => {
    expect(parsed('-10 20').ra).toBeCloseTo(350, 6);
  });

  it.each(['', 'hello', '25h00m00s +10d', '10 95'])('rejects "%s"', (input) => {
    expect(parseSkyPosition(input).ok).toBe(false);
  });
});

describe('separationDeg', () => {
  it('is zero for the same point and symmetric', () => {
    const a = { ra: 10, dec: 20 };
    const b = { ra: 10.5, dec: 20.2 };
    expect(separationDeg(a, a)).toBe(0);
    expect(separationDeg(a, b)).toBeCloseTo(separationDeg(b, a), 12);
  });

  it('measures the challenge coordinate 2.1 arcmin from WISE 0855 at 2026.0', () => {
    const now = { ra: 133.760052, dec: -7.242598 };
    expect(separationDeg(WISE_0855, now) * 60).toBeCloseTo(2.09, 2);
  });
});

describe('positionFromQuery', () => {
  const from = (query: string) => positionFromQuery(new URLSearchParams(query));
  it('reads ?at= in degrees and ?ra=&dec= in degrees or sexagesimal', () => {
    for (const query of [
      'at=133.79513,-7.24515',
      'ra=133.79513&dec=-7.24515',
      'ra=08h55m10.831s&dec=-07d14m42.53s',
      'ra=08:55:10.831&dec=-07:14:42.53',
    ]) {
      const p = from(query);
      expect(p, query).not.toBeNull();
      if (p) expect(separationDeg(p, WISE_0855) * 3600).toBeLessThan(0.05);
    }
  });

  it('reads a + sign that the URL turned into a space', () => {
    expect(from('ra=17:57:48.5&dec=+04:41:36')?.dec).toBeCloseTo(4.6933, 3);
  });

  it('gives null when absent or unreadable', () => {
    expect(from('target=barnard')).toBeNull();
    expect(from('ra=10')).toBeNull();
    expect(from('ra=10&dec=95')).toBeNull();
  });
});
