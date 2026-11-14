/**
 * "From your numbers to now" (queue #4, E7): when a typed position is where one of the five
 * used to be (the challenge's WISE 0855 coordinates are its 2010 place), a small map of its
 * straight path from that year to today. North up, east left, as on the sky. Year ticks; the
 * stretch SPHEREx photographed, highlighted, to show how small a slice of the drift it is; the
 * close-up's field at today's end, for scale; a scale bar. Proper motion only (parallax, ≤ 0.55″
 * here, is far below the drawing's scale).
 */
import type { SkyPosition } from '../data/coords';
import { offsetAt, trackTicks, type Wanderer } from '../app/targets';
import { svg } from './figures';

const W = 320;
const H = 170;
const PAD = 22;

export interface PastPathInput {
  wanderer: Wanderer;
  /** The position the visitor typed. */
  typed: SkyPosition;
  /** The year on the track closest to it (pastPlace). */
  year: number;
  /** The span SPHEREx photographed, years (first and last photo). */
  spherex: [number, number];
  /** The close-up's field, arcsec on a side. */
  closeUpArcsec: number;
  labels: {
    typed: (year: number) => string;
    now: string;
    spherex: string;
    closeUp: string;
    north: string;
    east: string;
    scale: (text: string) => string;
    alt: string;
  };
}

export function pastPathFigure(p: PastPathInput): SVGSVGElement {
  const { wanderer: w } = p;
  const cosd = Math.cos((w.at.dec * Math.PI) / 180);
  let dra = p.typed.ra - w.at.ra;
  if (dra > 180) dra -= 360;
  if (dra < -180) dra += 360;
  // Everything in arcsec from today's place: east, north.
  const typed = { east: dra * cosd * 3600, north: (p.typed.dec - w.at.dec) * 3600 };
  const then = offsetAt(w, p.year);
  const half = p.closeUpArcsec / 2;
  const xs = [then.east, typed.east, -half, half];
  const ys = [then.north, typed.north, -half, half];
  const spanE = Math.max(...xs) - Math.min(...xs);
  const spanN = Math.max(...ys) - Math.min(...ys);
  const s = Math.min((W - 2 * PAD) / Math.max(1, spanE), (H - 2 * PAD) / Math.max(1, spanN));
  const midE = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midN = (Math.max(...ys) + Math.min(...ys)) / 2;
  // East is to the left, as on the sky.
  const X = (east: number) => W / 2 - (east - midE) * s;
  const Y = (north: number) => H / 2 - (north - midN) * s;

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'past-path',
    role: 'img',
    'aria-label': p.labels.alt,
  });
  const text = (x: number, y: number, t: string, cls: string, anchor = 'middle') =>
    Object.assign(svg('text', { x, y, class: cls, 'text-anchor': anchor }), { textContent: t });

  // The close-up's field, today, for scale.
  root.append(
    svg('rect', {
      x: X(half),
      y: Y(half),
      width: p.closeUpArcsec * s,
      height: p.closeUpArcsec * s,
      class: 'pp-field',
    }),
    text(X(half) + 3, Y(half) - 4, p.labels.closeUp, 'pp-small', 'start'),
  );
  // The track, then to now, with year ticks across it.
  root.append(
    svg('line', { x1: X(then.east), y1: Y(then.north), x2: X(0), y2: Y(0), class: 'pp-track' }),
  );
  const len = Math.hypot(then.east, then.north) || 1;
  const nx = (-then.north / len) * 4;
  const ny = (then.east / len) * 4;
  for (const yr of trackTicks(p.year)) {
    const o = offsetAt(w, yr);
    root.append(
      svg('line', {
        x1: X(o.east) - nx,
        y1: Y(o.north) + ny,
        x2: X(o.east) + nx,
        y2: Y(o.north) - ny,
        class: 'pp-tick',
      }),
    );
  }
  // The stretch SPHEREx photographed.
  const a = offsetAt(w, p.spherex[0]);
  const b = offsetAt(w, p.spherex[1]);
  root.append(
    svg('line', { x1: X(a.east), y1: Y(a.north), x2: X(b.east), y2: Y(b.north), class: 'pp-sphx' }),
  );
  // Ends: your numbers (a cross where you typed), and today (the star).
  const tx = X(typed.east);
  const ty = Y(typed.north);
  root.append(
    svg('path', {
      d: `M${tx - 4} ${ty - 4} L${tx + 4} ${ty + 4} M${tx - 4} ${ty + 4} L${tx + 4} ${ty - 4}`,
      class: 'pp-typed',
    }),
    svg('circle', { cx: X(0), cy: Y(0), r: 3.5, class: 'pp-now' }),
  );
  // Labels off the track: above and below its ends when it runs across, beside them when it
  // runs up and down (Barnard's Star), so no label sits on the line.
  const upright = Math.abs(Y(then.north) - Y(0)) > Math.abs(X(then.east) - X(0));
  const above = (y: number) => (y < 26 ? y + 18 : y - 9);
  const below = (y: number) => (y > H - 30 ? y - 10 : y + 17);
  const sx = (X(a.east) + X(b.east)) / 2;
  const sy = Math.min(Y(a.north), Y(b.north));
  // The calendar year: a J2000 catalogue place (2000.0) lands at 1999.98 by the track, not "1999".
  const yearShown = Math.floor(p.year + 0.05);
  if (upright)
    root.append(
      text(tx + 9, ty + 4, p.labels.typed(yearShown), 'pp-label', 'start'),
      text(X(0) + 9, Y(0) + 4, p.labels.now, 'pp-label', 'start'),
      text(sx - 9, sy + 4, p.labels.spherex, 'pp-small pp-sphx-label', 'end'),
    );
  else
    root.append(
      text(tx, above(ty), p.labels.typed(yearShown), 'pp-label'),
      text(X(0), below(Y(0)), p.labels.now, 'pp-label'),
      text(
        sx,
        above(sy) - (Math.abs(sx - tx) < 70 ? 13 : 0),
        p.labels.spherex,
        'pp-small pp-sphx-label',
      ),
    );
  // Scale bar (1′, or 30″ when 1′ won't fit) and compass, in the lower and upper right.
  const bar = 60 * s <= W / 3 ? 60 : 30;
  const bx = W - PAD - bar * s;
  root.append(
    svg('line', { x1: bx, y1: H - 8, x2: W - PAD, y2: H - 8, class: 'pp-bar' }),
    text(bx - 4, H - 5, p.labels.scale(bar === 60 ? '1′' : '30″'), 'pp-small', 'end'),
    svg('path', { d: `M${W - 10} 22 V8 M${W - 10} 22 H${W - 24}`, class: 'pp-compass' }),
    text(W - 10, 6, p.labels.north, 'pp-small'),
    text(W - 30, 25, p.labels.east, 'pp-small', 'end'),
  );
  return root;
}
