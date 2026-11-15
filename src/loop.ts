/**
 * "Why a far planet loops" (loop.html, 15 Nov): Makemake's parallax loop measured in SPHEREx photos
 * (prereg/parallaxloop/PLAN.md, Physics signed), and a model of how distance shapes a path (Viewer's
 * design; it replaces the never-shipped ?demo=dial). Colours are the contract: ember = measured,
 * lilac = predicted or model, mist dashed = where it would be seen from the Sun.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/credits.css';
import './styles/loop.css';
import { copy } from './copy/en';
import { h } from './ui/dom';
import { markSvg } from './ui/mark';
import { watchScheme } from './ui/scheme';
import { sharedStretch, toGrey } from './render/stretch';

watchScheme();

const t = copy.loop;
const root = document.getElementById('loop') as HTMLElement;
const BASE = `${import.meta.env.BASE_URL}data/loop/`;
const RAD = Math.PI / 180;
const ARCSEC_PER_AU = 206264.8; // the parallax of a body at d AU is this / d (″)
const PIX = 6.15;
const PC_AU = 206264.8;
const BARNARD_AU = 1.83 * PC_AU;
const OBLIQUITY = 23.4392911 * RAD;
const RULES_URL =
  'https://github.com/sumit7194/planetes-spherex/blob/main/prereg/parallaxloop/PLAN.md';

interface Visit {
  visit: number;
  first: string;
  detected: boolean;
  detector?: number;
  photos?: number;
  sn?: number;
  predicted?: [number, number];
  measured?: [number, number];
  offsetArcsec?: [number, number];
  offsetErrArcsec?: [number, number] | null;
  fromSun?: [number, number];
  parallaxArcsec?: number;
  thumb?: { file: string; size: number };
  photoDots?: { ra: number; dec: number }[];
}
interface LoopDoc {
  object: string;
  passes: boolean;
  pathEarth: [number, number, number][];
  pathSun: [number, number, number][];
  visits: Visit[];
  parallaxArcsec: number;
  proximaArcsec: number;
  ratioToProxima: number;
}

// ---------- small SVG helper ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function s(
  tag: string,
  attrs: Record<string, string | number> = {},
  ...kids: (Node | string)[]
): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

// ---------- projection: gnomonic, north up, east left ----------
function projector(ra0: number, dec0: number) {
  const a0 = ra0 * RAD;
  const d0 = dec0 * RAD;
  return (ra: number, dec: number): [number, number] => {
    const a = ra * RAD;
    const d = dec * RAD;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
    const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
    const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
    return [(-xi / RAD) * 3600, (eta / RAD) * 3600]; // ″: x grows west (east left), y grows north
  };
}

/** A friendly size: 0.47″, 12″, 6.8′, 1.0°. */
export function fmtAngle(arcsec: number): string {
  const a = Math.abs(arcsec);
  if (a >= 3600) return `${(arcsec / 3600).toFixed(a >= 36000 ? 0 : 1)}°`;
  if (a >= 60) return `${(arcsec / 60).toFixed(a >= 600 ? 0 : 1)}′`;
  if (a >= 10) return `${Math.round(arcsec)}″`;
  if (a >= 1) return `${arcsec.toFixed(1)}″`;
  return `${arcsec.toFixed(2)}″`;
}

/** What a size is like: SPHEREx pixels, full Moons (0.5°) or SPHEREx's field (3.5°). */
export function likeness(arcsec: number): string {
  if (arcsec >= 3.5 * 3600) return `about ${(arcsec / (3.5 * 3600)).toFixed(1)} SPHEREx fields`;
  if (arcsec >= 1800) return `about ${(arcsec / 1800).toFixed(arcsec >= 18000 ? 0 : 1)} full Moons`;
  if (arcsec >= PIX) return `about ${Math.round(arcsec / PIX)} SPHEREx pixels`;
  return `about 1/${Math.round(PIX / arcsec)} of a SPHEREx pixel`;
}

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 18000];
function scaleBar(arcsecPerUnit: number, width: number): { len: number; label: string } {
  const target = (width / 4) * arcsecPerUnit;
  const v = NICE.reduce(
    (b, x) => (Math.abs(Math.log(x / target)) < Math.abs(Math.log(b / target)) ? x : b),
    0.1,
  );
  return { len: v / arcsecPerUnit, label: `${fmtAngle(v)} · ${likeness(v)}` };
}

