import type { FrameBundle, Measurement, PackManifest, Stack, TargetId } from './types';
import { PACK_FORMAT } from './types';

/** A loaded tile: pixels in MJy/sr (NaN = no data) and the flag mask. */
export interface Tile {
  id: string;
  size: number;
  pixels: Float32Array;
  flags: Uint8Array;
}

export interface LoadedPack {
  base: string;
  manifest: PackManifest;
  measurements: Measurement[];
  stacks: Map<string, Tile>;
}

const DATA_ROOT = `${import.meta.env.BASE_URL}data/packs`;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

export async function loadTile(
  base: string,
  size: number,
  t: Pick<Stack, 'id' | 'image' | 'flags'>,
) {
  const [img, flg] = await Promise.all([
    fetchOk(`${base}/${t.image}`).then((r) => r.arrayBuffer()),
    fetchOk(`${base}/${t.flags}`).then((r) => r.arrayBuffer()),
  ]);
  const pixels = new Float32Array(img); // little-endian, which every browser uses natively
  const flags = new Uint8Array(flg);
  if (pixels.length !== size * size || flags.length !== size * size) {
    throw new Error(`${t.id}: tile is not ${size} × ${size}`);
  }
  return { id: t.id, size, pixels, flags } satisfies Tile;
}

/** One fetch per bundle file, shared by every photo in it. */
const bundleFiles = new Map<string, Promise<{ buf: ArrayBuffer; index: Map<string, number> }>>();

/**
 * A detector's whole bundle, fetched once. `onProgress` (bytes so far, total) is called as it
 * arrives when this call starts the download (Viewer, 14 Nov: say how much is coming).
 */
export function loadBundle(
  base: string,
  bundle: FrameBundle,
  onProgress?: (received: number, total: number) => void,
): Promise<{ buf: ArrayBuffer; index: Map<string, number> }> {
  // Typed-array views need 4-byte-aligned offsets: a pack with an odd grid or a header would
  // otherwise fail far from here (Viewer, 14 Nov).
  if (bundle.bytesPerFrame % 4 !== 0)
    throw new Error(`${bundle.file}: bytesPerFrame ${bundle.bytesPerFrame} is not a multiple of 4`);
  const url = `${base}/${bundle.file}`;
  let file = bundleFiles.get(url);
  if (!file) {
    const total = bundle.bytesPerFrame * bundle.frameIds.length;
    file = fetchOk(url)
      .then(async (r) => {
        if (!onProgress || !r.body) return r.arrayBuffer();
        // Read it in pieces to report progress; the size is known from the manifest.
        const out = new Uint8Array(total);
        const reader = r.body.getReader();
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (got + value.length > total) throw new Error(`${url}: longer than expected`);
          out.set(value, got);
          got += value.length;
          onProgress(got, total);
        }
        return out.buffer.slice(0, got);
      })
      .then((buf) => {
        if (buf.byteLength !== total) throw new Error(`${url}: unexpected size`);
        return { buf, index: new Map(bundle.frameIds.map((id, k) => [id, k])) };
      });
    bundleFiles.set(url, file);
    file.catch(() => bundleFiles.delete(url));
  }
  return file;
}

/**
 * One photo from its detector's bundle: the same bytes as its own .f32 and .u8 files, sliced
 * from one shared download (no copy).
 */
export async function loadBundledTile(
  base: string,
  size: number,
  bundle: FrameBundle,
  frameId: string,
): Promise<Tile> {
  const { buf, index } = await loadBundle(base, bundle);
  const k = index.get(frameId);
  if (k === undefined) throw new Error(`${frameId} is not in ${base}/${bundle.file}`);
  const n = size * size;
  const at = k * bundle.bytesPerFrame;
  return {
    id: frameId,
    size,
    pixels: new Float32Array(buf, at, n),
    flags: new Uint8Array(buf, at + 4 * n, n),
  } satisfies Tile;
}

/** Loads a target's manifest, measurements and stacks (frames are loaded on demand). */
export async function loadPack(release: string, target: TargetId): Promise<LoadedPack> {
  const base = `${DATA_ROOT}/${release}/${target}`;
  const manifest = (await fetchOk(`${base}/manifest.json`).then((r) => r.json())) as PackManifest;
  if (manifest.format !== PACK_FORMAT)
    throw new Error(`unsupported pack format ${manifest.format}`);
  const measurements = (await fetchOk(`${base}/${manifest.measurements}`).then((r) =>
    r.json(),
  )) as Measurement[];
  const size = manifest.grid.size;
  const tiles = await Promise.all(manifest.stacks.map((s) => loadTile(base, size, s)));
  return { base, manifest, measurements, stacks: new Map(tiles.map((t) => [t.id, t])) };
}

export function measurement(pack: LoadedPack, key: string): Measurement | undefined {
  return pack.measurements.find((m) => m.key === key);
}

/** The pair of stacks of one kind for two seasons, e.g. all-colour seasons 0 and 1. */
export function stackPair(
  pack: LoadedPack,
  kind: Stack['kind'],
  seasons: [number, number] = [0, 1],
): [Tile, Tile] | null {
  const pick = (season: number) =>
    pack.manifest.stacks.find((s) => s.kind === kind && s.season === season);
  const a = pick(seasons[0]);
  const b = pick(seasons[1]);
  const ta = a && pack.stacks.get(a.id);
  const tb = b && pack.stacks.get(b.id);
  return ta && tb ? [ta, tb] : null;
}
