/**
 * The moving-object test's published results, explored (detectors.html; Physics' rules, 15 Nov):
 * every chart reads research/v4/results as published (served byte-identical from
 * public/research/v4, checked by src/research.test.ts). Each file's sha256 is computed here and
 * compared with PROVENANCE.md; a chart draws only on a match. Only numbers in the files are shown
 * (the one derived value, the pooled rate, is the file's own).
 */
import { copy } from '../copy/en';
import { h } from './dom';

const t = copy.detectors.explorer;
const BASE = `${import.meta.env.BASE_URL}research/v4/`;
const SVGNS = 'http://www.w3.org/2000/svg';

function s(tag: string, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

/** Chart text in real px whatever the chart's width (Viewer): --k = viewBox width / drawn width. */
function trueText(svg: SVGElement, vbW: number): void {
  const set = () => {
    const w = svg.getBoundingClientRect().width;
    if (w > 0) svg.style.setProperty('--k', String(vbW / w));
  };
  new ResizeObserver(set).observe(svg);
  requestAnimationFrame(set);
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The files carry Python's NaN and Infinity, which JSON.parse refuses: read them as null / ∞. */
function parseLoose(text: string): unknown {
  return JSON.parse(
    text
      .replace(/(?<=[:[,\s])-?Infinity\b/g, (m) => (m[0] === '-' ? '-1e999' : '1e999'))
      .replace(/(?<=[:[,\s])NaN\b/g, 'null'),
  );
}

interface Loaded {
  data: Record<string, unknown>;
  sha: string;
  ok: boolean;
}

async function load(file: string, prov: string): Promise<Loaded> {
  const r = await fetch(`${BASE}results/${file}`);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  const sha = await sha256(buf);
  const ok = prov.includes(`${sha}  ./results/${file}`);
  return { data: parseLoose(new TextDecoder().decode(buf)) as Record<string, unknown>, sha, ok };
}

function sourceLine(file: string, l: Loaded, trimmed = false): HTMLElement {
  const short = l.sha.slice(0, 12);
  return h(
    'p',
    { class: `dx-source ${l.ok ? 'ok' : 'bad'}`, title: `${t.fullHash}: ${l.sha}` },
    trimmed ? t.sourceTrimmed(file, short) : t.source(file, short),
    ', ',
    l.ok ? t.matches : t.differs,
    trimmed ? `; ${t.trimmed}` : '',
  );
}

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// ---------- A: completeness vs magnitude ----------
interface Bin {
  m_lo: number;
  m_hi: number;
  n: number;
  k: number;
  c: number;
  ci95: [number, number];
}
interface Fit {
  c_max: number;
  m0: number;
  w: number;
  m50: number;
  m50_ci68: [number, number];
}

function chartA(res: Record<string, Record<string, unknown>>): HTMLElement {
  const W = 760;
  const H = 300;
  const L = 52;
  const R = 16;
  const T = 14;
  const B = 40;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'dx-svg',
    role: 'img',
    'aria-label': t.a,
  });
  trueText(svg, W);
  const holder = h('div', {});
  const draw = (key: 'primary_far0.1' | 'secondary_far1.0') => {
    const part = res[key] as { bins: Bin[]; all: Fit };
    const bins = part.bins;
    const fit = part.all;
    const m0 = bins[0]?.m_lo ?? 15.5;
    const m1 = bins[bins.length - 1]?.m_hi ?? 21;
    const x = (m: number) => L + ((m - m0) / (m1 - m0)) * (W - L - R);
    const y = (c: number) => T + (1 - c) * (H - T - B);
    svg.replaceChildren();
    for (const c of [0, 0.25, 0.5, 0.75, 1]) {
      svg.append(s('line', { x1: L, x2: W - R, y1: y(c), y2: y(c), class: 'dx-grid' }));
      svg.append(
        s('text', { x: L - 8, y: y(c) + 4, class: 'dx-tick', 'text-anchor': 'end' }, `${c * 100}%`),
      );
    }
    for (let m = Math.ceil(m0); m <= m1; m++)
      svg.append(
        s('text', { x: x(m), y: H - B + 16, class: 'dx-tick', 'text-anchor': 'middle' }, String(m)),
      );
    svg.append(
      s(
        'text',
        { x: (L + W - R) / 2, y: H - 6, class: 'dx-axis', 'text-anchor': 'middle' },
        t.axisMag,
      ),
    );
    // The registered fit, across the binned range only.
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const m = m0 + ((m1 - m0) * i) / 120;
      const c = fit.c_max / (1 + Math.exp((m - fit.m0) / fit.w));
      pts.push(`${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(c).toFixed(1)}`);
    }
    svg.append(s('path', { d: pts.join(''), class: 'dx-fit' }));
    // Plateau and m50 markers.
    svg.append(
      s('line', { x1: L, x2: W - R, y1: y(fit.c_max), y2: y(fit.c_max), class: 'dx-mark' }),
    );
    svg.append(
      s(
        'text',
        { x: W - R - 4, y: y(fit.c_max) - 5, class: 'dx-tick', 'text-anchor': 'end' },
        `levels off at ${Math.round(fit.c_max * 100)}%`,
      ),
    );
    svg.append(s('line', { x1: x(fit.m50), x2: x(fit.m50), y1: T, y2: H - B, class: 'dx-mark' }));
    svg.append(
      s(
        'text',
        { x: x(fit.m50) + 5, y: T + 12, class: 'dx-tick' },
        `half found at ${fmt(fit.m50)}`,
      ),
    );
    // Bins: 95% interval and the measured fraction, with the counts on hover.
    for (const b of bins) {
      const cx = x((b.m_lo + b.m_hi) / 2);
      const g = s('g', { class: 'dx-bin' });
      g.append(
        s(
          'title',
          {},
          `${b.m_lo}–${b.m_hi}: ${b.k} of ${b.n} found (${fmt(b.c * 100, 1)}%; 95% ${fmt(b.ci95[0] * 100, 1)}–${fmt(b.ci95[1] * 100, 1)}%)`,
        ),
        s('line', { x1: cx, x2: cx, y1: y(b.ci95[0]), y2: y(b.ci95[1]), class: 'dx-ci' }),
        s('circle', { cx, cy: y(b.c), r: 3.2, class: 'dx-pt' }),
      );
      svg.append(g);
    }
  };
  const pri = res['primary_far0.1'] as { all: Fit };
  const sec = res['secondary_far1.0'] as { all: Fit };
  const opts = [
    ['primary_far0.1', t.primary(fmt(pri.all.m50))],
    ['secondary_far1.0', t.secondary(fmt(sec.all.m50))],
  ] as const;
  const seg = h('div', { class: 'dx-seg', role: 'radiogroup', 'aria-label': 'Threshold' });
  // One tab stop: the checked radio is focusable; arrows move and select (Viewer).
  const btns: HTMLButtonElement[] = [];
  const pick = (i: number, focus: boolean) => {
    btns.forEach((x, j) => {
      x.setAttribute('aria-checked', String(j === i));
      x.tabIndex = j === i ? 0 : -1;
    });
    if (focus) btns[i]?.focus();
    const k = opts[i]?.[0];
    if (k) draw(k);
  };
  opts.forEach(([, label], i) => {
    const b = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(i === 0),
        tabindex: i === 0 ? 0 : -1,
      },
      label,
    ) as HTMLButtonElement;
    b.addEventListener('click', () => pick(i, false));
    b.addEventListener('keydown', (e) => {
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        pick((i + 1) % opts.length, true);
      }
    });
    btns.push(b);
  });
  seg.append(...btns);
  draw('primary_far0.1');
  holder.append(seg, svg);
  return holder;
}

