import { describe, expect, it } from 'vitest';
import type { KnownMover } from '../data/live/skybot';
import { marksAt, MAX_VMAG } from './movers';

const centre = { ra: 100, dec: 0 };
function mover(p: Partial<KnownMover>): KnownMover {
  return {
    name: 'Test',
    number: 1,
    kind: 'MB>Inner',
    ra: 100,
    dec: 0,
    vmag: 15,
    raRateArcsecH: 0,
    decRateArcsecH: 0,
    errArcsec: 0,
    ...p,
  };
}

describe('known movers on a photo', () => {
  it('places an object in pack pixels, east and north positive', () => {
    // 61.5″ east and north = 10 pixels each way at 6.15″.
    const [m] = marksAt([mover({ ra: 100 + 61.5 / 3600, dec: 61.5 / 3600 })], centre, 64, 6.15);
    expect(m?.east).toBeCloseTo(10, 6);
    expect(m?.north).toBeCloseTo(10, 6);
  });

  it('keeps only what is inside the field and bright enough to show', () => {
    const marks = marksAt(
      [
        mover({ name: 'in' }),
        mover({ name: 'faint', vmag: MAX_VMAG + 0.5 }),
        mover({ name: 'outside', ra: 100.2 }),
      ],
      centre,
      64,
      6.15,
    );
    expect(marks.map((m) => m.name)).toEqual(['in']);
  });

  it('marks near-Earth objects, whose positions are approximate', () => {
    const [m] = marksAt([mover({ kind: 'NEA>Apollo' })], centre, 64, 6.15);
    expect(m?.nearEarth).toBe(true);
  });
});
