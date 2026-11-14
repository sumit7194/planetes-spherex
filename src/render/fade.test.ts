import { describe, expect, it } from 'vitest';
import { fadedTile } from './fade';

const tile = (pixels: number[], flags: number[] = pixels.map(() => 0)) => ({
  id: 't',
  size: 2,
  pixels: new Float32Array(pixels),
  flags: new Uint8Array(flags),
});

describe('fade between the looks', () => {
  it('keeps a steady pixel at full value all the way across', () => {
    for (const t of [0, 0.3, 0.5, 1])
      expect(fadedTile(tile([7, 7, 7, 7]), tile([7, 7, 7, 7]), t).pixels[0]).toBeCloseTo(7, 5);
  });
  it('moves a mover: one place dims as the other brightens', () => {
    const f = fadedTile(tile([10, 0, 0, 0]), tile([0, 10, 0, 0]), 0.25);
    expect(f.pixels[0]).toBeCloseTo(7.5, 5);
    expect(f.pixels[1]).toBeCloseTo(2.5, 5);
  });
  it('keeps a pixel missing in either look missing, and both looks’ flags', () => {
    const f = fadedTile(
      tile([Number.NaN, 1, 1, 1], [0, 1, 0, 0]),
      tile([1, 1, 1, 1], [0, 2, 0, 0]),
      0.5,
    );
    expect(Number.isNaN(f.pixels[0])).toBe(true);
    expect(f.flags[1]).toBe(3);
  });
  it('clamps t to the two looks', () => {
    expect(fadedTile(tile([0, 0, 0, 0]), tile([4, 4, 4, 4]), 2).pixels[0]).toBe(4);
  });
});
