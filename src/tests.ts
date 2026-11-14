/**
 * "How we tested" (tests.html): the challenge's five as a benchmark, then the tests of our method
 * we added, then the checks of our own machinery (Viewer, 14 Nov). Facts in columns, not grades.
 * Every number for the five comes from the same packs and the same functions as the tool's own
 * pages (showFor), so this page can't disagree with them; the added tests read their committed
 * run outputs in data/tests/.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/credits.css';
import './styles/tests.css';
import './styles/mark.css';
import { copy } from './copy/en';
import { h } from './ui/dom';
import { markSvg } from './ui/mark';
import { watchScheme } from './ui/scheme';
import { loadPack, type LoadedPack } from './data/pack/load';
import { predictionLabel, showFor } from './app/shows';
import { PACK_RELEASES, WANDERERS } from './app/targets';
import { monthYear } from './ui/numbers';
import type { TargetId } from './data/pack/types';

watchScheme();

const t = copy.tests;
const root = document.getElementById('tests') as HTMLElement;
const BASE = import.meta.env.BASE_URL;
/** The challenge's order. */
const ORDER: TargetId[] = ['barnard', 'epsind-b', 'w0855', 'rw-aur', 'r-dra'];
/** Where "try the live tool" goes: the challenge's own position for WISE 0855, else the catalogue's. */
const CHALLENGE_AT: Partial<Record<TargetId, string>> = { w0855: '133.795129,-7.245147' };

const fixed = (v: number, d = 1) => v.toFixed(d);

function passMonth(pack: LoadedPack, season: number): string {
  const f = pack.manifest.frames.filter((x) => x.season === season);
  return f.length ? monthYear(f.reduce((a, x) => a + x.mjd, 0) / f.length) : '';
}

/** The "Measured" cell: a dot (ember when measured) and the pack's own numbers. */
function measured(pack: LoadedPack): { done: boolean; lines: string[] } {
  const show = showFor(pack);
  const scale = pack.manifest.grid.pixelScaleArcsec;
  if (show.kind === 'motion') {
    const lines = [
      t.movedMeasured(
        fixed(show.lengthArcsec),
        fixed(show.measuredError * scale),
        show.direction,
        passMonth(pack, show.seasons[0]),
        passMonth(pack, show.seasons[1]),
      ),
    ];
    if (show.predictedArcsec !== null)
      lines.push(
        t.predicted(fixed(show.predictedArcsec), predictionLabel(show.predictionSource ?? '')),
      );
    if (show.stillStar) lines.push(t.stillStars(fixed(show.stillStar.median, 2)));
    return { done: true, lines };
  }
  const b = pack.measurements.find((m) => m.key === 'brightness-change');
  if (b?.status === 'MEASURED' && b.value != null)
    return {
      done: true,
      lines: [
        t.brightness(
          b.value < 1 ? 'Fainter' : 'Brighter',
          fixed(b.value, 2),
          fixed(b.error ?? 0, 2),
        ),
      ],
    };
  const why = b?.basis.find((x) => /vary|glare|too few/.test(x)) ?? b?.basis[0] ?? '';
  return { done: false, lines: [t.notMeasured(why || copy.statusChip.unmeasured)] };
}

function fiveRow(id: TargetId, pack: LoadedPack | null): HTMLElement {
  const f = t.five[id];
  const w = WANDERERS.find((x) => x.id === id);
  if (!f || !w) return h('div');
  const m = pack ? measured(pack) : { done: false, lines: ['—'] };
  const at = CHALLENGE_AT[id] ?? `${w.at.ra},${w.at.dec}`;
  const eye = pack?.manifest.eye.status ?? 'untested';
  return h(
    'article',
    { class: 'test' },
    h(
      'div',
      { class: 'test-row' },
      h(
        'div',
        { class: 'test-name' },
        h('h3', {}, copy.wanderers[id].name),
        // The challenge's own words only where they add meaning (ε Indi B's "a pair…").
        f.quote ? h('q', {}, f.quote) : null,
        h('p', { class: 'hard' }, f.hard),
        h(
          'p',
          { class: 'links' },
          h('a', { href: `./?target=${id}` }, t.open),
          h('a', { href: `./?entry=inside&at=${at}` }, t.tryLive),
        ),
      ),
      h('div', { class: 'cell', 'data-label': t.columns.seen }, t.seen[eye] ?? ''),
      h(
        'div',
        { class: 'cell', 'data-label': t.columns.measured },
        h('span', { class: m.done ? 'dot measured' : 'dot', 'aria-hidden': 'true' }),
        h(
          'span',
          {},
          ...(m.done ? m.lines : [t.notMeasuredSee]).map((l) => h('span', { class: 'line' }, l)),
        ),
      ),
      h(
        'div',
        { class: 'cell limit', 'data-label': t.columns.limit },
        h(
          'span',
          {},
          h('span', { class: 'line' }, f.limit),
          h(
            'span',
            { class: 'line live' },
            h('b', {}, `${CHALLENGE_AT[id] ? t.liveAtChallenge : t.liveAtCatalogue}: `),
            f.live,
          ),
        ),
      ),
    ),
    f.earlier ? h('p', { class: 'earlier' }, h('b', {}, `${t.earlierLabel}: `), f.earlier) : null,
  );
}