// ---------- B: by speed and by distance to a bright star ----------
interface Group {
  lo: number;
  hi: number;
  n: number;
  k: number;
  c: number;
  wilson95: [number, number];
}
function chartB(groups: Group[], title: string, unit: string): HTMLElement {
  const W = 360;
  const H = 210;
  const L = 44;
  const B = 40;
  const T = 12;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'dx-svg',
    role: 'img',
    'aria-label': title,
  });
  trueText(svg, W);
  const y = (c: number) => T + (1 - c / 0.5) * (H - T - B); // 0–50%
  for (const c of [0, 0.25, 0.5]) {
    svg.append(s('line', { x1: L, x2: W - 8, y1: y(c), y2: y(c), class: 'dx-grid' }));
    svg.append(
      s('text', { x: L - 6, y: y(c) + 4, class: 'dx-tick', 'text-anchor': 'end' }, `${c * 100}%`),
    );
  }
  const bw = (W - L - 16) / groups.length;
  groups.forEach((g, i) => {
    const x0 = L + 8 + i * bw;
    const few = g.n < 20;
    const gg = s('g', { class: few ? 'dx-bar few' : 'dx-bar' });
    const label = `${g.lo}–${Number.isFinite(g.hi) ? g.hi : '∞'}${unit}`;
    gg.append(
      s(
        'title',
        {},
        `${label}: ${g.k} of ${g.n} found (${fmt(g.c * 100, 1)}%; 95% ${fmt(g.wilson95[0] * 100, 1)}–${fmt(g.wilson95[1] * 100, 1)}%)`,
      ),
      s('rect', { x: x0, y: y(g.c), width: bw - 14, height: Math.max(0, y(0) - y(g.c)) }),
      s('line', {
        x1: x0 + (bw - 14) / 2,
        x2: x0 + (bw - 14) / 2,
        y1: y(g.wilson95[0]),
        y2: y(Math.min(0.5, g.wilson95[1])),
        class: 'dx-ci',
      }),
      s(
        'text',
        { x: x0 + (bw - 14) / 2, y: H - B + 15, class: 'dx-tick', 'text-anchor': 'middle' },
        label,
      ),
      s(
        'text',
        { x: x0 + (bw - 14) / 2, y: H - B + 29, class: 'dx-tick', 'text-anchor': 'middle' },
        few ? `n ${g.n} · ${t.fewFakes}` : `n ${g.n}`,
      ),
    );
    svg.append(gg);
  });
  return h('figure', { class: 'dx-small' }, h('figcaption', {}, title), svg);
}

