/**
 * planetes-live: a Cloudflare Worker placed next to NASA's SPHEREx bucket (plan item C1).
 *
 * It runs the browser's own reader (src/data/live/dr1qr3.ts, imported as is, so the two can't
 * drift) close to the data: each S3 read takes ~85 ms here instead of ~1 s from India, and only
 * the finished cutout travels to the visitor.
 *
 *   GET /v1/frame?key=<S3 key>&ra=&dec=[&size=64][&scale=6.15][&mjd=]
 *       -> binary frame (see encodeFrame), or 204 when the spot is off this photo.
 *   GET /v1/probe?key=&ra=&dec=      -> JSON {x, y, lambdaUm, bandwidthUm} or 204.
 *   GET /v1/health                   -> JSON {ok, version, colo}; colo is where the request
 *                                       entered Cloudflare. Where the code ran shows in the
 *                                       cf-placement response header (e.g. remote-ATL).
 *
 * Answers are cached (Cache API, one year): SPHEREx files are immutable; a reprocessing gets
 * a new file name and so a new cache key. Positions are rounded to 1e-6 deg in the key.
 */
import {
  probePhoto,
  READER_VERSION,
  readPhoto,
  setHelper,
  type LivePhoto,
} from '../../../src/data/live/dr1qr3';

// This Worker IS the helper: its reader must read NASA directly.
setHelper(null);

// The cache key carries the API version and the reader's version (READER_VERSION), so a reader
// fix never serves stale cutouts; the file key carries the release and processing version.
const VERSION = `v1-${READER_VERSION}`;
const KEY_RE = /^(dr1|qr3)\/level2\/[\w.-]+\/[\w.-]+\/[1-6]\/level2_[\w.-]+\.fits$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'x-planetes-cache, x-planetes-ms, x-planetes-upstream-bytes',
};

function bad(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status, headers: CORS });
}

function photoOf(key: string, mjd: number): LivePhoto {
  const file = key.slice(key.lastIndexOf('/') + 1);
  const obsId = file.replace(/^level2_/, '').replace(/_spx_.*$/, '');
  const det = Number(key.split('/')[4]);
  return {
    key,
    obsId,
    det,
    mjd,
    release: key.startsWith('qr3') ? 'QR3' : 'DR1',
    deep: false,
    centre: { ra: 0, dec: 0 },
    paDeg: 0,
    halfDeg: 0,
  };
}

/**
 * Binary frame, little-endian:
 *   0  'PLF1'
 *   4  u32 JSON length J
 *   8  JSON {obsId, size, lambdaUm, bandwidthUm, mjd, upstreamBytes}, padded with spaces to a
 *      multiple of 4
 * 8+J float32 pixels[size*size] (median-subtracted MJy/sr, NaN off-detector; row 0 = south,
 *      column 0 = east), then uint8 flags[size*size] (FlagMask bits).
 */
function encodeFrame(f: NonNullable<Awaited<ReturnType<typeof readPhoto>>>): Uint8Array {
  const size = f.tile.size;
  let json = JSON.stringify({
    obsId: f.photo.obsId,
    size,
    lambdaUm: f.lambdaUm,
    bandwidthUm: f.bandwidthUm,
    mjd: f.mjd,
    upstreamBytes: f.bytes,
  });
  let j = new TextEncoder().encode(json);
  if (j.length % 4) {
    json += ' '.repeat(4 - (j.length % 4));
    j = new TextEncoder().encode(json);
  }
  const n = size * size;
  const out = new Uint8Array(8 + j.length + 4 * n + n);
  const dv = new DataView(out.buffer);
  out.set([0x50, 0x4c, 0x46, 0x31], 0);
  dv.setUint32(4, j.length, true);
  out.set(j, 8);
  new Float32Array(out.buffer, 8 + j.length, n).set(f.tile.pixels);
  out.set(f.tile.flags, 8 + j.length + 4 * n);
  return out;
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return bad('GET only', 405);
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    if (route === '/v1/health') {
      return Response.json(
        {
          ok: true,
          version: VERSION,
          colo: (request as { cf?: { colo?: string } }).cf?.colo ?? null,
        },
        { headers: { ...CORS, 'cache-control': 'no-store' } },
      );
    }
    if (route !== '/v1/frame' && route !== '/v1/probe') return bad('unknown route', 404);

    const key = url.searchParams.get('key') ?? '';
    if (!url.searchParams.has('ra') || !url.searchParams.has('dec'))
      return bad('ra and dec are required');
    const ra = Number(url.searchParams.get('ra'));
    const dec = Number(url.searchParams.get('dec'));
    const size = Math.round(Number(url.searchParams.get('size') ?? 64));
    const scale = Number(Number(url.searchParams.get('scale') ?? 6.15).toFixed(3));
    const mjd = Number(url.searchParams.get('mjd') ?? 0);
    if (!KEY_RE.test(key) || key.split('/').some((s) => s === '.' || s === '..'))
      return bad('key must be a SPHEREx L2 file key (dr1/... or qr3/...)');
    if (!(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) return bad('ra/dec out of range');
    // Caps keep one request's cost bounded. The viewer's widest field today is 16' (160 px at
    // 6.15"); the planned 30' wide view is ~290 px. 320 px leaves room and stays a few hundred
    // rows of one photo.
    if (!(size >= 8 && size <= 320)) return bad('size must be 8..320');
    if (!(scale >= 1 && scale <= 12)) return bad('scale must be 1..12 arcsec');

    // A normalised cache key: same answer for the same rounded request.
    const ck = new URL(`https://cache.planetes/${VERSION}${route}`);
    ck.searchParams.set('key', key);
    ck.searchParams.set('ra', ra.toFixed(6));
    ck.searchParams.set('dec', dec.toFixed(6));
    if (route === '/v1/frame') {
      ck.searchParams.set('size', String(size));
      ck.searchParams.set('scale', scale.toFixed(3));
      // mjd is not part of the answer's identity: the frame's time comes from the file header.
    }
    const cacheKey = new Request(ck.toString());
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('x-planetes-cache', 'hit');
      return new Response(hit.body, { status: hit.status, headers: h });
    }

    const t0 = Date.now();
    // Compute exactly what the cache key names (rounded position and scale).
    const centre = { ra: Number(ra.toFixed(6)) % 360, dec: Number(dec.toFixed(6)) };
    const photo = photoOf(key, mjd);
    let res: Response;
    try {
      if (route === '/v1/probe') {
        const p = await probePhoto(photo, centre);
        res = p
          ? Response.json({ x: p.x, y: p.y, lambdaUm: p.lambdaUm, bandwidthUm: p.bandwidthUm })
          : new Response(null, { status: 204 });
      } else {
        const f = await readPhoto(photo, centre, size, scale);
        res = f
          ? new Response(encodeFrame(f), {
              headers: {
                'content-type': 'application/x-planetes-frame',
                'x-planetes-upstream-bytes': String(f.bytes),
              },
            })
          : new Response(null, { status: 204 });
      }
    } catch (e) {
      return bad(`upstream read failed: ${(e as Error).message}`, 502);
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    h.set('cache-control', 'public, max-age=31536000, immutable');
    h.set('x-planetes-ms', String(Date.now() - t0));
    const body = res.status === 204 ? null : await res.arrayBuffer();
    const out = new Response(body, { status: res.status, headers: h });
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    h.set('x-planetes-cache', 'miss');
    return new Response(body, { status: res.status, headers: h });
  },
};