type PairRun = {
  seasons: [number, number];
  targetRank: number | null;
  nCandidates: number;
  candidates: { arcsecPerYr: number | null }[];
};
type Twins1 = { medianTwin: number; medianRandom: number; spearmanPC1: number };
type Twins2 = {
  euclid4: {
    sameField: { observed: number; expectedIfNoField: number };
    w1w2_resid: { ratio: number } | null;
  };
};

async function json<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}data/tests/${path}`);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function block(title: string, ...body: (Node | string | null)[]): HTMLElement {
  return h('article', { class: 'test added' }, h('h3', {}, title), ...body);
}

async function methodTests(): Promise<HTMLElement[]> {
  const [pairs, tw1, tw2] = await Promise.all([
    json<Record<string, PairRun[]>>('season_pairs.json'),
    json<Twins1>('spectral_twins_v1.json'),
    json<Twins2>('spectral_twins_v2.json'),
  ]);
  const out: HTMLElement[] = [];
  if (pairs) {
    const eps = pairs['epsind-b'] ?? [];
    const hits = eps.filter((r) => r.targetRank === 1);
    const rates = hits
      .map((r) => r.candidates[0]?.arcsecPerYr)
      .filter((v): v is number => v != null);
    const all = Object.values(pairs).flat();
    const falseAlarms = all.reduce((n, r) => n + r.nCandidates - (r.targetRank ? 1 : 0), 0);
    const sp = t.seasonPairs;
    out.push(
      block(
        sp.title,
        h('p', {}, sp.what),
        h('p', { class: 'result' }, sp.result(hits.length, eps.length, falseAlarms, all.length)),
        rates.length
          ? h('p', {}, sp.rate(fixed(Math.min(...rates), 2), fixed(Math.max(...rates), 2)))
          : null,
        h('p', { class: 'limit' }, sp.limit),
        h(
          'p',
          { class: 'reg' },
          sp.registered,
          ' ',
          h('a', { href: `${BASE}data/tests/season_pairs.json` }, sp.output),
        ),
      ),
    );
  }
  out.push(
    block(
      t.yardstick.title,
      h('p', {}, t.yardstick.what),
      h('p', { class: 'reg' }, t.yardstick.status),
    ),
  );
  if (tw1) {
    const v2 = tw2?.euclid4;
    out.push(
      block(
        t.twins.title,
        h('p', {}, t.twins.what),
        h(
          'p',
          { class: 'result' },
          t.twins.v1(fixed(tw1.medianTwin / tw1.medianRandom, 2), fixed(tw1.spearmanPC1, 2)),
        ),
        v2 && v2.w1w2_resid
          ? h(
              'p',
              { class: 'limit' },
              t.twins.v2(
                `${Math.round(v2.sameField.observed * 100)}%`,
                `${Math.round(v2.sameField.expectedIfNoField * 100)}%`,
                fixed(v2.w1w2_resid.ratio, 2),
              ),
            )
          : null,
        h(
          'p',
          { class: 'reg' },
          t.twins.registered,
          ' ',
          h('a', { href: `${BASE}data/tests/spectral_twins_v1.json` }, 'v1'),
          ' · ',
          h('a', { href: `${BASE}data/tests/spectral_twins_v2.json` }, 'v2'),
        ),
      ),
    );
  }
  out.push(
    block(
      t.outlier.title,
      h('p', {}, t.outlier.what),
      h('p', { class: 'result' }, t.outlier.result),
    ),
  );
  return out;
}

async function main(): Promise<void> {
  const packs = await Promise.all(
    ORDER.map(async (id) => {
      for (const rel of PACK_RELEASES) {
        try {
          return await loadPack(rel, id);
        } catch {
          /* next release */
        }
      }
      return null;
    }),
  );
  root.replaceChildren(
    h('a', { class: 'credits-back home', href: './' }, markSvg(), h('span', {}, t.back)),
    h('h1', {}, t.title),
    h('p', { class: 'lede' }, t.lede),
    h(
      'figure',
      { class: 'challenge' },
      h('blockquote', { cite: t.challengeLink }, t.challengeQuote),
      h('figcaption', {}, h('a', { href: t.challengeLink, rel: 'noopener' }, t.challengeSource)),
    ),
    h('h2', {}, t.groups.five),
    h(
      'div',
      { class: 'test-head', 'aria-hidden': 'true' },
      h('span'),
      h('span', {}, t.columns.seen),
      h('span', {}, t.columns.measured),
      h('span', {}, t.columns.limit),
    ),
    ...ORDER.map((id, i) => fiveRow(id, packs[i] ?? null)),
    h('p', { class: 'note' }, t.liveNote),
    h('h2', {}, t.groups.method),
    ...(await methodTests()),
    h('h2', {}, t.groups.machinery),
    h('p', { class: 'hint' }, h('a', { href: 'fieldguide.html' }, copy.fieldguide.fromTests)),
    ...t.machinery.map((m) => block(m.title, h('p', { class: 'result' }, m.result))),
    h('h2', {}, t.afterTitle),
    h('p', {}, t.afterLede),
    h('ul', { class: 'after' }, ...t.after.map((a) => h('li', {}, a))),
    h('p', {}, t.afterDesigned),
    h('p', { class: 'note' }, t.afterPending),
    h('p', { class: 'not-used' }, t.notUsed),
    h('footer', {}, h('span', {}, t.footer)),
  );
}

void main();
