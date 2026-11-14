# Prior work: what existed before the hackathon, and what this project reuses

NASA Space Apps 2026 started for our local event (Gorakhpur, India) on **Saturday 14 November 2026, 09:00 IST**.
This repository was started on 14 November 2026. Everything in it was written during the event, except the items listed below.

## What existed before the event

The project idea is Sumit's own. Before the event, he prepared for this challenge in two private practice projects:

- **Planetes practice viewer** (29 Oct – 14 Nov 2026, 01:24 IST): a TypeScript web viewer for SPHEREx QR2/DR1 data, with a sky-map landing, prepared "packs" for the five test targets, a design language and wording rules.
- **SphereXVision** (25 Oct – 14 Nov 2026, 01:13 IST): Python research on SPHEREx data: archive access, flag handling, co-adding, PSF photometry and moving-object detection.
- **Prep notes, 13 Nov:** tested answers about the archive (which services allow browser access, the HiPS cube, flag names in DR1, timings), written up as a runbook.

## What this project reuses from that work

| Reused | Where it is here | How |
|---|---|---|
| Shared asinh stretch (one stretch for every frame being compared) | `src/stretch.ts` | copied verbatim |
| Design tokens (Infrared night palette, type) and the glass style for controls | `src/styles/tokens.css`, `src/styles/glass.css` | copied verbatim |
| Design language: the round lens, the mark vocabulary (ember = measured, dashed lilac = predicted, red outlines = flags), "watch the ring" | `src/styles.css`, `src/main.ts` | re-implemented today |
| Wording rules (never claim more than was measured; "consistent with", not "as good as") | page text | followed |
| Archive facts from the 13 Nov runbook: S3 byte-range reads of IMAGE rows, RICE-compressed FLAGS decoding, DR1 flag names from `MSKN` keywords, which flags to mask for pictures and which for differences | `pipeline/spherex.py` | recipe re-written today |
| Target positions at epoch 2026.0 | `pipeline/targets.json` | copied values |
| Weekly sky coverage of DR1 + QR3 (built 13 Nov from IRSA TAP's ObsCore table) | `public/data/coverage/dr1qr3/` | copied data file |
| The list of every DR1 + QR3 photo's footprint (IRSA TAP ObsCore query run on 13 Nov, 1.63 M rows) | input to `pipeline/build_index.py` and `pipeline/build_pointing.py` | used as input; the query is in the script's docstring and can be re-run |

## What is new, written during the event

- The first pack builder (`pipeline/build_pack.py`, `spherex.py`, `catalogs.py`): SIA search over DR1 + QR3, byte-range fetching with a cache, reading each file's WCS-WAVE table to get the wavelength at the target in every photo, resampling, per-pass and per-detector stacks with two flag policies, quick aperture spectra, and Gaia DR3 / CatWISE2020 overlays.
- The writer for the viewer's pack format and the measurements (`pipeline/planetes_pack.py`, `pipeline/measure.py`): per-photo frames and flag masks, stacks, spectra and overlays; motions from 2D fits of each pass's stack with catalogued neighbours fitted alongside and a still-star correction, for every pair of passes, with predictions from proper motion plus parallax; scatter tests for the variable stars.
- The DR1 + QR3 sky index (`pipeline/build_index.py`, from a full listing of the S3 bucket) and the browser's live reader (`src/data/live/dr1qr3.ts`: TAN-SIP WCS from each photo's header, a RICE decoder for the FLAGS tables, WCS-WAVE wavelengths), with tests against astropy.
- The pointing files for the "riding with SPHEREx" view (`pipeline/build_pointing.py`).
- A first viewer written that morning (now in `src-event-v0/`): blink, difference, stack and every-photo modes, six colour ranges, spectra on the fly, Aladin Lite with the SPHEREx HiPS cube. Its features are being carried into the practice front end (below).
- A review of today's measurements by the team's Physics session during the event (14 Nov, ~13:35 IST), and its eye test of today's packs ("seen-with-ring" / "faint"), run with its pre-event rendering script on today's packs. The results are written into `pipeline/eye_tests.json`. Following that review, the wing photometry for saturated variables is gated by a steady-star test on Barnard's Star (`pipeline/validate_wings.py`, `wing_validation.json`), and errors on motions include a bootstrap over photos.
- `public/data/surprise.json`: famous fast-moving stars and two long-period variables, checked against Gaia DR3 during the event (`pipeline/build_surprise.py`).
- All measurements shown in the app are computed during the event, by this project's own pipeline, from DR1 + QR3 data.

## The viewer: the practice front end, brought in on 14 November

On 14 November (about 12:30 IST) the team chose to use the whole practice viewer as this entry's front end, instead of the smaller viewer first written here that morning. The morning viewer is kept for reference in `src-event-v0/`. Its features are being added to the practice viewer during the event.

| Reused from the Planetes practice viewer | Where it is here | How |
|---|---|---|
| The whole front end: sky-map landing, target shows, Learn and Watch, the lens view, the 3D view, the copy deck, light and dark mode, the glass controls, the long-text rule, unit tests | `src/`, `index.html`, `credits.html` | copied from the practice repository at its commit `7243b8e` (14 Nov, 01:24 IST), then changed during the event (below) |
| The pack format `planetes-pack/1` | `schema/pack.schema.json`, `src/data/pack/types.ts`, `scripts/validate-pack.ts` | copied |
| Star catalogue extracts (bright stars, IAU names, Milky Way density from Gaia DR3) and Earth textures (NASA Blue Marble) | `public/catalog/`, `public/textures/` | copied; sources credited on the credits page |
| Tooling settings (TypeScript, ESLint, Prettier, Vitest) | the repository root | copied |

The data the viewer shows in this repository (`public/data/`) is written by this project's own pipeline during the event.

Written during the event, on top of that copy: the difference view (`src/render/difference.ts`), the all-sky map with Aladin Lite (`src/ui/context.ts`), "click anywhere" on DR1 + QR3 with colour probing (`src/app/live.ts` and `src/main.ts`; the DR1 + QR3 reader in `src/data/live/dr1qr3.ts`), known asteroids from SkyBoT (`src/app/movers.ts`, `src/data/live/skybot.ts`), the spectrum of any spot, coordinates in the link, the credits for this entry, and wording that follows this entry's own measurements. The practice viewer's QR2-only code was removed.

## AI use

This project was built with substantial help from Claude (Anthropic), an AI assistant. Claude wrote most of the code and draft text under the team's direction and review. Data handling and the numbers shown were checked against IRSA's documentation, catalogue predictions and earlier independent measurements. The project idea, its design choices and the final review are the team's. No AI-generated images, audio or video are used.
