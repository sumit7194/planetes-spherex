/**
 * "What fools you" (fieldguide.html, queue N1): real SPHEREx photos of things that look like a
 * discovery and aren't, or aren't new. Every example was found by a fixed rule
 * (prereg/fieldguide/PLAN.md) and labelled by Physics from its evidence; none is drawn. Cutouts are
 * drawn from data with the lens's own stretch rule, hatching and flag outlines (Viewer's design),
 * so a visitor learns to read the app.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/credits.css';
import './styles/tests.css';
import './styles/fieldguide.css';
import './styles/mark.css';
import { copy } from './copy/en';
import { h } from './ui/dom';
import { markSvg } from './ui/mark';
import { watchScheme } from './ui/scheme';
import { sharedStretch, toGrey } from './render/stretch';

watchScheme();

const t = copy.fieldguide;
const root = document.getElementById('fieldguide') as HTMLElement;
const BASE = `${import.meta.env.BASE_URL}data/fieldguide/`;

/** One panel: a square of image values, a mask of the card's own flag, and other masked pixels. */
interface Panel {
  caption: string;
  alt: string;
  size: number;
  image: string;
  mark: string;
  masked: string;
  /** Where a ring goes (panel pixels), when the thing is a point. */
  ring?: [number, number];
  /** Two colours' marks (panel pixels): + light centre, ○ catalogue star, ◇ predicted place. */
  marks?: { kind: 'light' | 'neighbour' | 'target'; x: number; y: number }[];
}
export interface Card {
  id: string;
  section: 'not-in-sky' | 'in-sky';
  title: string;
  looksLike: string;
  /** "flagged": the evidence is the flag name only; "confirmed": independent evidence too. */
  label: 'flagged' | 'confirmed';
  evidence: string[];
  howToTell: string;
  source: { photos: string[]; date: string; detector: string; lambda: string; at?: string };
  panels: Panel[];
}

async function bytes(file: string): Promise<ArrayBuffer> {
  const r = await fetch(BASE + file);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** The panels of one card share one stretch, the lens's rule (sharedStretch), stated on the page. */
async function drawPanels(card: Card): Promise<HTMLElement[]> {
  const data = await Promise.all(
    card.panels.map(async (p) => ({
      p,
      img: new Float32Array(await bytes(p.image)),
      mark: new Uint8Array(await bytes(p.mark)),
      masked: new Uint8Array(await bytes(p.masked)),
    })),
  );
  // The stretch comes from the pixels the card isn't about (its own flag left out), so one
  // extreme pixel can't turn the rest of both panels black; that pixel simply shows white.
  const stretch = sharedStretch(
    data.map((d) => d.img.map((v, k) => (d.mark[k] || d.masked[k] ? NaN : v))),
  );
  const css = getComputedStyle(document.documentElement);
  const flag = css.getPropertyValue('--sky-flag').trim() || '#e0533c';
  const star = css.getPropertyValue('--sky-starlight').trim() || '#efe8dd';
  const Z = 4;
  return data.map(({ p, img, mark, masked }) => {
    const n = p.size;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const c = h('canvas', {
      width: String(n * Z * dpr),
      height: String(n * Z * dpr),
      role: 'img',
      'aria-label': p.alt,
    }) as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const k = y * n + x;
          const v = masked[k] && !mark[k] ? null : toGrey(img[k] ?? NaN, stretch);
          // North up: row 0 is the bottom. Masked pixels are hatched, as in the lens.
          const yy = (n - 1 - y) * Z;
          if (v === null) {
            ctx.fillStyle = '#161a28';
            ctx.fillRect(x * Z, yy, Z, Z);
            ctx.fillStyle = '#2a3046';
            ctx.fillRect(x * Z, yy, 1, Z);
          } else {
            ctx.fillStyle = `rgb(${v} ${v} ${v})`;
            ctx.fillRect(x * Z, yy, Z, Z);
          }
        }
      // The card's own flag: outlined in flag red along the region's edge (outlines, never fills).
      ctx.strokeStyle = flag;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const on = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && !!mark[y * n + x];
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (!on(x, y)) continue;
          const X = x * Z;
          const Y = (n - 1 - y) * Z;
          if (!on(x, y + 1)) {
            ctx.moveTo(X, Y + 0.5);
            ctx.lineTo(X + Z, Y + 0.5);
          }
          if (!on(x, y - 1)) {
            ctx.moveTo(X, Y + Z - 0.5);
            ctx.lineTo(X + Z, Y + Z - 0.5);
          }
          if (!on(x - 1, y)) {
            ctx.moveTo(X + 0.5, Y);
            ctx.lineTo(X + 0.5, Y + Z);
          }
          if (!on(x + 1, y)) {
            ctx.moveTo(X + Z - 0.5, Y);
            ctx.lineTo(X + Z - 0.5, Y + Z);
          }
        }
      ctx.stroke();
      // Two colours' marks, by shape and the app's colours (a gapped +, ○, ◇).
      const mist = css.getPropertyValue('--sky-mist').trim() || '#d2cbc2';
      const lilac = css.getPropertyValue('--sky-predicted').trim() || '#a9a4c9';
      for (const m of p.marks ?? []) {
        const X = (m.x + 0.5) * Z;
        const Y = (n - 1 - m.y + 0.5) * Z;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (m.kind === 'neighbour') {
          ctx.strokeStyle = mist;
          ctx.arc(X, Y, 6, 0, 2 * Math.PI);
        } else if (m.kind === 'target') {
          ctx.strokeStyle = lilac;
          ctx.moveTo(X, Y - 7);
          ctx.lineTo(X + 7, Y);
          ctx.lineTo(X, Y + 7);
          ctx.lineTo(X - 7, Y);
          ctx.closePath();
        } else {
          ctx.strokeStyle = star;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            ctx.moveTo(X + dx * 2, Y + dy * 2);
            ctx.lineTo(X + dx * 6, Y + dy * 6);
          }
        }
        ctx.stroke();
      }
      if (p.ring) {
        ctx.strokeStyle = star;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc((p.ring[0] + 0.5) * Z, (n - 1 - p.ring[1] + 0.5) * Z, 3 * Z, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    return h('figure', {}, c, h('figcaption', {}, p.caption));
  });
}

