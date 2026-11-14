# Planetes: watch SPHEREx's sky change

**NASA Space Apps Challenge 2026 · "Planet X and SPHEREx" · team Planetes (Gorakhpur, India)**

A public web tool that shows NASA SPHEREx's infrared photos of any patch of sky over time, so anyone can spot what moved or changed. _Planetes_ is Greek for "wanderers".

Type a star's name or a position (RA, Dec). Planetes plays SPHEREx's photos of that spot pass by pass, like a short video. A nearby star or brown dwarf walks across the frame; a variable star brightens or fades.

## What it does

- **Blink.** One stacked frame per six-month survey pass (all of that pass's photos, median-combined), on one fixed brightness stretch, so changes are real and not an artefact of the display. A fixed reference ring, a dashed predicted path from the catalogue proper motion, and the rough measured centre of each stack.
- **Difference.** Any pass minus any other, on a fixed ±5σ scale, with every artefact flag masked. A move shows as a dark-and-bright pair; a brightness change shows as a ring.
- **Stack.** All passes added together, for depth.
- **Every photo.** Each single photo in time order, labelled with its own wavelength.
- **102 colours.** SPHEREx's linear variable filter means every photo sees the target at a slightly different wavelength. Planetes shows each of the six detectors' colour ranges, "all colours" (noise-weighted), and **a spectrum on the fly**: one quick aperture measurement per photo, plotted at that photo's own wavelength (read from each file's WCS-WAVE table), coloured by pass.
- **Field of view.** 6.6′, 3.3′ or 1.6′.
- **Overlays.** Gaia DR3 and CatWISE2020 sources, moved to each pass's date by their proper motions; saturated pixels outlined in red.
- **Metadata.** Release (DR1 / QR3), photo counts and dates per pass, and the SPHEREx pipeline's flags near the target, explained.
- **Context.** Aladin Lite with IRSA's SPHEREx DR1 all-sky HiPS cube and a wavelength slider.
- **Links and embeds.** Every view is a URL: `?t=barnard&mode=diff&det=6&a=1&b=3`, or `?ra=133.76&dec=-7.2426`. An "Embed" button copies an `<iframe>`.

The five challenge test targets are prepared: Barnard's Star, WISE 0855−0714, Epsilon Indi B, RW Aurigae and R Draconis.

## How it works

```
pipeline/ (Python)                                   web app (TypeScript, static)
 IRSA SIA  ──► list of SPHEREx L2 images (DR1+QR3)    public/packs/<target>/
 S3 byte ranges ──► just the rows around the target      pack.json   metadata, passes, spectra, catalogue
 FLAGS (RICE) decoded, WCS-WAVE read                     coadds.bin  per pass × detector stacks (display + strict)
 resample to one north-up 6.15″ grid                     sat.bin     saturation fraction per pixel
 median per pass × detector; aperture photometry         frames.bin  every photo, 16-bit
```

- Photos are read straight from NASA's public SPHEREx bucket (`s3://nasa-irsa-spherex`) with HTTP range requests: about 1 MB per photo instead of 66 MB.
- **New releases:** the release is a setting (`COLLECTIONS` in `pipeline/spherex.py`). When IRSA publishes DR2, add `spherex_dr2` and re-run the builder; the viewer needs no change.

## Run it

```sh
npm install
npm run dev                          # http://localhost:5180

cd pipeline
uv sync
uv run python build_pack.py barnard                 # a prepared target (targets.json)
uv run python build_pack.py --ra 210 --dec -30      # any position → public/packs/p210.0000-30.0000
```

## Data, tools and credits

See [About & credits](about.html) and [PRIOR_WORK.md](PRIOR_WORK.md).

- **NASA data:** SPHEREx DR1 and QR3 spectral images (IRSA); SPHEREx DR1 HiPS cube (IRSA); IRSA SIA and TAP services; CatWISE2020 (IRSA).
- **Other data:** ESA Gaia DR3 (ESA Gaia archive).
- **Software:** Aladin Lite v3 (CDS, GPL-3.0, loaded from jsDelivr); astropy, numpy, scipy, aiohttp; Vite, TypeScript; Source Serif 4 and Source Sans 3 (SIL OFL).
- **Inspiration:** WiseView (byw.tools) and Backyard Worlds: Planet 9.

> This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

**AI use:** this project was built with substantial help from Claude (Anthropic), an AI assistant, which wrote most of the code and draft text under the team's direction and review. The idea, the design choices and the final review are the team's. No AI-generated images, audio or video are used.
