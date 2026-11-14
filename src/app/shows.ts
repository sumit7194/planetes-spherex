/**
 * What each wanderer's show can honestly say, derived from its pack, never hard-coded:
 *  - a motion show (measured shift beside its prediction, over a named pair of seasons), or
 *  - a status show (no measured change; the pack's status says why).
 */

import type { LoadedPack } from '../data/pack/load';
import type { EyeStatus, Measurement, Status } from '../data/pack/types';

export interface Vector {
  east: number;
  north: number;
}

export interface MotionShow {
  kind: 'motion';
  seasons: [number, number];
  measured: Vector;
  /** 1σ error of the total length, propagated from the east and north errors. */
  measuredError: number;
  predicted: Vector | null;
  /** Total length in pixels and arcseconds. */
  lengthPx: number;
  lengthArcsec: number;
  predictedArcsec: number | null;
  /** Compass direction of the move, e.g. "north" or "south-west". */
  direction: string;
  /** Measurements from a second, independent detector group that agree, if any. */
  agreesWith: string | null;
  /**
   * Still stars in the same photos. `common` is the shift they all share (length, px), set only
   * when it is clearly non-zero; the headline is then measured relative to them.
   */
  stillStar: {
    median: number;
    p90: number | null;
    common: number | null;
    /** Pack keys, for data-claim markup: the median, the 90th percentile, the common shift. */
    key: string;
    p90Key: string | null;
    commonKeys: [string, string] | null;
  } | null;
  /** Photos per season the move was measured on, from the pack's basis (e.g. [14, 12]). */
  measuredOn: number[];
  /** Where the prediction comes from, from the pack: e.g. "Gaia DR3 … plus parallax". */
  predictionSource: string | null;
  /** How the move was measured, the first clause of the pack's method (e.g. "PSF wing fit"). */
  measuredBy: string | null;
  /** True when the headline shift is measured against the still stars in the same photos. */
  relative: boolean;
  eye: EyeStatus;
  /** The pack keys the headline comes from, for data-claim markup (Physics' checker). */
  keys: { north: string; east: string };
}

export interface StatusShow {
  kind: 'status';
  seasons: [number, number];
  status: Status;
  eye: EyeStatus;
  /**
   * Set when the visitor chose a season pair without a trusted number: 'unmeasured' (no keys
   * for it) or 'unverified' (keys present, but their status isn't MEASURED).
   */
  pairNote?: 'unmeasured' | 'unverified';
}

export type Show = MotionShow | StatusShow;

const find = (pack: LoadedPack, ...keys: string[]): Measurement | undefined =>
  keys.map((k) => pack.measurements.find((m) => m.key === k)).find((m) => m !== undefined);

/** Season pair from a method string like "season 0 -> 2", else the first and last seasons. */
export function seasonsFor(pack: LoadedPack, m?: Measurement): [number, number] {
  const hit = m?.method.match(/season (\d+)\s*->\s*(\d+)/);
  if (hit) return [Number(hit[1]), Number(hit[2])];
  const seasons = [...new Set(pack.manifest.stacks.map((s) => s.season))].sort((a, b) => a - b);
  return [seasons[0] ?? 0, seasons[seasons.length - 1] ?? 1];
}

export function compass({ east, north }: Vector): string {
  const deg = (Math.atan2(east, north) * 180) / Math.PI; // 0 = north, 90 = east
  const names = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'north';
}

/** "season 0: 14 exposures", "season 1: 12 exposures" → [14, 12], in the order written. */
export function photoCounts(basis: string[]): number[] {
  return basis.flatMap((b) => [...b.matchAll(/(\d+) exposures/g)].map((m) => Number(m[1])));
}

