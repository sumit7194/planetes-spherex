# Project page texts (drafts for Sumit to edit and paste)

Deadline: **Sun 15 Nov 2026, 23:59 IST** (Gorakhpur). Resubmitting is allowed until the deadline.
Every number below is copied from the live site's "How we tested" page (15 Nov 2026). If the site changes, re-check them before pasting. ⟨…⟩ marks values still to fill.

---

## Project name

**Planetes: the wanderers in SPHEREx's sky**

## High-level project summary

Planetes is a free web tool that shows how any patch of sky changes in NASA SPHEREx's infrared photos. Type a star's name or a position, or click the sky map. Planetes finds every SPHEREx photo of that spot and plays them pass after six-month pass, so stars that move and stars that change stand out. It reads the photos from NASA's public archive (DR1 and QR3), mostly in your own browser. It can subtract two passes, and it builds a spectrum on the fly from SPHEREx's 102 colours. For the challenge's five objects, it measured the moves of Barnard's Star, Epsilon Indi B and WISE 0855, and each agrees with the catalogue prediction. It also measured RW Aurigae dimming. Every number says whether it was measured, predicted, or couldn't be measured, and why.

## Link to project demo

⟨YouTube / Drive link to the ≤ 30 s video, public, no login⟩ (or the 7-slide deck below)

## Link to final project

https://sumit7194.github.io/planetes-spherex/ · code: https://github.com/sumit7194/planetes-spherex

## Detailed project description

**What it does**
- **Any spot in the sky.** Type a name or a position (decimal or h m s / d m s), click the sky map, or open a link such as `?at=133.76,-7.2426`. Planetes finds every SPHEREx photo of that spot in DR1 and QR3 (usually 250–500 photos in 3–4 passes; thousands in the deep fields). It then lets you blink between passes, subtract them, or play every photo in date order.
- **Play and Learn.** Play is the tool itself. Learn walks through the same sky with guided explanations. Both share one sky view, which can be shown as a globe or a flat map.
- **The challenge's five, tested** (the "How we tested" page lists each, with its limits):
  - Barnard's Star: moved 10.2″ ± 1.5″ north, Aug 2025 to Aug 2026. Predicted 10.2″ (Gaia DR3).
  - Epsilon Indi B: moved 6.4″ ± 0.3″ south-east, May 2025 to Sep 2026. Predicted 6.5″.
  - WISE 0855: moved 4.5″ ± 0.6″ west, Nov 2025 to May 2026. Predicted 4.7″ (Luhman & Esplin 2016). The challenge's position is its 2010 place, now 2.1′ away, and the tool says so.
  - RW Aurigae: 0.52 ± 0.06 of its brightness, last pass over first. This was measured from the unsaturated edges of its image.
  - R Draconis: not measured. It is saturated in every photo, and its glare reaches the comparison stars. The page explains why rather than guessing.
  - For the three moves, the still stars in the same photos shifted 0.07 px or less (median).
- **102 colours.** SPHEREx's filter changes colour across the detector, so each photo sees the spot at a slightly different wavelength. Planetes reads each photo's own wavelength map. It compares passes only at matching colours, and builds a spectrum from one measurement per photo.
- **Known asteroids and comets** at each photo's time (IMCCE SkyBoT), moved to where SPHEREx itself was, so a moving dot can be checked against known objects.
- **Context.** Gaia DR3 and CatWISE2020 stars, moved by their proper motions. SPHEREx's all-sky map in Aladin Lite, with a slider through all 102 wavelengths. The pipeline's flags are drawn as outlines and explained, never hidden.
- **What fools you.** A field guide to the things that look like movers but aren't: artefacts, ghosts, saturated stars, flags.
- **Why a far planet loops.** An interactive page showing why a distant Planet X would trace a yearly loop as Earth moves around the Sun. It explains why our between-pass search (reach about 25″) can't find one, and what search would be needed instead.
- **Detectors in progress.** A separate page with clear disclosures. It covers our moving-object detector (v4, built before the event and declared as prior work), with an interactive explorer of its published test results, and a re-ranker built on it during the event. It also covers a spectral-twin search and the season-pair search. None has found anything new; the page says so first. Their code, plans and results are in the repository, each file checked by its hash.

**How it works**
- A Python pipeline (astropy, NumPy, SciPy) searches IRSA, reads only the few hundred rows around a target from each 66 MB file in NASA's public S3 bucket, and decodes the compressed flags. It resamples every photo onto one north-up grid using the photo's own WCS, and stacks the photos by pass and detector. Moves come from 2D fits of each pass's stack (only the wings when the core is saturated), minus the shift the field's still stars share.
- For any other spot, a compact sky index of all 1.63 million DR1 + QR3 photos lets the browser find the photos itself. Each photo's position agrees with astropy's full solution to 0.00009 px. The browser reads the pixels from S3 with byte ranges, using a WCS reader with SIP distortion, a RICE decoder and the wavelength table, all in TypeScript and tested against astropy.
- A small helper on Cloudflare Workers cuts out the same frames close to NASA's bucket, using the same reader code; its frames match the browser's to a correlation of 0.999996. If it can't be reached, the browser reads NASA's files directly.
- A daily check lists the SPHEREx bucket and proposes any new photos for the sky index. A person merges them; nothing goes live automatically.
- The web app (TypeScript, Vite) is a static site on GitHub Pages. It has light and dark modes and can be embedded with `?embed=1`.

