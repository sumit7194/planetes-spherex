import { describe, expect, it } from 'vitest';
import { wheelPixels } from './wheel';

describe('wheel movement in pixels', () => {
  it('passes pixels through', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800)).toEqual({ dx: 0, dy: 100 });
  });
  it('turns Firefox lines into pixels, so a notch zooms the same everywhere', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800).dy).toBe(48);
  });
  it('turns pages into the view height', () => {
    expect(wheelPixels({ deltaX: 1, deltaY: -1, deltaMode: 2 }, 800)).toEqual({
      dx: 800,
      dy: -800,
    });
  });
});
