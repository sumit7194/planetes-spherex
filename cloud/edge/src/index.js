/**
 * planetes-edge: the front door near the visitor. Cache hits are answered here (~tens of ms
 * from India instead of ~0.6 s from Atlanta); misses go to planetes-live, which runs next to
 * NASA's bucket, over a service binding (no public internet hop).
 * Routes and answers are planetes-live's (see cloud/live/src/index.ts).
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'x-planetes-cache, x-planetes-ms, x-planetes-upstream-bytes, x-planetes-edge',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.startsWith('/v1/')) {
      return Response.json({ error: 'GET /v1/... only' }, { status: 404, headers: CORS });
    }
    const colo = request.cf?.colo ?? '';
    const cacheable = ['/v1/frame', '/v1/probe', '/v1/gaia', '/v1/native'].includes(url.pathname);
    const cache = caches.default;
    const key = new Request(url.toString());
    if (cacheable) {
      const hit = await cache.match(key);
      if (hit) {
        const h = new Headers(hit.headers);
        h.set('x-planetes-edge', `hit ${colo}`);
        return new Response(hit.body, { status: hit.status, headers: h });
      }
    }
    const res = await env.LIVE.fetch(new Request(url.toString(), { headers: request.headers }));
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    h.set('x-planetes-edge', `miss ${colo}`);
    const body = res.status === 204 ? null : await res.arrayBuffer();
    if (
      cacheable &&
      (res.status === 200 || res.status === 204) &&
      h.get('cache-control')?.includes('public')
    ) {
      ctx.waitUntil(cache.put(key, new Response(body, { status: res.status, headers: h })));
    }
    return new Response(body, { status: res.status, headers: h });
  },
};
