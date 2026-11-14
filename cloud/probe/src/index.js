// Planetes probe: time small byte-range reads of a SPHEREx file from inside Cloudflare.
// GET /?n=10  -> JSON with per-read times, the Cloudflare data centre this ran in (colo),
// and whether Smart Placement has moved the Worker yet (cf-placement header on the response).
const FILE =
  'https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2025W19_1B/l2b-v27-2026-197/3/level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const n = Math.min(20, Math.max(1, Number(url.searchParams.get('n')) || 10));
    const times = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2880;
      const t0 = Date.now();
      const r = await fetch(FILE, { headers: { Range: `bytes=${a}-${a + 2879}` } });
      await r.arrayBuffer();
      times.push({ status: r.status, ms: Date.now() - t0 });
    }
    const ms = times.map((t) => t.ms).sort((x, y) => x - y);
    return Response.json(
      {
        colo: request.cf?.colo ?? null, // where this request entered Cloudflare
        reads: times,
        medianMs: ms[ms.length >> 1],
        note: 'Date.now() only advances on I/O in Workers, so these are wall times of the reads.',
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  },
};
