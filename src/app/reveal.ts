/**
 * The reveal: hard cuts between two season pictures while the measured arrow grows with
 * the cuts. It starts at true size (tiny, which is the honest point), then enlarges to
 * `enlarge` with a visible label. Hard cuts only, under 2 Hz, never a fade.
 */

import type { LensView } from '../render/lens';

export interface RevealOptions {
  cutMs: number;
  cycles: number;
  /** Final drawing scale of the arrows. */
  enlarge: number;
  /** Cuts spent at true size before growing. */
  trueScaleCuts: number;
  onStep?: (step: { season: 0 | 1; arrowScale: number; cut: number; of: number }) => void;
  onDone?: () => void;
}

export const DEFAULT_REVEAL: Omit<RevealOptions, 'onStep' | 'onDone'> = {
  cutMs: 800,
  cycles: 3,
  enlarge: 8,
  trueScaleCuts: 2,
};

/** Arrow scale and progress after `cut` of `total` cuts. */
export function arrowAt(cut: number, total: number, enlarge: number, trueScaleCuts: number) {
  const progress = Math.min(1, cut / total);
  if (cut <= trueScaleCuts) return { scale: 1, progress };
  const t = (cut - trueScaleCuts) / Math.max(1, total - trueScaleCuts);
  return { scale: 1 + (enlarge - 1) * Math.min(1, t), progress };
}

/** Plays the reveal; returns a function that stops it. */
export function playReveal(lens: LensView, options: Partial<RevealOptions> = {}): () => void {
  const o = { ...DEFAULT_REVEAL, ...options };
  const total = o.cycles * 2;
  let cut = 0;
  lens.show(0);
  lens.setOverlay({ arrowScale: 1, arrowProgress: 0 });
  const timer = window.setInterval(() => {
    cut += 1;
    const season = (cut % 2) as 0 | 1;
    const { scale, progress } = arrowAt(cut, total, o.enlarge, o.trueScaleCuts);
    lens.show(season);
    lens.setOverlay({ arrowScale: scale, arrowProgress: progress });
    o.onStep?.({ season, arrowScale: scale, cut, of: total });
    if (cut >= total) {
      window.clearInterval(timer);
      // End on the later season with the whole arrow, and say so.
      lens.show(1);
      o.onStep?.({ season: 1, arrowScale: o.enlarge, cut, of: total });
      o.onDone?.();
    }
  }, o.cutMs);
  return () => window.clearInterval(timer);
}

/** The reduced-motion version: no autoplay, everything drawn complete. */
export function showRevealStill(lens: LensView, enlarge = DEFAULT_REVEAL.enlarge): void {
  lens.show(1);
  lens.setOverlay({ arrowScale: enlarge, arrowProgress: 1 });
}

/**
 * A live look's flipbook: hard cuts through `count` photos in order, `cycles` times, ending
 * on the last. Same rules as the reveal: hard cuts only, under 2 Hz, no arrow.
 */
export function playFlipbook(
  lens: LensView,
  count: number,
  o: {
    cutMs?: number;
    cycles?: number;
    onStep?: (index: number) => void;
    onDone?: () => void;
  } = {},
): () => void {
  const cutMs = o.cutMs ?? DEFAULT_REVEAL.cutMs;
  const total = Math.max(1, count) * (o.cycles ?? 2);
  let cut = 0;
  lens.show(0);
  o.onStep?.(0);
  const timer = window.setInterval(() => {
    cut += 1;
    const index = cut >= total - 1 ? count - 1 : cut % count;
    lens.show(index);
    o.onStep?.(index);
    if (cut >= total - 1) {
      window.clearInterval(timer);
      o.onDone?.();
    }
  }, cutMs);
  return () => window.clearInterval(timer);
}
