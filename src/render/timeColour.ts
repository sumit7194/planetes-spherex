/**
 * Colour by date (E3; Viewer's design, 15 Nov): the two looks the page compares, as one picture.
 * The earlier look is drawn in blue, the later in orange; the two add up to white, so a star that
 * didn't move comes out white and one that moved shows a blue copy (then) and an orange copy
 * (now). A colour-blind-safe pair, used only inside this picture with its own key. Pixels masked
 * or saturated in either look are hatched (the difference view's convention), never coloured: a
 * saturated core in one look only would otherwise read as a mover.
 */
import { FlagMask } from '../data/pack/types';
import type { Tile } from '../data/pack/load';
import { toGrey, type Stretch } from './stretch';

/** Blue then orange: (0,115,255) + (255,140,0) = (255,255,255). */
export const TIME_EARLY: readonly [number, number, number] = [0, 115, 255];
export const TIME_LATE: readonly [number, number, number] = [255, 140, 0];

/** Screen pixels per data pixel, as the difference view draws them (room for the hatch). */
const BLOCK = 4;

/** One pixel's colour from the two looks' stretched brightness (0–1); null where masked. */
export function timeColourPixel(
  early: number | null,
  late: number | null,
): [number, number, number] | null {
  if (early === null || late === null) return null;
  return [0, 1, 2].map((k) =>
    Math.min(255, Math.round(early * (TIME_EARLY[k] ?? 0) + late * (TIME_LATE[k] ?? 0))),
  ) as [number, number, number];
}

const MASK = FlagMask.saturated | FlagMask.rejected;

export function renderTimeColour(early: Tile, late: Tile, s: Stretch): HTMLCanvasElement {
  const n = early.size;
  const c = document.createElement('canvas');
  c.width = c.height = n * BLOCK;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(n * BLOCK, n * BLOCK);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const k = row * n + col;
      const masked = ((early.flags[k] ?? 0) | (late.flags[k] ?? 0)) & MASK;
      const a = toGrey(early.pixels[k] ?? NaN, s);
      const b = toGrey(late.pixels[k] ?? NaN, s);
      const fill = masked || a === null || b === null ? null : timeColourPixel(a / 255, b / 255);
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          // Masked: dark, with one diagonal stripe per pixel (hatched, never a value).
          const rgb = fill ?? ((dx + dy) % BLOCK === 0 ? [120, 128, 150] : [22, 26, 40]);
          const at = (((n - 1 - row) * BLOCK + dy) * n * BLOCK + col * BLOCK + dx) * 4;
          img.data.set([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255], at);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
