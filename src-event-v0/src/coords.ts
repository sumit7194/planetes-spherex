/** Sky positions: parsing what people type, formatting, and simple sky geometry. */

export interface Sky {
  ra: number; // degrees
  dec: number; // degrees
}

const D2R = Math.PI / 180;

function normalise(s: string): string {
  return s
    .replace(/[−–—]/g, '-') // typographic minus and dashes
    .replace(/[′’']/g, 'm')
    .replace(/[″”"]/g, 's')
    .replace(/[°º]/g, 'd')
    .replace(/,/g, ' ')
    .trim();
}

/**
 * Accepts "133.7600 -7.2426", "08 55 10.83 -07 14 42.5", "08h55m10.831s -7d14m42.53s",
 * "08:55:10.8 -07:14:42". Sexagesimal RA is in hours; decimal RA is in degrees.
 */
export function parseSky(input: string): Sky | null {
  const s = normalise(input);
  if (!s) return null;
  // Two plain decimals: degrees.
  const dec2 = s.match(/^([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (dec2) {
    const ra = parseFloat(dec2[1]);
    const dec = parseFloat(dec2[2]);
    return valid({ ra, dec });
  }
  // Sexagesimal: split into RA and Dec at the sign of the declination or after 3 RA numbers.
  const nums = s.replace(/[hdms:]/gi, ' ').trim().split(/\s+/);
  if (nums.length === 6 || nums.length === 4 || nums.length === 2) {
    const k = nums.length / 2;
    const raP = nums.slice(0, k).map(Number);
    const decStr = nums.slice(k);
    const neg = decStr[0].startsWith('-');
    const decP = decStr.map((x) => Math.abs(Number(x)));
    if ([...raP, ...decP].some((x) => !Number.isFinite(x))) return null;
    const ra = (raP[0] + (raP[1] ?? 0) / 60 + (raP[2] ?? 0) / 3600) * 15;
    const dec = (neg ? -1 : 1) * (decP[0] + (decP[1] ?? 0) / 60 + (decP[2] ?? 0) / 3600);
    return valid({ ra, dec });
  }
  return null;
}

function valid(p: Sky): Sky | null {
  if (!Number.isFinite(p.ra) || !Number.isFinite(p.dec)) return null;
  if (p.dec < -90 || p.dec > 90) return null;
  return { ra: ((p.ra % 360) + 360) % 360, dec: p.dec };
}

export function fmtRa(ra: number): string {
  const h = ra / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(1).padStart(4, '0')}s`;
}

export function fmtDec(dec: number): string {
  const sg = dec < 0 ? '−' : '+';
  const a = Math.abs(dec);
  const dd = Math.floor(a);
  const mm = Math.floor((a - dd) * 60);
  const ss = ((a - dd) * 60 - mm) * 60;
  return `${sg}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${ss.toFixed(0).padStart(2, '0')}″`;
}

/** Gnomonic (TAN) projection onto a north-up, east-left pixel grid centred on (ra0, dec0). */
export function project(ra0: number, dec0: number, n: number, pixArcsec: number, ra: number, dec: number) {
  const a = (ra - ra0) * D2R;
  const d = dec * D2R;
  const d0 = dec0 * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  const xi = (Math.cos(d) * Math.sin(a)) / cosc / D2R;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc / D2R;
  const c = (n - 1) / 2;
  return { x: c - (xi * 3600) / pixArcsec, y: c + (eta * 3600) / pixArcsec };
}

/** Move a catalogue position by proper motion (mas/yr) to a decimal year. */
export function propagate(src: { ra: number; dec: number; pmra: number; pmdec: number; epoch: number }, year: number): Sky {
  const dt = year - src.epoch;
  return {
    ra: src.ra + (src.pmra * dt) / 3.6e6 / Math.max(1e-6, Math.cos(src.dec * D2R)),
    dec: src.dec + (src.pmdec * dt) / 3.6e6,
  };
}

export function sepArcsec(a: Sky, b: Sky): number {
  const dra = (a.ra - b.ra) * Math.cos(((a.dec + b.dec) / 2) * D2R);
  return Math.hypot(dra, a.dec - b.dec) * 3600;
}

/** Resolve a name with CDS Sesame (SIMBAD/NED/VizieR). Returns null on failure. */
export async function resolveName(name: string, timeoutMs = 12000): Promise<Sky | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/A?${encodeURIComponent(name)}`, { signal: ctl.signal });
    const txt = await r.text();
    const m = txt.match(/^%J\s+([-+\d.]+)\s+([-+\d.]+)/m);
    return m ? { ra: parseFloat(m[1]), dec: parseFloat(m[2]) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
