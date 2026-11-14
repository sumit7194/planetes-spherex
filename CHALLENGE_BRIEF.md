# Planet X and SPHEREx — Challenge Brief

Team **Planetes** (solo, owner) · Local event **Gorakhpur, India** · NASA Space Apps 2026
Challenge page: https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/
Difficulty: **Advanced** · Subjects: Astrophysics, Planets & Moons, Software

## ⏰ Deadline
**Sunday, Nov 15, 2026, 11:59 PM IST** (Gorakhpur local time). Click **"Submit for Judging"** before then.
Submission opened Sat Nov 14, 9:00 AM. You can save and resubmit as many times as you like; judges see the last saved submission.

---

## 1. What we must build (the core requirement)

> A **public-facing web tool** that shows **SPHEREx images of the sky** so that **anyone** can quickly see **how a patch of sky changes over time**.

Required behaviour:
1. The user enters **coordinates** (Right Ascension + Declination).
2. The tool fetches **all SPHEREx images of that patch** taken at different times.
3. It plays them **like a little video (a blink or flipbook)** so moving objects stand out.

**Required test targets** (the demo should show all five):

| Target | Why it's there | Approx. J2000 coords* |
|---|---|---|
| Barnard's Star | Star with the largest proper motion (~10.4″/yr) | 17h57m48.97s +04°41′36″ |
| Epsilon Indi B | Pair of brown dwarfs orbiting a star (~4.7″/yr) | 22h04m10.5s −56°46′58″ |
| WISE 0855−0714 | Fast-moving, very cold brown dwarf (~8″/yr) | **08h55m10.831s −07°14′42.53″** (given in the challenge) |
| RW Aurigae | Variable star (young T Tauri star) | 05h07m49.5s +30°24′05″ |
| R Draconis | Variable star (Mira, ~245-day period) | 16h32m40.2s +66°45′18″ |

\*Only WISE 0855's coordinates come from the challenge text. The rest are from memory, so resolve them with a name resolver (CDS Sesame/SIMBAD) inside the app instead of hard-coding them.

Two scale notes:
- SPHEREx pixels are about **6.2″**, so in roughly 1.5 years of data Barnard's Star moves only about 2–3 pixels, and WISE 0855 about 2 pixels. The display needs zoom and a well-chosen stretch to make that visible.
- The variable stars test **brightness change**, not motion. Showing a light curve or a flux readout per epoch would help here.

## 2. "Potential considerations" (optional, but this is where the creativity score comes from)
- **Easy to update** as new data releases arrive. Don't hard-code a single release; query the archive live (QR2 → QR3 → DR1 …).
- **Use the 102 bands creatively**, e.g. co-add all the data from each of the **6 detector arrays** to improve signal-to-noise. **"Extra kudos" for generating spectra on the fly.**
- Options to **add (stack) or subtract (difference)** images from different times, to reveal movers.
- **User-selectable field of view**: bigger FOV tracks faster movers but means more data to transfer.
- **Overlays from other telescopes**: **Gaia** (DR3), **WISE**.
- **Coordinates in the URL** (e.g. `?ra=…&dec=…&fov=…`) so the tool can be embedded or linked from other sites.
- Show **metadata**, such as **contamination flags**.
- Reuse existing tools: **Astropy** (data handling) and **Aladin Lite** (CDS, Strasbourg) for display.

## 3. Official resources (from the Resources tab)
**NASA**
- NASA/IPAC Infrared Science Archive (IRSA), SPHEREx — https://irsa.ipac.caltech.edu/Missions/spherex.html
- SPHEREx tutorial notebooks (Python data access) — https://caltech-ipac.github.io/irsa-tutorials/spherex/
- WiseView, the model to follow for a WISE blink tool — http://byw.tools/wiseview
- Gaia mission data (use **DR3**) — https://archive.stsci.edu/missions-and-data/gaia

**CSA (Canadian Space Agency) partner resources** (optional; partner data is encouraged)
- NEOSSat — https://www.asc-csa.gc.ca/eng/satellites/neossat/
- CADC — https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/
- NEOSSat tutorial — https://github.com/asc-csa/NEOSSAT_Tutorial
- NEOSSat dataset — https://data.asc-csa.gc.ca/dataset/neossat

### What IRSA offers for SPHEREx (as of today)
- Releases: QR (Jul 2025) → QR2 (Oct 2025) → QR3 (Sep 2026) → **DR1 (Nov 2026)**
- Services: DR1 and Quick Release access, **Cloud Data Access (AWS S3)**, **Moving Object Search Tool (MOST)**
- Science tools: **Spectrophotometry Tool** (forced-photometry spectra), **Mosaic Tool**, **Cutout Tool**, **Source Discovery Tool**
- Docs: Explanatory Supplement, Archive User Guide, Program Interfaces, Spectral Channel Maps
- Notebooks: intro, cutouts, PSF, source discovery, mosaic cubes, **HiPS cubes**
- Instrument: Linear Variable Filter (LVF) spectrograph, 0.75–5.0 µm, 6 detectors:
  0.75–1.1 µm (R=39), 1.1–1.6 (R=41), 1.6–2.4 (R=41), 2.4–3.8 (R=35), 3.8–4.4 (R=112), 4.4–5.0 (R=128)
- Required acknowledgement text for SPHEREx data use is on the IRSA page. Put it in the app footer.

### WiseView features worth mirroring (it's the reference design)
RA/Dec input · FOV in arcsec · band choice · sliding epoch window · blink interval · zoom · min/max stretch and linearity · invert · difference imaging · shift-and-add (pmra/pmdec) · Gaia DR3 overlay · all state in the URL hash.

## 4. Judging (each criterion scored 1–5)
- **Impact**: helps lots of people (citizen scientists) make discoveries.
- **Creativity**: something new beyond a WiseView clone (multi-band, spectra, etc.).
- **Validity**: scientifically sound, actually works, usable.
- **Relevance**: NASA (SPHEREx) data is the core of the tool.
- **Presentation**: a clear demo and story.

## 5. Submission checklist
- [ ] Project Name
- [ ] High-Level Project Summary
- [ ] **Demo link**: a **≤30-second video** OR **≤7 slides** (including title and intro slides), English (or subtitled), public, no login. **Going over these limits makes the project ineligible for global judging.**
- [ ] **Final project link**: a public URL (deployed site and/or GitHub repo), no login
- [ ] Detailed Project Description (what it does, how it works, benefits, tech used)
- [ ] Use of SI/AI: disclose it. AI-generated images and video need a visible watermark; AI-written code and data need a note in the text and metadata. No NASA logos in generated content.
- [ ] NASA Data used (SPHEREx via IRSA; Gaia; WISE …)
- [ ] Partner data and other references: list **every** library, tool and dataset (Aladin Lite, Astropy, etc.)
- [ ] Tick both checkboxes (Terms; original work), then **Submit for Judging**
- [ ] Nothing showing anyone under 18
- [ ] Optional: request a FortiGuard web-filter classification for the deployed site so judges aren't blocked
- [ ] Slides must show the team name, member names and the challenge name

## 6. SPHEREx data access (technical)
Already tested on 13 Nov. See `~/Github/Planetes/docs/hackathon/RUNBOOK_14NOV.md` §1–5 (CORS, S3 byte-range reader, flag masking policies, HiPS cube, Spectrophotometry tool, gotchas). The working prototypes are in `~/Github/Planetes/docs/hackathon/prep/`.
