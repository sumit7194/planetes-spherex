import { describe, expect, it } from 'vitest';
import { CwaveGrid, halfResolutionUm, pickSameColourPair, type PairCandidate } from './cwave';

/** A 3 × 3 node grid where CWAVE = detector + row/1000 and CBAND = 0.05 everywhere. */
function syntheticGrid(): CwaveGrid {
  const nodes = [0, 1000, 2039];
  const n = nodes.length;
  const data = new Float32Array(6 * 2 * n * n);
  for (let d = 1; d <= 6; d++) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        data[(((d - 1) * 2 + 0) * n + r) * n + c] = d + (nodes[r] ?? 0) / 1000;
        data[(((d - 1) * 2 + 1) * n + r) * n + c] = 0.05;
      }
    }
  }
  return new CwaveGrid(data.buffer, nodes);
}

describe('CwaveGrid', () => {
  const grid = syntheticGrid();

  it('returns node values exactly', () => {
    expect(grid.at(3, 0, 1000).lambdaUm).toBeCloseTo(4.0, 5);
    expect(grid.at(1, 2039, 2039).bandUm).toBeCloseTo(0.05, 6);
  });

  it('interpolates between unevenly spaced nodes and clamps at the edges', () => {
    expect(grid.at(2, 500, 500).lambdaUm).toBeCloseTo(2.5, 5);
    expect(grid.at(2, 500, 1519.5).lambdaUm).toBeCloseTo(3.5195, 4);
    expect(grid.at(2, -5, 3000).lambdaUm).toBeCloseTo(2 + 2.039, 4);
  });

  it('rejects a buffer of the wrong size', () => {
    expect(() => new CwaveGrid(new ArrayBuffer(16), [0, 1])).toThrow();
  });
});

describe('halfResolutionUm', () => {
  it('matches Physics: about 0.012 µm on D1 and 0.018 µm on D6', () => {
    expect(halfResolutionUm(1, 0.94)).toBeCloseTo(0.012, 3);
    expect(halfResolutionUm(6, 4.6)).toBeCloseTo(0.018, 3);
  });
});

describe('pickSameColourPair', () => {
  const f = (id: string, detector: 1 | 3 | 6, season: number, mjd: number, lambdaUm: number) =>
    ({ id, detector, season, mjd, lambdaUm }) satisfies PairCandidate;

  it('prefers the smallest colour difference, then the longest baseline', () => {
    const frames = [
      f('a1', 3, 0, 100, 1.92),
      f('a2', 3, 0, 90, 1.95),
      f('b1', 3, 1, 300, 1.94),
      f('b2', 3, 1, 320, 1.951),
    ];
    const pair = pickSameColourPair(frames, 0, 1);
    expect(pair?.a.id).toBe('a2');
    expect(pair?.b.id).toBe('b2');
    expect(pair?.deltaLambdaUm).toBeCloseTo(0.001, 6);
  });

  it('never pairs different detectors, and refuses when nothing is within half a resolution element', () => {
    expect(pickSameColourPair([f('a', 3, 0, 1, 1.92), f('b', 6, 1, 2, 1.92)], 0, 1)).toBeNull();
    expect(pickSameColourPair([f('a', 1, 0, 1, 0.9), f('b', 1, 1, 2, 0.95)], 0, 1)).toBeNull();
  });

  it('skips frames marked colour uncertain', () => {
    const frames = [{ ...f('a', 6, 0, 1, 4.6), colourUncertain: true }, f('b', 6, 1, 200, 4.6)];
    expect(pickSameColourPair(frames, 0, 1)).toBeNull();
  });
});
