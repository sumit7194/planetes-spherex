/**
 * The Watch speed fix must change nothing on screen: every photo sliced from its bundle is
 * byte-identical to its own .f32 and .u8 files, and every precomputed "all photos added
 * together" image equals what the page's own coadd() makes from those files.
 */
import { describe, expect, it } from 'vitest';
import { coadd } from './coadd';
import type { PackManifest } from './types';

// Node's fs, loaded without Node's types (they would leak into the app's own type check).
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as {
  readFileSync(p: string, enc?: string): Uint8Array & { toString(): string };
};
const ROOT = decodeURIComponent(
  new URL('../../../public/data/packs/dr1qr3', import.meta.url).pathname,
);
const TARGETS = ['barnard', 'w0855', 'epsind-b', 'rw-aur', 'r-dra'];

const raw = (p: string): Uint8Array => new Uint8Array(fs.readFileSync(p));
const bytes = (p: string): ArrayBuffer => raw(p).slice().buffer;
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe.each(TARGETS)('%s: bundles and precomputed sums', (target) => {
  const base = `${ROOT}/${target}`;
  const m = JSON.parse(new TextDecoder().decode(raw(`${base}/manifest.json`))) as PackManifest;
  const n = m.grid.size * m.grid.size;

  it('has a bundle and a sum for every detector with photos', () => {
    const dets = [...new Set(m.frames.map((f) => f.detector))].sort();
    expect(m.bundles?.map((b) => b.detector).sort()).toEqual(dets);
    expect(m.coadds?.map((c) => c.detector).sort()).toEqual(dets);
  });

  it('slices every photo byte for byte as its own files', () => {
    for (const b of m.bundles ?? []) {
      const buf = bytes(`${base}/${b.file}`);
      expect(buf.byteLength).toBe(b.bytesPerFrame * b.frameIds.length);
      b.frameIds.forEach((id, k) => {
        const f = m.frames.find((x) => x.id === id)!;
        const at = k * b.bytesPerFrame;
        expect(same(new Uint8Array(buf, at, 4 * n), raw(`${base}/${f.image}`))).toBe(true);
        expect(same(new Uint8Array(buf, at + 4 * n, n), raw(`${base}/${f.flags}`))).toBe(true);
      });
    }
  });

  it("matches the page's own coadd of the same photos", () => {
    for (const c of m.coadds ?? []) {
      const tiles = m.frames
        .filter((f) => f.detector === c.detector)
        .map((f) => ({
          id: f.id,
          size: m.grid.size,
          pixels: new Float32Array(bytes(`${base}/${f.image}`)),
          flags: new Uint8Array(bytes(`${base}/${f.flags}`)),
        }));
      const page = coadd(c.id, tiles);
      const made = new Float32Array(bytes(`${base}/${c.image}`));
      expect(same(new Uint8Array(made.buffer), new Uint8Array(page.pixels.buffer))).toBe(true);
      expect(same(raw(`${base}/${c.flags}`), page.flags)).toBe(true);
      expect(c.n).toBe(tiles.length);
    }
  });
});
