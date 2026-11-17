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
- **15 Nov 2026, 13:21 IST — N-A null run complete (all 200 fields, edge rule, photo lists from SIA).** 556 field-pairs (550 with ≥ 2 detectors, 214 with ≥ 3). Gaia lists: 428 field-pair rows from ESA, the rest (46 fields) from VizieR I/355 after ESA stopped answering (logged above). Interruptions: IRSA's SIA and ESA failed from ~10:33. 7 fields (YN-155–161) were skipped and retried later with the same code; none is missing.
  - **Threshold T = 11.19** (the 5th highest of 634 consistent sources over 550 field-pairs, k = 550/100 → 5); candidates need > T; expected count at T ≈ 5 (Poisson 95% 1.6–11.7). Bootstrapped by field (2,000): median 11.19, 95% 7.06–17.08.
  - Top 10: 18.04 YN-089, 17.08 YN-074, 15.04 YN-176, 14.55 YN-056, 11.19 YN-029, 8.67 YN-195, 8.52 YN-136, 7.6 YN-086, 7.58 YN-168, 7.14 YN-014 (all 2-detector pairs). The top 5 are in 5 different fields. No ≥ 3-detector pair is above T.
  - Steady scatter: median 0.283 px (10–90%: 0.098–0.590). At the old 5×: 23 candidates in 22 field-pairs.
  - Read order and times: pipeline/yardstick_stacks/na_order.txt. The old stacks (built without the edge rule) are kept in pipeline/yardstick_stacks_pre_edge_14nov/.
- **15 Nov 2026, 13:26 IST — injection run setup (Physics, before any photo is read for injection).** T = 11.19 is frozen; completeness is measured at it, with no retuning after seeing injection results.
  - Gaia for all 40 development fields from VizieR I/355 (the identity-checked route), one source, recorded per field.
  - Units: flux_img (MJy/sr × px) = F_ν[Jy] × 1e-6 ÷ Ω_pix, reusing smo/inject/plan.py's conversion (omega = pixel_solid_angle_sr). Unit test: a rendered fake's pixel sum × Ω × 1e6 equals the input F_ν to < 0.5% (before noise).
  - W2 normalisation: synthetic photometry against Vega with the same W2 curve, m = −2.5 log10(∫F_obj R / ∫F_Vega R), in the integral form that matches the curve's convention (per photon or per energy; written here once checked). This avoids WISE's ν⁻² colour corrections (10–20% off for Y-dwarf spectra). Unit test: a ν⁻² spectrum at W2 = m gives ≈ 171.787 × 10^(−0.4m) Jy at λ_iso 4.6028 µm (within 2%). Each family's F_ν at 1.1, 2.2 and 4.6 µm relative to its W2 is logged.
  - Per photo: F_ν averaged over [CWAVE ± CBAND/2] at the fake's own pixel; rendered with smo.inject.render.inject on Cutouts from the helper's bit-identical path; truth sealed before scoring.
  - ≤ 3 workers; logged in the ledger. If the run isn't done and checked by the deadline, N4 ships as "limit not available yet" and the limit is a post-event result (Physics).
- **15 Nov 2026, 13:37 IST — injection build, checks so far (no photo read for injection yet).**
  - Photometry (pipeline/fake_phot.py): the W2 response is the WISE team's RSR-W2.txt (IRSA; its header says "Relative Spectral Response per photon"; sha256 b0a86a7e86b07713cecfe9c853292d56f19da6c385de45f6265b676cc1330f2a), so the photon-weighted form is used. Vega is CALSPEC alpha_lyr_stis_012 (sha256 7201cd8566d53d384430c3d5fd2ae8d8122e9a7f765711748b49336f63237672); also fetched for comparison: alpha_lyr_mod_005 (a1d24d648f96e0d6aca4a8e5ab20784f1a385f2bcae560da99422a9382aa8689). The ν⁻² test misses by 2.6% because CALSPEC Vega is 167.3 Jy at 4.6028 µm against WISE's 171.787 Jy zero point. Decision asked of Physics.
  - Rendering (pipeline/inject_io.py, test_inject_render.py): Cutouts are built from the helper's extra=1 boxes, with the ePSF read by Physics' own smo.data.qr3.epsf_grid (QR3_PSF_FLIP) from runs/qr3/wt, the tree smo_identity.py checked. Unit test on a real DR1 photo: the rendered fake's flux × Ω × 1e6 = 0.99727 × the input F_ν (limit 0.5%). The image difference over finite pixels agrees.
  - Same stacking path: field_stacks.stack_field is split into reading and stacking (stack_exps), so injected photos use exactly the N3 code. Re-stacking YN-001 now reproduces its saved N3 stacks exactly (28 arrays, max difference 0; the same 13 edge drops).
  - season_pairs.search_stacks gains keep_all (default off; N3 unchanged): the injection run scores every candidate, not the first 8 shown.
  - The CWAVE/CBAND map is smo.data.calib.spectral_wcs with release_for_version (7.x → cal-swcs-v5-2026-191, as registered).
