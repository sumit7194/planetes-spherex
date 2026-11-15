# v4: fast movers within one SPHEREx visit (public evidence copy)

This folder backs the **"Fast movers within one visit (v4)"** card on the event site's *Detectors in progress* page.
It holds the detector's code, its registered test plan, and the scored results, copied from our private research
repository, with a sha256 for every file (`PROVENANCE.md`).

**Read this first.** Work in progress, not a discovery. v4 was built in October–November 2026, before NASA Space Apps
2026, as part of our own research, and is declared as prior work. It was built with AI assistants (Claude-based agents
writing and cross-checking code under the author's direction). It has found nothing new. Its unexplained detections
have not been vetted, so they are withheld from this copy.

## What v4 does

It looks for sources that move 0.25–3 pixels (1 px = 6.15″) between photos taken 129 s apart within one SPHEREx
visit: in practice, main-belt asteroids. Thresholds are set on noise-only data for 0.1 false alarms per square degree
per visit.

## The registered test and its result

- **Plan:** `prereg/V_LOOK_1.md` (with `prereg/YARDSTICK.md` for the yardstick it uses and `prereg/METHOD_V4.md` for
  the frozen method), registered before any held-out data was read.
- **Scored 6 Nov 2026** on held-out sky (patches V-1 to V-3), with fake asteroids planted in real SPHEREx photos:
  half found down to AB magnitude 17.07, measured in the visit's short-wavelength detector (68% range 17.04–17.10).
  Completeness levels off at 73%, so a 90% point is not reached. All three patches stayed within the registered
  false-alarm bound. File: `results/v_look_result_public.json`.
- **Realism check, 14 Nov 2026:** fakes and real known asteroids are recovered alike, Δ = −0.005 mag (90% interval
  −0.075 to +0.050; the bar was ±0.2). PASS. File: `results/realism_v_pool.json`.
- **Known asteroids re-found:** 28, 13 and 10 in the three patches.
- **Limits:** no number for faster movers (near-Earth asteroids). Overall completeness is lower within 2 px (12″) of
  stars brighter than Gaia G 16: 0.16 (95% 0.12–0.22) against 0.23–0.26 further out.
- `FINDINGS_excerpt.md` has the two dated log entries, trimmed where marked.

## What is here

| path | what it is |
|---|---|
| `prereg/` | `V_LOOK_1.md` (the test plan), `YARDSTICK.md`, `METHOD_V4.md`, `method_v4.json` |
| `code/src/smo/` | the library (data readers, scene fit, detection, injection, scoring) |
| `code/scripts/` | `yardstick_run.py` (maps and detection), `v1_static.py`, `yardstick_known.py`, `v_look_score.py` (the scorer), `yardstick_realism.py` |
| `code/rust/stackkern/` | a small Rust stacking kernel |
| `code/pyproject.toml`, `code/uv.lock` | the Python environment |
| `results/` | `thresholds.json`, `v_look_result_public.json` (trimmed, see below), `realism_v_pool.json` |
| `data/` | `patches_V.csv` (the three test patches), `patch_V-*.csv` (saved QR2 photo lists from IRSA), `runs/` (fetch receipts with per-cutout content hashes) |
| `FINDINGS_excerpt.md` | the two log entries |
| `PROVENANCE.md` | source commit and sha256 of every file |

## How to reproduce

The detection outputs (about 700 MB, and containing the withheld detections) are not included, so a check means
re-running from SPHEREx data. It is heavy: hundreds of worker-hours, most of it on the crowded patch V-3.

1. Environment: `cd code && uv sync --extra ephem` (Python; kete for known-asteroid orbits).
2. Copy `data/runs/` into `code/runs/`, and `data/patch_V-*.csv` into `code/cache/sia/`. The photo lists are saved
   because IRSA's QR2 image search no longer returns rows; the files themselves are still on IRSA's public S3
   (`nasa-irsa-spherex`).
3. Per patch, in the order of `scripts/v_look_queue.sh` (coordinates from `data/patches_V.csv`):
   `scripts/refetch_verify.py <patch>` (fetches each cutout and checks its sha256 against the receipt),
   `scripts/v_maps_step.sh <patch> <ra> <dec>`, `scripts/save_map_areas.py <patch>`,
   `scripts/v1_static.py <patch> <ra> <dec>`, `scripts/yardstick_known.py <patch> runs/fetch_<patch>.json`, then
   `SMO_METHOD=v4 scripts/yardstick_run.py detect <patch> runs/fetch_<patch>.json <ra> <dec> <mode> <workers>`
   for each mode in `real`, `0`, `1`, `scramble_guard0` (environment variables as in the queue script).
4. Score: `scripts/v_look_score.py --check`, then `scripts/v_look_score.py` for the headline and
   `scripts/v_look_score.py --realism <workers>` for the realism check.
5. Expected: the numbers above. The thresholds (`results/thresholds.json`) are rebuilt from noise-only patches that
   are not in this copy, so the scorer's `--check` will ask for them; compare against the saved file instead.

Honest caveat: this is the path we ran, written down after the fact, not a tested one-command recipe.

## What was left out, and why

- **The unexplained detections** (positions, scores, flags and counts): not vetted. In `v_look_result_public.json`
  only those fields are replaced; `PROVENANCE.md` gives the sha256 of the untrimmed original.
- **The patch list** (`prereg/patches.csv`): it includes the sky fields reserved for another detector's locked test,
  which has not been scored yet.
- Data caches, large per-fake tables, and the project's running notes.

The code is a research copy, not a package: it expects SPHEREx data fetched from IRSA and contains local paths.
