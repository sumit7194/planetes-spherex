# R-1: a re-ranker for v4's moving-object candidates (built 14 Nov 2026; locked test not run)

**Status:** built; its locked test has not run.

**What it is.** A small re-ranker for the candidates of the existing moving-object detector (v4, SphereXVision). It sorts them into likely real movers and likely junk. It finds nothing new: it sees only v4's candidates, so anything v4 misses, it misses.

**Disclosure.** "A re-ranker for the existing detector's candidates. It finds nothing new. The numbers come from development data; the locked test on unseen sky has not run, so its value is not proven."

**What is here:**
- `RANKER_PLAN_registered.md`: the registered plan as frozen, with Amendments 1–7, all made before any locked-test data existed. It is the design record and contains some development-stage numbers.
- `code/`: the code as frozen.
  - `r0_inventory.py`: count-only inventory and shared loaders.
  - `r1a_labels.py`: label floors and chance-match rates.
  - `r1a_c1.py`: features and the fixed-setting HistGradientBoosting model.
  - `r1a_cut.py`: the frozen cut.
  - `r1a_neo.py`: the rate profile, descriptive.
  - `r1b_score.py`: the frozen scorer for the one locked test.
- `PROVENANCE.md`: hashes of the frozen model, cut file, scorer and test visit list, plus the sha256 of every file here.

**What is not here, and why:**
- **The trained model file:** a pickle; its md5 is recorded instead.
- **Development results files:** the event page shows no numbers.
- **Detector records and data:** they belong to SphereXVision.
- **Device code:** not part of this method.
- **The locked test material:** it hasn't run.

**Running it.** The code needs SphereXVision's `smo` package and records, and a small `sxa.paths` module that sets `ROOT` from `$SXA_ROOT`. As published it is a record of the method, not a standalone package.
