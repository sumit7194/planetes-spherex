/**
 * The pack format: offline, versioned files the research sessions produce for each
 * curated target and data release. The viewer only reads these; it never runs research code.
 *
 * Layout on disk (served statically under /data):
 *
 *   packs/<release>/<target>/manifest.json      PackManifest
 *   packs/<release>/<target>/measurements.json  Measurement[]
 *   packs/<release>/<target>/frames/<id>.f32    float32 little-endian, size × size, MJy/sr,
 *                                               IMAGE − ZODI − frame median
 *   packs/<release>/<target>/frames/<id>.u8     uint8 flag mask, size × size (see FlagMask)
 *   packs/<release>/<target>/layers/<layer>/... LayerManifest and its tiles
 *
 * The language-neutral contract is schema/pack.schema.json; keep the two in step.
 */

export const PACK_FORMAT = 'planetes-pack/1';

/** How every number is labelled on screen. Never show a number without one. */
export type Status =
  'MEASURED' | 'PREDICTED' | 'MODEL' | 'NOT_RELIABLE' | 'NOT_MEASURABLE_YET' | 'NO_DATA' | 'MOCK';

/** Result of Physics' eye test: may the viewer ask a newcomer to spot the hop? */
export type EyeStatus = 'seen-with-ring' | 'faint' | 'unseen' | 'untested';

export type TargetId = 'barnard' | 'w0855' | 'epsind-b' | 'rw-aur' | 'r-dra';

export interface PackManifest {
  format: typeof PACK_FORMAT;
  release: string;
  pipelineVersions: string[];
  generator: { name: string; commit: string; createdUtc: string };
  target: {
    id: TargetId;
    name: string;
    /** Position at `epoch`, degrees. */
    ra: number;
    dec: number;
    epoch: number;
    /** Detectors where the target shows well enough to follow (event packs, 14 Nov). */
    motionDetectors?: number[];
  };
  grid: {
    /** Tile edge in pixels; tiles are square. */
    size: number;
    pixelScaleArcsec: number;
    /** Sky position of the tile centre, degrees. */
    centre: { ra: number; dec: number };
    orientation: 'north-up-east-left';
  };
  /** Physics' eye test; `method` names the passes it used, e.g. "… season 0 -> 2)". */
  eye: { status: EyeStatus; testedUtc: string | null; method?: string };
  frames: Frame[];
  stacks: Stack[];
  /** Relative path of the measurements file. */
  measurements: string;
  layers: LayerRef[];
  /**
   * Every photo of one detector in one file, in date order (pipeline/pack_bundles.py): Watch
   * fetches one file per colour range instead of two per photo (1,074 requests for R Dra).
   */
  bundles?: FrameBundle[];
  /** The "all photos added together" images, made as src/data/pack/coadd.ts makes them. */
  coadds?: CoaddRef[];
}

export interface FrameBundle {
  detector: number;
  file: string;
  frameIds: string[];
  /** float32 image (size² × 4 bytes) then uint8 flags (size² bytes), per frame. */
  bytesPerFrame: number;
  layout: string;
  sha256: string;
}

export interface CoaddRef {
  detector: number;
  id: string;
  image: string;
  flags: string;
  /** How many photos were added. */
  n: number;
}

export interface Frame {
  id: string;
  obsId: string;
  detector: 1 | 2 | 3 | 4 | 5 | 6;
  mjd: number;
  /** Season index, split at gaps over 60 days. */
  season: number;
  /** Wavelength at the target pixel from the CWAVE grid, micrometres. */
  lambdaUm: number;
  /** Bandwidth at the target pixel, micrometres. */
  bandwidthUm: number;
  /** True where the CWAVE map has a known jump near the target ("colour uncertain"). */
  colourUncertain: boolean;
  /** Registration offset applied, pixels (x east-left, y north-up). */
  registrationPx: [number, number];
  sha256: string;
  /** The data release the photo came from (DR1, QR3). */
  release?: string;
  image: string;
  flags: string;
}

export interface Stack {
  id: string;
  /**
   * all-colour: every detector in both seasons, equal weight per detector; honest for position only.
   * one-detector: one detector's whole range (about 17 resolution elements); position only too.
   * same-colour: photos within half a resolution element of each other; honest for brightness.
   */
  kind: 'all-colour' | 'one-detector' | 'same-colour';
  season: number;
  detectors: number[];
  frameIds: string[];
  /** For same-colour stacks: the wavelength window, micrometres. */
  lambdaWindowUm?: [number, number];
  image: string;
  flags: string;
}

export interface Measurement {
  /** Stable key the copy deck refers to, e.g. "shift-north-px". */
  key: string;
  /** null for NOT_RELIABLE, NOT_MEASURABLE_YET and NO_DATA: never show a number for those. */
  value: number | null;
  error?: number;
  unit: 'px' | 'arcsec' | 'arcsec/yr' | 'days' | 'K' | 'um' | 'ratio';
  status: Status;
  method: string;
  /** Measured values are always shown beside their own prediction from the same photos. */
  prediction?: { value: number; source: string };
  /** Which frames or stacks the value came from. */
  basis: string[];
  provenance: string;
}

export interface LayerRef {
  id: string;
  kind: 'what-changed';
  manifest: string;
}

/** Bits in the uint8 flag mask. Decoded from the files' own MP_* names by the pack writer. */
export const FlagMask = {
  /** Saturated, overflow or nonlinear: outline, never colour or centroid. */
  saturated: 1 << 0,
  /** Any other FIT_REJECT condition (transient, hot/cold, persistence, ghost, streak, bloom, halo). */
  rejected: 1 << 1,
  /** SOURCE: a catalogued static source. Optional layer only. */
  source: 1 << 2,
  /** OUTLIER: also fires on real asteroids. Optional layer only. */
  outlier: 1 << 3,
} as const;
