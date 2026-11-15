# Brightness change of the variable stars from unsaturated colours (G4): rules fixed before any target number is read

- **Why:** RW Aurigae and R Draconis are the challenge's own test objects for variable stars. Today the site says RW Aur "can't confirm" and R Dra "not measured": both saturate SPHEREx's detectors. Sumit's pick (15 Nov): first try the photos and detectors where the star is *not* saturated.
- **Rules:** Physics, 15 Nov 2026 (message received ~07:20 IST), on Event build's draft. Written here on 15 Nov 07:11 IST, before any photometry of RW Aur or R Dra for this item.
- **Order:** steady-star results go to Physics before any target ratio is computed or looked at.

## 1. Which photos count (per photo, per star)
- No OVERFLOW, NONLINEAR, BLOOM or PERSIST flag (by name) in the 3×3 around the star.
- No FIT_REJECT pixel at all in the 3×3 core.
- Wing pixels of the aperture may be masked only if ≤ 10% of the ePSF-weighted aperture is masked, and then corrected with the ePSF as measure.py does. If measure.py has no masked-fraction correction, such a photo is rejected instead.

## 2. Hidden saturation (the main risk)
- Up-the-ramp fitting can recover a saturated pixel without raising OVERFLOW, so the flag test alone doesn't prove linearity at the target's brightness.
- The steady-star test must include comparison stars whose peak pixel in that photo is **≥ 0.5× the target's peak**. A detector with none reports **"no steady star this bright here, not tested"** and makes no claim.

## 3. Steady stars (from the same photos)
- Gaia DR3 stars in the cutout with phot_variable_flag ≠ VARIABLE; no Gaia neighbour brighter than G_star + 3 within 2 px; unsaturated by §1; peak within ×3 of the target's.
- **≥ 5 per detector.** Barnard's Star only as an extra line, not the test.

## 4. Steady-star test (tolerance)
- Per detector: the median steady ratio (pass B ÷ pass A) within **1.00 ± 0.02**, and the steady stars' ratios scattered consistently with their errors (**χ²/dof < 2**). If either fails: **"steady stars don't hold, no number"**.
- Basis: DR1 vs QR3 star fluxes agree to ~1% per detector (FINDINGS 13 Nov), plus room for pass-to-pass drift.

## 5. Measurement
- Differential: target ratio ÷ median steady ratio, per detector. Systematic error = rms of the steady stars' differential ratios, in quadrature.
- Count **wavelength-matched pairs** (λ/80), not photos: **≥ 3 pairs per detector**. Error = max(propagated, pair scatter/√n).

## 6. Claims and wording
- Six detectors = six tries: "brightness changed" needs **≥ 3σ (stat + sys) in at least 2 detectors with the same sign**. One detector at ≥ 3σ is shown as its number, worded "not a claim alone".
- RW Aur: keep the blend line (A and B in one pixel). Within-pass scatter above the errors is shown as information ("varies within the pass too"), not a claim.
- Per detector, one of: ratio ± stat ± sys; "saturated in every photo here"; "not tested" (§2); "steady stars don't hold" (§4).
- If both stars are saturated in every detector, the item ends there (Physics expects R Dra will, from the 63e5824 finding).

## 7. Log
- 15 Nov 2026, 07:11 IST: registered. Nothing measured.
