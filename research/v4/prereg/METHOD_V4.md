# Method entry v4 (frozen 2026-10-25, by Sumit's decision; supersedes v3)

*Used for the null-tier calibration and the first V look. Every defining file is fingerprinted in `method_v4.json` (`settings.track_suppress_px` = 1.5). A run counts as v4 only if all of it matches; the runner checks before any N, NC, V or T run.*

## Definition

v4 is method v3 (`METHOD_V3.md`: v1 static reference and PSF floor, v0 maps and search with Y1 and Y2, v2 decision on the convolution maps), plus one step:

- **Track-level suppression.** Passing candidates are taken in descending score order. A candidate is dropped if, at any of the visit's exposure times, its track lies within **1.5 px** of a stronger kept candidate's track (`smo.detect.v2.track_suppress`; unit test against brute force).
- **Why:** v3's guard gate showed bright movers spawning "satellite" false alarms: fast tracks through their light that v3's t0-only duplicate suppression kept (FINDINGS).
- **Radius choice, on D only:** 1.5 px removes the excess (guard null 21 against a plain 18, p = 0.75, compared with 32 against 18 for v3) with no guard fake lost. Larger radii (2–4 px) lost one guard fake. 1.5 px is also the existing duplicate radius.

## Development record (D tier only; null D-5 quarter 0, 19.7 area-visits; fakes D-1 pass 0)

| Quantity | Value |
|---|---|
| m50, FAR 1.0, band split | 18.00 (completeness-fit 68% 17.95–18.10; null-bootstrap 68% 17.89–18.07) |
| Native run against the offline evaluation | identical thresholds, m50 and guard counts |
| Guard unit gate | 18 against 21, exact p = 0.749, PASS; guard fakes 9/27 |
| Realism gate (Y3, D pool) | Δm −0.028, 90% −0.085 to +0.030, PASS (all sensitivity variants pass) |
