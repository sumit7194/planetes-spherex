# Pre-registration: the detection yardstick

*Status: **FROZEN** (2026-10-25). Reviewed by The Bridge. Sumit accepted every `PROPOSED` value as written, so "PROPOSED" below now reads "registered". Patches were chosen by the committed script and seed (§11). The freeze commit is the commit that sets this status line. Any change from here on is a numbered amendment.*
*Rules this file follows: `~/Github/WorkingPractices/HOW_WE_WORK.md` §2 and §3, and `prereg/PREREG.md` (quarantine, ledger, Amendment 1: QR2 only).*

---

## 1. Why this exists

Every test so far measured a stand-in ("do the leftovers look clean?"), never detection. Pilot 1b was judged on leftover cleanliness, and that metric would not have told us whether any extra asteroid was found. From now on, **one end-to-end yardstick judges every method**: the scene fit, the per-pixel median, the cross-exposure attention model, the static-sky renderer, and anything later. Leftover statistics stay as diagnostics and never decide anything.

The question the yardstick answers: **at a fixed false-alarm rate, how faint a moving object does the method still find, and does that hold for real known asteroids as well as for fakes?**

## 2. Terms

- **Exposure:** one 113.6 s frame from one detector.
- **Visit:** one observation ID: up to 4 exposures about 129 s apart, each taken by a simultaneous detector pair (D1/D4, D2/D5 or D3/D6). So a visit has up to 8 frames at a given sky position.
- **Patch:** a 1 deg² square region (the cutout size already used), with every QR2 exposure that covers its centre.
- **Area-visit:** one square degree of searched sky in one visit. False-alarm rates are counted per area-visit.
- **Method:** anything that turns frames into a candidate list. Every method outputs, for each visit, a table with candidate RA, Dec, a reference time (visit mid-time), a score (higher means more mover-like), and optionally a rate and direction.

## 3. Patches

Patch centres are chosen by a committed script with a committed seed, **before** any image in them is opened. Each centre must be at least 1.5° from every quarantined region (PREREG §2), and from every other chosen patch. Each patch is added to the PREREG data ledger before it is opened.

| Tier | Count | Rule | Use |
|---|---|---|---|
| D (development) | D-1 (existing) + 1 new, D-5 | D-5: \|β\| between 35° and 55°, 25° < \|b\| < 65° | Tune v0 thresholds and every method's free settings. Looked at freely |
| V (validation) | 3 | \|β\| < 5°; one each with \|b\| in [50°, 70°], [25°, 45°] and [8°, 20°] (the last is the crowded, near-Milky-Way case) | Method comparisons. Every evaluation is logged in §10 before it runs |
| N (null) | PROPOSED 11 + 2 crowded | 35° < \|β\| < 55°, both hemispheres: 11 with 25° < \|b\| < 65°, plus at least 2 with 8° < \|b\| < 20° so that crowding is in the threshold-setting nulls | False-alarm rates. Any number of evaluations, all logged |
| T (test) | 3 | Same rule as V, drawn separately | Scored **once**, at the end of the proof of concept |

- Splits are by patch. A patch is in exactly one tier.
- **Power for the null tier:** the false-alarm rate at the primary operating point (§6) needs at least 30 expected false alarms for a ±18% statistical error. At 0.1 per area-visit that is ≥ 300 area-visits, about 11 patches at roughly 27 visits each. The count is PROPOSED because the visit count at \|β\| ≈ 45° is not yet known. The script reports it from the IRSA index, without opening pixels, and the count is fixed from that before the freeze.
  - *Result at selection:* 11 N patches with 860 visits in total, so the minimum of 11 applied. Visit counts per patch are 37 to 101, higher than the ~27 assumed above.
