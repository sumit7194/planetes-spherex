# Spectral twins v3: the plan to register before reading any star (draft)

- **Status:** frozen text, 14 Nov 2026 late evening. Neural checked the draft and its five additions are written in below. Nothing has been drawn or read; the field draw comes next.
- **Why v3:** v1 passed an easy test; v2 (Neural's tests) showed twins agree on colour only, and that 56–61% of twins sit in the star's own field. That means the spectra carry field and detector-position effects. (queue #19)
- **Code:** `pipeline/spectral_twins.py` (v1, v2) and a new `--v3`.

## 1. The question
Do SPHEREx spectra (0.75–5 µm, ~100 colours) tell stars apart **beyond what their optical colour already says**, without any learned model?

The main target is **surface gravity at fixed colour**: dwarf or giant.
- SPHEREx sees the CO band at 2.3 µm and water bands; Gaia's BP−RP doesn't.
- A learned twin-finder later must beat this baseline on the same test, on locked fields, by a margin set beforehand.

## 2. Stars and fields (fixed before reading)
- **Fields:** 60 fields of 64 × 64 px (6.5′), drawn uniformly on the sphere with a fixed seed.
  - Stratified into 3 ecliptic-latitude bands (zodiacal light) × 2 galactic-latitude bands (|b| < 20°, ≥ 20°: crowding and extinction), 10 per cell.
  - Each field must have ≥ 2 passes in DR1 + QR3.
  - Each field must be > 1° from the five targets, every SphereXVision patch, and the slow-mover yardstick's 240 fields, so v3 is independent of them.
- **Locked fields:** 12 of the 60 (2 per cell), chosen by the same seed and written down now.
  - They're scored once, at the end. Nothing is tuned on them.
- **Stars:** Gaia DR3, G 10–16, isolated (no star brighter than its G + 2 within 18″, at *every* pass's position, not just the first), with a 6 px margin from the field edge.
  - Gaia VARIABLE stars are kept but reported separately.
- **Expected count:** about 10⁴ stars over 60 fields. If short, the field count is raised before reading, not after.

## 3. Measurement (fixed before reading)
- **Photos:** every photo of each field, read through the cloud helper at native resolution, so flags are taken per native pixel, not OR-ed through resampling.
- **Skip rule (Neural):**
  - skip a photo only if a native pixel inside the aperture has **OVERFLOW** or **BLOOM**, or is NaN;
  - **NONLINEAR** and **SUR_ERROR** are recorded, not skipped;
  - photo loss is reported by G bin (expected: small at G 16).
- **Photometry:**
  - aperture radius 2 native px, annulus 4–6 px (median);
  - then an **aperture correction per detector and per wavelength step**, from the median of bright isolated stars in the same release. The correction table is built on the 48 open fields only.
  - The annulus background is kept (it sidesteps release-to-release ZODI differences; QD-1).
- **Spectrum:** 24 log bins, 0.75–5 µm, median per bin; ≥ 20 bins filled; shape = divide by the star's median, then log10.
  - The share of interpolated bins is reported per star.

## 4. Twins
- PCA fit on the open fields' stars only, **4 components**; twin = nearest by Euclidean distance in PC space (cosine reported beside it).
- **Cross-field twins are the main number:** a star's twin is searched only among stars in *other* fields. Same-field twins are reported beside it, as a check on leakage.

## 5. Scores (named before looking)
- **Main:** surface gravity residual. Gaia DR3 logg_gspphot with its trend on **dereddened** colour removed (BP−RP minus Gaia's E(BP−RP)_gspphot; Neural: reddening moves BP−RP without changing gravity). The trend is fit on the open fields.
  - **Truth quality cut (Neural):** only stars with (logg_upper − logg_lower)/2 < 0.3 dex count in the gravity score; the count is reported. Stars without GSP-Phot values don't count.
  - Ratio = median |Δ residual| (star vs its cross-field twin) / median over random cross-field pairs.
  - **Random pairs are matched** in G bin (10–12, 12–14, 14–16) and in galactic band (Neural: logg noise grows with G; unmatched pairs would flatter the ratio).
  - 95% CI by bootstrap over **fields** (2,000 draws). With only 12 locked fields this CI is rough, and is said so.
- **Twin pool:** an open-field star's twin comes from the *other open fields*; a locked star's twin comes from the **open fields only**, so the locked score never depends on other locked stars.
- **Order of scoring:** the open-field result is computed and written into this file first, with no tuning in between; then the locked fields are scored once.
- **Pass rule for the baseline as a working tool:** ratio's upper CI < 0.8 on the locked fields.
- **Margin for any learned model (fixed now, before v3's number is seen):** a learned twin-finder must lower the locked-field gravity ratio by **≥ 0.1 absolute** against this baseline, on the same stars and the same pairs.
- **Also reported:**
  - BP−RP ratio;
  - W1−W2 residual ratio, next to the per-bin 3–5 µm scatter vs the expected W1−W2 spread, so "no agreement" can be read as either no information or noise;
  - held-out bins (2.2–2.4 and 4.4–4.8 µm) predicted by the cross-field twin;
  - results by G bin (10–12, 12–14, 14–16);
  - same-field share vs expected.
- **Labelled truth (if available in time):** a LAMOST, APOGEE or SDSS spectral-type subset in the fields; share of twins with the same luminosity class.
- **Drift check:** the same stars in QR2 vs DR1 + QR3: the share of twin lists that stay the same, and the share of stars whose aperture-corrected spectra change by more than their own scatter (comparable to QD-1's "carries over").

## 6. Rules
- The field draw, the locked fields, the skip rule, the aperture-correction recipe and the scores are fixed and committed before any field's photos are read.
- Any change after scoring is v4 and a new run.
- Results are shown as a baseline with its numbers, never as "classified".

## 7. Before reading (to do, in order)
1. Neural's check of this draft. **Done** (14 Nov): five additions written in.
2. Draw the fields (script + seed + hashes), commit. **Done** (14 Nov): `prereg/twins_v3/draw_fields.py`, seed 2026111403, 60 fields (12 locked), `prereg/twins_v3/fields.json` sha256 **6136b6e211e790e667c1b3b4e3957384b198ba811c6129582818857a4792eafc**. Committed with a copy of this plan before any photo is read.
3. Read through the helper; build the aperture-correction table on open fields; run; score open fields; then the locked fields once.
