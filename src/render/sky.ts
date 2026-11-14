/**
 * The sky map, three ways: a slowly turning globe, a flat map, or the view from inside the
 * sky, looking out from where the telescope is. All three are seen from inside (east on the
 * left, as on the real sky). Directions only, never distances. Background stars come only
 * from the bundled Hipparcos list and are labelled "catalogue stars, not SPHEREx"; none are
 * invented. The inside view also draws the Sun and its yearly path, and the size of one
 * SPHEREx photo for scale.
 */

import { decText, positionText, raText, type SkyPosition } from '../data/coords';
import { eclipticRing, sunPosition } from '../data/sun';
import type { Coverage } from '../data/coverage';
import { pixelCorners } from '../data/healpix';
import type { Entry } from '../app/state';
import { glowAt, type GlowMap } from './milkyway';
import { channels, mixHex, readTheme, rgba, type Theme } from './theme';
import { wheelPixels } from './wheel';
import { hammer, unhammer } from './hammer';
import { EE_XMAX, EE_YMAX, equalEarth, unEqualEarth } from './equalEarth';
import { Earth2D, type ScreenAxes } from './earth2d';
import { EARTH_EQ_KM, orbitFrame, SPHEREX_ORBIT } from './scene/orbit';
import type { Scene3DView } from './scene/scene3d';
import { stepOut, type StepOut } from './scene/camera';
import { nearestRow, pointingAt, separationDeg, speedAfter, type Timeline } from './scene/ride';
import { nearestU, orbitPoint } from './scene/orbit';

/** One catalogue star: [ra°, dec°, V magnitude, B−V colour or null, Hipparcos number?]. */
export type CatalogueStar = [number, number, number, number | null, number?];

/** Names appear for brighter stars when wide, and for fainter ones as the view narrows. */
function namedLimit(fov: number): number {
  return Math.max(2.5, Math.min(4.5, 2.5 + (35 - fov) / 12));
}
/**
 * Grid spacing in degrees, by field. RA steps land on round hours and minutes (2h, 1h, 20m), so
 * its labels read cleanly; Dec steps are 15°, 10°, 5° (Viewer, 14 Nov).
 */
function raGridStep(fov: number): number {
  return fov > 35 ? 30 : fov > 15 ? 15 : 5;
}
function decGridStep(fov: number): number {
  // 15° when wide, as RA's 1h, so the opening view labels a few Dec lines, not just the equator.
  return fov > 35 ? 15 : fov > 15 ? 10 : 5;
}
/** The lens field: 40 pack pixels of 6.15 arcseconds, in degrees. */
const LENS_FIELD_DEG = (40 * 6.15) / 3600;
/**
 * How deep to draw, by scale: the whole sky shows only bright stars, and fainter ones fade in
 * as the view narrows. Keeps a wide view from turning into speckle.
 */
function magnitudeLimit(cssPxPerDeg: number): number {
  return Math.max(5, Math.min(8, 3.5 + Math.log2(Math.max(0.5, cssPxPerDeg))));
}
/** Within this many degrees of the axis, "looking near"; beyond, "nearest named star". */
export const NEAR_DEG = 25;

/** A rectangle in canvas pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
function inBox(b: Box, p: { x: number; y: number }): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A constellation figure: its name, where the name goes, and its stick-figure segments. */
export interface Figure {
  name: string;
  labels: SkyPosition[];
  segments: [SkyPosition, SkyPosition][];
}

export interface Lantern {
  id: string;
  at: SkyPosition;
  label: string;
  /** A one-line story under the name, e.g. "A runaway star". */
  story?: string;
  ready: boolean;
  /** Ember only where SPHEREx measured a move; starlight where nothing was measured. */
  measured?: boolean;
}

/** Where a view looks and how wide, degrees. */
interface Look {
  ra: number;
  dec: number;
  fov: number;
}

const RAD = Math.PI / 180;
const COLOURS = {
  grid: 'rgba(154,166,216,0.18)',
  farGrid: 'rgba(154,166,216,0.07)',
  figure: 'rgba(154,180,240,0.34)',
  figureName: 'rgba(170,192,245,0.7)',
  sun: '#ffd27a',
  photo: 'rgba(120,166,255,0.45)',
};

/** Field of view of the inside view, degrees across the ring (or the canvas, without one). */
const FOV = { min: 8, max: 70, start: 60 };
/** The field at which stars are drawn at their base brightness; narrower brightens them. */
const BASE_FOV = 40;
/** The snapshot outline and the aim appear once the view is this narrow: detail follows zoom. */
const DETAIL_FOV = 45;
/**
 * Riding with SPHEREx (round 4, branch): in Look around the camera sits on SPHEREx's orbit,
 * 659 km up (1.103 Earth radii from Earth's centre), looking roughly straight up. The stars are
 * as good as infinitely far, so the sky is drawn exactly as before; only Earth, below, is near.
 * From there Earth fills every direction within EARTH_ANG of straight down. The drift follows
 * SPHEREx's scan, about 3.7° a minute (Physics, our pointing data), shown SCAN_SPEEDUP times faster.
 */
const ORBIT_RE = SPHEREX_ORBIT.semiMajorKm / EARTH_EQ_KM;
const SCAN_DEG_PER_S = 3.67 / 60;
const SCAN_SPEEDUP = 10;
/**
 * It steps rather than sweeps: it holds still for each exposure (~129 s apart) and hops ~7.9°
 * (Physics). Shown as a hold and a gentle 1.5 s hop, 10× faster than real. The sense is the
 * orbit's own (a positive turn about its axis): north over the morning side, south over the
 * evening side.
 */
const SCAN_HOP_S = 129;
const SCAN_HOP_DEG = SCAN_DEG_PER_S * SCAN_HOP_S;
/** Stepping out: the camera's path is in scene/camera.ts (true scale, log-linear in scroll). */
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export type Vec3 = [number, number, number];
const toVec = (p: SkyPosition): Vec3 => {
  const r = p.ra * RAD;
  const d = p.dec * RAD;
  return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
};
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const toPos = (v: Vec3): SkyPosition => ({
  ra: (Math.atan2(v[1], v[0]) / RAD + 360) % 360,
  dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD,
});
/** Rotates v about the unit axis k by `a` radians (Rodrigues). */
const rotate3 = (v: Vec3, k: Vec3, a: number): Vec3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross3(k, v);
  const d = dot3(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * d,
    v[1] * c + kv[1] * s + k[1] * d,
    v[2] * c + kv[2] * s + k[2] * d,
  ];
};
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Extra scroll needed at Look around's widest before the camera steps outside the sky. */
const DETENT = 260;
const FLAT_ZOOM_MAX = 5;
/**
 * One SPHEREx snapshot on the sky (Physics, measured): three 3.49° patches in a row, centres
 * 3.86° apart, each seen by two detectors at once. The gaps between patches are real.
 */
const PHOTO = { patch: 3.49, pitch: 3.86, cells: 3 };
/** The full Moon's apparent diameter, degrees: the scale everyone carries in their head. */
const MOON_DEG = 0.52;

export class SkyView {
  readonly canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D;
  #entry: Entry = 'inside';
  #centre = { ra: 260, dec: 10 };
  #fov = FOV.start;
  #lanterns: Lantern[] = [];
  #stars: CatalogueStar[] = [];
  #names = new Map<number, string>();
  /** The lantern the pointer is over, or that the page asked to light up. */
  #lit: string | null = null;
  /** The flat map's pan (degrees of RA) and zoom about its centre. */
  #flat = { pan: 0, dy: 0, zoom: 1 };
  /** The page's own faces, so canvas labels match the text around them (read with the theme). */
  #fontSans = cssFont('--sans', 'system-ui, sans-serif');
  #fontSerif = cssFont('--serif', 'Georgia, serif');
  /** The theme's colours for the canvas (see theme.ts). */
  #t: Theme = readTheme();
  /** Re-reads the theme from the page, e.g. after switching it. */
  setTheme(t: Theme): void {
    this.#t = t;
    this.#fontSans = cssFont('--sans', 'system-ui, sans-serif');
    this.#fontSerif = cssFont('--serif', 'Georgia, serif');
    this.#glowKey = '';
    this.draw();
  }
  /** Scroll gathered against the detent at Look around's widest, and when it last moved. */
  #detent = { sum: 0, at: 0 };
  #spinning = true;
  #raf = 0;
  #last = 0;
  #drag: { x: number; y: number; ra: number; dec: number } | null = null;
  /**
   * A flight: along the great circle (arc, degrees); a long hop (arc > 10°) also pulls the view
   * back mid-way by `bump` degrees of field, so you see where you're going (Sumit, 14 Nov:
   * "navigate in sky view and then zoom in").
   */
  #flight: { from: Look; to: Look; t0: number; ms: number; arc: number; bump: number } | null =
    null;