**Being honest about the results**
- Every number has a status: measured, predicted, not reliable, or not measurable yet.
- Choices we made after seeing these five fields are listed on the "How we tested" page, next to the numbers they affect.
- Our yardstick test (fake slow movers planted in 40 other fields, with false alarms counted on 200 more) was registered before any photo was read (commit 4db4606). The false-alarm part is done. The fake-mover part hasn't been run yet, so we don't claim a detection limit.

**Benefits**
Volunteers found many known brown dwarfs, and many asteroids, by blinking images from earlier NASA missions (WiseView, Backyard Worlds). Planetes brings that to SPHEREx, in a browser, adds spectra, and keeps every claim checkable.

**Easy to update**
The data release is one setting (`COLLECTIONS` in `pipeline/spherex.py`). When IRSA publishes DR2, re-run the sky index and the five packs. A GitHub Actions workflow builds a pack next to the S3 bucket. The viewer needs no change.

**Tools**
TypeScript, Vite, HTML canvas, three.js, Aladin Lite v3; Python 3 with astropy, NumPy, SciPy and aiohttp; GitHub Pages, GitHub Actions, Cloudflare Workers.

## Use of Super Intelligence (AI)

Yes. Claude (Anthropic) was used as a coding and writing assistant throughout. It wrote most of the code and draft text under the team's direction and review. It also checked our work against IRSA's documentation, astropy and catalogue predictions. The idea, the design choices and the final review are the team's. No AI-generated images, video or audio are used. This is stated in the README, PRIOR_WORK.md and on the credits page.

## NASA data

- **SPHEREx Data Release 1 and Quick Release 3 spectral images** (Level 2), via NASA/IPAC IRSA: the SIA service and the public AWS bucket `s3://nasa-irsa-spherex`.
- **SPHEREx DR1 all-sky HiPS cube** (IRSA), in Aladin Lite.
- **IRSA ObsCore footprints (TAP)**, for the sky index and the coverage map.
- **CatWISE2020** (WISE/NEOWISE, via IRSA).

## Space agency partner data and other references

- ESA Gaia DR3 (ESA Gaia archive): overlays, still stars, and the proper motions of Barnard's Star and Epsilon Indi.
- IMCCE SkyBoT: known solar-system objects.
- CDS Strasbourg: Aladin Lite v3 (GPL-3.0) and Sesame name resolution.
- Literature: Luhman & Esplin 2016 (WISE 0855 proper motion); Kirkpatrick et al. 2021 (WISE 0855 parallax).
- Inspiration: WiseView (byw.tools) and Backyard Worlds: Planet 9.
- Software: astropy, NumPy, SciPy, aiohttp, Vite, TypeScript, three.js; Newsreader and Atkinson Hyperlegible Next fonts (SIL OFL). The star catalogues and Earth imagery are listed on the credits page.
- Prior work: the team's own pre-event projects, declared in PRIOR_WORK.md and on the Detectors page.
- CSA resources (NEOSSat, CADC) were considered. CADC's search didn't answer during the event, so they are not used.

---

## Demo: 30-second video (screen recording + English subtitles)

| t | On screen | Subtitle |
|---|---|---|
| 0:00 | Title card: Planetes, the wanderers in SPHEREx's sky; team Planetes (Sumit); "Planet X and SPHEREx" | "Planetes: watch SPHEREx's sky change." |
| 0:03 | The sky map turning; coverage | "SPHEREx photographs the whole sky every six months, in 102 colours." |
| 0:07 | Barnard's Star: the lens blinks between passes | "Pick any spot, and Planetes plays its photos, pass after pass." |
| 0:11 | Barnard's Star moves; the measured vs predicted numbers | "Barnard's Star moved 10.2 arcseconds in a year, just as Gaia predicts." |
| 0:15 | The difference view: a dark-and-bright pair | "Subtract two passes, and whatever moved lights up." |
| 0:18 | Epsilon Indi B's spectrum on the fly | "Every photo is a different colour, so it builds spectra too." |
| 0:21 | Typing a random position: live photos arrive | "Any spot, straight from NASA's archive, in your browser." |
| 0:25 | "Why a far planet loops", then the "How we tested" page | "And it says plainly what it measured, and what it couldn't." |
| 0:29 | End card with the URL | — |

## Demo: 7-slide fallback deck

1. Planetes: the wanderers in SPHEREx's sky. Team Planetes (Sumit), Gorakhpur. Challenge: Planet X and SPHEREx.
2. The problem: SPHEREx maps the whole sky every six months. Finding what moved or changed means comparing photos over time, and there are 1.63 million of them.
3. What it does: a screenshot of a look (lens, blink, measured vs predicted).
4. How it works: sky index → S3 byte ranges → each photo's WCS, flags and colour → stacks per pass → blink, difference, spectra.
5. The five: three moves with measured ± error vs prediction; RW Aurigae's dimming; R Draconis not measured, and why.
6. Beyond the five: any spot live, "What fools you", "Why a far planet loops", and the Detectors page with its disclosures.
7. Next: run the registered yardstick; DR2 is one setting; links and embeds for citizen science.
