import { describe, expect, it } from 'vitest';
import { TIME_EARLY, TIME_LATE, timeColourPixel } from './timeColour';

describe('colour by date', () => {
  it('the two colours add up to white, so a steady star is neutral', () => {
    expect(TIME_EARLY.map((v, k) => v + (TIME_LATE[k] ?? 0))).toEqual([255, 255, 255]);
    expect(timeColourPixel(1, 1)).toEqual([255, 255, 255]);
    expect(timeColourPixel(0.5, 0.5)).toEqual([128, 128, 128]);
  });
  it('only-then is blue, only-now is orange', () => {
    expect(timeColourPixel(1, 0)).toEqual([0, 115, 255]);
    expect(timeColourPixel(0, 1)).toEqual([255, 140, 0]);
  });
  it('masked in either look is no colour at all', () => {
    expect(timeColourPixel(null, 1)).toBeNull();
    expect(timeColourPixel(1, null)).toBeNull();
  });
});