// ---------- C: false alarms per patch ----------
interface Far {
  events: number;
  area_deg2_visits: number;
  far: number;
  far_poisson95: [number, number];
  power_of_a1_rule?: { events_to_fail: number };
}
function chartC(per: Record<string, Far>): HTMLElement {
  const rows = ['V-1', 'V-2', 'V-3', 'V-pooled'];
  const W = 760;
  const rowH = 30;
  const L = 200;
  const R = 20;
  const H = rows.length * rowH + 40;
  const max = 0.9;
  const x = (v: number) => L + (v / max) * (W - L - R);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'dx-svg',
    role: 'img',
    'aria-label': t.c,
  });
  trueText(svg, W);
  for (const v of [0, 0.2, 0.4, 0.6, 0.8]) {
    svg.append(s('line', { x1: x(v), x2: x(v), y1: 6, y2: H - 30, class: 'dx-grid' }));
    svg.append(
      s('text', { x: x(v), y: H - 12, class: 'dx-tick', 'text-anchor': 'middle' }, String(v)),
    );
  }
  svg.append(s('line', { x1: x(0.2), x2: x(0.2), y1: 6, y2: H - 30, class: 'dx-limit' }));
  rows.forEach((p, i) => {
    const f = per[p];
    if (!f) return;
    const cy = 20 + i * rowH;
    svg.append(
      s(
        'text',
        { x: L - 10, y: cy + 4, class: 'dx-tick', 'text-anchor': 'end' },
        p === 'V-pooled' ? 'Pooled (reported only)' : p,
      ),
      s('line', {
        x1: x(f.far_poisson95[0]),
        x2: x(Math.min(max, f.far_poisson95[1])),
        y1: cy,
        y2: cy,
        class: 'dx-ci',
      }),
      s('circle', { cx: x(f.far), cy, r: 4, class: 'dx-pt' }),
    );
  });
  const table = h(
    'table',
    { class: 'dx-table' },
    h('thead', {}, h('tr', {}, ...t.cHead.map((c) => h('th', {}, c)))),
    h(
      'tbody',
      {},
      ...rows.map((p) => {
        const f = per[p];
        if (!f) return h('tr', {});
        return h(
          'tr',
          {},
          h('td', {}, p === 'V-pooled' ? t.pooled : p),
          h('td', {}, String(f.events)),
          h('td', {}, fmt(f.area_deg2_visits, 1)),
          h('td', {}, `${fmt(f.far)} (${fmt(f.far_poisson95[0])}–${fmt(f.far_poisson95[1])})`),
          h('td', {}, f.power_of_a1_rule ? String(f.power_of_a1_rule.events_to_fail) : '—'),
        );
      }),
    ),
  );
  return h('div', {}, svg, table, h('p', { class: 'dx-note' }, t.cV1));
}

