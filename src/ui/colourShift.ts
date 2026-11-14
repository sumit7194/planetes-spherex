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
const ZOOM = 12;

const MARK = {
  light: '#ffffff',
  neighbour: '#6fd3ff',
  target: '#ffb347',
};

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
  const [nx, ny] = at(p.neighbour);
  outline(() => {
    ctx.beginPath();
    ctx.arc(nx ?? 0, ny ?? 0, 6, 0, 2 * Math.PI);
  }, MARK.neighbour);
  const [tx, ty] = at(p.target);
  outline(() => {
    ctx.beginPath();
    ctx.moveTo(tx ?? 0, (ty ?? 0) - 7);
    ctx.lineTo((tx ?? 0) + 7, ty ?? 0);
    ctx.lineTo(tx ?? 0, (ty ?? 0) + 7);
    ctx.lineTo((tx ?? 0) - 7, ty ?? 0);
    ctx.closePath();
  }, MARK.target);
  const [lx, ly] = at(p.light);
  outline(() => {
    ctx.beginPath();
    ctx.moveTo((lx ?? 0) - 5, ly ?? 0);
    ctx.lineTo((lx ?? 0) + 5, ly ?? 0);
    ctx.moveTo(lx ?? 0, (ly ?? 0) - 5);
    ctx.lineTo(lx ?? 0, (ly ?? 0) + 5);
  }, MARK.light);
  return canvas;
}

export interface ColourShiftFigureInput {
  panels: [ColourPanel, ColourPanel];
  tiles: [Tile, Tile];
  labels: [string, string];
  alts: [string, string];
  key: { light: string; neighbour: string; target: string };
}

export function colourShiftFigure(f: ColourShiftFigureInput): HTMLElement {
  const glyph = (cls: string, text: string) =>
    h('span', { class: `cs-glyph ${cls}`, 'aria-hidden': 'true' }, text);
  return h(
    'div',
    { class: 'colour-shift' },
    ...([0, 1] as const).map((i) =>
      h(
        'figure',
        {},
        panelCanvas(f.tiles[i], f.panels[i], f.alts[i]),
        h('figcaption', {}, f.labels[i]),
      ),
    ),
    // The key sits beside the panels, one mark per line, so it costs no height.
    h(
      'ul',
      { class: 'cs-key' },
      h('li', {}, glyph('light', '+'), f.key.light),
      h('li', {}, glyph('neighbour', '○'), f.key.neighbour),
      h('li', {}, glyph('target', '◇'), f.key.target),
    ),
  );
}
