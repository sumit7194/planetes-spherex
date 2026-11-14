# Field guide ("What fools you"): rules fixed before any example is searched for

- **What:** a page of real SPHEREx photos of things that look like a discovery and aren't, or aren't new. Every example is a real photo found by a fixed rule, never chosen or drawn by eye.
- **Rules:** set by Physics and the page design by Viewer, both received on 15 Nov 2026 shortly before 02:41 IST. Written here and committed at 02:41 IST (3bd6c10), before any search ran.
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
- 15 Nov 2026, 02:41 IST: plan registered (3bd6c10). Next: the exclusion filter, then the search per kind.
- 15 Nov 2026, 02:42 IST: **exclusion filter run** (`pipeline/fieldguide.py index`): 13,543 cached boxes, 436 empty; of the 13,107 with data, **0 within 1° of a V or T patch** (closest of the five targets: RW Aurigae, 26.9° from T-3). The boxes come from 34 sky fields (the five targets plus fields from earlier runs). Only headers were read for this step.
- 15 Nov 2026, 02:43 IST: **search started** (`fieldguide.py search`) for six flag-name kinds: cosmic-ray (TRANSIENT), hot-or-dead-pixel (HOT, NONFUNC), persistence (PERSIST), ghost (GHOST, GHOST_FPA, GHOST_EXT), halo (HALO), streak (STREAK, SATELLITE_HALO). Saturation, blend, asteroid and the control star are named examples, not searched. Background ring: unflagged pixels (no FIT_REJECT name) 3–8 px outside each region.
- Correction (02:45 IST): the times above were first written as guesses; they now carry the clock and commit times.
- 15 Nov 2026, 02:45 IST: **search result, recorded before any labelling** (cache/fieldguide_search.json). Regions at S/N ≥ 5 and the instance the rule chose:
  - cosmic-ray (TRANSIENT): 52,223; chosen 2025W28_2A_0104_4 D6, 130 px, excess 92,771, at the box centre (RA 236.0672, Dec +6.4272).
  - hot-or-dead-pixel (NONFUNC): 38,680; chosen 2025W49_1A_0236_2 D6, a single pixel, excess 60,338 (RA 152.6461, Dec −12.3563).
  - persistence (PERSIST): 6,719; chosen 2025W38_2C_0398_1 D6, 82 px, at the box centre (RA 87.7424, Dec −35.7661).
  - ghost (GHOST, GHOST_FPA, GHOST_EXT): **0 regions anywhere**, so this kind is dropped, or shown as "flagged by the pipeline, nothing visible here" if any flagged region exists below S/N 5.
  - halo (HALO): 21,683; chosen 2026W38_1A_0254_1 D5, 113 px, at RW Aurigae's own position.
  - streak (STREAK, SATELLITE_HALO): 41; chosen 2025W19_1B_0147_2 D6, 227 px, near the box centre (RA 167.4147, Dec +44.4992).
  - **Problem seen:** most boxes are centred on a target star, and the largest-excess rule picked regions sitting on real bright stars (cosmic-ray, persistence and streak at or near a box centre; the halo is RW Aurigae itself). Labelling a bright star "the pipeline flagged this as a cosmic ray" would mislead. Sent to Physics for a dated rule change before any labelling; nothing has been labelled.
- 15 Nov 2026, 03:14 IST: **rule change, approved by Physics, made AFTER seeing the first result** (the first rule picked bright stars carrying flags). Nothing had been labelled.
  - (a) A region counts only if its excess isn't explained by a known source: no SOURCE-flagged pixel in it; no Gaia DR3 source with G < 19 within 2 px (moved to the photo's date by proper motion); no SkyBoT asteroid within 2 px at the photo's date (checked on the survivors, best first). CatWISE would also count, but IRSA is down tonight, so it's **Gaia only** (logged as a known gap). The confirmation tests stay the backstop.
  - (b) Unchanged: the largest excess at S/N ≥ 5 among the survivors.
  - (c) HALO is not its own kind. It goes under Barnard's Star: "its halo, flagged by the pipeline", with G 8.2 as the evidence.
  - (d) Ghost dropped: "no GHOST flags in the photos we had".
  - **Star-hit example** (new, fixed now): the largest-excess TRANSIENT region that (a) excludes **because of a Gaia match**. Line: "A flag marks pixels to treat with care. It doesn't mean the source is fake: this is a catalogued star."
  - **Size clue** (Physics): real cosmic-ray hits are 1 to a few pixels. A surviving TRANSIENT region of tens of pixels is more likely a satellite trail or an edge effect, and is said so.
  - **Guide note:** "Examples come from photos we already had for our five targets and the live look, not a random sample of the sky."