function cardShell(card: Card): HTMLElement {
  const panels = h('div', { class: 'fg-panels' });
  void drawPanels(card)
    .then((els) => panels.replaceChildren(...els))
    .catch(() => panels.replaceChildren(h('p', { class: 'hint' }, t.loadFailed)));
  const s = card.source;
  return h(
    'article',
    { class: 'fg-card', id: card.id },
    h('h3', {}, card.title),
    h('p', { class: 'fg-looks' }, t.looksLike, ' ', card.looksLike),
    panels,
    card.panels.some((p) => p.marks?.length) ? h('p', { class: 'fg-key' }, t.marksKey) : null,
    h('p', { class: 'fg-key' }, t.hatchKey),
    h(
      'p',
      { class: `fg-label ${card.label}` },
      card.label === 'confirmed' ? t.confirmed : t.flagged,
    ),
    h('ul', { class: 'fg-evidence' }, ...card.evidence.map((e) => h('li', {}, e))),
    h('p', { class: 'fg-how' }, h('b', {}, t.howToTell), ' ', card.howToTell),
    h(
      'p',
      { class: 'fg-source' },
      `${s.photos.join(', ')} · ${s.date} · ${s.detector} · ${s.lambda}`,
      s.at ? ' · ' : '',
      s.at ? h('a', { href: `./?at=${s.at}` }, t.openSpot) : '',
    ),
  );
}

async function main(): Promise<void> {
  const back = h('a', { class: 'credits-back home', href: './' }, markSvg(), h('span', {}, t.back));
  // Back to where the visitor came from, when that's this site (Viewer).
  back.addEventListener('click', (e) => {
    if (document.referrer && new URL(document.referrer).origin === location.origin) {
      e.preventDefault();
      history.back();
    }
  });
  root.append(back, h('h1', {}, t.title), h('p', { class: 'lede' }, t.lede));
  let cards: Card[] = [];
  try {
    const r = await fetch(`${BASE}cards.json`);
    if (r.ok) cards = ((await r.json()) as { cards: Card[] }).cards;
  } catch {
    /* shown below */
  }
  if (!cards.length) {
    root.append(h('p', { class: 'hint' }, t.loadFailed));
    return;
  }
  for (const [section, heading] of [
    ['not-in-sky', t.notInSky],
    ['in-sky', t.inSkyNotNew],
  ] as const) {
    const these = cards.filter((c) => c.section === section);
    if (!these.length) continue;
    root.append(h('h2', {}, heading), h('div', { class: 'fg-grid' }, ...these.map(cardShell)));
  }
  root.append(
    h('p', { class: 'hint fg-note' }, t.note),
    h('p', { class: 'hint fg-note' }, t.stretch),
  );
}

void main();
