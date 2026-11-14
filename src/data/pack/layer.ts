/**
 * The research layer format (Neural's "what changed"), one manifest per layer per target.
 * Shown only on curated targets, only in Watch, and only if every gate passed.
 *
 * Tiles are float32 little-endian on the target pack's grid (size × size, north up, east left).
 * NaN means "no value" (outside the model's coverage, or a pixel it didn't predict) and is
 * drawn as no data, never as zero.
 */

export interface LayerManifest {
  format: 'planetes-layer/1';
  kind: 'what-changed';
  model: {
    name: string;
    version: string;
    trainedUtc: string;
    checkpointSha256: string;
    /** Plain sentence for the credits page, e.g. how and where it was trained and graded. */
    trainingNote: string;
    /** null until the one-time held-out exam: the viewer then shows a "pre-exam" tag. */
    examPassed: boolean | null;
  };
  /** Residuals are in units of the local noise and always drawn on this fixed scale. */
  scaleSigma: 5;
  /** Shown beside the layer, e.g. "local noise from neighbouring pixels". */
  sigmaDefinition: string;
  /** Shown beside the layer, e.g. "tilted background plane removed". */
  background: string;
  /** "single photo" or "stack of N". */
  basisLabel: string;
  /** Same-detector context, required for red objects (WISE 0855, ε Indi B). */
  sameColourPrediction: boolean;
  /**
   * What the prediction was made from. With other-season context a mover shows as a
   * minus–plus pair; with same-season context it mostly doesn't. The caption depends on it.
   */
  context: { seasons: 'other' | 'same' | 'any'; sameDetector: boolean; k: number };
  /** How native-pixel residuals were put on the pack grid (flux and noise resampled separately). */
  resampling: 'lanczos3' | 'bilinear';
  frames: LayerFrame[];
  twins: {
    /** The same target area at a random other time: what "nothing changed" looks like here. */
    noise: { frameId: string; residual: string; note: string };
    /**
     * A static star of similar brightness on the same detector and season pair. Missing when
     * no qualifying star exists nearby; then the layer cannot show (gate N2 enforces it).
     */
    staticStar?: {
      gaiaSourceId: string;
      gMag: number;
      ra: number;
      dec: number;
      /** null for a stack-based twin spanning several detectors. */
      detector: 1 | 2 | 3 | 4 | 5 | 6 | null;
      seasons: [number, number];
      frameId: string;
      /** Its own size × size tile, centred on that star. */
      residual: string;
    };
  };
  /** Default uint8 masks, size × size: shade where the residual is least trustworthy. */
  masks: LayerMasks;
  gates: {
    noiseTwin: GateResult;
    staticStarNoFalseDipole: GateResult;
    plantedMoverSurvival: GateResult;
  };
}

export interface LayerMasks {
  source: string;
  brightStar: string;
  saturated: string;
}

export interface LayerFrame {
  /** A pack Frame id, or a pack Stack id when the residual is for a stack. */
  frameId: string;
  /** float32 residual in σ units on the pack grid. */
  residual: string;
  /** Member frame ids when this is a stack of N. */
  stackOf?: string[];
  /** Per-frame mask overrides (saturation and SOURCE change from exposure to exposure). */
  masks?: Partial<LayerMasks>;
  /** Frames the model leaned on, when they are in the pack. */
  contextFrameIds?: string[];
  /** Photos the model leaned on that aren't in the pack, as "obsId:detector". */
  contextObsIds?: string[];
  /** Native-pixel residual and its WCS header, for expert download. */
  native?: { residual: string; wcsHeader: string };
}

export interface GateResult {
  passed: boolean;
  checkedUtc: string;
  value?: number;
  threshold?: number;
  /** Where the pass rule was written before the check, e.g. "PLAN.md §11, 2026-11-02". */
  registered: string;
  note?: string;
}

/** A layer is shown only if every gate passed. */
export function layerMayShow(m: LayerManifest): boolean {
  const g = m.gates;
  return (
    m.twins.staticStar !== undefined &&
    g.noiseTwin.passed &&
    g.staticStarNoFalseDipole.passed &&
    g.plantedMoverSurvival.passed
  );
}

/** The version tag shown beside a layer. */
export function layerVersionTag(m: LayerManifest): string {
  return m.model.examPassed === null ? `${m.model.version} · pre-exam` : m.model.version;
}
