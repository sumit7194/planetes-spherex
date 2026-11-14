import { describe, expect, it } from 'vitest';
import { parseCoverage, type CoverageMeta } from './coverage';

function file(weeks: number, nside = 1, fill: (w: number, p: number) => number = () => 0) {
  const n = 12 * nside * nside;
  const buf = new ArrayBuffer(16 + 2 * weeks * n);
  const v = new DataView(buf);
  v.setUint32(0, 0x31575850, true);
  v.setUint32(4, nside, true);
  v.setUint32(8, weeks, true);
  v.setUint32(12, n, true);
  const data = new Uint16Array(buf, 16);
  for (let w = 0; w < weeks; w++) for (let p = 0; p < n; p++) data[w * n + p] = fill(w, p);
  const meta: CoverageMeta = {
    release: 'test',
    status: 'MOCK',
    nside,
    weeks: Array.from({ length: weeks }, (_, i) => ({
      label: `W${i}`,
      startMjd: 60000 + 7 * i,
      endMjd: 60006 + 7 * i,
      startUtc: '',
      endUtc: '',
      frames: 0,
    })),
  };
  return { meta, buf };
}

describe('parseCoverage', () => {
  it('reads weeks and running totals', () => {
    const { meta, buf } = file(3, 1, (w, p) => (p === 5 ? w + 1 : 0));
    const c = parseCoverage(meta, buf);
    expect(c.nside).toBe(1);
    expect(c.week(1)[5]).toBe(2);
    expect(c.week(1)[4]).toBe(0);
    expect(c.upTo(2)[5]).toBe(6);
    expect(c.upTo(0)[5]).toBe(1);
  });

  it('rejects a file that disagrees with its sidecar', () => {
    const { meta, buf } = file(2);
    expect(() => parseCoverage({ ...meta, weeks: meta.weeks.slice(0, 1) }, buf)).toThrow();
  });

  it('rejects the wrong magic', () => {
    const { meta, buf } = file(1);
    new DataView(buf).setUint32(0, 0, true);
    expect(() => parseCoverage(meta, buf)).toThrow();
  });
});
