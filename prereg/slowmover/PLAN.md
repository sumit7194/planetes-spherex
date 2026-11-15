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
