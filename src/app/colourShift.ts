/**
 * "Light by colour" (Physics' idea, 15 Nov): where the light is centred in a short colour (D2)
 * and a long one (D6) on a page whose target blends with a neighbour. On WISE 0855's page the
 * light sits on the G 16.3 neighbour at 1–1.6 µm and moves along the line towards WISE 0855 at
 * 4.4–5 µm, where WISE 0855 is bright. Measured with the spot check's own recentring, so the
 * figure and the card agree. No light shares are drawn: a 3×3 centroid is biased towards the
 * peak pixel (Physics).
 */
import type { SkyPosition } from '../data/coords';
import type { TargetId } from '../data/pack/types';
import { placeAt } from './searchIndex';
import { recentre, type Grid } from './spotCheck';

export interface Neighbour {
  /** Gaia DR3 source_id. */
  id: string;
  /** Position at epoch 2016.0 (degrees) and proper motion (mas/yr), from Gaia DR3. */
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  g: number;
  bpRp: number;
}

export interface ColourShiftCase {
  neighbour: Neighbour;
  /** The short and long colour shown, by detector. */
  detectors: [number, number];
  /**
   * The reddest real source in this field's colour ratio, named from its catalogues (Physics,
   * 15 Nov: N2's validation found it, not the target).
   */
  reddest?: { ra: number; dec: number; what: string };
}

/** Pages with a demonstration. Gaia DR3 values, queried 15 Nov 2026 (ESA Gaia archive). */
export const COLOUR_SHIFT: Partial<Record<TargetId, ColourShiftCase>> = {
  w0855: {
    neighbour: {
      id: '5756956644387831296',
      ra: 133.75818250493919,
      dec: -7.241155906974705,
      pmra: -6.187834849360848,
      pmdec: 1.9308548733514355,
      g: 16.31,
      bpRp: 0.72,
    },
    detectors: [2, 6],
    // CatWISE J085509.47-071502.9 (W1 14.99, W2 13.75; no proper motion) = Gaia DR3
    // 5756955849818062592 (G 18.64; parallax -0.10 ± 0.20 mas; DR3 quasar classifier probability
    // 1.0). Gaia position at 2016.0 (no motion to apply).
    reddest: { ra: 133.79019, dec: -7.25029, what: 'quasar' },
  },
};

export interface GridGeometry {
  size: number;
  scaleArcsec: number;
  centre: SkyPosition;
}

/** A sky position as a tile pixel (north up, east left: east is to smaller x). */
export function skyToPixel(at: SkyPosition, g: GridGeometry): { x: number; y: number } {
  const c = g.size / 2 - 0.5;
  const cosd = Math.cos((g.centre.dec * Math.PI) / 180);
  let dra = at.ra - g.centre.ra;
  if (dra > 180) dra -= 360;
  if (dra < -180) dra += 360;
  return {
    x: c - (dra * cosd * 3600) / g.scaleArcsec,
    y: c + ((at.dec - g.centre.dec) * 3600) / g.scaleArcsec,
  };
}

/** Distance between two tile pixels, arcsec. */
export const pixelSepArcsec = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  g: GridGeometry,
) => Math.hypot(a.x - b.x, a.y - b.y) * g.scaleArcsec;

export interface ColourPanel {
  detector: number;
  /** The light's centre (tile pixels), the neighbour's and the target's places at the look. */
  light: { x: number; y: number };
  neighbour: { x: number; y: number };
  target: { x: number; y: number };
  fromNeighbour: number;
  fromTarget: number;
}

/**
 * Both panels: the light's centre in each detector's stack, recentred from where the light sits
 * in the all-colour stack (the spot check's start), and the two sources' places at `year`.
 */
export function colourPanels(
  c: ColourShiftCase,
  stacks: [Grid, Grid],
  allColour: Grid,
  g: GridGeometry,
  target: { at: SkyPosition; pmRa: number; pmDec: number; epoch: number },
  year: number,
): [ColourPanel, ColourPanel] {
  const mid = g.size / 2 - 0.5;
  const start = recentre(allColour, mid, mid);
  const n = c.neighbour;
  const neighbour = skyToPixel(placeAt({ ra: n.ra, dec: n.dec }, n.pmra, n.pmdec, 2016.0, year), g);
  const tgt = skyToPixel(placeAt(target.at, target.pmRa, target.pmDec, target.epoch, year), g);
  const panel = (grid: Grid, detector: number): ColourPanel => {
    const light = recentre(grid, start.x, start.y);
    return {
      detector,
      light,
      neighbour,
      target: tgt,
      fromNeighbour: pixelSepArcsec(light, neighbour, g),
      fromTarget: pixelSepArcsec(light, tgt, g),
    };
  };
  return [panel(stacks[0], c.detectors[0]), panel(stacks[1], c.detectors[1])];
}

/**
 * The colour ratio, long over short (Physics, 15 Nov, N2): each pixel's D6 ÷ D2 in one look,
 * masked (NaN) where either colour is below S/N `minSn` or where either is saturated or rejected,
 * so saturated cores and artefacts can't light up as false "cold" sources. Noise per stack is the
 * robust scatter of its finite pixels (the stacks are median-subtracted, so the zodiacal light's
 * smooth level is already off).
 */
export interface RatioTile {
  size: number;
  ratio: Float32Array;
}
const robustSd = (px: Float32Array): number => {
  const v = Array.from(px)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!v.length) return NaN;
  const med = v[v.length >> 1] ?? 0;
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  return 1.4826 * (dev[dev.length >> 1] ?? 0);
};
export function colourRatio(
  short: { size: number; pixels: Float32Array; flags: Uint8Array },
  long: { size: number; pixels: Float32Array; flags: Uint8Array },
  minSn = 5,
  maskBits = 3,
): RatioTile {
  const n = short.size;
  const sa = robustSd(short.pixels);
  const sb = robustSd(long.pixels);
  const ratio = new Float32Array(n * n).fill(NaN);
  for (let k = 0; k < n * n; k++) {
    const a = short.pixels[k] ?? NaN;
    const b = long.pixels[k] ?? NaN;
    if (((short.flags[k] ?? 0) | (long.flags[k] ?? 0)) & maskBits) continue;
    if (!(a / sa >= minSn) || !(b / sb >= minSn)) continue;
    ratio[k] = b / a;
  }
  return { size: n, ratio };
}