/** Fit a set of points (″) into a W × H box with a margin; returns a mapping and the scale. */
function fitBox(pts: [number, number][], W: number, H: number, m: number) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const k = Math.max((x1 - x0) / (W - 2 * m), (y1 - y0) / (H - 2 * m), 1e-9); // ″ per unit
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // x grows west → drawn to the right (east left); y grows north → drawn up.
  return {
    k,
    map: (p: [number, number]): [number, number] => [
      W / 2 + (p[0] - cx) / k,
      H / 2 - (p[1] - cy) / k,
    ],
  };
}

const pathD = (pts: [number, number][]) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

// ---------- the measured view ----------
async function thumbUrl(v: Visit): Promise<string | null> {
  if (!v.thumb) return null;
  const r = await fetch(BASE + v.thumb.file);
  if (!r.ok) return null;
  const img = new Float32Array(await r.arrayBuffer());
  const n = v.thumb.size;
  const st = sharedStretch([img]);
  const Z = 4;
  const c = document.createElement('canvas');
  c.width = c.height = n * Z;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const g = toGrey(img[y * n + x] ?? NaN, st);
      ctx.fillStyle = g === null ? '#161a28' : `rgb(${g} ${g} ${g})`;
      ctx.fillRect(x * Z, (n - 1 - y) * Z, Z, Z); // north up: row 0 is the bottom
    }
  return c.toDataURL();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86400000);

