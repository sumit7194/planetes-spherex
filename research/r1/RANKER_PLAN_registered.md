# R-1 draft v5: a small "real mover vs junk" ranker for v4's candidates (Neural, Sat 14 Nov; NOT registered)

**Sumit, 14 Nov:**
- His decision 3 makes this the first learning piece.
- In Neural's session he said "Draft the ranker plan".
- He also said needed steps don't wait for his approval. Each stage below is still frozen before it is scored.

**v2 changes.** v2 fills the slots from Physics' answers (14 Nov); v1 (md5 4fb0401d…) is in Neural's backups.
- **No flag inputs:** OUTLIER fires on 67–88 % of real asteroids and never on fakes.
- **Stamps:** they are cut again from the caches.
- **Claim:** v2 used the m50 form. **v4 (Physics' marks) decides on the paired form instead:** fake loss plus junk reduction at v4's frozen T6 thresholds. m50 is descriptive. v3 (md5 d4607d7e…) is in backups.
- **The fake-only-tells check is pass/fail.**

**Sumit's two choices (14 Nov, in Neural's session):**
- (a) **train on the N fields too**;
- (b) **the final score uses T-1..T-3**, which are then spent.

## The question
Can a small learned ranker, given only what v4 already produces, cut v4's false alarms **without losing fakes**? Judged on Physics' injection yardstick, on sky it never trained on.

## What it is, and what it isn't
- **It is a re-ranker.** v4 stays the detector. The ranker scores each v4 candidate (0–1, "looks like a real mover") and is applied as a cut or as a sort order for review.
- **It isn't a new detector.** It sees only v4's candidates. Anything v4 misses, it misses.
- **It isn't the change-twins model.** Its last hidden layer may later be tested as change-twin features, in a separate registration (R-2).
- **CP80 isn't an input in R-1.** CP80 was cleared on DR1 for HO-type sky only (QD-1b). A "+CP80 leftover" input is a separate, later ablation.

## Data and labels (outside truth only, never the model's own past detections)
- **Unit:** one v4 candidate, i.e. a track over the steps of one visit.
- **Source:** v4's per-visit records, runs/yardstick/<patch>/v4/<step>/<visit>.json(.gz), read with gzip.open. They are never gunzipped in place.
- **Track numbers from the record:** v_xi/v_eta (rate, direction), n_frames, n_times_z2, z_frames (per-frame S/N), nu_grid, cheap_score, score, passes, hard_ok, veto_static, veto_partner, static_median.
- **Stamps:** cut again, since none are saved.
  - Per frame along the track, a 15×15 px stamp of data, v4's star-subtracted leftover (cache/v1maps) and variance.
  - From cache/cutouts (QR2) or cache_dr1, with frame lists in cache/patch/<patch>_frames.json.
- **Excluded inputs:**
  - **No FLAGS or OUTLIER bits** in any form. Flags are applied before injection, so fakes never carry OUTLIER while 67–88 % of real asteroids do. Flag inputs would teach "flag = real".
  - No 'masked' per-frame list as a feature either.
  - Masked frames are zero-filled, with no indicator.
- **Masked-frame tell check (R-0):** the masked-frame fraction must be similar for fakes and known asteroids. If it differs, zero-filled frames become a tell, and the input design changes before R-1a.
- **Code:** Physics' functions are imported from /Users/sumit/Github/SphereXVision/src, never patched:
  - `smo.score.yardstick.match`, `MATCH_ARCSEC`, `unseal`;
  - `smo.score.t6.band_of`, `SLOW_PX`, with thresholds from runs/yardstick/T6/t6_result.json (slow 13.356, fast 18.589).
  - `load_visit` can't read .gz, so Neural's own loader opens the file with gzip, then repeats load_visit's three lines (cited in a comment): unseal, keep fakes with no "skipped" and n_valid_frames ≥ 2, build VisitResult.
  - Known asteroids come from each patch's known.json, with positions linear in time from the visit's t0, as scripts/outlier_check.py does.
- **Positives (training):** candidates matched to an **injected fake** (within 1.5 px = 9.2″, `match`).
- **Known asteroids are not a training class.** They are few (D-1dr recovered 5) and are kept only for the fake-only-tells check.
- **Negatives:**
  1. candidates in the **time-scramble guard** (scramble_guard0), junk by construction. Scramble junk breaks the time structure that real-sky junk keeps, so it is **never the only** negative source;
  2. real-sky candidates vetoed by v4's own guards (veto_static, veto_partner, screened_out), with no fake or known match.
  - Results are reported per negative source.
- **Unlabelled, never used as negatives:** real-sky candidates with no fake or known-asteroid match. They may be real unknown asteroids.

