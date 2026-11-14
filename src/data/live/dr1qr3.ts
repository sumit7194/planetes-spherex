/**
 * A live look at any spot, DR1 + QR3, straight from the browser: no server.
 *
 *  1. The event sky index (public/data/index/dr1qr3, built by pipeline/build_index.py) lists every
 *     DR1 and QR3 photo with its footprint centre, orientation and time; load the tiles near the
 *     position and keep the photos whose footprint holds it.
 *  2. For each photo, read from IRSA's public S3 bucket with HTTP ranges (the bucket allows CORS):
 *     the primary and IMAGE headers (for the photo's own TAN-SIP WCS), the IMAGE rows the grid
 *     needs, the FLAGS header and rows (a RICE-compressed binary table, one tile per row, decoded
 *     here), and the file's last blocks (the WCS-WAVE table: wavelength at every pixel).
 *  3. Resample onto the packs' grid (north up, east left), OR the flags of every pixel a sample
 *     draws on, subtract the median.
 *
 * Written during the event (14 Nov 2026). The Tile type, FlagMask and grid conventions are the
 * practice viewer's (see PRIOR_WORK.md).
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion --
   Decoder and resampler loops index typed arrays and FITS tables whose bounds are set by
   construction (header sizes, the grid); the assertions keep these hot loops free of checks. */
import type { SkyPosition } from '../coords';
import type { Tile } from '../pack/load';
import { FlagMask } from '../pack/types';

export const BUCKET = 'https://nasa-irsa-spherex.s3.amazonaws.com';

/**
 * The reader's version. Bump it whenever a change can alter a cutout's numbers or flags (WCS,
 * resampling, flag rules, median); the cloud helper puts it in every cache key, so a fix is
 * never served from an old cached answer. (The file key already names the release and NASA's
 * processing version.)
 *   2026-11-14.1  first helper release
 *   2026-11-14.2  exact sky-to-pixel inverse (forward SIP refined; was the reverse polynomial)
 */
export const READER_VERSION = '2026-11-14.2';

/**
 * The same bucket under its five web addresses (all allow browser access and byte ranges). S3
 * speaks only HTTP/1.1, so a browser opens ~6 connections per address; spreading photos over
 * all five gives ~30. Each photo sticks to one address (a hash of its key), so its reads reuse
 * that address's warm connections. Outside a browser only the main address is used.
 */
export const BUCKET_HOSTS = [
  BUCKET,
  'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com',
  'https://s3.amazonaws.com/nasa-irsa-spherex',
  'https://s3.us-east-1.amazonaws.com/nasa-irsa-spherex',
  'https://nasa-irsa-spherex.s3.dualstack.us-east-1.amazonaws.com',
] as const;

