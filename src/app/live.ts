/**
 * Planning a live look at any spot: which of its photos to show. The same rules as the packs:
 * passes split at gaps of more than 60 days, and a fair comparison is a same-colour pair (same
 * detector, wavelength within half a resolution element) from two different passes. When there
 * isn't one, the plan says why, and the viewer says so instead of showing an unfair pair.
 * (DR1 + QR3: the colour at the spot comes from probing each photo's own file; see main.ts.)
 */

import {
  halfResolutionUm,
  pickSameColourPair,
  type Detector,
  type PairCandidate,
  type SameColourPair,
} from '../data/colour/cwave';

/** At most this many photos in a live flipbook: enough to see change, quick to load. */
export const MAX_LOOK_PHOTOS = 8;

export interface LiveCandidate<H> extends PairCandidate {
  hit: H;
}

export type LookPlan<H> =
  | { kind: 'none' }
  | { kind: 'one-season'; total: number; firstMjd: number; lastMjd: number }
  | { kind: 'no-pair'; total: number; firstMjd: number; lastMjd: number; seasons: number }
  | {
      kind: 'pair';
      total: number;
      firstMjd: number;
      lastMjd: number;
      seasons: number;
      pair: SameColourPair & { a: LiveCandidate<H>; b: LiveCandidate<H> };
      /** The photos to show, oldest first: the pair, plus others in the same colour. */
      set: LiveCandidate<H>[];
      /** Every photo of the spot, for the dock's dots by date and colour. */
      all: LiveCandidate<H>[];
    };

/**
 * The fair pair among photos whose colour at the spot is known. The first two seasons, as the
 * packs show by default; then any other pair of seasons. Within those, the shortest-wavelength
 * detector with a fair pair: most stars are brightest there, so the look shows the most.
 * (Fairness is the same on every detector.)
 */
export function planCandidates<H>(
  candidates: LiveCandidate<H>[],
  meta: { total: number; firstMjd: number; lastMjd: number; seasons: number },
): LookPlan<H> {
  const { total, firstMjd, lastMjd, seasons } = meta;
  const tries: [number, number][] = [];
  for (let a = 0; a < seasons; a++) for (let b = a + 1; b < seasons; b++) tries.push([a, b]);
  const detectors: Detector[] = [1, 2, 3, 4, 5, 6];
  for (const [a, b] of tries) {
    let pair: SameColourPair | null = null;
    for (const d of detectors) {
      pair = pickSameColourPair(
        candidates.filter((c) => c.detector === d),
        a,
        b,
      );
      if (pair) break;
    }
    if (pair) {
      const p = pair as SameColourPair & { a: LiveCandidate<H>; b: LiveCandidate<H> };
      return {
        kind: 'pair',
        total,
        firstMjd,
        lastMjd,
        seasons,
        pair: p,
        set: sameColourSet(p, candidates),
        all: candidates,
      };
    }
  }
  return { kind: 'no-pair', total, firstMjd, lastMjd, seasons };
}

/**
 * Every usable photo in the pair's colour (same detector, within half a resolution element
 * of the pair's mean wavelength), thinned evenly through time to at most MAX_LOOK_PHOTOS,
 * always keeping the pair itself. Oldest first.
 */
export function sameColourSet<C extends PairCandidate>(pair: { a: C; b: C }, candidates: C[]): C[] {
  const lambda = (pair.a.lambdaUm + pair.b.lambdaUm) / 2;
  const tol = halfResolutionUm(pair.a.detector, lambda);
  const all = candidates
    .filter(
      (c) =>
        c.detector === pair.a.detector &&
        !c.colourUncertain &&
        Math.abs(c.lambdaUm - lambda) <= tol,
    )
    .sort((x, y) => x.mjd - y.mjd);
  if (all.length <= MAX_LOOK_PHOTOS) return all;
  const keep = new Set([pair.a, pair.b]);
  const others = all.filter((c) => !keep.has(c));
  const room = MAX_LOOK_PHOTOS - keep.size;
  for (let i = 0; i < room; i++) {
    const c = others[Math.round(((i + 0.5) * others.length) / room - 0.5)];
    if (c) keep.add(c);
  }
  return all.filter((c) => keep.has(c));
}

/** DR1 + QR3: photos to probe per detector and pass before the colour at the spot is known. */
export const PROBES_PER_GROUP = 6;

/**
 * Which photos to probe (DR1 + QR3 learns the colour at the spot only from each file): per pass
 * and detector, up to `per` photos spread evenly through time, so the probes see the spread of
 * colours the scan put on the spot. Returned round-robin across those groups (each group's
 * first pick, then each group's second, …), so every pass and detector is covered early and the
 * probing can stop as soon as a fair pair turns up. Indices into `photos`.
 */
export function probeChoice(
  photos: { mjd: number; det: number }[],
  seasons: number[],
  per = PROBES_PER_GROUP,
): number[] {
  const groups = new Map<string, number[]>();
  photos.forEach((p, i) => {
    const key = `${seasons[i] ?? 0}:${p.det}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  const picks = [...groups.values()].map((g) => {
    g.sort((a, b) => (photos[a]?.mjd ?? 0) - (photos[b]?.mjd ?? 0));
    if (g.length <= per) return g;
    return Array.from({ length: per }, (_, k) => g[Math.floor(((k + 0.5) * g.length) / per)] ?? 0);
  });
  const out: number[] = [];
  for (let k = 0; k < per; k++) for (const g of picks) if (k < g.length) out.push(g[k] ?? 0);
  return out;
}