  /** How long a flight of `arcDeg` takes: short hops quick, long ones up to 1.8 s. */
  static flightMs(arcDeg: number): number {
    // Short enough for a demo (Viewer): 0.9 s plus 4 ms a degree, at most 1.8 s.
    return Math.round(Math.min(1800, 900 + 4 * arcDeg));
  }
  /** The zone of interest (inside view): the optical axis and the ring's radius, canvas px. */
  #focus: { x: number; y: number; r: number } | null = null;
  #sun = sunPosition();
  /** The date on show, MJD: the Sun's place and the orbit's plane follow it. */
  #mjd = Date.now() / 86_400_000 + 40587;
  /** Weekly coverage and the week on show; the pixel outlines are cached once per nside. */
  #coverage: Coverage | null = null;
  #week = 0;
  #corners: SkyPosition[][] = [];
  #clock = 0;
  #announced = '';
  #ecliptic = eclipticRing();
  labels: {
    sun: string;
    photo: string;
    photoDetail: string;
    moon: string;
    lens: string;
    stepOut: string;
    outOfView: string;
    earthBelow: string;
    surface: string;
    riding: string;
    ghost: string;
    ghostBehind: string;
    trueSize: string;
    ridingReal: string;
    ridingGap: string;
    sunOn: string;
    scaleAtSpherex: string;
    scaleAtEarth: string;
    earth: string;
  } = {
    sun: '',
    photo: '',
    photoDetail: '',
    moon: '',
    lens: '',
    stepOut: '',
    outOfView: '',
    earthBelow: '',
    surface: '',
    riding: '',
    ghost: '',
    ghostBehind: '',
    trueSize: '',
    ridingReal: '',
    ridingGap: '',
    sunOn: '',
    scaleAtSpherex: '',
    scaleAtEarth: '',
    earth: '',
  };
  /** What the aim is on ("Looking near Vega"), drawn just under the snapshot outline. */
  caption = '';
  /** Draw the aim, the photo outline, the Sun and the names (off while a lens is open over the sky). */
  marks = true;
  onSelect: (id: string) => void = () => {};
  /** The first drag or zoom (so the page can retire its "drag to look around" hint). */
  onFirstMove: () => void = () => {};
  #moved = false;
  #noteMove(): void {
    if (this.#moved) return;
    this.#moved = true;
    this.onFirstMove();
  }
  /** A tap on the sky away from any lantern: the position under it, for a live look. */
  onSkyTap: (at: SkyPosition) => void = () => {};
  /** The pointer moved over (or off) a lantern. */
  onHover: (id: string | null) => void = () => {};
  /** Shift + scroll over the sky: step the time sweep by weeks. */
  onSweep: (step: number) => void = () => {};
  /**
   * One zoom runs through all three views. Zooming into the globe or the flat map past their
   * limit asks for the inside view; zooming out of the inside view past its widest asks for a
   * whole-sky view. The page decides which and calls setEntry.
   */
  /** Zoomed in past the flat map's closest: open Look around at `at` (the spot under the pointer). */
  onHandOver: (to: 'inside', at?: SkyPosition) => void = () => {};
  /**
   * The view turned or zoomed: the nearest named star to the axis if one is close, whether the
   * zoom is at its narrowest, and whether a light sits on the aim.
   */
  onTurn: (look: {
    near: { name: string; sepDeg: number } | null;
    narrowest: boolean;
    onLight: string | null;
  }) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.#ctx = ctx;
    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    canvas.addEventListener('pointerleave', () => (this.#pointerAt = null));
    canvas.addEventListener('pointerup', (e) => this.#up(e));
    canvas.addEventListener('pointercancel', (e) => this.#up(e));
    canvas.style.touchAction = 'none';
    canvas.addEventListener('wheel', (e) => this.#wheel(e), { passive: false });
    // Safari on a Mac sends a trackpad pinch as gesture events rather than ctrl + wheel; left
    // alone it would zoom the page. On a touch screen the pointers already carry the pinch.
    let gestureScale = 1;
    canvas.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      gestureScale = 1;
    });
    canvas.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      if (this.#pointers.size < 2 && scale > 0) this.#applyZoom(scale / gestureScale);
      gestureScale = scale;
    });
  }

  /** Where the view is looking, and how wide (inside view only). */
  get centre(): Look {
    return { ...this.#centre, fov: this.#fov };
  }

  /** The sky position at the middle of the view, whichever view it is. */
  lookCentre(): SkyPosition {
    if (this.#entry !== 'flat') return { ra: this.#centre.ra, dec: this.#centre.dec };
    const a = this.#axis();
    return (
      this.#unproject(a.x, a.y) ?? { ra: (((180 + this.#flat.pan) % 360) + 360) % 360, dec: 0 }
    );
  }

  /** Sets the inside view's field, degrees across the aim. */
  setFov(fov: number): void {
    this.#fov = Math.max(FOV.min, Math.min(FOV.max, fov));
    this.draw();
  }

  /** One zoom step in (+1) or out (−1), as the + and − buttons and keys do. */
  zoomStep(dir: 1 | -1): void {
    this.#wheel(new WheelEvent('wheel', { deltaY: -dir * (DETENT + 40), cancelable: true }));
  }

  /** Turns the view by a fraction of its width (arrow keys). */
  nudge(dx: number, dy: number): void {
    if (this.#entry === 'flat') {
      this.#flat = { ...this.#flat, pan: this.#flat.pan - dx * 20 };
    } else {
      const span = this.#entry === 'inside' ? this.#fov : 40;
      this.#centre = {
        ra: (((this.#centre.ra - dx * span * 0.1) % 360) + 360) % 360,
        dec: Math.max(-89, Math.min(89, this.#centre.dec + dy * span * 0.1)),
      };
    }
    this.draw();
  }

  /** Where the ring sits on the canvas; the inside view's camera looks straight through it. */
  setFocus(focus: { x: number; y: number; r: number } | null): void {
    this.#focus = focus;
    this.draw();
  }

  /** The optical axis in canvas pixels, and the radius the field of view is measured across. */
  #axis(): { x: number; y: number; r: number } {
    const { width: w, height: h } = this.canvas;
    // The flat map behind the page takes the page (Sumit, 14 Nov: "too small to be of any use"):
    // as wide as the window allows, centred between the header and the band. The flat map's
    // size is 3.4 r wide (#flatSize), so r is set from the width it should have.
    if (this.#entry === 'flat' && this.#focus && this.#quiet.length) {
      const dpr = w / Math.max(1, this.canvas.getBoundingClientRect().width);
      const { top, bottom } = this.#flatFrame();
      const width = Math.min(w - 48 * dpr, 2 * (bottom - top) - 24 * dpr);
      return { x: w / 2, y: (top + bottom) / 2, r: width / 3.4 };
    }
    return this.#focus ?? { x: w / 2, y: h / 2, r: Math.min(w, h) / 2 };
  }

  /** The canvas between the page's header and its band: where the flat map can be seen. */
  #flatFrame(): { left: number; right: number; top: number; bottom: number } {
    const { width: w, height: h } = this.canvas;
    let top = 0;
    let bottom = h;
    for (const q of this.#quiet) {
      if (q.y + q.h < h * 0.25) top = Math.max(top, q.y + q.h);
      else if (q.y > h * 0.6 && q.w > w * 0.5) bottom = Math.min(bottom, q.y);
    }
    return { left: 0, right: w, top, bottom };
  }

  setLanterns(lanterns: Lantern[]): void {
    this.#lanterns = lanterns;
    this.draw();
  }

  /** The flat map showing the whole sky, centred on a position's RA (the lens view's locator). */
  frameWholeSky(p: SkyPosition): void {
    this.#flat = { pan: p.ra - 180, dy: 0, zoom: 1 };
    this.draw();
  }

  /** Turns the view to face a position. */
  centreOn(p: SkyPosition): void {
    this.#centre = { ra: p.ra, dec: Math.max(-85, Math.min(85, p.dec)) };
    this.#sat = null;
    this.draw();
  }

  /**
   * Glides the inside view to look at a position, narrowing to `fov`. Resolves when there;
   * at once if not in the inside view or the flight is zero-length.
   */
  flyTo(p: SkyPosition, fov: number, ms: number, riding = false): Promise<void> {
    // Going somewhere on purpose pauses riding; the ride's own glides keep it.
    if (!riding && this.#riding) this.ride(false);
    if (this.#entry !== 'inside' || ms <= 0) {
      this.#centre = { ra: p.ra, dec: p.dec };
      this.#fov = fov;
      this.draw();
      return Promise.resolve();
    }
    // A new place to look: SPHEREx moves under it once there.
    if (!riding) this.#sat = null;
    // Take the short way round in right ascension.
    let ra = p.ra;
    if (ra - this.#centre.ra > 180) ra -= 360;
    if (ra - this.#centre.ra < -180) ra += 360;
    // A flight replaced by a newer one still ends (its caller mustn't wait forever).
    this.#flightDone?.();
    return new Promise((resolve) => {
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        if (this.#flightDone === end) this.#flightDone = null;
        resolve();
      };
      this.#flightDone = end;
      const from = { ...this.centre };
      const arc = separationDeg([from.ra, from.dec], [p.ra, p.dec]);
      const bump = arc > 10 ? Math.max(0, Math.min(70, 0.9 * arc) - Math.max(from.fov, fov)) : 0;
      const flight = { from, to: { ra, dec: p.dec, fov }, t0: performance.now(), ms, arc, bump };
      this.#flight = flight;
      const done = () => {
        if (ended) return;
        if (this.#flight === flight) requestAnimationFrame(done);
        else end();
      };
      requestAnimationFrame(done);
      // Where frames are paused (a hidden tab or pane), land anyway, so opening never hangs.
      window.setTimeout(() => {
        if (this.#flight === flight) {
          this.#centre = { ra: (p.ra + 360) % 360, dec: p.dec };
          this.#fov = fov;
          this.#flight = null;
          this.draw();
        }
        end();
      }, ms + 400);
    });
  }

  setStars(stars: CatalogueStar[]): void {
    this.#stars = stars;
    this.draw();
  }

  #milky: GlowMap | null = null;
  #glowLayer: HTMLCanvasElement | null = null;
  #glowKey = '';
  /** The Milky Way's glow from Gaia star counts: catalogue data, drawn under everything. */
  setGlow(map: GlowMap): void {
    this.#milky = map;
    this.#glowKey = '';
    this.draw();
  }

  /**
   * The sky position under a canvas point, or null off the sky: the exact inverse of
   * `project` for each view (front hemisphere only on the globe).
   */
  #unproject(sx: number, sy: number): SkyPosition | null {
    const a = this.#axis();
    if (this.#entry === 'flat') {
      const { pan, dy, zoom } = this.#flat;
      const { w: mw, h: mh } = this.#flatSize();
      const nx = -(sx - a.x) / ((mw / 2) * zoom);
      const ny = -((sy - a.y) / zoom + dy) / (mh / 2);
      const back = this.#flatInverse(nx, ny);
      if (!back) return null;
      return { ra: (((pan + 180 + back[0] / RAD) % 360) + 360) % 360, dec: back[1] / RAD };
    }
    const scale = a.r / Math.tan((this.#fov / 2) * RAD);
    // Standard projection-plane coordinates: x toward the east, y toward the north (the
    // inside camera's roll undone first).
    const X = (sx - a.x) / scale;
    const Y = (a.y - sy) / scale;
    const rc = Math.cos(this.#roll);
    const rs = Math.sin(this.#roll);
    const x = -(X * rc + Y * rs);
    const y = -X * rs + Y * rc;
    const rho = Math.hypot(x, y);
    const d0 = this.#centre.dec * RAD;
    if (rho === 0) return { ...this.#centre };
    const c = angleFromRadius(rho, this.#stereoK);
    const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (y * Math.sin(c) * Math.cos(d0)) / rho);
    const dRa = Math.atan2(
      x * Math.sin(c),
      rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c),
    );
    return { ra: (((this.#centre.ra + dRa / RAD) % 360) + 360) % 360, dec: dec / RAD };
  }

  /**
   * The glow, rebuilt at a sixth of the canvas resolution only when the view has moved, then
   * scaled up with smoothing, which is what makes it a glow rather than a map of pixels.
   */
  #drawGlow(): void {
    const map = this.#milky;
    if (!map) return;
    const ctx = this.#ctx;
    const { width: w, height: h } = this.canvas;
    // At the light tier the glow is built coarser: fewer pixels, the same look once smoothed.
    const s = this.#quality >= 1 ? 6 : 10;
    const lw = Math.ceil(w / s);
    const lh = Math.ceil(h / s);
    // A hidden or not-yet-laid-out canvas has no size; there is nothing to glow on.
    if (!lw || !lh) return;
    const a = this.#axis();
    const f = this.#flat;
    const key = [
      this.#entry,
      lw,
      lh,
      a.x | 0,
      a.y | 0,
      a.r | 0,
      this.#centre.ra.toFixed(1),
      this.#centre.dec.toFixed(1),
      this.#fov.toFixed(2),
      this.#roll.toFixed(3),
      f.pan.toFixed(1),
      f.dy.toFixed(1),
      f.zoom.toFixed(3),
    ].join('|');
    if (key !== this.#glowKey || !this.#glowLayer) {
      const layer = this.#glowLayer ?? document.createElement('canvas');
      layer.width = lw;
      layer.height = lh;
      const lctx = layer.getContext('2d');
      if (!lctx) return;
      const img = lctx.createImageData(lw, lh);
      // The band's tint follows the theme: a cool starlight in A, a neutral one in B.
      const tint = channels(mixHex(this.#t.starlight, this.#t.predicted, 0.6));
      for (let j = 0; j < lh; j++) {
        for (let i = 0; i < lw; i++) {
          const p = this.#unproject((i + 0.5) * s, (j + 0.5) * s);
          if (!p) continue;
          const v = glowAt(map, p);
          const k = 4 * (j * lw + i);
          img.data[k] = tint[0];
          img.data[k + 1] = tint[1];
          img.data[k + 2] = tint[2];
          img.data[k + 3] = Math.round(255 * 0.3 * v ** 1.8);
        }
      }
      lctx.putImageData(img, 0, 0);
      this.#glowLayer = layer;
      this.#glowKey = key;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The counts are ~0.9° pixels: a glow for wide views. Zoomed in, it fades away rather
    // than showing its blocks (full at 40° across, gone by 15°).
    if (this.#entry === 'inside') ctx.globalAlpha = smooth((this.#fov - 15) / 25);
    if (ctx.globalAlpha > 0.01) ctx.drawImage(this.#glowLayer, 0, 0, lw * s, lh * s);
    ctx.restore();
  }

  #figures: Figure[] = [];
  /** Constellation figures: a faint cultural guide for finding your way, not SPHEREx data. */
  setFigures(figures: Figure[]): void {
    this.#figures = figures;
    // Each figure's middle (the mean of its stars), where "in view" is judged.
    this.#figureMid = figures.map((f) => {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const [a, b] of f.segments)
        for (const v of [toVec(a), toVec(b)]) {
          x += v[0];
          y += v[1];
          z += v[2];
        }
      return toPos(norm3([x, y, z]));
    });
    this.#figureReveal = figures.map(() => 0);
    this.draw();
  }
  /** Each figure's middle, and how far its lines have grown in (0 hidden, 1 drawn). */
  #figureMid: SkyPosition[] = [];
  #figureReveal: number[] = [];
  /** On the flat map, whether each figure is wanted (for the show/hide hysteresis). */
  #figureShown: boolean[] = [];
  #figureClock = 0;

  /** The Sun moves to a date (the week on show), or back to today. */
  setDate(date: Date): void {
    this.#sun = sunPosition(date);
    this.#mjd = date.getTime() / 86_400_000 + 40587;
    this.#sat = null;
    this.draw();
  }

  /** Shows a coverage layer (null hides it) at a week. */
  setCoverage(coverage: Coverage | null, week = 0): void {
    if (coverage && coverage !== this.#coverage) {
      this.#corners = Array.from({ length: coverage.nside * coverage.nside * 12 }, (_, p) =>
        pixelCorners(coverage.nside, p),
      );
    }
    this.#coverage = coverage;
    this.#week = week;
    this.draw();
  }

  /** IAU names by Hipparcos number (shown only for bright stars). */
  setNames(names: Map<number, string>): void {
    this.#names = names;
    this.draw();
  }

  /** Lights a lantern from outside (a card being hovered), or none. */
  setLit(id: string | null): void {
    this.#lit = id;
    this.draw();
  }

  /** The named star nearest the optical axis (the caller checks NEAR_DEG for the wording). */
  nearestNamed(): { name: string; sepDeg: number } | null {
    let best: { name: string; sepDeg: number } | null = null;
    const d0 = this.#centre.dec * RAD;
    for (const s of this.#stars) {
      const hip = s[4];
      if (hip === undefined) continue;
      if (s[2] > namedLimit(this.#fov)) continue;
      const name = this.#names.get(hip);
      if (!name) continue;
      const dec = s[1] * RAD;
      const cosSep =
        Math.sin(d0) * Math.sin(dec) +
        Math.cos(d0) * Math.cos(dec) * Math.cos((s[0] - this.#centre.ra) * RAD);
      const sepDeg = Math.acos(Math.max(-1, Math.min(1, cosSep))) / RAD;
      if (!best || sepDeg < best.sepDeg) best = { name, sepDeg };
    }
    return best;
  }

  setEntry(entry: Entry): void {
    this.#entry = entry;
    // Into Look around always starts at SPHEREx.
    if (entry === 'inside') {
      this.#near = this.#nearGoal = 0;
      this.#nearFrom = null;
      this.#tellStepped();
    }
    // The canvas is the page's backdrop in every view (see main), so its size is left alone.
    this.canvas.dataset['entry'] = entry;
    this.draw();
  }

  /** The globe and the inside view turn once every four minutes; the flat map never moves. */
  start(reducedMotion: boolean): void {
    this.#spinning = !reducedMotion;
    cancelAnimationFrame(this.#raf);
    const tick = (t: number) => {
      const f = this.#flight;
      // While flying somewhere, SPHEREx follows; it settles under the view when the flight ends.
      if (f) this.#sat = null;
      if (f) {
        const k = Math.min(1, (t - f.t0) / f.ms);
        // A long hop eases in and out (it pulls back, then dives); a short one eases out.
        const e =
          f.bump > 0
            ? k < 0.5
              ? 4 * k * k * k
              : 1 - Math.pow(-2 * k + 2, 3) / 2
            : 1 - Math.pow(1 - k, 3);
        this.#centre = slerpSky(f.from, f.to, f.arc, e);
        this.#fov = f.from.fov + (f.to.fov - f.from.fov) * e + f.bump * Math.sin(Math.PI * e);
        if (k >= 1) this.#flight = null;
      } else if (
        this.#spinning &&
        this.#entry === 'inside' &&
        this.#near <= 0 &&
        this.#nearGoal <= 0 &&
        !this.#drag &&
        this.#last
      ) {
        if (!this.#riding) {
          // Looking around yourself: the view stays where you leave it.
        } else if (this.#rideOn(t - this.#last)) {
          // Riding along SPHEREx's real pointing (Physics' timeline).
        } else {
          // Riding with SPHEREx: the view and the satellite turn together about the orbit's axis
          // (from its published elements), along with its travel: a hold, then a hop (sped up).
          const before = this.#scanAngle(this.#scanT);
          this.#scanT += t - this.#last;
          const a = (this.#scanAngle(this.#scanT) - before) * RAD;
          const axis = orbitFrame(this.#mjd).normal;
          const sat = this.#riderSat();
          this.#centre = { ...toPos(rotate3(toVec(this.#centre), axis, a)) };
          this.#sat = norm3(rotate3(sat, axis, a));
        }
      }
      if (this.#last) this.#easeNear(t - this.#last);
      this.#last = t;
      this.#clock = t;
      this.draw();
      if (this.#entry === 'inside') this.#announceTurn();
      this.#watchSettle(t);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.#raf);
  }

  /**
   * Looking around yourself: when the view comes to rest somewhere new, the page is told, and
   * answers with when SPHEREx photographed that spot (`setLookDate`). On that date its orbit
   * had the spot nearly overhead, so Earth lies below, out of the way, as it really did.
   */
  onSettle: (at: SkyPosition) => void = () => {};
  #settleFrom: SkyPosition = { ra: NaN, dec: NaN };
  #settleAt = 0;
  #settleTold: SkyPosition = { ra: NaN, dec: NaN };
  /** The date of SPHEREx's photo of the spot looked at, while looking around yourself. */
  #lookMjd: number | null = null;
  #watchSettle(t: number): void {
    const free =
      this.#entry === 'inside' &&
      !this.#riding &&
      this.#near <= 0 &&
      this.#nearGoal <= 0 &&
      !this.#drag &&
      !this.#flight;
    const c = this.#centre;
    const sep = (a: SkyPosition, b: SkyPosition) =>
      Number.isFinite(b.ra) ? separationDeg([a.ra, a.dec], [b.ra, b.dec]) : Infinity;
    if (!free || sep(c, this.#settleFrom) > 0.05) {
      this.#settleFrom = { ...c };
      this.#settleAt = t;
      return;
    }
    if (t - this.#settleAt > 400 && sep(c, this.#settleTold) > 2) {
      this.#settleTold = { ...c };
      this.onSettle({ ...c });
    }
  }

  /** The moment SPHEREx photographed where the visitor is looking (null: back to the date). */
  setLookDate(mjd: number | null): void {
    if (this.#riding) return;
    this.#lookMjd = mjd;
    if (mjd !== null) {
      this.#mjd = mjd;
      this.#sun = sunPosition(new Date((mjd - 40587) * 86_400_000));
    }
    this.#sat = null;
    this.draw();
  }

  #announceTurn(): void {
    const near = this.nearestNamed();
    const narrowest = this.#fov <= FOV.min + 0.01;
    const onLight = this.#lightOnAim();
    const key = `${near ? `${near.name}:${Math.round(near.sepDeg)}` : ''}|${narrowest}|${onLight}`;
    if (key === this.#announced) return;
    this.#announced = key;
    this.onTurn({ near, narrowest, onLight });
  }

  /** The ready lantern sitting on the aim, if any. */
  #lightOnAim(): string | null {
    const a = this.#axis();
    const u = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    for (const l of this.#lanterns) {
      if (!l.ready) continue;
      const p = this.project(l.at);
      if (p && Math.hypot(p.x - a.x, p.y - a.y) < 16 * u) return l.id;
    }
    return null;
  }

  /**
   * Screen position of a sky position, or null when it's out of view. On the globe, `depth`
   * runs from 1 at the centre to 0 at the limb, so things can fade and foreshorten toward the
   * edge instead of switching on there.
   */
  project(p: SkyPosition): { x: number; y: number; depth: number } | null {
    const { width: w, height: h } = this.canvas;
    if (this.#entry === 'flat') {
      // The Hammer–Aitoff all-sky ellipse (equal-area): east on the left, north up, centred
      // on RA pan + 180°. It sits on the axis, pans round (the sky wraps) and zooms.
      const { x: sx, y: sy } = this.#flatPoint(p);
      const a = this.#axis();
      const { zoom } = this.#flat;
      const { w: mw, h: mh } = this.#flatSize();
      if (Math.abs(sx - a.x) > (mw * zoom) / 2 || Math.abs(sy - a.y) > (mh * zoom) / 2) return null;
      if (sx < -w * 0.05 || sx > w * 1.05 || sy < -h * 0.05 || sy > h * 1.05) return null;
      return { x: sx, y: sy, depth: 1 };
    }
    const d0 = this.#centre.dec * RAD;
    const dRa = (p.ra - this.#centre.ra) * RAD;
    const dec = p.dec * RAD;
    const cosC = Math.sin(d0) * Math.sin(dec) + Math.cos(d0) * Math.cos(dec) * Math.cos(dRa);
    const x = -Math.cos(dec) * Math.sin(dRa);
    const y = Math.cos(d0) * Math.sin(dec) - Math.sin(d0) * Math.cos(dec) * Math.cos(dRa);
    // Exploring the sky: the stereographic projection, as planetarium software uses for wide
    // views. It keeps shapes true, so the edges of a 140°-wide page don't stretch (Sumit, 14
    // Nov: the grid "looks a bit unnatural"). With Earth or the 3D scene on screen (riding,
    // stepping out) it eases back to the pinhole camera (gnomonic) they're drawn with. Both
    // have the same scale at the centre, so the ring, the lens field and zoom don't change.
    const k = this.#stereoK;
    // Fully stereographic it can show 104° off-axis; any pinhole share must stay inside 88°,
    // where the blend is still one-to-one (and the pinhole camera alone stops at 78°).
    if (cosC < (k >= 1 ? -0.25 : 0.2 - 0.165 * k)) return null;
    const m = (1 - k) / cosC + (k * 2) / (1 + cosC);
    const a = this.#axis();
    const f = a.r / Math.tan((this.#fov / 2) * RAD);
    const [rx, ry] = this.#rolled(x * m, y * m);
    return { x: a.x + rx * f, y: a.y - ry * f, depth: 1 };
  }

  /** How long recent draws took, ms (CPU, including the 3D scene's submission): headroom. */
  readonly workMs: number[] = [];
  draw(): void {
    const t0 = performance.now();
    this.#drawFrame();
    this.workMs.push(performance.now() - t0);
    if (this.workMs.length > 600) this.workMs.splice(0, this.workMs.length - 600);
  }

  /**
   * How stereographic the inside view is (1) or pinhole (0): pinhole while Earth or the 3D scene
   * shows (riding, stepping out), so the stars stay registered with them; eased between.
   */
  #stereoK = 1;
  /** The current change of projection: a fixed 400 ms ease-in-out from its start (Viewer). */
  #stereoEase = { from: 1, to: 1, t0: 0 };
  #stepStereo(): void {
    const target =
      this.#entry === 'inside' && !this.#riding && this.#near <= 0 && this.#nearGoal <= 0 ? 1 : 0;
    const now = performance.now();
    if (target !== this.#stereoEase.to)
      this.#stereoEase = { from: this.#stereoK, to: target, t0: now };
    const k = Math.min(1, (now - this.#stereoEase.t0) / 400);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    this.#stereoK = this.#stereoEase.from + (this.#stereoEase.to - this.#stereoEase.from) * e;
  }

  #drawFrame(): void {
    this.#stepStereo();
    const ctx = this.#ctx;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    // Where text may not go this frame: the page's panels, the chip stack, and what the
    // priority labels (the five, the Sun, SPHEREx, Earth, notes) took last frame. Star and
    // figure names give way to all of these.
    this.#taken = [...this.#quiet, ...this.#edges.map((e) => e.box), ...this.#priorityNext];
    this.#priorityNext = [];
    this.#nearView();
    this.#glow();
    // Canvas pixels per CSS pixel, so text and marks keep their on-screen size.
    const u = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    this.#drawGlow();
    const inside = this.#entry === 'inside';
    // Zooming in brightens and widens the stars a little, as a real camera would.
    const zoom = inside ? Math.sqrt(BASE_FOV / this.#fov) : 1;
    this.#grid(u);
    // On the flat map the grid's labels are its scale: they go first and names give way to them.
    if (!inside) this.#gridLabels(u);
    this.#drawFigures(u);
    this.#coverageWash();
    // The Sun's path in mist: ember means measured, and nothing here was.
    if (inside) this.#line(this.#ecliptic, rgba(this.#t.mist, 0.3), u, [4 * u, 6 * u]);
    const named: { name: string; p: { x: number; y: number } }[] = [];
    // The light tier draws about half as many stars (half a magnitude shallower).
    const limit = magnitudeLimit(this.#cssPxPerDeg()) - (this.#quality >= 1 ? 0 : 0.5);
    for (const [ra, dec, v, bv, hip] of this.#stars) {
      if (v > limit) continue;
      const p = this.project({ ra, dec });
      if (!p) continue;
      ctx.fillStyle = starColour(bv);
      // Faint stars stay faint, and the faintest tier (within a magnitude of the limit) fades in.
      const fade = Math.min(1, (limit - v + 0.2) / 1.2);
      const edge = limbFade(p.depth);
      ctx.globalAlpha = fade * edge * Math.max(0.35, Math.min(1, 1.25 - v / 8));
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        u * zoom * Math.max(0.7, 2.1 - v * 0.22) * (0.5 + 0.5 * p.depth),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // The brightest stars carry a soft glow of their own colour.
      if (v < 1.6 && this.#quality >= 1) {
        const glowR = Math.max(0, u * zoom * (9 - v * 3.5) * (0.5 + 0.5 * p.depth));
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, starColour(bv).replace('rgb(', 'rgba(').replace(')', ' / 0.35)'));
        glow.addColorStop(1, 'rgba(255 255 255 / 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
      if (inside && v <= namedLimit(this.#fov) && hip !== undefined) {
        const name = this.#names.get(hip);
        if (name) named.push({ name, p });
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(this.#t.mist, 0.6);
    ctx.font = `${11.5 * u}px ${this.#fontSans}`;
    if (this.marks) {
      for (const { name, p } of named) {
        const box = { x: p.x + 7 * u, y: p.y, w: ctx.measureText(name).width, h: 14 * u };
        // Not cut off at the screen's edges (the wide view reaches them now; Viewer).
        const edge = 12 * u;
        if (box.x < edge || box.y < edge || box.x + box.w > w - edge || box.y + box.h > h - edge)
          continue;
        if (this.#taken.some((q) => overlaps(q, box))) continue;
        this.#taken.push(box);
        ctx.fillText(name, box.x, p.y + 12 * u);
      }
    }
    const detail = inside && this.marks && this.#fov <= DETAIL_FOV;
    if (inside && this.marks) this.#sunMark(u);
    if (detail) this.#photoOutline(u);
    if (inside && this.marks) this.#caption(u, detail);
    for (const l of this.#lanterns) {
      const p = this.project(l.at);
      if (!p) continue;
      // Same size for every lantern (a bigger glow would read as brighter); the hue carries
      // the contract: ember for a measured move, starlight where nothing was measured.
      const hue = l.measured === false ? this.#t.mist : this.#t.show;
      const colour = l.ready ? hue : rgba(hue, 0.35);
      const core = mixHex(hue, '#ffffff', 0.55);
      const lit = l.id === this.#lit;
      ctx.globalAlpha = limbFade(p.depth);
      // A soft dark ground under the glow keeps the lantern clear of the stars behind it.
      const ground = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 20 * u);
      ground.addColorStop(0, rgba(this.#t.night, 0.7));
      ground.addColorStop(1, rgba(this.#t.night, 0));
      ctx.fillStyle = ground;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20 * u, 0, Math.PI * 2);
      ctx.fill();
      if (l.ready) {
        // A warm glow that breathes slowly, a little out of step with the others; brighter
        // when lit (hovered, or its card is).
        const phase = (this.#clock / 1800 + l.id.length) % (Math.PI * 2);
        const breath = this.#spinning ? 1 + 0.1 * Math.sin(phase) : 1;
        const reach = (lit ? 34 : 27) * u * breath;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, reach);
        glow.addColorStop(0, rgba(core, lit ? 0.75 : 0.5));
        glow.addColorStop(0.35, rgba(hue, lit ? 0.35 : 0.22));
        glow.addColorStop(1, rgba(hue, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, reach, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = l.ready ? core : colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, u * (l.ready ? (lit ? 4.5 : 3.5) : 3), 0, Math.PI * 2);
      ctx.fill();
      // Behind a show the sky is faint context; its labels would only collide with the page.
      if (this.marks) {
        this.#label(l.label, p, 16 * u, u, l.story, true);
      }
      ctx.globalAlpha = 1;
    }
    this.#earthBelow(u);
    if (this.#entry === 'inside') this.#nearThings(u, this.#cameraPos());
    if (this.#near <= 0) this.#ridingNote(u);
    else this.#scaleBar(u);
    this.#edgeChips(u);
    // Inside, they're the lowest priority: after every other label has its place.
    if (inside) this.#gridLabels(u);
    if (detail) this.#aim(u);
    if (this.#entry === 'flat') {
      this.#featherFlat();
      // The edge labels sit on the feathered rim: their places were taken early (names give
      // way to them), their text is drawn after the feather so it isn't faded with the rim.
      const late = this.#lateLabels;
      this.#lateLabels = [];
      this.#ctx.font = `${11 * u}px ${this.#fontSans}`;
      for (const l of late) this.#gridLabel(l.text, l.x, l.y, u, l.ink, l.align, true, true);
    }
  }

  /**
   * A position on the flat map, canvas pixels. `side` (±1) keeps a point at the map's seam on
   * that edge (for a cell that straddles it), rather than letting it wrap to the other.
   */
  #flatPoint(p: SkyPosition, side = 0): { x: number; y: number } {
    const { pan, dy, zoom } = this.#flat;
    const a = this.#axis();
    const { w: mw, h: mh } = this.#flatSize();
    let lambda = ((((p.ra - pan - 180) % 360) + 540) % 360) - 180;
    if (side && Math.sign(lambda) !== side && Math.abs(lambda) > 90) lambda = side * 180;
    const [nx, ny] = this.#flatForward(lambda * RAD, p.dec * RAD);
    return {
      x: a.x - nx * (mw / 2) * zoom,
      y: a.y + (-ny * (mh / 2) - dy) * zoom,
    };
  }

  /**
   * The flat map's projection: Hammer–Aitoff (an ellipse) or Equal Earth (a rounded rectangle
   * that fills more of the page). Both equal-area, so the coverage and the poles stay honest.
   */
  flatProjection: 'hammer' | 'equalEarth' = 'equalEarth';
  /** λ, φ (radians) to the map's box, each in [−1, 1]. */
  #flatForward(lambda: number, phi: number): [number, number] {
    if (this.flatProjection === 'equalEarth') {
      const [x, y] = equalEarth(lambda, phi);
      return [x / EE_XMAX, y / EE_YMAX];
    }
    const [hx, hy] = hammer(lambda, phi);
    return [hx / (2 * Math.SQRT2), hy / Math.SQRT2];
  }
  #flatInverse(nx: number, ny: number): [number, number] | null {
    if (this.flatProjection === 'equalEarth') return unEqualEarth(nx * EE_XMAX, ny * EE_YMAX);
    return unhammer(nx * 2 * Math.SQRT2, ny * Math.SQRT2);
  }

  /** The flat map's size on the canvas at zoom 1: as wide as the axis allows, 2:1. */
  #flatSize(): { w: number; h: number } {
    const a = this.#axis();
    const w = Math.min(a.r * 3.4, a.x * 2 - 8);
    return { w, h: w / 2 };
  }

  /**
   * The flat map's edges fade out rather than ending in a line: the edges are erased to
   * transparency with soft gradients, then the page glow is painted back underneath.
   */
  #featherFlat(): void {
    const ctx = this.#ctx;
    const a = this.#axis();
    const { w: mw, h: mh } = this.#flatSize();
    const z = this.#flat.zoom;
    const rx = (mw * z) / 2;
    const ry = (mh * z) / 2;
    // A canvas laid out at no size yet (leaving a show for the flat map) has no ellipse to trim.
    if (!(rx > 0 && ry > 0)) return;
    const f = Math.min(70 * (this.canvas.width / 1120), mw * 0.1);
    if (this.flatProjection === 'equalEarth') {
      // Equal Earth's outline (its edge meridians and flat poles), kept with a soft edge.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.filter = `blur(${(f / 3).toFixed(1)}px)`;
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const phi = (-90 + i * 2) * RAD;
        const [nx, ny] = this.#flatForward(Math.PI, phi);
        const x = a.x - nx * rx;
        const y = a.y - ny * ry - this.#flat.dy * z;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      for (let i = 90; i >= 0; i--) {
        const phi = (-90 + i * 2) * RAD;
        const [nx, ny] = this.#flatForward(-Math.PI, phi);
        ctx.lineTo(a.x - nx * rx, a.y - ny * ry - this.#flat.dy * z);
      }
      ctx.closePath();
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'destination-over';
      this.#glow();
      ctx.restore();
      return;
    }
    // The map is the Hammer ellipse: keep what's inside it, fading out over its last `f` px.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.translate(a.x, a.y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, Math.max(0, rx - f), 0, 0, rx);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(
      -this.canvas.width * 2,
      -this.canvas.height * 4,
      this.canvas.width * 4,
      this.canvas.height * 8,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    this.#glow();
    ctx.restore();
  }

  /** The page's only light source: a soft glow around the axis. */
  #glow(): void {
    const ctx = this.#ctx;
    const { width: w, height: h } = this.canvas;
    const ax = this.#axis();
    const glow = ctx.createRadialGradient(ax.x, ax.y, 0, ax.x, ax.y, Math.max(w, h) * 0.6);
    glow.addColorStop(0, mixHex(this.#t.night, this.#t.dusk, 0.8));
    glow.addColorStop(1, this.#t.night);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Where SPHEREx photographed, as a soft wash: everything up to the week on show faintly,
   * that week itself brighter. A wash, not dots, so it reads as a surface under the stars.
   */
  #washLayer: HTMLCanvasElement | null = null;
  /**
   * How strongly the week on show is painted (1: quiet, for exploring). Learn's first step,
   * where the week's band IS the point ("a ring of sky at right angles to the Sun"), turns it up.
   */
  coverageStrength = 1;
  #washSmall: HTMLCanvasElement | null = null;

  /**
   * Where SPHEREx looked, as a soft wash. The coverage map's cells are HEALPix diamonds about
   * 4° across; drawn crisp, a week's strip reads as a saw-toothed edge that SPHEREx's real
   * footprint doesn't have. So the cells are drawn into their own layer and blurred by about
   * half a cell before they reach the sky.
   */
  #coverageWash(
    cov: Coverage | null = this.#coverage,
    week = this.#week,
    opts: { sofar: boolean; alpha: number } = { sofar: true, alpha: 1 },
  ): void {
    if (!cov) return;
    if (cov.nside * cov.nside * 12 !== this.#corners.length)
      this.#corners = Array.from({ length: cov.nside * cov.nside * 12 }, (_, p) =>
        pixelCorners(cov.nside, p),
      );
    const main = this.#ctx;
    const { width: W, height: H } = this.canvas;
    const s = 3;
    const layer = (this.#washLayer ??= document.createElement('canvas'));
    if (layer.width !== Math.ceil(W / s) || layer.height !== Math.ceil(H / s)) {
      layer.width = Math.ceil(W / s);
      layer.height = Math.ceil(H / s);
    }
    const ctx = layer.getContext('2d');
    if (!ctx || !layer.width || !layer.height) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.width, layer.height);
    ctx.setTransform(1 / s, 0, 0, 1 / s, 0, 0);
    const sofar = opts.sofar ? cov.upTo(week) : null;
    const now = cov.week(week);
    const flat = this.#entry === 'flat';
    const a = this.#axis();
    // The flat map's width on screen, and its centre: a pixel wider than half the map is one
    // that straddles the map's edge, where the sky wraps.
    const mapW = this.#flatSize().w * this.#flat.zoom;
    let cellSum = 0;
    let cells = 0;
    const polygon = (poly: { x: number; y: number }[]) => {
      ctx.beginPath();
      poly.forEach(({ x, y }, i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };
    // Opacity grows with the log of the photo count, reaching `max` at `full` photos, so a
    // pixel photographed a thousand times reads denser than one photographed a few times,
    // and the stars still show through.
    const fill = (counts: ArrayLike<number>, colour: string, full: number, max: number) => {
      ctx.fillStyle = colour;
      const scale = max / Math.log1p(full);
      for (let p = 0; p < counts.length; p++) {
        const n = counts[p] ?? 0;
        if (!n) continue;
        const pts = this.#corners[p]?.map((k) => this.project(k));
        if (!pts || pts.some((q) => q === null)) continue;
        const poly = pts as { x: number; y: number }[];
        const xs = poly.map((q) => q.x);
        const ys = poly.map((q) => q.y);
        const span = Math.max(...xs) - Math.min(...xs);
        ctx.globalAlpha = Math.min(max, Math.log1p(n) * scale);
        if (flat && span > mapW / 2) {
          // The pixel straddles the map's seam (the ellipse's edge): drawn once on each side,
          // its far corners held on that edge, so the seam never reads as a gap.
          const corners = this.#corners[p] ?? [];
          for (const side of [1, -1]) polygon(corners.map((k) => this.#flatPoint(k, side)));
        } else {
          polygon(poly);
          cellSum += Math.max(span, Math.max(...ys) - Math.min(...ys));
          cells++;
        }
      }
      ctx.globalAlpha = 1;
    };
    // "So far" stays quiet even once the whole sky is painted; the week on show is the news.
    // SPHEREx's own coverage, so the look colour: the week on show a little lighter.
    if (sofar) fill(sofar, this.#t.look, 5000, 0.1 * opts.alpha);
    fill(
      now,
      mixHex(this.#t.look, this.#t.starlight, 0.35),
      600,
      Math.min(0.8, 0.32 * this.coverageStrength) * opts.alpha,
    );
    if (!cells) return;
    // Blur by about a third of a cell, on screen pixels.
    const blur = Math.max(2, (cellSum / cells) * 0.35);
    main.save();
    if (flat) {
      // Keep the unwrapped halves of edge pixels on the map, not spilling past its edges.
      const mh = this.#flatSize().h * this.#flat.zoom;
      main.beginPath();
      main.rect(a.x - mapW / 2, a.y - mh / 2, mapW, mh);
      main.clip();
    }
    main.imageSmoothingEnabled = true;
    if (typeof main.filter === 'string' && this.#quality >= 1) {
      main.filter = `blur(${blur.toFixed(1)}px)`;
      main.drawImage(layer, 0, 0, W, H);
      main.filter = 'none';
    } else {
      // No canvas filters (older Safari): soften by shrinking the layer and scaling it back.
      const k = Math.max(2, Math.round(blur / s));
      const small = (this.#washSmall ??= document.createElement('canvas'));
      small.width = Math.max(1, Math.ceil(layer.width / k));
      small.height = Math.max(1, Math.ceil(layer.height / k));
      const sc = small.getContext('2d');
      if (sc) {
        sc.imageSmoothingEnabled = true;
        sc.clearRect(0, 0, small.width, small.height);
        sc.drawImage(layer, 0, 0, small.width, small.height);
        main.drawImage(small, 0, 0, W, H);
      }
    }
    main.restore();
  }

  #grid(u: number): void {
    const ctx = this.#ctx;
    // The grid tightens as the view narrows, so there is always a sense of scale.
    const inside = this.#entry === 'inside';
    const raStep = inside ? raGridStep(this.#fov) : 30;
    const step = inside ? decGridStep(this.#fov) : 30;
    for (let ra = 0; ra < 360; ra += raStep) {
      this.#line(
        Array.from({ length: 181 }, (_, i) => ({ ra, dec: -90 + i })),
        COLOURS.grid,
        u,
      );
    }
    for (let dec = -90 + step; dec <= 90 - step; dec += step) {
      this.#line(
        Array.from({ length: 361 }, (_, i) => ({ ra: i, dec })),
        COLOURS.grid,
        u,
      );
    }
    ctx.setLineDash([]);
  }

  /* ---------- the grid's labels: the coordinates the search box asks for ---------- */

  /** A typed spot (before Enter): its own RA and Dec lines, labelled, crossing at the spot. */
  #spot: SkyPosition | null = null;
  setSpot(p: SkyPosition | null, name: string | null = null): void {
    // From one option to the next the marker and its lines glide along the great circle
    // (Sumit, 14 Nov: the sky should answer the list smoothly); a first spot just appears.
    const from = this.#spotNow();
    this.#spotGlide =
      p && from && this.#spinning
        ? { from, arc: separationDeg([from.ra, from.dec], [p.ra, p.dec]), t0: performance.now() }
        : null;
    this.#spot = p;
    this.#spotName = name;
    this.draw();
  }
  #spotGlide: { from: SkyPosition; arc: number; t0: number } | null = null;
  /** Where the typed spot is drawn now: on its way during a glide (260 ms, eased out). */
  #spotNow(): SkyPosition | null {
    const g = this.#spotGlide;
    const s = this.#spot;
    if (!g || !s) return s;
    const k = Math.min(1, (performance.now() - g.t0) / 260);
    if (k >= 1) {
      this.#spotGlide = null;
      return s;
    }
    return slerpSky(g.from, s, g.arc, 1 - Math.pow(1 - k, 3));
  }
  /** The spot's name, shown beside its marker on the flat map. */
  #spotName: string | null = null;

  /** Stops a flight where it is (the visitor took over); its caller's promise ends. */
  cancelFlight(): void {
    this.#flight = null;
    this.#flightDone?.();
  }
  /** Ends the current flight's promise (when it lands, is replaced or is cancelled). */
  #flightDone: (() => void) | null = null;

  /** The open sky this frame: inside the header, the words column and the band. */
  #openSky(u: number): { left: number; right: number; top: number; bottom: number } {
    const { width: W, height: H } = this.canvas;
    const m = 30 * u;
    let right = W - m;
    let top = m;
    let bottom = H - m;
    for (const q of this.#quiet) {
      if (q.y + q.h < H * 0.25) top = Math.max(top, q.y + q.h + m * 0.5);
      else if (q.y > H * 0.6 && q.w > W * 0.5) bottom = Math.min(bottom, q.y - m * 0.5);
      else if (q.x > W * 0.45) right = Math.min(right, q.x - m * 0.5);
    }
    return { left: m, right, top, bottom };
  }

  /**
   * Where a line on the sky crosses x = `at` (side 'x') or y = `at` (side 'y') inside the open
   * sky: the other coordinate of each crossing.
   */
  #crossings(points: SkyPosition[], side: 'x' | 'y', at: number, lo: number, hi: number): number[] {
    const out: number[] = [];
    let prev: { x: number; y: number } | null = null;
    for (const pt of points) {
      const p = this.project(pt);
      if (p && prev) {
        const a = side === 'x' ? prev.x - at : prev.y - at;
        const b = side === 'x' ? p.x - at : p.y - at;
        // A long jump is the projection wrapping (flat map seam), not a crossing.
        if (a * b <= 0 && a !== b && Math.hypot(p.x - prev.x, p.y - prev.y) < 400) {
          const f = a / (a - b);
          const v = side === 'x' ? prev.y + f * (p.y - prev.y) : prev.x + f * (p.x - prev.x);
          if (v > lo && v < hi) out.push(v);
        }
      }
      prev = p;
    }
    return out;
  }

  /** One small label in the grid's ink, unless it would cover something more important. */
  #gridLabel(
    text: string,
    x: number,
    y: number,
    u: number,
    colour: string,
    align: 'left' | 'center',
    priority = false,
    halo = false,
  ): boolean {
    const ctx = this.#ctx;
    const w = ctx.measureText(text).width;
    const box = { x: align === 'center' ? x - w / 2 : x, y: y - 11 * u, w, h: 14 * u };
    // A priority label (the typed spot's) always draws: it reserved its own box last frame.
    if (!priority && this.#taken.some((q) => overlaps(q, box))) return false;
    if (priority) this.#reserve(box);
    else this.#taken.push(box);
    ctx.textAlign = align;
    if (halo) {
      // A night halo, as the lantern labels have, so small text reads over a busy map.
      ctx.strokeStyle = rgba(this.#t.night, 0.8);
      ctx.lineWidth = 3 * u;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
    return true;
  }

  /**
   * Labels for the grid (Sumit, 14 Nov: "what's the point of the grid lines if there are no
   * markers?"). Inside the sky: Dec on the open sky's left edge, RA (hours) just above the band,
   * a few each, never over the page or another label. On the flat map: the same, on the map's
   * edges (#flatEdgeLabels).
   */
  #gridLabels(u: number): void {
    if (!this.marks) return;
    const ctx = this.#ctx;
    const inside = this.#entry === 'inside';
    const ink = rgba(this.#t.mist, 0.55);
    ctx.font = `${11 * u}px ${this.#fontSans}`;
    const o = this.#openSky(u);
    const spot = this.#spotNow();
    // The typed spot's own lines first: they carry its numbers to the edges.
    if (spot && inside) {
      const look = this.#t.look;
      const meridian = Array.from({ length: 181 }, (_, i) => ({ ra: spot.ra, dec: -90 + i }));
      const parallel = Array.from({ length: 361 }, (_, i) => ({ ra: i, dec: spot.dec }));
      this.#line(meridian, rgba(look, 0.55), u);
      this.#line(parallel, rgba(look, 0.55), u);
    }
    // In flight the labels would slide every frame and their text shimmer: lines only until
    // the view lands (Viewer, 14 Nov).
    if (spot && inside && !this.#flight) {
      const look = this.#t.look;
      const meridian = Array.from({ length: 181 }, (_, i) => ({ ra: spot.ra, dec: -90 + i }));
      const parallel = Array.from({ length: 361 }, (_, i) => ({ ra: i, dec: spot.dec }));
      for (const y of this.#crossings(
        parallel,
        'x',
        o.left,
        o.top + 12 * u,
        o.bottom - 4 * u,
      ).slice(0, 1))
        this.#gridLabel(decText(spot.dec, 60), o.left + 4 * u, y - 3 * u, u, look, 'left', true);
      for (const x of this.#crossings(
        meridian,
        'y',
        o.bottom,
        o.left + 24 * u,
        o.right - 24 * u,
      ).slice(0, 1))
        this.#gridLabel(raText(spot.ra, 60), x, o.bottom - 4 * u, u, look, 'center', true);
    }
    if (inside) {
      const raStep = raGridStep(this.#fov);
      const decStep = decGridStep(this.#fov);
      const placedY: number[] = [];
      for (let dec = -90 + decStep; dec <= 90 - decStep; dec += decStep) {
        const line = Array.from({ length: 361 }, (_, i) => ({ ra: i, dec }));
        for (const y of this.#crossings(line, 'x', o.left, o.top + 12 * u, o.bottom - 4 * u)) {
          if (placedY.some((p) => Math.abs(p - y) < 48 * u)) continue;
          if (this.#gridLabel(decText(dec, 3600), o.left + 4 * u, y - 3 * u, u, ink, 'left'))
            placedY.push(y);
        }
      }
      // Meridians crowd near the poles: no RA labels there.
      if (Math.abs(this.#centre.dec) > 70) return;
      const placedX: number[] = [];
      for (let ra = 0; ra < 360; ra += raStep) {
        const line = Array.from({ length: 181 }, (_, i) => ({ ra, dec: -90 + i }));
        for (const x of this.#crossings(line, 'y', o.bottom, o.left + 24 * u, o.right - 24 * u)) {
          if (placedX.some((p) => Math.abs(p - x) < 70 * u)) continue;
          if (this.#gridLabel(raText(ra, raStep * 240), x, o.bottom - 4 * u, u, ink, 'center'))
            placedX.push(x);
        }
      }
      return;
    }
    // A spot on the flat map (Surprise me's destination): a small ring and its name.
    if (spot) {
      const p = this.project(spot);
      if (p) {
        const ctx2 = this.#ctx;
        ctx2.strokeStyle = this.#t.look;
        ctx2.lineWidth = 1.5 * u;
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
        ctx2.stroke();
        if (this.#spotName)
          this.#gridLabel(
            this.#spotName,
            p.x + 10 * u,
            p.y + 4 * u,
            u,
            this.#t.look,
            'left',
            true,
            true,
          );
      }
    }
    // On the edges, as a world map is labelled (Sumit, 14 Nov: "why not at edges?"); the map
    // now fills the page, so the centre-line labels it had when small only sat in the way.
    // Dec where each parallel first meets the left of what's visible, RA where each meridian
    // meets the bottom: the map's own rim at full size, the screen's edge once zoomed in (as
    // the inside view does). Brighter ink with a night halo, over the feathered rim.
    this.#flatEdgeLabels(u, rgba(this.#t.mist, 0.85));
  }

  #flatEdgeLabels(u: number, ink: string): void {
    const f = this.#flatFrame();
    const pad = 6 * u;
    const fr = {
      left: f.left + pad,
      right: f.right - pad,
      top: f.top + 14 * u,
      bottom: f.bottom - pad,
    };
    const seen = (p: { x: number; y: number }) =>
      p.x >= fr.left && p.x <= fr.right && p.y >= fr.top && p.y <= fr.bottom;
    // The first visible point along a line (t from 0 to 1), refined by halving between samples.
    const first = (at: (t: number) => { x: number; y: number }, n: number) => {
      let prev = 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (!seen(at(t))) {
          prev = t;
          continue;
        }
        if (i === 0) return at(0);
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const m = (lo + hi) / 2;
          if (seen(at(m))) hi = m;
          else lo = m;
        }
        return at(hi);
      }
      return null;
    };
    const { pan } = this.#flat;
    const placedY: number[] = [];
    for (const dec of [60, 30, 0, -30, -60]) {
      // From the map's left rim (λ = +180°) rightwards; `side` keeps the rim on the left.
      const p = first((t) => {
        const lambda = 180 - 360 * t;
        return this.#flatPoint({ ra: pan + 180 + lambda, dec }, lambda >= 0 ? 1 : -1);
      }, 360);
      if (!p || placedY.some((y) => Math.abs(y - p.y) < 18 * u)) continue;
      const text = decText(dec, 3600);
      const w = this.#ctx.measureText(text).width;
      this.#taken.push({ x: p.x + 4 * u, y: p.y - 14 * u, w, h: 14 * u });
      this.#lateLabels.push({ text, x: p.x + 4 * u, y: p.y - 3 * u, ink, align: 'left' });
      placedY.push(p.y);
    }
    const placed: Box[] = [];
    for (let ra = 0; ra < 360; ra += 30) {
      // From the south pole upwards.
      const p = first((t) => this.#flatPoint({ ra, dec: -90 + 180 * t }), 180);
      if (!p) continue;
      const text = raText(ra, 3600);
      const w = this.#ctx.measureText(text).width;
      const box = { x: p.x - w / 2 - 6 * u, y: p.y - 18 * u, w: w + 12 * u, h: 16 * u };
      if (placed.some((q) => overlaps(q, box))) continue;
      this.#taken.push({ x: p.x - w / 2, y: p.y - 16 * u, w, h: 14 * u });
      this.#lateLabels.push({ text, x: p.x, y: p.y - 5 * u, ink, align: 'center' });
      placed.push(box);
    }
  }
  #lateLabels: { text: string; x: number; y: number; ink: string; align: 'left' | 'center' }[] = [];

  /** Under the caption: where the aim is, as the search box would take it. */
  #centreReadout(u: number, y: number): void {
    const ctx = this.#ctx;
    const a = this.#axis();
    const text = positionText(this.#centre, this.#fov);
    ctx.font = `${11.5 * u}px ${this.#fontSans}`;
    ctx.fillStyle = rgba(this.#t.mist, 0.7);
    ctx.textAlign = 'center';
    ctx.fillText(text, a.x, y);
    const tw = ctx.measureText(text).width;
    this.#reserve({ x: a.x - tw / 2, y: y - 12 * u, w: tw, h: 16 * u });
    ctx.textAlign = 'left';
  }

  /* ---------- riding with SPHEREx: the camera on its orbit, Earth below ---------- */

  /** Where SPHEREx (the camera) is, as a direction from Earth's centre; set on arrival. */
  #sat: Vec3 | null = null;
  /** Riding time, ms on screen, for the hold-and-hop scan. */
  #scanT = 0;
  /** Degrees scanned after `ms` of riding: whole hops, plus the eased part of the current one. */
  #scanAngle(ms: number): number {
    const period = (SCAN_HOP_S * 1000) / SCAN_SPEEDUP;
    const n = Math.floor(ms / period);
    return SCAN_HOP_DEG * (n + smooth((ms - n * period) / 1500));
  }

  /** The satellite under the view: the point on its real orbit whose zenith is nearest the view. */
  #riderSat(): Vec3 {
    if (this.#sat) return this.#sat;
    const { normal, node } = orbitFrame(this.#mjd);
    const c = toVec(this.#centre);
    const raw: Vec3 = [
      c[0] - normal[0] * dot3(c, normal),
      c[1] - normal[1] * dot3(c, normal),
      c[2] - normal[2] * dot3(c, normal),
    ];
    // Looking straight along the orbit's axis, any orbit point will do.
    const along = Math.hypot(...raw) < 1e-3 ? node : norm3(raw);
    this.#sat = along;
    return along;
  }

  /** A new place to look from (a search, a flight): SPHEREx moves under it. */
  resetRider(): void {
    this.#sat = null;
  }

  /* ---------- riding along SPHEREx's real pointing (Physics' timelines) ---------- */

  #timeline: Timeline | null = null;
  /**
   * Riding: the view follows SPHEREx. Off by default since 14 Nov (the homepage's sky holds still
   * for typed spots; riding lives in Learn's first step); looking around yourself pauses it.
   */
  #riding = false;
  /** The ride's clock (MJD), or null to start from the exposure nearest the view. */
  #rideMjd: number | null = null;
  #ridePoint: ReturnType<typeof pointingAt> | null = null;
  /** Told when riding starts or stops (the page's "Ride with SPHEREx" control). */
  onRide: (on: boolean) => void = () => {};
  get riding(): boolean {
    return this.#riding;
  }

  /**
   * The timeline to ride along; `startMjd` starts the ride at that moment (a target's photo),
   * otherwise at the exposure nearest wherever the visitor is looking.
   */
  setTimeline(t: Timeline | null, startMjd: number | null = null): void {
    this.#timeline = t && t.rows.length > 1 ? t : null;
    this.#rideMjd = startMjd;
    this.#ridePoint = null;
  }

  /** Starts or stops riding; starting glides the view to where SPHEREx is pointing. */
  ride(on: boolean): void {
    if (on === this.#riding) return;
    this.#riding = on;
    if (on) this.#lookMjd = null;
    if (on) {
      this.#sat = null;
      const t = this.#timeline;
      if (t && this.#entry === 'inside') {
        if (this.#rideMjd === null) {
          const i = nearestRow(t.rows, [this.#centre.ra, this.#centre.dec]);
          this.#rideMjd = t.rows[i]?.[0] ?? null;
        }
        if (this.#rideMjd !== null) {
          const p = pointingAt(t.rows, this.#rideMjd);
          if (separationDeg([p.ra, p.dec], [this.#centre.ra, this.#centre.dec]) > 0.5)
            void this.flyTo({ ra: p.ra, dec: p.dec }, this.#fov, 1400, true);
        }
      }
    }
    this.onRide(on);
    this.draw();
  }

  /** Each frame while riding: the clock moves on, and the view and SPHEREx with it. */
  #rideOn(dt: number): boolean {
    const t = this.#timeline;
    if (!t || this.#flight) return false;
    const first = t.rows[0];
    const last = t.rows[t.rows.length - 1];
    if (!first || !last) return false;
    if (this.#rideMjd === null) {
      // Starting: from the exposure nearest the view, gliding there rather than jumping.
      const i = nearestRow(t.rows, [this.#centre.ra, this.#centre.dec]);
      const r = t.rows[i] ?? first;
      this.#rideMjd = r[0];
      if (separationDeg([r[1], r[2]], [this.#centre.ra, this.#centre.dec]) > 0.5) {
        void this.flyTo({ ra: r[1], dec: r[2] }, this.#fov, 1400, true);
        return true;
      }
    }
    const row = this.#ridePoint?.row ?? 0;
    this.#rideMjd += (dt / 1000) * (speedAfter(t.rows, row) / 86_400);
    if (this.#rideMjd > last[0]) {
      // The end of the day on file: round again from its start.
      this.#rideMjd = first[0];
      void this.flyTo({ ra: first[1], dec: first[2] }, this.#fov, 1400, true);
      return true;
    }
    const p = pointingAt(t.rows, this.#rideMjd);
    this.#ridePoint = p;
    this.#centre = { ra: p.ra, dec: p.dec };
    // The date and SPHEREx's place follow the ride: Earth's turn, the Sun, the orbit.
    this.#mjd = this.#rideMjd;
    this.#sun = sunPosition(new Date((this.#rideMjd - 40587) * 86_400_000));
    const look = toVec(this.#centre);
    const at = orbitPoint(this.#rideMjd, nearestU(this.#rideMjd, look));
    this.#sat = norm3(at);
    return true;
  }

  /** "15 Nov 2025, 08:14 UT", for the riding note. */
  #rideWhen(mjd = this.#rideMjd): string {
    if (mjd === null) return '';
    const d = new Date((mjd - 40587) * 86_400_000);
    const hm = d.toISOString().slice(11, 16);
    return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}, ${hm} UT`;
  }

  /**
   * Earth below, seen from SPHEREx's orbit: every direction within EARTH_ANG of straight down,
   * at its true size from 650 km up. Its day side faces the Sun; SPHEREx rides the day-night
   * line, so below it Earth is half lit. A thin bright edge is the atmosphere.
   */
  #earthBelow(u: number): void {
    if (this.#entry !== 'inside') return;
    // Only when the camera is SPHEREx's (riding) or stepping out to the orbit (both in Learn,
    // since 14 Nov). Looking around yourself is the sky as photographed: Earth would hide up to
    // a third of it, and could sit right over a spot the visitor typed.
    if (!this.#riding && this.#near <= 0 && this.#nearGoal <= 0) return;
    const three = this.#near3D();
    if (three) this.#drawNear3D();
    const cam = this.#cameraPos();
    const camDist = Math.hypot(cam[0], cam[1], cam[2]);
    const nadir: Vec3 = norm3([-cam[0], -cam[1], -cam[2]]);
    const ang = Math.asin(Math.min(1, 1 / camDist));
    const ctx = this.#ctx;
    // The edge of Earth: a small circle `ang` from Earth's centre as seen from the camera.
    const a1 = norm3(cross3(nadir, Math.abs(nadir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const b1 = cross3(nadir, a1);
    const k = Math.cos(ang);
    const q = Math.sin(ang);
    const edge: { x: number; y: number }[] = [];
    for (let i = 0; i <= 180; i++) {
      const ph = (i / 180) * Math.PI * 2;
      const v: Vec3 = [
        nadir[0] * k + (a1[0] * Math.cos(ph) + b1[0] * Math.sin(ph)) * q,
        nadir[1] * k + (a1[1] * Math.cos(ph) + b1[1] * Math.sin(ph)) * q,
        nadir[2] * k + (a1[2] * Math.cos(ph) + b1[2] * Math.sin(ph)) * q,
      ];
      const p = this.project(toPos(v));
      if (p) edge.push(p);
    }
    const centre = this.project(toPos(nadir));
    if (edge.length < 3 && !centre) return;
    if (three) {
      this.#earthLabel(edge, u, true);
      return;
    }
    const { width: W, height: H } = this.canvas;
    ctx.save();
    ctx.beginPath();
    if (edge.length > 180 && centre) {
      // The whole of Earth is in view: lit per pixel from the Sun's direction, as a sphere.
      const rad =
        edge.reduce((m, p) => m + Math.hypot(p.x - centre.x, p.y - centre.y), 0) / edge.length;
      ctx.restore();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        this.#earthDisc(norm3(toVec(this.#sun)), nadir),
        centre.x - rad,
        centre.y - rad,
        rad * 2,
        rad * 2,
      );
      ctx.strokeStyle = rgba('#8fc6ff', 0.5);
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, rad + 0.8 * u, 0, Math.PI * 2);
      ctx.stroke();
      this.#earthLabel(edge, u);
      return;
    } else if (edge.length >= 3) {
      // The visible part of the edge, closed through the screen's far corners on Earth's side.
      const nd = centre ?? this.#towards(nadir);
      edge.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      const far = 4 * Math.max(W, H);
      ctx.lineTo(nd.x + (nd.x - W / 2) * far, nd.y + (nd.y - H / 2) * far);
      ctx.closePath();
    } else ctx.rect(0, 0, W, H);
    // The ground itself, clipped to the exact horizon: the month's Blue Marble, lit by the Sun.
    const sun = norm3(toVec(this.#sun));
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    const a = this.#axis();
    const cell = this.#quality >= 1 ? 4 : 6;
    const ground = this.#earth2d.view(
      Math.max(8, Math.ceil(W / cell)),
      Math.max(8, Math.ceil(H / cell)),
      cell,
      a.x,
      a.y,
      a.r / Math.tan((this.#fov / 2) * RAD),
      this.#screenAxes(),
      cam,
      sun,
      this.#mjd,
    );
    ctx.drawImage(ground, 0, 0, W, H);
    ctx.restore();
    // The atmosphere: a thin glow along the visible edge.
    ctx.strokeStyle = rgba('#8fc6ff', 0.55);
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    edge.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    this.#earthLabel(edge, u);
  }

  /** Earth's name, under its upper edge, once in view. */
  #earthLabel(edge: { x: number; y: number }[], u: number, maps = false): void {
    const ctx = this.#ctx;
    const H = this.canvas.height;
    const W = this.canvas.width;
    const lp = edge.reduce<{ x: number; y: number } | null>(
      (best, p) =>
        p.y > 40 * u &&
        p.y < H - 40 * u &&
        p.x > 40 * u &&
        p.x < W * 0.55 &&
        (!best || p.y < best.y)
          ? p
          : best,
      null,
    );
    if (lp) {
      ctx.fillStyle = rgba(this.#t.starlight, 0.85);
      ctx.font = `${12 * u}px ${this.#fontSans}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        Math.hypot(...this.#cameraPos()) > 1.3 ? this.labels.earth : this.labels.earthBelow,
        lp.x,
        lp.y + 22 * u,
      );
      const name =
        Math.hypot(...this.#cameraPos()) > 1.3 ? this.labels.earth : this.labels.earthBelow;
      const nw = ctx.measureText(name).width;
      this.#reserve({ x: lp.x - nw / 2, y: lp.y + 9 * u, w: nw, h: 16 * u });
      if (maps && this.labels.surface && this.#near <= 0.05) {
        const month = MONTHS_SHORT[new Date((this.#mjd - 40587) * 86_400_000).getUTCMonth()] ?? '';
        ctx.fillStyle = rgba(this.#t.mist, 0.6);
        ctx.font = `${10.5 * u}px ${this.#fontSans}`;
        ctx.fillText(this.labels.surface.replace('{month}', month), lp.x, lp.y + 38 * u);
      }
      ctx.textAlign = 'left';
    }
  }

  /**
   * How far through stepping out: 0 through SPHEREx's eye, 1 Earth and the orbit from space.
   * The wheel moves `#nearGoal`; the camera (`#near`) eases after it each frame at a capped
   * speed, so however fast the scroll, the turns stay calm (Neural: ≤ ~40°/s).
   */
  #near = 0;
  #nearGoal = 0;

  /**
   * Whether scrolling (or pinching) out past the widest sky steps out to Earth. Off on the
   * homepage (Viewer, 14 Nov: an accidental mode change mid-scroll); Learn turns it on.
   * When off, pushing past the widest view tells the page once (`onWiderWanted`).
   */
  stepOutByScroll = true;
  onWiderWanted: () => void = () => {};

  /** The detent at Look around's widest: true once enough scroll has gathered against it. */
  #detentPassed(dy: number): boolean {
    if (dy <= 0) return false;
    const now = performance.now();
    if (now - this.#detent.at > 900) this.#detent.sum = 0;
    this.#detent = { sum: this.#detent.sum + dy, at: now };
    if (this.#detent.sum < DETENT) return false;
    this.#detent = { sum: 0, at: 0 };
    return true;
  }

  /**
   * The inside camera's roll, radians (screen rotation; 0 keeps celestial north up). While
   * stepping out it turns so Earth lies straight below, as a horizon does in any photo from
   * orbit, and eases back to north up as the aim reaches Earth.
   */
  #roll = 0;
  /** Turns tangent-plane (x west, y north) by the roll, into screen axes (x right, y up). */
  #rolled(x: number, y: number): [number, number] {
    if (this.#roll === 0) return [x, y];
    const c = Math.cos(this.#roll);
    const s = Math.sin(this.#roll);
    return [x * c - y * s, x * s + y * c];
  }

  /** The inside camera's screen axes in the sky's frame (right, up, forward), with its roll. */
  #screenAxes(): ScreenAxes {
    const ra0 = this.#centre.ra * RAD;
    const d0 = this.#centre.dec * RAD;
    const west: Vec3 = [Math.sin(ra0), -Math.cos(ra0), 0];
    const north: Vec3 = [
      -Math.sin(d0) * Math.cos(ra0),
      -Math.sin(d0) * Math.sin(ra0),
      Math.cos(d0),
    ];
    // Screen right is west·cos r − north·sin r, screen up west·sin r + north·cos r.
    const c = Math.cos(this.#roll);
    const s = Math.sin(this.#roll);
    return {
      right: [west[0] * c - north[0] * s, west[1] * c - north[1] * s, west[2] * c - north[2] * s],
      up: [west[0] * s + north[0] * c, west[1] * s + north[1] * c, west[2] * s + north[2] * c],
      forward: [Math.cos(d0) * Math.cos(ra0), Math.cos(d0) * Math.sin(ra0), Math.sin(d0)],
    };
  }

  /** Earth without WebGL (see earth2d.ts); redraws the sky when a map arrives. */
  #earth2d = new Earth2D(() => this.draw());
  setEarthMap(url: (month: number) => string): void {
    this.#earth2d.setMap(url, this.#mjd);
  }

  /** The whole Earth as a disc, seen along `fwd` (towards Earth's centre) with the screen's roll. */
  #earthDisc(sun: Vec3, fwd?: Vec3): HTMLCanvasElement {
    const axes = this.#screenAxes();
    const f = fwd ?? axes.forward;
    const r = axes.right;
    const right = norm3([
      r[0] - f[0] * dot3(r, f),
      r[1] - f[1] * dot3(r, f),
      r[2] - f[2] * dot3(r, f),
    ]);
    const n = this.#quality >= 1 ? 160 : 96;
    return this.#earth2d.disc(n, { right, up: cross3(right, f), forward: f }, sun, this.#mjd);
  }

  /** The stepping-out camera for this frame (see scene/camera.ts). */
  #step(): StepOut {
    return this.#stepAt(this.#near);
  }

  #stepAt(n: number): StepOut {
    const sat = this.#riderSat();
    const look = this.#nearFrom ? toVec(this.#nearFrom) : toVec(this.#centre);
    // The way SPHEREx travels: its orbit's axis crossed with its place.
    const track = cross3(orbitFrame(this.#mjd).normal, sat);
    return stepOut(n, sat, look, norm3(toVec(this.#sun)), ORBIT_RE, track);
  }

  /** The camera's place, Earth radii from Earth's centre: SPHEREx, or on the way out. */
  #cameraPos(): Vec3 {
    const sat = this.#riderSat();
    if (this.#near <= 0) return [sat[0] * ORBIT_RE, sat[1] * ORBIT_RE, sat[2] * ORBIT_RE];
    return this.#step().cam;
  }

  /** Each frame: the camera eases after the scroll, never faster than the whole way in 2.5 s. */
  #easeNear(dt: number): void {
    if (this.#entry !== 'inside' || this.#near === this.#nearGoal) return;
    const gap = this.#nearGoal - this.#near;
    const eased = this.#spinning ? gap * (1 - Math.exp(-dt / 220)) : gap;
    const cap = this.#spinning ? (dt / 1000) * 0.4 : 1;
    let step = Math.max(-cap, Math.min(cap, eased));
    // Never turn the view faster than ~40° a second (Neural), however fast the scroll.
    if (this.#spinning && this.#nearFrom && step !== 0) {
      const from = this.#near > 0 ? this.#stepAt(this.#near).aim : toVec(this.#nearFrom);
      const to = this.#stepAt(Math.max(0, Math.min(1, this.#near + step))).aim;
      const turned = Math.acos(Math.max(-1, Math.min(1, dot3(from, to)))) / RAD;
      const most = (40 * dt) / 1000;
      if (turned > most) step *= most / turned;
    }
    this.#near += step;
    if (Math.abs(this.#nearGoal - this.#near) < 1e-4) this.#near = this.#nearGoal;
    if (this.#near <= 0 && this.#nearGoal <= 0 && this.#nearFrom) {
      // All the way back in: facing the patch again, at SPHEREx.
      this.#centre = { ...this.#nearFrom };
      this.#nearFrom = null;
    }
    this.#nearView();
  }

  /** Where the patch was when stepping out began: the view turns from it, and back to it. */
  #nearFrom: SkyPosition | null = null;

  /**
   * While stepping out, the view follows the camera's aim: onto SPHEREx as it backs out, then
   * to Earth's centre, ending on the Sun's side so Earth is fully lit. North stays up.
   */
  #nearView(): void {
    if (this.#entry !== 'inside' || this.#near <= 0 || !this.#nearFrom) {
      this.#roll = 0;
      return;
    }
    const step = this.#step();
    this.#centre = { ...toPos(step.aim) };
    // Earth's direction on the north-up screen, then the roll that puts it straight below.
    const ra0 = this.#centre.ra * RAD;
    const d0 = this.#centre.dec * RAD;
    const west: Vec3 = [Math.sin(ra0), -Math.cos(ra0), 0];
    const north: Vec3 = [
      -Math.sin(d0) * Math.cos(ra0),
      -Math.sin(d0) * Math.sin(ra0),
      Math.cos(d0),
    ];
    const earth = norm3([-step.cam[0], -step.cam[1], -step.cam[2]]);
    const x = dot3(earth, west);
    const y = dot3(earth, north);
    const level = Math.hypot(x, y) < 1e-6 ? 0 : -Math.PI / 2 - Math.atan2(y, x);
    const wrapped = Math.atan2(Math.sin(level), Math.cos(level));
    this.#roll = wrapped * smooth(this.#near / 0.1) * (1 - step.toEarth);
  }

  /** Told when the view passes halfway out or back in (the page marks "From space"). */
  onStepped: (out: boolean) => void = () => {};
  #steppedOut = false;
  get steppedOut(): boolean {
    return this.#steppedOut;
  }
  #tellStepped(): void {
    const out = this.#nearGoal >= 0.5;
    if (out !== this.#steppedOut) {
      this.#steppedOut = out;
      this.onStepped(out);
    }
  }

  /**
   * Under reduced motion, stepping out moves in three stills (Neural): SPHEREx's eye, the
   * close-up of SPHEREx, and Earth from space, one per scroll gesture, joined by a short fade.
   */
  static readonly STILLS = [0, 0.085, 1];
  #stillSum = 0;
  /** Told just before a cut between stills, so the page can fade across it. */
  onCut: () => void = () => {};

  /** Steps out to Earth and its orbit (1) or back to SPHEREx's eye (0), at the eased pace. */
  stepOutTo(goal: number): void {
    if (this.#entry !== 'inside') return;
    if (!this.#spinning) this.onCut();
    if (goal > 0 && this.#near <= 0 && this.#nearGoal <= 0) {
      this.#nearFrom = { ...this.#centre };
      this.#riderSat();
      this.#fov = FOV.max;
    }
    this.#nearGoal = Math.max(0, Math.min(1, goal));
    this.#tellStepped();
    this.draw();
  }

  /** Stepping out has begun or is under way (the page leaves the view to it). */
  get nearActive(): boolean {
    return this.#near > 0;
  }

  /** The patch the visitor was looking at: where stepping out began, or the view itself. */
  patchCentre(): SkyPosition {
    return this.#nearFrom ? { ...this.#nearFrom } : this.lookCentre();
  }

  /** A near point (Earth radii) as seen from the camera: its direction on the sky, and distance. */
  #seen(X: Vec3, cam: Vec3): { at: SkyPosition; dist: number } {
    const v: Vec3 = [X[0] - cam[0], X[1] - cam[1], X[2] - cam[2]];
    const d = Math.hypot(v[0], v[1], v[2]) || 1;
    return { at: toPos([v[0] / d, v[1] / d, v[2] / d]), dist: d };
  }

  /**
   * On the way out: SPHEREx's orbit at true scale (1.102 Earth radii), its far side hidden by
   * Earth, and a ghost of SPHEREx at its approximate place, enlarged (Physics: "approximate").
   */
  #nearThings(u: number, cam: Vec3): void {
    if (this.#near <= 0.01 || !this.marks) return;
    const ctx = this.#ctx;
    const { node: a1, ahead: b1 } = orbitFrame(this.#mjd);
    const camDist = Math.hypot(cam[0], cam[1], cam[2]);
    const earthAng = Math.asin(Math.min(1, 1 / camDist));
    const toEarth = norm3([-cam[0], -cam[1], -cam[2]]);
    // Hidden if behind Earth: farther than Earth's centre and inside its disc.
    const hidden = (X: Vec3) => {
      const v = norm3([X[0] - cam[0], X[1] - cam[1], X[2] - cam[2]]);
      const far = Math.hypot(X[0] - cam[0], X[1] - cam[1], X[2] - cam[2]) > camDist;
      return far && Math.acos(Math.max(-1, Math.min(1, dot3(v, toEarth)))) < earthAng;
    };
    const step = this.#step();
    const alpha = this.#orbitFade(step);
    // In 3D (tier 2) the orbit, the line of sight and SPHEREx are drawn there; only the label here.
    const three = this.#near3D();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba(this.#t.mist, three ? 0 : 0.7);
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 144; i++) {
      const ph = (i / 144) * Math.PI * 2;
      const X: Vec3 = [
        ORBIT_RE * (a1[0] * Math.cos(ph) + b1[0] * Math.sin(ph)),
        ORBIT_RE * (a1[1] * Math.cos(ph) + b1[1] * Math.sin(ph)),
        ORBIT_RE * (a1[2] * Math.cos(ph) + b1[2] * Math.sin(ph)),
      ];
      const p = hidden(X) ? null : this.project(this.#seen(X, cam).at);
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
    // The ghost of SPHEREx, where the camera set out from.
    const sat = this.#riderSat();
    const S: Vec3 = [sat[0] * ORBIT_RE, sat[1] * ORBIT_RE, sat[2] * ORBIT_RE];
    // Behind Earth from here, it's drawn as a dashed outline and says so, never just hidden.
    const behind = hidden(S);
    const sp = this.project(this.#seen(S, cam).at);
    // How tall it is on screen at its true size (2.6 m): seen as itself only close in, in 3D.
    const a = this.#axis();
    const px = ((a.r / Math.tan((this.#fov / 2) * RAD)) * 2.6) / Math.max(0.001, step.fromSpherexM);
    const seen = three && px >= 8 && step.fromSpherexM > 2.5;
    if (sp && step.fromSpherexM > 2.5) {
      const L = this.#nearLook();
      const look = this.project(
        this.#seen([S[0] + L[0] * 3, S[1] + L[1] * 3, S[2] + L[2] * 3], cam).at,
      );
      // Its line of sight, to the patch the visitor was looking at (Physics: within 35° of overhead).
      if (look && !behind && !three) {
        ctx.strokeStyle = rgba(this.#t.look, 0.8);
        ctx.lineWidth = 1.2 * u;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(look.x, look.y);
        ctx.stroke();
      }
      // Close in it is itself, at true size; farther out, too small to see, a ring marks it.
      ctx.globalAlpha = (seen ? 1 : Math.max(alpha, smooth((14 - px) / 6))) * (behind ? 0.7 : 1);
      if (!seen) this.#spherexMark(sp, u, behind);
      const text = seen
        ? this.labels.trueSize
        : behind
          ? this.labels.ghostBehind
          : this.labels.ghost;
      // Beside it, on the side away from Earth, so the label never lies across Earth's face.
      const ec = this.project(toPos(toEarth));
      let right = !ec || sp.x >= ec.x;
      let tx = sp.x + (right ? 14 : -14) * u;
      let ty = sp.y + 4 * u;
      let align: CanvasTextAlign = right ? 'left' : 'right';
      if (seen) {
        // Close in: centred just under its base (the line of sight leaves from the top).
        const belowRe = 1 / (EARTH_EQ_KM * 1000); // 1 m under the separation ring
        const below = this.project(
          this.#seen([S[0] - L[0] * belowRe, S[1] - L[1] * belowRe, S[2] - L[2] * belowRe], cam).at,
        );
        if (below) {
          tx = below.x;
          ty = below.y + 18 * u;
          align = 'center';
          right = true;
        }
      }
      ctx.font = `${11.5 * u}px ${this.#fontSans}`;
      if (align === 'center') {
        // Kept wholly on the canvas.
        const half = ctx.measureText(text).width / 2 + 12 * u;
        tx = Math.max(half, Math.min(this.canvas.width - half, tx));
      }
      ctx.textAlign = align;
      ctx.strokeStyle = rgba(this.#t.night, 0.85);
      ctx.lineWidth = 3.5 * u;
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = rgba(this.#t.starlight, 0.9);
      ctx.fillText(text, tx, ty);
      const tw = ctx.measureText(text).width;
      const bx = align === 'center' ? tx - tw / 2 : right ? tx : tx - tw;
      this.#reserve({ x: bx, y: ty - 12 * u, w: tw, h: 16 * u });
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Stepping out: a scale bar at the distance of what the camera is aimed at (SPHEREx, then
   * Earth), relabelled per step of 1, 2 or 5 (Neural: explains the zoom without sentences).
   */
  #scaleBar(u: number): void {
    if (this.#entry !== 'inside' || !this.marks || this.#near <= 0.02) return;
    const step = this.#step();
    const a = this.#axis();
    const focal = a.r / Math.tan((this.#fov / 2) * RAD);
    const onEarth = step.toEarth >= 0.5;
    const distM = onEarth
      ? Math.hypot(...step.cam) * EARTH_EQ_KM * 1000
      : Math.max(1, step.fromSpherexM);
    const mPerPx = distM / focal;
    // The longest round length that fits in ~140 px.
    const want = mPerPx * 140 * u;
    const p10 = Math.pow(10, Math.floor(Math.log10(want)));
    const len = [5, 2, 1].map((k) => k * p10).find((v) => v <= want) ?? p10;
    const px = len / mPerPx;
    const text = len < 1000 ? `${len} m` : `${(len / 1000).toLocaleString('en-GB')} km`;
    const ctx = this.#ctx;
    const x0 = a.x - px / 2;
    const y = Math.min(this.canvas.height - 40 * u, a.y + a.r + 18 * u);
    ctx.globalAlpha = smooth((this.#near - 0.02) / 0.03) * 0.8;
    ctx.strokeStyle = this.#t.mist;
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(x0, y - 4 * u);
    ctx.lineTo(x0, y);
    ctx.lineTo(x0 + px, y);
    ctx.lineTo(x0 + px, y - 4 * u);
    ctx.stroke();
    ctx.fillStyle = this.#t.mist;
    ctx.font = `${11 * u}px ${this.#fontSans}`;
    ctx.textAlign = 'center';
    const caption = `${text} ${onEarth ? this.labels.scaleAtEarth : this.labels.scaleAtSpherex}`;
    ctx.fillText(caption, a.x, y + 15 * u);
    const cw = Math.max(px, ctx.measureText(caption).width);
    this.#reserve({ x: a.x - cw / 2, y: y - 6 * u, w: cw, h: 26 * u });
    // Reduced motion: three dots say which still this is (eye, SPHEREx, Earth).
    if (!this.#spinning) {
      const stills = SkyView.STILLS;
      stills.forEach((v, i) => {
        const cx = a.x + (i - 1) * 14 * u;
        ctx.beginPath();
        ctx.arc(cx, y + 30 * u, 3 * u, 0, Math.PI * 2);
        if (Math.abs(v - this.#nearGoal) < 0.01) ctx.fill();
        else ctx.stroke();
      });
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  /** A quiet note on what the drift is: SPHEREx's own scan, sped up. */
  #ridingNote(u: number): void {
    if (this.#entry !== 'inside' || !this.marks || !this.#spinning || !this.labels.riding) return;
    const ctx = this.#ctx;
    const a = this.#axis();
    ctx.fillStyle = rgba(this.#t.mist, 0.55);
    ctx.font = `${11 * u}px ${this.#fontSans}`;
    ctx.textAlign = 'center';
    let y = a.y + a.r + 22 * u;
    for (const q of this.#quiet)
      if (q.y > a.y && q.y < y + 10 * u && q.x < a.x && q.x + q.w > a.x) y = q.y - 10 * u;
    const text = !this.#riding
      ? ''
      : this.#timeline && this.#rideMjd !== null
        ? this.labels.ridingReal.replace('{when}', this.#rideWhen()) +
          (this.#ridePoint?.gap ? this.labels.ridingGap : '')
        : this.labels.riding;
    if (text) {
      // On a narrow screen the caption wraps at its " · " breaks instead of running off the edge.
      const maxW = this.canvas.width - 24 * u;
      const lines: string[] = [];
      for (const part of text.split(' · ')) {
        const last = lines[lines.length - 1];
        if (last !== undefined && ctx.measureText(`${last} · ${part}`).width <= maxW)
          lines[lines.length - 1] = `${last} · ${part}`;
        else lines.push(part);
      }
      const lh = 14 * u;
      const ty = Math.min(this.canvas.height - 12 * u - lh * (lines.length - 1), y);
      let tw = 0;
      lines.forEach((line, i) => {
        ctx.fillText(line, a.x, ty + i * lh);
        tw = Math.max(tw, ctx.measureText(line).width);
      });
      this.#reserve({
        x: a.x - tw / 2,
        y: ty - 12 * u,
        w: tw,
        h: 16 * u + lh * (lines.length - 1),
      });
    }
    ctx.textAlign = 'left';
  }

  /** Where a direction behind the camera would be, pushed far off-screen the right way. */
  #towards(v: Vec3): { x: number; y: number } {
    const a = this.#axis();
    const ra0 = this.#centre.ra * RAD;
    const d0 = this.#centre.dec * RAD;
    const ex: Vec3 = [Math.sin(ra0), -Math.cos(ra0), 0];
    const ny: Vec3 = [-Math.sin(d0) * Math.cos(ra0), -Math.sin(d0) * Math.sin(ra0), Math.cos(d0)];
    const [x, y] = this.#rolled(dot3(v, ex), dot3(v, ny));
    const l = Math.hypot(x, y) || 1;
    const far = 4 * Math.max(this.canvas.width, this.canvas.height);
    return { x: a.x + (x / l) * far, y: a.y - (y / l) * far };
  }

  /* ---------- the 3D near scene (tier 2) ---------- */

  /** The rendering tier from the frame-time monitor: 0 light, 1 normal, 2 full 3D. */
  #quality = 1;
  /** The near scene in 3D (tier 2): Earth, the orbit and SPHEREx from the inside camera. */
  #scene3d: { render(v: Scene3DView): HTMLCanvasElement; ready(mjd: number): boolean } | null =
    null;
  setScene3D(
    s: { render(v: Scene3DView): HTMLCanvasElement; ready(mjd: number): boolean } | null,
  ): void {
    this.#scene3d = s;
    this.draw();
  }
  #near3D(): boolean {
    // Only once its Earth map has arrived: until then the sky's own (textured) Earth stands in.
    return (
      this.#quality >= 2 &&
      !!this.#scene3d &&
      this.#entry === 'inside' &&
      this.#scene3d.ready(this.#mjd)
    );
  }
  /** SPHEREx's line of sight while stepping out: the patch the visitor was looking at. */
  #nearLook(): Vec3 {
    return toVec(this.#nearFrom ?? this.#centre);
  }
  /** The orbit comes in once the camera is well clear of SPHEREx (~30 to 300 km out). */
  #orbitFade(step: StepOut | null): number {
    if (!step) return 0;
    return smooth((Math.log10(Math.max(1, step.fromSpherexM)) - 4.5) / 1);
  }
  /** Draws the 3D near scene over the stars, from exactly this pinhole camera. */
  #drawNear3D(): void {
    if (!this.#scene3d) return;
    const a = this.#axis();
    const { width: W, height: H } = this.canvas;
    const sat = this.#riderSat();
    const step = this.#near > 0 ? this.#step() : null;
    const img = this.#scene3d.render({
      width: W,
      height: H,
      cx: a.x,
      cy: a.y,
      focal: a.r / Math.tan((this.#fov / 2) * RAD),
      forward: toVec(this.#centre),
      up: this.#screenAxes().up,
      cam: this.#cameraPos(),
      sun: norm3(toVec(this.#sun)),
      mjd: this.#mjd,
      // SPHEREx itself: hidden while the camera is inside it (riding, and the first metres out).
      ghost:
        step && step.fromSpherexM > 2.5
          ? {
              at: [sat[0] * ORBIT_RE, sat[1] * ORBIT_RE, sat[2] * ORBIT_RE],
              look: this.#nearLook(),
            }
          : null,
      orbit: this.marks ? this.#orbitFade(step) : 0,
      sight: step && this.marks ? smooth(this.#near / 0.03) : 0,
    });
    this.#ctx.imageSmoothingEnabled = true;
    this.#ctx.drawImage(img, 0, 0, W, H);
  }
  setQuality(tier: number): void {
    this.#quality = tier;
    this.#glowKey = '';
    this.draw();
  }
  /**
   * Where SPHEREx is, as a marker: at 2.6 m it is far too small to see beside Earth from any
   * distance that shows its orbit, so it is never drawn enlarged; a ring marks its place.
   * Dashed when Earth is in front of it.
   */
  #spherexMark(at: { x: number; y: number }, u: number, behind = false): void {
    const ctx = this.#ctx;
    ctx.save();
    ctx.strokeStyle = this.#t.starlight;
    ctx.lineWidth = Math.max(1, 1.2 * u);
    if (behind) ctx.setLineDash([2 * u, 2 * u]);
    ctx.beginPath();
    ctx.arc(at.x, at.y, 5.5 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!behind) {
      ctx.fillStyle = this.#t.starlight;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 1.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A polyline on the sky, lifting the pen wherever it leaves the view. */
  #line(
    points: SkyPosition[],
    colour: string,
    u: number,
    dash: number[] = [],
    project: (p: SkyPosition) => { x: number; y: number } | null = (p) => this.project(p),
  ): void {
    const ctx = this.#ctx;
    ctx.strokeStyle = colour;
    ctx.lineWidth = u;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    for (const pt of points) {
      const p = project(pt);
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The Sun's position today, on its path: SPHEREx never looks this way. */
  #sunMark(u: number): void {
    const p = this.project(this.#sun);
    if (!p) return;
    const ctx = this.#ctx;
    ctx.fillStyle = COLOURS.sun;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,122,0.4)';
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16 * u, 0, Math.PI * 2);
    ctx.stroke();
    const when =
      this.#riding && this.#timeline && this.#rideMjd !== null ? this.#rideMjd : this.#lookMjd;
    const text =
      when !== null
        ? this.labels.sunOn.replace('{date}', this.#rideWhen(when).split(',')[0] ?? '')
        : this.labels.sun;
    this.#label(text, p, 22 * u, u, undefined, true);
  }

  /** Where the edge chips sit this frame, for clicks: a chip turns the view to its light. */
  #edges: { lantern: Lantern; box: Box }[] = [];

  /**
   * Inside the sky, a wanderer out of view gets a small chip at the edge of the screen, an
   * arrow pointing the way and its name, so the five are never lost behind the viewer.
   */
  /** Wanderers counted as out of view, with a margin either way so none flickers at the edge. */
  #outOfView = new Set<string>();
  /** The edge chips; off since 14 Nov (the homepage band's rows reach all five). */
  edgeChips = true;

  #edgeChips(u: number): void {
    this.#edges = [];
    if (!this.edgeChips || this.#entry !== 'inside' || !this.marks) return;
    const ctx = this.#ctx;
    const { width: W, height: H } = this.canvas;
    const m = 30 * u;
    const d0 = this.#centre.dec * RAD;
    ctx.font = `${12 * u}px ${this.#fontSans}`;
    // The open sky: inside the header, the words column and the dock.
    const left = m;
    let right = W - m;
    let top = m;
    let bottom = H - m;
    for (const q of this.#quiet) {
      if (q.y + q.h < H * 0.25) top = Math.max(top, q.y + q.h + m * 0.5);
      else if (q.y > H * 0.6 && q.w > W * 0.5) bottom = Math.min(bottom, q.y - m * 0.5);
      else if (q.x > W * 0.45) right = Math.min(right, q.x - m * 0.5);
    }
    const slack = 24 * u;
    const out: { l: Lantern; angle: number }[] = [];
    for (const l of this.#lanterns) {
      if (!l.ready) continue;
      const q = this.project(l.at);
      const was = this.#outOfView.has(l.id);
      // In view once well inside the open sky; out of view once past its edge.
      const pad = was ? slack : 0;
      const inside =
        !!q && q.x > left + pad && q.x < right - pad && q.y > top + pad && q.y < bottom - pad;
      if (inside) {
        this.#outOfView.delete(l.id);
        continue;
      }
      if (!was && q && q.x > left && q.x < right && q.y > top && q.y < bottom) continue;
      this.#outOfView.add(l.id);
      const dRa = (l.at.ra - this.#centre.ra) * RAD;
      const dec = l.at.dec * RAD;
      // The way to it on screen: the projection's own axes (east to the left, north up),
      // turned by the camera's roll.
      const [rx, ry] = this.#rolled(
        -Math.cos(dec) * Math.sin(dRa),
        Math.cos(d0) * Math.sin(dec) - Math.sin(d0) * Math.cos(dec) * Math.cos(dRa),
      );
      out.push({ l, angle: Math.atan2(-ry, rx) });
    }
    if (!out.length) return;
    // Fixed places, in the five's own order, stacked up from the open sky's lower-left corner:
    // the chips stay put while the sky turns; only their arrows turn to point the way.
    const bh = 22 * u;
    const gap = 6 * u;
    out.forEach(({ l, angle }, i) => {
      const tw = ctx.measureText(l.label).width;
      const box = { x: left, y: bottom - (out.length - i) * (bh + gap), w: tw + 30 * u, h: bh };
      if (box.y < top || this.#quiet.some((q) => overlaps(q, box))) return;
      this.#edges.push({ lantern: l, box });
      const hue = l.measured === false ? this.#t.mist : this.#t.show;
      ctx.fillStyle = rgba(this.#t.night, 0.78);
      ctx.strokeStyle = rgba(hue, 0.55);
      ctx.lineWidth = u;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, bh / 2);
      ctx.fill();
      ctx.stroke();
      const cx = box.x + 12 * u;
      const cy = box.y + bh / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.fillStyle = hue;
      ctx.beginPath();
      ctx.moveTo(4.5 * u, 0);
      ctx.lineTo(-3 * u, -3.5 * u);
      ctx.lineTo(-3 * u, 3.5 * u);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = mixHex(this.#t.starlight, this.#t.mist, 0.4);
      ctx.textAlign = 'left';
      ctx.fillText(l.label, box.x + 22 * u, cy + 4 * u);
    });
    // A quiet heading over the stack.
    const first = this.#edges[0];
    if (first) {
      ctx.fillStyle = rgba(this.#t.mist, 0.6);
      ctx.font = `${11 * u}px ${this.#fontSans}`;
      ctx.fillText(this.labels.outOfView, first.box.x + 2 * u, first.box.y - 7 * u);
    }
  }

  /**
   * A label beside a mark, kept inside the canvas: to the left when it would run off the
   * right. An optional second line (a lantern's story) sits under it, smaller and quieter.
   */
  #label(
    text: string,
    p: { x: number; y: number },
    gap: number,
    u: number,
    story?: string,
    avoidQuiet = false,
  ): void {
    const ctx = this.#ctx;
    ctx.font = `${13 * u}px ${this.#fontSans}`;
    let width = ctx.measureText(text).width;
    const small = `${11.5 * u}px ${this.#fontSans}`;
    if (story) {
      ctx.font = small;
      width = Math.max(width, ctx.measureText(story).width);
    }
    const margin = 8 * u;
    // Its side: the right unless it would run off the canvas or onto the chip stack.
    const chips = this.#edges.map((e) => e.box);
    const hitsChips = (r: boolean) => {
      const bx = r ? p.x + gap : p.x - gap - width;
      return chips.some((c) => overlaps(c, { x: bx, y: p.y - 14 * u, w: width, h: 30 * u }));
    };
    let right = p.x + gap + width + margin <= this.canvas.width;
    if (hitsChips(right) && !hitsChips(!right)) right = !right;
    ctx.textAlign = right ? 'left' : 'right';
    // Never let the text run off the canvas, even when the mark itself is just off it.
    const x = right
      ? Math.max(margin, p.x + gap)
      : Math.min(this.canvas.width - margin, Math.max(margin + width, p.x - gap));
    const lift = story ? 3 * u : -4 * u;
    const y = Math.max(
      14 * u,
      Math.min(this.canvas.height - margin - (story ? 15 * u : 0), p.y - lift),
    );
    // A lantern's label never runs under the header, the words or the cards.
    const box = { x: right ? x : x - width, y: y - 13 * u, w: width, h: (story ? 30 : 16) * u };
    if (avoidQuiet && this.#quiet.some((q) => overlaps(q, box))) {
      ctx.textAlign = 'left';
      return;
    }
    this.#reserve(box);
    ctx.fillStyle = mixHex(this.#t.starlight, this.#t.mist, 0.5);
    ctx.font = `${13 * u}px ${this.#fontSans}`;
    ctx.fillText(text, x, y);
    if (story) {
      ctx.fillStyle = rgba(this.#t.mist, 0.75);
      ctx.font = small;
      ctx.fillText(story, x, y + 15 * u);
    }
    ctx.textAlign = 'left';
  }

  /**
   * What one SPHEREx photo covers, drawn on the optical axis like a camera's viewfinder: four
   * corner brackets around one detector's 3.49° patch, and the full Moon (0.52°) to the same
   * scale beside it, because everyone knows how big the Moon looks. It replaces an outline of
   * a whole snapshot (three patches), which said nothing to anyone who didn't know.
   */
  #photoOutline(u: number): void {
    const a = this.#axis();
    const h = this.canvas.height;
    const pxPerDeg = (a.r / Math.tan((this.#fov / 2) * RAD)) * RAD;
    const pw = PHOTO.patch * pxPerDeg;
    const ph = pw;
    const ctx = this.#ctx;
    const x0 = a.x - pw / 2;
    const y0 = a.y - ph / 2;
    // Corner brackets, a quarter of a side long, in the look's blue.
    const arm = pw * 0.18;
    ctx.strokeStyle = rgba(this.#t.look, 0.75);
    ctx.lineWidth = 1.5 * u;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [x0, y0, 1, 1],
      [x0 + pw, y0, -1, 1],
      [x0, y0 + ph, 1, -1],
      [x0 + pw, y0 + ph, -1, -1],
    ] as const) {
      ctx.moveTo(cx + dx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * arm);
    }
    ctx.stroke();
    // The Moon to scale, just outside the lower-right corner.
    const moonR = (MOON_DEG / 2) * pxPerDeg;
    const mx = x0 + pw + moonR + 10 * u;
    const my = y0 + ph - moonR;
    ctx.fillStyle = rgba(this.#t.starlight, 0.18);
    ctx.strokeStyle = rgba(this.#t.starlight, 0.55);
    ctx.lineWidth = u;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(2 * u, moonR), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(this.#t.mist, 0.75);
    ctx.font = `${11 * u}px ${this.#fontSans}`;
    ctx.fillText(this.labels.moon, mx + Math.max(2 * u, moonR) + 6 * u, my + 4 * u);
    // The label above the frame: what it is, and how big in Moons.
    ctx.fillStyle = rgba(this.#t.look, 0.9);
    ctx.font = `${12.5 * u}px ${this.#fontSans}`;
    ctx.fillText(this.labels.photo, x0, y0 - 22 * u);
    ctx.fillStyle = rgba(this.#t.mist, 0.7);
    ctx.font = `${11 * u}px ${this.#fontSans}`;
    ctx.fillText(this.labels.photoDetail, x0, y0 - 8 * u);
    this.#outlineBottom = Math.min(y0 + ph, h);
    // Narrow enough, the lens field appears inside the photo: what the lens will show.
    if (this.#fov <= 15) {
      const s = Math.max(8 * u, LENS_FIELD_DEG * pxPerDeg);
      ctx.strokeStyle = this.#t.starlight;
      ctx.lineWidth = u;
      ctx.strokeRect(a.x - s / 2, a.y - s / 2, s, s);
      ctx.fillStyle = rgba(this.#t.starlight, 0.8);
      ctx.fillText(this.labels.lens, a.x + s / 2 + 8 * u, a.y - s / 2 - 4 * u);
    }
  }

  #outlineBottom = 0;

  /**
   * Stick figures and names, drawn very faint under the stars. Inside, straight segments are
   * exact (the pinhole projection keeps great circles straight); on the globe and map they
   * are short enough to draw straight. A segment across the flat map's edge is skipped.
   */
  /** Where the mouse is over the sky (canvas pixels), or null; touch has no hover. */
  #pointerAt: { x: number; y: number } | null = null;
  /** The pointer's focus disc, eased so it glides and fades rather than jumping. */
  #pointerFocus = { x: 0, y: 0, a: 0 };

  /**
   * How strongly a canvas point is in focus, 0..1: a soft disc at the view's centre, and a
   * smaller one that follows the mouse. Constellation figures show only where it's above 0.
   */
  #focusWeight(p: { x: number; y: number }): number {
    const a = this.#axis();
    const f = this.#pointerFocus;
    if (this.#entry === 'flat') {
      // The flat map shows the whole sky at once, so a wide disc lit most of it (Sumit, 14 Nov:
      // "too crowded"). Figures follow the mouse in a small disc (a figure shows when its middle
      // is within ~27° at full size, less when zoomed in); the map's centre means nothing here, so its
      // disc only stands in when there's no mouse (touch), and gives way as the mouse arrives.
      const r = a.r * 0.5;
      const centre = (1 - f.a) * (1 - smooth((Math.hypot(p.x - a.x, p.y - a.y) / r - 0.45) / 0.55));
      const pointer = f.a * (1 - smooth((Math.hypot(p.x - f.x, p.y - f.y) / r - 0.3) / 0.45));
      return Math.max(centre, pointer);
    }
    const r = this.#entry === 'inside' ? a.r : a.r * 1.2;
    const centre = 1 - smooth((Math.hypot(p.x - a.x, p.y - a.y) / r - 0.45) / 0.55);
    const pointer = f.a * (1 - smooth((Math.hypot(p.x - f.x, p.y - f.y) / r - 0.22) / 0.3));
    return Math.max(centre, pointer);
  }

  #easePointerFocus(): void {
    const f = this.#pointerFocus;
    const at = this.#pointerAt;
    // Reduced motion (no spin loop): no easing, the disc is simply there or not.
    const k = this.#spinning ? 0.12 : 1;
    if (at) {
      if (f.a < 0.01) Object.assign(f, at);
      f.x += (at.x - f.x) * Math.min(1, k * 2);
      f.y += (at.y - f.y) * Math.min(1, k * 2);
    }
    // On the flat map, leaving the map (for the search, say) keeps the last set of figures
    // rather than dropping them (Viewer, 14 Nov); touch never sets it, so it keeps the centre.
    if (!at && this.#entry === 'flat') return;
    f.a += ((at ? 1 : 0) - f.a) * k;
  }

  #drawFigures(u: number): void {
    if (!this.#figures.length || !this.marks) return;
    this.#easePointerFocus();
    const ctx = this.#ctx;
    const flat = this.#entry === 'flat';
    const half = flat ? (this.#flatSize().w * this.#flat.zoom) / 2 : Infinity;
    ctx.strokeStyle = COLOURS.figure;
    ctx.lineWidth = u;
    // A figure comes into view as a whole: when its middle is in focus its lines grow out from
    // its stars, one after another, and when it leaves they draw back in. Under reduced motion
    // they simply appear and go.
    const now = performance.now();
    const dt = this.#figureClock ? Math.min(100, now - this.#figureClock) : 0;
    this.#figureClock = now;
    this.#figures.forEach((f, k) => {
      let inView: boolean;
      if (flat) {
        // Near when any of its stars is (the pointer on a figure's bright star counts, even if
        // its middle is outside), with hysteresis so a figure on the edge doesn't blink: it
        // comes in above 0.5 and goes only below 0.25 (Viewer, 14 Nov).
        let w = 0;
        for (const [a, b] of f.segments) {
          for (const pt of [a, b]) {
            const pp = this.project(pt);
            if (pp) w = Math.max(w, this.#focusWeight(pp));
          }
          if (w > 0.5) break;
        }
        const was = (this.#figureReveal[k] ?? 0) > 0 && !!this.#figureShown[k];
        inView = w > 0.5 || (was && w > 0.25);
        this.#figureShown[k] = inView;
      } else {
        const mid = this.#figureMid[k];
        const mp = mid ? this.project(mid) : null;
        inView = !!mp && this.#focusWeight(mp) > 0.5;
      }
      let t = this.#figureReveal[k] ?? 0;
      if (!this.#spinning) t = inView ? 1 : 0;
      else t = inView ? Math.min(1, t + dt / 1100) : Math.max(0, t - dt / 600);
      this.#figureReveal[k] = t;
      if (t <= 0) return;
      const n = f.segments.length;
      f.segments.forEach(([a, b], i) => {
        const p = this.project(a);
        const q = this.project(b);
        if (!p || !q || Math.abs(p.x - q.x) > half) return;
        // Nothing under the page's words: the text sits on calm night.
        if (this.#quiet.some((b) => inBox(b, p) || inBox(b, q))) return;
        // This segment's share of the reveal, staggered along the figure, eased.
        const local = smooth(t * 1.6 - (i / Math.max(1, n)) * 0.6);
        if (local <= 0) return;
        ctx.globalAlpha = limbFade(Math.min(p.depth, q.depth));
        // Grown from both stars toward the middle of the line.
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (mx - p.x) * local, p.y + (my - p.y) * local);
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x + (mx - q.x) * local, q.y + (my - q.y) * local);
        ctx.stroke();
      });
    });
    // Names only where they can be read: not behind the page's words or cards, not on a
    // lantern's label, not on each other, and not where the limb foreshortens them.
    const taken: Box[] = this.#taken;
    for (const l of this.#lanterns) {
      const p = this.project(l.at);
      if (p) taken.push({ x: p.x - 24 * u, y: p.y - 24 * u, w: 210 * u, h: 52 * u });
    }
    ctx.fillStyle = COLOURS.figureName;
    ctx.font = `italic ${12 * u}px ${this.#fontSerif}`;
    ctx.textAlign = 'center';
    this.#figures.forEach((f, k) => {
      // The name follows once most of the lines are in.
      const shown = smooth(((this.#figureReveal[k] ?? 0) - 0.55) / 0.45);
      if (shown <= 0) return;
      for (const at of f.labels) {
        const p = this.project(at);
        if (!p || p.depth < 0.35) continue;
        const focus = shown;
        const w = ctx.measureText(f.name).width;
        const box = { x: p.x - w / 2 - 4 * u, y: p.y - 12 * u, w: w + 8 * u, h: 16 * u };
        if (taken.some((t) => overlaps(t, box))) continue;
        taken.push(box);
        ctx.globalAlpha = focus * limbFade(p.depth);
        ctx.fillText(f.name, p.x, p.y);
      }
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  #quiet: Box[] = [];
  /** Text boxes placed or reserved this frame, and the priority labels' boxes for the next. */
  #taken: Box[] = [];
  #priorityNext: Box[] = [];
  /** A priority label's box: reserved from now and for the next frame. */
  #reserve(box: Box): void {
    this.#taken.push(box);
    this.#priorityNext.push(box);
  }
  /** Areas of the canvas the page covers with words or cards: no names are drawn there. */
  setQuiet(boxes: Box[]): void {
    this.#quiet = boxes;
  }

  /**
   * What the view is on ("Looking near Vega"): under the snapshot outline when it shows,
   * kept on screen and near the aim; just under the centre when the view is wide.
   */
  #caption(u: number, detail: boolean): void {
    // Leaning on the detent at the edge of the sky: say what one more push does.
    const leaning = this.#detent.sum > 0 && performance.now() - this.#detent.at < 900;
    const text = leaning ? this.labels.stepOut : this.caption;
    const ctx = this.#ctx;
    const a = this.#axis();
    const h = this.canvas.height;
    ctx.fillStyle = rgba(this.#t.mist, 0.9);
    ctx.font = `${13.5 * u}px ${this.#fontSans}`;
    ctx.textAlign = 'center';
    const y = detail
      ? Math.max(a.y + 40 * u, Math.min(this.#outlineBottom + 22 * u, h - 24 * u))
      : a.y + 64 * u;
    if (text) {
      ctx.fillText(text, a.x, y);
      const tw = ctx.measureText(text).width;
      this.#reserve({ x: a.x - tw / 2, y: y - 13 * u, w: tw, h: 18 * u });
    }
    ctx.textAlign = 'left';
    if (!leaning && this.centreReadout) this.#centreReadout(u, y + 17 * u);
  }
  /** The aim's coordinates under the caption (the page's search format). */
  centreReadout = true;

  /**
   * The aim: a small open ring with four ticks on the optical axis, in the lens ring's gold.
   * When the lens opens here, its ring is this one grown large.
   */
  #aim(u: number): void {
    const ctx = this.#ctx;
    const a = this.#axis();
    // A lantern on the axis is the aim; don't draw over it.
    for (const l of this.#lanterns) {
      const p = this.project(l.at);
      if (p && Math.hypot(p.x - a.x, p.y - a.y) < 16 * u) return;
    }
    const r = 9 * u;
    ctx.strokeStyle = rgba(this.#t.starlight, 0.85);
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    const ticks: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of ticks) {
      ctx.moveTo(a.x + dx * (r + 3 * u), a.y + dy * (r + 3 * u));
      ctx.lineTo(a.x + dx * (r + 9 * u), a.y + dy * (r + 9 * u));
    }
    ctx.stroke();
  }

  #hit(e: PointerEvent): Lantern | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    for (const l of this.#lanterns) {
      const p = this.project(l.at);
      if (p && Math.hypot(p.x - x, p.y - y) < 20 * (this.canvas.width / rect.width)) return l;
    }
    return null;
  }

  /** CSS pixels per degree of sky at the centre of the view, for the level of detail. */
  #cssPxPerDeg(): number {
    const u = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    let perDeg: number;
    if (this.#entry === 'flat') perDeg = (this.#flatSize().w / 360) * this.#flat.zoom;
    else perDeg = (this.#axis().r / Math.tan((this.#fov / 2) * RAD)) * RAD;
    return perDeg / u;
  }

  /** Degrees of sky per CSS pixel of drag. */
  #dragScale(): number {
    const rect = this.canvas.getBoundingClientRect();
    const u = this.canvas.width / Math.max(1, rect.width);
    return this.#fov / ((2 * this.#axis().r) / u);
  }

  #hover: string | null = null;
  /** Active touches, for pinch-to-zoom. */
  #pointers = new Map<number, { x: number; y: number }>();
  #pinch: { dist: number; zoom: number } | null = null;

  /** The current zoom on a 0–1 scale across the view's range, for pinching. */
  #zoomValue(): number {
    if (this.#entry === 'flat') return this.#flat.zoom;
    return 1 / this.#fov;
  }

  #applyZoom(factor: number): void {
    // Reuse the wheel path, so pinching and scrolling hand over at the same limits.
    this.#wheel(new WheelEvent('wheel', { deltaY: -Math.log(factor) / 0.002, cancelable: true }));
  }

  #down(e: PointerEvent): void {
    this.#flight = null;
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.#pointers.size === 2) {
      const [a, b] = [...this.#pointers.values()];
      if (a && b) this.#pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.#zoomValue() };
      this.#drag = null;
      return;
    }
    if (e.isTrusted) this.#noteMove();
    if (e.isTrusted && this.#entry === 'inside' && this.#riding) this.ride(false);
    // On the flat map the drag record carries the pan and the vertical offset instead.
    const flat = this.#entry === 'flat';
    this.#drag = {
      x: e.clientX,
      y: e.clientY,
      ra: flat ? this.#flat.pan : this.#centre.ra,
      dec: flat ? this.#flat.dy : this.#centre.dec,
    };
    this.canvas.setPointerCapture(e.pointerId);
  }

  #move(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      const rect = this.canvas.getBoundingClientRect();
      const u = this.canvas.width / Math.max(1, rect.width);
      this.#pointerAt = { x: (e.clientX - rect.left) * u, y: (e.clientY - rect.top) * u };
    }
    if (this.#pointers.has(e.pointerId))
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.#pinch && this.#pointers.size === 2) {
      const [a, b] = [...this.#pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const wanted = this.#pinch.zoom * (dist / this.#pinch.dist);
      const factor = wanted / this.#zoomValue();
      if (Number.isFinite(factor) && factor > 0) this.#applyZoom(factor);
      return;
    }
    if (!this.#drag) {
      const over = this.#hit(e);
      this.canvas.style.cursor = over?.ready ? 'pointer' : 'grab';
      const id = over?.ready ? over.id : null;
      if (id !== this.#hover) {
        this.#hover = id;
        this.#lit = id;
        this.onHover(id);
      }
      return;
    }
    if (this.#entry === 'flat') {
      const rect = this.canvas.getBoundingClientRect();
      const u = this.canvas.width / Math.max(1, rect.width);
      const { zoom } = this.#flat;
      const { w: mw, h: mh } = this.#flatSize();
      this.#flat.pan = this.#drag.ra + (((e.clientX - this.#drag.x) * u) / mw) * (360 / zoom);
      const limit = (mh / 2) * (1 - 1 / zoom);
      this.#flat.dy = Math.max(
        -limit,
        Math.min(limit, this.#drag.dec - ((e.clientY - this.#drag.y) * u) / zoom),
      );
      this.draw();
      return;
    }
    const k = this.#dragScale();
    this.#centre.ra = (this.#drag.ra + (e.clientX - this.#drag.x) * k + 360) % 360;
    this.#centre.dec = Math.max(-85, Math.min(85, this.#drag.dec + (e.clientY - this.#drag.y) * k));
    this.draw();
  }

  #up(e: PointerEvent): void {
    this.#pointers.delete(e.pointerId);
    if (this.#pinch) {
      if (this.#pointers.size < 2) this.#pinch = null;
      return;
    }
    const moved = this.#drag ? Math.hypot(e.clientX - this.#drag.x, e.clientY - this.#drag.y) : 0;
    this.#drag = null;
    if (moved < 5) {
      const rect0 = this.canvas.getBoundingClientRect();
      const k0 = this.canvas.width / Math.max(1, rect0.width);
      const pt = { x: (e.clientX - rect0.left) * k0, y: (e.clientY - rect0.top) * k0 };
      const edge = this.#edges.find((x) => inBox(x.box, pt));
      const l = this.#hit(e);
      if (edge) void this.flyTo(edge.lantern.at, Math.min(this.#fov, 40), 900);
      else if (l?.ready) this.onSelect(l.id);
      else if (this.marks && e.target === this.canvas) {
        const rect = this.canvas.getBoundingClientRect();
        const u = this.canvas.width / Math.max(1, rect.width);
        const p = { x: (e.clientX - rect.left) * u, y: (e.clientY - rect.top) * u };
        // Not through the page's words or cards: a click on text isn't a click on the sky.
        const at = this.#quiet.some((b) => inBox(b, p)) ? null : this.#unproject(p.x, p.y);
        if (at) this.onSkyTap(at);
      }
    }
  }

  #wheel(e: WheelEvent): void {
    if (e.isTrusted) this.#noteMove();
    const { dx, dy } = wheelPixels(e, this.canvas.clientHeight);
    if (e.shiftKey) {
      e.preventDefault();
      const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
      if (Math.abs(d) > 2) this.onSweep(Math.sign(d));
      return;
    }
    e.preventDefault();
    this.#flight = null;
    const k = Math.exp(-dy * 0.002); // > 1 zooms in
    if (this.#entry === 'flat') {
      const next = this.#flat.zoom * k;
      // Zooming in past the map's closest hands over to Look around, but only after a beat at
      // the limit (Viewer: wheel momentum mustn't overshoot into another view).
      if (next > FLAT_ZOOM_MAX && this.#flat.zoom >= FLAT_ZOOM_MAX - 0.01) {
        if (this.#detentPassed(-dy)) {
          // The spot under the pointer, the one being homed in on (Viewer); else the centre.
          const r = this.canvas.getBoundingClientRect();
          const k = this.canvas.width / Math.max(1, r.width);
          const real = e.clientX !== 0 || e.clientY !== 0;
          const at = real
            ? this.#unproject((e.clientX - r.left) * k, (e.clientY - r.top) * k)
            : null;
          this.onHandOver('inside', at ?? undefined);
        }
        this.draw();
        return;
      }
      const zoom = Math.max(1, Math.min(FLAT_ZOOM_MAX, next));
      const limit = (this.#flatSize().h / 2) * (1 - 1 / zoom);
      this.#flat = { ...this.#flat, zoom, dy: Math.max(-limit, Math.min(limit, this.#flat.dy)) };
    } else {
      const next = this.#fov / k;
      // Stepping out past SPHEREx to Earth and its orbit; and back in again.
      if (
        this.#nearGoal > 0 ||
        this.#near > 0 ||
        (this.stepOutByScroll &&
          next > FOV.max &&
          this.#fov >= FOV.max - 0.01 &&
          this.#detentPassed(dy))
      ) {
        if (this.#near <= 0 && this.#nearGoal <= 0) {
          this.#nearFrom = { ra: this.#centre.ra, dec: this.#centre.dec };
          this.#riderSat();
        }
        if (!this.#spinning) {
          // Reduced motion: a gesture's worth of scroll moves one still out or in.
          // Passing the detent is itself the first gesture; after that, ~160 px per still.
          const starting = this.#near <= 0 && this.#nearGoal <= 0 && dy > 0;
          this.#stillSum = starting ? 160 : this.#stillSum + dy;
          if (Math.abs(this.#stillSum) < 160) return;
          const stills = SkyView.STILLS;
          const at = stills.reduce(
            (b, v, i) =>
              Math.abs(v - this.#nearGoal) < Math.abs((stills[b] ?? 0) - this.#nearGoal) ? i : b,
            0,
          );
          const next = Math.max(0, Math.min(stills.length - 1, at + Math.sign(this.#stillSum)));
          this.#stillSum = 0;
          if (next === at) {
            return;
          }
          this.onCut();
          this.#nearGoal = stills[next] ?? 0;
        } else
          // About 2,000 px of wheel for the whole way out (Neural: ~250 px per tenfold step).
          this.#nearGoal = Math.max(0, Math.min(1, this.#nearGoal + dy * 0.0005));
        this.#tellStepped();
        this.draw();
        return;
      }
      if (next < FOV.min && this.#fov <= FOV.min + 0.01) {
        // Already as close as the sky goes: one more turn opens the light under the aim.
        const id = this.#lightOnAim();
        if (id) this.onSelect(id);
        return;
      }
      if (next > FOV.max && this.#fov >= FOV.max - 0.01) {
        // Holding at the detent (see #detentPassed): a flick of the trackpad doesn't throw you out.
        // On the homepage there's no stepping out: the page offers the whole-sky map instead.
        if (!this.stepOutByScroll && dy > 0) this.onWiderWanted();
        this.draw();
        return;
      }
      this.#detent = { sum: 0, at: 0 };
      this.#fov = Math.max(FOV.min, Math.min(FOV.max, next));
    }
    this.draw();
  }
}

/** Smoothstep on 0..1, clamped. */
/** A font-family list from a CSS custom property, for canvas text. */
function cssFont(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * The angle off the axis (radians) of a point `rho` focal lengths out, for a projection that is
 * `k` stereographic (2 tan(c/2)) and 1 − k pinhole (tan c): Newton's method from a blend of
 * the two exact answers.
 */
export function angleFromRadius(rho: number, k: number): number {
  if (k <= 0) return Math.atan(rho);
  if (k >= 1) return 2 * Math.atan(rho / 2);
  let c = (1 - k) * Math.atan(rho) + k * 2 * Math.atan(rho / 2);
  for (let i = 0; i < 8; i++) {
    const fc = (1 - k) * Math.tan(c) + 2 * k * Math.tan(c / 2) - rho;
    const d = (1 - k) / Math.cos(c) ** 2 + k / Math.cos(c / 2) ** 2;
    const next = c - fc / d;
    if (!Number.isFinite(next)) break;
    c = Math.max(0, Math.min(Math.PI * 0.95, next));
    if (Math.abs(fc) < 1e-10) break;
  }
  return c;
}

/** A point `e` of the way along the great circle from `a` to `b` (`arcDeg` apart). */
function slerpSky(a: SkyPosition, b: SkyPosition, arcDeg: number, e: number): SkyPosition {
  if (arcDeg < 1e-6) return { ra: ((a.ra % 360) + 360) % 360, dec: a.dec };
  const v = (p: SkyPosition): [number, number, number] => {
    const ra = p.ra * RAD;
    const dec = p.dec * RAD;
    return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  };
  const [p, q] = [v(a), v(b)];
  const w = arcDeg * RAD;
  const s0 = Math.sin((1 - e) * w) / Math.sin(w);
  const s1 = Math.sin(e * w) / Math.sin(w);
  const x = s0 * p[0] + s1 * q[0];
  const y = s0 * p[1] + s1 * q[1];
  const z = s0 * p[2] + s1 * q[2];
  return {
    ra: (((Math.atan2(y, x) / RAD) % 360) + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z)))) / RAD,
  };
}

/** 1 well inside the globe, easing to 0 at its limb (the last ~35% of the way out). */
function limbFade(depth: number): number {
  const t = Math.max(0, Math.min(1, depth / 0.35));
  return t * t * (3 - 2 * t);
}

/**
 * A star's colour from its B−V index: its temperature (Ballesteros 2012), then the colour of
 * a glowing body at that temperature (Helland's fit to the blackbody curve), kept a third of
 * the way toward white, as the eye sees stars. Rigel blue-white, the Sun's kind cream,
 * Betelgeuse orange.
 */
const starColours = new Map<number, string>();
function starColour(bv: number | null): string {
  if (bv === null) return '#eef1ff';
  const key = Math.round(bv * 20);
  const hit = starColours.get(key);
  if (hit) return hit;
  const c = Math.max(-0.4, Math.min(2.2, key / 20));
  const kelvin = 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const mix = (v: number) => Math.round(Math.max(0, Math.min(255, v)) * 0.67 + 255 * 0.33);
  const out = `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
  starColours.set(key, out);
  return out;
}
