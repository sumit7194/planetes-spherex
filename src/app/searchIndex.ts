/**
 * Search as you type (Sumit, 14 Nov): a small in-browser index of every name the page knows
 * (the five and their aliases, the surprise spots, the IAU-named stars, the constellations),
 * ranked per keystroke, plus "what's near here" for any position. SIMBAD (through the helper's
 * /v1/resolve) answers anything else; that's the page's job, not this module's.
 */
import { separationDeg, type SkyPosition } from '../data/coords';

export type EntryKind = 'test' | 'surprise' | 'star' | 'constellation';

export interface Entry {
  /** Stable id: one per object, shared by its aliases. */
  id: string;
  /** The name to show. */
  name: string;
  /** Every name it answers to (the shown name included). */
  names: string[];
  kind: EntryKind;
  at: SkyPosition;
  /** Visual magnitude, for ordering stars (brighter first). */
  mag?: number;
}

export interface Match {
  entry: Entry;
  score: number;
  /** How well the name itself matched: 1000 exact, ~800 prefix, 600 word starts, 400 inside, ≤200 one typo. */
  base: number;
}

const GREEK: [string, string, string[]][] = [
  ['α', 'alpha', ['alf', 'alp']],
  ['β', 'beta', ['bet']],
  ['γ', 'gamma', ['gam']],
  ['δ', 'delta', ['del']],
  ['ε', 'epsilon', ['eps']],
  ['ζ', 'zeta', ['zet']],
  ['η', 'eta', []],
  ['θ', 'theta', ['the', 'tet']],
  ['ι', 'iota', ['iot']],
  ['κ', 'kappa', ['kap']],
  ['λ', 'lambda', ['lam']],
  ['μ', 'mu', []],
  ['ν', 'nu', []],
  ['ξ', 'xi', []],
  ['ο', 'omicron', ['omi']],
  ['π', 'pi', []],
  ['ρ', 'rho', []],
  ['σ', 'sigma', ['sig']],
  ['τ', 'tau', []],
  ['υ', 'upsilon', ['ups']],
  ['φ', 'phi', []],
  ['χ', 'chi', []],
  ['ψ', 'psi', []],
  ['ω', 'omega', ['ome']],
];
const ABBREV = new Map(GREEK.flatMap(([, full, abbr]) => abbr.map((a) => [a, full] as const)));

/**
 * Lower case, no accents or apostrophes, Greek letters and their catalogue abbreviations as
 * names ("ε", "eps" → "epsilon"), other punctuation as spaces, single spaces.
 */
export function normalise(s: string): string {
  let t = s.toLowerCase();
  for (const [ch, full] of GREEK) t = t.split(ch).join(` ${full} `);
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => ABBREV.get(w) ?? w)
    .join(' ');
}

const KIND_WEIGHT: Record<EntryKind, number> = {
  test: 60,
  surprise: 40,
  star: 20,
  constellation: 10,
};

/** Optimal string alignment distance, capped: is `a` within one edit of `b`? */
function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const rest = (x: string, y: string) => x === y;
  return (
    rest(a.slice(i + 1), b.slice(i + 1)) || // substitution
    rest(a.slice(i + 1), b.slice(i)) || // deletion
    rest(a.slice(i), b.slice(i + 1)) || // insertion
    (a[i] === b[i + 1] && a[i + 1] === b[i] && rest(a.slice(i + 2), b.slice(i + 2))) // swap
  );
}

/** How well one name answers a query (0: not at all). Both already normalised. */
function nameScore(name: string, q: string): number {
  if (!q) return 0;
  const n = name.replace(/ /g, '');
  const qc = q.replace(/ /g, '');
  if (n === qc) return 1000;
  if (n.startsWith(qc)) return 800 - Math.min(100, n.length - qc.length);
  const words = name.split(' ');
  const qw = q.split(' ');
  // Every typed word starts some word of the name, in order ("barn st", "eps ind b").
  let k = 0;
  for (const w of words) if (k < qw.length && w.startsWith(qw[k] ?? '')) k++;
  if (k === qw.length) return 600;
  if (qc.length >= 4 && n.includes(qc)) return 400;
  // One typo, on a prefix of the same length (from 4 letters on: "barnrd", "betelguese").
  if (qc.length >= 4 && withinOne(n.slice(0, qc.length), qc)) return 200;
  if (qc.length >= 4 && withinOne(n.slice(0, qc.length + 1), qc)) return 190;
  return 0;
}

/** The best matches for what's typed so far, one per object. */
export function search(index: Entry[], query: string, limit = 6): Match[] {
  const q = normalise(query);
  if (!q) return [];
  const best = new Map<string, Match>();
  for (const e of index) {
    let base = 0;
    for (const nm of e.names) base = Math.max(base, nameScore(normalise(nm), q));
    if (!base) continue;
    const s = base + KIND_WEIGHT[e.kind] + (e.mag !== undefined ? Math.max(0, 6 - e.mag) * 2 : 0);
    const had = best.get(e.id);
    if (!had || had.score < s) best.set(e.id, { entry: e, score: s, base });
  }
  let out = [...best.values()].sort((a, b) => b.score - a.score);
  // A typo guess is noise once something matches as typed ("vega" mustn't offer Vela).
  if (out.some((m) => m.base >= 600)) out = out.filter((m) => m.base > 200);
  // One object under two names (Mira: a surprise spot and an IAU star): keep the first.
  const kept: Match[] = [];
  for (const m of out)
    if (!kept.some((k) => separationDeg(k.entry.at, m.entry.at) < 1 / 60)) kept.push(m);
  return kept.slice(0, limit);
}

/** Known things near a position, nearest first (the five always win ties), within `radiusDeg`. */
export function nearby(
  index: Entry[],
  at: SkyPosition,
  radiusDeg = 3,
  limit = 3,
  exclude?: string,
): { entry: Entry; sepDeg: number }[] {
  const seen = new Set<string>();
  const out: { entry: Entry; sepDeg: number }[] = [];
  for (const e of index) {
    if (e.id === exclude || seen.has(e.id) || e.kind === 'constellation') continue;
    const sepDeg = separationDeg(e.at, at);
    if (sepDeg <= radiusDeg) {
      out.push({ entry: e, sepDeg });
      seen.add(e.id);
    }
  }
  return out
    .sort(
      (a, b) =>
        a.sepDeg -
        b.sepDeg -
        (a.entry.kind === 'test' ? 0.5 : 0) +
        (b.entry.kind === 'test' ? 0.5 : 0),
    )
    .slice(0, limit);
}

/** A J2000 catalogue place moved to a later year by its proper motion (mas/yr). */
export function placeAt(
  p: SkyPosition,
  pmRaMasYr: number,
  pmDecMasYr: number,
  fromYear: number,
  toYear: number,
): SkyPosition {
  const dt = toYear - fromYear;
  const dec = p.dec + (pmDecMasYr * dt) / 3.6e6;
  const ra = p.ra + (pmRaMasYr * dt) / 3.6e6 / Math.max(1e-6, Math.cos((p.dec * Math.PI) / 180));
  return { ra: ((ra % 360) + 360) % 360, dec };
}
