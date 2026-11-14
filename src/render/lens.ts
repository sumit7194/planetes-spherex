/**
 * The lens: one pack tile drawn as square pixels, with overlays that stay put.
 *
 * Tiles are pre-rendered once with a shared stretch, so switching tiles (a "cut") is a
 * single drawImage: instant, no fades. Geometry is in pack pixels; the tile centre is the
 * target's position at the mean epoch, north up, east left.
 */

import type { Tile } from '../data/pack/load';
import { FlagMask } from '../data/pack/types';
import { type Stretch, toGrey } from './stretch';
import { readTheme, rgba, type Theme } from './theme';

export interface Shift {
  /** Toward the east, pack pixels (east is left on screen). */
  east: number;
  /** Toward the north, pack pixels (north is up). */
  north: number;
}

export interface LensOverlay {
  /** Fixed reference ring around the target, radius in pack pixels. */
  ringRadius: number;
  /** Measured shift from the first season to the second, drawn solid. */
  measured?: Shift | undefined;
  /** Predicted shift for the same photos, drawn dashed. */
  predicted?: Shift | undefined;
  /** Drawing scale of both arrows: 1 = true size. */
  arrowScale: number;
  /** Fraction of the measured arrow drawn so far (it grows with the cuts). */
  arrowProgress: number;
  /** Outline saturated pixels of the current tile. */
  outlineSaturated: boolean;
  /** Other flag bits to outline on request (rejected, source, outlier): outlined, never hidden. */
  extraFlags: number;
  /**
   * Catalogue sources to mark, per tile (in the same order as the tiles), as offsets from the
   * grid centre in pack pixels: Gaia as circles, CatWISE as squares. Catalogue, not SPHEREx.
   */
  catalogue: { east: number; north: number; kind: 'gaia' | 'catwise' }[][] | null;
  /**
   * Known asteroids and comets at each tile's own time (SkyBoT; predicted from their orbits, so
   * drawn in the predicted colour): offset from the grid centre in pack pixels, the direction
   * they move (any length; drawn as a short tick), and a name.
   */
  movers?: { east: number; north: number; dEast: number; dNorth: number; name: string }[][] | null;
  /** Ember ring for a measured move, mist for a show with nothing measured, blue for a look. */
  contract: 'show' | 'status' | 'look';
}

