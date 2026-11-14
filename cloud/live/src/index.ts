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
 *   GET /v1/native?key=&ra=&dec=[&half=20][&extra=1]
 *       (extra=1: also VARIANCE and ZODI for the box, the primary and FLAGS headers, and the EPSF
 *        header's sha256: a 'PLN2' answer; for fake-mover injection)
 *   GET /v1/psf?key=   -> the file's EPSF extension exactly as stored (header + data, ~4 MB) after a
 *        'PLP1' JSON head {headerSha256, version}: one per detector and pipeline version (Physics,
 *        14 Nov: identical across exposures and across DR1/QR3), checked per photo by its hash.
 *       -> binary native box (see encodeNative): the detector's own pixels, full flag words,
 *          the IMAGE header and the wavelength; for pipeline jobs (pipeline/helper_client.py).
 *   GET /v1/gaia?ra=&dec=&r=         -> JSON {stars: [{id, ra, dec, pmra, pmdec, g}], epoch: 2016}:
 *                                       Gaia DR3 within r arcsec (<= 120), G < 21, from ESA's
 *                                       archive (browsers can't query it: no CORS). Cached 30 days.
 *   GET /v1/gaiapatch?order=&pix=    -> JSON {order, pix, gLo, gHi, epoch: 2016, stars: [[ra, dec, g,
 *                                       bp_rp|null, pmra, pmdec], ...]}: Gaia DR3 in one HEALPix
 *                                       NESTED patch, in that order's G range (src/data/gaiaTiers),
 *                                       brightest first, at most GAIA_PATCH_MAX. Cached 30 days.
 *   GET /v1/catwise?ra=&dec=&r=      -> JSON {stars: [{id, ra, dec, pmra, pmdec, w1, w2}], epochMjd:
 *                                       57170}: CatWISE2020 within r arcsec (<= 150), from IRSA's TAP
 *                                       (motions converted to mas/yr). Cached 30 days.
 *   GET /v1/resolve?name=            -> JSON {found, name, type, ra, dec, epoch: 2000, pmra, pmdec,
 *                                       plx, spType}: SIMBAD via CDS Sesame (the search box's names
 *                                       beyond its own index; browsers get no CORS through CDS's
 *                                       mirror redirect). Cached 30 days.
 *   GET /v1/health                   -> JSON {ok, version, colo}; colo is where the request
 *                                       entered Cloudflare. Where the code ran shows in the
 *                                       cf-placement response header (e.g. remote-ATL).
 *
 * Answers are cached (Cache API, one year): SPHEREx files are immutable; a reprocessing gets
 * a new file name and so a new cache key. Positions are rounded to 1e-6 deg in the key.
 */
import { GAIA_PATCH_MAX, GAIA_TIERS, sourceIdRange, tierOf } from '../../../src/data/gaiaTiers';
import {
  probePhoto,
  READER_VERSION,
  readNative,
  readPhoto,
  readPsf,
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
  const x = b.extra;
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
    ...(x
      ? {
          primaryHeader: x.primaryHeader,
          flagsHeader: x.flagsHeader,
          psfHeaderSha256: x.psfHeaderSha256,
        }
      : {}),
  });
  let j = new TextEncoder().encode(json);
  if (j.length % 4) {
    json += ' '.repeat(4 - (j.length % 4));
    j = new TextEncoder().encode(json);
  }
  const n = b.w * b.h;
  // PLN2 adds float32 variance[w*h] and zodi[w*h] after the flags.
  const out = new Uint8Array(8 + j.length + (x ? 16 : 8) * n);
  const dv = new DataView(out.buffer);
  out.set([0x50, 0x4c, 0x4e, x ? 0x32 : 0x31], 0);
  dv.setUint32(4, j.length, true);
  out.set(j, 8);
  new Float32Array(out.buffer, 8 + j.length, n).set(b.image);
  new Int32Array(out.buffer, 8 + j.length + 4 * n, n).set(b.flags);
  if (x) {
    new Float32Array(out.buffer, 8 + j.length + 8 * n, n).set(x.variance);
    new Float32Array(out.buffer, 8 + j.length + 12 * n, n).set(x.zodi);
  }
  return out;
}