/** A short name for a prediction's source: "Gaia DR3 proper motion + parallax", say. */
export function predictionLabel(source: string): string {
  const px = /parallax/i.test(source) ? ' + parallax' : '';
  // ε Indi B isn't in Gaia: its prediction is ε Indi A's motion, which B shares (Viewer, 14 Nov).
  if (/Gaia DR3/i.test(source) && /Indi A|shared motion/i.test(source))
    return `Gaia DR3 motion of ε Indi A (which B shares)${px}`;
  const catalogue = /CatWISE/i.test(source)
    ? 'CatWISE2020'
    : /Gaia DR3/i.test(source)
      ? 'Gaia DR3'
      : /Luhman\s*&\s*Esplin\s*2016/i.test(source)
        ? 'Luhman & Esplin 2016'
        : 'catalogue';
  return `${catalogue} proper motion${px}`;
}

/** Seasons that have an all-colour stack, in order (0, 1, 2 for a three-pass pack). */
export function seasonsIn(pack: LoadedPack): number[] {
  return [
    ...new Set(pack.manifest.stacks.filter((s) => s.kind === 'all-colour').map((s) => s.season)),
  ].sort((a, b) => a - b);
}

/** The pair the pack's headline measurement was made over. */
export function primaryPair(pack: LoadedPack): [number, number] {
  return seasonsFor(pack, find(pack, 'shift-north-px', 'shift-north-px-detectors-1-3'));
}

const samePair = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/**
 * The show for one season pair. The headline pair uses the plain keys; any other pair uses the
 * same keys with a `-s<a>s<b>` suffix (Physics' convention), and says so when none was measured.
 */
export function showFor(pack: LoadedPack, pair?: [number, number]): Show {
  const primary = primaryPair(pack);
  if (pair && !samePair(pair, primary)) {
    // No measured move at all (a brightness target): a pair only picks which looks to show,
    // and the pack's own status stands; no pair has a number to point at.
    const base = showForPrimary(pack);
    if (base.kind === 'status') return { ...base, seasons: pair };
    const suffix = `-s${pair[0]}s${pair[1]}`;
    const suffixed: Measurement[] = pack.measurements
      .filter((m) => m.key.endsWith(suffix))
      .map((m) => ({ ...m, key: m.key.slice(0, -suffix.length), method: m.method }));
    // Same fallback as the headline: all detectors, else detector group 1–3 (ε Indi B).
    const north = ['shift-north-px', 'shift-north-px-detectors-1-3']
      .map((k) => suffixed.find((m) => m.key === k))
      .find((m) => m !== undefined);
    if (!north || north.status !== 'MEASURED') {
      // Only a MEASURED pair gets a number; the pack's status is the claim, not this code.
      return {
        kind: 'status',
        seasons: pair,
        status: north?.status ?? 'NOT_MEASURABLE_YET',
        eye: pack.manifest.eye.status,
        pairNote: north ? 'unverified' : 'unmeasured',
      };
    }
    const show = showFor({ ...pack, measurements: suffixed });
    if (show.kind !== 'motion') return { ...show, seasons: pair };
    // Report the pack's real (suffixed) keys, so on-screen claims point at the right numbers.
    const k = (key: string) => key + suffix;
    const still = show.stillStar;
    return {
      ...show,
      seasons: pair,
      keys: { north: k(show.keys.north), east: k(show.keys.east) },
      stillStar: still && {
        ...still,
        key: k(still.key),
        p90Key: still.p90Key && k(still.p90Key),
        commonKeys: still.commonKeys && [k(still.commonKeys[0]), k(still.commonKeys[1])],
      },
    };
  }
  return showForPrimary(pack);
}

/**
 * A brightness test by scatter (RW Aur on DR1+QR3): per detector, the target's scatter divided
 * by the largest comparison star's (above 1 = more than every one of them), with how many
 * comparison stars that detector had. Null when the pack has no such test (the QR2 pack).
 */
export interface ScatterTest {
  detectors: { detector: number; ratio: number; controls: number | null }[];
  /** Detectors where the target scatters more than every comparison star. */
  above: number[];
  /** Of those, the ones with too few comparison stars for that to mean much (see FEW_CHANCE). */
  thin: number[];
}

