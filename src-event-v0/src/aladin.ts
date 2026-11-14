/** Context view: CDS Aladin Lite v3 with IRSA's SPHEREx DR1 all-sky HiPS cube (102 wavelengths,
 * collapsed over time, so it is for context and colour, never for motion). */

import type { CatSource } from './pack';

const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
export const HIPS_URL = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
const C = 299792458;
const EM_MIN = 7.43e-7;
const EM_MAX = 5.009e-6;
const DEPTH = 102;

// Wavelength of each cube frame (µm), from the HiPS properties (data_cube_crval3_arr).
export const CUBE_UM = `0.753 0.771 0.790 0.809 0.828 0.848 0.868 0.889 0.910 0.932 0.955 0.978 1.001 1.025 1.050 1.075 1.102 1.113 1.139 1.167 1.195 1.224 1.254 1.284 1.315 1.346 1.378 1.412 1.446 1.481 1.517 1.554 1.592 1.631 1.656 1.695 1.735 1.775 1.818 1.861 1.905 1.949 1.995 2.041 2.089 2.139 2.189 2.240 2.292 2.345 2.399 2.445 2.506 2.575 2.646 2.719 2.794 2.871 2.951 3.033 3.118 3.204 3.293 3.383 3.476 3.570 3.667 3.768 3.833 3.867 3.901 3.935 3.970 4.005 4.040 4.076 4.112 4.148 4.184 4.220 4.257 4.294 4.331 4.368 4.405 4.435 4.467 4.500 4.533 4.566 4.600 4.635 4.669 4.704 4.739 4.773 4.808 4.843 4.879 4.915 4.951 4.988`
  .split(' ')
  .map(Number);
/** Frames 50 and 51 (the dichroic channels) are blank in the cube. */
export const BLANK_FRAMES = new Set([50, 51]);

/* eslint-disable @typescript-eslint/no-explicit-any */
let A: any = null;

async function lib(): Promise<any> {
  if (A) return A;
  const mod = await import(/* @vite-ignore */ ALADIN_URL);
  A = mod.default;
  if (A.init) await A.init;
  return A;
}

export interface Context {
  setFrame(i: number): void;
  goto(ra: number, dec: number, fovDeg?: number): void;
  setCatalog(src: CatSource[], year: number, project: (s: CatSource) => { ra: number; dec: number }): void;
  setBox(ra: number, dec: number, sizeDeg: number): void;
}

export async function openContext(el: HTMLElement, ra: number, dec: number, fovDeg: number): Promise<Context> {
  const lib_ = await lib();
  const aladin = lib_.aladin(el, {
    fov: fovDeg,
    target: `${ra} ${dec}`,
    projection: 'TAN',
    showCooGrid: false,
    showReticle: true,
    showLayersControl: false,
    showFullscreenControl: true,
    showGotoControl: false,
    showShareControl: false,
    showFrame: false,
    showProjectionControl: false,
    showZoomControl: true,
    showSimbadPointerControl: true,
    reticleColor: '#ff9d5c',
  });
  const hips = aladin.newImageSurvey(HIPS_URL, { name: 'SPHEREx DR1 cube', imgFormat: 'png' });
  aladin.setImageSurvey(hips);
  let cat: any = null;
  let box: any = null;
  return {
    setFrame(i: number) {
      // IRSA's method: choose a frame by frequency, not slice number (some frames are missing).
      const fLo = C / EM_MAX;
      const fHi = C / EM_MIN;
      const k = DEPTH - 1 - i; // frames ascend in wavelength = descend in frequency
      try {
        hips.setFrequency({ value: fLo + ((k + 0.5) / DEPTH) * (fHi - fLo), unit: 'Hz' });
      } catch {
        if (typeof hips.setSliceNumber === 'function') hips.setSliceNumber(i);
      }
    },
    goto(r: number, d: number, f?: number) {
      aladin.gotoRaDec(r, d);
      if (f) aladin.setFoV(f);
    },
    setCatalog(src, year, project) {
      if (cat) cat.removeAll();
      else {
        cat = lib_.catalog({ name: 'Gaia DR3 / CatWISE2020', sourceSize: 12, color: '#b3aedb', shape: 'circle', onClick: 'showPopup' });
        aladin.addCatalog(cat);
      }
      cat.addSources(
        src.map((s) => {
          const p = project(s);
          return lib_.source(p.ra, p.dec, {
            name: `${s.cat} ${s.id}`,
            mag: s.mag == null ? '' : `${s.band} ${s.mag}`,
            pm: `${s.pmra.toFixed(0)}, ${s.pmdec.toFixed(0)} mas/yr`,
            at: year.toFixed(2),
          });
        }),
      );
    },
    setBox(r, d, size) {
      if (box) box.removeAll();
      else {
        box = lib_.graphicOverlay({ color: '#6fb7d6', lineWidth: 2 });
        aladin.addOverlay(box);
      }
      const h = size / 2;
      const c = Math.cos((d * Math.PI) / 180);
      box.add(
        lib_.polygon([
          [r + h / c, d - h],
          [r - h / c, d - h],
          [r - h / c, d + h],
          [r + h / c, d + h],
        ]),
      );
    },
  };
}
