/** Turning SPHEREx pixel arrays into pictures, and drawing overlays on them. */

import { type Stretch, toGrey } from './stretch';

const MASKED = [85, 89, 106]; // neutral grey: masked (saturated or flagged), never a data colour

/** Grey picture of one image on a fixed stretch (the same stretch for every frame of a blink). */
export function greyImage(img: Float32Array, n: number, s: Stretch, invert = false): ImageData {
  const out = new ImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = img[y * n + x];
      const o = ((n - 1 - y) * n + x) * 4; // north up: grid row 0 is the bottom
      const t = toGrey(v, s);
      if (t === null) {
        out.data[o] = MASKED[0];
        out.data[o + 1] = MASKED[1];
        out.data[o + 2] = MASKED[2];
        out.data[o + 3] = 255;
        continue;
      }
      const g = invert ? 255 - t : t;
      out.data[o] = g;
      out.data[o + 1] = g;
      out.data[o + 2] = g;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

const COOL = [92, 150, 245];
const WARM = [240, 190, 80];
const MID = [20, 24, 38];

/** Difference (b − a) in units of the combined noise, on a fixed ±limit σ scale. */
export function diffImage(a: Float32Array, b: Float32Array, sigma: number, n: number, limit = 5): ImageData {
  const out = new ImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const o = ((n - 1 - y) * n + x) * 4;
      const d = b[i] - a[i];
      let c = MASKED;
      if (Number.isFinite(d)) {
        const t = Math.max(-1, Math.min(1, d / sigma / limit));
        const end = t >= 0 ? WARM : COOL;
        const u = Math.abs(t) ** 0.8;
        c = [0, 1, 2].map((j) => Math.round(MID[j] + (end[j] - MID[j]) * u));
      }
      out.data[o] = c[0];
      out.data[o + 1] = c[1];
      out.data[o + 2] = c[2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

export function diffLegendGradient(): string {
  const c = (a: number[]) => `rgb(${a.join(',')})`;
  return `linear-gradient(to right, ${c(COOL)}, ${c(MID)}, ${c(WARM)})`;
}

/** Maps grid pixel coordinates (0-based, y north) to canvas coordinates for a cropped view. */
export class View {
  constructor(
    public n: number, // grid size
    public m: number, // crop size (pixels shown)
    public W: number, // canvas size (device pixels)
  ) {}
  get x0() {
    return (this.n - this.m) / 2;
  }
  get S() {
    return this.W / this.m;
  }
  X(x: number) {
    return (x - this.x0 + 0.5) * this.S;
  }
  Y(y: number) {
    return (this.x0 + this.m - 1 - y + 0.5) * this.S;
  }
  /** Canvas → grid pixel. */
  gx(X: number) {
    return X / this.S - 0.5 + this.x0;
  }
  gy(Y: number) {
    return this.x0 + this.m - 1 - (Y / this.S - 0.5);
  }
}

const scratch = document.createElement('canvas');

/** Draw an n×n ImageData onto ctx, cropped to the view, with hard pixel edges. */
export function blit(ctx: CanvasRenderingContext2D, im: ImageData, v: View) {
  scratch.width = im.width;
  scratch.height = im.height;
  scratch.getContext('2d')!.putImageData(im, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const src = v.x0;
  ctx.drawImage(scratch, src, src, v.m, v.m, 0, 0, v.W, v.W);
}

/** Outline pixels where most photos in the stack flagged saturation (red outlines, never fills). */
export function drawSaturation(ctx: CanvasRenderingContext2D, sat: Uint8Array, n: number, v: View, color: string) {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && sat[y * n + x] >= 128;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, v.S / 10);
  ctx.beginPath();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!on(x, y)) continue;
      const L = v.X(x) - v.S / 2;
      const R = v.X(x) + v.S / 2;
      const T = v.Y(y) - v.S / 2;
      const B = v.Y(y) + v.S / 2;
      if (!on(x - 1, y)) { ctx.moveTo(L, T); ctx.lineTo(L, B); }
      if (!on(x + 1, y)) { ctx.moveTo(R, T); ctx.lineTo(R, B); }
      if (!on(x, y + 1)) { ctx.moveTo(L, T); ctx.lineTo(R, T); }
      if (!on(x, y - 1)) { ctx.moveTo(L, B); ctx.lineTo(R, B); }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Scale bar (bottom centre) and compass (top centre), both inside the round lens. */
export function drawScale(ctx: CanvasRenderingContext2D, v: View, pixArcsec: number, dpr: number) {
  const fovArcsec = v.m * pixArcsec;
  const choices = [10, 30, 60, 120, 300];
  const len = choices.find((c) => c >= fovArcsec / 5) ?? 300;
  const L = (len / pixArcsec) * v.S;
  const x = v.W / 2 - L / 2;
  const y = v.W * 0.9;
  ctx.save();
  ctx.strokeStyle = 'rgba(239,232,221,0.85)';
  ctx.fillStyle = 'rgba(239,232,221,0.85)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.shadowColor = 'rgba(12,17,32,0.9)';
  ctx.shadowBlur = 4 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + L, y);
  ctx.moveTo(x, y - 4 * dpr);
  ctx.lineTo(x, y + 4 * dpr);
  ctx.moveTo(x + L, y - 4 * dpr);
  ctx.lineTo(x + L, y + 4 * dpr);
  ctx.stroke();
  ctx.font = `${12 * dpr}px 'Source Sans 3 Variable', sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(len >= 60 ? `${len / 60}′` : `${len}″`, v.W / 2, y + 17 * dpr);
  // One SPHEREx pixel, for scale, left of the bar.
  const px = v.S;
  ctx.strokeRect(x - px - 12 * dpr, y - px / 2, px, px);
  ctx.textAlign = 'right';
  ctx.fillText('1 pixel', x - px - 18 * dpr, y + 4 * dpr);
  // Compass: north up, east left (as the sky looks from below).
  const cx = v.W / 2;
  const cy = v.W * 0.1;
  ctx.textAlign = 'center';
  ctx.beginPath();
  ctx.moveTo(cx, cy + 10 * dpr);
  ctx.lineTo(cx, cy - 8 * dpr);
  ctx.moveTo(cx, cy + 10 * dpr);
  ctx.lineTo(cx - 18 * dpr, cy + 10 * dpr);
  ctx.stroke();
  ctx.fillText('N', cx, cy - 12 * dpr);
  ctx.textAlign = 'right';
  ctx.fillText('E', cx - 22 * dpr, cy + 14 * dpr);
  ctx.restore();
}

export function ring(ctx: CanvasRenderingContext2D, X: number, Y: number, r: number, color: string, dash: number[] = [], width = 1.5) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(X, Y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function cross(ctx: CanvasRenderingContext2D, X: number, Y: number, r: number, color: string, width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(X - r, Y);
  ctx.lineTo(X + r, Y);
  ctx.moveTo(X, Y - r);
  ctx.lineTo(X, Y + r);
  ctx.stroke();
  ctx.restore();
}

export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#fff';
}
