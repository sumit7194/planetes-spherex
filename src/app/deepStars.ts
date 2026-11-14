/**
 * Which Gaia patches a view needs (src/data/gaiaTiers.ts), and turning a patch's rows into sky
 * marks at today's place. Pure, so it is tested; the page does the fetching.
 */
import { GAIA_TIERS, type GaiaTier } from '../data/gaiaTiers';
import { ang2pixNest } from '../data/healpix';
import type { SkyPosition } from '../data/coords';
import { placeAt } from './searchIndex';

/** Deeper stars only below this field: wider, the Hipparcos stars already reach the eye's depth. */
export const DEEP_MAX_FOV = 25;

/** The faintest magnitude the sky draws at this scale (sky.ts's own rule, without its cap of 8). */
export function depthAt(cssPxPerDeg: number): number {
  return 3.5 + Math.log2(Math.max(0.5, cssPxPerDeg));
}

const RAD = Math.PI / 180;

/** Every NESTED pixel at `order` that a disc of `radius`° about `c` touches, by sampling. */
export function pixelsInDisc(order: number, c: SkyPosition, radius: number): number[] {
  const nside = 2 ** order;
  const edge = 58.6 / nside; // a pixel's size, degrees
  const step = Math.max(edge / 3, radius / 40);
  const out = new Set<number>();
  const r = radius + edge * 0.75;
  for (let y = -r; y <= r + 1e-9; y += step) {
    for (let x = -r; x <= r + 1e-9; x += step) {
      if (x * x + y * y > r * r) continue;
      // Tangent-plane offsets (degrees) back to the sky about c.
      const xi = x * RAD;
      const eta = y * RAD;
      const d0 = c.dec * RAD;
      const rho = Math.hypot(xi, eta);
      const cc = Math.atan(rho);
      const dec =
        rho === 0
          ? d0
          : Math.asin(Math.cos(cc) * Math.sin(d0) + (eta * Math.sin(cc) * Math.cos(d0)) / rho);
      const ra =
        c.ra * RAD +
        Math.atan2(
          xi * Math.sin(cc),
          rho * Math.cos(d0) * Math.cos(cc) - eta * Math.sin(d0) * Math.sin(cc),
        );
      out.add(ang2pixNest(nside, { ra: (((ra / RAD) % 360) + 360) % 360, dec: dec / RAD }));
    }
  }
  return [...out];
}

export interface Patch {
  tier: GaiaTier;
  pix: number;
}

/**
 * The patches a view needs: every tier whose stars the zoom can show (its G range starts above
 * the drawn depth's floor), over a disc that covers the view's corners.
 */
export function patchesForView(view: {
  inside: boolean;
  centre: SkyPosition;
  fov: number;
  cssPxPerDeg: number;
}): Patch[] {
  if (!view.inside || view.fov > DEEP_MAX_FOV) return [];
  const depth = depthAt(view.cssPxPerDeg);
  const radius = 0.75 * view.fov;
  const out: Patch[] = [];
  for (const tier of GAIA_TIERS) {
    if (tier.gLo >= depth) break;
    // Only once the tier's patches are big enough for the view (the disc spans at most ~2.2
    // patch edges), so a tier never asks for more than ~40; deeper tiers are smaller still.
    if (radius > 2.2 * (58.6 / 2 ** tier.order)) break;
    for (const pix of pixelsInDisc(tier.order, view.centre, radius)) out.push({ tier, pix });
  }
  return out;
}

/** A patch row [ra, dec, G, BP−RP, pmRA*, pmDec] at today's place, as a sky mark. */
export function deepMark(
  row: [number, number, number, number | null, number, number],
  year: number,
): [number, number, number, number | null] {
  const [ra, dec, g, bprp, pmra, pmdec] = row;
  const p = placeAt({ ra, dec }, pmra, pmdec, 2016.0, year);
  // B−V for the dot's colour only, from Gaia's BP−RP (a rough linear match for normal stars).
  const bv = bprp === null ? null : Math.max(-0.3, Math.min(2.2, (bprp - 0.1) / 1.1));
  return [p.ra, p.dec, g, bv];
}
