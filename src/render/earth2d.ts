/**
 * Earth drawn without WebGL (the tiers below 3D, and until the 3D Earth's map arrives): the
 * month's NASA Blue Marble, turned to Greenwich sidereal time on the date and lit from the
 * Sun's direction with a soft twilight, the same geography as the 3D view.
 *
 * Two pictures, each cached until its inputs change:
 * - `disc`: the whole Earth seen from afar, a square canvas of the disc;
 * - `view`: the ground seen close in through the sky's pinhole camera, a coarse buffer the
 *   caller scales up and clips to the exact horizon.
 *
 * Directions are in the sky's axes (x to RA 0, z to the pole); Earth's radius is 1.
 */
import { gmstDeg, type Vec3 } from './scene/orbit';

const RAD = Math.PI / 180;
const MAP_W = 1024;
const MAP_H = 512;
/** Plain day and night colours, until the map arrives. */
const DAY: Vec3 = [150, 178, 214];
const NIGHT: Vec3 = [26, 33, 52];

/** The camera's screen axes in the sky's frame: right, up, and forward (into the screen). */
export interface ScreenAxes {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * The colour of the ground at unit direction (x, y, z), written into `out` at `at`: the map's
 * texel there (or the plain day colour), lit by the Sun, with a little night-side blue.
 */
function shade(
  x: number,
  y: number,
  z: number,
  sun: Vec3,
  map: ImageData | null,
  gmst: number,
  out: Uint8ClampedArray,
  at: number,
  rim = 1,
): void {
  const lit = smooth((x * sun[0] + y * sun[1] + z * sun[2] + 0.08) / 0.28);
  let r = DAY[0];
  let g = DAY[1];
  let b = DAY[2];
  if (map) {
    const lon = ((((Math.atan2(y, x) / RAD - gmst) % 360) + 540) % 360) - 180;
    const lat = Math.asin(Math.max(-1, Math.min(1, z))) / RAD;
    const u = Math.min(MAP_W - 1, Math.floor(((lon + 180) / 360) * MAP_W));
    const v = Math.min(MAP_H - 1, Math.floor(((90 - lat) / 180) * MAP_H));
    const t = (v * MAP_W + u) * 4;
    r = map.data[t] ?? 0;
    g = map.data[t + 1] ?? 0;
    b = map.data[t + 2] ?? 0;
  }
  const k = (0.06 + 0.94 * lit) * rim;
  const n = (1 - lit) * (map ? 0.35 : 1);
  out[at] = r * k + NIGHT[0] * n;
  out[at + 1] = g * k + NIGHT[1] * n;
  out[at + 2] = b * k + NIGHT[2] * n;
}

export class Earth2D {
  #url: ((month: number) => string) | null = null;
  #map: { month: number; data: ImageData | null } = { month: 0, data: null };
  #disc = { canvas: document.createElement('canvas'), key: '' };
  #view = { canvas: document.createElement('canvas'), key: '' };
  /** Told when a map arrives, so the sky draws again. */
  #onReady: () => void;

  constructor(onReady: () => void) {
    this.#onReady = onReady;
  }

  /** Where each month's map is; the date's month starts loading at once. */
  setMap(url: (month: number) => string, mjd: number): void {
    this.#url = url;
    this.#pixels(mjd);
  }

  /** The month's map as pixels, loading it if it isn't the one held (null until it arrives). */
  #pixels(mjd: number): ImageData | null {
    const month = new Date((mjd - 40587) * 86_400_000).getUTCMonth() + 1;
    if (this.#map.month === month || !this.#url) return this.#map.data;
    this.#map = { month, data: this.#map.data };
    const img = new Image();
    img.src = this.#url(month);
    void img
      .decode()
      .then(() => {
        const c = document.createElement('canvas');
        c.width = MAP_W;
        c.height = MAP_H;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g || this.#map.month !== month) return;
        g.drawImage(img, 0, 0, MAP_W, MAP_H);
        this.#map = { month, data: g.getImageData(0, 0, MAP_W, MAP_H) };
        this.#disc.key = this.#view.key = '';
        this.#onReady();
      })
      .catch(() => undefined);
    return this.#map.data;
  }

