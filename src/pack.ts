/** The pack format written by pipeline/build_pack.py (planetes-event-pack/1). */

export interface Phot {
  flux: number;
  err: number;
  flagged: boolean;
  saturated: boolean;
  flags: string[];
  x: number;
  y: number;
}

export interface Exposure {
  obsId: string;
  det: number;
  pass: number;
  mjd: number;
  lam: number;
  bw: number;
  release: string;
  frame: number;
  phot: Phot | null;
}

export interface Cell {
  pass: number;
  det: number;
  n: number;
  mjdMin: number;
  mjdMax: number;
  mjdMid: number;
  lamMin: number;
  lamMax: number;
  display: number; // float32 offset into coadds.bin
  strict: number;
  sat: number; // byte offset into sat.bin
  stats: { p1: number; p50: number; p99: number; p999: number; max: number; sigma: number | null };
  predicted: { x: number; y: number };
  centroid: { x: number; y: number } | null;
}

export interface Pass {
  i: number;
  mjdMin: number;
  mjdMax: number;
  start: string;
  end: string;
  releases: string[];
  listed: number;
  used: number;
}

export interface CatSource {
  cat: string;
  id: string;
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  plx: number | null;
  epoch: number;
  mag: number | null;
  band: string;
}

export interface PackMeta {
  format: string;
  created: string;
  slug: string;
  name: string;
  kind: 'mover' | 'variable' | 'look';
  blurb: string;
  target: { ra: number; dec: number; epoch: number; pmra: number; pmdec: number; pmSource?: string };
  grid: { n: number; pixArcsec: number; crval: [number, number] };
  releases: string[];
  passes: Pass[];
  cells: Cell[];
  exposures: Exposure[];
  frameScales: number[];
  flagFractionsCore: Record<string, number>;
  photometry: { radiusPx: number; annulusPx: [number, number]; units: string; note: string };
  catalog: CatSource[];
  fetch: Record<string, number>;
  bunit: string;
}

export interface Pack extends PackMeta {
  base: string;
  coadds: Float32Array;
  sat: Uint8Array;
  frames: Int16Array | null;
}

export const DETECTORS: { det: number; lo: number; hi: number }[] = [
  { det: 1, lo: 0.75, hi: 1.1 },
  { det: 2, lo: 1.1, hi: 1.6 },
  { det: 3, lo: 1.6, hi: 2.4 },
  { det: 4, lo: 2.4, hi: 3.8 },
  { det: 5, lo: 3.8, hi: 4.4 },
  { det: 6, lo: 4.4, hi: 5.0 },
];

async function bin(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
}

export async function loadPack(base: string): Promise<Pack> {
  const r = await fetch(`${base}/pack.json`);
  if (!r.ok) throw new Error(`No pack at ${base} (${r.status})`);
  const meta = (await r.json()) as PackMeta;
  const [c, s] = await Promise.all([bin(`${base}/coadds.bin`), bin(`${base}/sat.bin`)]);
  return { ...meta, base, coadds: new Float32Array(c), sat: new Uint8Array(s), frames: null };
}

/** The per-exposure frames are larger; load them only when "Every photo" is chosen. */
export async function loadFrames(p: Pack): Promise<Int16Array> {
  if (!p.frames) p.frames = new Int16Array(await bin(`${p.base}/frames.bin`));
  return p.frames;
}

export function cellOf(p: Pack, pass: number, det: number): Cell | undefined {
  return p.cells.find((c) => c.pass === pass && c.det === det);
}

export function cellImage(p: Pack, c: Cell, policy: 'display' | 'strict'): Float32Array {
  const n = p.grid.n;
  const off = policy === 'display' ? c.display : c.strict;
  return p.coadds.subarray(off, off + n * n);
}

export function cellSat(p: Pack, c: Cell): Uint8Array {
  const n = p.grid.n;
  return p.sat.subarray(c.sat, c.sat + n * n);
}

export function frameImage(p: Pack, e: Exposure): Float32Array {
  const n = p.grid.n;
  const out = new Float32Array(n * n);
  if (!p.frames) return out;
  const q = p.frames.subarray(e.frame * n * n, (e.frame + 1) * n * n);
  const s = p.frameScales[e.frame];
  for (let i = 0; i < out.length; i++) out[i] = q[i] === -32768 ? NaN : q[i] * s;
  return out;
}

/** Detectors with a co-add in every pass: the only fair ones to blink or difference. */
export function sharedDetectors(p: Pack): number[] {
  return DETECTORS.map((d) => d.det).filter((d) => p.passes.every((ps) => cellOf(p, ps.i, d)));
}

export const mjdToYear = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;

export function fmtDate(mjd: number): string {
  const d = new Date((mjd - 40587) * 86400000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function passLabel(ps: Pass): string {
  const a = new Date((ps.mjdMin - 40587) * 86400000);
  const b = new Date((ps.mjdMax - 40587) * 86400000);
  const m = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const y = (d: Date) => d.getUTCFullYear();
  return y(a) === y(b) ? (m(a) === m(b) ? `${m(a)} ${y(a)}` : `${m(a)}–${m(b)} ${y(b)}`) : `${m(a)} ${y(a)} – ${m(b)} ${y(b)}`;
}
