/**
 * Small, honest figures: thumbnails of real stacks, the labelled time ribbon, the "how sure"
 * number line and the colour windows. Each one draws data from a pack and nothing else.
 */

import { copy } from '../copy/en';
import type { LoadedPack, Tile } from '../data/pack/load';
import { type Stretch, toGrey } from '../render/stretch';
import { h } from './dom';
import { monthYear } from './numbers';

const SVG = 'http://www.w3.org/2000/svg';
export const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** A real stack as a small square picture (north up, east left). */
export function thumbnail(
  tile: Tile,
  stretch: Stretch,
  cssPx: number,
  label: string,
): HTMLCanvasElement {
  const c = h('canvas', {
    class: 'thumb',
    width: tile.size,
    height: tile.size,
    role: 'img',
    'aria-label': label,
  });
  c.style.width = c.style.height = `${cssPx}px`;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(tile.size, tile.size);
  for (let row = 0; row < tile.size; row++) {
    for (let col = 0; col < tile.size; col++) {
      const g = toGrey(tile.pixels[row * tile.size + col] ?? NaN, stretch) ?? 20;
      img.data.set(
        [g, g, Math.min(255, g + 6), 255],
        ((tile.size - 1 - row) * tile.size + col) * 4,
      );
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** A colour for a wavelength: pale cream at 0.75 µm through green to deep teal at 5 µm. */
export function wavelengthColour(um: number): string {
  // One ordered ramp rather than a rainbow (rainbows aren't perceptually even and mislead
  // colour-blind readers), falling in lightness from SPHEREx's shortest wavelength to its
  // longest. Round 3: it keeps clear of every hue that carries meaning here (ember for
  // measured, red for flags, blue for a look, lilac for predicted). Spaced by log wavelength,
  // so the six detectors spread evenly.
  const t = Math.max(0, Math.min(1, Math.log(um / 0.75) / Math.log(5 / 0.75)));
  const at = t * (WAVELENGTH_RAMP.length - 1);
  const i = Math.min(WAVELENGTH_RAMP.length - 2, Math.floor(at));
  const f = at - i;
  const a = WAVELENGTH_RAMP[i] ?? [255, 255, 255];
  const b = WAVELENGTH_RAMP[i + 1] ?? a;
  const c = a.map((v, k) => Math.round(v + ((b[k] ?? v) - v) * f));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
export const WAVELENGTH_RAMP: [number, number, number][] = [
  [247, 244, 200],
  [206, 232, 150],
  [150, 212, 128],
  [88, 184, 136],
  [44, 150, 140],
];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * Every photo of this spot as one dot, placed by date (across) and by colour (up, 0.75 µm at
 * the bottom to 5 µm at the top), in that colour (round 3, from X). Brackets 1 and 2 mark the
 * two compared looks, numbered as in the lens; the look on screen is the brighter bracket.
 * The count sits in front as a number, not a sentence; the sentence stays for screen readers.
 */
export function ribbon(
  pack: LoadedPack,
  compared: [number, number],
  showing: number | null,
  watch?: { detector: number; current: string | null },
): HTMLElement {
  return photoDots(pack.manifest.frames, compared, showing, pack.manifest.target.id, watch);
}

/** A photo as the dock draws it: when, in which colour, in which look, on which detector. */
export interface DotPhoto {
  id: string;
  mjd: number;
  lambdaUm: number;
  season: number;
  detector: number;
}

/**
 * The dock's dots for any set of photos: a pack's (its count tagged for the checker), a live
 * look's, or a Watch series (its colour range lit, the photo on screen ringed).
 */
export function photoDots(
  frames: DotPhoto[],
  compared: [number, number],
  showing: number | null,
  claimPack: string | null,
  watch?: { detector: number; current: string | null },
  /** What the count means, when it isn't every photo (a live look dots only those it checked). */
  countLabel: string = copy.ribbon.photos,
): HTMLElement {
  const mjds = frames.map((f) => f.mjd);
  const lo = Math.min(...mjds);
  const hi = Math.max(...mjds);
  const x = (mjd: number) => 10 + ((mjd - lo) / Math.max(1, hi - lo)) * 980;
  const L0 = Math.log(0.75);
  const L1 = Math.log(5);
  const y = (um: number) => 6 + (1 - (Math.log(um) - L0) / (L1 - L0)) * 38;
  const s = svg('svg', {
    viewBox: '0 0 1000 64',
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': copy.look.found(frames.length, monthYear(lo), monthYear(hi)),
  });

  const bySeason = new Map<number, DotPhoto[]>();
  for (const f of frames) bySeason.set(f.season, [...(bySeason.get(f.season) ?? []), f]);
  const seasons = [...bySeason.keys()].sort((a, b) => a - b);

  compared.forEach((season, i) => {
    const fs = bySeason.get(season) ?? [];
    if (!fs.length) return;
    const a = x(Math.min(...fs.map((f) => f.mjd)));
    const b = x(Math.max(...fs.map((f) => f.mjd)));
    const on = season === showing;
    s.append(
      svg('path', {
        d: `M${a - 3} 48 V53 H${b + 3} V48`,
        class: on ? 'rb-bracket on' : 'rb-bracket',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    s.append(
      Object.assign(
        svg('text', {
          x: (a + b) / 2,
          y: 63,
          class: on ? 'rb-num on' : 'rb-num',
          'text-anchor': 'middle',
        }),
        { textContent: String(i + 1) },
      ),
    );
  });
  for (const f of frames) {
    const inBand = !watch || f.detector === watch.detector;
    s.append(
      svg('rect', {
        x: x(f.mjd) - 1.5,
        y: y(f.lambdaUm) - 1.5,
        width: 3,
        height: 3,
        rx: 1.5,
        fill: wavelengthColour(f.lambdaUm),
        opacity: inBand ? 1 : 0.25,
      }),
    );
    if (watch?.current === f.id)
      s.append(
        svg('rect', {
          x: x(f.mjd) - 5,
          y: y(f.lambdaUm) - 5,
          width: 10,
          height: 10,
          rx: 5,
          class: 'rb-current',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
  }
  let gap = { a: 0, b: 0 };
  for (let i = 1; i < seasons.length; i++) {
    const prev = bySeason.get(seasons[i - 1] ?? 0) ?? [];
    const next = bySeason.get(seasons[i] ?? 0) ?? [];
    const a = Math.max(...prev.map((f) => f.mjd));
    const b = Math.min(...next.map((f) => f.mjd));
    if (b - a > gap.b - gap.a) gap = { a, b };
  }
  const labels = h('div', { class: 'ribbon-labels' }, h('span', {}, monthYear(lo)));
  if (gap.b > gap.a) {
    const mid = (x(gap.a) + x(gap.b)) / 2 / 10;
    labels.append(h('span', { class: 'gap', style: `left:${mid}%` }, copy.ribbon.gap));
  }
  labels.append(h('span', {}, monthYear(hi)));
  return h(
    'div',
    { class: 'ribbon-figure' },
    h(
      'p',
      { class: 'ribbon-count' },
      // The photo count, tagged for Physics' claims checker (count:frames of this pack).
      claimPack
        ? h(
            'b',
            { 'data-claim': `${claimPack}/`, 'data-claim-kind': 'count:frames' },
            String(frames.length),
          )
        : h('b', {}, frames.length.toLocaleString('en-GB')),
      h('span', {}, countLabel),
    ),
    h(
      'div',
      { class: 'ribbon-plot' },
      h(
        'span',
        { class: 'rb-axis', 'aria-hidden': 'true' },
        h('span', {}, '5 µm'),
        h('span', {}, '0.75'),
      ),
      h('div', {}, s as unknown as Node, labels),
    ),
  );
}

/**
 * The number line (round 3): the measured move as a filled mark with its error bar, the
 * catalogue's prediction as an open diamond, and the steady stars' band, on one axis read in
 * pixels above and arcseconds below. The numbers themselves sit in an HTML legend under it,
 * so each stays a separate, checkable element.
 */
export function howSure(
  measured: number,
  error: number,
  predicted: number | null,
  wobble: number | null,
  arcsecPerPx: number,
  legend: Node[],
): HTMLElement {
  const max = Math.max(measured + 3 * error, predicted ?? 0, wobble ?? 0) * 1.15;
  const W = 360;
  const PAD = 14;
  const x = (v: number) => PAD + (v / max) * (W - 2 * PAD);
  const s = svg('svg', {
    viewBox: `0 0 ${W} 62`,
    class: 'number-line',
    role: 'img',
    'aria-label': `${copy.evidence.howSure}: ${measured.toFixed(2)} ± ${error.toFixed(2)} pixels`,
  });
  const text = (tx: number, ty: number, t: string, cls: string, anchor = 'middle') =>
    Object.assign(svg('text', { x: tx, y: ty, class: cls, 'text-anchor': anchor }), {
      textContent: t,
    });
  if (wobble !== null)
    s.append(
      svg('rect', { x: x(0), y: 18, width: x(wobble) - x(0), height: 18, class: 'nl-band' }),
    );
  s.append(svg('line', { x1: PAD, y1: 27, x2: W - PAD, y2: 27, class: 'nl-axis' }));
  // Pixels above the axis' ticks, arcseconds below: one picture, two units.
  const pxStep = max <= 2.4 ? 0.5 : 1;
  const lastPx = Math.floor(max / pxStep + 1e-9) * pxStep;
  for (let v = 0; v <= max + 1e-9; v += pxStep) {
    s.append(svg('line', { x1: x(v), y1: 24, x2: x(v), y2: 30, class: 'nl-axis' }));
    // The unit rides on the last tick's label, so it never sits on top of a number.
    const label = v === 0 ? '0' : `${Number(v.toFixed(1))}`;
    s.append(text(x(v), 44, Math.abs(v - lastPx) < 1e-9 && v > 0 ? `${label} px` : label, 'nl-px'));
  }
  const maxArcsec = max * arcsecPerPx;
  const asStep = maxArcsec <= 9 ? 2 : maxArcsec <= 15 ? 3 : 5;
  for (let a = 0; a <= maxArcsec + 1e-9; a += asStep) {
    s.append(text(x(a / arcsecPerPx), 58, `${a}″`, 'nl-arcsec'));
  }
  s.append(
    svg('line', {
      x1: x(Math.max(0, measured - error)),
      y1: 27,
      x2: x(measured + error),
      y2: 27,
      class: 'nl-error',
    }),
  );
  if (predicted !== null) {
    const p = x(predicted);
    s.append(svg('path', { d: `M${p} 20 L${p + 7} 27 L${p} 34 L${p - 7} 27 Z`, class: 'nl-pred' }));
  }
  s.append(svg('circle', { cx: x(measured), cy: 27, r: 5.5, class: 'nl-measured' }));
  return h(
    'figure',
    { class: 'how-sure' },
    s as unknown as Node,
    h('p', { class: 'legend' }, ...legend),
  );
}

/** The six colour windows with how many photos of this spot each holds (Watch only). */
export function colourWindows(
  pack: LoadedPack,
  onPlay?: (detector: number) => void,
  playing: number | null = null,
): HTMLElement {
  const ranges: [number, number][] = [
    [0.75, 1.1],
    [1.1, 1.6],
    [1.6, 2.4],
    [2.4, 3.8],
    [3.8, 4.4],
    [4.4, 5.0],
  ];
  const counts = [1, 2, 3, 4, 5, 6].map(
    (d) => pack.manifest.frames.filter((f) => f.detector === d).length,
  );
  const most = Math.max(1, ...counts);
  return h(
    'figure',
    { class: 'windows' },
    h('figcaption', {}, copy.watch.windowsHeading),
    onPlay ? h('p', { class: 'hint small' }, copy.watch.playHint) : null,
    h(
      'ol',
      {},
      ...ranges.map(([a, b], i) => {
        // Each window plays every photo taken in that colour range, in date order.
        const row = h(
          'button',
          {
            type: 'button',
            class: 'window',
            'aria-pressed': String(playing === i + 1),
            disabled: !onPlay || (counts[i] ?? 0) < 2,
          },
          // A bar per colour range, as tall as its photo count: the picker is the histogram.
          h(
            'span',
            { class: 'bar', 'aria-hidden': 'true' },
            h('span', { style: `height:${(((counts[i] ?? 0) / most) * 100).toFixed(0)}%` }),
          ),
          h('span', { class: 'count' }, String(counts[i] ?? 0)),
          h('span', { class: 'range', 'aria-label': copy.watch.range(a, b) }, `${a}–${b}`),
        );
        row.addEventListener('click', () => onPlay?.(i + 1));
        return h('li', { style: `--c:${wavelengthColour((a + b) / 2)}` }, row);
      }),
    ),
  );
}

export { mean };

/** One photo's measurement: [wavelength µm, flux µJy, σ µJy, detector, season] (Physics). */
export type SpectrumPoint = [number, number, number, number, number];

/**
 * A spectrum, photo by photo: each dot is one SPHEREx photo at its own wavelength, coloured by
 * that wavelength on the infrared ramp, with its error bar. Brightness in millijanskys.
 */
/** A wavelength bin of a faint spectrum: mean wavelength, weighted flux and its error (µJy). */
export type SpectrumBin = [number, number, number, number];

/**
 * Averages a faint spectrum in wavelength: per detector, by wavelength, in runs of about `per`
 * photos (a short last run joins the one before), each the inverse-variance mean. About √per
 * better signal-to-noise than one photo. Returns [λ, flux, error, detector], by wavelength.
 */
export function binSpectrum(points: SpectrumPoint[], per = 10): SpectrumBin[] {
  const out: SpectrumBin[] = [];
  for (let d = 1; d <= 6; d++) {
    const own = points.filter((p) => p[3] === d && p[2] > 0).sort((a, b) => a[0] - b[0]);
    const runs: SpectrumPoint[][] = [];
    for (let i = 0; i < own.length; i += per) runs.push(own.slice(i, i + per));
    const last = runs[runs.length - 1];
    if (runs.length > 1 && last && last.length < per / 2)
      runs[runs.length - 2]?.push(...(runs.pop() ?? []));
    for (const run of runs) {
      let w = 0;
      let um = 0;
      let flux = 0;
      for (const [l, f, e] of run) {
        const wi = 1 / (e * e);
        w += wi;
        um += l * wi;
        flux += f * wi;
      }
      if (w > 0) out.push([um / w, flux / w, 1 / Math.sqrt(w), d]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** A round step (1, 2 or 5 × a power of ten) giving about four gridlines up to `max`. */
export function niceStep(max: number): number {
  if (!(max > 0)) return 1;
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function spectrumFigure(
  points: SpectrumPoint[],
  labels: { x: string; y: string },
  /** Photos that aren't measurements (a flag touches the aperture): hollow, never joined in. */
  hollow: SpectrumPoint[] = [],
  /** A faint spectrum's shape: drawn as a line through these bins, the single photos faint. */
  bins: SpectrumBin[] | null = null,
): SVGSVGElement {
  const W = 440;
  const H = 210;
  const L = 44;
  const R = 10;
  const T = 10;
  const B = 36;
  const xMin = 0.7;
  const xMax = 5.05;
  // The scale fits the measured points (hollow ones may run off it): ~4 round gridlines.
  // A shape-only spectrum is scaled to its bins: single faint photos may run off the top.
  const top = bins
    ? Math.max(...bins.map((b) => (b[1] + b[2]) / 1000), 1e-3)
    : Math.max(...points.map((p) => (p[1] + p[2]) / 1000), 1e-3);
  const step = niceStep(top);
  const yMax = Math.ceil(top / step) * step;
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const x = (um: number) => L + ((um - xMin) / (xMax - xMin)) * (W - L - R);
  const y = (mJy: number) => T + (1 - Math.max(0, mJy) / yMax) * (H - T - B);
  const s = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'spectrum',
    role: 'img',
    'aria-label': `${labels.y} against ${labels.x}`,
  });
  for (let um = 1; um <= 5; um++) {
    s.append(svg('line', { x1: x(um), x2: x(um), y1: T, y2: H - B, class: 'grid' }));
    const t = svg('text', { x: x(um), y: H - B + 16, 'text-anchor': 'middle' });
    t.textContent = String(um);
    s.append(t);
  }
  for (let k = 0; k * step <= yMax + step / 1e6; k++) {
    const v = k * step;
    s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = v.toFixed(digits);
    s.append(t);
  }
  for (const [um, uJy] of hollow) {
    const v = Math.min(uJy / 1000, yMax);
    s.append(
      svg('circle', {
        cx: x(um),
        cy: y(v),
        r: 2.4,
        fill: 'none',
        stroke: wavelengthColour(um),
        'stroke-width': 1,
      }),
    );
  }
  for (const [um, uJy, sig] of points) {
    const c = wavelengthColour(um);
    const v = uJy / 1000;
    const e = sig / 1000;
    if (bins) {
      s.append(
        svg('circle', {
          cx: x(um),
          cy: y(Math.min(v, yMax)),
          r: 1.6,
          fill: c,
          'fill-opacity': 0.3,
        }),
      );
      continue;
    }
    if (e * 2 > 0.6) {
      s.append(
        svg('line', {
          x1: x(um),
          x2: x(um),
          y1: y(v - e),
          y2: y(v + e),
          stroke: c,
          'stroke-opacity': 0.6,
        }),
      );
    }
    s.append(svg('circle', { cx: x(um), cy: y(v), r: 2.2, fill: c }));
  }
  if (bins) {
    // One line per detector (their ranges overlap a little), a square on each bin.
    for (let d = 1; d <= 6; d++) {
      const own = bins.filter((b) => b[3] === d);
      if (!own.length) continue;
      s.append(
        svg('polyline', {
          points: own.map((b) => `${x(b[0])},${y(b[1] / 1000)}`).join(' '),
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.5,
          class: 'bin-line',
        }),
      );
      for (const [um, f, e] of own) {
        s.append(
          svg('line', {
            x1: x(um),
            x2: x(um),
            y1: y((f - e) / 1000),
            y2: y((f + e) / 1000),
            stroke: 'currentColor',
            'stroke-opacity': 0.6,
          }),
          svg('rect', {
            x: x(um) - 2.5,
            y: y(f / 1000) - 2.5,
            width: 5,
            height: 5,
            fill: wavelengthColour(um),
            stroke: 'currentColor',
            'stroke-width': 0.8,
          }),
        );
      }
    }
  }
  const xl = svg('text', { x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis' });
  xl.textContent = labels.x;
  const yl = svg('text', {
    x: 12,
    y: (T + H - B) / 2,
    'text-anchor': 'middle',
    class: 'axis',
    transform: `rotate(-90 12 ${(T + H - B) / 2})`,
  });
  yl.textContent = labels.y;
  s.append(xl, yl);
  return s;
}