async function measuredView(doc: LoopDoc): Promise<HTMLElement> {
  const W = 760;
  const H = 560;
  type Placed = Visit & { measured: [number, number]; offsetArcsec: [number, number] };
  const det = doc.visits.filter((v): v is Placed => v.detected && !!v.measured && !!v.offsetArcsec);
  const ra0 = det.reduce((a, v) => a + v.measured[0], 0) / det.length;
  const dec0 = det.reduce((a, v) => a + v.measured[1], 0) / det.length;
  const P = projector(ra0, dec0);
  const earth = doc.pathEarth.map(([, ra, dec]) => P(ra, dec));
  const sun = doc.pathSun.map(([, ra, dec]) => P(ra, dec));
  const box = fitBox([...earth, ...sun], W, H, 70);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'loop-svg',
    role: 'img',
    'aria-labelledby': 'loop-m-title',
  });
  const maxOff = Math.max(...det.map((v) => Math.hypot(...(v.offsetArcsec ?? [0, 0]))));
  svg.append(s('title', { id: 'loop-m-title' }, t.alt(maxOff.toFixed(1))));
  svg.append(s('path', { d: pathD(sun.map(box.map)), class: 'lp-sun' }));
  svg.append(s('path', { d: pathD(earth.map(box.map)), class: 'lp-path' }));
  // A tick each month on the predicted path, labelled every third month.
  let lastMonth = -1;
  for (const [mjd, ra, dec] of doc.pathEarth) {
    const d = mjdToDate(mjd);
    const m = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (m === lastMonth) continue;
    lastMonth = m;
    const [x, y] = box.map(P(ra, dec));
    svg.append(s('circle', { cx: x, cy: y, r: 2, class: 'lp-tick' }));
    if (d.getUTCMonth() % 3 === 0)
      svg.append(
        s(
          'text',
          { x: x + 6, y: y - 6, class: 'lp-month' },
          `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
        ),
      );
  }
  // Measured: per-photo dots, then each visit's stacked place, its Sun-view place and thumbnail.
  for (const v of det) {
    for (const p of v.photoDots ?? []) {
      const [x, y] = box.map(P(p.ra, p.dec));
      svg.append(s('circle', { cx: x, cy: y, r: 2.5, class: 'lp-photo' }));
    }
  }
  const thumbs = await Promise.all(det.map(thumbUrl));
  det.forEach((v, i) => {
    const [x, y] = box.map(P(...v.measured));
    if (v.fromSun) {
      const [sx, sy] = box.map(P(...v.fromSun));
      svg.append(s('line', { x1: x, y1: y, x2: sx, y2: sy, class: 'lp-par' }));
      svg.append(s('circle', { cx: sx, cy: sy, r: 4, class: 'lp-sunpt' }));
    }
    svg.append(s('circle', { cx: x, cy: y, r: 6, class: 'lp-visit' }));
    // The thumbnail sits outward from the figure's centre, away from the path, with a leader line.
    const dx = x - W / 2;
    const dy = y - H / 2;
    const dn = Math.hypot(dx, dy) || 1;
    const T = 88;
    const cxT = Math.min(Math.max(x + (dx / dn) * 95, T / 2 + 4), W - T / 2 - 4);
    const cyT = Math.min(Math.max(y + (dy / dn) * 95, T / 2 + 18), H - T / 2 - 40);
    const url = thumbs[i];
    if (url) {
      svg.append(s('line', { x1: x, y1: y, x2: cxT, y2: cyT, class: 'lp-leader' }));
      svg.append(
        s('image', {
          href: url,
          x: cxT - T / 2,
          y: cyT - T / 2,
          width: T,
          height: T,
          class: 'lp-thumb',
        }),
      );
      svg.append(
        s('rect', { x: cxT - T / 2, y: cyT - T / 2, width: T, height: T, class: 'lp-thumb-frame' }),
      );
    }
    svg.append(
      s('text', { x: cxT - T / 2, y: cyT - T / 2 - 5, class: 'lp-label' }, monthOf(v.first)),
    );
  });
  // Scale bar, bottom left.
  const sb = scaleBar(box.k, W);
  svg.append(
    s('line', { x1: 20, y1: H - 24, x2: 20 + sb.len, y2: H - 24, class: 'lp-scale' }),
    s('text', { x: 20, y: H - 32, class: 'lp-scale-t' }, sb.label),
    s('text', { x: W - 20, y: H - 20, class: 'lp-compass', 'text-anchor': 'end' }, 'N ↑  E ←'),
  );

  const key = h(
    'ul',
    { class: 'lp-key' },
    h('li', {}, h('span', { class: 'sw sw-path' }), t.keyPath),
    h('li', {}, h('span', { class: 'sw sw-sun' }), t.keySun),
    h('li', {}, h('span', { class: 'sw sw-visit' }), t.keyVisit),
    h('li', {}, h('span', { class: 'sw sw-photo' }), t.keyPhoto),
  );
  const rows = det.map((v) => {
    const [e, n] = v.offsetArcsec;
    const err = v.offsetErrArcsec ? Math.max(...v.offsetErrArcsec).toFixed(1) : '—';
    return h(
      'li',
      {},
      t.readoutRow(
        monthOf(v.first),
        e.toFixed(1),
        n.toFixed(1),
        err,
        v.photos ?? 0,
        v.detector ?? 0,
      ),
    );
  });
  const side = h(
    'div',
    { class: 'lp-side' },
    h('p', { class: 'lp-pill measured' }, t.pillMeasured),
    h('p', {}, t.found),
    h(
      'p',
      {},
      t.shift(
        (Math.round(doc.parallaxArcsec / 100) * 100).toLocaleString('en'),
        doc.ratioToProxima.toLocaleString('en'),
      ),
      ' ',
      t.planetX(String(Math.round(ARCSEC_PER_AU / 500 / 10) * 10)),
    ),
    h('p', { class: 'hint' }, t.others),
    h('h2', {}, t.readoutHead),
    h('ul', { class: 'lp-readout' }, ...rows),
    key,
    h(
      'details',
      { class: 'lp-how' },
      h('summary', {}, t.howHead),
      h('p', { class: 'hint' }, t.thumbs),
      h('p', { class: 'hint' }, t.method, ' ', h('a', { href: RULES_URL }, t.rules), '.'),
      h('p', { class: 'hint' }, t.weakness),
    ),
  );
  return h('div', { class: 'lp-view' }, h('figure', { class: 'lp-fig' }, svg), side);
}

// ---------- the model view ----------
/** Ecliptic longitude/latitude (rad) of an equatorial direction. */
function toEcliptic(ra: number, dec: number): [number, number] {
  const a = ra * RAD;
  const d = dec * RAD;
  const x = Math.cos(d) * Math.cos(a);
  const y = Math.cos(d) * Math.sin(a);
  const z = Math.sin(d);
  const ye = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
  const ze = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return [Math.atan2(ye, x), Math.asin(ze)];
}

/**
 * Two years of an imaginary object's path at distance d (AU) on a circular orbit (period d^1.5 yr)
 * at a fixed ecliptic latitude, seen from a circular 1 AU Earth orbit; and the times SPHEREx would
 * pass over it (90° from the Sun). Positions in ″ in a plane centred on the object's mean place.
 */
export function modelPath(dAu: number, lon0: number, lat0: number, steps = 730) {
  const pts: [number, number][] = [];
  const pass: [number, number][] = [];
  const raw: [number, number, number][] = [];
  const w = (2 * Math.PI) / Math.pow(dAu, 1.5);
  let prevE = NaN;
  for (let i = 0; i <= steps; i++) {
    const yr = (2 * i) / steps;
    const lon = lon0 + w * (yr - 1);
    const rx = dAu * Math.cos(lat0) * Math.cos(lon);
    const ry = dAu * Math.cos(lat0) * Math.sin(lon);
    const rz = dAu * Math.sin(lat0);
    const le = 2 * Math.PI * yr; // Earth's heliocentric longitude
    const ex = Math.cos(le);
    const ey = Math.sin(le);
    const gx = rx - ex;
    const gy = ry - ey;
    const gz = rz;
    const gl = Math.atan2(gy, gx);
    const gb = Math.atan2(gz, Math.hypot(gx, gy));
    raw.push([gl, gb, yr]);
    // Elongation from the Sun (the Sun is at -e from Earth).
    const gn = Math.hypot(gx, gy, gz);
    const elong = Math.acos(-(gx * ex + gy * ey) / gn) / RAD;
    if (!Number.isNaN(prevE) && (prevE - 90) * (elong - 90) <= 0) pass.push([gl, gb]);
    prevE = elong;
  }
  const mlon = raw.reduce((a, p) => a + p[0], 0) / raw.length;
  const mlat = raw.reduce((a, p) => a + p[1], 0) / raw.length;
  const flat = ([l, b]: [number, number] | [number, number, number]): [number, number] => [
    ((-(l - mlon) * Math.cos(mlat)) / RAD) * 3600,
    ((b - mlat) / RAD) * 3600,
  ];
  for (const p of raw) pts.push(flat(p));
  return { pts, passes: pass.map(flat) };
}

const DETENTS = [
  { au: 30, label: t.detentNeptune },
  { au: 52.6, label: t.detentMakemake, measured: true },
  { au: 500, label: t.detentPlanetX },
  { au: BARNARD_AU, label: t.detentBarnard, measured: true, href: './?target=barnard' },
];
const LOG0 = Math.log10(30);
const LOG1 = Math.log10(BARNARD_AU);
const STEPS = 10000;
const toSlider = (au: number) => Math.round(((Math.log10(au) - LOG0) / (LOG1 - LOG0)) * STEPS);
/** The slider's distance; a detent's own value when the slider sits on it. */
const fromSlider = (v: number) =>
  DETENTS.find((d) => toSlider(d.au) === v)?.au ?? Math.pow(10, LOG0 + (v / STEPS) * (LOG1 - LOG0));
const fmtDist = (au: number) =>
  au > 20000 ? `${(au / PC_AU).toFixed(2)} pc` : `${au < 100 ? au.toFixed(1) : Math.round(au)} AU`;

function modelView(doc: LoopDoc | null): HTMLElement {
  // Placed at Makemake's own ecliptic place, so the two views compare.
  const v0 = doc?.visits.find((v) => v.measured);
  const [lon0, lat0] = v0?.measured ? toEcliptic(...v0.measured) : [180 * RAD, 29 * RAD];
  const W = 760;
  const H = 560;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'loop-svg',
    role: 'img',
    'aria-labelledby': 'loop-x-title',
  });
  const title = s('title', { id: 'loop-x-title' });
  const path = s('path', { class: 'lp-model' });
  const passes = s('g', {});
  const bar = s('line', { class: 'lp-scale' });
  const barT = s('text', { class: 'lp-scale-t' });
  svg.append(
    title,
    path,
    passes,
    bar,
    barT,
    s('text', { x: W - 20, y: H - 20, class: 'lp-compass', 'text-anchor': 'end' }, 'N ↑  E ←'),
  );
  const input = h('input', {
    type: 'range',
    min: 0,
    max: STEPS,
    step: 1,
    value: toSlider(52.6),
    id: 'lp-dist',
    list: 'lp-detents',
    'aria-label': t.distance,
  }) as HTMLInputElement;
  const list = h(
    'datalist',
    { id: 'lp-detents' },
    ...DETENTS.map((d) => h('option', { value: toSlider(d.au), label: d.label })),
  );
  const read1 = h('p', { class: 'lp-big' });
  const read2 = h('p', {});
  const read3 = h('p', {});
  const read4 = h('p', { class: 'hint' });
  const det = h(
    'div',
    { class: 'lp-detents' },
    ...DETENTS.map((d) => {
      const b = h('button', { type: 'button', class: 'lp-detent' }, d.label) as HTMLButtonElement;
      b.addEventListener('click', () => {
        input.value = String(toSlider(d.au));
        draw();
      });
      return d.measured
        ? h(
            'span',
            {},
            b,
            ' ',
            h(
              'a',
              {
                href: d.href ?? '#measured',
                class: 'lp-see',
                'data-view': d.href ? '' : 'measured',
              },
              t.seeIt,
            ),
          )
        : b;
    }),
  );
  function draw(): void {
    const au = fromSlider(Number(input.value));
    const m = modelPath(au, lon0, lat0);
    const box = fitBox(m.pts, W, H, 70);
    path.setAttribute('d', pathD(m.pts.map(box.map)));
    passes.replaceChildren(
      ...m.passes.map((p) => {
        const [x, y] = box.map(p);
        return s('circle', { cx: x, cy: y, r: 5, class: 'lp-pass' });
      }),
    );
    const sb = scaleBar(box.k, W);
    bar.setAttribute('x1', '20');
    bar.setAttribute('x2', String(20 + sb.len));
    bar.setAttribute('y1', String(H - 24));
    bar.setAttribute('y2', String(H - 24));
    barT.setAttribute('x', '20');
    barT.setAttribute('y', String(H - 32));
    barT.textContent = sb.label;
    const fromSun = ARCSEC_PER_AU / au;
    read1.textContent = fmtDist(au);
    read2.textContent = t.fromSun(fmtAngle(fromSun));
    const between = 2 * fromSun;
    const reach = between < 5 ? t.tooSmall : between <= 25 ? t.workable : t.tooBig;
    read3.textContent = `${t.betweenPasses(fmtAngle(between))}. ${reach}.${au > 20000 ? ` ${t.starDrift}` : ''}`;
    // Loop width = peak to peak, 2 AU / d (Viewer, Physics), the same quantity everywhere.
    read4.textContent = `${t.loopVs(fmtAngle(2 * fromSun))}: ${likeness(2 * fromSun)}. ${t.zoomed}`;
    input.setAttribute('aria-valuetext', t.valueText(fmtDist(au), fmtAngle(2 * fromSun)));
    title.textContent = `${t.modelLine} ${fmtDist(au)}. ${read3.textContent}`;
  }
  input.addEventListener('input', draw);
  draw();
  const side = h(
    'div',
    { class: 'lp-side' },
    h('p', { class: 'lp-pill model' }, t.pillModel),
    h('p', { class: 'hint' }, t.modelLine),
    h('label', { for: 'lp-dist', class: 'lp-dlabel' }, t.distance),
    input,
    list,
    det,
    read1,
    read2,
    read3,
    read4,
  );
  return h('div', { class: 'lp-view' }, h('figure', { class: 'lp-fig' }, svg), side);
}

// ---------- page ----------
async function main(): Promise<void> {
  const back = h('a', { class: 'credits-back home', href: './' }, markSvg(), h('span', {}, t.back));
  back.addEventListener('click', (e) => {
    if (document.referrer && new URL(document.referrer).origin === location.origin) {
      e.preventDefault();
      history.back();
    }
  });
  let doc: LoopDoc | null = null;
  try {
    const r = await fetch(`${BASE}makemake.json`);
    if (r.ok) doc = (await r.json()) as LoopDoc;
  } catch {
    /* shown below */
  }
  const views = { measured: t.measured, model: t.model } as const;
  type V = keyof typeof views;
  const want = new URLSearchParams(location.search).get('view') === 'model' ? 'model' : 'measured';
  const holder = h('div', { class: 'lp-holder' });
  const seg = h('div', { class: 'lp-seg', role: 'radiogroup', 'aria-label': t.views });
  const btns = (Object.keys(views) as V[]).map((k) => {
    const b = h(
      'button',
      { type: 'button', role: 'radio', 'data-v': k },
      views[k],
    ) as HTMLButtonElement;
    b.addEventListener('click', () => void show(k, true));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        void show(k === 'measured' ? 'model' : 'measured', true);
      }
    });
    return b;
  });
  seg.append(...btns);
  const cache: Partial<Record<V, HTMLElement>> = {};
  async function show(v: V, focus = false): Promise<void> {
    for (const b of btns) {
      const on = b.dataset['v'] === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    if (!cache[v]) {
      if (v === 'measured')
        cache[v] = doc ? await measuredView(doc) : h('p', { class: 'hint' }, t.loadFailed);
      else cache[v] = modelView(doc);
    }
    const view = cache[v];
    if (view) holder.replaceChildren(view);
    const u = new URL(location.href);
    if (v === 'model') u.searchParams.set('view', 'model');
    else u.searchParams.delete('view');
    history.replaceState(null, '', u);
  }
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-view="measured"]');
    if (a) {
      e.preventDefault();
      void show('measured', true);
    }
  });
  root.append(back, h('h1', {}, t.title), h('p', { class: 'lede' }, t.lede), seg, holder);
  await show(want);
}

void main();
