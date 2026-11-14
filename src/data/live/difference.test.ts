import { describe, expect, it } from 'vitest';

import { FlagMask } from '../pack/types';
import { differenceFilm, type FilmInput } from './difference';

const SIZE = 24;

/** A frame: a still star at (8, 8) whose brightness follows colour, plus an optional mover. */
function frame(mjd: number, lambdaUm: number, mover?: [number, number], flag = 0): FilmInput {
  const pixels = new Float32Array(SIZE * SIZE);
  const star = 100 * (lambdaUm / 1.0); // brighter at longer wavelengths
  const put = (cx: number, cy: number, amp: number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        pixels[y * SIZE + x] =
          (pixels[y * SIZE + x] ?? 0) + amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 2);
  };
  put(8, 8, star);
  if (mover) put(mover[0], mover[1], 50);
  const flags = new Uint8Array(SIZE * SIZE).fill(flag);
  return { tile: { id: `f${mjd}`, size: SIZE, pixels, flags }, mjd, lambdaUm };
}

describe('the difference film', () => {
  it('cancels a still star across colours and keeps a mover', () => {
    // Four passes ~90 days apart, three colours each; a mover crosses the field.
    const frames: FilmInput[] = [];
    let m = 0;
    for (let pass = 0; pass < 4; pass++)
      for (const lam of [1.0, 1.01, 1.02])
        frames.push(frame(60800 + pass * 90 + m++ * 0.1, lam, [4 + pass * 4, 18]));
    const film = differenceFilm(frames);
    for (const [i, d] of film.entries()) {
      expect(d.ok).toBe(true);
      expect(d.refCount).toBeGreaterThanOrEqual(3);
      expect(d.minGapDays).toBeGreaterThanOrEqual(30);
      const pass = Math.floor(i / 3);
      // The still star cancels (to a few % of its peak)...
      expect(Math.abs(d.pixels[8 * SIZE + 8] ?? NaN)).toBeLessThan(5);
      // ...and the mover stands out where it is now (softened: peak 50 -> ~37).
      expect(d.pixels[18 * SIZE + 4 + pass * 4] ?? NaN).toBeGreaterThan(30);
    }
  });

  it('refuses frames with too few other-date references, and blanks saturated pixels', () => {
    const frames = [
      frame(60800, 1.0),
      frame(60801, 1.0),
      frame(60900, 1.0, undefined, FlagMask.saturated),
    ];
    const film = differenceFilm(frames);
    expect(film.every((d) => !d.ok)).toBe(true); // at most 1 other-date reference each
    const more = [...frames, frame(61000, 1.0), frame(61100, 1.0), frame(61200, 1.0)];
    const film2 = differenceFilm(more);
    expect(film2[2]?.ok).toBe(true);
    expect(Number.isNaN(film2[2]?.pixels[0])).toBe(true); // saturated frame: blank
  });

  it('does not use photos far in colour', () => {
    const frames = [frame(60800, 1.0), frame(60900, 1.2), frame(61000, 1.25), frame(61100, 1.3)];
    expect(differenceFilm(frames)[0]?.ok).toBe(false);
  });
});
