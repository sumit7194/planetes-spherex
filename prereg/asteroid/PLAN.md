# A known asteroid, seen moving (N5): rules fixed before any data is read

- **Why:** the challenge asks us to spot moving objects. The clearest honest demo is a known asteroid in real SPHEREx photos: SkyBoT's predicted path drawn ahead, the measured positions on it, and the spot empty a day later. It also becomes the field guide's "known asteroid" card.
- **Rules:** Event build's plan (14 Nov, 22:07 IST), changed by Physics (14 Nov, ~22:13 IST message). Written here on 15 Nov 04:00 IST, before any asteroid search, photometry or SkyBoT query for this item.
- **Status:** registered. Nothing searched yet.

## 1. Data
- The cached photo boxes (pipeline/cache/*.pkl), with the same V/T exclusion as the field guide (box centre ≥ the field guide's EXCLUDE_DEG from every V/T patch). No new sky is fetched for the search. The chosen object's photos may be re-read from their own files for display (as the field guide's centred crops are).

## 2. Search
- For each cached photo's field: SkyBoT asteroids in the box at the photo's time, one query per field and quarter-day bucket (as the app does), objects moved linearly inside the bucket. **Numbered asteroids only**, with **V ≤ 18**.
- A visit = the photos sharing an obsId stem (exposures _1…_N, minutes apart), same detector.
- **Candidates only where SkyBoT's predicted motion across the visit's exposures is ≥ 2 px (≈ 12″).** Below that, a straight-line fit can't tell motion from noise at S/N 5 (positions good to ~0.2–0.3 px).

## 3. Confirmation (all must pass)
1. **Positions:** in ≥ 3 exposures of the visit, a source at S/N ≥ 5 within 1.5 px of SkyBoT's place at that exposure's time. Each position is measured with the app's recentre; S/N with FIT_REJECT pixels masked in the aperture (the field guide's audit rule).
2. **Motion:** a straight line fitted to the measured positions against time. The fitted displacement over the visit must differ from zero at ≥ 3σ, and agree with SkyBoT's within 3σ, using the fit's own errors. Extra sanity bound: within 30% of SkyBoT's rate and 20° of its direction.
3. **No star stand-in:** no Gaia DR3 star (G < 19) within 2 px of any measured position.
4. **Gone later:** S/N < 3 at the measured sky place in a photo of the same detector taken ≥ 1 day away.
5. **Re-query:** for the chosen object, SkyBoT is re-queried at each exposure's own time, and tests 1–2 are re-run with those positions before it's confirmed.

## 4. Pick
- The brightest SkyBoT V among those passing. **Log how many candidates there were and how many passed each test.**
- If none pass, the result is "no asteroid shown" and no card is made. No tolerance changes after seeing results without a dated entry here first.

## 5. Show
- Marks: "predicted by SkyBoT" on the drawn-ahead places (with SkyBoT's stated position uncertainty if it gives one), "measured" on the fitted positions.
- Card wording: "A known asteroid (number, name): SkyBoT's predicted path and the measured positions agree; it's gone from the same spot a day later."
- Where: a Surprise-me spot (kind "asteroid") using the existing look and movers overlay, and the field guide's asteroid card. Physics sees the pick and its numbers before anything is pushed.

## 6. Log
- 15 Nov 2026, 04:00 IST: registered.
- 15 Nov 2026, 04:00 IST: **setup check (timings and pointings only, no pixels or SkyBoT): the motion rule as written can't be met by almost any asteroid.** A visit (same obsId stem and detector, ≥ 3 exposures) spans 4.3–6.5 minutes in our cache (1,209 visits, median 6.4). Moving ≥ 2 px (12″) in 6.5 minutes needs ≥ ~110″/h. A main-belt asteroid near opposition moves ~30–40″/h (~0.25°/day), so only fast near-Earth asteroids could pass, and almost none at V ≤ 18 will be in our boxes. The same field and detector *is* revisited by other visits: 391 pairs < 2 h apart, 537 at 2–6 h, 1,977 at 6–24 h. A main-belt asteroid moves ~7–30 px between visits 1.5–6 h apart. Asked Physics for a dated rule change before any search; nothing has been searched.
- 15 Nov 2026, 04:03 IST: **amendment (Physics approved, before any search; nothing searched yet).** It replaces sections 2–3 where they differ:
  - **Window:** two visits of the same field and detector **1–4 h apart** (Viewer: the asteroid is seen in a new place in the same view, not just "there, then gone"). **Moves ≥ 5 px** between the visits (SkyBoT, corrected as below). **Main-belt and beyond only:** near-Earth asteroids excluded (SkyBoT class NEA*).
  - **Parallax:** SkyBoT answers for Earth's centre. SPHEREx is ~7,070 km from it, so a main-belt asteroid at 1.5 AU appears up to ~6.6″ (~1.1 px) off, and the offset's direction turns with SPHEREx's ~98 min orbit. Each SkyBoT place is corrected: asteroid vector = Dg × unit(RA, Dec), minus SPHEREx's position from the header (X_SC/Y_SC/Z_SC, km; XYZ_SC_SYSTEM must be GEOCENTER), back to RA/Dec.
  - **Unit check before the search:** one numbered asteroid in one photo, the corrected SkyBoT place against kete's prediction (smo.ephem.known, using the header's observer state). They must agree to **< 0.5″**, or stop.
  - **Detections:** every "S/N ≥ 5" must also pass the **profile test**: light in ≥ 3 aperture pixels above background + 3σ, with FIT_REJECT pixels masked. ≥ 3 such photos over ≥ 2 visits, each within 1.5 px of the corrected place at its own time.
  - **Empty checks** (S/N < 3) count only if measured with FIT_REJECT masked and ≥ 5 of 9 aperture pixels usable. Each measured place must be empty in the other visit (left empty, arrived empty). "Gone a day later" is also checked where a photo ≥ 1 day away exists.
  - **Motion model** (no straight line: the orbit makes the seen path wobble): (1) the two visits' mean positions differ by ≥ 3σ (per-position σ = max(recentre scatter, 0.25 px)); (2) each measured position lies within 3σ of the corrected SkyBoT place at its own time, after one shared offset capped at SkyBoT's stated 1σ position error (1″ if none given), with the offset reported; (3) sanity: the displacement between visit means is within 30% and 20° of SkyBoT's corrected displacement.
  - For the pick, SkyBoT is re-queried at each photo's own time and the tests are re-run. No Gaia (G < 19) within 2 px; numbered only; V ≤ 18; the brightest passing is picked; counts are logged per test.
- 15 Nov 2026, 04:06 IST: **unit check passed.** 644 Cosima (V 15.9, 2.47 AU) in 2025W43_2A_0182_1 D1. The corrected SkyBoT place is **0.14″** from kete's prediction (smo.ephem.known with the header's observer state); the uncorrected geocentric place was 1.14″ off. The header's SPHEREx position agrees with kete's reconstructed SPHEREx state to 3.1 km. The check also caught that SkyBoT's JSON field names differ from what the script assumed; they're now read from a real answer.
- 15 Nov 2026, 04:37 IST: **search result under the registered rules: no asteroid shown.** 470 SkyBoT queries over the 30 fields with 1–4 h revisits returned 974 objects, 19 at V ≤ 19 and 4 at V ≤ 18. **3 numbered, non-NEA, V ≤ 18 candidates** (1340 Yvette V 16.7, 4306 Dunaevskij V 17.7, and one more pair-match of these) all moved ≥ 5 px. But **none was inside a cached box in any photo**: the boxes are ~60 px (~6′) cut around our targets, while SkyBoT searched a 0.16° radius. So 0 reached the detection test. Nothing was measured on any asteroid. Asked Physics whether fresh 32×32 boxes may be read at SkyBoT's (corrected) places from the photos' own files (spherex.read_box, as the field guide's centred crops are), with every test unchanged.
- 15 Nov 2026, 04:37 IST: **amendment 2 (Physics approved; written before any pixel is read). The last rule change for this build.**
  - For **all 3 candidates**, fresh 32×32 boxes are read from each photo's own file, centred on SkyBoT's corrected place at that photo's time (spherex.read_box). Every test is unchanged. Each candidate's result against every test is logged; the brightest passing is picked.
  - **Empty checks:** each needs a box that covers the place in the other visit's photo. If the box centred on that photo's own predicted place doesn't cover the measured place with a ≥ 3 px margin, an extra box is read there. A cached box that doesn't cover it is never used.
  - **V/T exclusion** is run on the candidates' actual measured positions, not just field centres.
  - If none passes, N5 ends as **"no asteroid shown"**, with the counts per test.
- 15 Nov 2026, 04:40 IST: **final result (amendment 2): no asteroid shown. N5 is closed for this build.** Counts per test: 3 candidates → 3 move ≥ 5 px → **0 reach ≥ 3 detections (S/N ≥ 5 with a profile) over 2 visits** → nothing further tested.
  - 4306 Dunaevskij (V 17.7; 2025W39_1A_0457 → _0480, D1, 13.6 px): off the detector in _0457_1; S/N −0.6 and 0.1 in _0480_1/_2.
  - 1340 Yvette (V 16.7; D1), pair _0334 → _0348 (6.6 px): only one photo per visit (S/N 5.3 with light in 1 pixel, S/N 4.7 with 2), so it can't reach 3 detections and fails the profile test.
  - 1340 Yvette, pair _0348 → _0373 (14.8 px): S/N 4.7 (2 px of light), then 0.5, 0.9, 1.1, 1.5 in the four _0373 exposures.
  - A bug found and fixed before this final run: photos with two cached boxes appeared twice in a visit and could have counted as two detections. Visits now hold one entry per photo; the result didn't change.
  - Why so few candidates: our cached photos are around our five targets and the live looks, mostly far from the ecliptic (58 distinct fields, 2 within 1° of it), so few bright asteroids pass through them.
