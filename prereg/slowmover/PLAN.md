# Slow-mover yardstick: the plan to register before scoring (v2)

- **v1:** drafted 14 Nov 2026, late evening, by the event-build session.
- **v2:** revised the same night with all of Physics' marks.
- **Status:** **signed off by Physics** (14 Nov 2026, late evening), with three notes (written in below). Nothing has been injected or scored.
- **Tests:** `pipeline/season_pairs.py` (queue #9).
- **Reuses:** Physics' `smo.inject` (render, truth) in SphereXVision.

## 1. The question
How faint, and how slow, a mover can the season-pair search find, at a fixed false-alarm rate?
- **"Slow mover":** 0.3–10″/yr, seen in two passes about 6 or 12 months apart.
- **Out of scope:** fast movers (v4's job).

## 2. Sky (fixed before injecting; seed and hashes below)
**Draw** (`notes/yardstick/draw_fields.py`, numpy default_rng, **seed 20261114**): uniform on the sphere, keeping a point only if all of these hold:
- |b| ≥ 10°;
- |β| ≤ 74° (not the continuously watched polar caps);
- its nside-16 coverage cell has ≥ 2 passes in DR1 + QR3;
- it is > 1.0° from every patch in SphereXVision `prereg/patches.csv` (both copies, 40 rows), plus D-1 (28.67, +10.87; D-1dr/drB sit there) and CF-1 (31.83, −47.34), i.e. all V, T, D, N and CF patches, so this yardstick is independent of where other methods were tuned;
- it is > 1.0° from the five targets;
- it is ≥ 2.0° from every field already chosen.

**Lists:**
- **Development (injection) fields:** the first 40 accepted, `notes/yardstick/fields_dev.json`, **sha256 456187f9f020c4497e859e2babd99f13732178df43406c0c3fde167ee2031c68**.
- **Null-calibration fields:** the next 200, `notes/yardstick/fields_null.json`, **sha256 4d4f3558eb8f3741360dfcc2f5ededa6200df04ede6c7c8c2346c62ea96adb04**.
- **Field size:** each field is 64 × 64 px (6.5′).

## 3. Fakes
**Motions:** CatWISE2020 rows with total PM 0.3–10″/yr, log-uniform in PM, random direction.

**Parallax:** CatWISE has none, so it is drawn from tangential velocity: π = μ / (4.74 · v_tan), with v_tan lognormal, median 30 km/s, σ_ln = 0.5, truncated to 5–200 km/s.

**Brightness:** W2 uniform over 12–18.

**Colours across the six detectors:** two families, half each:
- **brown-dwarf-like:** Sonora Bobcat model spectra (Marley et al. 2021), Teff ≈ 900 K and ≈ 500 K, alternating. Each is integrated over each pixel's CWAVE/CBAND from the spectral_wcs calibration (cal-swcs-v5-2026-191), and each model file's sha256 is recorded here before injecting. The challenge targets' own fluxes are never used (that would be circular).
- **star-like:** a 4000 K blackbody.

**Tracks:** at each exposure's own time, PM × Δt plus parallax factor × π (Earth's position at that MJD).

**Placement, per field:**
- 6 fakes per injection pass;
- **two-thirds isolated:** ≥ 8 px from each other and from any source in the all-season stack, outside saturated blobs and their glare;
- **one-third anywhere** outside saturated blobs, so crowding is included;
- completeness is reported for both groups.

**Injection passes:** **5 per field**, each with a new seed (as v4's pass0–4). That's 40 × 5 × 6 = 1,200 fakes, about 200 in the headline bin.

**Rendering:** `smo.inject.render.inject` into each exposure's raw IMAGE (zone-blended ePSF, smear over the exposure, photon noise, matching variance). Then the normal path runs unchanged: resample, mask, stack, search.

**Truth:** sealed per field and pass with `smo.inject.truth.seal`; the sha256s are recorded before scoring.

## 4. Nulls (false alarms), both reported
- **N-A, split-pass null on the 200 null fields:** split one pass into its first and second halves by time, and run the identical search on the halves as if they were two seasons. True motion is about zero.
  - Caveat: within a pass, wavelength and time are tied, so chromatic blur shifts can look like motion. This is pessimistic, a different systematic.
- **N-B, real-pair null:** in the real season pairs (the 40 development fields, no fakes, and the 200 null fields), any candidate on a Gaia DR3 star with PM < 10 mas/yr is a false alarm. This one sees the scan-orientation flip between 6-month passes, which N-A cannot.
- **The fixed false-alarm rate** is per field-pair, not per deg²: **≤ 1 false candidate per 100 field-pairs**.
  - **Threshold noise (Physics):** 600 null field-pairs give about 6 events at the chosen threshold, so the threshold itself is uncertain. N-A's count at the frozen threshold is reported with a Poisson 95% CI.
  - **Strictness:** N-A's chromatic systematic makes it, if anything, strict. The candidate threshold (the significance multiple, now 5× the steady scatter) is calibrated on N-A over the 200 null fields (600 field-pairs) before scoring the fakes. N-B is then reported at that threshold.

## 5. Scores (named before looking)
- **Completeness:** found within 1.5 px of the true track, PM direction within 30°, PM magnitude within 30%.
  - Grid: W2 bins 12–13 … 17–18 × PM 0.3–1, 1–3, 3–10″/yr, for 6-month and 12-month pairs separately, and for isolated and anywhere placements.
- **Headline number:** W2 at 50% completeness for PM 1–3″/yr on 12-month pairs (isolated), at the fixed false-alarm rate.
  - Fit: a logistic in W2.
  - 95% CI: bootstrap resampling *fields* (2,000 draws).
- **Bias:** median (measured PM / true PM) for the recovered fakes, with a bootstrap CI.
- **Lost area:** the fraction of field area not searched (glare veto, saturation), beside completeness.
- **Second arm (descriptive):** the same fakes centroided with Physics' ePSF fit instead of the round Gaussian. It tests the pixel-locking explanation for ε Ind B's −2 to −3% rate bias.

## 6. Rules
- Development and null sky only; no tuning on the scored run (the threshold is fixed on N-A first).
- Any method change after scoring is a new version and a new run.
- Results are shown as "candidates"; yardstick numbers go next to any public claim.

## 7. Before injecting (to do, in order)
**Registration means committed (Physics):** the plan text, the draw script, both field-list hashes and the Sonora file hashes are all committed in `prereg/slowmover/` before any photo is read for injection. Registration commit: **4db4606** (14 Nov 2026, before any photo was read for injection).

**Mac use:** any step run on this Mac (not the helper or the cloud) is logged first in ~/mac_shared/LEDGER.md with its memory ceiling.

1. Physics' sign-off on v2. **Done.**
2. Fetch the two Sonora Bobcat spectra (Marley et al. 2021; public, Zenodo record 5063476) and record their sha256 here. **Done (14 Nov):** from `spectra_m+0.0.tar.gz` (Zenodo md5 382d939520eb516e50cdfe98625232ec, checked), files in `prereg/slowmover/sonora/`:
   - `sp_t900g1000nc_m0.0.gz` (Teff 900 K, g 1000 m/s², [Fe/H] 0, C/O 1): sha256 **b08868fb31b2c022a3ff10072d1c2df157c6022394099933b2175fb78fb6f427**
   - `sp_t500g1000nc_m0.0.gz` (Teff 500 K, same): sha256 **ba9f65f3a4af3263ef1b25c8fc593efbf9b6466186b3565e9bd5c21d1744c122**
3. Read the 240 fields' photos (through the cloud helper: about 20 kB per frame).
4. Calibrate the threshold on N-A (null fields only).
5. Inject, seal, run, score.

## 8. Log of implementation changes (dated, before scoring)
- **14 Nov 2026, 23:19 IST — the photo-list source, decided before any more results (Physics agreed).** IRSA's image search (SIA) has answered HTTP 502 since about 22:15 IST; NASA's S3 bucket is unaffected.
  - **Rule:** if SIA still fails at **09:00 IST on Sun 15 Nov 2026**, N-A and the scored run take their photo lists from our own sky index (`pipeline/sky_index.py`, built 14 Nov from IRSA's ObsCore footprints joined with the bucket listing), with no footprint margin (`margin_deg = 0`).
  - **No mixing:** the 23 N-A fields already done from SIA are then re-run from the index, so one source is used throughout.
  - **Before switching:** margin-0 index lists are compared with SIA lists where we have them, photo by photo, and every difference is listed and explained. This checks the plumbing only; it looks at no detections.
  - If SIA is back by then, nothing changes and the run continues from SIA.
  - **Done so far (from SIA):** 23 null fields, with read order and times in `pipeline/yardstick_stacks/na_order.txt`; 12 skipped by the outage, to be retried.
- **14 Nov 2026, 23:21 IST — an edge rule, decided before it was applied to anything (Physics agreed).**
  - **Rule:** a photo is left out of a field's stacks when the field centre's own pixel on that photo (`xt`, `yt`, full-frame, 0-based) lies within **8 px** of the detector's edge: `min(xt, yt, NAXIS1 − 1 − xt, NAXIS2 − 1 − yt) < 8`. Measured from the box centre, not the box edge.
  - It applies to both photo-list sources and to every field, including the 23 already stacked.
  - **Why:** comparing the index (margin 0) with IRSA's SIA on Physics' 10 cached answers (1,579 photos), every SIA photo is in the index. The index lists 32 more because it models each footprint as a square, while SIA uses IRSA's outline polygon. For 31 of the 32 the helper answers "not on this photo": they hold no pixels and never reach a stack. So "the index has 32 more" does **not** mean 32 more photos in the stacks. One (`2026W03_2A_0117_1D1`) has the spot on detector row 2.5, inside the detector but outside SIA's slightly inset polygon. This rule drops that photo, so the two sources are equal by construction.
  - **The 23 done fields** were stacked without the rule. They are re-stacked with it (from the source this log settles on), and the number of photos the rule removes per field is reported here.
  - **Size of the effect (14 Nov, 23:22 IST; Physics asked that it be stated):** tested on one field (YN-001, index list, to check the plumbing only), the rule removes **about 4% of photos per field** (15 of 360). Most are ordinary edge photos that SIA lists too, not just the one index-only case above. Because the rule was written before any detections were looked at, and applies the same way to every field and source, this larger drop is accepted.
- **Correction (14 Nov, 23:52 IST):** the three entries above first carried guessed times ("23:45", "15 Nov ~00:05", "~00:20"). They now carry their commit times (cd190e3 23:19, f795637 23:21, 3c7334f 23:22 IST). The order and content are unchanged.
- **14 Nov 2026, 23:49 IST — IRSA's image search answers again (HTTP 200).** By the 23:19 rule, the photo list stays SIA, and nothing switches to the index. All 200 null fields (the 23 done ones included) are stacked with the edge rule, from SIA. That run starts after the helper's daily request count resets (05:30 IST). The 23 earlier stacks are kept aside.
- **15 Nov 2026, 11:41 IST — Gaia source for the remaining 46 null fields (plumbing; Physics approved before running).** ESA's Gaia archive stopped answering at about 10:33 IST (no reply in 70 s), after 154 fields were done from it. Each field's Gaia list (quiet_pixels: G < 19, the cutout's half-diagonal + 0.002°) for the remaining 46 comes from VizieR's copy of the same catalogue (I/355/gaiadr3, Harvard mirror; CDS was down). It uses RA_ICRS/DE_ICRS (Gaia's epoch 2016.0) and pmRA/pmDE, with no row limit; a count equal to a known VizieR limit fails the field.
  - **Identity check on 4 fields done from ESA** (pipeline/yardstick_stacks/gaia_vizier_identity.json): YN-115 (densest, 749 stars), YN-079 (740), YN-043 (sparsest, 15), YN-154 (231). The same star sets (every ESA star matched within 0.01″; worst 0.0″), proper motions equal to 0.0007 mas/yr (rounding), and the same number of stars without proper motion (7, 5, 0, 0; both paths treat them as 0). G isn't stored in the saved ESA lists, so it's checked only through the identical set at the same G < 19 cut.
  - Each field's output says which archive gave its Gaia list (gaiaSource: "ESA" or "VizieR I/355 (Harvard)"), so the 154/46 split can be checked.
