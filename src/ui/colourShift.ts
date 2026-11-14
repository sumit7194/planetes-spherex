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
  // Backed at the screen's pixel density, so the marks' thin strokes stay sharp (Viewer).
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const canvas = h('canvas', {
    width: String(CROP * ZOOM * dpr),
    height: String(CROP * ZOOM * dpr),
    role: 'img',
    'aria-label': alt,
  }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
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

/**
 * The ratio's colour: log2(long ÷ short) from −2 to +2, in the app's own wavelength colours
 * (Viewer): the short end's pale yellow-green for more 1.1–1.6 µm light, the long end's teal for
 * more 4.4–5 µm light, neutral grey for equal. Never red: red means "flagged" here.
 */
export const RATIO_SHORT: [number, number, number] = [227, 237, 165];
export const RATIO_EQUAL: [number, number, number] = [92, 97, 110];
export const RATIO_LONG: [number, number, number] = [47, 143, 134];
export function ratioColour(r: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (Math.log2(r) + 2) / 4));
  const lo = RATIO_SHORT;
  const mid = RATIO_EQUAL;
  const hi = RATIO_LONG;
  const [a, b, u] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, (t - 0.5) * 2];
  return [0, 1, 2].map((k) => Math.round((a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u)) as [
    number,
    number,
    number,
  ];
}

/**
 * One look's colour-ratio map (N2): the whole field, masked pixels hatched (never a colour), a
 * ring on the field's reddest real source and a diamond on the target's predicted place.
 */
export function ratioCanvas(
  ratio: { size: number; ratio: Float32Array },
  marks: { reddest?: { x: number; y: number }; target?: { x: number; y: number } },
  alt: string,
  zoom = 2.2,
  crop = 40,
): HTMLCanvasElement {
  // The central `crop` pixels (Viewer: the whole field made sources dots); the field's reddest
  // source must lie inside it.
  const full = ratio.size;
  const c0 = Math.round(full / 2 - crop / 2);
  const n = crop;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const side = Math.round(n * zoom);
  const canvas = h('canvas', {
    width: String(side * dpr),
    height: String(side * dpr),
    role: 'img',
    'aria-label': alt,
    class: 'cs-ratio',
  }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = ratio.ratio[(y + c0) * full + (x + c0)] ?? NaN;
      const px = x * zoom;
      const py = (n - 1 - y) * zoom; // north up
      if (Number.isFinite(v) && v > 0) {
        const [r, g, b] = ratioColour(v);
        ctx.fillStyle = `rgb(${r} ${g} ${b})`;
        // Masked: a quiet hatch, so the few real sources stand out (Viewer).
      } else ctx.fillStyle = (x + y) % 3 === 0 ? '#20253a' : '#161a28';
      ctx.fillRect(px, py, zoom + 0.5, zoom + 0.5);
    }
  const M = marks;
  const at = (q: { x: number; y: number }) => [
    (q.x - c0 + 0.5) * zoom,
    (n - 1 - (q.y - c0) + 0.5) * zoom,
  ];
  const stroke = (draw: () => void, colour: string) => {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    draw();
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colour;
    draw();
    ctx.stroke();
  };
  const css = getComputedStyle(document.documentElement);
  const tok = (v: string, f: string) => css.getPropertyValue(v).trim() || f;
  if (M.reddest) {
    const [x, y] = at(M.reddest);
    stroke(
      () => {
        ctx.beginPath();
        ctx.arc(x ?? 0, y ?? 0, 9, 0, 2 * Math.PI);
      },
      tok('--sky-starlight', '#eef1f8'),
    );
  }
  if (M.target) {
    const [x, y] = at(M.target);
    stroke(
      () => {
        ctx.beginPath();
        ctx.moveTo(x ?? 0, (y ?? 0) - 7);
        ctx.lineTo((x ?? 0) + 7, y ?? 0);
        ctx.lineTo(x ?? 0, (y ?? 0) + 7);
        ctx.lineTo((x ?? 0) - 7, y ?? 0);
        ctx.closePath();
      },
      tok('--sky-predicted', '#b7a8ff'),
    );
  }
  return canvas;
}
