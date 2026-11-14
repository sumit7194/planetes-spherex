import { describe, expect, it } from 'vitest';
import type { LoadedPack } from '../data/pack/load';
import type { Measurement, PackManifest } from '../data/pack/types';
import {
  brightnessPair,
  brightnessRatios,
  compass,
  photoCounts,
  predictionLabel,
  scatterTest,
  showFor,
} from './shows';

function pack(measurements: Partial<Measurement>[], seasons = [0, 1], eye = 'seen-with-ring') {
  const manifest = {
    grid: { pixelScaleArcsec: 6.15 },
    eye: { status: eye },
    stacks: seasons.map((season) => ({ season })),
  } as unknown as PackManifest;
  const full = measurements.map((m) => ({
    unit: 'px',
    status: 'MEASURED',
    method: '',
    basis: [],
    provenance: '',
    value: null,
    ...m,
  })) as Measurement[];
  return { base: '', manifest, measurements: full, stacks: new Map() } satisfies LoadedPack;
}

describe('showFor', () => {
  it("builds Barnard's motion show from its pack", () => {
    const s = showFor(
      pack([
        {
          key: 'shift-north-px',
          value: 1.1,
          error: 0.05,
          prediction: { value: 1.021, source: '' },
        },
        {
          key: 'shift-east-px',
          value: -0.2,
          error: 0.05,
          prediction: { value: -0.079, source: '' },
        },
      ]),
    );
    expect(s.kind).toBe('motion');
    if (s.kind !== 'motion') return;
    expect(s.lengthArcsec).toBeCloseTo(6.88, 2);
    expect(s.predictedArcsec).toBeCloseTo(6.3, 2);
    expect(s.direction).toBe('north');
    expect(s.seasons).toEqual([0, 1]);
    expect(s.stillStar).toBeNull();
  });

  it('reads the season pair from the method and finds detector-group keys', () => {
    const s = showFor(
      pack(
        [
          {
            key: 'shift-east-px-detectors-1-3',
            value: 0.6,
            error: 0.08,
            method: 'fit, season 0 -> 2',
          },
          {
            key: 'shift-north-px-detectors-1-3',
            value: -0.3,
            error: 0.08,
            method: 'fit, season 0 -> 2',
          },
          { key: 'shift-north-px-detectors-4-6', value: -0.4, error: 0.07 },
          { key: 'still-star-shift-px-detectors-1-3', value: 0.12 },
          { key: 'still-star-shift-p90-px-detectors-1-3', value: 0.3 },
        ],
        [0, 1, 2],
        'faint',
      ),
    );
    expect(s).toMatchObject({
      kind: 'motion',
      seasons: [0, 2],
      agreesWith: 'detectors-4-6',
      stillStar: { median: 0.12, p90: 0.3 },
    });
    if (s.kind === 'motion') expect(s.direction).toBe('south-east');
  });

  it('prefers the shift measured against still stars, keeping the raw season pair', () => {
    const s = showFor(
      pack([
        { key: 'shift-north-px', value: 1.1, error: 0.05, method: 'fit, season 0 -> 1' },
        { key: 'shift-east-px', value: -0.2, error: 0.05, method: 'fit, season 0 -> 1' },
        { key: 'shift-north-px-relative-to-still-stars', value: 0.993, error: 0.05 },
        { key: 'shift-east-px-relative-to-still-stars', value: -0.079, error: 0.05 },
        { key: 'still-star-shift-px', value: 0.159 },
        { key: 'still-star-shift-p90-px', value: 0.18 },
        { key: 'still-star-residual-shift-px', value: 0.014 },
        { key: 'still-star-residual-shift-p90-px', value: 0.03 },
        { key: 'still-star-common-shift-east-px', value: -0.121, error: 0.005 },
        { key: 'still-star-common-shift-north-px', value: 0.107, error: 0.005 },
      ]),
    );
    expect(s).toMatchObject({ kind: 'motion', relative: true, seasons: [0, 1] });
    if (s.kind !== 'motion') return;
    expect(s.measured).toEqual({ east: -0.079, north: 0.993 });
    expect(s.stillStar?.common).toBeCloseTo(0.1615, 3);
    // The scatter left after the shared shift, not the raw one.
    expect(s.stillStar).toMatchObject({ median: 0.014, p90: 0.03 });
  });

  it('leaves a shared still-star shift unset when it is within its error', () => {
    const s = showFor(
      pack([
        { key: 'shift-north-px', value: 0.15, error: 0.11 },
        { key: 'shift-east-px', value: -1.4, error: 0.12 },
        { key: 'still-star-shift-px', value: 0.046 },
        { key: 'still-star-common-shift-east-px', value: 0.006, error: 0.021 },
        { key: 'still-star-common-shift-north-px', value: 0.004, error: 0.015 },
      ]),
    );
    expect(s).toMatchObject({ kind: 'motion', relative: false, stillStar: { common: null } });
  });

  it('gives a status show when there is no measured motion', () => {
    const s = showFor(
      pack([{ key: 'brightness-change', status: 'NOT_MEASURABLE_YET' }], [0, 1, 2]),
    );
    expect(s).toEqual({
      kind: 'status',
      seasons: [0, 2],
      status: 'NOT_MEASURABLE_YET',
      eye: 'seen-with-ring',
    });
  });
});

