import { describe, expect, it } from 'vitest';
import { sourceIdRange } from '../data/gaiaTiers';
import { ang2pixNest } from '../data/healpix';
import { deepMark, patchesForView, pixelsInDisc } from './deepStars';

describe('Gaia patches for a view', () => {
  it('wants nothing when wide or not inside', () => {
    expect(
      patchesForView({ inside: true, centre: { ra: 10, dec: 0 }, fov: 40, cssPxPerDeg: 34 }),
    ).toEqual([]);
    expect(
      patchesForView({ inside: false, centre: { ra: 10, dec: 0 }, fov: 2, cssPxPerDeg: 600 }),
    ).toEqual([]);
  });

  it('adds deeper tiers as the zoom deepens, and covers the aim', () => {
    const c = { ra: 266.4, dec: -29 };
    const at = (fov: number) =>
      patchesForView({ inside: true, centre: c, fov, cssPxPerDeg: 1350 / fov });
    const orders = (fov: number) => [...new Set(at(fov).map((p) => p.tier.order))];
    expect(orders(20)).toEqual([3]); // depth ~9.6
    expect(orders(10)).toEqual([3]); // ~10.6, but order 5's patches are still too small
    expect(orders(5)).toEqual([3, 5]); // ~11.6
    expect(orders(1.2)).toEqual([3, 5, 7]); // ~13.6
    expect(orders(0.3)).toEqual([3, 5, 7, 9]); // ~15.6
    expect(orders(0.07)).toEqual([3, 5, 7, 9, 11]); // ~17.7
    for (const fov of [20, 5, 1.2, 0.3, 0.07])
      for (const order of orders(fov))
        expect(
          at(fov).some((p) => p.tier.order === order && p.pix === ang2pixNest(2 ** order, c)),
        ).toBe(true);
  });

  it('keeps the request count small at every tier (about 16, never over 40)', () => {
    const c = { ra: 100, dec: 50 };
    for (const fov of [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05]) {
      const ps = patchesForView({ inside: true, centre: c, fov, cssPxPerDeg: 1350 / fov });
      const per = new Map<number, number>();
      for (const p of ps) per.set(p.tier.order, (per.get(p.tier.order) ?? 0) + 1);
      for (const n of per.values()) expect(n).toBeLessThanOrEqual(40);
    }
  });

  it('covers a disc right through the pole', () => {
    const ps = pixelsInDisc(5, { ra: 0, dec: 89.5 }, 2);
    expect(ps.length).toBeGreaterThan(4);
    expect(ps).toContain(ang2pixNest(32, { ra: 180, dec: 88.5 }));
  });
});

describe('Gaia ids and patches', () => {
  it("a star's source_id lies in its own patch's range (ESA's level-12 encoding)", () => {
    // A real Gaia DR3 star near the Galactic centre and the order-7 patch the archive gave it.
    const id = 4057468321929794432n;
    const lvl12 = id >> 35n;
    const pix7 = Number(lvl12 >> BigInt(2 * (12 - 7)));
    const [lo, hi] = sourceIdRange(7, pix7);
    expect(id >= lo && id <= hi).toBe(true);
  });
});

describe('a patch row as a sky mark', () => {
  it("moves a star from Gaia's 2016 to the given year", () => {
    const [ra, dec, g] = deepMark([266.4, -29, 12, 1.0, 0, -3600], 2017.0);
    expect(ra).toBeCloseTo(266.4, 9);
    expect(dec).toBeCloseTo(-29 - 3.6 / 3600, 9); // 3,600 mas = 3.6″
    expect(g).toBe(12);
  });
});
