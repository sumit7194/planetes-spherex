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

## What is new, written during the event

- The pack builder (`pipeline/`): SIA search over DR1 + QR3, byte-range fetching with a cache, reading each file's WCS-WAVE table to get the wavelength at the target in every photo, resampling, per-pass and per-detector stacks with two flag policies, quick aperture spectra, rough centroids, and Gaia DR3 / CatWISE2020 overlays.
- The viewer (`src/`, except the two copied files): blink, difference, stack and every-photo modes; six colour ranges and "all colours"; field of view; brightness and contrast; overlays for the predicted path, catalogue and saturation; spectra on the fly; motion and brightness readouts; Aladin Lite context with the SPHEREx HiPS cube and a wavelength slider; URL state and embedding.
- All measurements shown in the app are computed today, by this project's own pipeline, from DR1 + QR3 data.

## AI use

This project was built with substantial help from Claude (Anthropic), an AI assistant. Claude wrote most of the code and draft text under the team's direction and review. Data handling and the numbers shown were checked against IRSA's documentation, catalogue predictions and earlier independent measurements. The project idea, its design choices and the final review are the team's. No AI-generated images, audio or video are used.
