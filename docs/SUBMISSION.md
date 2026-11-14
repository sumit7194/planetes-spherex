# Project page texts (drafts for Sumit to edit and paste)

Deadline: **Sun 15 Nov 2026, 23:59 IST** (Gorakhpur). Fill every field, tick both boxes, click **Submit for Judging**. Resubmitting is allowed until the deadline.
Numbers below come from `public/data/packs/dr1qr3/*/measurements.json` (DR1 + QR3, measured 14 Nov). Re-check them against the live site before pasting. ⟨…⟩ marks values still to fill.

---

## Project name

**Planetes: watch SPHEREx's sky change**

## High-level project summary

Planetes is a public web tool that lets anyone see how the sky changes in NASA SPHEREx's images. Type a star's name or a position, or open a link with coordinates in it. Planetes plays SPHEREx's infrared photos of that spot, pass after six-month pass, so nearby stars and brown dwarfs that move, and stars that change, stand out. It reads every photo straight from NASA's public archive (DR1 and QR3), in the browser, with no server. It can subtract passes, and it builds a spectrum on the fly from SPHEREx's 102 colours. Measured motions agree with Gaia's predictions for Barnard's Star, WISE 0855 and Epsilon Indi B. It always says what it measured, and what it couldn't.

## Link to project demo

⟨YouTube / Drive link to the ≤ 30 s video, public, no login⟩ (or the 7-slide deck: see below)

## Link to final project

https://sumit7194.github.io/planetes-spherex/ · code: https://github.com/sumit7194/planetes-spherex

## Detailed project description

**What it does**
- **Any spot in the sky.** Type a name or a position (decimal or h m s / d m s), click the sky map, or use a URL such as `?ra=133.76&dec=-7.2426`. Planetes finds every SPHEREx photo of that spot in DR1 and QR3 (about 250–450 photos, in 3–4 passes) and shows them as a short blink between passes.
- **The five challenge targets, measured.** Barnard's Star, WISE 0855−0714 and Epsilon Indi B are shown moving, with the measured shift next to the catalogue prediction:
  - Barnard's Star: 1.65 ± 0.24 px north in a year (prediction 1.66 px from Gaia DR3).
  - WISE 0855: 0.73 ± 0.07 px west in half a year (prediction 0.77 px). Its neighbour star is fitted at the same time.
  - Epsilon Indi B: 0.82 ± 0.05 px east and 0.64 ± 0.05 px south over 505 days (prediction 0.85 and 0.64). All six pairs of passes agree.
  - RW Aurigae and R Draconis are variable stars. ⟨RW Aur: scatter ratios per detector; R Dra: saturated in nearly every photo, so "not measurable yet"⟩. The page says this plainly instead of guessing.
- **Blink, difference, every photo.** Compare any two passes. Subtract them on a fixed ±5σ scale, where a moving star becomes a dark-and-bright pair. Or play every single photo in date order, one colour at a time.
- **102 colours.** SPHEREx's filter changes colour across the detector, so every photo sees the spot at a slightly different wavelength. Planetes reads each photo's own wavelength map (WCS-WAVE). It compares passes only at matching colours, and builds a spectrum on the fly from one measurement per photo. For example, the brown-dwarf pair Epsilon Indi B shows its spectrum.
- **Known asteroids and comets** at each photo's time (IMCCE SkyBoT), so a dot that moves between photos can be checked against known objects.
- **Context.** Overlays of Gaia DR3 and CatWISE2020 stars, moved by their proper motions. SPHEREx's all-sky map in Aladin Lite, with a slider through all 102 wavelengths. The SPHEREx pipeline's flags are drawn as outlines and explained, never hidden.
- **Honest by construction.** Every number carries a status: measured, predicted, not reliable or not measurable. A shift is called measured only when at least two detectors agree and the still stars in the same photos stay put to within 0.2 px.

