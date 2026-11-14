/**
 * The canvas side of the theme: the same tokens as tokens.css, read from the page, so the sky
 * and the lens follow whichever theme is on (Infrared, the default, or Night observatory under ?theme=observatory).
 */

export interface Theme {
  night: string;
  dusk: string;
  starlight: string;
  mist: string;
  show: string;
  look: string;
  measured: string;
  predicted: string;
  flag: string;
}

const FALLBACK: Theme = {
  night: '#0c1120',
  dusk: '#1b2236',
  starlight: '#efe8dd',
  mist: '#d2cbc2',
  show: '#ff9d5c',
  look: '#6fb7d6',
  measured: '#6fd3c4',
  predicted: '#a9a4c9',
  flag: '#e0533c',
};

/**
 * The night palette (--sky-*), from the root element. The sky and the photos are drawn in it in
 * both the light and the dark scheme: the scheme dresses the page, never the data.
 */
export function readTheme(): Theme {
  if (typeof document === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const get = (k: keyof Theme) => cs.getPropertyValue(`--sky-${k}`).trim() || FALLBACK[k];
  return {
    night: get('night'),
    dusk: get('dusk'),
    starlight: get('starlight'),
    mist: get('mist'),
    show: get('show'),
    look: get('look'),
    measured: get('measured'),
    predicted: get('predicted'),
    flag: get('flag'),
  };
}

/** A hex colour's red, green and blue, 0–255. */
export function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A hex colour at an opacity, as an rgba() string for the canvas. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The colour t of the way from a to b (both hex), as hex. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const c = ca.map((v, i) => Math.round(v + ((cb[i] ?? v) - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