// ---------- D: realism forest plot ----------
interface Realism {
  dm: number;
  ci90: [number, number];
  n_fake: number;
  n_known: number;
}
function chartD(r: Record<string, unknown>): HTMLElement {
  const pool = r['v_pool'] as Record<string, Realism>;
  const rows: [string, Realism, 'primary' | 'sens' | 'reported'][] = [
    ...Object.entries(pool).map(([k, v]): [string, Realism, 'primary' | 'sens' | 'reported'] => [
      k,
      v,
      k.startsWith('PRIMARY') ? 'primary' : 'sens',
    ]),
    [`D pool (from T6): ${t.dReported}`, r['d_pool_quoted_from_t6'] as Realism, 'reported'],
    [`D + V pooled: ${t.dReported}`, r['dv_pooled_v4_recovery_reported'] as Realism, 'reported'],
  ];
  // Short row labels (they stay legible at phone width); each row's full name is on hover.
  const short = (label: string, kind: string) =>
    kind === 'primary'
      ? 'Primary (registered)'
      : kind === 'reported'
        ? `${label.split(':')[0]} †`
        : label.replace(/^sensitivity: /, '');
  const W = 760;
  const rowH = 26;
  const L = 210;
  const R = 20;
  const H = rows.length * rowH + 40;
  const lim = 0.3;
  const x = (v: number) => L + ((v + lim) / (2 * lim)) * (W - L - R);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'dx-svg',
    role: 'img',
    'aria-label': t.d,
  });
  trueText(svg, W);
  svg.append(
    s('rect', { x: x(-0.2), y: 4, width: x(0.2) - x(-0.2), height: H - 34, class: 'dx-band' }),
  );
  for (const v of [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) {
    svg.append(
      s('line', { x1: x(v), x2: x(v), y1: 4, y2: H - 30, class: v === 0 ? 'dx-zero' : 'dx-grid' }),
    );
    svg.append(
      s(
        'text',
        { x: x(v), y: H - 12, class: 'dx-tick', 'text-anchor': 'middle' },
        `${v > 0 ? '+' : ''}${v}`,
      ),
    );
  }
  rows.forEach(([label, v, kind], i) => {
    const cy = 18 + i * rowH;
    const g = s('g', { class: `dx-row ${kind}` });
    g.append(
      s(
        'title',
        {},
        `${label}: Δ ${fmt(v.dm, 3)} mag (90% ${fmt(v.ci90[0], 3)} to ${fmt(v.ci90[1], 3)}); ${v.n_fake} fakes, ${v.n_known} known`,
      ),
      s(
        'text',
        { x: L - 10, y: cy + 4, class: 'dx-tick', 'text-anchor': 'end' },
        short(label, kind),
      ),
      s('line', { x1: x(v.ci90[0]), x2: x(v.ci90[1]), y1: cy, y2: cy, class: 'dx-ci' }),
      s('circle', { cx: x(v.dm), cy, r: kind === 'primary' ? 5 : 3.5, class: 'dx-pt' }),
    );
    svg.append(g);
  });
  return h('div', {}, svg, h('p', { class: 'dx-note' }, `† ${t.dReported}.`));
}

