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