/**
 * Physics, 13 Nov: a target as steady as its n comparison stars, measured the same way, ranks
 * above all of them by chance 1 in (n + 1). A range is "thin" when that chance is over 5%
 * (n < 19). Fair for a saturated target too: each comparison star is also fitted with its centre
 * masked to the target's radius. Not checked: saturation disturbing pixels just outside that radius.
 */
export const FEW_CHANCE = 0.05;
export const chanceAboveAll = (controls: number): number => 1 / (controls + 1);

export function scatterTest(pack: LoadedPack): ScatterTest | null {
  const detectors = pack.measurements
    .map((m) => ({ m, d: m.key.match(/^scatter-ratio-detector-(\d)$/) }))
    .filter(({ m, d }) => d && m.status === 'MEASURED' && m.value != null)
    .map(({ m, d }) => {
      const n = m.basis.join(' ').match(/(\d+) control stars/);
      return { detector: Number(d?.[1]), ratio: m.value ?? 0, controls: n ? Number(n[1]) : null };
    })
    .sort((a, b) => a.detector - b.detector);
  if (!detectors.length) return null;
  const above = detectors.filter((d) => d.ratio > 1);
  return {
    detectors,
    above: above.map((d) => d.detector),
    thin: above
      .filter((d) => d.controls != null && chanceAboveAll(d.controls) > FEW_CHANCE)
      .map((d) => d.detector),
  };
}

/** Keys for one measurement, preferring the all-detector value over detector group 1–3. */
const keysFor = (base: string) => [base, `${base}-detectors-1-3`];