export class LensView {
  readonly canvas: HTMLCanvasElement;
  /** Ring, arrows and flag outlines in the theme's colours: gold or ember, blue or teal. */
  #t: Theme = readTheme();
  setTheme(t: Theme): void {
    this.#t = t;
    this.draw();
  }
  #ctx: CanvasRenderingContext2D;
  #tiles: { tile: Tile; image: HTMLCanvasElement }[] = [];
  #current = 0;
  #overlay: LensOverlay = {
    ringRadius: 3,
    arrowScale: 1,
    arrowProgress: 0,
    outlineSaturated: true,
    extraFlags: 0,
    catalogue: null,
    contract: 'show',
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.#ctx = ctx;
  }

  /** Pre-renders tiles with one shared stretch. */
  setTiles(tiles: Tile[], stretch: Stretch): void {
    this.#tiles = tiles.map((tile) => ({ tile, image: renderTile(tile, stretch) }));
    this.#current = 0;
    // Movers belong to the tiles they were placed on.
    this.#overlay = { ...this.#overlay, movers: null };
    this.draw();
  }

  /** Tiles drawn by their own renderer (a difference), not the shared stretch. */
  setRendered(entries: { tile: Tile; image: HTMLCanvasElement }[]): void {
    this.#tiles = entries;
    this.#current = 0;
    this.#overlay = { ...this.#overlay, movers: null };
    this.draw();
  }

  show(index: number): void {
    this.#current = index;
    this.draw();
  }

  setOverlay(patch: Partial<LensOverlay>): void {
    this.#overlay = { ...this.#overlay, ...patch };
    this.draw();
  }

  /** Screen pixels per pack pixel. */
  get scale(): number {
    const size = this.#tiles[0]?.tile.size ?? 40;
    return this.canvas.width / size;
  }

  draw(): void {
    const ctx = this.#ctx;
    const entry = this.#tiles[this.#current];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!entry) return;
    const { tile, image } = entry;
    const k = this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, tile.size * k, tile.size * k);

    const o = this.#overlay;
    const t = this.#t;
    if (o.outlineSaturated) outlineFlag(ctx, tile, FlagMask.saturated, k, t.flag);
    // Each extra flag in its own colour and dash, so overlaps stay readable.
    const extras: [number, string, number[]][] = [
      [FlagMask.rejected, t.mist, [k * 0.25, k * 0.2]],
      [FlagMask.source, t.predicted, []],
      [FlagMask.outlier, t.look, [k * 0.4, k * 0.15]],
    ];
    for (const [bit, colour, dash] of extras) {
      if (o.extraFlags & bit) outlineFlag(ctx, tile, bit, k, colour, dash);
    }

    const c = (tile.size / 2) * k;
    ctx.lineWidth = Math.max(1.5, k * 0.12);
    ctx.strokeStyle =
      o.contract === 'look' ? t.look : o.contract === 'status' ? rgba(t.mist, 0.7) : t.show;
    ctx.setLineDash(o.contract === 'status' ? [k * 0.35, k * 0.25] : []);
    ctx.beginPath();
    ctx.arc(c, c, o.ringRadius * k, 0, Math.PI * 2);
    ctx.stroke();

    const marks = o.catalogue?.[this.#current];
    if (marks) {
      ctx.lineWidth = Math.max(1, k * 0.07);
      ctx.setLineDash([]);
      for (const m of marks) {
        const x = c - m.east * k;
        const y = c - m.north * k;
        ctx.strokeStyle = m.kind === 'gaia' ? t.predicted : t.mist;
        ctx.beginPath();
        if (m.kind === 'gaia') ctx.arc(x, y, k * 0.7, 0, Math.PI * 2);
        else ctx.rect(x - k * 0.6, y - k * 0.6, k * 1.2, k * 1.2);
        ctx.stroke();
      }
    }

    const movers = o.movers?.[this.#current];
    if (movers?.length) drawMovers(ctx, c, k, movers, t.predicted, t.night);

    if (o.predicted) drawArrow(ctx, c, o.predicted, k * o.arrowScale, 1, t.predicted, true);
    if (o.measured) {
      drawArrow(ctx, c, o.measured, k * o.arrowScale, o.arrowProgress, t.measured, false);
      // An enlarged arrow says so on its tip: "×8", never a sentence under the lens.
      if (o.arrowScale > 1.05 && o.arrowProgress > 0.98) {
        const tipX = c - (o.measured.east * k * o.arrowScale) / 2;
        const tipY = c - (o.measured.north * k * o.arrowScale) / 2;
        const label = `×${Math.round(o.arrowScale)}`;
        const fs = Math.max(11, k * 0.9);
        ctx.font = `600 ${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'system-ui, sans-serif'}`;
        const w = ctx.measureText(label).width + fs;
        const h = fs * 1.5;
        const len = Math.hypot(o.measured.east, o.measured.north) || 1;
        // Just beyond the tip, along the arrow.
        const bx = tipX - (o.measured.east / len) * h * 0.9 - w / 2;
        const by = tipY - (o.measured.north / len) * h * 0.9 - h / 2;
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(t.night, 0.85);
        ctx.strokeStyle = rgba(t.mist, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, w, h, h / 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = t.starlight;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + w / 2, by + h / 2 + 0.5);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }
  }
}

function renderTile(tile: Tile, stretch: Stretch): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = tile.size;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(tile.size, tile.size);
  // Pack rows run south → north; canvas rows run top → bottom, so flip vertically.
  for (let row = 0; row < tile.size; row++) {
    for (let col = 0; col < tile.size; col++) {
      const v = tile.pixels[row * tile.size + col] ?? NaN;
      const g = toGrey(v, stretch);
      const at = ((tile.size - 1 - row) * tile.size + col) * 4;
      if (g === null) img.data.set([0x15, 0x1b, 0x3a, 255], at);
      else img.data.set([g, g, Math.min(255, g + 6), 255], at);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Traces the outer edges of flagged pixels, so flags read as outlines, never fills. */
function outlineFlag(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  bit: number,
  k: number,
  colour: string,
  dash: number[] = [],
) {
  const n = tile.size;
  const on = (row: number, col: number) =>
    row >= 0 && row < n && col >= 0 && col < n && ((tile.flags[row * n + col] ?? 0) & bit) !== 0;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, k * 0.08);
  ctx.setLineDash(dash);
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  };
  ctx.beginPath();
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!on(row, col)) continue;
      const x = col * k;
      const y = (n - 1 - row) * k;
      if (!on(row + 1, col)) edge(x, y, x + k, y);
      if (!on(row - 1, col)) edge(x, y + k, x + k, y + k);
      if (!on(row, col - 1)) edge(x, y, x, y + k);
      if (!on(row, col + 1)) edge(x + k, y, x + k, y + k);
    }
  }
  ctx.stroke();
}

/** An arrow centred on the target, from half a shift before to half a shift after. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  centre: number,
  s: Shift,
  pxPerUnit: number,
  progress: number,
  colour: string,
  dashed: boolean,
) {
  // East is left on screen and north is up.
  const dx = -s.east * pxPerUnit;
  const dy = -s.north * pxPerUnit;
  const x0 = centre - dx / 2;
  const y0 = centre - dy / 2;
  const x1 = x0 + dx * progress;
  const y1 = y0 + dy * progress;
  ctx.strokeStyle = ctx.fillStyle = colour;
  ctx.lineWidth = dashed ? 1.5 : 2.5;
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (dashed || len < 4) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const head = Math.min(10, len * 0.4);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
  ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

/** A diamond on each known asteroid, a tick along its motion, and its name beside it. */
function drawMovers(
  ctx: CanvasRenderingContext2D,
  c: number,
  k: number,
  movers: NonNullable<LensOverlay['movers']>[number],
  colour: string,
  night: string,
) {
  const r = Math.max(4, k * 0.8);
  const fs = Math.max(10, Math.min(13, k * 0.75));
  ctx.font = `500 ${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'system-ui, sans-serif'}`;
  ctx.setLineDash([]);
  for (const m of movers) {
    // East is left on screen and north is up.
    const x = c - m.east * k;
    const y = c - m.north * k;
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.25, k * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
    const len = Math.hypot(m.dEast, m.dNorth);
    if (len > 0) {
      const ux = -m.dEast / len;
      const uy = -m.dNorth / len;
      ctx.beginPath();
      ctx.moveTo(x + ux * r * 1.3, y + uy * r * 1.3);
      ctx.lineTo(x + ux * r * 2.6, y + uy * r * 2.6);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(night, 0.8);
    ctx.strokeText(m.name, x + r + 3, y - r - 2);
    ctx.fillStyle = colour;
    ctx.fillText(m.name, x + r + 3, y - r - 2);
  }
}
