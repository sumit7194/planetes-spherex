/**
 * Wavelength at any detector pixel, from the bundled CWAVE grid (Physics, per release),
 * and same-colour pair selection.
 *
 * Grid file: float32 little-endian, [detector 1..6][CWAVE, CBAND][row node][column node], µm,
 * bilinear between nodes in full-frame 0-based pixels. Accurate to 0.02–0.045 of half a
 * resolution element at the 99th percentile; a few known pixels miss by more and are listed
 * separately as "colour uncertain".
 */

export type Detector = 1 | 2 | 3 | 4 | 5 | 6;

/** Spectral resolving power λ/Δλ per detector (QR2). */
export const RESOLVING_POWER: Record<Detector, number> = {
  1: 39,
  2: 41,
  3: 41,
  4: 35,
  5: 112,
  6: 128,
};

/** Half a resolution element at wavelength λ on a detector: the same-colour tolerance. */
export function halfResolutionUm(detector: Detector, lambdaUm: number): number {
  return lambdaUm / (2 * RESOLVING_POWER[detector]);
}

export class CwaveGrid {
  readonly #data: Float32Array;
  readonly #nodes: number[];
  readonly #n: number;

  constructor(buffer: ArrayBuffer, nodesPx: number[]) {
    const n = nodesPx.length;
    if (buffer.byteLength !== 6 * 2 * n * n * 4) {
      throw new Error(`grid is ${buffer.byteLength} bytes; expected ${6 * 2 * n * n * 4}`);
    }
    this.#data = new Float32Array(buffer);
    this.#nodes = nodesPx;
    this.#n = n;
  }

  /** Wavelength and bandwidth (µm) at pixel (x, y) of a detector. */
  at(detector: Detector, x: number, y: number): { lambdaUm: number; bandUm: number } {
    return { lambdaUm: this.#sample(detector, 0, x, y), bandUm: this.#sample(detector, 1, x, y) };
  }

  #sample(detector: Detector, plane: 0 | 1, x: number, y: number): number {
    const [r0, r1, fr] = this.#bracket(y);
    const [c0, c1, fc] = this.#bracket(x);
    const v = (r: number, c: number) => this.#data[this.#index(detector, plane, r, c)] ?? NaN;
    const top = v(r0, c0) * (1 - fc) + v(r0, c1) * fc;
    const bottom = v(r1, c0) * (1 - fc) + v(r1, c1) * fc;
    return top * (1 - fr) + bottom * fr;
  }

  #index(detector: Detector, plane: 0 | 1, row: number, col: number): number {
    const n = this.#n;
    return (((detector - 1) * 2 + plane) * n + row) * n + col;
  }

  /** Neighbouring node indices around a pixel coordinate, and the fraction between them. */
  #bracket(p: number): [number, number, number] {
    const nodes = this.#nodes;
    const last = nodes.length - 1;
    if (p <= (nodes[0] ?? 0)) return [0, 0, 0];
    if (p >= (nodes[last] ?? 0)) return [last, last, 0];
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((nodes[mid] ?? 0) <= p) lo = mid;
      else hi = mid;
    }
    const a = nodes[lo] ?? 0;
    const b = nodes[hi] ?? a + 1;
    return [lo, hi, (p - a) / (b - a)];
  }
}

export interface PairCandidate {
  id: string;
  detector: Detector;
  season: number;
  mjd: number;
  lambdaUm: number;
  colourUncertain?: boolean;
}

export interface SameColourPair {
  a: PairCandidate;
  b: PairCandidate;
  deltaLambdaUm: number;
  baselineDays: number;
}

/**
 * The best same-colour pair between two seasons: same detector, |Δλ| within half a resolution
 * element, smallest Δλ first, then the longest baseline. Returns null when none qualifies,
 * which the viewer turns into a kind refusal.
 */
export function pickSameColourPair(
  frames: PairCandidate[],
  seasonA: number,
  seasonB: number,
): SameColourPair | null {
  const usable = frames.filter((f) => !f.colourUncertain);
  const inA = usable.filter((f) => f.season === seasonA);
  const inB = usable.filter((f) => f.season === seasonB);
  let best: SameColourPair | null = null;
  for (const a of inA) {
    for (const b of inB) {
      if (a.detector !== b.detector) continue;
      const deltaLambdaUm = Math.abs(a.lambdaUm - b.lambdaUm);
      if (deltaLambdaUm > halfResolutionUm(a.detector, (a.lambdaUm + b.lambdaUm) / 2)) continue;
      const pair = { a, b, deltaLambdaUm, baselineDays: Math.abs(b.mjd - a.mjd) };
      if (
        !best ||
        deltaLambdaUm < best.deltaLambdaUm ||
        (deltaLambdaUm === best.deltaLambdaUm && pair.baselineDays > best.baselineDays)
      ) {
        best = pair;
      }
    }
  }
  return best;
}