**How it works**
- A Python pipeline (astropy, NumPy, SciPy) searches IRSA, reads only the few hundred rows around a target from each 66 MB file in NASA's public S3 bucket, and decodes the RICE-compressed flags. It resamples every photo onto one north-up grid using the photo's own WCS, and stacks the photos by pass and detector. Motions come from 2D fits of each pass's stack: the wings only when the core is saturated, with known neighbours fitted alongside, minus the shift that the field's still stars share.
- For any other spot, a compact sky index of all 1.63 million DR1 + QR3 photos (built from IRSA's footprints and the bucket listing) lets the browser find the photos itself. It then reads them directly from S3 with byte ranges: WCS with the SIP distortion, the RICE decoder and the wavelength table, all in TypeScript and tested against astropy.
- The web app (TypeScript, Vite) has a sky map to start from, guided tours, and light and dark modes. It is a static site on GitHub Pages and can be embedded with `?embed=1`.

**Benefits**
Volunteers found most known brown dwarfs, and many asteroids, by blinking images from earlier NASA missions (WiseView, Backyard Worlds). Planetes brings that to SPHEREx, in a browser, adds spectra, and keeps every claim checkable.

**Easy to update**
The release is a setting (`COLLECTIONS` in `pipeline/spherex.py`). When IRSA publishes DR2: re-run the sky index and the five packs (a GitHub Actions workflow builds a pack next to the S3 bucket). The viewer needs no change.

**Tools**
TypeScript, Vite, HTML canvas, three.js (3D view), Aladin Lite v3; Python 3 with astropy, NumPy, SciPy and aiohttp; GitHub Pages and GitHub Actions.

## Use of Super Intelligence (AI)

Yes. Claude (Anthropic) was used as a coding and writing assistant throughout. It wrote most of the code and draft text under the team's direction and review, and it ran checks against IRSA's documentation, astropy and catalogue predictions. The idea, the design choices and the final review are the team's. No AI-generated images, video or audio are used. This is stated in the README, PRIOR_WORK.md and on the credits page.

## NASA data

- **SPHEREx Data Release 1 and Quick Release 3 spectral images** (Level 2), via NASA/IPAC IRSA: the SIA service, and the public AWS bucket `s3://nasa-irsa-spherex`.
- **SPHEREx DR1 all-sky HiPS cube** (IRSA), in Aladin Lite.
- **IRSA ObsCore footprints (TAP)** for the sky index and the coverage map.
- **CatWISE2020** (WISE/NEOWISE, via IRSA).

## Space agency partner data and other references

- ESA Gaia DR3 (ESA Gaia archive): overlays, still stars, and the proper motions of Barnard's Star and Epsilon Indi.
- IMCCE SkyBoT: known solar-system objects.
- CDS Strasbourg: Aladin Lite v3 (GPL-3.0) and Sesame name resolution.
- Literature: Luhman & Esplin 2016 (WISE 0855 proper motion); Kirkpatrick et al. 2021 (WISE 0855 parallax).
- Inspiration: WiseView (byw.tools) and Backyard Worlds: Planet 9.
- Software: astropy, NumPy, SciPy, aiohttp, Vite, TypeScript, three.js, Source Serif 4 and Source Sans 3 (SIL OFL); the star catalogues and Earth imagery listed on the credits page.
- Prior work: the team's own pre-event practice projects, declared in PRIOR_WORK.md.
- CSA resources (NEOSSat, CADC) were reviewed. CADC's services were unavailable during the event, so they are not used.

---

## Demo: 30-second video (screen recording + English subtitles)

| t | On screen | Subtitle / voice |
|---|---|---|
| 0:00 | Title card: Planetes, team Planetes (Sumit), "Planet X and SPHEREx" | "I'm Sumit, team Planetes. Our challenge: Planet X and SPHEREx." |
| 0:04 | The sky map, then "Meet the five" | "SPHEREx photographs the whole sky every six months, in 102 colours." |
| 0:08 | Barnard's Star show: the lens blinks, "Watch the ring" | "Planetes plays its photos of any spot, pass after pass. Barnard's Star walks out of the ring: 10 arcseconds in a year, as Gaia predicts." |
| 0:15 | Show the difference: the dark-and-bright pair | "Subtract two passes, and whatever moved lights up." |
| 0:19 | Eps Ind B spectrum; flags outlined on R Dra | "Every photo is a colour, so it builds spectra on the fly, and it says what it can't measure." |
| 0:24 | Type a random RA/Dec → live photos arrive from NASA's archive | "Any spot in the sky, straight from NASA's archive, in your browser. Go find a wanderer." |
| 0:30 | End card with the URL | — |

## Demo: 7-slide fallback deck

1. Planetes: watch SPHEREx's sky change. Team Planetes (Sumit), Gorakhpur. Challenge: Planet X and SPHEREx.
2. The problem: SPHEREx maps a billion objects every six months; discoveries come from comparing images over time, which is too much for one person.
3. What it does: a screenshot of a show (lens, ring, measured vs predicted).
4. How it works: index → S3 byte ranges → per-photo WCS and flags → stacks per pass → blink, difference, spectra.
5. The five targets: the three moves with measured ± error vs prediction; the two variables with their honest status.
6. Any spot, live: a screenshot of a live look, a spectrum on the fly, known asteroids.
7. Next: DR2 is a config change; embeds and links for citizen science; credits.
