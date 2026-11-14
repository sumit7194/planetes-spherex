import { describe, expect, it } from 'vitest';
import { parseSkybot } from './skybot';

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
