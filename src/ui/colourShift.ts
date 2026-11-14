/**
 * "Light by colour": the same small patch in a short and a long colour, side by side, with the
 * light's centre (+), the neighbour's place (○) and the target's predicted place (◇) on each.
 * Shapes, not only colours, tell the marks apart. Each panel has its own stretch, since the
 * colours differ in brightness; the marks, not the greys, carry the result.
 */
import type { Tile } from '../data/pack/load';
import type { ColourPanel } from '../app/colourShift';
import { sharedStretch, toGrey } from '../render/stretch';
import { h } from './dom';

/** Pixels across each panel, and screen pixels per SPHEREx pixel. */
export const CROP = 9;
const ZOOM = 8;

/**
 * The app's own meanings (Viewer): starlight for the light, mist for a catalogue place, lilac for
 * a prediction. The sky's tokens, since the panels are always dark.
 */
function marks(): { light: string; neighbour: string; target: string } {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    light: v('--sky-starlight', '#eef1f8'),
    neighbour: v('--sky-mist', '#9aa3b8'),
    target: v('--sky-predicted', '#b7a8ff'),
  };
}

function panelCanvas(tile: Tile, p: ColourPanel, alt: string): HTMLCanvasElement {
  const n = tile.size;
  const c = n / 2 - 0.5;
  const x0 = Math.round(c - (CROP - 1) / 2);
  const y0 = x0;
  const yTop = y0 + CROP - 1;
  const crop: number[] = [];
  for (let y = y0; y <= yTop; y++)
    for (let x = x0; x < x0 + CROP; x++) crop.push(tile.pixels[y * n + x] ?? NaN);
  const stretch = sharedStretch([Float32Array.from(crop)], { floorP: 0.1, ceilingP: 1 });
  const canvas = h('canvas', {
    width: String(CROP * ZOOM),
    height: String(CROP * ZOOM),
    role: 'img',
    'aria-label': alt,
  }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  // North up: the top row of the canvas is the crop's highest y.
  for (let y = y0; y <= yTop; y++)
    for (let x = x0; x < x0 + CROP; x++) {
      const v = toGrey(tile.pixels[y * n + x] ?? NaN, stretch);
      ctx.fillStyle = v === null ? '#1a1e2c' : `rgb(${v} ${v} ${v})`;
      ctx.fillRect((x - x0) * ZOOM, (yTop - y) * ZOOM, ZOOM, ZOOM);
    }
  const at = (q: { x: number; y: number }) => [(q.x - x0 + 0.5) * ZOOM, (yTop - q.y + 0.5) * ZOOM];
  const outline = (draw: () => void, colour: string) => {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    draw();
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colour;
    draw();
    ctx.stroke();
  };
  const MARK = marks();
  const [nx, ny] = at(p.neighbour);
  outline(() => {
    ctx.beginPath();
    ctx.arc(nx ?? 0, ny ?? 0, 5, 0, 2 * Math.PI);
  }, MARK.neighbour);
  const [tx, ty] = at(p.target);
  outline(() => {
    ctx.beginPath();
    ctx.moveTo(tx ?? 0, (ty ?? 0) - 6);
    ctx.lineTo((tx ?? 0) + 6, ty ?? 0);
    ctx.lineTo(tx ?? 0, (ty ?? 0) + 6);
    ctx.lineTo((tx ?? 0) - 6, ty ?? 0);
    ctx.closePath();
  }, MARK.target);
  const [lx, ly] = at(p.light);
  outline(() => {
    ctx.beginPath();
    // A gap at the centre, so a "+" on top of the "○" leaves both readable (Viewer).
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.moveTo((lx ?? 0) + dx * 2, (ly ?? 0) + dy * 2);
      ctx.lineTo((lx ?? 0) + dx * 6, (ly ?? 0) + dy * 6);
    }
  }, MARK.light);
  return canvas;
}

export interface ColourShiftCell {
  panel: ColourPanel;
  tile: Tile;
  alt: string;
}

/**
 * Both looks, earlier above later (Physics: both, not the one with the bigger effect), the short
 * colour left and the long one right; the key in a column beside the grid.
 */
export interface ColourShiftFigureInput {
  /** Rows: one per look, each [short colour, long colour]. */
  rows: { label: string; cells: [ColourShiftCell, ColourShiftCell] }[];
  columns: [string, string];
  key: { light: string; neighbour: string; target: string };
  /** Text for the column beside the grid, under the key (it has room there). */
  aside: (Node | null)[];
}

export function colourShiftFigure(f: ColourShiftFigureInput): HTMLElement {
  const glyph = (cls: string, text: string) =>
    h('span', { class: `cs-glyph ${cls}`, 'aria-hidden': 'true' }, text);
  return h(
    'div',
    { class: 'colour-shift' },
    h(
      'div',
      { class: 'cs-grid' },
      h('span', {}),
      h('span', { class: 'cs-col' }, f.columns[0]),
      h('span', { class: 'cs-col' }, f.columns[1]),
      ...f.rows.flatMap((r) => [
        h('span', { class: 'cs-row' }, r.label),
        ...r.cells.map((c) => panelCanvas(c.tile, c.panel, c.alt)),
      ]),
    ),
    // The key and the caption sit beside the grid, so they cost no height.
    h(
      'div',
      { class: 'cs-side' },
      h(
        'ul',
        { class: 'cs-key' },
        h('li', {}, glyph('light', '+'), f.key.light),
        h('li', {}, glyph('neighbour', '○'), f.key.neighbour),
        h('li', {}, glyph('target', '◇'), f.key.target),
      ),
      ...f.aside,
    ),
  );
}
