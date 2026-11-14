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
- **Too few matches (Physics, 14 Nov; added before any ratio was read):** if fewer than 2 stars match in all three detectors, each detector is tested on its own: the candidates within ±30% of R Draconis's radius in that detector (up to 5, closest first). A detector with fewer than 2 such stars **cannot be tested and isn't trusted** for R Draconis. If no detector can be tested, R Draconis stays "possible dimming, not tested".
- **Not done:** D4 (R Draconis's ring is only 28% usable there).

## 4. Rules
- Any change after step 3 is a new version and a new run.
- The result is shown with this test named next to it.

## Log
- **be1c757:** step 2 chosen list (flags only). No star matches in all of D1/D5/D6, so the per-detector rule applies: D1 can't be tested; D5 and D6 get 5 stars each.
- **step 3 (14 Nov):** inner ring 5–9 px: D6, all 5 pass; D5, 2 of 5 fail (HIP 49841, 42911). D5 isn't trusted.
- **Box enlarged after step 3; rule unchanged:** the ±20 px boxes couldn't hold the 8–13 px ring (it needs r_out + 7 = 20 px of margin), so the 8–13 values are computed after the 5–9 results were seen, on the same chosen stars, with ±30 px boxes (`rdra_steady.py --outer`). Told to Physics before any 8–13 value was seen.
- **For R Draconis in D6 to be MEASURED (Physics):** its own ring check must hold too (5–9 and 8–13 within 10% for the headline pair). The headline stays the pre-stated last pass over first (1→3); 1→2 and 2→3 are shown beside it, not picked from.
- **Outer ring (8–13 px, ±30 px boxes; 14 Nov):** D6 fails: HIP 49841 reads 0.90 and 1.091 (both outside 1.00 ± 0.06), while the other four stay inside. D5 fails again. **No detector is trusted** at R Draconis's brightness, so by the registered rule R Draconis stays "possible dimming, not confirmed": the method isn't steady enough on steady stars this bright, especially in the outer ring.
