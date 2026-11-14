/**
 * How much the device can draw, measured, not guessed (Neural, 29 Oct). Probes such as core
 * counts or memory only rule a tier out; the reliable signal is how long frames actually take,
 * watched continuously, because phones slow down with heat after minutes, not seconds.
 *
 * Drop a tier when the slowest tenth of frames runs over 20 ms for 2 s; raise one only after
 * 10 s of keeping up with the display (the slowest tenth within 15% of its own frame interval:
 * a 60 Hz screen never gives frames under 16.7 ms, so a fixed "under 12 ms" could never be
 * met there); at most one change per 10 s; after two drops, stop climbing back (no
 * flip-flopping); nothing measured while the tab is hidden. Start in the middle.
 *
 * Frame intervals can't show headroom (at 60 Hz, 2 ms of work and 15 ms both read 16.7 ms),
 * so when the drawing work is measured too, raising also needs today's work plus the next
 * tier's extra cost under 80% of the interval (Neural). Dropping still goes by the intervals: they are what the visitor sees.
 */

export interface QualityRules {
  min: number;
  max: number;
  start: number;
}

/**
 * What each tier adds to a frame's drawing work, ms (measured on a laptop, 29 Oct: the 3D
 * scene's render and submission ~3 ms; tier 1's glow and stars over tier 0's ~1 ms).
 */
const TIER_EXTRA_MS: Record<number, number> = { 1: 1, 2: 3 };

/** A percentile (0–1) of a list of frame times, ms. */
function percentile(samples: number[], q: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

/** The 90th percentile of a list of frame times, ms. */
export function p90(samples: number[]): number {
  return percentile(samples, 0.9);
}

/**
 * The decision, apart from the clock and the browser so it can be tested: given the frame
 * times of the last window and when the tier last changed, the tier to use now.
 */
export function nextTier(
  tier: number,
  window: { slow: number[]; calm: number[]; work?: number[]; refresh?: number },
  sinceChangeMs: number,
  rules: QualityRules,
): number {
  if (sinceChangeMs < 10_000) return tier;
  // The display's own frame interval: the quickest frames it gives (16.7 ms at 60 Hz, 33 ms
  // for Safari in Low Power Mode), best remembered over the session by the caller.
  const refresh = window.refresh ?? Math.max(4, percentile(window.calm, 0.1));
  // The budget is a frame at 60 fps, or the display's own interval if slower: a 120 Hz screen
  // drawn at 60 fps is still smooth, so it mustn't demand twice as much (Safari on ProMotion).
  const budget = Math.max(refresh, 1000 / 60);
  const work = window.work ?? [];
  // Dropping helps only if our drawing is the cause: its measured work near the frame budget,
  // or (in the 3D tier, whose GPU cost the CPU timing can't see) most frames missed. Frames
  // the browser skips while our work is light (compositing, a debugger, other tabs) are not
  // cured by drawing less, so they never drop a tier.
  const slow =
    window.slow.length >= 30 &&
    (work.length
      ? p90(work.slice(-120)) > budget * 0.9 ||
        (tier >= 2 && percentile(window.slow, 0.5) > budget * 1.5)
      : p90(window.slow) > 20);
  if (slow && tier > rules.min) return tier - 1;
  // Keeping up: at least half the frames on time (the browser's own skips aside); if the next
  // tier then misses most frames, the rule above takes it back down.
  // (Without work timing, the slowest tenth must keep up, as before.)
  const keepsUp = percentile(window.calm, work.length ? 0.5 : 0.9) < Math.min(20, budget * 1.15);
  // Room for the next tier: today's work plus what that tier adds, under 80% of the interval
  // (Neural): 13.4 ms at 60 Hz and on faster displays, more on slower ones.
  const extra = TIER_EXTRA_MS[tier + 1] ?? 3;
  const headroom = !window.work?.length || p90(window.work) + extra < budget * 0.8;
  if (window.calm.length >= 300 && keepsUp && headroom && tier < rules.max) return tier + 1;
  return tier;
}

/** Starts watching frames; calls `onChange` whenever the tier moves. Returns a stop function. */
export function watchQuality(
  rules: QualityRules,
  onChange: (tier: number) => void,
  work?: () => number[],
): () => void {
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
    true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tier = saveData || reduced ? rules.min : rules.start;
  onChange(tier);
  const frames: { at: number; dt: number }[] = [];
  let last = 0;
  let changedAt = performance.now();
  let drops = 0;
  /** The quickest frame interval seen: the display's real rate. */
  let best = Infinity;
  let ceiling = rules.max;
  let raf = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (document.hidden) {
      last = 0;
      return;
    }
    // Long gaps (a tab switch, a debugger) aren't frames.
    if (last && now - last < 250) frames.push({ at: now, dt: now - last });
    last = now;
    while (frames.length && (frames[0]?.at ?? now) < now - 10_000) frames.shift();
    const slow = frames.filter((f) => f.at > now - 2_000).map((f) => f.dt);
    const calm = frames.map((f) => f.dt);
    if (calm.length >= 120) best = Math.min(best, Math.max(4, percentile(calm, 0.1)));
    const next = nextTier(
      tier,
      {
        slow,
        calm,
        ...(work ? { work: work().slice(-600) } : {}),
        ...(Number.isFinite(best) ? { refresh: best } : {}),
      },
      now - changedAt,
      { ...rules, max: ceiling },
    );
    if (next !== tier) {
      if (next < tier && ++drops >= 2) ceiling = next;
      tier = next;
      changedAt = now;
      frames.length = 0;
      onChange(tier);
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Whether this browser can run the 3D tier at all: WebGL2, and a screen wider than a phone's. */
export function canRun3D(): boolean {
  if (Math.min(window.innerWidth, window.innerHeight) < 600) return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}