function showForPrimary(pack: LoadedPack): Show {
  // The differential shift (target minus the still stars' shared shift) is preferred:
  // it removes a measured camera effect. The raw fit still names the season pair.
  const rawNorth = find(pack, ...keysFor('shift-north-px'));
  const relNorth = find(pack, ...keysFor('shift-north-px-relative-to-still-stars'));
  const relEast = find(pack, ...keysFor('shift-east-px-relative-to-still-stars'));
  const relative = relNorth?.value != null && relEast?.value != null;
  const north = relative ? relNorth : rawNorth;
  const east = relative ? relEast : find(pack, ...keysFor('shift-east-px'));
  const eye = pack.manifest.eye.status;
  if (north?.value == null || east?.value == null) {
    const status = find(pack, 'brightness-change')?.status ?? 'NO_DATA';
    return { kind: 'status', seasons: seasonsFor(pack), status, eye };
  }
  const measured = { east: east.value, north: north.value };
  const predicted =
    north.prediction && east.prediction
      ? { east: east.prediction.value, north: north.prediction.value }
      : null;
  const lengthPx = Math.hypot(measured.east, measured.north);
  const scale = pack.manifest.grid.pixelScaleArcsec;
  const se = east.error ?? 0;
  const sn = north.error ?? 0;
  const measuredError =
    lengthPx > 0
      ? Math.hypot(measured.east * se, measured.north * sn) / lengthPx
      : Math.max(se, sn);
  const second = find(pack, 'shift-north-px-detectors-4-6');
  // With a relative headline, the scatter that matters is what's left after the shared shift.
  const still =
    (relative ? find(pack, ...keysFor('still-star-residual-shift-px')) : undefined) ??
    find(pack, ...keysFor('still-star-shift-px'));
  const stillP90 =
    (relative ? find(pack, ...keysFor('still-star-residual-shift-p90-px')) : undefined) ??
    find(pack, ...keysFor('still-star-shift-p90-px'));
  const commonE = find(pack, ...keysFor('still-star-common-shift-east-px'));
  const commonN = find(pack, ...keysFor('still-star-common-shift-north-px'));
  const common =
    commonE?.value != null && commonN?.value != null
      ? {
          length: Math.hypot(commonE.value, commonN.value),
          error: Math.max(commonE.error ?? 0, commonN.error ?? 0),
        }
      : null;
  return {
    kind: 'motion',
    seasons: seasonsFor(pack, rawNorth),
    measured,
    measuredError,
    predicted,
    lengthPx,
    lengthArcsec: lengthPx * scale,
    predictedArcsec: predicted ? Math.hypot(predicted.east, predicted.north) * scale : null,
    direction: compass(measured),
    agreesWith: second?.value != null ? 'detectors-4-6' : null,
    stillStar:
      still?.value != null
        ? {
            median: still.value,
            p90: stillP90?.value ?? null,
            // "Clearly non-zero": more than three times its error.
            common: common && common.length > 3 * common.error ? common.length : null,
            key: still.key,
            p90Key: stillP90?.key ?? null,
            commonKeys: commonN && commonE ? [commonN.key, commonE.key] : null,
          }
        : null,
    measuredOn: photoCounts(rawNorth?.basis ?? []),
    measuredBy:
      rawNorth?.method
        .split(/[,(]/)[0]
        ?.replace(/ per exposure$/, '')
        .trim() || null,
    predictionSource: north.prediction?.source ?? rawNorth?.prediction?.source ?? null,
    relative,
    eye,
    keys: { north: north.key, east: east.key },
  };
}

/**
 * Brightness from the unsaturated edges of a saturated star's image (event pipeline, 14 Nov):
 * the later pass over the earlier, per detector, from photos paired at matching colours. Each
 * key is MEASURED only when two rings agree, the change beats 3× the total error (comparison
 * stars give the systematic part) and at least 10 pairs exist; otherwise its value is null.
 */
export interface BrightnessRatio {
  detector: number;
  ratio: number | null;
  error: number | null;
  status: Status;
  /** The comparison stars' systematic error, as a fraction (e.g. 0.059), if the basis says. */
  systematic: number | null;
  /**
   * The same method on Barnard's Star (saturated but steady): passed or failed in this
   * detector, with the ratios it gave there (1 = no change); null if the pack doesn't say.
   */
  steady: { passed: boolean; ratios: number[] } | null;
}

/** The headline pair of the brightness keys, from brightness-change's basis ("passes 1 -> 3"). */
export function brightnessPair(pack: LoadedPack): [number, number] | null {
  const m = find(pack, 'brightness-change');
  const hit = m?.basis.join(' ').match(/passes (\d+)\s*->\s*(\d+)/);
  return hit ? [Number(hit[1]) - 1, Number(hit[2]) - 1] : null;
}

/** Per-detector brightness ratios for a pair of passes: plain keys for the headline pair. */
export function brightnessRatios(pack: LoadedPack, pair: [number, number]): BrightnessRatio[] {
  const head = brightnessPair(pack);
  const suffix = head && samePair(pair, head) ? '' : `-s${pair[0]}s${pair[1]}`;
  const out: BrightnessRatio[] = [];
  for (let d = 1; d <= 6; d++) {
    const m = find(pack, `brightness-ratio-detector-${d}${suffix}`);
    if (!m) continue;
    const text = m.basis.join(' ');
    const sys = text.match(/systematic error (\d*\.?\d+)/);
    const test = text.match(
      /steady-star test (passed|failed)[^;]*?gives ([^,;]*(?:, s\d+s\d+ [\d.]+)*)/,
    );
    out.push({
      detector: d,
      ratio: m.status === 'MEASURED' ? m.value : null,
      error: m.status === 'MEASURED' ? (m.error ?? null) : null,
      status: m.status,
      systematic: sys ? Number(sys[1]) : null,
      steady: test
        ? {
            passed: test[1] === 'passed',
            ratios: [...(test[2] ?? '').matchAll(/s\d+s\d+ ([\d.]+)/g)].map((x) => Number(x[1])),
          }
        : null,
    });
  }
  return out;
}
