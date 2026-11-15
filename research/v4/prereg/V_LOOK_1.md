# First V look: frozen v4 on V-1 to V-3 (registered 30 Oct 2026, before any V pixel is processed)

*Sumit's go, 30 Oct 2026 ("ok so lets do it"), on two stated choices: use v4's measured N-tier thresholds and report T6's "threshold unstable" flag beside the result; go ahead without the two crowded null patches (NC-1, NC-2) and say so. Everything below is fixed before any V detection runs. Ledger rows in YARDSTICK §10 are entered before it runs.*

## What is run

- **Method:** v4 exactly as frozen (`prereg/method_v4.json`, SHA-256 `d8514fc02ad3142f3456340025eb57a9d5b2e20829c206c5ffdc5d3e71b09437`). The runner refuses if any fingerprinted file differs (`check_frozen`). SuperLU for detection, as T6.
- **Data:** V-1, V-2 and V-3 raw cutouts, re-fetched from their 28 Oct receipts (`runs/yardstick/V-*/discard.json`): the same S3 key, the same pixel box, and the content hash must equal the recorded one (`scripts/refetch_verify.py`, result in `runs/yardstick/V-*/refetch.json`). A mismatched or failed file is recorded and never substituted; its frames are absent and counted.
- **Steps per patch, in order** (`scripts/v_look_queue.sh`), as for the N tier: v0 maps with SuperLU (CHOLMOD was cleared for N-tier maps only) (frames whose fit fails are recorded in `maps_failures.json` and handled by the T6 rule), v1 static lists, then v4 detection on:
  - `real`: the visits as observed (the search's actual output);
  - injection passes `0` and `1` (fakes at 30 per area-visit into the target visit only, context un-injected, YARDSTICK §4). Two passes give roughly 8,000 fakes, more than D-1's five passes (5,014), enough for per-pair m50s. The number is fixed here and is not raised after any result is seen;
  - `scramble_guard0`: N-scramble pseudo-visits on the patch's own background with the 1 per area-visit guard stream (YARDSTICK §6, per-patch FAR);
  - and `known.json` (kete), read only by scoring; each frame's area and WCS go to `areas.json` (`scripts/save_map_areas.py`), the FAR denominator.
- Stored candidates are trimmed to score ≥ 3, as on the N tier (`SMO_STORE_MIN_SCORE=3`); both thresholds lie well above 3.

## Thresholds (from the N tier only; no V output can move them)

- **Primary, FAR₀ = 0.1 per area-visit:** v4's T6 operating thresholds, pooled N-far and N-scramble on N-1 to N-11, N-4 and N-6 left out as guard-void, FAR₀/2 per rate band (`runs/yardstick/T6/t6_result.json`): **slow 13.356, fast 18.589.**
- **Secondary, FAR 1.0:** the same rule (`smo.score.t6.operating_thresholds` with far0 = 1.0) on the same kept null visits, computed by the V scorer from the N-tier files before any V file is read, and written to the result. If a band is "FAR-limited by storage floor", that label is reported.
- **Reported beside every number:** T6's verdict "THRESHOLD UNSTABLE" for v4 slow and v4 fast (GPD cross-check 10.50 and 24.11 against 13.36 and 18.59), and that NC-1 and NC-2 are not in the null.

## What is reported (the scorer, `scripts/v_look_score.py`, is written and reviewed by a fresh agent before it reads any V candidate)

1. **Headline:** completeness against m_ref in 0.25 mag bins with Wilson 95% intervals, and m50 and m90 from the 3-parameter logistic, at the primary and the secondary operating points; all V patches and passes together, and per detector pair (D1/D4, D2/D5, D3/D6). Denominator exactly as on D-1 and in T6: every rendered fake with ≥ 2 valid frames (`n_valid_frames >= 2`; the injection step applies FIT_REJECT and the patch bounds).
   - Intervals: bootstrap over fakes (500), bootstrap over the 3 patches (500; reported, and with 3 patches it is crude), and the threshold's own uncertainty from the 500-resample null bootstrap of the N-tier visits that set it (YARDSTICK Y3 item 6).
   - "Not reached" is reported as such (m90 was not reached on D-1).
2. **Fast movers:** completeness and m50 for fakes with rate > 1 px per exposure step, if at least 100 such fakes exist; otherwise the count is reported and no m50.
3. **Maps:** completeness against distance to the nearest Gaia DR3 source with G < 16 (bins 0–2, 2–5, 5–10, > 10 px), and against rate (≤ 0.25, 0.25–1, > 1 px per step). G stands in for "AB 16" (§6), stated as such.
4. **Per-patch FAR** (YARDSTICK §6): each V patch's N-scramble events above the primary thresholds after guard-fake matches are removed, per area-visit, with the Poisson 95% interval. **Reading of "within 2× of FAR₀", fixed now:** the result counts if each V patch's FAR point estimate is ≤ 2 × FAR₀ = 0.2. The two-sided reading (0.05–0.2) is reported too. A patch's expected count at FAR₀ is only about 1–2 events, so a zero is likely and is not a failure.
5. **Dead-pipeline guard on the V scramble runs:** recovered guard fakes against the expected fraction from the V completeness curve, as in T6's N-scramble: reported only.
6. **Q3 realism gate, V pool (YARDSTICK §10 and Y3; a separate V look):** the Y3 procedure exactly as `scripts/yardstick_realism.py` runs it on D-1, generalised to a patch argument with no other change. Fakes from pass 0 and known asteroids recovered in pass 0, at v4's primary thresholds (the T6 realism line used the same thresholds on D-1). TOST at ±0.2 mag; the V-pool TOST must pass for the per-method gate. The D-pool value (T6: Δm −0.05, 90% −0.135 to +0.030) is quoted beside it. The D+V pooled reading with v4's recovery is also reported. The method-free check with plain v0 is not run, because it would need v0 detection runs on V.
7. **The search's real output:** in the `real` runs, passing candidates above the primary thresholds, matched (1.5 px, scoring step only) to kete-predicted known asteroids. Recovered known asteroids are listed with their predicted V. Unmatched candidates are listed as "unexplained", each flagged "possibly variable" if it lies on a catalogued or stacked static source (§8), and none is called a discovery.

## Not done, and stated with the result

- **Look-alike controls (§8: flares, stale catalogue positions, one-time hits)** are not implemented in the pipeline and were not run on the N tier either. They are not run here, and no claim is made that v4 meets the §8 ceilings. They bind only when comparing methods.
- **Crowded nulls NC-1 and NC-2** are not in the threshold (Sumit's go, 30 Oct). V-3 (|b| 14°) is the crowded V patch; its per-patch FAR shows whether crowding breaks the threshold.

## V looks spent

Two of the ten for the v4 family: (1) the headline evaluation (items 1–5 and 7), and (2) the realism gate on V (item 6), which YARDSTICK §10 counts as a separate look. T is not touched.

## Amendment A1 (00:45 IST, 30 Oct 2026: after a fresh agent's harsh review of the scorer, before any V output exists)

The review found no wrong number in code already written, and no path by which V data could move a threshold. It found rules missing for cases that T6 met, and registered reports the scorer did not produce. Two plumbing bugs then turned up in a smoke test on N-9 files: a bin-edge expression, and a loader that raised on missing visits instead of counting them. All are fixed in `scripts/v_look_score.py` and `scripts/yardstick_realism.py` before any V output exists. The rules:

1. **Failed targets are counted, never silently dropped.** As T6 found, some targets crash before detection (the zone-weight injection crash, METHOD_V6 note 2).
   - **Real and scramble runs:** a failed visit or pseudo-visit is left out and listed.
   - **Scramble pseudo-visits with a dropped frame** are left out, with their area and their events above threshold reported, as in T6.
   - **Injection passes:** a failed target's plan is regenerated (same seed, same orbit snapshot; `yardstick_realism` already checks that this regeneration equals the sealed truth), and its denominator fakes count as misses.
   - **Realism:** a frame whose fit fails has its forced photometry dropped and recorded. Pass-0 failed targets are listed, not measured.
2. **The per-patch FAR reading (item 4) changes.** A V patch now fails only if its exact Poisson 95% lower bound exceeds 2 × FAR₀ = 0.2, i.e. only on evidence that the false-alarm rate is too high there.
   - **Why:** each V patch expects only about 1–2 events. The point-estimate rule registered above would fail a correctly calibrated threshold about 35–45% of the time across three patches (reviewer's computation: P(k ≥ 2 | 0.95) ≈ 25% for V-3 alone).
   - The point-estimate and two-sided readings are still reported. If they disagree with the deciding reading, the headline says so.
3. **T6's sensitivity lines are reported per V patch:** events above threshold within 1.5 px plus 3 steps of their own motion of any guard fake's per-frame position, and events in the left-out dropped-frame pseudo-visits.
4. **Intervals on every m50 and m90:** the fake, patch and threshold bootstraps for all fakes, per detector pair, per patch, and for fast movers if fitted. Completeness bins are reported per detector pair.
   - The threshold bootstrap uses seed 0 and T6's draw order, so at FAR 0.1 its thresholds are T6's own v4 bootstrap. The scorer stops unless the two half-widths agree.
   - Reached fractions are reported, so "not reached" is visible.
5. **Fast movers:** YARDSTICK §6 adds a dedicated NEO-orbit injection set when too few clones exceed 1 px per step (D-1 had 2 in 2,997). It is **not added** here, for time; the count is reported, with no m50. This joins "Not done".
6. **Rates for items 2 and 3** come from each fake's rendered positions (first to last valid exposure on the detector whose frames span the most exposures, per 129 s step). The truth field's rate is used, and counted, when a fake has only one valid exposure. The review measured the truth field at 0.82–1.09 of the rendered rate on D-1. The headline does not use rates.
7. **The "possibly variable" flag's chance rate** (the fraction of the patch's fake positions it would mark) is reported per patch beside it. In crowded fields it is high (36% in NC-1's cached cone, per the review).
8. **Bin edges** are (lo, hi], with the first bin closed at 0, matching "≤ 0.25" in item 3.

## Amendment A2 (00:58 IST, 30 Oct 2026: the reviewer's second pass, before any V output exists)

1. **A gap counts as a failed target only for the registered cause.** A visit missing from a finished step is accepted (and handled by A1) only if the step's log records exactly the registered injection crash for it: `FAILED AssertionError('zone interpolation weights do not sum to 1')`. Any other cause, such as a worker killed for memory or a full disk, stops the scorer, and the target is re-run.
2. **Regenerated denominators are checked first.** Before any failed target's plan is regenerated, a sealed visit of the same patch and pass is regenerated, and its seed and fakes must equal its sealed truth.
3. **The threshold bootstrap is drawn and checked before any V file is read.** Its resampled thresholds must equal T6's v4 half-widths exactly. The D-1 m50 half-width propagated through the same resamples must equal T6's (`completeness.v4.null_boot_half_width68`). This also checks the recovery path.
4. **Near-guard events are counted among the surviving events only**, after the guard-match removal. The count not near guard fakes is reported too.
5. **The patch bootstrap is not reported for per-patch subsets**, where it is degenerate.
6. **The A1 FAR rule has little power, and that is reported, not hidden.** A patch of about 10 area-visits fails only at 6 or more events, so a true FAR of 3× FAR₀ is caught only about 7–13% of the time, and 10× about 91–99% (reviewer's computation).
   - Reported per patch: the events needed to fail, and the true FAR at which failing has 80% probability.
   - Reported for V-pooled: the scramble FAR with its Poisson interval, reported only.
   - The headline flags any patch where the point-estimate reading disagrees with the deciding one.
   - More scramble area (new pseudo-visit permutations) would add power. It is a new run, so it is not done here.
7. **Refetch:** any file failing verification stops the look. Nothing is scored for it, and it goes to Sumit. This replaces "absent and counted" in "What is run". V-1 verified 293/293.

## Amendment A3 (02:30 IST, 30 Oct 2026: V-3 held for compute, before any V-3 pixel has been processed)

- **Measured cost, not results:**
  - V-1's plain scene fits took about 14 s per frame per worker with SuperLU (293 frames, 34 min at 2 workers, 0 failures).
  - V-2's took about 130–150 s per frame per worker (2 and 3 workers at 100% CPU). (Corrected 30 Oct 03:05 IST: an earlier line here quoted wall time per frame, 7 s and 74 s, as if it were the cost per frame.)
  - Their Gaia cones hold 7.5k and 15k sources. V-3's holds 31k, close to NC-1's 39k, whose fits took 30–70 min per frame (26 Oct). That cost is why NC-1 and NC-2 were held back.
  - Detection refits every target frame with SuperLU in each of the four runs. At NC-1's cost, V-3 would need hundreds of Mac hours.
- **So:**
  - V-1 and V-2 run as registered (`V_PATCHES="V-1 V-2"`).
  - V-3 is downloaded and verified (220/220), and is held. One V-3 frame is timed, for its fit time only.
  - What to do with V-3 goes to Sumit: run it as is if the time fits, wait for a cheaper crowded-field fit (a new method, so not this look), or report the look without it.
- **If the look is scored without V-3:**
  - The headline says so: the crowded validation case is not tested, the null tier has no crowded patches either, and nothing is claimed for |b| < 20°.
  - No other rule changes. Two V looks are still spent.
- **V-3 timing (measured 02:30–02:51 IST):**
  - One V-3 frame (2025W42_2A_0496_3_D3) took 1,287 s for its plain scene fit, single-threaded with SuperLU, and the fit succeeded.
  - So one full refit of V-3's 220 frames is about 77 worker-hours. The maps plus four detection runs need about five refits: about 385 worker-hours, roughly 5 days at 3 workers.
  - By the same arithmetic, V-1 and V-2 together need about 50 worker-hours (maps plus four detection runs), so about 25 h at 2 detection workers.
- **Decision (10:51 IST, 30 Oct 2026, Sumit: "Run V-3, score once").**
  - V-3 runs after V-1 and V-2 finish, exactly as registered: the same steps, 3 workers for maps and detection as memory allows.
  - The look is scored once, on all three patches, when every step has finished. Nothing is scored before then.
  - A3's "held" ends here, and the look stays as registered.

## Amendment A4 (23:00 IST, 30 Oct 2026: memory only, before any V-3 detection step; no V candidate has been read)

- **What changes:** V-3's detection steps run the injection plan in a short-lived child process (`SMO_PLAN_SUBPROCESS=1`, `scripts/yardstick_run.py` `_plan`). The function, its code and its inputs are unchanged; only the process it runs in differs. The child's memory is returned to the system when it exits. V-1 and V-2 ran without it.
- **Why:** detection memory limits how many V-3 workers fit. Sumit (30 Oct evening) asked for V-3 on at least 3–4 cores; the worker count does not change any output. On D-5 (30 Oct), the plan's clone search left about 1.2 GB in a detection worker's footprint after it returned, held through the long target fit.
- **Check (D-5, a development patch; `scripts/plan_subprocess_check.py`, visit 2026W04_1A_0056, mode 1, v4, store floor 3):**
  - The full detection task was run both ways and the record it would store was captured (the runner's own serialisation, minus wall-clock time).
  - The two records are byte-identical: 999,328 bytes each, SHA-256 6810956d…77bda2. Same counts: 10,532 candidates, 2,738 passing, 0 fit failures.
  - Plan level, earlier: 6 D-5 plans (3 visits × pass 1 and guard), value-identical in-process vs child.
- **Memory measured (phys_footprint, worker / child):**
  - In-process: 2,192 MB after the plan, 2,666 MB peak in the target fit.
  - Child: worker 761 MB after the plan, 2,052 MB peak in the target fit; the child peaks at 1,629 MB while planning and then exits. So the peak for one task is about 2.36 GB, briefly, during the plan, and about 0.6 GB lower than before through the fit.
- **Nothing else changes:** thresholds, steps, scoring and the one-score rule are as registered.

## Amendment A5 (14:15 IST, 8 Nov 2026: resume only, before the realism run (item 6); no realism output exists)

- **What changes:** `yardstick_realism.measure_patch` saves each visit's measurement as it finishes, in `runs/yardstick/V_LOOK_1/realism_cache/<patch>/`, and skips visits already saved, so a stopped run resumes per visit. Each file is written to a temporary name, flushed to disk, then renamed. A file that can't be read is measured again. The function, its inputs and the gate are otherwise unchanged; `v_look_score.py --realism` passes the cache folder.
- **Why:** the run refits each pass-0 frame twice and was expected to take about two days at 1 worker. This week the Mac restarted or a job was stopped about once every 12 to 24 hours, so a run that can't resume was unlikely to finish (Sumit 8 Nov: "Make it resumable"; Neural agreed and added the flush and the damaged-file rule).
- **Why it can't change a number:** a visit's measurement depends only on that visit (its own plan seed, its frames and the other visits' stored maps), and the rows are assembled in the same sorted order as before.
- **Check (D-1, a development patch, v4 pass 0, 3 visits; `scripts/realism_cache_check.sh` and `.py`, log `runs/realism_cache_check.log`):**
  - the code path as before (no cache): 833 rows, 0 fit failures;
  - a cached run killed after its first visit was saved, then resumed: equal to it;
  - a run read entirely from the saved files: equal to it;
  - the same with one saved file cut to 100 bytes: the file was reported unreadable, measured again, and the result was equal.
  - "Equal" counts NaN as equal to NaN: one row holds a NaN, which made a plain `==` report a difference in a first try.
- **Nothing else changes:** thresholds, the gate, its sensitivity lines and the one-look rule are as registered.
