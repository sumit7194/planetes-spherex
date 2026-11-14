/** The spectrum on the fly: every SPHEREx photo sees the target at its own wavelength (the
 * linear variable filter), so one quick aperture flux per photo, plotted against that photo's
 * wavelength, traces the spectrum. Coloured by pass, so changes between passes show. */

import type { Exposure, Pass } from './pack';
import { DETECTORS } from './pack';

export interface SpectrumOptions {
  showFlagged: boolean;
  passes: Pass[];
  hiddenPasses: Set<number>;
}

const W = 640;
const H = 300;
const M = { l: 58, r: 14, t: 14, b: 40 };

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

export function spectrumSvg(exps: Exposure[], o: SpectrumOptions): { svg: string; nGood: number; nFlagged: number } {
  const pts = exps.filter((e) => e.phot && !o.hiddenPasses.has(e.pass));
  const good = pts.filter((e) => !e.phot!.flagged);
  const flagged = pts.filter((e) => e.phot!.flagged);
  const shown = o.showFlagged ? pts : good;
  const ys = shown.map((e) => e.phot!.flux);
  let lo = Math.min(0, ...ys.map((v, i) => v - 0 * i));
  let hi = Math.max(1, ...ys);
  if (shown.length > 8) {
    // Robust range: ignore the most extreme 1% so one bad point can't flatten the plot.
    const s = [...ys].sort((a, b) => a - b);
    lo = Math.min(0, s[Math.floor(s.length * 0.01)]);
    hi = s[Math.ceil(s.length * 0.99) - 1] * 1.08;
  }
  if (hi <= lo) hi = lo + 1;
  const xmin = 0.7;
  const xmax = 5.05;
  const X = (l: number) => M.l + ((l - xmin) / (xmax - xmin)) * (W - M.l - M.r);
  const Y = (f: number) => H - M.b - ((f - lo) / (hi - lo)) * (H - M.t - M.b);
  const parts: string[] = [];
  // Detector bands as faint stripes, labelled.
  DETECTORS.forEach((d, i) => {
    parts.push(`<rect x="${X(d.lo)}" y="${M.t}" width="${X(d.hi) - X(d.lo)}" height="${H - M.t - M.b}" fill="currentColor" opacity="${i % 2 ? 0.04 : 0.08}"/>`);
    parts.push(`<text x="${(X(d.lo) + X(d.hi)) / 2}" y="${M.t + 12}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.55">D${d.det}</text>`);
  });
  // Axes and ticks.
  const ticks = niceTicks(lo, hi, 5);
  for (const t of ticks) {
    parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="currentColor" opacity="${t === 0 ? 0.45 : 0.12}"/>`);
    parts.push(`<text x="${M.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="currentColor" opacity="0.7">${fmt(t)}</text>`);
  }
  for (const l of [1, 2, 3, 4, 5]) {
    parts.push(`<text x="${X(l)}" y="${H - M.b + 16}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">${l}</text>`);
  }
  parts.push(`<text x="${(M.l + W - M.r) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">wavelength (micrometres)</text>`);
  parts.push(`<text transform="translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">brightness (µJy)</text>`);
  // Points.
  for (const e of shown) {
    const p = e.phot!;
    const col = `var(--pass-${e.pass % 4})`;
    const x = X(e.lam);
    const y = Y(Math.max(lo, Math.min(hi, p.flux)));
    const eh = Math.abs(Y(p.flux + p.err) - Y(p.flux));
    if (eh > 1.5 && eh < 60) parts.push(`<line x1="${x}" x2="${x}" y1="${y - eh}" y2="${y + eh}" stroke="${col}" opacity="0.35"/>`);
    if (p.flagged) {
      parts.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="var(--flag)" stroke-width="1"><title>${tip(e)}</title></circle>`);
    } else {
      parts.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="${col}"><title>${tip(e)}</title></circle>`);
    }
  }
  // A running median per pass, so the shape is readable through the scatter.
  for (const ps of o.passes) {
    if (o.hiddenPasses.has(ps.i)) continue;
    const g = good.filter((e) => e.pass === ps.i).sort((a, b) => a.lam - b.lam);
    if (g.length < 12) continue;
    const pathPts: string[] = [];
    const win = 0.08; // µm
    for (let l = xmin; l <= xmax; l += 0.02) {
      const near = g.filter((e) => Math.abs(e.lam - l) < win / 2 + l * 0.01);
      if (near.length >= 3) pathPts.push(`${X(l).toFixed(1)},${Y(median(near.map((e) => e.phot!.flux))).toFixed(1)}`);
      else if (pathPts.length) pathPts.push('M');
    }
    const d = pathPts.join(' ').split(' M').map((seg) => seg.trim()).filter((s) => s.split(' ').length > 1);
    for (const seg of d) parts.push(`<polyline points="${seg.replace(/^M\s*/, '')}" fill="none" stroke="var(--pass-${ps.i % 4})" stroke-width="2" opacity="0.9"/>`);
  }
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spectrum: brightness against wavelength, one point per photo">${parts.join('')}</svg>`;
  return { svg, nGood: good.length, nFlagged: flagged.length };
}

function tip(e: Exposure): string {
  const p = e.phot!;
  return `${e.lam.toFixed(3)} µm, ${p.flux.toFixed(0)} ± ${p.err.toFixed(0)} µJy, pass ${e.pass + 1}, D${e.det}, ${e.release}${p.flagged ? ` (flagged: ${p.flags.join(', ')})` : ''}`;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(a < 10 && a > 0 ? 1 : 0);
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}
