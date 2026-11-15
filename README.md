# Planetes: watch SPHEREx's sky change

**NASA Space Apps Challenge 2026 · "Planet X and SPHEREx" · team Planetes (Gorakhpur, India)**
Live: https://sumit7194.github.io/planetes-spherex/

A public web tool that shows NASA SPHEREx's infrared photos of any patch of sky over time, so anyone can see what moved or changed. _Planetes_ is Greek for "wanderers".

## What it does

- **Any spot.** Type a name or a position, click the sky map, or open a link: `?ra=133.76&dec=-7.2426` (decimal or sexagesimal), or `?at=133.76,-7.2426`. The browser finds every DR1 + QR3 photo of the spot in a static sky index and reads the pixels straight from NASA's public S3 bucket. No server is involved.
- **The five challenge targets**, prepared and measured: Barnard's Star, WISE 0855−0714 and Epsilon Indi B (moves measured against Gaia's predictions), RW Aurigae and R Draconis (variables, with an honest status).
- **Blink and compare** any two passes, **show the difference** on a fixed ±5σ scale, or **watch every photo** in date order, one colour at a time.
- **102 colours.** Each photo's own wavelength map (WCS-WAVE) gives the colour it saw at the spot. Passes are compared at matching colours, and **spectra are built on the fly** from one measurement per photo.
- **Overlays**: Gaia DR3 and CatWISE2020 moved by proper motion; known asteroids and comets at each photo's time (IMCCE SkyBoT); SPHEREx pipeline flags drawn as outlines.
- **Context**: SPHEREx's DR1 all-sky map in Aladin Lite, with a slider through all 102 wavelengths.
- **Honest by construction**: every number carries a status (measured, predicted, not reliable, not measurable yet).
- **Embeds**: `?embed=1` for an iframe on another site.

## How it works

```
pipeline/ (Python, run during the event)                     public/data/ (static, read by the app)
 build_index.py   S3 listing + IRSA footprints ─────────────► index/dr1qr3/      1.63 M photos, 24-byte records
 planetes_pack.py SIA search → S3 byte ranges → per-photo   ► packs/dr1qr3/<id>/ frames, flags, stacks, measurements
                  WCS, RICE flags, WCS-WAVE → stacks          spectra/, overlays/
 measure.py       2D fits + still-star correction ───────────► measurements.json
 build_pointing.py footprints → where SPHEREx looked ────────► pointing/
src/ (TypeScript)
 data/live/dr1qr3.ts  in-browser: index lookup, header WCS (TAN-SIP), RICE decoder, WCS-WAVE, resampling,
                      aperture photometry, spectrum on the fly
 data/live/skybot.ts  known solar-system objects per photo time
```

Measuring a move: each pass's photos (one detector) are median-stacked with saturated and artefact pixels masked. OUTLIER is never masked, because it fires on real movers. A 2D Gaussian is fitted to the target: only the wings when the core is saturated, with catalogued neighbours fitted alongside at fixed positions. The same is done for isolated Gaia "still stars" in the field. The target's shift minus the still stars' common shift, as a median over detectors, is reported as **measured** only if at least two detectors give a fit and 90% of the still stars agree to within 0.2 px. The prediction uses the catalogue proper motion plus parallax for the same photos.

## Updating for a new SPHEREx release

1. Add the new collections to `COLLECTIONS` in `pipeline/spherex.py` (e.g. `spherex_dr2`).
2. Re-fetch the footprints from IRSA TAP (ObsCore, the four DR1/QR3 collections plus the new ones) and run `uv run python build_index.py --footprints <csv>`.
3. Rebuild the five packs: `uv run python planetes_pack.py <id>` locally, or the "Build a pack" GitHub Actions workflow, which runs next to the S3 bucket.
4. The viewer reads whatever is in `public/data/`, so no code changes.

## Run it

```sh
npm install
npm run dev            # http://localhost:5180
npm run check          # typecheck, lint, format, tests

cd pipeline && uv sync
uv run python planetes_pack.py barnard     # one of pipeline/targets.json
uv run python build_index.py --footprints footprints.csv
```

## Data, credits, prior work, AI

- See the app's **Credits** page, [PRIOR_WORK.md](PRIOR_WORK.md) (how this entry was built: the practice run before the event, what carries over, and AI use), and [docs/SUBMISSION.md](docs/SUBMISSION.md).
- **NASA data:** SPHEREx DR1 and QR3 spectral images and the DR1 HiPS cube (IRSA); IRSA SIA and TAP; CatWISE2020 (IRSA).
- **Other:** ESA Gaia DR3; IMCCE SkyBoT; CDS Aladin Lite and Sesame.

> This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

**AI use:** built with substantial help from Claude (Anthropic), which wrote most of the code and draft text under my direction, and I reviewed it. The idea, the design choices and the final review are mine. No AI-generated images, audio or video are used.