// ---------- E: known asteroids re-found ----------
interface Rec {
  visit: string;
  desig: string;
  v_mag: number;
  band: string;
}
function tableE(real: Record<string, { known_recovered: number; recovered: Rec[] }>): HTMLElement {
  const patches = ['V-1', 'V-2', 'V-3'];
  const counts = patches.map((p) => `${p}: ${real[p]?.known_recovered ?? '—'}`).join(' · ');
  const rows = patches.flatMap((p) =>
    (real[p]?.recovered ?? []).map((r) =>
      h(
        'tr',
        {},
        h('td', {}, p),
        h('td', {}, r.desig),
        h('td', {}, fmt(r.v_mag, 1)),
        h('td', {}, r.visit),
        h('td', {}, r.band),
      ),
    ),
  );
  return h(
    'div',
    {},
    h('p', { class: 'dx-count' }, counts),
    h('p', { class: 'dx-note' }, t.eNote),
    h(
      'details',
      { class: 'dx-details' },
      h('summary', {}, `All ${rows.length}`),
      h(
        'table',
        { class: 'dx-table' },
        h('thead', {}, h('tr', {}, ...t.eHead.map((c) => h('th', {}, c)))),
        h('tbody', {}, ...rows),
      ),
    ),
  );
}

export async function v4Explorer(): Promise<HTMLElement> {
  const section = h(
    'section',
    { class: 'dx', id: 'v4-results' },
    h('h2', {}, t.title),
    h('p', { class: 'dx-lede' }, t.lede),
  );
  try {
    const prov = await (await fetch(`${BASE}PROVENANCE.md`)).text();
    const [res, realism] = await Promise.all([
      load('v_look_result_public.json', prov),
      load('realism_v_pool.json', prov),
    ]);
    const block = (
      label: string,
      caption: string,
      body: () => HTMLElement,
      src: HTMLElement,
      ok: boolean,
    ) =>
      h(
        'figure',
        { class: 'dx-block' },
        h('h3', {}, label),
        caption ? h('figcaption', {}, caption) : null,
        ok ? body() : h('p', { class: 'dx-bad' }, t.differs),
        src,
      );
    const r = res.data as Record<string, Record<string, unknown>>;
    const resSrc = () => sourceLine('v_look_result_public.json', res, true);
    const primary = r['primary_far0.1'] as {
      by_rate_px_per_step: Group[];
      by_gaia_g16_distance_px: Group[];
    };
    section.append(
      block(t.titles.a, t.a, () => chartA(r), resSrc(), res.ok),
      block(
        t.titles.b,
        t.bCaption,
        () =>
          h(
            'div',
            { class: 'dx-pair' },
            chartB(primary.by_rate_px_per_step, t.bRate, ''),
            chartB(primary.by_gaia_g16_distance_px, t.bStar, ' px'),
          ),
        resSrc(),
        res.ok,
      ),
      block(
        t.titles.c,
        t.c,
        () => chartC(r['per_patch_far'] as unknown as Record<string, Far>),
        resSrc(),
        res.ok,
      ),
      block(
        t.titles.d,
        t.d,
        () => chartD(realism.data),
        sourceLine('realism_v_pool.json', realism),
        realism.ok,
      ),
      block(
        t.titles.e,
        t.e,
        () =>
          tableE(
            r['real_output'] as unknown as Record<
              string,
              { known_recovered: number; recovered: Rec[] }
            >,
          ),
        resSrc(),
        res.ok,
      ),
    );
  } catch {
    section.append(h('p', { class: 'dx-bad' }, t.loadFailed));
  }
  return section;
}