const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';

/**
 * Gaia DR3 in one sky patch, for the sky's fainter stars when zoomed in (src/data/gaiaTiers.ts).
 * A source_id range (Gaia's ids carry their HEALPix level-12 cell), so ESA answers from its
 * primary key; the order fixes the G range, so the URL alone names the answer.
 */
async function gaiaPatch(url: URL, ctx: ExecutionContext): Promise<Response> {
  const order = Number(url.searchParams.get('order'));
  const pix = Number(url.searchParams.get('pix'));
  const tier = tierOf(order);
  if (!tier) return bad(`order must be one of ${GAIA_TIERS.map((t) => t.order).join(', ')}`);
  if (!(Number.isInteger(pix) && pix >= 0 && pix < 12 * 4 ** order)) return bad('pix out of range');
  const cacheKey = new Request(
    `https://cache.planetes/${VERSION}/v1/gaiapatch?order=${order}&pix=${pix}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-planetes-cache', 'hit');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const [lo, hi] = sourceIdRange(order, pix);
  const adql =
    `SELECT TOP ${GAIA_PATCH_MAX} ra, dec, phot_g_mean_mag, bp_rp, pmra, pmdec FROM gaiadr3.gaia_source ` +
    `WHERE source_id BETWEEN ${lo} AND ${hi} ` +
    `AND phot_g_mean_mag >= ${tier.gLo} AND phot_g_mean_mag < ${tier.gHi} ORDER BY phot_g_mean_mag`;
  const q = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: adql });
  const t0 = Date.now();
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${GAIA_TAP}?${q}`, {
        headers: { 'user-agent': 'planetes-live/1 (Space Apps 2026 helper)' },
        signal: AbortSignal.timeout(20_000),
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
  const names = ['ra', 'dec', 'phot_g_mean_mag', 'bp_rp', 'pmra', 'pmdec'];
  const at = names.map((n) => head.indexOf(n));
  if (at.some((c) => c < 0)) return bad('Gaia answer had unexpected columns', 502);
  const rows = lines.filter((l) => l.length);
  if (rows.some((l) => l.split(',').length !== head.length))
    return bad('Gaia answer was incomplete', 502);
  const round = (v: string | undefined, d: number) =>
    v === undefined || v === '' ? null : Number(Number(v).toFixed(d));
  const stars = rows.map((l) => {
    const f = l.split(',');
    const [ra, dec, g, bprp, pmra, pmdec] = at.map((c) => f[c]);
    return [
      round(ra, 6),
      round(dec, 6),
      round(g, 2),
      round(bprp, 2),
      round(pmra, 1) ?? 0,
      round(pmdec, 1) ?? 0,
    ];
  });
  const body = JSON.stringify({
    catalog: 'Gaia DR3',
    epoch: 2016.0,
    order,
    pix,
    gLo: tier.gLo,
    gHi: tier.gHi,
    capped: rows.length >= GAIA_PATCH_MAX,
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

const IRSA_TAP = 'https://irsa.ipac.caltech.edu/TAP/sync';

/**
 * CatWISE2020 near a position, for "What's at this spot?" (D9): positions at MJD 57170 (2015.4),
 * motions in mas/yr. From IRSA's TAP (browsers can't query it: no CORS). Cached 30 days.
 */
async function catwise(url: URL, ctx: ExecutionContext): Promise<Response> {
  const ra = Number(Number(url.searchParams.get('ra')).toFixed(5)) % 360;
  const dec = Number(Number(url.searchParams.get('dec')).toFixed(5));
  const r = Math.round(Number(url.searchParams.get('r') ?? 60));
  if (!(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) return bad('ra/dec out of range');
  if (!(r >= 1 && r <= 150)) return bad('r must be 1..150 arcsec');
  const cacheKey = new Request(
    `https://cache.planetes/${VERSION}/v1/catwise?ra=${ra}&dec=${dec}&r=${r}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-planetes-cache', 'hit');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const adql =
    'SELECT source_name, ra_pm, dec_pm, pmra, pmdec, w1mpro_pm, w2mpro_pm FROM catwise_2020 ' +
    `WHERE CONTAINS(POINT('ICRS', ra_pm, dec_pm), CIRCLE('ICRS', ${ra}, ${dec}, ${r / 3600}))=1`;
  const q = new URLSearchParams({ QUERY: adql, FORMAT: 'csv' });
  const t0 = Date.now();
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${IRSA_TAP}?${q}`, {
        headers: { 'user-agent': 'planetes-live/1 (Space Apps 2026 helper)' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      if (attempt === 1) return bad(`CatWISE query failed: ${(e as Error).message}`, 502);
      continue;
    }
    if (res.ok) {
      text = await res.text();
      break;
    }
    if (res.status < 500 || attempt === 1) return bad(`IRSA HTTP ${res.status}`, 502);
  }
  const lines = text.trim().split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',');
  const names = ['source_name', 'ra_pm', 'dec_pm', 'pmra', 'pmdec', 'w1mpro_pm', 'w2mpro_pm'];
  const at = names.map((n) => head.indexOf(n));
  if (at.some((c) => c < 0)) return bad('CatWISE answer had unexpected columns', 502);
  const rows = lines.filter((l) => l.length);
  if (rows.some((l) => l.split(',').length !== head.length))
    return bad('CatWISE answer was incomplete', 502);
  const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
  const stars = rows.map((l) => {
    const f = l.split(',');
    const [id, ra2, dec2, pmra, pmdec, w1, w2] = at.map((c) => f[c]);
    return {
      id: (id ?? '').replace(/"/g, '').trim(),
      ra: num(ra2),
      dec: num(dec2),
      // IRSA gives arcsec/yr; sent as mas/yr, as the Gaia route does.
      pmra: (num(pmra) ?? 0) * 1000,
      pmdec: (num(pmdec) ?? 0) * 1000,
      w1: num(w1),
      w2: num(w2),
    };
  });
  const body = JSON.stringify({
    catalog: 'CatWISE2020',
    epochMjd: 57170,
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
    // c=2: answers carry BP−RP (Physics' colour guard, 15 Nov); older cached answers don't.
    `https://cache.planetes/${VERSION}/v1/gaia?ra=${ra}&dec=${dec}&r=${r}&c=2`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-planetes-cache', 'hit');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const adql =
    'SELECT source_id, ra, dec, pmra, pmdec, phot_g_mean_mag, bp_rp FROM gaiadr3.gaia_source ' +
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
  const names = ['source_id', 'ra', 'dec', 'pmra', 'pmdec', 'phot_g_mean_mag', 'bp_rp'] as const;
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
      bpRp: num(f[at.bp_rp]),
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

// CDS first; its redirect target fails TLS from Cloudflare (HTTP 525, 14 Nov), so Harvard's
// VizieR mirror of the same service is the fallback.
const SESAME = [
  'https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?',
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?',
];

/** A name resolved by SIMBAD (CDS Sesame): its J2000 place and, when known, its proper motion. */
async function resolve(url: URL, ctx: ExecutionContext): Promise<Response> {
  const raw = (url.searchParams.get('name') ?? '').trim().replace(/\s+/g, ' ');
  if (!raw || raw.length > 80 || !/^[\p{L}\p{N} +\-.'’*()_/]+$/u.test(raw))
    return bad("name: 1-80 letters, digits, spaces and + - . ' * ( ) _ /");
  const cacheKey = new Request(
    `https://cache.planetes/${VERSION}/v1/resolve2?name=${encodeURIComponent(raw.toLowerCase())}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-planetes-cache', 'hit');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const t0 = Date.now();
  let xml = '';
  let last = '';
  for (const base of SESAME) {
    try {
      const res = await fetch(base + encodeURIComponent(raw), {
        headers: { 'user-agent': 'planetes-live/1 (Space Apps 2026 helper)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5_000),
      });
      const text = res.ok ? await res.text() : '';
      if (res.ok && text.includes('<Sesame')) {
        xml = text;
        break;
      }
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  if (!xml) return bad(`SIMBAD lookup failed: ${last}`, 502);
  const block = /<Resolver[^>]*>([\s\S]*?)<\/Resolver>/.exec(xml)?.[1] ?? '';
  const tag = (name: string, inside = block) =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(inside)?.[1]?.trim() ?? null;
  const ra = Number(tag('jradeg'));
  const dec = Number(tag('jdedeg'));
  const pm = /<pm>([\s\S]*?)<\/pm>/.exec(block)?.[1] ?? '';
  const plx = /<plx>([\s\S]*?)<\/plx>/.exec(block)?.[1] ?? '';
  const num = (v: string | null) =>
    v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const found = Number.isFinite(ra) && Number.isFinite(dec) && tag('jradeg') !== null;
  const body = JSON.stringify(
    found
      ? {
          found: true,
          query: raw,
          name: (tag('oname') ?? raw).replace(/^(NAME|V\*|\*\*?)\s+/, '').replace(/\s+/g, ' '),
          type: tag('otype'),
          ra,
          dec,
          epoch: 2000,
          pmra: num(tag('pmRA', pm)),
          pmdec: num(tag('pmDE', pm)),
          plx: num(tag('v', plx)),
          spType: tag('spType'),
          source: 'SIMBAD (CDS Sesame)',
        }
      : { found: false, query: raw, source: 'SIMBAD (CDS Sesame)' },
  );
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

/** One file's EPSF extension, as stored; cached a year (files never change). */
async function psf(url: URL, ctx: ExecutionContext): Promise<Response> {
  const key = url.searchParams.get('key') ?? '';
  if (!KEY_RE.test(key) || key.split('/').some((s) => s === '.' || s === '..'))
    return bad('key must be a SPHEREx L2 file key (dr1/... or qr3/...)');
  const cacheKey = new Request(
    `https://cache.planetes/${VERSION}/v1/psf?key=${encodeURIComponent(key)}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-planetes-cache', 'hit');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const t0 = Date.now();
  let p: Awaited<ReturnType<typeof readPsf>>;
  try {
    p = await readPsf(photoOf(key, 0));
  } catch (e) {
    return bad(`upstream read failed: ${(e as Error).message}`, 502);
  }
  let json = JSON.stringify({
    headerSha256: p.headerSha256,
    version: p.version,
    bytes: p.bytes.length,
  });
  let j = new TextEncoder().encode(json);
  if (j.length % 4) {
    json += ' '.repeat(4 - (j.length % 4));
    j = new TextEncoder().encode(json);
  }
  const out = new Uint8Array(8 + j.length + p.bytes.length);
  out.set([0x50, 0x4c, 0x50, 0x31], 0);
  new DataView(out.buffer).setUint32(4, j.length, true);
  out.set(j, 8);
  out.set(p.bytes, 8 + j.length);
  const h = new Headers({
    ...CORS,
    'content-type': 'application/x-planetes-psf',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-planetes-ms': String(Date.now() - t0),
  });
  ctx.waitUntil(cache.put(cacheKey, new Response(out, { headers: h })));
  h.set('x-planetes-cache', 'miss');
  return new Response(out, { headers: h });
}

/** The R2 bucket the helper keeps its answers in (Sumit enabled R2, 15 Nov). Typed minimally. */
interface R2Like {
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    opts: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> },
  ): Promise<unknown>;
}
interface Env {
  FRAMES?: R2Like;
}

/**
 * Answers made from NASA's files, which never change (each reprocessing gets a new file name):
 * kept in R2 for good, so a frame is built from the bucket once, ever. The edge and the Workers
 * cache stay in front; catalogue answers (Gaia, CatWISE, names) only use the expiring cache.
 */
const KEEP = new Set(['/v1/frame', '/v1/probe', '/v1/native', '/v1/psf']);
/** Headers kept with a stored answer (the rest are rebuilt). */
const KEPT_HEADERS = ['cache-control', 'x-planetes-ms', 'x-planetes-upstream-bytes'];

/**
 * The stored answer's name: only the parameters the answer depends on, rounded as the Workers
 * cache key is, so extra or reshuffled parameters can't create new stored copies (security
 * review, 15 Nov). Null when the request isn't valid; it then isn't stored (handle() refuses it).
 */
function storeKey(route: string, url: URL): string | null {
  const p = url.searchParams;
  const key = p.get('key') ?? '';
  if (!KEY_RE.test(key) || key.split('/').some((s) => s === '.' || s === '..')) return null;
  const q = new URLSearchParams({ key });
  if (route !== '/v1/psf') {
    const ra = Number(p.get('ra'));
    const dec = Number(p.get('dec'));
    if (!p.has('ra') || !p.has('dec') || !Number.isFinite(ra) || !Number.isFinite(dec)) return null;
    q.set('ra', ra.toFixed(6));
    q.set('dec', dec.toFixed(6));
  }
  if (route === '/v1/native') {
    q.set('half', String(Math.round(Number(p.get('half') ?? 20))));
    if (p.get('extra') === '1') q.set('extra', '1');
  }
  if (route === '/v1/frame') {
    q.set('size', String(Math.round(Number(p.get('size') ?? 64))));
    q.set('scale', Number(Number(p.get('scale') ?? 6.15).toFixed(3)).toFixed(3));
  }
  return `${VERSION}${route}?${q.toString()}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    if (request.method !== 'GET' || !env.FRAMES || !KEEP.has(route)) return handle(request, ctx);
    const key = storeKey(route, url);
    if (!key) return handle(request, ctx);
    try {
      const obj = await env.FRAMES.get(key);
      if (obj) {
        const h = new Headers({ ...CORS, ...(obj.customMetadata ?? {}) });
        h.set('content-type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
        h.set('x-planetes-cache', 'store');
        return new Response(obj.body, { headers: h });
      }
    } catch {
      /* the store is a speed-up only: on any trouble, build the answer as before */
    }
    const res = await handle(request, ctx);
    if (res.status !== 200 || !res.headers.get('cache-control')?.includes('public')) return res;
    const buf = await res.arrayBuffer();
    const meta: Record<string, string> = {};
    for (const k of KEPT_HEADERS) {
      const v = res.headers.get(k);
      if (v) meta[k] = v;
    }
    ctx.waitUntil(
      env.FRAMES.put(key, buf, {
        httpMetadata: {
          contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        },
        customMetadata: meta,
      }).catch(() => undefined),
    );
    return new Response(buf, { status: res.status, headers: res.headers });
  },
};

async function handle(request: Request, ctx: ExecutionContext): Promise<Response> {
  {
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
    if (route === '/v1/gaiapatch') return gaiaPatch(url, ctx);
    if (route === '/v1/catwise') return catwise(url, ctx);
    if (route === '/v1/resolve') return resolve(url, ctx);
    if (route === '/v1/psf') return psf(url, ctx);
    if (route !== '/v1/frame' && route !== '/v1/probe' && route !== '/v1/native')
      return bad('unknown route', 404);

    const key = url.searchParams.get('key') ?? '';
    if (!url.searchParams.has('ra') || !url.searchParams.has('dec'))
      return bad('ra and dec are required');
    const ra = Number(url.searchParams.get('ra'));
    const dec = Number(url.searchParams.get('dec'));
    const size = Math.round(Number(url.searchParams.get('size') ?? 64));
    const scale = Number(Number(url.searchParams.get('scale') ?? 6.15).toFixed(3));
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
    const extra = url.searchParams.get('extra') === '1';
    if (route === '/v1/native') {
      ck.searchParams.set('half', String(half));
      if (extra) ck.searchParams.set('extra', '1');
    }
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
    // The date comes only from the file's header (MJD-AVG), never the request: a caller's mjd
    // must not end up in a stored answer (security review, 15 Nov).
    const photo = photoOf(key, 0);
    let res: Response;
    try {
      if (route === '/v1/native') {
        const b = await readNative(photo, centre, half, undefined, extra);
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
  }
}