- **15 Nov 2026, 14:17 IST — W2 zero point and the two independent checks (Physics' decision (b), before any photo is read for injection).**
  - **W2 on WISE's own system:** Vega (stis_012) scaled ×1.0266 in W2, so a ν⁻² spectrum at W2 = 0 gives 171.787 Jy at 4.6028 µm (yardstick_inject.py, W2_SYSTEM=wise).
  - **Check 1 (W1, same method):** RSR-W1.txt (IRSA, per photon; sha256 6ade5b074dc7652e08c4de7767969126b7e48fdf4b6295bbf7f44e22d33ec1e9). A ν⁻² spectrum at W1 = 0 gives 300.75 Jy at 3.3526 µm, against WISE's 309.540 Jy, so the factor is **1.0292**. That differs from W2's 1.0265 by 0.27% (Physics' limit is 2%). **Passes.**
  - **Check 2 (W1−W2 against the Sonora team's tables, log g 5.0, plain stis_012, photon-weighted):**
    - C/O 0.5 spectra (sp_t…g1000nc_m+0.0_co0.5) against mag_table_m+0.0_co0.5:
      - 500 K: ours 3.324, table 3.282 (+0.042)
      - 700 K: 2.772 vs 2.708 (+0.064)
      - 900 K: 2.438 vs 2.353 (+0.085)
      - 1200 K: 1.911 vs 1.817 (+0.094)
    - The registered C/O 1 spectra against mag_table+0.0: 900 K +0.109; 500 K +0.067.
    - Only 1 of 6 is within 0.05 mag. Energy weighting is worse, and integrating on the model's own grid changes colours by ≤ 0.03.
    - The tables' headers name pre-release model runs ("jun17_cloudless+0.0", "mar18_cloudless+0.0_co0.5"), not the released spectra, and their README uses the Bohlin & Gilliland 2004 Vega. The Vega difference can't explain this, because the W1/W2 factors differ by only 0.003 mag. So the comparison is between different model versions, and check 2 is **inconclusive, not passed**. Sent to Physics for a decision. The full run waits for it.
  - **Unit test on WISE's system:** a ν⁻² spectrum at W2 = 15 gives 171.799 µJy at 4.6028 µm, against 171.787 (0.007%). test_fake_phot.py now applies the factor and holds to 0.2%.
  - **Family colours** (F_ν relative to 4.6 µm, each averaged over a λ/40 band as the injection does per photo):
    - bd900: 1.1 µm 0.244, 2.2 µm 0.070
    - bd500: 1.1 µm 0.028, 2.2 µm 0.0017
    - bb4000: 1.1 µm 3.43, 2.2 µm 2.62
    - Single points on the model's fine grid are misleading (bd900 at 2.2 µm is 0.003 at a point), so they aren't used.
- **15 Nov 2026, 14:18 IST — Physics' decision on check 2:** (a). Check 2 is inconclusive, not failed: the gap is smooth and depends on Teff, as different model versions would give, whereas a units bug would give a near-constant ~0.3 mag. Go ahead with W2_SYSTEM=wise, on two conditions:
  - **(1) Band-average check (the path that feeds the fakes): passes.** A ν⁻² spectrum went through fake_phot.band_fnu_jy over [CWAVE ± CBAND/2] from spectral_wcs (the release the run uses, cal-swcs-v5 = smo "qr3"). It was checked at 6 pixels on each of D1–D6 (36 in all, CWAVE 0.750–4.990 µm). The band average equals ν⁻² at the band centre within **0.0075%** (limit 1%).
  - **(2)** Wherever the limit is quoted (N4, the tests page), add: "in W2 on WISE's system; the fakes' brightness in SPHEREx's colours comes from Sonora brown-dwarf models, which differ between model versions by up to ~0.1 mag at 3–5 µm."
- **15 Nov 2026, 14:34 IST — Post-registration extension E1 (EXPLORATORY; chosen after the Y-01 plumbing test showed the registered range sits below T; registered here before running; Physics agreed).**
  - **Why:** at T = 11.19 a candidate needs a shift of 11.19 × the field's steady scale. Across the N3 fields' 10–90% scale (0.098–0.590 px) that is **6.7–40.6″** (median 0.283 px → 19.5″). The registered fakes (0.3–10″/yr) shift at most ~10″ between passes. A ~0% registered table is therefore about nearby brown dwarfs (Physics: WISE 0855, ~8″/yr, is below the reach). It says nothing about a distant planet, whose shift between passes is dominated by Earth's parallax: about 2 × 206265″/d[AU], or ~800″ at 500 AU, ~400″ at 1000 AU, ~200″ at 2000 AU.
  - **The largest shift season_pairs can pair (read from the code):**
    - Sources come from the median of all passes' stacks (5σ peaks).
    - Each source is fitted in each pass inside a 7×7 box centred on its median position, with the centre bounded to ±2 px.
    - So a shift is measurable only within ±2 px (12.3″) of the median position: **at most ~4 px ≈ 25″ between two passes**.
    - A mover that shifts more than about a PSF width between passes also fades from the median, so it isn't found as a source at all.
    - The field is 64 px (394″) across.
    - **The search's window is far below ~200″, so by Physics' rule the Planet X reach limit is stated as (Physics' wording, 15 Nov): "this search can't measure shifts above about 25″ between passes; a planet a few hundred to ~2000 AU away usually shifts by hundreds of arcseconds between passes (from Earth's own motion around the Sun), so it would fall outside what this search can follow."** ("Usually": the parallax shift between two passes depends on the target's ecliptic latitude and on where Earth was at each pass, and can be small near the ecliptic at some pass dates.)
  - **E1 spec:**
    - Same code, T, 40 development fields, W2 grid (U(12, 18)), families, placements (4 isolated + 2 anywhere), 5 passes × 6 fakes.
    - Fakes move linearly at R″/yr, with R log-uniform 10–100″/yr and no parallax (distance set very large). So 12-month pairs see 10–100″ and 6-month pairs 5–50″, spanning well past the ~25″ code limit, so the fall-off is measured, not assumed.
    - Seeds come from sha256("E1|field|pass").
    - Output goes to pipeline/yardstick_inject_e1.
    - Scored like §5, but binned by **true shift between the two passes** (5–10, 10–20, 20–40, 40–80, 80–160″) × W2, with Clopper-Pearson intervals. No headline W2_50 is defined in advance.
    - **Limit stated up front:** a real distant planet also moves several ″/day within a pass (parallax rate). E1's movers are nearly still within a pass, so E1 tests only the shift between passes.
  - **Wording rule (Physics):** if the registered table is ~0, the N4 and tests-page text says the search needs ≳20″ (6–40″ across fields) and that the registered fake brown dwarfs were not recovered. Planet X is not described as "below the reach". Any Planet X sentence uses Physics' wording: "a distant planet's yearly parallax shift (hundreds of arcsec) is above this floor, but we haven't tested the search on shifts that large", updated with E1 and with the code limit above.
- **15 Nov 2026, 15:15 IST — two plumbing fixes in the injection run (found on the first 12 fields; recorded before any scoring; sent to Physics for sign-off).**
  - **A photo whose cutout has no usable pixels** (every pixel flagged or blank) made smo.inject.render.variance_slope fail (an empty quantile), and Y-28 stopped. Such a photo now gets no fakes: it's listed in the truth file (not_injected) and counted per pass in run.json. Its rejected pixels are blank in the stack anyway. In Y-28 this is 1 photo per pass (out of ~2,100 renders).
  - **A crowded field with no room for 4 isolated fakes** (no spot 8 px from every source after 10,000 tries; Y-02) used to stop the field. An isolated fake that can't fit is now placed anywhere (still off saturation and glare) and **labelled "anywhere"**, so the isolated rows stay truly isolated. Fields where all 4 fit draw exactly the same fakes as before (the fallback only runs where the old code stopped), so the done fields Y-01 and Y-15 are unchanged.
  - Only for tracing Y-28: one debug run used the index photo list while IRSA was down. Its output was deleted and not used.
- **15 Nov 2026, 15:25 IST — Physics' review of the injection code: one scorer bug fixed, the skip rule tightened (before any scored result is used).**
  - **Bug (Physics found it):** the scorer's direction check converted one angle to degrees twice (57.3·θ1 − 3283·θ2), so even an exact match came out 84° off and failed the 30° test. Fixed as angle_deg(): degrees(atan2(e1, n1) − atan2(e2, n2)), wrapped to 0–180. Matching is now one function, matches().
  - **Unit tests** (test_yardstick_score.py): an exact shift is found; ±45° is not; ±20° is. Also checked: the size cut (+40% fails, +25% passes), > T is required, off-track fails, and the scorer's east/north agrees with the search's pixel-to-sky convention on the field grid (to 0.2″).
  - **Re-score of the done fields** (Y-01, Y-15; Physics expected 0 to stay 0): Y-01 still finds 0. **Y-15 now finds 3**: the same 12-month pair (p0–p2), star-like fakes (bb4000) at W2 12.96–13.71, moving 5.3–6.0″/yr (true shift 5.2–5.9″), on all 6 detectors, with measured rate / true = 0.98–1.01. Y-15 is a quiet field (steady scale 0.06–0.10 px, so T × scale ≈ 0.8 px ≈ 5″). This fits the stated 6.7–40.6″ range being only the 10–90% band: quiet fields reach lower. With the old formula these 3 would have been missed.
  - **Tightened skip rule (Physics):** inject() is no longer wrapped in a catch, so any error inside it stops the run. Before injecting, the cutout's usable pixels are counted exactly as variance_slope does (not FIT_REJECT, finite image and variance > 0). Below MIN_USABLE = 48 (variance_slope needs ≥ 24 for its 12 upper-half bins; 48 gives each bin ≥ 2), the photo gets no fakes and is recorded with its count. If more than 1% of a field's photos are skipped in a pass, the field stops for a look. Debug check (index photo list, output deleted): Y-28 skips 1 of 356 photos (0 usable pixels) per pass.
  - **Fix 2 confirmed:** in Y-02, fake 3 (planned isolated) has placement "anywhere" in the truth file, and the scorer reads that field.

- **15 Nov 2026, 21:12 IST — photo lists for the remaining 36 fake-mover fields from our sky index (plumbing; Physics chose this route before any new field ran).** IRSA's image search (SIA) kept failing through the evening (502 at 21:00 IST; the runner's rounds from 17:39 to 20:03 finished only 4 of 40 fields: Y-01, Y-12, Y-15, Y-27). The remaining fields take their photo list from our sky index (sky_index.search, margin 0, the same footprint test as SIA) with the 8 px edge rule unchanged (stack_exps); nothing else changes. Each field's run.json records rows_from ("irsa" for the 4 done fields, which stay as they are; "index" for the rest).
  - **Read path unchanged:** the hosted helper (planetes-live) hit Cloudflare's free-plan daily request limit tonight (HTTP 429 on every request). Per Physics, the run waits for the limit's reset at 00:00 UTC (05:30 IST) and reads through the same hosted helper as before; Physics' T chain reads S3 directly and doesn't share that budget.
  - **Identity check first (Physics' rule):** for each of the 4 done fields, the index list must reproduce, after the edge rule, exactly the per pass × detector stack counts recorded in its saved base stacks (with run.json), and every (obs_id, detector) in its truth files must be in the index list. Any mismatch stops the run and goes to Physics; no "explainable" gaps. (SIA's own per-photo lists were not saved, so this is the strongest comparison the records allow.) Script: pipeline/yardstick_identity.py.

- **15 Nov 2026, 22:10 IST — index photo lists at margin −0.01°, the identity rule reworded, and helper errors stop a field (Physics agreed before any new field ran).**
  - **Why:** a read-only identity check (21:15–22:12 IST, the same Worker code run locally, no outputs kept) found Y-01's stacks pixel-identical to the SIA run at margin 0 (18 of 18 pass × detector stacks: same photo counts, max |diff| 0, same NaN pattern and flags), but one photo with fakes, 2025W44_1A_0456_3 D5, missing from the index list. The photo is in the index; its footprint polygon is slightly tighter than SIA's at the very edge (the fake sat at y 2035.3 of 2040 px, 4 px from the edge, so the edge rule drops it either way). At −0.005° the index includes it.
  - **Margin:** index photo lists for this run use −0.01° (a superset, ~6 px); the 8 px edge rule is unchanged and trims the extras. Other uses of the index keep their margins.
  - **Identity rule (Physics' wording):** what reaches the science must be identical: all per pass × detector stack counts and stack pixels match the SIA run exactly (NaN pattern and flags included), and every truth (obs_id, detector) is in the index list. The listed-photo count may differ. All 4 SIA-done fields (Y-01, Y-12, Y-15, Y-27; Y-12 rerun in full) must pass before any new field runs; any single stack difference stops the run.
  - **Read errors:** a helper error (429, 5xx, unreachable after retries) now stops the field (it's retried in the next round) instead of dropping the photo; an off-photo answer (204) is a normal miss. The run reads through the hosted helper after its daily limit resets (05:30 IST).
  - The 4 fields' results are appended below by the runner when the check completes, before the first new field.
- **15 Nov 2026, 22:22 IST — read path for this run: the helper's own code on this Mac (Sumit's decision).** The same Worker code as the hosted helper (cloud/live/src/index.ts) runs locally with wrangler dev (cloud/live/wrangler.batch.toml: no R2 store, no placement), one instance per worker, restarted with an empty state folder for each field. Reason: the hosted helper's free daily requests are shared with the live site, which judges use from 16 Nov; this run would otherwise spend about 36,000 of the 100,000. Evidence it reads identically: the read-only check at 21:15 gave Y-01's stacks pixel-identical through this local code. The identity check below (all 4 SIA-done fields, Physics' rule) runs through the same local code and gates the run as before. 5 workers (peak 0.30 GB each).
  - **15 Nov 2026, 23:04 IST — identity check (the helper's code on this Mac, index lists at -0.01 deg): FAILED, the run stopped.**
    Y-01: local helper did not start
    Y-12: local helper did not start
    Y-15: SIA 559 listed (556 read) / index 569 listed (556 read); 18 pass x detector stacks compared; edge_dropped 2; pixel max |diff| 0; 556 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
    Y-27: local helper did not start
- **16 Nov 2026, 01:03 IST — the 22:22 attempt stopped at the identity step (plumbing, not data); fixed and restarted.** Three of the four local helpers failed to start ("Address already in use", a shared inspector socket, plus a leftover test instance on port 8799), so only Y-15 was compared: IDENTICAL (18 pass × detector stacks, max |diff| 0, 556 truth IDs present). Fix: each helper gets its own HTTP and inspector port, starts are staggered 10 s per slot, each start waits up to 90 s for a ready check and retries up to 3 times, and stopping kills the whole process tree. The identity check reruns on Y-01, Y-12 (in full) and Y-27; all four must be IDENTICAL on file before any new field (Physics).
  - **16 Nov 2026, 04:10 IST — identity check not completed (no comparison made, so neither passed nor failed on the science).** Y-15 stays IDENTICAL (23:04). Y-01, Y-12 and Y-27 were checked at the same time, each with its own local helper, and most reads timed out ("helper unreachable": 232 of 296, 289 of 388 photos), so the runner stopped before any new field, as the rule says.
    - Why (probe, 04:15-04:35): from this Mac one photo is about 80 trips to NASA's bucket in the US at about 0.33 s each (~26 s, ~230 kB), so the read is limited by distance, not download size. One helper with 32 requests at once read 64 photos with no errors; two helpers at once share one bottleneck on the home network and time out. So three at once could not work.
    - Change: one local helper, one field at a time, 24 requests at once (READ_CONC); a field whose read hits helper errors gets one more try. Nothing that reaches the science changes. Restarted 04:37 IST on Y-01, Y-12, Y-27; same rule: all four IDENTICAL or the run stops.
  - **16 Nov 2026, 05:32 IST — Y-01 IDENTICAL; Y-12 differs (the list, not the read).** Y-01: SIA 285 listed (285 read) / index 296 (286 read), 18 stacks, max |diff| 0. Y-12: SIA 457 (454 read) / index 519 (452 read); stack counts p1_D3 35→33, p1_D6 32→31, p2_D3 22→21, pixel max |diff| 20.4 / 1.74 / 11 (p2_D3 NaN pattern differs); 4 truth photos, all of observation 2026W04_1A_0462, not in the index list. Every photo read cleanly (READ_CONC=24).
  - **16 Nov 2026, ~06:00 IST — the index margin set from a measurement (Physics' rule).** For all 1,663 photos in the four done fields' truth files (Y-01 285, Y-12 453, Y-15 556, Y-27 369), how far the field centre sits outside the index's footprint: none is missing from the index and none is outside its circle; 14 are outside its square, by 0.0003-0.0223 deg (worst 0.0223 deg = 13 px, 2026W06_2A_0443_4 D4 in Y-27; then 0.0213 and 0.0203 in Y-12's 0462_1). Per field, the worst: Y-01 +0.0003, Y-12 +0.0213, Y-15 -0.0150 (all inside), Y-27 +0.0223. Margin = max(0.05, 1.5 x 0.0223) = **-0.05 deg**; the worst is below 0.04, so no pause. Why the index falls short: it stores each photo as a square (centre, position angle, half-diagonal rounded to 0.001 deg), while real footprints are slightly distorted quadrilaterals, so a few corners stick out by up to about 13 px. Y-27 at -0.01 is expected to miss those 5 photos (a second data point). Next: identity on all four fields at -0.05, one at a time; all four IDENTICAL or stop.
  - **16 Nov 2026, 05:51 IST — identity check (the helper's code on this Mac, index lists at -0.01 deg): FAILED, the run stopped.**
    Y-01: SIA 285 listed (285 read) / index 296 listed (286 read); 18 pass x detector stacks compared; edge_dropped 3; pixel max |diff| 0; 285 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
    Y-12: SIA 457 listed (454 read) / index 519 listed (452 read); 18 pass x detector stacks compared; edge_dropped 11; pixel max |diff| 20.4; 453 photo IDs from the truth files checked; 7 DIFFERENCES
        p1_D3: SIA 35 photos, index 33
        p1_D6: SIA 32 photos, index 31
        p2_D3: SIA 22 photos, index 21
        p1_D3 image differs: max |diff| 20.4, NaN pattern same
        p1_D6 image differs: max |diff| 1.74, NaN pattern same
        p2_D3 image differs: max |diff| 11, NaN pattern differs
        4 photos with fakes are not in the index list, e.g. [('2026W04_1A_0462_1', 3), ('2026W04_1A_0462_1', 6), ('2026W04_1A_0462_2', 3)]
    1 field(s) differ: stop and tell Physics
    Y-15: SIA 559 listed (556 read) / index 569 listed (556 read); 18 pass x detector stacks compared; edge_dropped 2; pixel max |diff| 0; 556 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
    Y-27: SIA 370 listed (369 read) / index 388 listed (364 read); 18 pass x detector stacks compared; edge_dropped 2; pixel max |diff| 0; 369 photo IDs from the truth files checked; 1 DIFFERENCES
        5 photos with fakes are not in the index list, e.g. [('2026W06_2A_0443_2', 1), ('2026W06_2A_0443_3', 1), ('2026W06_2A_0443_3', 4)]
    1 field(s) differ: stop and tell Physics
  - **16 Nov 2026, 06:20 IST — why Y-27's stacks matched at -0.01 though 5 truth photos were missing (Physics asked to check, not presume).** The 5 photos (2026W06_2A_0443 2D1, 3D1, 3D4, 4D1, 4D4, all pass p1) put the field centre 0.14, 2.6, 1.2, 5.0 and 3.8 px from the detector edge, under the 8 px edge rule, so the SIA run dropped them before stacking: its edge_dropped is 7 = the index run's 2 + these 5. They were in the truth files (fakes were injected) but added 0 pixels to any stack.
  - **16 Nov 2026, 07:24 IST — identity check (the helper's code on this Mac, index lists at -0.05 deg): PASSED, the run continues.**
    Y-01: SIA 285 listed (285 read) / index 320 listed (286 read); 18 pass x detector stacks compared; edge_dropped 3; pixel max |diff| 0; 285 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
    Y-12: SIA 457 listed (454 read) / index 531 listed (456 read); 18 pass x detector stacks compared; edge_dropped 11; pixel max |diff| 0; 453 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
    Y-15: SIA 559 listed (556 read) / index 583 listed (556 read); 18 pass x detector stacks compared; edge_dropped 2; pixel max |diff| 0; 556 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
    Y-27: SIA 370 listed (369 read) / index 411 listed (369 read); 18 pass x detector stacks compared; edge_dropped 7; pixel max |diff| 0; 369 photo IDs from the truth files checked; IDENTICAL
    ALL IDENTICAL
  - **17 Nov 2026, 00:56 IST — reads in flight lowered from 24 to 12 for the next fields.** Round 2 lost Y-02, Y-07, Y-16, Y-35 (helper unreachable: one photo failed 4 tries of 60 s each) and Y-36 (StopIteration, being checked). Line tested at 01:00: 3.3 MB/s, 0.3 s connect, but single S3 reads took 2-15 s; the Mac was not busy (load 2). Fewer reads at once gives each one more of the line. Transport only: the photo list, the reads and the stacking are unchanged; each field's run.json records the read_conc it used (yardstick_inject.read_conc(), read_conc.txt).
  - **17 Nov 2026, 01:04 IST — Y-36 StopIteration explained and closed (transport, not an empty science case).** Line: smo/scene/psf.py:72, `next(iter(planes.values()))` on an ePSF with no planes. Cause: a PSF download cut off just after its header (slow line): psf_from_bytes then gives 0 planes with no error (test: header-only 5,000 bytes -> 0 planes; a cut inside the data -> TypeError; full file -> 441). Re-fetching all 12 of Y-36's ePSFs (6 detectors x DR1/QR3) at 01:20 gave 441 or 451 planes each (3.87 or 3.95 MB), so nothing in the data is empty. Fix: inject_io.psf_for now requires the whole extension the header declares (psf_complete) and a non-empty plane set, tries 3 times, then stops the field as a read error (RuntimeError, retried by the runner). Fields already done are unaffected: an empty PSF stops the run (as here) and a partial one raises, so every completed field had full PSFs. The failed attempt's output is set aside, not deleted: pipeline/yardstick_inject/_failed/Y-36_0048/ (its stacks_base.npz is never reused: run_field always rebuilds and saves it before loading).
  - **17 Nov 2026, 01:05 IST — plane-boundary cut checked (Physics' point a).** The ePSF table is 441 rows (one plane each) of 8,752 bytes (NAXIS1). Cuts exactly on row boundaries after 1, 220 and 440 rows all raise TypeError ("buffer is too small"): astropy reads the NAXIS2 the header declares and refuses a short buffer. Only a cut with no data at all gives 0 planes silently, the Y-36 case, which now stops the field. So no done field can have used a partial plane set; no per-field ePSF re-check is needed (point b).
  - **17 Nov 2026, 03:30 IST — registered set scored (40/40 fields, T = 11.19, yardstick_score.py unchanged): 23 of 3,480 fake-pair rows found.** Round 3 ended 03:25 (Y-02, Y-07, Y-16, Y-35, Y-36 all done). Copy of the score: notes/yardstick_score_registered.json. Every registered bin is 0-6% except PM 3-10"/yr on 12-month pairs (up to 15%, W2 14-15 isolated 6/39). Detectors of the found ones: 20 on >= 3, 3 on 2. Rate bias of the found ones: median 1.00.
    The registered headline (W2 at 50% for PM 1-3"/yr, 12-month, isolated, logistic in W2) is not meaningful: completeness does not fall with W2 here, so the fit returns -6.97 (bootstrap -13.95 to -0.37). It is reported as computed, not used.
    Why: the search's significance is shift / steady-star scatter (season_pairs.py; pixel 6.15", scatter about 0.13-0.15 px), so it depends on how far a source moves between passes, not on how bright it is. The injection itself is right: a W2 12.2 fake peaks at 2.7 against a pixel noise of 0.006 (Y-02 p1), and where a candidate sits on a fake its shift matches in size (within 2-14%) and direction (within 11 deg). Every registered fake moves under 10" (1.6 px) between the passes compared. Found fraction by true shift (all W2, both pair kinds):
      isolated:  0-2" 0/1449;  2-4" 3/414 (0.7%);  4-6" 3/177 (1.7%);  6-8" 3/48 (6%);  8-10" 9/40 (23%, CI 11-39%)
      anywhere:  0-2" 0/899;   2-4" 0/277;         4-6" 1/116 (0.9%);  6-8" 3/34 (9%);  8-10" 1/26 (4%)
    So at T = 11.19 this search does not find movers that shift less than about 1.3 px (8") between passes, at any brightness. E1 (shifts 5-160", running now) measures where it reaches 50%. No site change without Physics' review.
  - **17 Nov 2026, 03:35 IST — Physics' review of the registered score, and why each fake was missed (pipeline/yardstick_misses.py, analysis only; the search and the scoring are unchanged).** Physics confirmed the reading: significance = shift / one scatter number per field-pair, so at T = 11.19 a candidate needs a shift >= 1.45-1.68 px (8.9-10.3"), and the registered grid lies almost all below that cut. The −6.97 headline is reported as computed and not used.
    Correction to the 03:35 entry ("whatever its brightness"): brightness does matter, one step earlier. Causes over all 3,480 rows, first that applies: not detected in the all-season reference 2,028; below T 917; detectors disagree 364; fit centre at the ±2 px bound 148; found 23. (No row was above T and failed only the PM tests.) Copy: notes/yardstick_misses_registered.json.
    Not detected in the reference, by W2: 12-13 20%, 13-14 37%, 14-15 51%, 15-16 69%, 16-17 76%, 17-18 94%.
    Why even bright fakes are missed: the reference is the median over every pass × detector stack, and the fakes have brown-dwarf spectra that are bright in only some of the 6 SPHEREx detectors. Checked on 20 fields: a fake's stack-minus-base peak above 5 robust sigma in 0-2 detectors -> almost always not in the reference; in 5-6 detectors -> almost always in it.
    By family (detectors where visible): bd500: 99 of 100 in <= 2 detectors (1 in all 6), so almost never in the reference; bd900 mixed; bb4000 mostly 6.
    So v1's median reference drops the coldest brown dwarfs before any shift is measured. This is v1's registered behaviour and stays as it is. It is a finding for the site's limit sentence and for a v2 design (for example a reference per detector, or a max/sum over detectors), not a change to this run.
  - **17 Nov 2026, 03:35 IST — Physics accepted the miss split (the causes add up to 3,480; the reference is a nanmedian over pass × detector, season_pairs.py:130).** Site wording to use once E1 is in: the shift condition (more than about 1.5 px between passes) for sources that are in the reference, plus "brown dwarfs as cold as ~500 K (bright only in the longest-wavelength detectors) are mostly not detected at all, because the search's reference image is a median over all detectors". Not "the coldest": the 900 K family is mixed.
    E1 fit_at_bound is to be read by shift bin against the registered low-shift baseline (isolated, 0-2": 53 of 1,449 rows, 3.7%; these are fits wandering off a faint or blended source, not a real shift). Only an excess above that baseline counts as the ±2 px fit-window limit. The W2 check at 11-15" comes from E1; the registered set has no shifts that large.
  - **17 Nov 2026, 23:32 IST — E1 done (40/40, 23:28; Y-28 retried after a helper error under VPN) and scored at T = 11.19 with the same scripts (YARD_EXT=E1). 107 of 3,219 fake-pair rows found.** Copies: notes/yardstick_score_e1.json, notes/yardstick_misses_e1.json.
    Isolated, all W2, found by true shift: 5-10" 21/412 (5%); 10-20" 45/637 (7%, CI 5-9%); 20-40" 5/591 (1%); 40-80" 0/231; 80-160" 0/29. Completeness never reaches 50%, so there is no 50% shift to quote. Detectors of the found ones: 91 on >= 3, 16 on 2.
    Causes over 3,219 rows: not in reference 2,406; below T 294; fit at the ±2 px bound 238; detectors disagree 157; failed PM tests 17; found 107.
    Isolated, by true shift (in reference / all; then found and at-bound as a share of those in the reference):
      4-6" 26/90: 12% / 4%
      6-8" 65/189: 17% / 12%
      8-10" 49/151: 16% / 37%
      10-12" 38/148: 24% / 37%
      12-15" 50/204: 40% / 26%
      15-20" 53/285: 30% / 47%
      20-25" 30/198: 17% / 73%
      25-30" 12/149: 0% / 83%
      30-40" 18/244: 0% / 44%
      40-60" 16/173: 0% / 62%
    The at-bound baseline (Physics, 17 Nov) is the registered isolated 0-2" rows: 53 of the 616 in the reference, 8.6%. E1 is well above it from 8" up and at 73-83% at 20-30", so the upper edge is the fit window (box r = 3 px, centre bounded ±2 px), as Physics predicted.
    The reference loses more fakes as the shift grows: not in the reference 71% at 4-6", 75% at 12-15", 85% at 20-25", 92% at 25-30". A source that moves far between passes is smeared or split in the all-season median (Physics' point b), and the cold-spectrum loss adds to that.
    W2 at true shifts 11-15", isolated: 12-13 14/37 (38%); 13-14 6/54 (11%); 14-15 4/43 (9%); 15-16 1/61 (2%); 16-17 0/43; 17-18 0/43 (all not in the reference). Anywhere: 16%, 7%, 4%, 3%, 0, 0.
    So v1 at T = 11.19 finds at most about 40% of the movers that reach its reference, and only when they shift 12-15" between passes. Overall it is at most about 10%, falls off past 20" (fit window), and is zero fainter than W2 16. No site change until Physics has reviewed this.
  - **17 Nov 2026, 23:34 IST — Physics reviewed E1 and signed the limit sentence with four edits.**
    1. The shift cut is 11.19 × each field's own scatter, so it is not a hard 9-10".
    2. "~40%" is scoped to isolated fakes that reach the reference; completeness overall is never above ~10%.
    3. The text says "falling past ~20", none beyond ~25"".
    4. W2 checked over all 130 finds (23 registered + 107 E1): the faintest found is W2 15.78. Registered finds by W2 12/13/14/15: 6/5/10/2. E1: 49/33/16/9. None is fainter than 16.
    Recorded, not explained away: at 8-10", the at-bound share of in-reference fakes is 18/49 in E1 against 2/19 in the registered set. That is borderline on these numbers, and the two fake mixes differ.
    Signed text (site use is Sumit's call; not on the site):
    "At the registered false-alarm rate (≤1 per 100 field-pairs), the season-pair search needs a mover to shift by more than about 1–1.5 px (≈5–10″, set by each field's steady-star scatter) between passes, and its completeness never passes about 10% at any shift. In uncrowded sky it finds at most ~40% of the movers its reference image detects, best at 12–15″ shifts, falling past ~20″ and none beyond ~25″, where the shift outgrows the search's ±2 px position-fit window. Crowded sky does worse. Most of the registered 0.3–10″/yr range falls below the shift cut. Brown dwarfs as cold as ~500 K (bright only in the longest-wavelength detectors) are mostly not detected at all, because the reference image is a median over all detectors, and no fake fainter than W2 16 was found in either run (faintest found W2 15.8 of 130)." Plus the N4/Sonora clause as agreed.
