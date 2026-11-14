import type { Measurement, PackManifest, Stack, TargetId } from './types';
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
