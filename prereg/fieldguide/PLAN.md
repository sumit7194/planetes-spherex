# Field guide ("What fools you"): rules fixed before any example is searched for

- **What:** a page of real SPHEREx photos of things that look like a discovery and aren't, or aren't new. Every example is a real photo found by a fixed rule, never chosen or drawn by eye.
- **Rules:** set by Physics on 15 Nov 2026 (received 02:38 IST); page design by Viewer (02:44 IST). Written here at 02:47 IST, before any search has run.
- **Status:** registered. No example has been searched for yet.

## 0. Data, and what is excluded
- **Source:** the photo boxes already cached on this machine by the pack builds and earlier runs (`pipeline/cache/*.pkl`; 13,543 boxes of 60×60 native pixels, each with IMAGE, FLAGS, the file's own flag-bit names, MJD, detector and the IMAGE header). No new sky regions are fetched for the search.
- **Hard exclusion (Physics):** no box whose centre lies within **1°** of any **V** or **T** patch centre in `SphereXVision/prereg/patches.csv` (V-1, V-2, V-3, T-1, T-2, T-3). T is reserved for the ranker's one locked score and must never be looked at. The filter runs on each box's position (from its own WCS) **before** anything else reads the box.

## 1. Selection (automatic, one rule per kind)
- Flags by **name**, decoded from each file's own header (as D9 does). The exact names used are recorded per example.
- Within a kind, the chosen instance is the one with the **largest excess light inside the flagged area**: the sum over flagged pixels of (image − local background), where the background is the median of the unflagged pixels in an annulus 3–8 px outside the flagged area. Not the largest flagged area: a big flagged region can be empty sky.
- If no instance of a kind shows excess at **S/N ≥ 5** (excess ÷ its noise from the background scatter), that kind is shown as "flagged by the pipeline, nothing visible here", or dropped. Never a nicer-looking one picked by eye.
- The rule, the chosen photo and the pixel are recorded in the log below **before** labelling. Each card says "the clearest example our rule found".

## 2. Two kinds of label (the card says which)
- **"The pipeline flagged this as X":** the evidence is the flag name only.
- **"Confirmed X":** independent evidence as well, per kind:
  - **Ghost:** flag-only, unless the bright source that makes it can also be shown in the same photo at the predicted offset.
  - **Persistence:** confirmed only if an earlier photo from the same detector, taken shortly before, had a bright source at the same detector pixel (it may not be cached; otherwise flag-only).
  - **Cosmic ray / transient:** confirmed if at least 2 other photos of the same sky, in the same detector's colour, within days, show nothing there (S/N < 3).
  - **Dead or hot pixel:** confirmed by the detector-place test: the same detector pixel is bright (or dead) in at least 3 other photos where the sky is different.
  - **Saturation:** by whatever the files name it (DR1 has no "SATURATED"; OVERFLOW, NONLINEAR, BLOOM). The names are stated as found. Example: Barnard's Star, with Gaia G 8.2 as the evidence.
  - **Blend:** WISE 0855 and the G 16.3 neighbour, with the measured light centres as the evidence (pipeline/targets.json, w0855.spotFact.centreShift).
  - **Known asteroid:** a SkyBoT match within 1.5 px, **and** the position moving between the exposures of one visit at SkyBoT's predicted rate and direction. Two-photo agreement alone isn't enough.
  - **Ordinary star (control):** a Gaia match, no FIT_REJECT flag in its 3×3, S/N 20–100, no Gaia neighbour within 3 px.

## 3. Display (Viewer's design)
- `fieldguide.html`, a sibling of tests.html, in two sections: **Not in the sky** (cosmic ray, hot/dead pixel, persistence, ghost/halo) and **In the sky, but not new** (known asteroid, blend, saturated bright star, ordinary star as the control).
- One card: title; "Looks like" (the mistaken reading); 2 cutouts side by side at the **same stretch, one stretch rule for every example (stated on the page)**, plus a third panel only when it's the clincher; flag outlines; 2–3 evidence lines in the app's words; "How to tell" in one sentence a visitor can apply with the spot check; a source line (photo IDs, date, detector, λ, "Open this spot").
- Cutouts are canvases drawn from data (32×32 f32 + u8 flags per panel, plus one JSON of card facts in `public/data/fieldguide/`), not PNGs.
- Entry points: the spot card's "What fools you →" (deep-linked by the evidence), Learn's last step, "What am I seeing?", and a cross-link from tests.html.

## 4. Review
Physics signs the chosen examples and their evidence lines before anything is pushed; Viewer reviews the page.

## 5. Log
- 15 Nov 2026, 02:47 IST: plan registered. Next: the exclusion filter, then the search per kind.
- 15 Nov 2026, ~02:55 IST: **exclusion filter run** (`pipeline/fieldguide.py index`): 13,543 cached boxes, 436 empty; of the 13,107 with data, **0 within 1° of a V or T patch** (closest of the five targets: RW Aurigae, 26.9° from T-3). The boxes come from 34 sky fields (the five targets plus fields from earlier runs). Only headers were read for this step.
- 15 Nov 2026, ~03:00 IST: **search started** (`fieldguide.py search`) for six flag-name kinds: cosmic-ray (TRANSIENT), hot-or-dead-pixel (HOT, NONFUNC), persistence (PERSIST), ghost (GHOST, GHOST_FPA, GHOST_EXT), halo (HALO), streak (STREAK, SATELLITE_HALO). Saturation, blend, asteroid and the control star are named examples, not searched. Background ring: unflagged pixels (no FIT_REJECT name) 3–8 px outside each region.