- **Coverage:** a patch is taken only if the QR2 visits covering its centre span at least 120 days, so two survey passes exist for the "absent in the other pass" rule. *(Added at selection, before the freeze: the obs_id code after the week is not a survey number, see `scripts/select_patches.py`.)*
- **Disk:** the 20 selected patches have 6,676 exposure-detector files in all. At about 3.8 MB per cutout (D-1's measured rate) that is about 25 GB, against 26 GB free at selection. Sumit will free more space. Raw cutouts are kept for every tier (the proof-of-concept fetch policy), so all methods run on identical inputs without re-fetching.

## 4. Fakes (positive truth)

- **Orbits:** fakes are cloned from real MPC orbits. Each clone keeps a real orbit's shape (a, e, i, Ω, ω) and gets a mean anomaly drawn uniformly, retained only if it falls inside the patch during a visit. Positions come from kete with SPHEREx as the observer, so rates, directions, curvature and parallax wobble are all realistic by construction.
- **Brightness:** the reference magnitude m_ref is the AB magnitude in the visit's short-wavelength detector (D1, D2 or D3) at that exposure's wavelength, averaged over the visit's exposures. It is drawn uniformly between PROPOSED 15.5 and 21.0, wider than the expected 50% point on both sides.
- **Spectrum across the visit's frames:** reflected sunlight times a reflectance slope (S-type and C-type drawn in PROPOSED 1 : 2 proportion), plus a thermal component from kete's NEATM at the clone's heliocentric distance. Albedo is drawn from the class's distribution. If kete's thermal model cannot be used, the fallback is recorded as an amendment before any injection run.
- **Rendering:** into the **raw IMAGE pixels**, before any method runs, using the exposure's zone-blended PSF with exact pixel integration, smeared along the motion over 113.6 s. Photon (Poisson) noise is added for the fake's own flux. The VARIANCE plane is updated to match. Fakes go into every frame of the target visit in which they fall, including near bright stars and in flagged regions. Nothing is avoided.
  - *Expected bias:* the injection PSF is the same model the matched filter uses, so fakes are slightly easier to find than real asteroids, whose light follows the true PSF. Any Δm in the realism gate (§10) is expected in that direction.
- **Target visit only (review, The Bridge):** each injection pass injects into **one target visit**. Every other visit of the patch, which forms the static context for that target, stays **un-injected**. Injecting into every visit would put about 30 fakes per deg² into each of ~27 context visits, far above the real mover density. That would penalise least-squares static models and reward robust ones for the wrong reason. The pass count rises accordingly. Seeds are derived from (patch, target visit, pass).
- **Rotational flicker:** each fake gets a sinusoidal light curve with amplitude drawn in PROPOSED [0, 0.3] mag and period in [2, 20] h.
- **Density:** at most PROPOSED 30 fakes per area-visit, at least 10 px apart. Several injection passes with different seeds build up the statistics.
- **Blinding:** truth tables are written by the injection step, SHA-256 fingerprinted and stored where method code never reads them. Truth meets candidates only in the scoring step.
- **The same injections for every method:** all methods compared on a patch see bit-identical injected frames.
- **No oracle access:** method code may not read kete predictions, known-asteroid lists, the MPC catalogue, or anything derived from them, for any V or T patch. Known asteroids in V and T patches are never used to train or tune anything. The only reader is the scoring step. (The N-far removal of known asteroids, §7, also happens in scoring, after detection.)

## 5. Known asteroids (real truth)

- Predicted by kete from SPHEREx's own position, for every MPC object in the frame (the 0.2″ JPL agreement is already verified).
- **Measured, not predicted, brightness.** Each known asteroid's visit flux is measured by forced photometry at its kete position, on the plain Gaia scene-fit residual. That fixed reference is independent of the method under test. Fakes are measured the same way. The realism comparison (Q3) uses this measured flux as the shared axis, because H, G predictions in SPHEREx bands carry ±0.3 mag or more of albedo and thermal uncertainty.

## 6. Scoring

- **Match rule:** a truth object (fake or known) counts as recovered in a visit if a candidate lies within PROPOSED 1.5 px (9.2″) of its position at the visit mid-time. Matching is one-to-one, greedy by candidate score. A candidate matched to an injected fake is removed before false alarms are counted.
- **Denominator:** every fake that lands on pixels with no FIT_REJECT flag in at least 2 frames of a visit, and inside the patch. FIT_REJECT is evaluated on the file's own FLAGS plane (`smo.data.flags`) with the frozen bit set, never on anything a method produces. So the denominator is purely geometric and the same for every method: a method cannot flag its way out of hard pixels. **Any area a method masks (around bright stars, for example) still counts in the denominator, so its fakes are misses there.** Masking cannot raise completeness.
- **Operating points:** the score threshold is set on the N tier at:
  - **primary:** FAR₀ = PROPOSED 0.1 false alarms per area-visit;
  - **secondary:** 1.0 per area-visit.

  *Reason for 0.1:* single-exposure depth is AB 17.0 to 18.6 (FINDINGS). Only a few known asteroids per deg² reach several sigma per visit, so a false-alarm rate of the same order would swamp a published list.
- **Completeness:** the recovered fraction per 0.25 mag bin of m_ref, with Wilson 95% intervals. Reported per detector pair and for all pairs together.
- **Headline numbers:** m50 and m90, the magnitudes at 50% and 90% completeness, from a logistic fit in m_ref, with bootstrap intervals over fakes and over patches. "Not reached" is reported as such.
- **Maps:** completeness against distance to the nearest Gaia source brighter than AB 16 (bins 0–2, 2–5, 5–10 and > 10 px), and against rate.
- **Fast movers separately:** orbit clones are mostly main-belt objects, so an overall m50 hides fast-mover performance. Completeness and m50 are also reported for rates above PROPOSED 1 px per exposure step (NEO-like), from the clones that reach those rates. If too few clones do, a dedicated NEO-orbit injection set (MPC NEO orbits, cloned the same way) is added.
- **Per-patch FAR on V and T:** N-scramble (§7) is also run on every V and T patch, on that patch's own background, and its FAR at the frozen threshold is reported. A method's V result counts only if its FAR measured on each V patch is within 2× of FAR₀.

## 7. Nulls (negative truth)

At least two nulls, built differently, so each can catch what the other misses.

| Null | Construction | What it can miss |
|---|---|---|
| N-far | The N patches as observed. Candidates within 1.5 px of any kete-predicted known asteroid (any brightness) are removed and the removed area is subtracted from the denominator. | Unknown high-inclination asteroids still present. This biases FAR upward, which is conservative |
| N-scramble | On the same N patches (and on every V and T patch, §6): pseudo-visits built from frames of 4 different real visits (same detector pair, same survey, wavelength order kept). The static context still excludes every real visit that contributed a frame. No mover can be coherent across a pseudo-visit. Static residuals, such as missing catalogue sources, are coherent at rate 0, which is correct, because they are genuine false alarms in real data too | Both directions. It misses artifacts that are coherent within a real visit (latents, ghosts that follow the pointing), which biases FAR down. It mixes backgrounds from different orbits (zodiacal and glow drift), so frame-to-frame differences are larger than within a real visit, which biases FAR up |

- **Agreement:** the two FARs at the same threshold are compared with an exact Poisson test. At p < 0.01 they disagree. The operating threshold then comes from whichever null gives more false alarms, and the disagreement is reported.
- **Dead-pipeline guard:** every null run carries a companion stream of injected fakes at PROPOSED 1 per area-visit. A null run whose companion fakes are not recovered at the completeness expected from §6 (within the Wilson interval) is **void**.
- **Median-split null** (two static models from disjoint visit halves, differenced) is added only if N-far and N-scramble disagree.
- **Survey-swap null** (PREREG §5) is kept for the full pipeline. It is not part of this proof-of-concept yardstick.

## 8. Confound controls (look-alikes that must not pass)

Planted in V and N patches, scored like movers, reported as their own classes:

| Look-alike | Planted as | Criterion |
|---|---|---|
| Flare on a static source | A Gaia or stack source's flux multiplied by 1.5 to 5 in all frames of one visit | Fraction reported as movers at FAR₀: PROPOSED ≤ 10%, reported per method |
| Stale catalogue position | For methods that use a catalogue: 1% of sources passed in shifted by 0.5 to 2 px (as a high-proper-motion star left at its 2016 position would be) | PROPOSED ≤ 5% reported as movers |
| One-time hit | A single-frame, single-detector point or streak of cosmic-ray shape | PROPOSED ≤ 1% reported as movers |

A candidate sitting on a catalogued or stacked static source is flagged "possibly variable" in every published list, whatever its score.

## 9. The first method entry: v0 detector

v0 is the baseline every later method must beat. It is specified here so it is fixed before validation data is seen. Its numeric settings are tuned on D patches only.

1. **Input:** the plain Gaia scene-fit residual of each frame (`smo.scene.pipeline.fit_cutout`), in native detector pixels. No resampling.
2. **Per frame:** a PSF-matched filter, giving an S/N map.
3. **Within a visit:** for each trial linear motion on a grid out to PROPOSED 3 px per exposure step, sum the matched-filter S/N² over all 8 frames along the track (a within-visit shift-and-stack, KBMOD-style). The score is the square root of the best sum.
4. **Hard requirement:** individual-frame S/N ≥ PROPOSED 2 at **at least two distinct exposure times**. The simultaneous partner frame is the same time and **does not count as a second time**. This rejects single-time hits such as cosmic rays. Agreement with the simultaneous partner detector enters through the score, not as a hard requirement, because faint and cold asteroids can be below the long-wavelength partner's depth. *(Agreed in review with The Bridge.)*
   - **Partner veto:** when the partner frame exists, a candidate whose signal comes from one detector at one time, with S/N ≥ PROPOSED 8 there and partner S/N < 1 at that position, is vetoed. A source that bright should show in both.
5. **Time-rule veto:** the same stacked statistic at the same sky position in every other visit. The candidate is vetoed if the median of those is ≥ PROPOSED 2, which marks a static source missing from the catalogue. This is the step that should handle the 73% of spikes the pilot found, and the yardstick will show whether it does.
6. **Threshold:** set on the N tier at FAR₀ (§6).

### Amendment Y1 (2026-10-25, before v0 was run on any data): the stack statistic

- **Defect in §9 as frozen:** step 3 sums S/N² along the track, and step 5 applies "the same stacked statistic" with a veto at median ≥ 2.
  - On pure noise, sqrt(Σ Z²) over about 8 frames has a median of 2.7 (the positive-part variant 1.8; simulated, 200,000 draws).
  - So the static veto as written would remove about half of all real movers.
  - An unsigned square also scores negative holes (over-subtracted stars) as highly as positive sources.
- **Change:**
  - Both the track score (step 3) and the static statistic (step 5) become the **signed linear stack** ν = Σ_f Z_f / √N over the N frames the track falls on. On calibrated noise ν is N(0, 1), and a static source gives ν > 0. This is the standard shift-and-stack likelihood statistic (KBMOD) for equal weights.
  - The static veto stays at median ν ≥ 2 over the other visits, at zero motion.
- **Details fixed at the same time,** not stated in §9:
  - seeds are local maxima (3 × 3) with Z ≥ 2;
  - the motion grid step is 0.25 px per exposure step;
  - duplicates within 1.5 px at t0 are suppressed, keeping the higher ν;
  - tracks with grid ν < 3 are dropped before refinement;
  - the reported score is ν recomputed with exact per-frame significance (`point_snr`, leverage handled) at the best grid motion;
  - "signal from one detector at one time" (partner veto) means the top frame carries ≥ 80% of Σ max(Z, 0)².
- **Why it is allowed:** v0 is a method whose settings are tuned on D patches (§9). No V, N or T pixel has been opened, and v0 had not run on any data when this was written.

### Amendment Y2 (2026-10-25, before v0 was run on any real data): sub-pixel accuracy

The noiseless end-to-end unit gate (synthetic frames, fakes through `inject`) found two defects in v0, both fixed before any real data:

1. **Half-pixel kernel offset.** The matched-filter kernel was rendered at the cutout's geometric centre, which is a half-integer for even-sized cutouts, such as clipped edge cutouts. That shifted the whole significance map by about 0.7 px. The kernel is now rendered at an integer pixel.
2. **Pixel-centre bias.** Bilinear interpolation of the peaked significance map pulled tracks towards pixel centres, biasing positions by up to 0.4 px and motions by up to one grid step. The map is now interpolated with cubic splines.

Two refinements were added at the same time:
- seeds get parabolic sub-pixel centroids;
- each surviving grid detection is refined on a sub-pixel grid: anchor ±0.5 px in steps of 0.125 px, motion ±0.25 px per step in steps of 0.125, using the same linear stack.

The reported score is ν recomputed exactly at the refined track. After these changes, noiseless fakes are recovered within about 0.05 px.

### Amendment Y3 (2026-10-25; full specification committed at 9607cc4 before the gate was re-run; **ADOPTED by Sumit, 2026-10-25**)

**Motivation, from development data only (D-1, v3; no V or T patch run by any detector):**
- §5 measures flux by forced photometry on the plain Gaia residual. That residual still contains static sources missing from Gaia, so an object sitting on one is credited with that flux.
- Known asteroids are mostly faint (about 220 per visit), while fakes are uniform in m_ref. So any upward scatter of the measured axis moves faint known asteroids into brighter bins far more often than fakes. Static contamination is one such scatter; plain noise (Eddington bias) is another (review, The Bridge).
- **Observed:** among known asteroids with forced ν ≥ 10, the 39 missed have a median static statistic of 9.7 (90% ≥ 2), and the 52 recovered have −0.07. In the forced ν 10–25 bin, fakes are recovered 130/148 and known asteroids 37/76.

**Revised gate (replaces the realism-gate procedure in §10; the headline completeness and m50 are unchanged):**
1. **Exclusion (primary).** Objects, fakes and known asteroids alike, whose t0 position has a plain-Gaia time-rule static statistic ≥ 2 are excluded from the gate. That is the median over the other visits of the zero-motion linear stack, on v0 maps. They stay in the headline completeness denominator as frozen; nothing is hidden there.
2. **Matched populations.**
   - Each fake gets a predicted V magnitude from its own spectral model: kete NEATM `v_band_magnitude` at its geometry, normalised to its m_ref, with the phase angle from r and Δ assuming a 1 AU observer distance.
   - Each known asteroid gets kete's H, G V magnitude, as predicted.
   - Fakes are weighted by w(V) = p_known(V) / p_fake(V): histograms in 0.25 mag bins over the overlapping V range, smoothed by a 3-bin running mean.
   - Fakes outside the known-asteroid V range get weight 0; known asteroids outside the fake range are excluded.
3. **Axis and test.**
   - The axis stays the §5 forced ν on the plain Gaia fit (linear stack over the visit's frames, ≥ 2 exposure times), as m_meas = −2.5 log10 ν_forced, with ν_forced > 0.5.
   - Weighted 3-parameter logistic fit to fake recovery; Δm for known-asteroid recovery by binomial maximum likelihood with the fake curve shifted.
   - 90% interval from 1,000 bootstrap resamples of both populations. TOST at ±0.2 mag.
   - The V pool decides the per-method gate; D+V may be pooled for the method-free check (as frozen).
4. **Sensitivity, reported, not deciding:** exclusion cuts of 1.5 and 1.0; the static-subtracted axis (forced ν minus the static statistic) without exclusion; and the unweighted gate. If the primary and the static-subtracted Δm differ by more than 0.2 mag, that is reported as a finding.
5. **Stop rule, pre-stated:** if the revised gate fails on D, the fakes are fixed (PREREG stop rule), not the gate again.
6. **Reporting addition:** every m50 is reported with the threshold's own uncertainty propagated, by bootstrapping the null events that set the threshold, as well as the completeness-fit interval.

## 10. How methods are compared

- **Better** means, at the primary FAR₀ on the V tier:
  - m50 is fainter by at least max(0.05 mag, 2σ) in at least 2 of the 3 detector pairs;
  - no pair is worse by more than 2σ;
  - it is not worse at the secondary FAR;
  - it meets every look-alike ceiling in §8 (**binding**: a method that wins on m50 but lets flares through is not better);
  - its per-patch FAR on every V patch is within 2× of FAR₀ (§6).
- **Learned methods:** the comparison holds for the mean over ≥ 3 seeds and at both of 2 training budgets (B2 = 4 × B1). A result that holds at one budget only is "budget-dependent", not better.
- **Q3 realism gate (an equivalence test, so low power fails it):**
  - **Data:** known asteroids pooled across all D and V patches. The gate tests fakes against reality, not methods against each other, so pooling is allowed. Known asteroids still never tune a method (§4).
  - **Model:** known-asteroid recovery against measured flux (§5) is fitted with the fake-derived completeness curve shifted by Δm, with a slope factor as a secondary fit.
  - **Pass:** the 90% interval of Δm lies inside ±PROPOSED 0.2 mag (two one-sided tests, TOST). Too few known asteroids gives a wide interval, which **fails**. The result is reported as a number, for example "fakes are 0.05 ± 0.08 mag too easy".
  - **On failure:** fix the fakes first (PREREG stop rule).
  - The gate is run per method, on that method's detections. Because a method tuned on D may recover D knowns better than unseen ones, Δm is reported separately for D-pool and V-pool knowns. **The V-pool TOST must pass**; the D-pool value is only reported. The method-free check of the fakes against reality (the plain v0 reference) may pool D and V.
  - Running the gate on V counts as a V look and is logged in the ledger like any other V evaluation.
- **Before any m50 is trusted**, these unit gates pass:
  - noiseless injection recovery is 100%;
  - the static reference never contains the visit being scored;
  - WCS round-trips;
  - flag handling is correct;
  - truth tables are unreadable by method code;
  - a null run with the dead-pipeline guard disabled gives the same FAR, within Poisson error, as with it enabled. Guard fakes must not change the null statistic beyond their own matched removals.

  Then a fresh agent does a harsh review of the scoring code.
- **Evaluation ledger:** every V-tier evaluation is entered here, with the method's config hash, **before** it runs. At most PROPOSED 10 V looks per method family. The number of V looks is reported with the final result. The T tier is evaluated once, at the end, for the methods still standing.

| Date | Method | Config SHA-256 | Tier | Result file |
|---|---|---|---|---|
| 2026-10-30 | v4: first V look, headline (`prereg/V_LOOK_1.md` items 1–5, 7) | `method_v4.json` d8514fc02ad3142f3456340025eb57a9d5b2e20829c206c5ffdc5d3e71b09437 | V-1, V-2, V-3 | `runs/yardstick/V_LOOK_1/v_look_result.json` |
| 2026-10-30 | v4: Q3 realism gate, V pool (`prereg/V_LOOK_1.md` item 6) | `method_v4.json` d8514fc02ad3142f3456340025eb57a9d5b2e20829c206c5ffdc5d3e71b09437 | V-1, V-2, V-3 | `runs/yardstick/V_LOOK_1/realism_v_pool.json` |

## 11. Freeze record

- **Patch-selection script and seed:**
  - `scripts/select_patches.py` with seed 20261025, committed before its first run (7f7f0e2);
  - survey-check fix d23f027, committed before the rerun;
  - the rerun with the same seed gave the same 20 patches as the first run.
- **Selected patches:** `prereg/patches.csv`, SHA-256 `6310ab4c467474530c8eb2bb48ea322870ca27f6f7a4bef55a31829710c5c8dc`:
  - D-5;
  - V-1 to V-3;
  - T-1 to T-3;
  - N-1 to N-11;
  - NC-1 and NC-2.

  Only IRSA metadata was read for them. No pixels have been opened.
- **Freeze commit:** the commit that sets the FROZEN status line (2026-10-25).

## Review log

- 2026-10-25: draft written (bccb30d). Sent to The Bridge for review.
- 2026-10-25: The Bridge's review applied:
  - (A) inject into the target visit only, with an un-injected context;
  - (B) per-patch FAR on V and T, and crowded null patches;
  - (C) no oracle access, and a cap on V looks;
  - the TOST realism gate with pooled known asteroids;
  - binding look-alike ceilings;
  - a partner veto, and the partner does not count as a second time;
  - both bias directions for N-scramble;
  - NEO-rate completeness reported separately;
  - FIT_REJECT taken from the file's flags;
  - the expected injection-PSF bias stated;
  - a guard-disabled null unit gate.

  Awaiting Sumit's sign-off on the PROPOSED values.
- 2026-10-25: The Bridge re-read 22a12af: **ready for sign-off**. Two final notes folded in without another round: the per-method gate needs the V-pool TOST to pass, with the D pool only reported; a gate run on V counts as a V look.
- 2026-10-25: Sumit accepted all PROPOSED values. Patches selected (§11). **Frozen.**
- 2026-10-25: **Amendment Y3 adopted by Sumit.** The D-pool reading under it: Δm = −0.037, 90% −0.097 to +0.018, PASS (FINDINGS).
- 2026-10-25: **Method v3 frozen** by Sumit's decision, for the null-tier calibration and the first V look (`prereg/METHOD_V3.md`, `prereg/method_v3.json`).
- 2026-10-25: **Method v4 frozen** by Sumit's decision (`prereg/METHOD_V4.md`, `prereg/method_v4.json`). It supersedes v3, whose bright-mover satellite false alarms the guard gate exposed. v4 is used for the null tier and the first V look.
- 2026-10-25 (later): **raw cutouts kept for now** (Sumit). Methods are still being improved, so the deletion step only verifies completeness while `runs/KEEP_RAW` exists. Process-then-discard resumes when the method settles, or if disk runs short.
- 2026-10-25: **Process-then-discard for N and NC patches**, by Sumit's decision (disk).
  - Each N or NC patch is fetched, mapped and run, after which its raw cutouts are deleted.
  - Kept: maps, results, sealed truth, and the fetch manifests (receipts with exact byte ranges and SHA-256), from which any cutout can be re-fetched.
  - V and T patches keep their raw cutouts.
- 2026-10-25 (night): D-5's visits, sorted by name, are split into quarters (every 4th visit, offsets 0 to 3).
  - **Quarter 0** is the development null for tuning v0.
  - **Quarters 1 to 3** are not run by any detector until a second, unspoiled development check, made before the first V look (review, The Bridge).
- 2026-10-26: **N and NC patches: process-then-discard resumes for T6** (Sumit: "delete each N/NC patch's v0 maps and raw cutouts after both methods' runs on it are complete and verified, receipts kept").
  - **Verification first** (`scripts/discard_raw.py`, run by `scripts/t6_cleanup.sh`):
    - the v0 maps are current;
    - v4's and v6's guard and scramble runs hold exactly their visit sets;
    - no frame was dropped by a failed fit and no task failed;
    - `known.json` exists.
  - **Then deleted:** the raw cutouts and the v0 maps.
  - **Kept:** the fetch manifests and every cutout's content hash.
  - `runs/KEEP_RAW` still keeps V and T raw files.