/** The address a photo's direct reads go to. */
export function bucketUrl(key: string): string {
  if (typeof document === 'undefined') return `${BUCKET}/${key}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `${BUCKET_HOSTS[(h >>> 0) % BUCKET_HOSTS.length]}/${key}`;
}

/** A small public file used to open connections early (its first byte only). */
const WARM_KEY =
  'dr1/level2/2025W19_1B/l2b-v27-2026-197/3/level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits';
let warmed = false;

/**
 * Opens connections before the first look (call it when the visitor starts typing): the
 * secure handshake costs ~1 s per address from India. With the helper on, that's one address;
 * otherwise all five bucket addresses. Runs once per page; never throws.
 */
export function warmUp(): void {
  if (warmed || typeof document === 'undefined') return;
  warmed = true;
  const touch = (url: string, init?: RequestInit) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(8000) }).catch(() => undefined);
  if (helperBase) void touch(`${helperBase}/v1/health`);
  else
    for (const host of BUCKET_HOSTS)
      void touch(`${host}/${WARM_KEY}`, { headers: { Range: 'bytes=0-0' } });
}
const BLOCK = 2880;
const RAD = Math.PI / 180;

/* ---------------------------------------------------------------- the packs' grid (from the practice viewer's cutout.ts) */

/** The sky position of a tangent-plane offset (east, north, degrees) about a centre. */
export function offsetPosition(
  centre: SkyPosition,
  eastDeg: number,
  northDeg: number,
): SkyPosition {
  const RAD = Math.PI / 180;
  const xi = eastDeg * RAD;
  const eta = northDeg * RAD;
  const d0 = centre.dec * RAD;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return { ...centre };
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho);
  const ra =
    centre.ra * RAD +
    Math.atan2(
      xi * Math.sin(c),
      rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c),
    );
  return { ra: (((ra / RAD) % 360) + 360) % 360, dec: dec / RAD };
}

/**
 * The grid's sky positions, row-major: row 0 is the south edge, column 0 the east edge, as in
 * the packs (viewer_pack.py `sky_grid`).
 */
export function gridPositions(
  centre: SkyPosition,
  size: number,
  scaleArcsec: number,
): SkyPosition[] {
  const out: SkyPosition[] = [];
  const mid = (size - 1) / 2;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      out.push(
        offsetPosition(
          centre,
          ((mid - col) * scaleArcsec) / 3600,
          ((row - mid) * scaleArcsec) / 3600,
        ),
      );
    }
  }
  return out;
}

/** Bilinear sample of a w×h patch at (x, y) in patch pixels; NaN off the patch or next to NaN. */
export function bilinear(img: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return NaN;
  const fx = x - x0;
  const fy = y - y0;
  const at = (i: number, j: number) => img[j * w + i] ?? NaN;
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  );
}

/* ------------------------------------------------------------------ the index */

export interface IndexMeta {
  format: string;
  bandDeg: number;
  bins: number[];
  maxHalfDeg: number;
  folders: string[];
  photos: number;
}

export interface LivePhoto {
  key: string; // S3 key
  obsId: string; // e.g. 2025W19_1B_0116_1D3
  det: number;
  mjd: number;
  release: 'DR1' | 'QR3';
  deep: boolean;
  centre: SkyPosition;
  paDeg: number;
  halfDeg: number;
}

let metaCache: Promise<IndexMeta> | null = null;
const tileCache = new Map<string, Promise<LivePhoto[]>>();

export function indexBase(): string {
  return `${import.meta.env.BASE_URL}data/index/dr1qr3`;
}

export function loadIndexMeta(base = indexBase()): Promise<IndexMeta> {
  metaCache ??= fetch(`${base}/index.json`).then((r) => {
    if (!r.ok) throw new Error(`sky index: HTTP ${r.status}`);
    return r.json() as Promise<IndexMeta>;
  });
  return metaCache;
}

function sepDeg(a: SkyPosition, b: SkyPosition): number {
  const s =
    Math.sin(a.dec * RAD) * Math.sin(b.dec * RAD) +
    Math.cos(a.dec * RAD) * Math.cos(b.dec * RAD) * Math.cos((a.ra - b.ra) * RAD);
  return Math.acos(Math.min(1, Math.max(-1, s))) / RAD;
}

/** Parse one tile file: "PXE1", uint32 count, count × 24-byte records. */
export function parseTile(buf: ArrayBuffer, meta: IndexMeta): LivePhoto[] {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x31455850) throw new Error('sky index tile: bad magic');
  const n = v.getUint32(4, true);
  if (buf.byteLength !== 8 + n * 24) throw new Error('sky index tile: bad length');
  const out: LivePhoto[] = [];
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 24;
    const folder = meta.folders[v.getUint16(o, true)]!;
    const seq = v.getUint16(o + 2, true);
    const exp = v.getUint8(o + 4);
    const det = v.getUint8(o + 5);
    const flags = v.getUint8(o + 6);
    const week = folder.split('/')[2]!;
    const version = folder.split('/')[3]!;
    const obs = `${week}_${String(seq).padStart(4, '0')}_${exp}`;
    out.push({
      key: `${folder}/${det}/level2_${obs}D${det}_spx_${version}.fits`,
      obsId: `${obs}D${det}`,
      det,
      mjd: v.getFloat32(o + 8, true),
      release: flags & 1 ? 'QR3' : 'DR1',
      deep: (flags & 2) !== 0,
      centre: { ra: v.getFloat32(o + 12, true), dec: v.getFloat32(o + 16, true) },
      paDeg: v.getInt16(o + 20, true) / 100,
      halfDeg: v.getInt16(o + 22, true) / 1000,
    });
  }
  return out;
}

/** Tiles (band, bin) whose area comes within `radius` degrees of the position. */
export function tilesNear(at: SkyPosition, radius: number, meta: IndexMeta): [number, number][] {
  const out: [number, number][] = [];
  const nb = meta.bins.length;
  for (let k = 0; k < nb; k++) {
    const lo = -90 + k * meta.bandDeg;
    const hi = lo + meta.bandDeg;
    if (hi < at.dec - radius || lo > at.dec + radius) continue;
    const n = meta.bins[k]!;
    const maxDec = Math.min(89.9, Math.max(Math.abs(lo), Math.abs(hi), Math.abs(at.dec)));
    const raRad =
      Math.abs(at.dec) + radius >= 89.9
        ? 180
        : radius / Math.cos(Math.min(89.9, maxDec + radius) * RAD);
    for (let b = 0; b < n; b++) {
      const r0 = (b / n) * 360;
      const r1 = ((b + 1) / n) * 360;
      const d = Math.min(
        ...[r0, r1, (r0 + r1) / 2].map((r) => Math.abs(((at.ra - r + 540) % 360) - 180)),
      );
      if (n === 1 || (at.ra >= r0 && at.ra < r1) || d <= raRad + 360 / n) out.push([k, b]);
    }
  }
  return out;
}

/** Whether the photo's footprint (a square of half-diagonal halfDeg at angle paDeg) holds the position. */
export function footprintHolds(p: LivePhoto, at: SkyPosition, marginDeg = 0.02): boolean {
  if (sepDeg(p.centre, at) > p.halfDeg) return false;
  // Gnomonic offsets about the footprint centre, rotated into the square's frame.
  const a = (at.ra - p.centre.ra) * RAD;
  const d = at.dec * RAD;
  const d0 = p.centre.dec * RAD;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  const xi = (Math.cos(d) * Math.sin(a)) / cosc / RAD;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc / RAD;
  const t = p.paDeg * RAD;
  const u = xi * Math.cos(t) - eta * Math.sin(t);
  const w = xi * Math.sin(t) + eta * Math.cos(t);
  const half = p.halfDeg / Math.SQRT2 - marginDeg;
  return Math.abs(u) <= half && Math.abs(w) <= half;
}

/** Every DR1 + QR3 photo whose footprint holds the position, in time order. */
export async function findPhotos(at: SkyPosition, base = indexBase()): Promise<LivePhoto[]> {
  const meta = await loadIndexMeta(base);
  const tiles = tilesNear(at, meta.maxHalfDeg + 0.05, meta);
  const lists = await Promise.all(
    tiles.map(([k, b]) => {
      const id = `${k}_${b}`;
      if (!tileCache.has(id)) {
        tileCache.set(
          id,
          fetch(`${base}/t/${id}.bin`).then((r) =>
            r.ok ? r.arrayBuffer().then((x) => parseTile(x, meta)) : [],
          ),
        );
      }
      return tileCache.get(id)!;
    }),
  );
  return lists
    .flat()
    .filter((p) => footprintHolds(p, at))
    .sort((a, b) => a.mjd - b.mjd);
}

/** Start of SPHEREx's survey (MJD 60789, 1 May 2025), for cutting deep-field time into steps. */
const SURVEY_START_MJD = 60789;
/** A quarter of a year: the step deep fields are cut into. */
const DEEP_STEP_DAYS = 365.25 / 4;

/**
 * Survey passes: a new pass starts after a gap of more than 60 days. The deep fields near the
 * ecliptic poles are photographed all the time, so they have no such gaps; a pass longer than
 * 120 days is cut into quarter-year steps (counted from the survey start), so blinking still
 * compares different times.
 */
export function seasonsOf(photos: { mjd: number }[], gapDays = 60): number[] {
  const order = photos.map((p, i) => [p.mjd, i] as const).sort((a, b) => a[0] - b[0]);
  // First the gap rule.
  const groups: (readonly [number, number])[][] = [];
  let last: number | null = null;
  for (const e of order) {
    if (last === null || e[0] - last > gapDays) groups.push([]);
    groups[groups.length - 1]!.push(e);
    last = e[0];
  }
  // Then cut long passes into quarter-year steps.
  const out = new Array<number>(photos.length);
  let s = -1;
  for (const g of groups) {
    const span = g[g.length - 1]![0] - g[0]![0];
    let step: number | null = null;
    for (const [m, i] of g) {
      const k = span > 120 ? Math.floor((m - SURVEY_START_MJD) / DEEP_STEP_DAYS) : 0;
      if (step !== k) {
        s++;
        step = k;
      }
      out[i] = s;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ FITS headers and the WCS */

export type Header = Map<string, string | number>;

export function parseHeader(bytes: Uint8Array): { header: Header; length: number } | null {
  const text = new TextDecoder('ascii').decode(bytes);
  const h: Header = new Map();
  for (let i = 0; i + 80 <= text.length; i += 80) {
    const card = text.slice(i, i + 80);
    const key = card.slice(0, 8).trim();
    if (key === 'END') return { header: h, length: Math.ceil((i + 80) / BLOCK) * BLOCK };
    if (card[8] !== '=') {
      const m = /^HIERARCH\s+(.+?)\s*=\s*(.*)$/.exec(card);
      if (m) h.set(m[1]!, value(m[2]!));
      continue;
    }
    h.set(key, value(card.slice(10)));
  }
  return null;
}

function value(s: string): string | number {
  const t = s.trim();
  if (t.startsWith("'")) {
    const end = t.indexOf("'", 1);
    return t.slice(1, end < 0 ? undefined : end).trim();
  }
  const v = t.split('/')[0]!.trim();
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n : v;
}

const num = (h: Header, k: string, d = 0) => {
  const v = h.get(k);
  return typeof v === 'number' ? v : d;
};

export function dataBytes(h: Header): number {
  const naxis = num(h, 'NAXIS');
  if (!naxis) return 0;
  let n = Math.abs(num(h, 'BITPIX')) / 8;
  for (let k = 1; k <= naxis; k++) n *= num(h, `NAXIS${k}`);
  n += num(h, 'PCOUNT');
  return Math.ceil(n / BLOCK) * BLOCK;
}

/** A TAN-SIP WCS from an IMAGE header: sky → 0-based pixel, with the reverse (AP/BP) polynomial. */
export class Wcs {
  private crval: [number, number];
  private crpix: [number, number];
  private inv: [number, number, number, number];
  private ap: [number, number, number][] = [];
  private bp: [number, number, number][] = [];
  private a: [number, number, number][] = [];
  private b: [number, number, number][] = [];

  constructor(h: Header) {
    this.crval = [num(h, 'CRVAL1'), num(h, 'CRVAL2')];
    this.crpix = [num(h, 'CRPIX1'), num(h, 'CRPIX2')];
    const c1 = num(h, 'CDELT1', 1);
    const c2 = num(h, 'CDELT2', 1);
    const cd = h.has('CD1_1')
      ? [num(h, 'CD1_1'), num(h, 'CD1_2'), num(h, 'CD2_1'), num(h, 'CD2_2')]
      : [
          c1 * num(h, 'PC1_1', 1),
          c1 * num(h, 'PC1_2'),
          c2 * num(h, 'PC2_1'),
          c2 * num(h, 'PC2_2', 1),
        ];
    const det = cd[0]! * cd[3]! - cd[1]! * cd[2]!;
    this.inv = [cd[3]! / det, -cd[1]! / det, -cd[2]! / det, cd[0]! / det];
    const order = num(h, 'AP_ORDER');
    for (let p = 0; p <= order; p++) {
      for (let q = 0; q <= order - p; q++) {
        const a = h.get(`AP_${p}_${q}`);
        const b = h.get(`BP_${p}_${q}`);
        if (typeof a === 'number') this.ap.push([p, q, a]);
        if (typeof b === 'number') this.bp.push([p, q, b]);
      }
    }
    const fwd = num(h, 'A_ORDER');
    for (let p = 0; p <= fwd; p++) {
      for (let q = 0; q <= fwd - p; q++) {
        const a = h.get(`A_${p}_${q}`);
        const b = h.get(`B_${p}_${q}`);
        if (typeof a === 'number') this.a.push([p, q, a]);
        if (typeof b === 'number') this.b.push([p, q, b]);
      }
    }
  }

  /** 0-based pixel (x, y) of a sky position, or null if it lies behind the tangent point. */
  toPixel(ra: number, dec: number): { x: number; y: number } | null {
    const a = (ra - this.crval[0]) * RAD;
    const d = dec * RAD;
    const d0 = this.crval[1] * RAD;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
    if (cosc <= 0) return null;
    const xi = (Math.cos(d) * Math.sin(a)) / cosc / RAD;
    const eta =
      (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc / RAD;
    const U = this.inv[0] * xi + this.inv[1] * eta;
    const V = this.inv[2] * xi + this.inv[3] * eta;
    // The reverse SIP polynomial (AP/BP) is a fitted approximation of the inverse (~0.003 px off
    // in SPHEREx files: enough to shift a steep star core by ~0.2%). Start there, then solve the
    // forward polynomial exactly, u + A(u, v) = U, as astropy does (a few fixed-point steps;
    // A's slopes are tiny, so each step gains several digits).
    let u = U;
    let v = V;
    for (const [p, q, c] of this.ap) u += c * U ** p * V ** q;
    for (const [p, q, c] of this.bp) v += c * U ** p * V ** q;
    if (this.a.length || this.b.length) {
      for (let it = 0; it < 8; it++) {
        let fa = 0;
        let fb = 0;
        for (const [p, q, c] of this.a) fa += c * u ** p * v ** q;
        for (const [p, q, c] of this.b) fb += c * u ** p * v ** q;
        const nu = U - fa;
        const nv = V - fb;
        const step = Math.abs(nu - u) + Math.abs(nv - v);
        u = nu;
        v = nv;
        if (step < 1e-9) break;
      }
    }
    return { x: u + this.crpix[0] - 1, y: v + this.crpix[1] - 1 };
  }
}

/* ------------------------------------------------------------------ RICE_1 (cfitsio's fits_rdecomp, 32-bit) */

const NONZERO = new Uint8Array(256);
for (let i = 1; i < 256; i++) NONZERO[i] = 32 - Math.clz32(i);

/** Decompress one RICE_1 tile of 32-bit integers (blocksize 32). */
export function riceDecode32(c: Uint8Array, nx: number, nblock = 32): Int32Array {
  const fsbits = 5;
  const fsmax = 25;
  const bbits = 32;
  const out = new Int32Array(nx);
  let lastpix = (c[0]! << 24) | (c[1]! << 16) | (c[2]! << 8) | c[3]! | 0;
  let p = 4;
  let b = c[p++]!;
  let nbits = 8;
  for (let i = 0; i < nx;) {
    nbits -= fsbits;
    while (nbits < 0) {
      b = ((b << 8) | c[p++]!) >>> 0;
      nbits += 8;
    }
    const fs = (b >>> nbits) - 1;
    b &= (1 << nbits) - 1;
    const imax = Math.min(i + nblock, nx);
    if (fs < 0) {
      for (; i < imax; i++) out[i] = lastpix;
    } else if (fs === fsmax) {
      for (; i < imax; i++) {
        let k = bbits - nbits;
        let diff = k >= 32 ? 0 : (b << k) >>> 0;
        for (k -= 8; k >= 0; k -= 8) {
          b = c[p++]!;
          diff = (diff | (b << k)) >>> 0;
        }
        if (nbits > 0) {
          b = c[p++]!;
          diff = (diff | (b >>> -k)) >>> 0;
          b &= (1 << nbits) - 1;
        } else b = 0;
        const v = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (v + lastpix) | 0;
        out[i] = lastpix;
      }
    } else {
      for (; i < imax; i++) {
        while (b === 0) {
          nbits += 8;
          b = c[p++]!;
        }
        const nzero = nbits - NONZERO[b]!;
        nbits -= nzero + 1;
        b ^= 1 << nbits;
        nbits -= fs;
        while (nbits < 0) {
          b = ((b << 8) | c[p++]!) >>> 0;
          nbits += 8;
        }
        const diff = ((nzero << fs) | (b >>> nbits)) >>> 0;
        b &= (1 << nbits) - 1;
        const v = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (v + lastpix) | 0;
        out[i] = lastpix;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ reading one photo */

const SATURATED = ['OVERFLOW', 'SUR_ERROR', 'BLOOM', 'NONLINEAR'];
const REJECTED = [
  'TRANSIENT',
  'NONFUNC',
  'DICHROIC',
  'MISSING_DATA',
  'HOT',
  'COLD',
  'PHANMISS',
  'PERSIST',
  'CROSSTALK',
  'GHOST',
  'GHOST_FPA',
  'GHOST_EXT',
  'STREAK',
  'SNOWBALL',
  'HALO',
];

async function range(url: string, a: number, b: number, signal?: AbortSignal): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const init: RequestInit = { headers: { Range: `bytes=${a}-${b}` } };
      if (signal) init.signal = signal;
      const r = await fetch(url, init);
      if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (signal?.aborted || attempt >= 2) throw e;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
}

/**
 * A large range read as parallel pieces: each S3 connection is slow on its own (tens to a few
 * hundred kB/s from home links), so several at once finish far sooner than one long read.
 */
async function rangeParallel(
  url: string,
  a: number,
  b: number,
  signal?: AbortSignal,
  piece = 256 * 1024,
): Promise<Uint8Array> {
  const parts: [number, number][] = [];
  for (let s = a; s <= b; s += piece) parts.push([s, Math.min(b, s + piece - 1)]);
  const got = await Promise.all(parts.map(([s, e]) => range(url, s, e, signal)));
  const out = new Uint8Array(b - a + 1);
  let o = 0;
  for (const g of got) {
    out.set(g, o);
    o += g.length;
  }
  return out;
}

async function headerAt(url: string, off: number, blocks: number, signal?: AbortSignal) {
  for (let n = blocks; n <= 64; n *= 2) {
    const bytes = await range(url, off, off + n * BLOCK - 1, signal);
    const h = parseHeader(bytes);
    if (h) return h;
  }
  throw new Error('FITS header too long');
}

/** A header and its raw text (for passing on exactly, and for hashing). */
async function rawHeaderAt(url: string, off: number, blocks: number, signal?: AbortSignal) {
  for (let n = blocks; n <= 64; n *= 2) {
    const bytes = await range(url, off, off + n * BLOCK - 1, signal);
    const h = parseHeader(bytes);
    if (h) return { ...h, text: new TextDecoder('ascii').decode(bytes.subarray(0, h.length)) };
  }
  throw new Error('FITS header too long');
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A 32-bit word with the named flags' bits set, from the FLAGS header's MSKNnnnn = 'NAME' cards. */
function bits(h: Header, names: string[]): number {
  let w = 0;
  for (const [k, val] of h) {
    if (k.startsWith('MSKN') && typeof val === 'string' && names.includes(val))
      w |= 1 << Number(k.slice(4));
  }
  return w >>> 0;
}

/** The WCS-WAVE table from the file's last blocks: wavelength and bandwidth (µm) on an X/Y grid. */
export function parseWaveTail(
  tail: Uint8Array,
): { xs: number[]; ys: number[]; vals: Float32Array; nx: number; ny: number } | null {
  for (let i = 0; i + BLOCK <= tail.length; i += BLOCK) {
    const card = new TextDecoder('ascii').decode(tail.subarray(i, i + 80));
    if (!card.startsWith('XTENSION')) continue;
    const h = parseHeader(tail.subarray(i));
    if (!h || h.header.get('EXTNAME') !== 'WCS-WAVE') continue;
    const dims = (s: string | number | undefined) => String(s).match(/\d+/g)!.map(Number);
    const nx = dims(h.header.get('TDIM1'))[0]!;
    const ny = dims(h.header.get('TDIM2'))[0]!;
    const d3 = dims(h.header.get('TDIM3'));
    const row = new DataView(tail.buffer, tail.byteOffset + i + h.length);
    const xs = Array.from({ length: nx }, (_, k) => row.getInt32(4 * k, false));
    const ys = Array.from({ length: ny }, (_, k) => row.getInt32(4 * (nx + k), false));
    const nv = d3[0]! * d3[1]! * d3[2]!;
    const vals = new Float32Array(nv);
    for (let k = 0; k < nv; k++) vals[k] = row.getFloat32(4 * (nx + ny + k), false);
    return { xs, ys, vals, nx, ny };
  }
  return null;
}

/** Bilinear (wavelength, bandwidth) at a 0-based pixel; the table's X/Y are 1-based pixels. */
export function waveAt(
  t: NonNullable<ReturnType<typeof parseWaveTail>>,
  x: number,
  y: number,
): [number, number] {
  const find = (arr: number[], v: number) => {
    let i = 0;
    while (i < arr.length - 2 && arr[i + 1]! < v) i++;
    const f = (v - arr[i]!) / (arr[i + 1]! - arr[i]!);
    return [i, Math.min(1, Math.max(0, f))] as const;
  };
  const [ix, fx] = find(t.xs, x + 1);
  const [iy, fy] = find(t.ys, y + 1);
  const at = (j: number, i: number, k: number) => t.vals[(j * t.nx + i) * 2 + k]!;
  const out: [number, number] = [0, 0];
  for (let k = 0; k < 2; k++) {
    out[k] =
      at(iy, ix, k) * (1 - fx) * (1 - fy) +
      at(iy, ix + 1, k) * fx * (1 - fy) +
      at(iy + 1, ix, k) * (1 - fx) * fy +
      at(iy + 1, ix + 1, k) * fx * fy;
  }
  return out;
}

/**
 * FLAGS rows y0..y1 (inclusive) of one photo: a RICE-compressed BINTABLE, one tile per image row;
 * descriptors first, then one range for the heap span those rows use.
 */
async function flagRows(
  url: string,
  fh: { header: Header; length: number },
  flagsOff: number,
  nx: number,
  y0: number,
  y1: number,
  obsId: string,
  signal?: AbortSignal,
): Promise<{ flags: Int32Array; F: Header; bytes: number }> {
  const rows = y1 - y0 + 1;
  const F = fh.header;
  const rowLen = num(F, 'NAXIS1');
  const fData = flagsOff + fh.length;
  const theap = num(F, 'THEAP', rowLen * num(F, 'NAXIS2'));
  const tf = num(F, 'TFIELDS');
  let off = 0;
  let col = -1;
  let isQ = false;
  for (let k = 1; k <= tf; k++) {
    const form = String(F.get(`TFORM${k}`));
    if (F.get(`TTYPE${k}`) === 'COMPRESSED_DATA') {
      col = off;
      isQ = form.includes('Q');
      break;
    }
    off += form.includes('P')
      ? 8
      : form.includes('Q')
        ? 16
        : (Number(/^\d*/.exec(form)![0]) || 1) *
          ({ J: 4, K: 8, E: 4, D: 8, B: 1, I: 2, L: 1, A: 1 } as Record<string, number>)[
            form.replace(/^\d*/, '')[0]!
          ]!;
  }
  if (col < 0) throw new Error(`${obsId}: FLAGS has no COMPRESSED_DATA`);
  const desc = await range(url, fData + y0 * rowLen, fData + (y1 + 1) * rowLen - 1, signal);
  const dv = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
  const cnt: number[] = [];
  const hof: number[] = [];
  for (let r = 0; r < rows; r++) {
    const o = r * rowLen + col;
    if (isQ) {
      cnt.push(Number(dv.getBigInt64(o, false)));
      hof.push(Number(dv.getBigInt64(o + 8, false)));
    } else {
      cnt.push(dv.getInt32(o, false));
      hof.push(dv.getInt32(o + 4, false));
    }
  }
  const h0b = Math.min(...hof);
  const h1b = Math.max(...hof.map((o, r) => o + cnt[r]!));
  const heap = await rangeParallel(url, fData + theap + h0b, fData + theap + h1b - 1, signal);
  const flags = new Int32Array(rows * nx);
  for (let r = 0; r < rows; r++)
    flags.set(riceDecode32(heap.subarray(hof[r]! - h0b, hof[r]! - h0b + cnt[r]!), nx), r * nx);
  return { flags, F, bytes: desc.length + heap.length };
}

/**
 * One photo's pixels around a position at the detector's own resolution: no resampling, the full
 * 32-bit flag words (and the header's MSKN bit names), the image header as text (for an exact WCS
 * elsewhere) and the wavelength at the position. The pipeline's read_box (pipeline/spherex.py),
 * run next to the data by the cloud helper (/v1/native). Null when the position is off the photo.
 */
export interface NativeBox {
  obsId: string;
  /** The box's first column and row on the detector (0-based), and its size. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** The position's pixel on the detector (0-based). */
  xt: number;
  yt: number;
  /** IMAGE values (MJy/sr, as stored) and FLAGS words, row-major, row 0 = y0. */
  image: Float32Array;
  flags: Int32Array;
  /** Flag name -> bit number, from the FLAGS header's MSKNnnnn cards. */
  bits: Record<string, number>;
  /** The IMAGE header, as FITS text (80-character cards). */
  header: string;
  lambdaUm: number;
  bandwidthUm: number;
  mjd: number;
  bytes: number;
  /**
   * With `extra` (fake-mover injection; Physics, 14 Nov): VARIANCE and ZODI for the same box, the
   * primary and FLAGS headers as text, and the EPSF extension's header hash. The ePSF itself is
   * per detector (/v1/psf); the hash checks each photo uses that same one.
   */
  extra?: {
    variance: Float32Array;
    zodi: Float32Array;
    primaryHeader: string;
    flagsHeader: string;
    psfHeaderSha256: string;
  };
}

/** Where a file's later extensions start: VARIANCE, ZODI and EPSF follow FLAGS in L2 files. */
async function laterHdus(url: string, flagsOff: number, signal?: AbortSignal) {
  const fh = await rawHeaderAt(url, flagsOff, 4, signal);
  const varOff = flagsOff + fh.length + dataBytes(fh.header);
  const vh = await rawHeaderAt(url, varOff, 4, signal);
  const zodiOff = varOff + vh.length + dataBytes(vh.header);
  const zh = await rawHeaderAt(url, zodiOff, 4, signal);
  const psfOff = zodiOff + zh.length + dataBytes(zh.header);
  const ph = await rawHeaderAt(url, psfOff, 2, signal);
  for (const [h, name] of [
    [vh, 'VARIANCE'],
    [zh, 'ZODI'],
    [ph, 'EPSF'],
  ] as const)
    if (h.header.get('EXTNAME') !== name)
      throw new Error(`expected ${name}, found ${String(h.header.get('EXTNAME'))}`);
  return { fh, varOff, vh, zodiOff, zh, psfOff, ph };
}

/** The EPSF extension of one file, exactly as stored (header + data), and its header's hash. */
export async function readPsf(
  photo: LivePhoto,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; headerSha256: string; version: string }> {
  const url = bucketUrl(photo.key);
  const first = await range(url, 0, 12 * BLOCK - 1, signal);
  const h0 = parseHeader(first) ?? (await headerAt(url, 0, 2, signal));
  const hi = parseHeader(first.subarray(h0.length)) ?? (await headerAt(url, h0.length, 10, signal));
  const flagsOff = h0.length + hi.length + dataBytes(hi.header);
  const { psfOff, ph } = await laterHdus(url, flagsOff, signal);
  const bytes = await rangeParallel(
    url,
    psfOff,
    psfOff + ph.length + dataBytes(ph.header) - 1,
    signal,
  );
  return {
    bytes,
    headerSha256: await sha256Hex(ph.text),
    version: String(h0.header.get('VERSION') ?? ''),
  };
}

export async function readNative(
  photo: LivePhoto,
  /** A sky position, or a detector pixel (0-based) for reading the same pixel across photos (D6). */
  centre: SkyPosition | { x: number; y: number },
  half = 20,
  signal?: AbortSignal,
  extra = false,
): Promise<NativeBox | null> {
  const url = bucketUrl(photo.key);
  const first = await range(url, 0, 12 * BLOCK - 1, signal);
  let bytes = first.length;
  const h0 = parseHeader(first) ?? (await headerAt(url, 0, 2, signal));
  let hiBytes = first.subarray(h0.length);
  let hi = parseHeader(hiBytes);
  if (!hi) {
    hiBytes = await range(url, h0.length, h0.length + 64 * BLOCK - 1, signal);
    bytes += hiBytes.length;
    hi = parseHeader(hiBytes);
    if (!hi) throw new Error(`${photo.obsId}: IMAGE header too long`);
  }
  const header = new TextDecoder('ascii').decode(hiBytes.subarray(0, hi.length));
  const nx = num(hi.header, 'NAXIS1');
  const ny = num(hi.header, 'NAXIS2');
  const c = 'ra' in centre ? new Wcs(hi.header).toPixel(centre.ra, centre.dec) : centre;
  if (!c) return null;
  const xc = Math.round(c.x);
  const yc = Math.round(c.y);
  if (xc < 0 || yc < 0 || xc >= nx || yc >= ny) return null;
  const y0 = Math.max(0, yc - half);
  const y1 = Math.min(ny, yc + half);
  const x0 = Math.max(0, xc - half);
  const x1 = Math.min(nx, xc + half);
  const imgOff = h0.length + hi.length;
  const flagsOff = imgOff + dataBytes(hi.header);
  const [img, fh, tail] = await Promise.all([
    rangeParallel(url, imgOff + y0 * nx * 4, imgOff + y1 * nx * 4 - 1, signal),
    headerAt(url, flagsOff, 4, signal),
    tailBlocks(url, 6, signal),
  ]);
  const fl = await flagRows(url, fh, flagsOff, nx, y0, y1 - 1, photo.obsId, signal);
  bytes += img.length + tail.length + fl.bytes;
  const w = x1 - x0;
  const h = y1 - y0;
  // VARIANCE and ZODI: plain float32 images like IMAGE, the same rows and columns.
  const crop = (raw: Uint8Array) => {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const out = new Float32Array(w * h);
    for (let r = 0; r < h; r++)
      for (let i = 0; i < w; i++) out[r * w + i] = dv.getFloat32(4 * (r * nx + x0 + i), false);
    return out;
  };
  let more: NativeBox['extra'];
  if (extra) {
    const later = await laterHdus(url, flagsOff, signal);
    const rowsOf = (off: number, len: number) =>
      rangeParallel(url, off + len + y0 * nx * 4, off + len + y1 * nx * 4 - 1, signal);
    const [vr, zr] = await Promise.all([
      rowsOf(later.varOff, later.vh.length),
      rowsOf(later.zodiOff, later.zh.length),
    ]);
    bytes += vr.length + zr.length;
    more = {
      variance: crop(vr),
      zodi: crop(zr),
      primaryHeader: new TextDecoder('ascii').decode(first.subarray(0, h0.length)),
      flagsHeader: later.fh.text,
      psfHeaderSha256: await sha256Hex(later.ph.text),
    };
  }
  const iv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const image = new Float32Array(w * h);
  const flags = new Int32Array(w * h);
  for (let r = 0; r < h; r++)
    for (let i = 0; i < w; i++) {
      image[r * w + i] = iv.getFloat32(4 * (r * nx + x0 + i), false);
      flags[r * w + i] = fl.flags[r * nx + x0 + i]!;
    }
  const bitsByName: Record<string, number> = {};
  for (const [k, v] of fl.F)
    if (k.startsWith('MSKN') && typeof v === 'string') bitsByName[v] = Number(k.slice(4));
  const wave = parseWaveTail(tail);
  const [lambdaUm, bandwidthUm] = wave ? waveAt(wave, c.x, c.y) : [NaN, NaN];
  return {
    obsId: photo.obsId,
    x0,
    y0,
    w,
    h,
    xt: c.x,
    yt: c.y,
    image,
    flags,
    bits: bitsByName,
    header,
    lambdaUm,
    bandwidthUm,
    mjd: num(hi.header, 'MJD-AVG', photo.mjd),
    bytes,
    ...(more ? { extra: more } : {}),
  };
}

export interface LiveFrame {
  photo: LivePhoto;
  tile: Tile;
  lambdaUm: number;
  bandwidthUm: number;
  mjd: number;
  bytes: number;
}

/**
 * Reads one photo's patch around `centre`: about 8 range requests and 1–1.5 MB for a 64 px grid.
 * Returns null when the grid's centre falls off this detector.
 */
/** The primary and IMAGE headers, in one request when they fit in the first 12 blocks. */
async function imageHeaders(url: string, signal?: AbortSignal) {
  const first = await range(url, 0, 12 * BLOCK - 1, signal);
  const h0 = parseHeader(first) ?? (await headerAt(url, 0, 2, signal));
  const rest = first.subarray(h0.length);
  const hi = parseHeader(rest) ?? (await headerAt(url, h0.length, 10, signal));
  return { h0, hi, bytes: first.length };
}

/** The file's last blocks, which hold the WCS-WAVE table (a suffix range: no file size needed). */
async function tailBlocks(url: string, blocks = 6, signal?: AbortSignal): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const init: RequestInit = { headers: { Range: `bytes=-${blocks * BLOCK}` } };
      if (signal) init.signal = signal;
      const r = await fetch(url, init);
      if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (signal?.aborted || attempt >= 2) throw e;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
}

export interface Probe {
  /** 0-based pixel of the centre on this detector. */
  x: number;
  y: number;
  /** Wavelength and bandwidth at that pixel, from the file's WCS-WAVE table (µm). */
  lambdaUm: number;
  bandwidthUm: number;
  bytes: number;
}

/* ------------------------------------------------------------------ the cloud helper (plan C1) */

/**
 * The cloud helper: two Cloudflare Workers (cloud/edge, cloud/live). planetes-edge answers from
 * a cache near the visitor; on a miss, planetes-live, placed next to NASA's bucket, runs this
 * same reader there and sends back only the finished cutout (~20 kB instead of ~1 MB of raw
 * rows; ~1 s the first time, ~0.3 s cached). Pages use it by default and fall back to reading
 * NASA directly on any failure or timeout (6 s probe, 10 s frame); after three failures in a row they read directly
 * for a minute, then try the helper again. Off outside a browser (tests, and the Worker itself,
 * which must read NASA directly). VITE_PLANETES_HELPER sets another address, or 'off'.
 */
export const DEFAULT_HELPER = 'https://planetes-edge.planetes.workers.dev';
const HELPER_TIMEOUT_MS = { probe: 6_000, frame: 10_000, gaia: 25_000 };
const HELPER_PAUSE_MS = 60_000;
let helperBase: string | null = (() => {
  if (typeof document === 'undefined') return null;
  const v = import.meta.env.VITE_PLANETES_HELPER as string | undefined;
  return v === 'off' || v === '' ? null : (v ?? DEFAULT_HELPER);
})();
let helperFailures = 0;
let helperPausedUntil = 0;

/** The helper's address (null when it's off), for its other routes (e.g. /v1/resolve). */
export function helperAddress(): string | null {
  return helperBase;
}

/** Whether reads go through the helper right now (on, and not paused after failures). */
export function helperActive(): boolean {
  return helperBase !== null && Date.now() >= helperPausedUntil;
}

/** Turns the helper on (an address) or off (null); for tests and for the Worker itself. */
export function setHelper(base: string | null): void {
  helperBase = base;
  helperFailures = 0;
  helperPausedUntil = 0;
}

function helperUrl(route: string, photo: LivePhoto, centre: SkyPosition, extra = ''): string {
  return (
    `${helperBase}/v1/${route}?key=${encodeURIComponent(photo.key)}` +
    `&ra=${centre.ra.toFixed(6)}&dec=${centre.dec.toFixed(6)}${extra}&rv=${READER_VERSION}`
  );
}

/** Runs `viaHelper` when the helper is on and healthy; null means "read NASA directly". */
async function tryHelper<T>(
  viaHelper: () => Promise<T>,
  signal?: AbortSignal,
): Promise<{ value: T } | null> {
  if (!helperBase || Date.now() < helperPausedUntil) return null;
  try {
    const value = await viaHelper();
    helperFailures = 0;
    return { value };
  } catch (e) {
    // The caller's own Stop propagates; a helper failure or timeout falls back.
    if (signal?.aborted) throw e;
    if (++helperFailures >= 3) {
      helperFailures = 0;
      helperPausedUntil = Date.now() + HELPER_PAUSE_MS;
    }
    return null;
  }
}

/** Decodes the helper's binary frame ('PLF1', see cloud/live/src/index.ts). */
export function decodeHelperFrame(buf: ArrayBuffer, photo: LivePhoto, size?: number): LiveFrame {
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x504c4631) throw new Error('not a planetes frame');
  const j = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, j))) as {
    obsId: string;
    size: number;
    lambdaUm: number | null;
    bandwidthUm: number | null;
    mjd: number;
  };
  // A frame for another photo or grid must never reach the lens.
  if (meta.obsId !== photo.obsId) throw new Error('planetes frame is for another photo');
  if (size !== undefined && meta.size !== size) throw new Error('planetes frame has another size');
  const n = meta.size * meta.size;
  if (buf.byteLength !== 8 + j + 5 * n) throw new Error('planetes frame has the wrong length');
  return {
    photo,
    tile: {
      id: photo.obsId,
      size: meta.size,
      pixels: new Float32Array(buf.slice(8 + j, 8 + j + 4 * n)),
      flags: new Uint8Array(buf.slice(8 + j + 4 * n)),
    },
    lambdaUm: meta.lambdaUm ?? NaN,
    bandwidthUm: meta.bandwidthUm ?? NaN,
    // The file header's MJD-AVG (the Worker reads it; a cached answer can't carry a caller's
    // value), falling back to the index's time.
    mjd: Number.isFinite(meta.mjd) && meta.mjd > 0 ? meta.mjd : photo.mjd,
    bytes: buf.byteLength,
  };
}

async function helperGet(
  url: string,
  kind: keyof typeof HELPER_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Response | null> {
  // AbortSignal.any is 2023+ (Chrome 116, Safari 17.4); older browsers keep only the caller's Stop.
  const timeout = AbortSignal.timeout(HELPER_TIMEOUT_MS[kind]);
  const both = signal
    ? typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, timeout])
      : signal
    : timeout;
  const r = await fetch(url, { signal: both });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`helper HTTP ${r.status}`);
  return r;
}

/**
 * Where a position falls on one photo, and the colour that photo saw there, without reading any
 * image or flag rows: the headers (one request) and the WCS-WAVE tail (one request), about
 * 40 kB. Null when the centre is off the detector or the file has no WCS-WAVE table.
 */
export async function probePhoto(
  photo: LivePhoto,
  centre: SkyPosition,
  signal?: AbortSignal,
): Promise<Probe | null> {
  const viaHelper = await tryHelper(async () => {
    const r = await helperGet(helperUrl('probe', photo, centre), 'probe', signal);
    if (!r) return null;
    const p = (await r.json()) as Omit<Probe, 'bytes'>;
    return { ...p, bytes: 0 };
  }, signal);
  if (viaHelper) return viaHelper.value;
  const url = bucketUrl(photo.key);
  const [{ hi, bytes }, tail] = await Promise.all([
    imageHeaders(url, signal),
    tailBlocks(url, 6, signal),
  ]);
  const nx = num(hi.header, 'NAXIS1');
  const ny = num(hi.header, 'NAXIS2');
  const c = new Wcs(hi.header).toPixel(centre.ra, centre.dec);
  if (!c || c.x < 0 || c.y < 0 || c.x > nx - 1 || c.y > ny - 1) return null;
  const wave = parseWaveTail(tail);
  if (!wave) return null;
  const [lambdaUm, bandwidthUm] = waveAt(wave, c.x, c.y);
  return { x: c.x, y: c.y, lambdaUm, bandwidthUm, bytes: bytes + tail.length };
}

export async function readPhoto(
  photo: LivePhoto,
  centre: SkyPosition,
  size = 64,
  scaleArcsec = 6.15,
  signal?: AbortSignal,
): Promise<LiveFrame | null> {
  const viaHelper = await tryHelper(async () => {
    const extra = `&size=${size}&scale=${scaleArcsec}&mjd=${photo.mjd}`;
    const r = await helperGet(helperUrl('frame', photo, centre, extra), 'frame', signal);
    return r ? decodeHelperFrame(await r.arrayBuffer(), photo, size) : null;
  }, signal);
  if (viaHelper) return viaHelper.value;
  const url = bucketUrl(photo.key);
  let bytes = 0;
  const { h0, hi, bytes: hb } = await imageHeaders(url, signal);
  bytes += hb;
  const imgOff = h0.length + hi.length;
  const nx = num(hi.header, 'NAXIS1');
  const ny = num(hi.header, 'NAXIS2');
  const wcs = new Wcs(hi.header);
  const c = wcs.toPixel(centre.ra, centre.dec);
  if (!c || c.x < 0 || c.y < 0 || c.x > nx - 1 || c.y > ny - 1) return null;
  const grid = gridPositions(centre, size, scaleArcsec);
  const at = grid.map((g) => wcs.toPixel(g.ra, g.dec));
  const ys = at.flatMap((q) => (q ? [q.y] : []));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const y1 = Math.min(ny - 1, Math.ceil(Math.max(...ys)) + 1);
  const rows = y1 - y0 + 1;
  const flagsOff = imgOff + dataBytes(hi.header);
  const [img, fh, tail] = await Promise.all([
    rangeParallel(url, imgOff + y0 * nx * 4, imgOff + (y1 + 1) * nx * 4 - 1, signal),
    headerAt(url, flagsOff, 4, signal),
    tailBlocks(url, 6, signal),
  ]);
  bytes += img.length + fh.length + tail.length;
  // IMAGE rows (big-endian float32).
  const iv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const image = new Float32Array(rows * nx);
  for (let k = 0; k < image.length; k++) image[k] = iv.getFloat32(4 * k, false);
  const fl = await flagRows(url, fh, flagsOff, nx, y0, y1, photo.obsId, signal);
  bytes += fl.bytes;
  const flags = fl.flags;
  const F = fl.F;
  const satW = bits(F, SATURATED);
  const rejW = bits(F, REJECTED);
  const srcW = bits(F, ['SOURCE']);
  const outW = bits(F, ['OUTLIER']);
  // Resample.
  const n = size * size;
  const pixels = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const q = at[k];
    if (!q || q.x < 0 || q.x > nx - 1 || q.y < y0 || q.y > y1) {
      pixels[k] = NaN;
      continue;
    }
    pixels[k] = bilinear(image, nx, rows, q.x, q.y - y0);
    const xa = Math.floor(q.x);
    const ya = Math.floor(q.y - y0);
    let f = 0;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const xx = Math.min(nx - 1, xa + dx);
      const yy = Math.min(rows - 1, ya + dy);
      f |= flags[yy * nx + xx]!;
    }
    mask[k] =
      (f & satW ? FlagMask.saturated : 0) |
      (f & rejW ? FlagMask.rejected : 0) |
      (f & srcW ? FlagMask.source : 0) |
      (f & outW ? FlagMask.outlier : 0);
  }
  const finite = Array.from(pixels)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const med = finite.length ? finite[finite.length >> 1]! : 0;
  for (let k = 0; k < n; k++) pixels[k] = pixels[k]! - med;
  const wave = parseWaveTail(tail);
  const [lambdaUm, bandwidthUm] = wave ? waveAt(wave, c.x, c.y) : [NaN, NaN];
  return {
    photo,
    tile: { id: photo.obsId, size, pixels, flags: mask },
    lambdaUm,
    bandwidthUm,
    mjd: num(hi.header, 'MJD-AVG', photo.mjd),
    bytes,
  };
}

/* ------------------------------------------------------------------ a spectrum on the fly, anywhere */

export interface LiveSpectrumPoint {
  lambdaUm: number;
  fluxUJy: number;
  sigmaUJy: number;
  detector: number;
  season: number;
  mjd: number;
  obsId: string;
  release: 'DR1' | 'QR3';
  /** An artefact or saturation flag touches the aperture: not a measurement. */
  flagged: boolean;
  saturated: boolean;
}

const APER_PX = 2.5;
const ANNULUS_PX: [number, number] = [5, 8];
/** One grid pixel (6.15″) as a solid angle, steradians: MJy/sr × sr × 1e12 = µJy. */
const PIX_SR = (6.15 / 206264.806) ** 2;

/**
 * Aperture photometry at the centre of a live tile, as the pack pipeline does it: the sum within
 * 2.5 px minus the median of a 5–8 px annulus, in µJy; the error from the annulus scatter.
 * Null when the aperture runs off the photo or the annulus is too flagged to trust.
 */
export function apertureFlux(
  tile: Tile,
): { flux: number; sigma: number; flagged: boolean; saturated: boolean } | null {
  const n = tile.size;
  const c = (n - 1) / 2;
  const ap: number[] = [];
  const ann: number[] = [];
  let flagged = false;
  let saturated = false;
  const bad = FlagMask.saturated | FlagMask.rejected;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - c, y - c);
      const v = tile.pixels[y * n + x]!;
      const f = tile.flags[y * n + x]!;
      if (r <= APER_PX) {
        if (!Number.isFinite(v)) return null;
        ap.push(v);
        if (f & bad) flagged = true;
        if (f & FlagMask.saturated) saturated = true;
      } else if (r >= ANNULUS_PX[0] && r <= ANNULUS_PX[1] && Number.isFinite(v) && !(f & bad)) {
        ann.push(v);
      }
    }
  }
  if (ap.length < 5 || ann.length < 15) return null;
  ann.sort((a, b) => a - b);
  const bk = ann[ann.length >> 1]!;
  const dev = ann.map((v) => Math.abs(v - bk)).sort((a, b) => a - b);
  const sd = 1.4826 * dev[dev.length >> 1]!;
  const sum = ap.reduce((s, v) => s + (v - bk), 0);
  const sigma = sd * Math.sqrt(ap.length * (1 + ap.length / ann.length));
  return { flux: sum * PIX_SR * 1e12, sigma: sigma * PIX_SR * 1e12, flagged, saturated };
}

/** Up to `n` items spread evenly through a list (by index). */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / n)]!);
}

export interface LiveSpectrum {
  /** Usable measurements, by wavelength. */
  points: LiveSpectrumPoint[];
  /** Photos whose aperture is touched by a saturation or artefact flag: not measurements. */
  flagged: LiveSpectrumPoint[];
  /** The pack pipeline's rule: ≥ 80% of photos usable and a median S/N ≥ 10. */
  status: 'measured' | 'binned only' | 'not measurable';
  reason: string;
  /**
   * Whether known stars inside the aperture were checked (Gaia DR3, through the cloud helper;
   * the browser can't query Gaia itself). False when the helper is off or Gaia didn't answer.
   */
  blendChecked: boolean;
  /** Gaia stars inside the aperture bright enough to add their light (empty when none or unchecked). */
  neighbours: string[];
}

export interface GaiaStar {
  id: string;
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  g: number | null;
  /** BP−RP colour (null when Gaia has none, as for many faint red stars). */
  bpRp?: number | null;
}

/**
 * Gaia DR3 stars within `radiusArcsec` (positions at epoch 2016.0), through the cloud helper.
 * Null when the helper is off or the query fails: callers then say "not checked".
 */
export async function gaiaNear(
  at: SkyPosition,
  radiusArcsec: number,
  signal?: AbortSignal,
): Promise<GaiaStar[] | null> {
  // Not through tryHelper: a slow Gaia archive must not pause the helper for photos.
  if (!helperActive()) return null;
  try {
    const r = await helperGet(
      `${helperBase}/v1/gaia?ra=${at.ra.toFixed(5)}&dec=${at.dec.toFixed(5)}&r=${Math.round(radiusArcsec)}&c=2`,
      'gaia',
      signal,
    );
    if (!r) return null;
    const d = (await r.json()) as { stars: GaiaStar[] };
    return d.stars.filter((x) => Number.isFinite(x.ra) && Number.isFinite(x.dec));
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

export interface CatwiseStar {
  id: string;
  /** Position at MJD 57170 (2015.4), degrees; proper motion in mas/yr. */
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  w1: number | null;
  w2: number | null;
}

/** CatWISE2020 within `radiusArcsec` (positions at 2015.4), through the helper; null if unavailable. */
export async function catwiseNear(
  at: SkyPosition,
  radiusArcsec: number,
  signal?: AbortSignal,
): Promise<CatwiseStar[] | null> {
  if (!helperActive()) return null;
  try {
    const r = await helperGet(
      `${helperBase}/v1/catwise?ra=${at.ra.toFixed(5)}&dec=${at.dec.toFixed(5)}&r=${Math.round(radiusArcsec)}`,
      'gaia',
      signal,
    );
    if (!r) return null;
    const d = (await r.json()) as { stars: CatwiseStar[] };
    return d.stars.filter((x) => Number.isFinite(x.ra) && Number.isFinite(x.dec));
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/**
 * The pack pipeline's blend rule (planetes_pack.write_spectrum): the target is the Gaia star
 * within 2″ of the spot; a neighbour counts if it sits inside the aperture (2″ < sep ≤ aperture)
 * and is within 3.3 mag of the target (5% of its light), or brighter than G 19.5 when the target
 * isn't in Gaia. Positions moved to 2026.0 by proper motion.
 */
export function blendNeighbours(
  at: SkyPosition,
  stars: GaiaStar[],
  apertureArcsec: number,
): string[] {
  const dt = 2026.0 - 2016.0;
  // The pipeline asks Gaia for G < 19.5 only, so fainter stars are neither target nor neighbour.
  const seps = stars
    .filter((x) => x.g != null && x.g < 19.5)
    .map((x) => {
      const dec = x.dec + (x.pmdec * dt) / 3.6e6;
      const ra = x.ra + (x.pmra * dt) / 3.6e6 / Math.max(1e-6, Math.cos(x.dec * RAD));
      let dra = ra - at.ra;
      if (dra > 180) dra -= 360;
      if (dra < -180) dra += 360;
      const sep = Math.hypot(dra * Math.cos(at.dec * RAD), dec - at.dec) * 3600;
      return { sep, x };
    });
  const me = seps.filter((s) => s.sep <= 2).sort((a, b) => a.sep - b.sep)[0];
  const limit = me?.x.g != null ? me.x.g + 3.3 : 19.5;
  return seps
    .filter((s) => s.sep > 2 && s.sep <= apertureArcsec && (s.x.g ?? 99) < limit)
    .sort((a, b) => a.sep - b.sep)
    .map(
      (s) => `Gaia DR3 ${s.x.id} (G ${(s.x.g ?? NaN).toFixed(2)}) ${s.sep.toFixed(1)} arcsec away`,
    );
}

/**
 * A spectrum of whatever sits at `at`: up to `perDetector` photos per detector, spread in time,
 * each read as a small box (20 px: ~250 kB) and measured with apertureFlux at that photo's own
 * wavelength. Points arrive through onPoint as they're measured. About 6 × perDetector × 0.25 MB.
 */
export async function liveSpectrum(
  at: SkyPosition,
  photos: LivePhoto[],
  opts: {
    perDetector?: number;
    concurrency?: number;
    signal?: AbortSignal;
    onPoint?: (p: LiveSpectrumPoint, done: number, total: number) => void;
  } = {},
): Promise<LiveSpectrum> {
  const per = opts.perDetector ?? 10;
  // Known neighbours, asked in parallel with the photos (the aperture is APER_PX grid pixels).
  const apertureArcsec = APER_PX * 6.15;
  // The search reaches 15″ beyond the aperture: Gaia positions are at 2016, and a neighbour
  // moving up to 1.5″/yr is still found. Never rejects (a Stop is re-checked after the photos).
  const gaia = gaiaNear(at, Math.ceil(apertureArcsec) + 15, opts.signal).catch(() => null);
  const seasons = seasonsOf(photos);
  const withSeason = photos.map((p, i) => ({ p, s: seasons[i]! }));
  const chosen = [1, 2, 3, 4, 5, 6].flatMap((d) =>
    spread(
      withSeason.filter((x) => x.p.det === d),
      per,
    ),
  );
  const out: LiveSpectrumPoint[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const { p, s } = chosen[next++]!;
      try {
        const f = await readPhoto(p, at, 20, 6.15, opts.signal);
        const m = f && apertureFlux(f.tile);
        if (f && m && Number.isFinite(f.lambdaUm)) {
          const point: LiveSpectrumPoint = {
            lambdaUm: f.lambdaUm,
            fluxUJy: m.flux,
            sigmaUJy: m.sigma,
            detector: p.det,
            season: s,
            mjd: f.mjd,
            obsId: p.obsId,
            release: p.release,
            flagged: m.flagged,
            saturated: m.saturated,
          };
          out.push(point);
          opts.onPoint?.(point, done + 1, chosen.length);
        }
      } catch (e) {
        if (opts.signal?.aborted) throw e;
      }
      done++;
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  out.sort((a, b) => a.lambdaUm - b.lambdaUm);
  const points = out.filter((p) => !p.flagged);
  const flagged = out.filter((p) => p.flagged);
  const frac = out.length ? points.length / out.length : 0;
  const sn = points.map((p) => p.fluxUJy / Math.max(1e-9, p.sigmaUJy)).sort((a, b) => a - b);
  const medSn = sn.length ? sn[sn.length >> 1]! : 0;
  const pct = Math.round(frac * 100);
  let status: LiveSpectrum['status'];
  let reason: string;
  if (!out.length) {
    status = 'not measurable';
    reason = 'no photo could be measured here';
  } else if (frac < 0.8) {
    status = 'not measurable';
    reason = `${points.length} of ${out.length} photos usable (${pct}%); the rest are saturated or flagged here`;
  } else if (medSn >= 10) {
    status = 'measured';
    reason = `${points.length} of ${out.length} photos usable (${pct}%); median S/N ${medSn.toFixed(1)}`;
  } else if (medSn >= 3) {
    // Averaging ~10 neighbouring photos per wavelength bin gains about √10 ≈ 3 in S/N, so a
    // per-photo median of 3 or more reaches ~10 per bin: the shape is real, single points aren't.
    status = 'binned only';
    reason = `${points.length} of ${out.length} photos usable; median S/N ${medSn.toFixed(1)} per photo, so only the overall shape (about 10 photos averaged per wavelength bin) is meaningful`;
  } else {
    status = 'not measurable';
    reason = `nothing bright enough here: median S/N ${medSn.toFixed(1)} per photo`;
  }
  const stars = await gaia;
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const neighbours = stars ? blendNeighbours(at, stars, apertureArcsec) : [];
  if (neighbours.length) {
    status = 'not measurable';
    reason = `blended: ${neighbours.join('; ')} lies inside the aperture, so its light would be counted`;
  }
  return { points, flagged, status, reason, blendChecked: stars !== null, neighbours };
}
