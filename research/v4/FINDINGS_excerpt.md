# FINDINGS excerpt (public copy)

Two dated entries from the private research log, copied for the event site's "Detectors in progress" page. Trimmed, and marked where: the unexplained detections (positions, counts, notes) are withheld because they are not vetted, and the second entry's notes on another project's model are left out. Nothing else is changed. Paths in these entries point into the private repository.

## 2026-11-14 (19:10): realism gate on the V pool (second V look) PASSES: fakes are recovered like real asteroids to within ±0.08 mag

- **[VERIFIED] (registered: prereg/V_LOOK_1.md item 6 with A5; `scripts/v_look_score.py --realism 1` at a3b0f34; `runs/yardstick/V_LOOK_1/realism_v_pool.json` sha256 931715a1…, `realism_table_v_pool.json` d59b3fa1…) Q3 realism gate, V-1..V-3, v4 pass 0, primary thresholds (T6):**
  - **Primary** (exclude static ≥ 2, weighted): 2,347 fakes, 1,982 known asteroids, **Δm −0.005, 90% [−0.075, +0.050]: PASS** (the registered rule: the 90% interval inside ±0.2 mag, TOST).
  - Sensitivity, reported: cut 1.5 Δm +0.002 [−0.058, +0.052]; cut 1.0 −0.005 [−0.060, +0.053]; static-subtracted axis −0.032 [−0.103, +0.030]; unweighted −0.008 [−0.093, +0.058]. All pass; primary vs static-subtracted differ by 0.027 mag (< the 0.2 reporting trigger).
  - D pool quoted from T6: −0.050 [−0.135, +0.030]. D+V pooled (reported): −0.010 [−0.065, +0.035].
  - Frame-fit failures: 0 in all three patches; pass-0 failed targets: none.
  - Not run: the plain-v0 method-free check (no v0 runs on V).
  - **Scope:** asteroids within v4's search (0.25–3 px/step) and the brightness range of known asteroids, mostly main belt.
  - **Cost:** 62,167 s of wall time in the final session (resumed from cache several times since 11 Nov); peak process-group phys_footprint 11,434 MB (`runs/v_score_realism.mem`). It pushed swap to 7 GB on this 16 GB Mac; several gzips of finished outputs kept free disk ≥ 4.5 GB (LEDGER 14 Nov).

## 2026-11-06 (00:19): first V look scored (frozen v4 on V-1 to V-3): m50 17.07 at FAR 0.1, every patch's FAR counts, V-1's point estimate is above 2× FAR₀

- **[VERIFIED] (registered result, prereg/V_LOOK_1.md with A1-A3; `scripts/v_look_score.py` at a138085, `runs/yardstick/V_LOOK_1/v_look_result.json` sha256 2e58bc61…, thresholds.json 7cd118a2…)** Before any V file was read, the scorer rebuilt T6's thresholds exactly (primary slow 13.356, fast 18.589; secondary 7.658, 12.546) and matched T6's threshold bootstrap and D-1 m50 half-width. No failed visits, failed targets or dropped-frame visits in any of the 12 runs. 7,035 denominator fakes.
- **Headline, primary FAR₀ = 0.1:** m50 **17.07** (fakes 68% 17.04-17.10; thresholds 17.03-17.11; patches 17.03-17.11). Plateau c_max 0.73, so **m90 is not reached**. T6's D-1 at the same thresholds: m50 17.26, c_max 0.70.
  - Per detector pair: D1/D4 17.15, D2/D5 16.95, D3/D6 17.19.
  - Per patch: V-1 17.18, V-2 16.99, V-3 (crowded, |b| 14°) 17.05, inside the range of the other two.
  - **Secondary FAR 1.0:** m50 17.69 (fakes 68% 17.66-17.73). The 18.00 in PLAN_TO_EVENT used development thresholds, so it is not comparable.
- **Per-patch FAR (A1 rule: fails only if the Poisson 95% lower bound exceeds 0.2):** all three count.
  - V-1: 3 events / 10.9 deg²-visits = 0.28, 95% 0.06-0.81. **The point-estimate and two-sided readings fail; the deciding reading passes.** One of the 3 is near a guard fake.
  - V-2: 0 / 13.0 = 0.00, 95% 0-0.28.
  - V-3: 1 / 9.2 = 0.11, 95% 0.003-0.61.
  - Pooled (reported only): 4 / 33.0 = 0.12, 95% 0.03-0.31.
  - Power is low: each patch needs 6-7 events to fail. The dead-pipeline guard is void in all three (expected 0.23-0.40 recovered guard fakes, 0 seen).
- **Maps:** completeness within 2 px of a Gaia G < 16 source is 0.16 (Wilson 95% 0.12-0.22), against 0.23-0.26 further out. By rate: 0.24 at ≤ 0.25 px/step, 0.28 at 0.25-1. Only 11 fakes exceed 1 px/step, so there is no fast-mover m50 (the NEO set is not added, A1).
- **Real output at the primary thresholds:** known asteroids recovered: 28 in V-1, 13 in V-2, 10 in V-3. *(Public copy: the unexplained detections are withheld, as they are not vetted; see README.)*
- **Stated with the result:** T6's "THRESHOLD UNSTABLE" for v4 slow and fast (GPD 10.50 and 24.11); NC-1 and NC-2 are not in the null; the §8 look-alike controls were not run; no NEO injection set.
- **Not done yet:** the realism gate on the V pool (item 6, the second V look). It refits every pass-0 frame twice, so it runs after T-L's 80k.
- **Cost:** the scorer took 38 min; its process group peaked at 1,539 MB phys_footprint (sampled every 5 s, `runs/v_score_main.mem`).

