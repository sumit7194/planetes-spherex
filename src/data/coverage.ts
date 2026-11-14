/**
 * Weekly sky coverage: how many SPHEREx photos landed on each HEALPix pixel in each planning
 * week. Built by Physics from the frame index; the viewer only reads it. Format (little-endian):
 *
 *   weekly.bin   "PXW1", uint32 nside, uint32 weeks, uint32 npix, uint16[weeks × npix]
 *                (week-major, NESTED pixel order)
 *   weeks.json   release, status, nside, weeks[{label, startMjd, endMjd, startUtc, endUtc,
 *                frames}], sha256, caption, source
 *
 * Any status other than MEASURED is a placeholder and is labelled as one on screen.
 */

import type { Status } from './pack/types';
import { npix } from './healpix';

export interface CoverageWeek {
  label: string;
  startMjd: number;
  endMjd: number;
  startUtc: string;
  endUtc: string;
  frames: number;
}

export interface CoverageMeta {
  release: string;
  status: Status;
  nside: number;
  weeks: CoverageWeek[];
  sha256?: Record<string, string>;
  caption?: string;
  source?: string;
}

export interface Coverage {
  meta: CoverageMeta;
  nside: number;
  /** Photos per pixel for a week. */
  week(i: number): Uint16Array;
  /** Photos per pixel over weeks [0, i] inclusive. */
  upTo(i: number): Uint32Array;
}

const MAGIC = 0x31575850; // "PXW1" read as a little-endian uint32

export function parseCoverage(meta: CoverageMeta, bin: ArrayBuffer): Coverage {
  const view = new DataView(bin);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a coverage file');
  const nside = view.getUint32(4, true);
  const weeks = view.getUint32(8, true);
  const n = view.getUint32(12, true);
  if (n !== npix(nside)) throw new Error(`npix ${n} does not match nside ${nside}`);
  if (weeks !== meta.weeks.length) throw new Error('weeks.json and weekly.bin disagree');
  if (bin.byteLength !== 16 + 2 * weeks * n) throw new Error('coverage file is truncated');
  const all = new Uint16Array(bin, 16, weeks * n);
  // Running totals, computed once: week i's row is the sum of rows 0..i.
  const cumulative = new Uint32Array(weeks * n);
  for (let w = 0; w < weeks; w++) {
    for (let p = 0; p < n; p++) {
      const at = w * n + p;
      cumulative[at] = (w ? (cumulative[at - n] ?? 0) : 0) + (all[at] ?? 0);
    }
  }
  return {
    meta,
    nside,
    week: (i) => all.subarray(i * n, (i + 1) * n),
    upTo: (i) => cumulative.subarray(i * n, (i + 1) * n),
  };
}

/** Fetches a release's coverage, or null when it isn't published. */
export async function loadCoverage(base: string, release: string): Promise<Coverage | null> {
  try {
    const dir = `${base}data/coverage/${release}/`;
    const [metaRes, binRes] = await Promise.all([
      fetch(`${dir}weeks.json`),
      fetch(`${dir}weekly.bin`),
    ]);
    if (!metaRes.ok || !binRes.ok) return null;
    const meta = (await metaRes.json()) as CoverageMeta;
    return parseCoverage(meta, await binRes.arrayBuffer());
  } catch {
    return null;
  }
}
