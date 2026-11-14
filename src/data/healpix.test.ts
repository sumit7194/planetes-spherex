import { describe, expect, it } from 'vitest';
import { ang2pixNest, npix, pixelCentre, pixelCorners } from './healpix';

describe('HEALPix nested', () => {
  it('counts pixels', () => {
    expect(npix(1)).toBe(12);
    expect(npix(16)).toBe(3072);
  });

  it('places the nside-1 base pixels where the reference does', () => {
    // Reference centres (healpy pix2ang, nest=True, nside=1): θ = 48.19° for the four
    // northern faces at φ = 45°, 135°, 225°, 315°; equatorial faces at θ = 90°.
    const p0 = pixelCentre(1, 0);
    expect(p0.ra).toBeCloseTo(45, 6);
    expect(p0.dec).toBeCloseTo(90 - 48.1897, 3);
    const p4 = pixelCentre(1, 4);
    expect(p4.ra).toBeCloseTo(0, 6);
    expect(p4.dec).toBeCloseTo(0, 6);
    const p8 = pixelCentre(1, 8);
    expect(p8.ra).toBeCloseTo(45, 6);
    expect(p8.dec).toBeCloseTo(-(90 - 48.1897), 3);
  });

  it('gives nside-16 corners that surround the centre', () => {
    for (const pix of [0, 100, 1023, 1500, 2047, 2500, 3071]) {
      const c = pixelCentre(16, pix);
      const corners = pixelCorners(16, pix);
      // Each corner is within one pixel diagonal (about 3.7° at nside 16) of the centre.
      for (const k of corners) {
        const dDec = Math.abs(k.dec - c.dec);
        let dRa = Math.abs(k.ra - c.ra);
        if (dRa > 180) dRa = 360 - dRa;
        const sep = Math.hypot(dRa * Math.cos((c.dec * Math.PI) / 180), dDec);
        expect(sep).toBeLessThan(4);
        expect(sep).toBeGreaterThan(0.5);
      }
      // The north corner is north of the south corner.
      expect(corners[0].dec).toBeGreaterThan(corners[2].dec);
    }
  });

  it('keeps the nside-16 centres it had when Physics cross-checked them', () => {
    // Sent to Physics on 29 Oct 2026 for a check against their HEALPix library; these pin
    // the implementation so a later edit can't move a pixel silently.
    const expected: [number, number, number][] = [
      [0, 45, 2.388],
      [1000, 285, 63.4483],
      [2000, 281.25, 12.0247],
      [3071, 315, -2.388],
      [1500, 101.25, 22.0243],
    ];
    for (const [pix, ra, dec] of expected) {
      const p = pixelCentre(16, pix);
      expect(p.ra).toBeCloseTo(ra, 3);
      expect(p.dec).toBeCloseTo(dec, 3);
    }
  });

  it('finds the pixel holding a position, matching the sky index test vectors', () => {
    // [ra, dec, nside-16 pixel, nside-64 pixel], from Physics' sky index manifest (healpy).
    const vectors: [number, number, number, number][] = [
      [229.30620743572354, 13.342422222573186, 525, 8404],
      [97.12321695499331, -13.452837740144835, 1310, 20971],
      [14.750468617030087, 83.9443343896418, 254, 4073],
      [5.949948790270474, 74.08523471618474, 238, 3821],
      [292.77728611209807, 21.782483993876866, 896, 14342],
      [328.5920078199798, 17.512781863204562, 790, 12640],
      [218.38887927618475, 22.14138873579347, 551, 8825],
      [262.6187619542394, -12.835764577684525, 1848, 29576],
      [195.70499692755223, -46.87021578220381, 2702, 43246],
      [336.62607256359655, 26.293959854977867, 835, 13362],
      [293.70727948375156, 2.9066379212662827, 1904, 30471],
      [0.9858600612533142, -22.303721223538524, 1039, 16630],
      [308.66553957152496, -1.6233655020937652, 1876, 30030],
      [12.090807109967168, 51.166884038284465, 184, 2948],
      [262.6759607147799, 60.23709553551876, 637, 10202],
      [63.23602341692124, -16.523561173525746, 2263, 36215],
      [310.74441204595917, 8.224934582470846, 776, 12423],
      [194.926039289673, -20.870761319827775, 1558, 24929],
      [107.89628059345853, 10.87109659097297, 1403, 22449],
      [152.16739963115705, -18.915754496040492, 2519, 40304],
      [10.195081612366668, -12.518920467313384, 1055, 16888],
      [44.74197953984302, 51.310841711605015, 195, 3129],
      [241.42478928970692, -33.07147378113689, 2680, 42889],
      [232.98822416673002, 14.263064507507213, 530, 8489],
    ];
    for (const [ra, dec, n16, n64] of vectors) {
      expect(ang2pixNest(16, { ra, dec })).toBe(n16);
      expect(ang2pixNest(64, { ra, dec })).toBe(n64);
    }
  });

  it('is the inverse of pixelCentre', () => {
    for (let pix = 0; pix < npix(8); pix++) expect(ang2pixNest(8, pixelCentre(8, pix))).toBe(pix);
  });
});
