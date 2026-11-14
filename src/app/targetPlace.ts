/**
 * Where the catalogue puts a wanderer at any photo's time (14 Nov, for the "what changed" film):
 * Physics' overlay files give its place at each pass's mean photo time (proper motion only, no
 * parallax), so between and beyond those, a straight line through the two nearest passes.
 * Offsets in pack pixels from the grid centre, east and north positive.
 */

export interface PassPlaces {
  /** Each pass's mean photo time (MJD), by pass number. */
  seasonMjd: Record<string, number>;
  /** [ra, dec, east″, north″] at each pass, by pass number. */
  atSeason: Record<string, [number, number, number, number]>;
}

export function targetPlaceAt(
  p: PassPlaces,
  mjd: number,
  scaleArcsec: number,
): { east: number; north: number } | null {
  const pts = Object.entries(p.atSeason)
    .flatMap(([s, v]) => {
      const t = p.seasonMjd[s];
      return t === undefined ? [] : [{ t, e: v[2], n: v[3] }];
    })
    .sort((a, b) => a.t - b.t);
  const first = pts[0];
  if (!first) return null;
  if (pts.length === 1) return { east: first.e / scaleArcsec, north: first.n / scaleArcsec };
  // The two passes around this time, or the nearest two at either end.
  const after = pts.findIndex((q) => q.t >= mjd);
  const j = after === -1 ? pts.length - 1 : Math.max(1, after);
  const a = pts[j - 1] ?? first;
  const b = pts[j] ?? first;
  const u = b.t === a.t ? 0 : (mjd - a.t) / (b.t - a.t);
  return {
    east: (a.e + u * (b.e - a.e)) / scaleArcsec,
    north: (a.n + u * (b.n - a.n)) / scaleArcsec,
  };
}
