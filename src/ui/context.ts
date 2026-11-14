/**
 * The context map (14 Nov, from the event viewer's src-event-v0/src/aladin.ts): CDS Aladin Lite
 * v3 showing IRSA's SPHEREx DR1 all-sky HiPS cube around a target, one of its 102 colours at a
 * time, with the lens's field drawn as a box. The cube is every photo added together, so it is
 * for colour and context, never for motion. Aladin loads from a CDN only when first opened.
 */

const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
export const HIPS_URL = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
const C = 299792458;
const EM_MIN = 7.43e-7;
const EM_MAX = 5.009e-6;
const DEPTH = 102;

/** Wavelength of each cube frame (µm), from the HiPS properties (data_cube_crval3_arr). */
export const CUBE_UM =
  `0.753 0.771 0.790 0.809 0.828 0.848 0.868 0.889 0.910 0.932 0.955 0.978 1.001 1.025 1.050 1.075 1.102 1.113 1.139 1.167 1.195 1.224 1.254 1.284 1.315 1.346 1.378 1.412 1.446 1.481 1.517 1.554 1.592 1.631 1.656 1.695 1.735 1.775 1.818 1.861 1.905 1.949 1.995 2.041 2.089 2.139 2.189 2.240 2.292 2.345 2.399 2.445 2.506 2.575 2.646 2.719 2.794 2.871 2.951 3.033 3.118 3.204 3.293 3.383 3.476 3.570 3.667 3.768 3.833 3.867 3.901 3.935 3.970 4.005 4.040 4.076 4.112 4.148 4.184 4.220 4.257 4.294 4.331 4.368 4.405 4.435 4.467 4.500 4.533 4.566 4.600 4.635 4.669 4.704 4.739 4.773 4.808 4.843 4.879 4.915 4.951 4.988`
    .split(' ')
    .map(Number);
/** Frames 50 and 51 (the dichroic channels) are blank in the cube. */
export const BLANK_FRAMES = new Set([50, 51]);
/** Frame 0's tiles carry no suffix, but Aladin asks for "_0": the first frame it can show is 1. */
export const FIRST_FRAME = 1;

/* eslint-disable @typescript-eslint/no-explicit-any -- Aladin Lite ships no types */
let lib: Promise<any> | null = null;
function aladinLib(): Promise<any> {
  lib ??= import(/* @vite-ignore */ ALADIN_URL).then(async (mod) => {
    const A = mod.default;
    if (A.init) await A.init;
    return A;
  });
  lib.catch(() => (lib = null));
  return lib;
}

export interface ContextMap {
  /** Shows frame i; asked before the layer is ready, it is applied as soon as it is. */
  setFrame(i: number): void;
  /** Re-aims the one map at another target, with that target's lens field as the box. */
  aim(at: { ra: number; dec: number }, fovDeg: number, boxDeg: number): void;
}

/**
 * One Aladin for the whole page (WebGL and WASM are costly; one is plenty, since one show is
 * on screen at a time), created in `el` and re-aimed per target.
 */
export async function openContextMap(el: HTMLElement, colour: string): Promise<ContextMap> {
  const A = await aladinLib();
  const aladin = A.aladin(el, {
    // Straight to SPHEREx's map (no default survey fetched first), and no usage ping to CDS.
    survey: HIPS_URL,
    log: false,
    fov: 1,
    projection: 'TAN',
    showCooGrid: false,
    showReticle: false,
    showLayersControl: false,
    showFullscreenControl: true,
    showGotoControl: false,
    showShareControl: false,
    showFrame: false,
    showProjectionControl: false,
    showZoomControl: true,
    showSimbadPointerControl: true,
  });
  const hips = aladin.newImageSurvey(HIPS_URL, { name: 'SPHEREx DR1 cube', imgFormat: 'png' });
  aladin.setImageSurvey(hips);
  const overlay = A.graphicOverlay({ color: colour, lineWidth: 2 });
  aladin.addOverlay(overlay);

  // Aladin turns a frequency into a tile number as floor((f − fMin) / (fMax − fMin) × 102), and
  // IRSA's tile number is the frame index (ascending wavelength), so aim at the middle of frame
  // i's step. (setSliceNumber goes through wavelength instead and fetches the wrong frame;
  // checked 14 Nov against the tiles requested.) Aladin ignores a frame asked for before the
  // layer is added, so the last one asked is kept and applied when it is.
  let wanted: number | null = null;
  const apply = () => {
    if (wanted === null || !hips.added) return false;
    const fLo = C / EM_MAX;
    const fHi = C / EM_MIN;
    hips.setFrequency({ value: fLo + ((wanted + 0.5) / DEPTH) * (fHi - fLo), unit: 'Hz' });
    return true;
  };
  let waiting = 0;
  return {
    setFrame(i: number) {
      wanted = i;
      if (apply() || waiting) return;
      waiting = window.setInterval(() => {
        if (apply()) {
          window.clearInterval(waiting);
          waiting = 0;
        }
      }, 200);
    },
    aim(at, fovDeg, boxDeg) {
      aladin.gotoRaDec(at.ra, at.dec);
      aladin.setFoV(fovDeg);
      overlay.removeAll();
      const h = boxDeg / 2;
      const c = Math.cos((at.dec * Math.PI) / 180) || 1;
      overlay.add(
        A.polygon([
          [at.ra + h / c, at.dec - h],
          [at.ra - h / c, at.dec - h],
          [at.ra - h / c, at.dec + h],
          [at.ra + h / c, at.dec + h],
        ]),
      );
    },
  };
}
