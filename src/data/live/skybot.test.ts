import { describe, expect, it } from 'vitest';
import { fromObserver, observerFromHeader, parseSkybot } from './skybot';

describe('parseSkybot', () => {
  it('reads SkyBoT basic JSON rows', () => {
    const [m] = parseSkybot([
      {
        Num: 822425,
        Name: '2015 RM311',
        'RA (hms)': '09 59 54.9506',
        'DEC (dms)': '+11 58 42.227',
        Class: 'MB>Inner',
        'VMag (mag)': 24,
        'Err (arcsec)': 0.027,
        'dRA (arcsec/h)': 42.8053,
        'dDEC (arcsec/h)': -16.2975,
      },
    ]);
    expect(m?.name).toBe('2015 RM311');
    expect(m?.number).toBe(822425);
    expect(m?.ra).toBeCloseTo(149.97896, 4);
    expect(m?.dec).toBeCloseTo(11.9784, 4);
    expect(m?.raRateArcsecH).toBeCloseTo(42.8053, 4);
  });
  it('reads a southern declination', () => {
    const [m] = parseSkybot([{ Name: 'x', 'RA (hms)': '00 00 00', 'DEC (dms)': '-00 30 00' }]);
    expect(m?.dec).toBeCloseTo(-0.5, 6);
    expect(m?.number).toBeNull();
  });
});

describe('places as SPHEREx saw them (Physics, 15 Nov)', () => {
  const card = (s: string) => s.padEnd(80, ' ');
  const header = [
    card('HIERARCH X_SC_START = -3819.1597303452845 / [km] Exposure START x position'),
    card("HIERARCH XYZ_SC_SYSTEM = 'GEOCENTER' / Reference frame for spacecraft position ("),
    card('X_SC    =  -2917.6714774202596 / [km] Exposure MID x position'),
    card('Y_SC    =   5638.478955577316 / [km] Exposure MID y position'),
    card('Z_SC    =   3028.988338044532 / [km] Exposure MID z position'),
    card('END'),
  ].join('');
  it('reads the mid-exposure position, not the start or end cards', () =>
    expect(observerFromHeader(header)).toEqual([
      -2917.6714774202596, 5638.478955577316, 3028.988338044532,
    ]));
  it('refuses a header without GEOCENTER', () =>
    expect(observerFromHeader(header.replace('GEOCENTER', 'HELIOCENT'))).toBeNull());
  // SPHEREx's position in 2025W43_2A_0182_1 (D1), the photo of the N5 unit check.
  it('matches the N5 unit check (644 Cosima; kete agreed to 0.14″)', () => {
    const o = observerFromHeader(header);
    if (!o) throw new Error('no observer');
    const p = fromObserver(131.94687666666667, 17.807729444444444, 2.47288395735, o);
    const sep =
      Math.hypot(
        (p.ra - 131.94713677453402) * Math.cos((17.8 * Math.PI) / 180),
        p.dec - 17.80757380560019,
      ) * 3600;
    expect(sep).toBeLessThan(0.01);
  });
});
