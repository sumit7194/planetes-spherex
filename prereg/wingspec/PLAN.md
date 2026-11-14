# Spectra for saturated stars from their edges (queue #6): rules fixed before any data is read

- **Why:** Barnard's Star, RW Aurigae and R Draconis saturate SPHEREx, so today their pages say "no spectrum: saturated". The light in the star's unsaturated edges (the PSF wings) still holds its brightness in each colour, if SPHEREx's own PSF model says how much of the light falls there.
- **Rules:** set by Physics on 15 Nov 2026 (message at about 01:55 IST), written here before any wing flux, ratio or spectrum is computed. Event build drafted the plan; Physics changed the method, the rings, the gates and the targets.
- **Status:** registered. Nothing has been measured. Step 0 (reading how the ePSF is laid out) is setup, not data, and its findings get added below with a date before step 1.

## 0. Setup (no star is measured)
- Read the EPSF extension's structure in a few photos per detector: how many planes there are, which zone of the detector (and so which wavelength) each covers, its sampling (oversampling factor), and the stamp's size. Use the plane, or the documented interpolation between planes, for the star's pixel, **exactly as the pipeline defines it**. One PSF per detector is not enough (Physics).
- Record the stamp's extent in native pixels. The fit region's outer edge must stay **at least 2 px inside the stamp's edge**, so light beyond the model's footprint is never silently assumed to be zero.

## 1. The method, per photo
- **Position:** never from the saturated core. Gaia DR3, moved by its proper motion to the photo's date, through the photo's WCS.
- **Rings, scaled per photo:** the masked core is every pixel with a FIT_REJECT flag by name (NONLINEAR included) in the region connected to the star's place. The fit region's **inner edge is 1 px outside the outermost masked core pixel**: the extra pixel guards against unflagged nonlinear pixels and bleed. Its **outer edge** is set by the stamp (step 0) and is the same for every photo of a target in a detector. Barnard's flagged core runs 1.9–4.5 px depending on the detector (FINDINGS 13 Nov), which is why a fixed ring can't be used.
- **Fit, don't divide:** for a saturated star the outer annulus still holds the star's own wings, so subtracting it as background would take away starlight. Fit two numbers by weighted least squares over all unmasked pixels in the fit region: **flux × ePSF (at the star's sub-pixel place) + one constant background**. Weights from the photo's VARIANCE. No ratio is corrected afterwards.
- **The ePSF is effective:** the pixel response is already in it, so sample it at the pixel centres, offset by the star's sub-pixel position. Don't integrate it over pixels a second time.
- **Wavelength:** each photo's flux sits at the star pixel's wavelength (WCS-WAVE). Points are binned like the spectrum tab's other spectra (24 bins), and drawn with a different mark labelled "from the star's edges (model-dependent)".

## 2. Gate G1: unsaturated stars, the same radii
- **Purpose:** the ePSF's wings beyond ~5 px are its weakest part (it is built mostly from fainter stars, and scattered light or ghosts outside the stamp aren't in it). G1 tests exactly the radii a target will use.
- **Stars:** for each saturated target and detector, unsaturated, isolated stars measured with **that target's own fit-region radii**. Each G1 star must have no flagged pixels in its own core, and no Gaia neighbour within 3 mag of it inside the fit region. About 30 per target and detector (the helper's photo reads; the target's own field first, then nearby fields).
- **Compare:** the edge fit (method 1, the target's radii) against a **core fit of the same star** (the same model fitted to all its unmasked pixels).
- **Pass, per target and detector, all three:**
  - median edge/core ratio within **1.00 ± 0.10**;
  - 90th-percentile scatter of the ratio **≤ 0.15**;
  - **no trend** of the ratio with the star's detector y (wavelength) across the detector bigger than **0.10 end to end** (a straight-line fit). A trend would bend the spectrum's shape even when the median passes.
- A detector that fails G1 shows **no points** for that target.

## 3. Gate G2: Barnard's Star against 2MASS (outside check)
- **Synthetic photometry:** integrate Barnard's binned edge spectrum through the 2MASS J, H and Ks response curves, and convert the catalogue magnitudes to flux density with the official 2MASS zero points. Barnard's is an M4 dwarf with strong water bands, so a narrow channel at a band centre can differ from the broadband flux by about 10%.
- Only bands **fully covered by channels from G1-passing detectors** are compared.
- **Pass:** agreement within **20%** in every compared band. A detector whose channels make a band fail shows no points.
- **WISE is not used:** Barnard's (W1 ≈ 4, W2 ≈ 3.6) is far beyond WISE's saturation limit (about 8 and 7 mag). Those catalogue fluxes come from profile fits to saturated images and can carry large errors.
- So G2 can only test **D1–D3** (~1.1–2.4 µm). **D4–D6 rest on G1 alone.**
- **Decision logged (event build, following Physics' lean; for Sumit to review):** D4–D6 points that pass G1 are shown with the label **"edges only, no outside check"**, not left out.

## 4. Targets, in order
1. **Barnard's Star** (steady in the near-infrared): G1 and G2.
2. **RW Aurigae** (less saturated than Barnard's in every detector, FINDINGS 14 Nov): G1 with its own radii. Shown per look, labelled **"one epoch: varies"**. No G2 (it varies).
3. **R Draconis:** only if it passes **its own G1 on steady comparison giants at its level of saturation**, with its radii. The registered bright-steady-star test (63e5824) found wing-ring photometry fails on steady giants at R Draconis's level. If that G1 fails, "no spectrum: saturated" stays. Labelled "one epoch: varies" if shown.

## 5. What doesn't change
- If every detector fails for a target, its page keeps the honest "no spectrum: saturated".
- No tolerance, radius or star list changes after the first result is seen. Any change gets a dated entry here first, with its reason.

## 6. Log
- 15 Nov 2026: plan registered (Physics' rules). Next: step 0 (the EPSF layout), then this file goes back to Physics before the first run.