## Sky split (by whole patch and visit footprint, never by candidate)
- **Train:** D-1, D-5 (QR2), D-1dr, D-1drB (DR1), CF-1, plus N-1..N-11 and NC-1/2 (Sumit, choice a).
- **Choose:** whole patches held out from that list. They are named in R-1a's frozen text from R-0's counts, before any training.
- **Score once:** Physics' untouched **T-1..T-3** (Sumit, choice b), spent by this one score. Never trained or tuned on, and the V fields are already spent. Physics runs v4 and the yardstick there.

## Candidates compared (all chosen on "choose" only)
- **C0: v4 alone** at its frozen T6 thresholds; this is the champion.
- **C1: no-AI baseline.** A gradient-boosted tree on the track numbers plus a few stamp summaries (peak/σ, PSF-fit χ², leftover symmetry). No flag bits.
- **C2: small CNN** on the per-frame stamps plus the track numbers. A few ×10⁴ parameters, CPU on the Mac.
- **Each cut is set on "choose"** to keep ≥ 99 % of the fakes v4 finds there above T6.
- **C2 goes forward only if** its junk reduction on "choose" (claim B's measure) is ≥ 10 % higher, relative, than C1's at that same cut rule. Otherwise C1 goes forward.

## The deciding test (paired, at v4's frozen T6 thresholds, on T-1..T-3)
- **Challenger:** v4 at its frozen T6 thresholds, with the chosen ranker's cut applied on top. It is measured on the **same** fakes and candidates as v4.
- **Claim A, fake loss:**
  - Of the fakes v4 finds above T6 on T, the share the cut drops. Its **one-sided 95 % upper bound must be ≤ 2 %** (Clopper–Pearson; the tile-cluster bootstrap is reported beside it).
  - T's injection passes are sized for about **300 found fakes at T6**, so that 1–2 losses can still pass. (At 150 fakes, only zero loss passes: 1 − 0.05^(1/150) ≈ 2.0 %.)
  - R-0 projects the yield from the D/N recovery rates at T6.
- **Claim B, junk reduction, at a level with real counts:**
  - Use the junk that matters: guard0 and scramble_guard0 candidates on T **above v4's secondary threshold (FAR 1.0: slow 7.658, fast 12.546)** that match no fake or known asteroid. The cut must remove **≥ 20 %** of them: the tile-cluster bootstrap 95 % lower bound ≥ 20 %.
  - R-0 counts these per visit, to check that the bound is powered. If they're too few, the junk set becomes the top-N junk by v4 score per visit, with N fixed in R-0's frozen result before R-1a.
  - At T6 the guards hold only single-digit false alarms, so the FA at T6 is descriptive only.
- **Also reported, no claims:**
  - FA per patch at T6 (C0 vs challenger);
  - re-thresholded m50 at FAR₀ 0.1;
  - completeness by magnitude and rate;
  - score histograms and calibration;
  - results by negative source and by detector;
  - known asteroids kept;
  - the share of unlabelled real-sky candidates kept.
- **Readings:**
  - **Helps:** A and B both hold, and the pass/fail check passed. The challenger becomes the live version.
  - **Doesn't help:** the fake-loss lower bound > 2 % (it clearly loses fakes), or the junk-reduction upper bound < 20 %. v4 stays alone.
  - **Inconclusive:** anything else.
- **PASS/FAIL before R-1b (fake-only tells):** done on held-out data.
  - Known asteroids from all non-T visits, matches below threshold included, are compared with fakes of the same magnitude and rate on "choose".
  - The test: the 95 % CI of the median score-percentile difference (known − fake) must include 0 or lie above it.
  - Needs ≥ 20 known asteroids.
  - On a fail the ranker has learned fake-only tells (fakes are ideal ePSFs and flag-free). R-1b doesn't run, and it is reported as a fail. Physics' realism gate checks recovery statistics, not stamps, so this check is the ranker's own.

## Stages (each frozen, then run; Mac CPU within Neural's 1500 MB)
- **R-0, inventory, no training, no T access.** Per train patch and step:
  - counts of candidates, hard_ok, above-FAR-1.0 and above-T6 candidates, fake matches above and below T6, veto counts, scramble counts;
  - known-asteroid matches over all non-T visits, below threshold included;
  - the masked-frame fraction for fakes vs known asteroids;
  - the projected number of found fakes at T6 per T visit and injection pass, and guard/scramble junk above FAR 1.0 per visit. These decide the T pass count (target ~300 found fakes) and whether claim B uses FAR 1.0 or top-N;
  - stamp cut time and size, measured on one visit.
  - **STOP rules:**
    - fewer than 2,000 fake positives or 2,000 negatives (per source) in train;
    - fewer than 20 known asteroids for the pass/fail check;
    - the masked-fraction check fails.
    Then the plan is revised first (more injections, or an input change), not run.
- **R-1a, development:** train C1 and C2 on train, pick on "choose", run the pass/fail check, freeze model, cut and code (md5s).
- **R-1b, locked score:** Physics' fresh v4 runs on T-1..T-3, then the paired test above, once.
- **Later, each its own registration:** R-2 (change twins from the ranker's features), the +CP80 ablation, the volunteer queue (uncertain cases plus a random sample, gold items, several votes), and the per-release drift check.

## What it can't say
- **Only v4's candidates.** Nothing about objects v4 misses, slow movers, or brown dwarfs. The season-pair search is a different component.
- **Only fakes as training truth, and known asteroids as a check.** "Precision on real sky" isn't measured until the volunteer random sample exists.
- **One release mix and field set:** other releases need the drift check.

## Cost
- **Neural:** stamps for a few ×10⁴ candidates, float16, tens of MB. CPU training inside 1500 MB. Measured at R-0 and posted to LEDGER.
- **Physics (R-1b only):** fresh v4 runs on T-1..T-3: maps, static, real, ≥ 1 injection pass, guard0, scramble. About 1 h and 7.5 GB per visit per step, so tens of hours per patch on this Mac. They are sequenced with Physics when R-1a is frozen, not before.

## Amendment 1 (14 Nov 18:50, before R-1a; from R-0 and Physics' marks; see PLAN.md §11)
- **Training labels:**
  - **Positives:** fake and guard-fake matches above FAR 1.0. There are 2,119, with a shifted-truth chance rate of 0.
  - **Known check:** the 39 unique knowns above T6.
- **Claim B junk set:** top-N = 5 per visit per guard (guard0 and scramble), by v4 score, passing, with no fake or known match.
- **T:** 136 visits; one injection pass (~680 found fakes expected).

## Amendment 2 (14 Nov, before T is touched; Physics' recommendation; Sumit may overrule)
- **T-1..T-3 run on DR1+QR3.** The product runs on DR1, IRSA recommends DR1/QR3, and v4 on DR1 matched QR2's depth on dev sky (17.68 vs 17.63).
  - v4 and its T6 thresholds stay frozen.
  - This is **v4's first scored run on DR1 held-out sky**.
  - The visit list (≈ 136 or more) is fixed when the frames are fetched, before any injection.
- **Split:**
  - **Train:** D-1, D-1dr, D-5, N-1..N-8.
  - **Choose:** D-1drB's **core only** (smo.sky.tiles ownership) + N-9..N-11.
  - D-1 and D-1dr candidates inside D-1drB's core are dropped from training.
- **Caveat:** choose still shares sky and visits with train. D-1drB overlaps D-1dr, D-1 covers the same sky, and real-sky junk repeats. So model and cut selection may be a little optimistic. The deciding score is on T, which is independent.

## Amendment 3 (14 Nov, R-1a design for C1, frozen before any training; from descriptive counts in PLAN)
- **Operating set:** passing v4 candidates with **score > 5.0**.
  - Positives: fake and guard-fake matches, 2,584 (shifted-truth chance rate 0.08 %).
  - Negatives: guard0 and scramble_guard0 candidates with no fake or known match: about 36k guard0 and 13k scramble.
  - Unlabelled, never used: real-step and pass-step candidates with no match.
  - The "vetoed real-sky" source is dropped: vetoed candidates are mostly not passing, so they never reach v4's operating point. R-0's vetoed count was also inflated, because veto_partner is sometimes the string "False".
  - Both classes come from the same score range. Otherwise the model would just relearn v4's score.
- **C1 (no stamps):** sklearn 1.7.2 HistGradientBoostingClassifier with fixed settings, no tuning: max_iter 300, learning_rate 0.05, max_leaf_nodes 31, l2_regularization 1.0, class_weight balanced, early_stopping off, random_state 0.
  - **Features:** rate in px/step, band, n_frames, n_times_z2, nu_grid, cheap_score, score, static_median, and z_frames over finite values (max, mean, min, std, number finite).
  - **Excluded:** masked, nu_masked, flags, vetoes, hard_ok, passes, positions and times. The "stamp summaries" move to C2.
- **Split:** train = D-1, D-1dr, D-5, N-1..N-8, without D-1 or D-1dr candidates inside D-1drB's core (Tiling.owner, tile (1, 0)). Choose = D-1drB core + N-9..N-11.
- **Cut:** on choose, the ranker-score threshold that keeps ≥ 99 % of the fakes v4 finds above T6 there.
- **Reported on choose (descriptive):**
  - fake retention;
  - junk reduction on the top-5 per visit per guard and above FAR 1.0;
  - C0 vs C1.
- **Pass/fail tells check:** each of the 39 above-T6 knowns gets its ranker-score percentile among choose fakes in the same band within ±0.5 mag (m_ref vs v_mag). It passes if the 95 % bootstrap CI (10,000, rng 0) of the median percentile − 50 has its upper end ≥ 0.
- **C2:** stamps, later. It waits on Physics' fake re-rendering function.

## Amendment 4 (14 Nov, after C1's choose results, before anything touches T)
- **C2 is moot.** C1 removes 96.9 % of choose's top-5 junk, so C2 can't reach the frozen bar (≥ 10 % more relative junk reduction). **C1 goes forward.** No stamps are needed for R-1; a stamp model is a later registration if wanted.
- **Cut rule, made stable** (reason: power for claim A, from arithmetic, not from T):
  - The frozen cut ("keep ≥ 99 % of choose's T6 fakes") sits at the minimum of only 74 fakes. That means an expected loss of about 1/75 on T, which could fail the 2 % one-sided bound with about 680 fakes by chance.
  - **New cut:** pool the out-of-fold C1 scores of train's above-T6 fakes (5 folds grouped by patch, same settings) with the final model's scores on choose's above-T6 fakes. The cut is the **0.2 % quantile** (keeps 99.8 %).
  - The final model stays the one trained on all of train. The fold models only set the cut.
  - Choose's junk reduction is reported at the new cut.

## Amendment 5 (14 Nov, before T): rate dependence
- **Finding:** C1's permutation importance is dominated by rate_px (AUC drop 0.21; next 0.012). The ranker leans on "typical asteroid rate".
- **Before R-1b (descriptive, flagged below 95 %):** C1's retention at the frozen cut for D-1dr's NEO injection passes (pass100–108, never trained or chosen on), above T6, overall and by rate bin.
- **In R-1b (descriptive):** fake retention at the cut by rate bin (v4's 0.25–3 px/step grid in 5 bins), beside claim A.
- **Neither changes claims A and B.** A low NEO retention is reported to Sumit as a product limit: a re-ranker that suppresses NEOs shouldn't be the only queue.
- **Physics' marks on Amendment 5:**
  - Because C1 learned the clone-rate distribution, **claim A on T is partly easy by construction**: T's fakes come from the same clone distribution. **The NEO retention is the real stress test.**
  - **NEO set:** D-1dr pass100–108 (53 records each; truth in the worktree's cache/truth). Retention is reported overall and by rate bin 0.25–1, 1–2 and 2–3 px/step. The 2–3 bin holds only about 2 fakes, so retention above 2 px/step **can't be judged** from it.
  - **Also descriptive:** (i) retention of the 34 above-T6 knowns by rate bin at the cut; (ii) the junk removed by rate bin. If the cut mainly removes junk at rates where few asteroids move, it's reported plainly as a rate prior, not a "real vs junk" eye.

## Amendment 6 (14 Nov, before any T record exists; Physics' sizing)
- **T cutouts:** 257 px, the event-day tile size, because disk rules out 585 px (about 1.5–2 GB in all). That gives about 2 found fakes per visit per pass.
- **Two injection passes:** T runs pass0 and pass1, with independent seeds via seed_for.
- **Claim A** pools pass0 + pass1 fakes found above T6; clusters stay (patch, visit). About 540 found fakes are expected.
- **Scorer:** code/r1b_score.py md5 13c0ddfb… (the previous version, 9fedfbe8, is in backups).

## Amendment 7 (Sat 14 Nov 23:26 IST, Neural; before any T injection or detection)
Physics froze the T visit list: /Users/sumit/Github/SphereXVision/runs/qr3/wt/runs/yardstick/T/visit_list.json, sha256 56ad8034ea1987c28d87df6d1488ecd4ec454c28ce7f3d371d03569c4999c648 (qr3-adapter a26f76a). It has 162 visits: T-1 45, T-2 59, T-3 58, all DR1+QR3 at 257 px.
The frozen scorer (md5 13c0ddfb) could not read this format: it expected a flat list, and would have stopped with an error at the first record. It now reads {"patches": {P: {"visits": {...}}}} and checks each record's (patch, visit) against its own patch's list. It also stops if a scored patch is missing from the list. Nothing else changed.
Tested on synthetic lists over D-1drB (outputs to the scratchpad, not runs/r1b): a matching list passes; a list missing one visit stops; a wrong sha256 stops; an unknown patch stops.
R-1b scorer re-frozen: code/r1b_score.py md5 b024202e2f203b0cf7c5560c99f33a48 (previous version kept at ~/sxa_mac/backups/r1b_score_13c0ddfb.py).
Run command: r1b_score.py --root /Users/sumit/Github/SphereXVision/runs/qr3/wt/runs/yardstick --patches T-1 T-2 T-3 --visits <that file> --visits-sha256 56ad8034ea1987c28d87df6d1488ecd4ec454c28ce7f3d371d03569c4999c648
