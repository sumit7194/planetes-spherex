import { describe, expect, it } from 'vitest';

import { pastPlace, WANDERERS, offsetAt, trackTicks, motionDirection } from './targets';

const w = (id: string) => {
  const x = WANDERERS.find((t) => t.id === id);
  if (!x) throw new Error(id);
  return x;
};
/** Sexagesimal to degrees. */
const hms = (h: number, m: number, s: number) => (h + m / 60 + s / 3600) * 15;
const dms = (sign: number, d: number, m: number, s: number) => sign * (d + m / 60 + s / 3600);

describe('where a wanderer used to be', () => {
  it("places the challenge's WISE 0855 coordinates around 2010 (WISE's first look), 2.1′ back on its track", () => {
    // The challenge page: RA 08h55m10.831s, Dec −7°14′42.53″.
    const p = pastPlace(w('w0855'), { ra: hms(8, 55, 10.831), dec: dms(-1, 7, 14, 42.53) });
    expect(p).not.toBeNull();
    expect(p?.year).toBeGreaterThan(2009.5);
    expect(p?.year).toBeLessThan(2011.5);
    expect(p?.movedArcsec).toBeGreaterThan(120); // 2.1′
    expect(p?.missArcsec).toBeLessThan(3);
  });

  it("places Barnard's Star's J2000 catalogue position around 2000", () => {
    // SIMBAD J2000 (epoch 2000): 17h57m48.50s +04°41′36.2″.
    const p = pastPlace(w('barnard'), { ra: hms(17, 57, 48.5), dec: dms(1, 4, 41, 36.2) });
    expect(p?.year).toBeGreaterThan(1998);
    expect(p?.year).toBeLessThan(2002);
    expect(p?.movedArcsec).toBeGreaterThan(250);
  });

  it('says nothing for a spot near today’s place, off the track, or for a star that does not move', () => {
    const b = w('barnard');
    expect(pastPlace(b, b.at)).toBeNull(); // today's place
    expect(pastPlace(b, { ra: b.at.ra + 0.05, dec: b.at.dec })).toBeNull(); // 3′ east: off the track
    const r = w('rw-aur');
    expect(pastPlace(r, { ra: r.at.ra + 0.01, dec: r.at.dec })).toBeNull();
  });
});

describe('the path from an old position to now', () => {
  const w0855 = w('w0855');
  const barnard = w('barnard');
  it('puts WISE 0855 in 2010 about 2.2′ east of today (it moves west)', () => {
    const o = offsetAt(w0855, 2010);
    expect(o.east).toBeCloseTo(129.9, 0); // −8.118″/yr × −16 yr
    expect(o.north).toBeCloseTo(-10.8, 0);
    expect(motionDirection(w0855)).toBe('west');
  });
  it("puts Barnard's Star north-moving, ~10.4″ a year", () => {
    expect(motionDirection(barnard)).toBe('north');
    expect(Math.hypot(...Object.values(offsetAt(barnard, 2025)))).toBeCloseTo(10.39, 1);
  });
  it('ticks every 2, 5 or 10 years by the span, never at 2026 itself', () => {
    expect(trackTicks(2016.6)).toEqual([2018, 2020, 2022, 2024]);
    expect(trackTicks(2010.4)).toEqual([2015, 2020, 2025]);
    expect(trackTicks(1990)).toEqual([1990, 2000, 2010, 2020]);
  });
});
