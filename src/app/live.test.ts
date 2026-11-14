import { describe, expect, it } from 'vitest';
import type { Detector } from '../data/colour/cwave';
import {
  clearestDetector,
  pairDetectors,
  planCandidates,
  probeChoice,
  type LiveCandidate,
} from './live';

/** A probed photo: detector d sees 1 µm × d (easy to reason about); passes split at day 200. */
let n = 0;
function photo(mjd: number, detector: Detector, lambdaUm: number = detector): LiveCandidate<null> {
  return { id: String(n++), detector, season: mjd < 200 ? 0 : 1, mjd, lambdaUm, hit: null };
}
const meta = (c: LiveCandidate<null>[]) => ({
  total: c.length,
  firstMjd: Math.min(...c.map((x) => x.mjd)),
  lastMjd: Math.max(...c.map((x) => x.mjd)),
  seasons: 2,
});

describe('planning a look', () => {
  it('refuses an unfair pair: no detector seen in both looks', () => {
    const c = [photo(100, 1), photo(300, 2)];
    expect(planCandidates(c, meta(c)).kind).toBe('no-pair');
  });

  it('refuses a pair more than half a resolution element apart in colour', () => {
    const c = [photo(100, 1, 1.0), photo(300, 1, 1.05)];
    expect(planCandidates(c, meta(c)).kind).toBe('no-pair');
  });

  it('picks the shortest-wavelength fair pair, across the two looks', () => {
    const c = [photo(100, 5), photo(101, 1), photo(300, 5), photo(302, 1)];
    const plan = planCandidates(c, meta(c));
    expect(plan.kind).toBe('pair');
    if (plan.kind !== 'pair') return;
    expect(plan.pair.a.detector).toBe(1);
    expect(plan.pair.b.detector).toBe(1);
    expect(plan.pair.a.season).not.toBe(plan.pair.b.season);
    expect(plan.total).toBe(4);
  });
});

describe('the photos a look shows', () => {
  it('takes every photo in the pair’s colour, oldest first, at most eight, keeping the pair', () => {
    const c = [
      ...Array.from({ length: 10 }, (_, i) => photo(100 + i, 1)),
      ...Array.from({ length: 10 }, (_, i) => photo(300 + i, 1)),
      photo(105, 5),
    ];
    const plan = planCandidates(c, meta(c));
    expect(plan.kind).toBe('pair');
    if (plan.kind !== 'pair') return;
    expect(plan.set.length).toBe(8);
    expect(plan.set).toContain(plan.pair.a);
    expect(plan.set).toContain(plan.pair.b);
    expect(plan.set.every((x) => x.detector === 1)).toBe(true);
    const mjds = plan.set.map((x) => x.mjd);
    expect(mjds).toEqual([...mjds].sort((x, y) => x - y));
    expect(new Set(plan.set.map((x) => x.season)).size).toBe(2);
  });
});

describe('probeChoice', () => {
  it('takes up to `per` photos per pass and detector, spread through time', () => {
    const photos = Array.from({ length: 20 }, (_, i) => ({ mjd: i, det: 1 }));
    photos.push({ mjd: 100, det: 1 }, { mjd: 101, det: 2 });
    const seasons = photos.map((p) => (p.mjd >= 100 ? 1 : 0));
    const pick = probeChoice(photos, seasons, 4);
    // Four of the twenty in pass 0 (evenly spread), and both single photos of pass 1, taken
    // round-robin across the three (pass, detector) groups.
    expect(pick.map((i) => photos[i]?.mjd)).toEqual([2, 100, 101, 7, 12, 17]);
  });
});

describe('choosing the colour', () => {
  it('plans one chosen colour on its own, and lists which colours have a fair pair', () => {
    const c = [photo(100, 5), photo(101, 1), photo(300, 5), photo(302, 1), photo(150, 3)];
    const plan = planCandidates(c, meta(c), 5);
    expect(plan.kind === 'pair' && plan.pair.a.detector).toBe(5);
    expect(planCandidates(c, meta(c), 3).kind).toBe('no-pair');
    expect(pairDetectors(c, meta(c))).toEqual([1, 5]);
  });

  it('takes the clearest colour only when it clears S/N 5; ties go to the shorter colour', () => {
    const s = (e: [Detector, number | null][]) => new Map<Detector, number | null>(e);
    expect(
      clearestDetector(
        s([
          [1, 2],
          [5, 25],
          [6, 22],
        ]),
      ),
    ).toBe(5);
    expect(
      clearestDetector(
        s([
          [1, 3],
          [5, 4.9],
        ]),
      ),
    ).toBeNull();
    expect(
      clearestDetector(
        s([
          [2, 8],
          [4, 8],
        ]),
      ),
    ).toBe(2);
    expect(
      clearestDetector(
        s([
          [1, null],
          [3, Number.NaN],
          [6, 6],
        ]),
      ),
    ).toBe(6);
    expect(clearestDetector(s([]))).toBeNull();
  });
});