- 15 Nov 2026, 03:23 IST: **selection (amended rule) and confirmation tests run** (cache/fieldguide_select.json, fieldguide_confirm.json). Counts at S/N ≥ 5 → after dropping regions on a SOURCE pixel → after dropping a Gaia match within 2 px: TRANSIENT 52,223 → 7,822 → 7,629; NONFUNC/HOT 38,680 → 6,982 → 6,808; PERSIST 6,719 → 622 → 597; STREAK 41 → 0 (all on catalogued sources). SkyBoT: no asteroid within 2 px of any chosen region.
  - **cosmic-ray and hot-or-dead-pixel chose the same pixel:** 2025W45_2A_0308_3, D5, detector pixel (1708, 202), ~23,000 MJy/sr in one pixel, flagged TRANSIENT and NONFUNC. Same sky: nothing (S/N < 3) in 18 of 18 other photos, same detector, within 5 days. Detector place: no other cached photo covers that detector pixel, so that test can't run. NONFUNC comes from the pipeline's bad-pixel calibration mask, so a stuck pixel is the likelier reading; a cosmic ray can't be confirmed separately. **Proposed label: flag-only, "not in the sky".**
  - **persistence:** 2025W40_1A_0125_4, D6, one pixel, PERSIST. Same sky: nothing in 16 of 16. No earlier photo of that detector pixel is cached, so persistence can't be confirmed. **Proposed label: flag-only, "not in the sky".**
  - **star-hit:** 2026W34_2A_0081_1, D6, 7 px TRANSIENT, Gaia DR3 4472833436601353344 (G 18.15) at 1.29 px. The flagged excess (~4,500 MJy/sr summed) is far more than a G 18 star could give, and same sky shows nothing in 15 of 16 other photos. **The star isn't what's flagged: a hit landed next to a faint catalogued star. The planned line "this is a catalogued star" would be false.** Sent to Physics: drop the star-hit example, or re-pick it with the extra condition that the star is seen (S/N ≥ 5) in at least 2 other photos.
- 15 Nov 2026, 03:23 IST: **fixed picking rules for the two named examples whose instance wasn't specified** (event build's choice, written before searching; Physics reviews):
  - **Control star:** among stars meeting Physics' conditions (Gaia DR3 match within 1 px at the photo's date, no FIT_REJECT name in its 3×3, S/N 20–100 in a 3×3 aperture, no other Gaia source within 3 px), the one whose S/N is closest to 50: the middle of the allowed range, so neither the brightest nor the faintest is shown.
  - **Saturation and halo (Barnard's Star):** among the cached photos of Barnard's Star, the one with the largest saturation-flagged area (OVERFLOW, NONLINEAR, BLOOM by name, connected to the star's place); the same photo's HALO pixels are outlined on the second panel.
- 15 Nov 2026, 03:31 IST: **Physics' decisions on the confirmation results** (rule changes after seeing results; logged before any new labelling):
  - The non-working pixel is shown once, flag-only, under "Not in the sky". Persistence: flag-only, under "Not in the sky".
  - **Cosmic-ray card re-picked** with any region that also carries NONFUNC or HOT excluded. Heading "Cosmic ray or one-off glitch", flag-only, worded as what we know: "Flagged as a transient by the pipeline; nothing there in N other photos of the same sky". No card says "confirmed cosmic ray".
  - **Star-hit re-picked** (largest excess first) with two more conditions, so the premise holds: the Gaia star (G < 19, within 2 px) is seen at S/N ≥ 5 at its place in at least 2 other photos of the same detector; and the flagged region's excess is within a factor of 2 of the star's median excess in those photos. If nothing qualifies, the card is dropped and that is logged.
  - No "confirmed hot pixel" tonight (no extra photos fetched).
  - Wording fixes signed by Physics: the bad pixel's how-to-tell (a bad pixel stays with the detector, a real source with the sky); its brightness ratio to its neighbours only if computed from the panel's numbers; the afterglow line as the pipeline's flag; Barnard "far brighter at its centre than SPHEREx can measure"; the blend's separation with its dates (6.4″ in May 2026, 9.5″ in November 2025).
- 15 Nov 2026, 03:37 IST: **re-picks done** (cache/fieldguide_repick.json):
  - Cosmic ray or one-off glitch: 1,948 TRANSIENT regions qualified; chosen 2025W49_1A_0280_2, D5, 12 px (larger than a typical hit; said so), no SkyBoT asteroid; nothing there in 14 of 14 other photos of the same sky within 5 days. Flag-only.
  - Star-hit: 193 candidates; 26 tried in order; chosen 2025W33_2C_0386_4, D6, 1 px TRANSIENT on Gaia DR3 4472811789965981184 (G 17.68, 1.07 px); the star shows at S/N ≥ 5 in 2 other photos of D6 with median excess 384; here 548 (×1.43, inside ×2), all in the same 3×3 aperture at the star's place. Card "A flag on a real star", confirmed.
- Display fix (03:37 IST): a crop near a box's edge is moved to stay inside the box (it was mostly empty), with the ring moved to match. No data changed.
- 15 Nov 2026, 03:38 IST: **Physics signed all 7 cards**, with one check: the cosmic-ray pick is in R Draconis's field. Result: 109.5 px from R Draconis in that photo, but **HALO flags sit on the region itself**. By Physics' rule it could be a bright star's scattered light, so **re-pick (rule change after the check)**: the cosmic-ray card also excludes any region touching a HALO pixel, or within 30 px of a saturation-flagged pixel (OVERFLOW, NONLINEAR, BLOOM) in the same photo. Limitation: a saturated star just outside a cached box can't be seen, so the 30 px test covers the box only. The star-hit count stands: 26 of 193 tried.
- 15 Nov 2026, 03:43 IST: **the HALO rule removed every candidate (0 of 1,948).** The files' headers define HALO as "number of flagged **transient** halo pixels", from the pipeline's "cosmic ray halo flagging" step. It's the ring flagged around a hit, not a bright star's halo, so excluding it removes every real hit. This was our misreading (the Barnard card's plain name too). Ran the variant without "no HALO" (keeping "not within 30 px of a saturation-flagged pixel"): 1,037 qualify; pick 2025W24_1A_0631_3, D6, 4 px TRANSIENT; SkyBoT clear; nothing there in 3 of 3 other photos of the same sky within 5 days; about 97 px from R Draconis. Sent to Physics to decide this and the Barnard card's HALO wording. Not exported or pushed.
