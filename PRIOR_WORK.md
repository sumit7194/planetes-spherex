# How this entry was built: prior practice and AI use

NASA Space Apps 2026 started for our local event (Gorakhpur, India) on **Saturday 14 November 2026, 09:00 IST**.
This repository was started that morning. This page says what existed before, what still carries over, and what was built during the event.
It was last updated on 15 November 2026.

## Before the event: a practice run

The project idea is Sumit's own. Before the event he ran a private practice run for this challenge. It tried out what looks good and what works with SPHEREx data:

- **Planetes practice viewer** (29 Oct – 14 Nov 2026, 01:24 IST): a TypeScript web viewer for SPHEREx QR2/DR1 data. It tried a sky-map landing, prepared "packs" for the five test targets, a visual style and wording rules.
- **SphereXVision** (25 Oct – 14 Nov 2026, 01:13 IST): Python experiments with SPHEREx data, covering archive access, flags, co-adding, PSF photometry and moving-object detection.
- **Prep notes (13 Nov):** tested facts about the archive (which services allow browser access, flag names in DR1, timings).

## What still carries over

On 14 November (about 13:20 IST) I brought the practice viewer's front end into this repository, at the practice commit `7243b8e`, as the starting point for the interface. Much of it has since been rewritten, but parts are still close to the practice version:

| Carried over | Where | Today |
|---|---|---|
| The visual style: night palette and type tokens, the glass controls, the mark vocabulary (ember = measured, dashed lilac = predicted, red outlines = flags), the round lens | `src/styles/`, `src/render/lens.ts` | largely as practised, extended during the event |
| The sky renderer and the 3D view of Earth, SPHEREx and its orbit | `src/render/sky.ts`, `src/render/scene/`, `src/render/earth2d.ts` | mostly as practised |
| The app shell: landing, target shows, the tour, wording rules | `src/main.ts`, `src/app/shows.ts`, `src/copy/en.ts` | heavily rewritten (most of the current `main.ts` is new) |
| The shared asinh stretch, the pack format `planetes-pack/1`, tooling settings | `src/render/stretch.ts`, `schema/`, the repository root | copied, then extended |
| Star catalogue extracts (bright stars, IAU names, Milky Way density from Gaia DR3) and Earth textures (NASA Blue Marble) | `public/catalog/`, `public/textures/` | copied; sources credited on the Credits page |
| Archive recipes from the prep notes; target positions at 2026.0; the 13 Nov listing of DR1 + QR3 footprints and weekly coverage | `pipeline/spherex.py`, `pipeline/targets.json`, `pipeline/build_index.py`, `public/data/coverage/` | recipes rewritten; values and listings used as inputs |

**A measured share:** we ran `git blame` on `src/` on 15 November. About half of the current front-end source lines (16,793 of 32,357) are unchanged since the commit that brought the practice viewer in (`8fcf63f`). That commit also holds some code written that morning, so the practice share is somewhat lower. Almost all of it is interface and rendering code. None of the science below is in it.

## Built during the event

All the data on screen, and every number, comes from this project's own pipeline and live reader, written and run during the event on DR1 + QR3 data:

- **Data and pipeline:**
  - the pack builder and measurements: motions from fits of each pass, with a still-star correction and bootstrap errors; spectra; and gated photometry for saturated variables;
  - the DR1 + QR3 sky index and its daily auto-update from new releases;
  - the cloud helper next to NASA's data bucket, which serves cutouts, frames and ePSFs.
- **The live look anywhere:**
  - the browser's own DR1 + QR3 reader (WCS, flags, wavelengths);
  - colour choice, the "what changed" film, and the spectrum of any spot;
  - catalogue marks from Gaia, and from CatWISE with archive fallbacks;
  - known asteroids placed from SPHEREx's own position.
- **Pre-registered tests, each with rules fixed before any data was read:**
  - **The yardstick for the slow-mover search:**
    - false alarms counted on 200 fields;
    - fake movers injected into real photos;
    - a scorer checked by unit tests.
  - **"What fools you"**, a guide to artefacts.
  - **Variable-star checks**, the RW Aurigae and R Draconis tests.
  - **"Why a far planet loops":**
    - Makemake and Haumea found in SPHEREx photos on their parallax loops, in all three visits, within 1″ of the predicted place;
    - Eris reported honestly as not confirmed.
- **The tests page**, a log of what was tried and what was dropped, and the review of each item by my Physics and Viewer sessions.

The full history is in the git log, from 14 November onward.

## AI use

This project was built with substantial help from Claude (Anthropic), an AI assistant. Claude wrote most of the code and draft text under my direction, and I reviewed it. Several Claude sessions worked as reviewers with set roles: Physics checked every scientific rule and number before it was shown, and Viewer checked the design.

The project idea, its design choices and the final review are mine. Data handling and the numbers shown were checked against IRSA's documentation, catalogue predictions and independent measurements. The demo video's narration is an AI-generated voice (Google Gemini text-to-speech, voice "Koda", chosen by me), acknowledged on the video's end card, in its description and in the file's metadata. No AI-generated images, video or music are used: the video is screen recordings of the site.