  /** The whole Earth seen from afar along `axes.forward`, as an `n` × `n` disc. */
  disc(n: number, axes: ScreenAxes, sun: Vec3, mjd: number): HTMLCanvasElement {
    const { right, up, forward: c } = axes;
    const map = this.#pixels(mjd);
    const gmst = gmstDeg(mjd);
    const key = [n, ...sun, ...c, ...right, gmst.toFixed(1), map ? 1 : 0].join(',');
    const cv = this.#disc.canvas;
    if (key === this.#disc.key && cv.width === n) return cv;
    this.#disc.key = key;
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    if (!g) return cv;
    const img = g.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * 2 - 1;
        const y = 1 - ((j + 0.5) / n) * 2;
        const r2 = x * x + y * y;
        if (r2 > 1) continue;
        const z = Math.sqrt(1 - r2);
        const at = (j * n + i) * 4;
        shade(
          right[0] * x + up[0] * y - c[0] * z,
          right[1] * x + up[1] * y - c[1] * z,
          right[2] * x + up[2] * y - c[2] * z,
          sun,
          map,
          gmst,
          img.data,
          at,
          0.85 + 0.15 * z,
        );
        img.data[at + 3] = 255 * Math.min(1, (1 - Math.sqrt(r2)) * n * 0.5);
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /**
   * The ground seen from `cam` (Earth radii) through a pinhole: `w` × `h` cells, each `k`
   * canvas pixels, the camera's centre at (`ax`, `ay`) and focal length `f` in canvas pixels.
   */
  view(
    w: number,
    h: number,
    k: number,
    ax: number,
    ay: number,
    f: number,
    axes: ScreenAxes,
    cam: Vec3,
    sun: Vec3,
    mjd: number,
  ): HTMLCanvasElement {
    const { right: R, up: U, forward: c } = axes;
    const map = this.#pixels(mjd);
    const gmst = gmstDeg(mjd);
    const key = [w, h, k, ax, ay, f, ...c, ...R, ...cam, ...sun, gmst, map ? 1 : 0]
      .map((v) => v.toFixed(4))
      .join(',');
    const cv = this.#view.canvas;
    if (key === this.#view.key && cv.width === w && cv.height === h) return cv;
    this.#view.key = key;
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return cv;
    const img = g.createImageData(w, h);
    const cc = cam[0] * cam[0] + cam[1] * cam[1] + cam[2] * cam[2] - 1;
    for (let j = 0; j < h; j++) {
      const y = (ay - (j + 0.5) * k) / f;
      for (let i = 0; i < w; i++) {
        const x = ((i + 0.5) * k - ax) / f;
        const dx0 = c[0] + R[0] * x + U[0] * y;
        const dy0 = c[1] + R[1] * x + U[1] * y;
        const dz0 = c[2] + R[2] * x + U[2] * y;
        const l = Math.hypot(dx0, dy0, dz0);
        const dx = dx0 / l;
        const dy = dy0 / l;
        const dz = dz0 / l;
        const at = (j * w + i) * 4;
        img.data[at + 3] = 255;
        // Where the ray meets the ground; past the horizon, the limb's colour (the caller's
        // clip draws the exact edge, so it never shows a gap).
        const b = cam[0] * dx + cam[1] * dy + cam[2] * dz;
        const disc = b * b - cc;
        if (disc < 0 || b > 0) {
          img.data[at] = 20;
          img.data[at + 1] = 28;
          img.data[at + 2] = 46;
          continue;
        }
        const t = -b - Math.sqrt(disc);
        shade(cam[0] + dx * t, cam[1] + dy * t, cam[2] + dz * t, sun, map, gmst, img.data, at);
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
}