describe('compass', () => {
  it.each([
    [{ east: 0, north: 1 }, 'north'],
    [{ east: -1.4, north: 0.15 }, 'west'],
    [{ east: 1, north: -1 }, 'south-east'],
  ])('%o → %s', (v, name) => expect(compass(v)).toBe(name));
});

describe('what a move was measured on', () => {
  it('reads the photo counts from the basis, in order', () => {
    expect(
      photoCounts(['wing fit, season 0: 14 exposures', 'wing fit, season 1: 12 exposures']),
    ).toEqual([14, 12]);
    expect(photoCounts(['detectors 5-6; season 0: 11 exposures, season 2: 31 exposures'])).toEqual([
      11, 31,
    ]);
    expect(photoCounts(['no counts here'])).toEqual([]);
  });
  it('names the prediction source briefly', () => {
    expect(
      predictionLabel('Gaia DR3 4472…, proper motion propagated … plus parallax (+0.167 px)'),
    ).toBe('Gaia DR3 proper motion + parallax');
    expect(predictionLabel('CatWISE2020 proper motion')).toBe('CatWISE2020 proper motion');
    // The packs' own sources (Viewer, 14 Nov): name the real catalogue, and never imply Gaia
    // measured ε Indi B (it's A's motion, which B shares).
    expect(predictionLabel('Luhman & Esplin 2016 proper motion plus parallax')).toBe(
      'Luhman & Esplin 2016 proper motion + parallax',
    );
    expect(
      predictionLabel('Gaia DR3 (Epsilon Indi A, shared motion) proper motion plus parallax'),
    ).toBe('Gaia DR3 motion of ε Indi A (which B shares) + parallax');
  });
});

describe('showFor with a chosen pair of looks (three passes)', () => {
  const three = () =>
    pack(
      [
        { key: 'shift-north-px', value: 1.6, error: 0.05, method: 'PSF wing fit, season 0 -> 2' },
        { key: 'shift-east-px', value: 0.1, error: 0.05, method: 'PSF wing fit, season 0 -> 2' },
        {
          key: 'shift-north-px-s0s1',
          value: 0.9,
          error: 0.06,
          method: 'PSF wing fit, season 0 -> 1',
        },
        {
          key: 'shift-east-px-s0s1',
          value: 0.2,
          error: 0.06,
          method: 'PSF wing fit, season 0 -> 1',
        },
      ],
      [0, 1, 2],
    );

  it('uses the plain keys for the measured pair', () => {
    const s = showFor(three(), [0, 2]);
    expect(s.kind).toBe('motion');
    expect(s.seasons).toEqual([0, 2]);
    if (s.kind === 'motion') expect(s.measured.north).toBe(1.6);
  });

  it("uses a pair's own suffixed keys when they exist", () => {
    const s = showFor(three(), [0, 1]);
    expect(s.kind).toBe('motion');
    expect(s.seasons).toEqual([0, 1]);
    if (s.kind === 'motion') {
      expect(s.measured.north).toBe(0.9);
      expect(s.keys.north).toBe('shift-north-px-s0s1');
    }
  });

  it('says plainly when a pair was not measured, rather than borrowing another pair', () => {
    const s = showFor(three(), [1, 2]);
    expect(s).toMatchObject({ kind: 'status', seasons: [1, 2], pairNote: 'unmeasured' });
  });
});

it('gives no number for a pair whose keys are not MEASURED', () => {
  const p = pack(
    [
      { key: 'shift-north-px', value: 1.7, error: 0.07, method: 'fit, season 0 -> 2' },
      { key: 'shift-east-px', value: -0.1, error: 0.07, method: 'fit, season 0 -> 2' },
      { key: 'shift-north-px-s0s1', value: 1.1, error: 0.07, status: 'NOT_RELIABLE' },
      { key: 'shift-east-px-s0s1', value: -0.1, error: 0.07, status: 'NOT_RELIABLE' },
    ],
    [0, 1, 2],
  );
  expect(showFor(p, [0, 1])).toMatchObject({
    kind: 'status',
    seasons: [0, 1],
    status: 'NOT_RELIABLE',
    pairNote: 'unverified',
  });
});

