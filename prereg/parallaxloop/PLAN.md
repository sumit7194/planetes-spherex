# A dwarf planet's parallax loop in SPHEREx photos (registered 15 Nov 2026, 16:09 IST)

Rules set by Physics before any pixel is read (15 Nov). Sumit chose this item in place of the nearby-star
parallax zig-zag, which stays dropped: a star's wobble is at most 1.5″ (Proxima), below our precision.
A body in the outer solar system loops by degrees, which is the signature a Planet X search looks for.

## 1. Question

Does SPHEREx see Makemake (136472) where its orbit and Earth's motion put it, in each of its three
visits? The second check is Haumea (136108); the stretch goal is Eris (136199, V 18.6).

Coverage (from the Horizons ephemeris and our index, no pixels; 15 Nov 15:55 IST):

| Object | Visits (start, photos) | Middle visit off the straight line through visits 1 and 3 |
|---|---|---|
| Makemake | 2025-05-30 (127), 2025-12-28 (113), 2026-05-30 (134) | 7,478″ |
| Haumea | 2025-06-20 (114), 2026-01-16 (112), 2026-06-21 (127) | 7,870″ |
| Eris | 2025-07-10 (114), 2025-12-26 (114), 2026-07-11 (112) | 4,283″ |

## 2. Photos

- One source: our sky index (`pipeline/sky_index.py`, DR1 + QR3), because IRSA's image search is down.
  A photo is used when its footprint holds the predicted position at the photo's time (margin 0).
- The edge rule: the predicted position's native pixel within 8 px of the detector edge drops the photo.
- FIT_REJECT pixels (`planetes_pack.REJ`) become NaN, and stacks use nanmedian.
- Visits are runs of photos with gaps under 20 days; runs with fewer than 20 photos are not visits.

## 3. Prediction

- **JPL Horizons API**: target `<number>;` (the small body), EPHEM_TYPE OBSERVER, QUANTITIES 1
  (astrometric RA/Dec: ICRF, light-time corrected) and 20 (distance).
- Two observers:
  - **@399**, the geocentre: the prediction;
  - **@10**, the Sun's centre: the "no Earth motion" null, §6b.
- Fetched per visit over [first − 1 d, last + 1 d] at a 30-minute step, saved with its sha256 (`ephem/`).
- Interpolated to each photo's **MJD-AVG** (read from the photo's own header) with a cubic spline in RA
  (unwrapped) and Dec.
- Geocentre → SPHEREx: the header's X_SC/Y_SC/Z_SC is subtracted from distance × direction. This is
  about 0.19″ at 50 AU (SPHEREx is ~7,070 km from Earth's centre; corrected 15 Nov, Viewer), applied.

## 4. Stack

- Per visit and detector. Each photo is resampled onto a 45 × 45 px grid at 6.15″, north up and east
  left, centred on that photo's predicted position.
- Interpolator: **bilinear** (`planetes_pack.resample_frame`; it also subtracts the box's median).
- Then the nanmedian over photos. Each stack's photo count is recorded.
- Background stars move 60–190 px relative to Makemake within a visit, so the median removes them.
- Each stack mixes wavelengths: within a detector each photo sees a different wavelength, including
  the methane bands. The point here is detection, not a spectrum.

## 5. Measure

- **Aperture S/N at the centre:**
  - aperture radius 2 px, background from the median of a 6–9 px annulus;
  - the noise is 1.4826 × MAD of the same aperture sums at 24 positions: 12 on each of the circles
    r = 12 and r = 18 px, every 30°.
- **Centroid:** a round Gaussian with a sloped background on a 7 × 7 box at the centre (bounded ±2 px;
  `season_pairs.fit`).
  - The offset from the prediction is given in ″ (east, north).
  - Its error comes from a bootstrap over photos (200 draws, seed 15).
- **Static-sky check:**
  - Gaia DR3 G < 19 (VizieR I/355) within 2 px (12.3″) of the predicted position at each photo's time,
    with Gaia positions moved to that date by their proper motion.
  - If a star sits there in more than 20% of a stack's photos, the stack is flagged "star overlap" and
    not counted.

## 6. Detection and nulls

A stack DETECTS when its S/N ≥ 5 and the fitted centre is within 2 px of the prediction.

- **(a) Perpendicular controls:**
  - the same stack, measured at ±5, ±10 and ±15 px perpendicular to the visit's motion on the grid
    (6 per stack): same timing, photos and star removal;
  - each needs S/N < 5. If any reaches S/N ≥ 5, that stack doesn't count.
- **(b) No Earth motion:**
  - the same procedure on the heliocentric (@10) track, at each photo's time: photos from the same
    times (±0.5 d) and detector whose footprint holds the @10 position;
  - at visit 2 that stack must be empty (S/N < 5);
  - the @399 vs @10 separation (the parallax itself) is quoted per visit.
- **(c) Gone later:**
  - for each photo in a visit, a photo from another visit on the same detector that covers the same
    sky position (the index; the first found, in time order);
  - stacked at those positions, it must be empty (S/N < 5), which shows the source is a mover;
  - done only where ≥ 20 photos cover it.

## 7. Claim

**Makemake passes** if it DETECTS in ≥ 2 of its 3 visits, with clean (a) controls in those stacks and a
clean (b) at visit 2. Wording, with every number computed and checkable:

- "Makemake's yearly parallax shift is about X″" (the @399 vs @10 separation from Horizons);
- "The nearest star, Proxima Centauri, shifts 0.77″";
- "Makemake's loop is about X / 0.77 times larger".
- "~2° off a straight line" only if the 7,478″ matches the @399 vs @10 separation at visit 2; otherwise
  the measured number.

Haumea and Eris are reported the same way.

## 8. Per-photo arc

Forced S/N at each photo's predicted position. A per-photo centroid is plotted only where S/N ≥ 10.

## 9. Order

1. Physics gets the stacks' S/N and the nulls table before any figure text.
2. Then the site figure (Viewer's design, 15 Nov):
   - a Learn chapter "Why a far planet loops", with Measured and Model views;
   - lilac for predicted or model, ember for measured;
   - the model slider runs from Barnard's Star to Makemake.

## 10. Log of changes (dated, before results)

- **15 Nov 2026, 16:11 IST:** the geocentre → SPHEREx offset in §3 was first written as ≤ 0.02″ (from the orbit's ~700 km altitude). It is ~0.19″ at 50 AU, because SPHEREx is ~7,070 km from Earth's centre (Viewer). The correction was always applied, so only the stated size changes.
- **15 Nov 2026, 16:11 IST, Sumit's decision:** the distance slider in the new Learn chapter replaces N6's distance dial, and the hidden ?demo=dial page is retired, so there's one control.
