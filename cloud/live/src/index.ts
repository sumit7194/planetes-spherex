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
 *   GET /v1/native?key=&ra=&dec=[&half=20]
 *       -> binary native box (see encodeNative): the detector's own pixels, full flag words,
 *          the IMAGE header and the wavelength; for pipeline jobs (pipeline/helper_client.py).
 *   GET /v1/gaia?ra=&dec=&r=         -> JSON {stars: [{id, ra, dec, pmra, pmdec, g}], epoch: 2016}:
 *                                       Gaia DR3 within r arcsec (<= 120), G < 21, from ESA's
 *                                       archive (browsers can't query it: no CORS). Cached 30 days.
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
  readNative,
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

/**
 * Native box, little-endian:
 *   0  'PLN1'
 *   4  u32 JSON length J
 *   8  JSON {obsId, x0, y0, w, h, xt, yt, lambdaUm, bandwidthUm, mjd, bits, header,
 *      upstreamBytes}, padded with spaces to a multiple of 4
 * 8+J float32 image[w*h] (row 0 = y0, as stored, MJy/sr), then int32 flags[w*h].
 */
function encodeNative(b: NonNullable<Awaited<ReturnType<typeof readNative>>>): Uint8Array {
  let json = JSON.stringify({
    obsId: b.obsId,
    x0: b.x0,
    y0: b.y0,
    w: b.w,
    h: b.h,
    xt: b.xt,
    yt: b.yt,
    lambdaUm: b.lambdaUm,
    bandwidthUm: b.bandwidthUm,
    mjd: b.mjd,
    bits: b.bits,
    header: b.header,
    upstreamBytes: b.bytes,
  });
  let j = new TextEncoder().encode(json);
  if (j.length % 4) {
    json += ' '.repeat(4 - (j.length % 4));
    j = new TextEncoder().encode(json);
  }
  const n = b.w * b.h;
  const out = new Uint8Array(8 + j.length + 8 * n);
  const dv = new DataView(out.buffer);
  out.set([0x50, 0x4c, 0x4e, 0x31], 0);
  dv.setUint32(4, j.length, true);
  out.set(j, 8);
  new Float32Array(out.buffer, 8 + j.length, n).set(b.image);
  new Int32Array(out.buffer, 8 + j.length + 4 * n, n).set(b.flags);
  return out;
}

const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';

/** Gaia DR3 stars near a position (positions at epoch 2016.0, motions in mas/yr). */
async function gaia(url: URL, ctx: ExecutionContext): Promise<Response> {
  if (!url.searchParams.get('ra') || !url.searchParams.get('dec'))
    return bad('ra and dec are required');
  const ra = Number(Number(url.searchParams.get('ra')).toFixed(5)) % 360;
  const dec = Number(Number(url.searchParams.get('dec')).toFixed(5));
  const r = Math.round(Number(url.searchParams.get('r') ?? 30));
  if (!(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) return bad('ra/dec out of range');
  if (!(r >= 1 && r <= 120)) return bad('r must be 1..120 arcsec');
  const cacheKey = new Request(
    `https://cache.planetes/${VERSION}/v1/gaia?ra=${ra}&dec=${dec}&r=${r}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-planetes-cache', 'hit');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const adql =
    'SELECT source_id, ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source ' +
    `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r / 3600}))=1 ` +
    'AND phot_g_mean_mag < 21';
  const q = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: adql });
  const t0 = Date.now();
  let text = '';
  // Two tries, the second only after a network error or a 5xx from the archive.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${GAIA_TAP}?${q}`, {
        headers: { 'user-agent': 'planetes-live/1 (Space Apps 2026 helper)' },
        signal: AbortSignal.timeout(11_000),
      });
    } catch (e) {
      if (attempt === 1) return bad(`Gaia query failed: ${(e as Error).message}`, 502);
      continue;
    }
    if (res.ok) {
      text = await res.text();
      break;
    }
    if (res.status < 500 || attempt === 1) return bad(`Gaia archive HTTP ${res.status}`, 502);
  }
  const lines = text.trim().split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',');
  const names = ['source_id', 'ra', 'dec', 'pmra', 'pmdec', 'phot_g_mean_mag'] as const;
  const at = Object.fromEntries(names.map((n) => [n, head.indexOf(n)])) as Record<
    (typeof names)[number],
    number
  >;
  if (Object.values(at).some((c) => c < 0)) return bad('Gaia answer had unexpected columns', 502);
  const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
  const rows = lines.filter((l) => l.length);
  // A cut-off answer must not be cached for a month.
  if (rows.some((l) => l.split(',').length !== head.length))
    return bad('Gaia answer was incomplete', 502);
  const stars = rows.map((l) => {
    const f = l.split(',');
    return {
      id: f[at.source_id] ?? '',
      ra: num(f[at.ra]),
      dec: num(f[at.dec]),
      pmra: num(f[at.pmra]) ?? 0,
      pmdec: num(f[at.pmdec]) ?? 0,
      g: num(f[at.phot_g_mean_mag]),
    };
  });
  const body = JSON.stringify({
    catalog: 'Gaia DR3',
    epoch: 2016.0,
    centre: { ra, dec },
    radiusArcsec: r,
    stars,
  });
  const h = new Headers({
    ...CORS,
    'content-type': 'application/json',
    'cache-control': 'public, max-age=2592000',
    'x-planetes-ms': String(Date.now() - t0),
  });
  ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: h })));
  h.set('x-planetes-cache', 'miss');
  return new Response(body, { headers: h });
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
    if (route === '/v1/gaia') return gaia(url, ctx);
    if (route !== '/v1/frame' && route !== '/v1/probe' && route !== '/v1/native')
      return bad('unknown route', 404);

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
    // A native box is (2 half)^2 detector pixels: 64 half = 128 px (13'), plenty for a field.
    const half = Math.round(Number(url.searchParams.get('half') ?? 20));
    if (!(half >= 4 && half <= 64)) return bad('half must be 4..64');
    if (!(scale >= 1 && scale <= 12)) return bad('scale must be 1..12 arcsec');

    // A normalised cache key: same answer for the same rounded request.
    const ck = new URL(`https://cache.planetes/${VERSION}${route}`);
    ck.searchParams.set('key', key);
    ck.searchParams.set('ra', ra.toFixed(6));
    ck.searchParams.set('dec', dec.toFixed(6));
    if (route === '/v1/native') ck.searchParams.set('half', String(half));
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
      if (route === '/v1/native') {
        const b = await readNative(photo, centre, half);
        res = b
          ? new Response(encodeNative(b), {
              headers: {
                'content-type': 'application/x-planetes-native',
                'x-planetes-upstream-bytes': String(b.bytes),
              },
            })
          : new Response(null, { status: 204 });
      } else if (route === '/v1/probe') {
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