it('finds a pair measured per detector group (ε Indi B keys)', () => {
  const p = pack(
    [
      {
        key: 'shift-north-px-detectors-1-3',
        value: -0.6,
        error: 0.07,
        method: 'fit, season 0 -> 3',
      },
      { key: 'shift-east-px-detectors-1-3', value: 0.9, error: 0.07, method: 'fit, season 0 -> 3' },
      { key: 'shift-north-px-detectors-1-3-s1s2', value: -0.2, error: 0.07 },
      { key: 'shift-east-px-detectors-1-3-s1s2', value: 0.3, error: 0.07 },
    ],
    [0, 1, 2, 3],
  );
  expect(showFor(p).seasons).toEqual([0, 3]);
  const s = showFor(p, [1, 2]);
  expect(s.kind).toBe('motion');
  if (s.kind === 'motion') {
    expect(s.measured).toEqual({ east: 0.3, north: -0.2 });
    expect(s.keys.north).toBe('shift-north-px-detectors-1-3-s1s2');
  }
});

it("keeps a brightness target's own status for any pair (R Dra: no move, no pair note)", () => {
  const p = pack(
    [{ key: 'brightness-change', value: null, status: 'NOT_MEASURABLE_YET', unit: 'ratio' }],
    [0, 1, 2],
  );
  expect(showFor(p, [1, 2])).toEqual({
    kind: 'status',
    seasons: [1, 2],
    status: 'NOT_MEASURABLE_YET',
    eye: p.manifest.eye.status,
  });
});

it('reads a scatter test from the pack: which detectors beat every control, and how many controls (RW Aur)', () => {
  const r = (d: number, v: number, n: number) => ({
    key: `scatter-ratio-detector-${d}`,
    value: v,
    basis: [`40 target exposures, ${n} control stars`],
  });
  const p = pack(
    [
      r(1, 1.53, 28),
      r(2, 0.23, 28),
      r(5, 2.25, 6),
      r(6, 1.9, 4),
      { key: 'brightness-change', value: null, status: 'NOT_RELIABLE' },
    ],
    [0, 1, 2],
  );
  expect(scatterTest(p)).toEqual({
    detectors: [
      { detector: 1, ratio: 1.53, controls: 28 },
      { detector: 2, ratio: 0.23, controls: 28 },
      { detector: 5, ratio: 2.25, controls: 6 },
      { detector: 6, ratio: 1.9, controls: 4 },
    ],
    above: [1, 5, 6],
    // 1 in 29 clears the 5% bar; 1 in 7 and 1 in 5 don't.
    thin: [5, 6],
  });
  expect(scatterTest(pack([{ key: 'brightness-change', value: null }], [0, 1]))).toBeNull();
});

describe('brightness from the edges of a saturated star', () => {
  const basis = (pairs: string) => [
    `52 photo pairs matched in wavelength (within lambda/80), detector 5, ${pairs}`,
    'inner ring 3-6 px: 0.521; outer ring 5-9 px: 0.508',
    'comparison stars: 4 Gaia stars; systematic error 0.059 (their scatter beyond their own noise, at least 0.05)',
  ];
  const p = pack(
    [
      { key: 'brightness-change', value: 0.519, basis: ['D5 0.52, D6 0.52', 'passes 1 -> 3'] },
      {
        key: 'brightness-ratio-detector-5',
        value: 0.52,
        error: 0.06,
        unit: 'ratio',
        basis: [
          ...basis('passes 1 and 3'),
          "steady-star test passed: Barnard's Star, saturated but steady, gives s0s1 1.00, s0s2 1.03, s1s2 1.03 in this detector",
        ],
      },
      {
        key: 'brightness-ratio-detector-1',
        value: null,
        status: 'NOT_RELIABLE',
        unit: 'ratio',
        basis: basis('passes 1 and 3'),
      },
      {
        key: 'brightness-ratio-detector-6-s0s1',
        value: 0.71,
        error: 0.06,
        unit: 'ratio',
        basis: basis('passes 1 and 2'),
      },
    ],
    [0, 1, 2],
  );

  it('finds the headline pair from the basis, counting passes from 1', () => {
    expect(brightnessPair(p)).toEqual([0, 2]);
  });

  it('reads plain keys for the headline pair and suffixed keys for others', () => {
    expect(brightnessRatios(p, [0, 2])).toEqual([
      {
        detector: 1,
        ratio: null,
        error: null,
        status: 'NOT_RELIABLE',
        systematic: 0.059,
        steady: null,
      },
      {
        detector: 5,
        ratio: 0.52,
        error: 0.06,
        status: 'MEASURED',
        systematic: 0.059,
        steady: { passed: true, ratios: [1, 1.03, 1.03] },
      },
    ]);
    expect(brightnessRatios(p, [0, 1]).map((r) => [r.detector, r.ratio])).toEqual([[6, 0.71]]);
    expect(brightnessRatios(p, [1, 2])).toEqual([]);
  });
});
