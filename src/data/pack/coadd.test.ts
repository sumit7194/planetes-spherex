import { describe, expect, it } from 'vitest';
import { coadd } from './coadd';

const tile = (id: string, pixels: number[], flags: number[]) => ({
  id,
  size: 2,
  pixels: new Float32Array(pixels),
  flags: new Uint8Array(flags),
});

describe('adding photos together', () => {
  it('averages pixel by pixel, skipping squares a photo does not cover', () => {
    const t = coadd('sum', [
      tile('a', [1, 2, NaN, 4], [0, 1, 0, 0]),
      tile('b', [3, 4, 5, NaN], [2, 0, 0, 0]),
    ]);
    expect(Array.from(t.pixels)).toEqual([2, 3, 5, 4]);
    expect(Array.from(t.flags)).toEqual([2, 1, 0, 0]);
  });

  it('leaves a square no photo covers empty, never invented', () => {
    const t = coadd('sum', [tile('a', [NaN, 1, 1, 1], [0, 0, 0, 0])]);
    expect(t.pixels[0]).toBeNaN();
  });
});
