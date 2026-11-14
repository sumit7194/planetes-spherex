# R Draconis: the bright-steady-star test (registered before any candidate's ratios are read)

- **Why (Physics, 14 Nov):** R Draconis's "possible dimming of about 40%" (commit 0bb11c1) used comparison stars outside its glare, but the steady-star test behind the wing method used Barnard's Star, much fainter and less saturated than R Draconis. MEASURED needs the identical method to give 1.00 ± 0.06 between passes on steady stars that saturate SPHEREx about as much as R Draconis does.
- **Status:** rule written and committed before any candidate is read. Script: `pipeline/rdra_steady.py`.

## 1. Candidate list (catalogues only)
- **Hipparcos main catalogue** (I/239/hip_main, via VizieR's Harvard mirror; CDS was unavailable on 14 Nov):
  - SpType a K0–K5 giant: matches `^K[0-5](\.\d+)?\s*III` and not `IV`/`V`/`I ` or `Ib`/`Ia` after it;
  - **steady:** Hpscat ≤ 0.010 mag (the scatter of its Hipparcos photometry), and HvarType blank or C (no variability found);
  - Hpmag < 6.
- **2MASS** (II/246, the nearest source within 5″): Kmag 0–2. Used only to build the list; 2MASS saturates for stars this bright.
- **Sky:** galactic |b| > 10°; more than 5° from each of the five targets; at least 2 survey passes in DR1 + QR3 (its coverage cell).
- **Order:** the 25 with the lowest Hpscat (ties: brighter Hpmag first) go on to step 2.

## 2. Saturation match (flags only; no brightness ratio is computed)
- For each candidate and for R Draconis, in D1, D5 and D6, from every photo of it (±20 px native boxes; R Draconis from its cached ±54 px boxes):
  - flagged core = the connected region of WING_BAD pixels (measure.py: saturation incl. NONLINEAR, SUR_ERROR, BLOOM, OVERFLOW; transient, hot, cold, persistence, crosstalk, streak, missing) that contains a pixel within 2 px of the star's place;
  - its radius = √(area / π); 0 when there's none;
  - the detector's value = the median over photos.
- **Kept:** candidates whose radius is within ±30% of R Draconis's in each of D1, D5 and D6.
- **Chosen:** up to 5 of the kept ones, closest first (smallest sum over D1, D5, D6 of |ln(radius / R Draconis's radius)|). The chosen list is committed before step 3.

## 3. The test (the identical method)
- measure.wing_ratios on each chosen star, rings 5–9 px and 8–13 px (R Draconis's own pair), in D1, D5 and D6. Same rules: photos paired within λ/80, ≥ 10 matched pairs per pass pair, each photo's ring ≥ 60% usable.
- **Pass, per detector:** every chosen star, every pass pair, both rings within 1.00 ± 0.06.
- **Fixed in advance:** a detector where any chosen star fails is not trusted for R Draconis. R Draconis's brightness change is MEASURED only from trusted detectors that also pass its own gates (rings agree within 10%, change beyond 3× its error with the far comparison stars' systematic error and the 5% floor). Otherwise it stays "possible", with the reason.
- **Not done:** D4 (R Draconis's ring is only 28% usable there).

## 4. Rules
- Any change after step 3 is a new version and a new run.
- The result is shown with this test named next to it.
