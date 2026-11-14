/**
 * The copy deck: every public string in one place.
 *
 * Rules (from the team consensus):
 *  - Plain words. No m0, HEALPix, TAN-SIP, CWAVE, Δλ, pack, IRSA, S3, QR2 or bare "px" in UI text;
 *    technical terms only on hover or the how-it-works page.
 *  - One sentence per state, plus one honest qualifier.
 *  - Numbers come from the pack's measurements with their status, never typed in here.
 *  - A string ships only after Physics signs off its truth and The Bridge its plainness.
 *    Track that in `review` below.
 */

/** "1, 5 and 6". */
export const list = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** How much brighter or fainter, in words: see copy.brightness.phrase. */
function copyPhrase(r: number): string {
  return Math.abs(r - 0.5) <= 0.05
    ? 'about half as bright'
    : r < 1
      ? `about ${Math.round(r * 100)}% as bright`
      : Math.abs(r - 2) <= 0.1
        ? 'about twice as bright'
        : `about ${Math.round((r - 1) * 100)}% brighter`;
}

export const copy = {
  sky: {
    invitation: 'SPHEREx photographed the whole sky, at least twice.',
    /** v0: only the lanterns open something, so the prompt doesn't promise more. */
    /** Physics, 29 Oct: "known, from other telescopes" so it never reads as SPHEREx's own claim. */
    prompt:
      'Five lights here are known, from other telescopes, to move or change. Pick one to see what SPHEREx caught.',
    promptTouch:
      'Five lights here are known, from other telescopes, to move or change. Pick one to see what SPHEREx caught.',
    /**
     * Riding with SPHEREx (branch). Physics, 29 Oct: the camera on the orbit sees every star
     * where Earth's centre would; it steps round the sky ~3.7° a minute on average, one full
     * circle per 98-minute orbit; from 659 km up Earth fills everything within ~65° of straight down.
     */
    riding: {
      note: 'Riding with SPHEREx: it steps round the sky about 3.7° a minute (shown 10× faster)',
      /** Physics, 29 Oct: the timelines are each exposure's header WCS; say the speed-up. */
      ridingReal: 'Riding with SPHEREx: where it really pointed, {when} · 10× faster',
      ridingGap: ' · a gap (downlink or calibration), shortened',
      ride: 'Ride with SPHEREx',
      riding: 'Riding with SPHEREx',
      earthBelow: 'Earth, about 660 km below',
      /** Under Earth's name in the 3D view (Physics: date the maps). */
      surface: 'Surface: NASA Blue Marble, {month} 2004 · night lights 2016',
      /** Physics, 29 Oct: its place on the orbit is approximate (within ~35°). */
      ghost: 'SPHEREx · approximate place · too small to see',
      ghostBehind: 'SPHEREx, behind Earth from here',
      /** Close in, in 3D: the model at its real size (JPL: 2.6 m tall). */
      trueSize: 'SPHEREx · 2.6 m tall · true size',
      /** After the scale bar's length: where in depth the bar holds (a perspective view). */
      scaleAtSpherex: 'at SPHEREx',
      scaleAtEarth: "at Earth's centre",
      earth: 'Earth',
    },
    /** Over the stack of chips for the five that are out of view. */
    outOfView: 'Out of view',
    /** The landing's dock: photos per week. */
    weeks: {
      label: (n: number, weeks: number) =>
        `SPHEREx took ${n.toLocaleString('en-GB')} photos in ${weeks} weeks; pick a week to see where it looked.`,
      unit: (weeks: number) => `photos in ${weeks} weeks · pick one`,
    },
    /** Round 3: three verbs under the headline instead of three sentences. */
    verbs: {
      pick: 'Pick a light',
      pickSub: '5 known, from other telescopes, to move or change',
      anywhere: 'Click anywhere',
      anywhereTouch: 'Tap anywhere',
      anywhereSub: "SPHEREx's own photos of that spot",
      move: 'Drag · scroll',
      moveTouch: 'Drag · pinch',
      moveSub: 'look around · zoom',
    },
    anywhere: "Or click anywhere for SPHEREx's own photos.",
    anywhereTouch: "Or tap anywhere for SPHEREx's own photos.",
    /** Shown until the first drag or zoom, then gone. */
    moveHint: 'Drag to look around; scroll or pinch to zoom.',
    moveHintTouch: 'Drag to look around; pinch to zoom.',
    startHere: 'Start with the runaway star.',
    search: 'Find a star or a position',
    entrySwitch: { flat: 'Flat map', inside: 'Look around' },
    /** In the 3D tier the globe button steps out to Earth and SPHEREx's orbit instead. */
    entrySpace: 'From space',
    /** The Bridge, 30 Oct: plainness; "photo" is one detector image everywhere, a "snapshot" is six at once. */
    insideNote:
      'The whole sky around you, as the telescope sees it. Drag to look around; scroll or pinch to zoom.',
    /** Physics, 30 Oct: three 3.49° patches, centres 3.86° apart; each patch seen by two detectors at once. */
    /** One detector photo: 3.49° across (Physics), about 6.7 full Moons (0.52°). */
    photoSize: 'One SPHEREx photo',
    photoDetail: 'about 7 full Moons across',
    moonToScale: 'the Moon, to scale',
    stepOut: 'Keep scrolling to step outside the sky',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    sunToday: 'The Sun today, on its yearly path',
    sunOn: 'The Sun on {date}, on its yearly path',
    lookingNear: (star: string) => `Looking near ${star}`,
    nearestNamed: (star: string) => `Nearest named star: ${star}`,
    lensField: 'a close-up shows this much',
    scrollToOpen: (name: string) =>
      `You've zoomed in as far as this map goes. Scroll once more to open ${name}.`,
    tapToOpen: (name: string) =>
      `You've zoomed in as far as this map goes. Tap ${name} to open it.`,
    nothingHere:
      "We haven't measured anything here yet. For now, close-ups open only on the five named lights.",
    /** The time sweep over the weekly coverage maps (Physics). */
    sweep: {
      open: 'Where did SPHEREx look?',
      close: 'Hide where it looked',
      week: (from: string, to: string) => `${from} to ${to}`,
      frames: (n: number) => `${n.toLocaleString('en-GB')} photos that week`,
      soFar: 'Faint: everything photographed so far. Bright: that week.',
      keySoFar: 'so far',
      keyWeek: 'that week',
      why: 'Why does it sweep?',
      hint: 'Drag the weeks, press play, or hold Shift and scroll over the sky.',
      hintTouch: 'Drag the weeks, or press play.',
      play: 'Play',
      pause: 'Pause',
      placeholder: 'Placeholder pattern, not real coverage.',
      thisWeek: 'Photographed this week',
    },
    catalogueNote: 'Background stars, glow and lines: catalogues, not SPHEREx.',
  },
  wanderers: {
    barnard: { name: "Barnard's Star", short: 'A runaway star' },
    w0855: { name: 'WISE 0855', short: 'One of the coldest brown dwarfs' },
    'epsind-b': { name: 'ε Indi B', short: 'Twin brown dwarfs in one dot' },
    'r-dra': { name: 'R Draconis', short: 'A giant star that breathes' },
    'rw-aur': { name: 'RW Aurigae', short: 'A young, flickering star' },
  },
  show: {
    expectation: 'Watch the ring. It holds still.',
    moved: (name: string) => `${name} moved.`,
    movedDir: (name: string, direction: string) => `${name} moved ${direction}.`,
    /** Copy round 1, variant A (picture first), truth-checked by Physics 29 Oct. */
    coinSizeOne: 'About the size of a 2 cm coin seen from {metres} metres: about {lo} arcseconds.',
    chipMeasured: 'measured {value} ± {error} pixels',
    chipPredicted: 'predicted {value} pixels',
    holdKey: 'Space',
    trueScale: 'Shown at true size first, then enlarged.',
    arrowRealSize: 'Arrow at its real size',
    enlarged: (factor: number) => `Arrow drawn ${factor} times longer than the real move`,
    look: (n: number, month: string) =>
      `${['First', 'Second', 'Third', 'Fourth'][n - 1] ?? `Look ${n},`} look, ${month}`,
    pairs: 'Compare looks',
    pairMeasured: 'measured pair',
    pairUnmeasured: (a: number, b: number, pa: number, pb: number) =>
      `Looks ${a} and ${b} aren't measured against each other yet; only looks ${pa} and ${pb} carry a number.`,
    pairUnverified: (a: number, b: number, pa: number, pb: number) =>
      `Looks ${a} and ${b} have a measurement, but it isn't verified yet, so we don't show its number; looks ${pa} and ${pb} carry the measured move.`,
    release: (release: string, parts: string[]) =>
      release === 'dr1qr3'
        ? `Data: SPHEREx ${parts.join(' + ')} (IRSA)${parts.includes('QR3') ? '' : '; no QR3 photos of this spot yet'}.`
        : `Data: SPHEREx ${release.toUpperCase()}, an older release; this target's DR1 + QR3 pack isn't built yet.`,
    shifted: (range: string, metres: number, direction: string) =>
      `Between these two looks it moved ${range} ${direction}, like a 2 cm coin seen from ${metres} metres.`,
    measuredRow: (value: string) => `Measured by SPHEREx: ${value} pixels`,
    predictedRow: (value: string) =>
      `What a star catalogue predicts for the same photos: ${value} pixels`,
    lookedHere: (name: string) => `${name}: here is how it looked to SPHEREx.`,
    hold: 'Hold to compare',
    holdHint: 'Or press and hold the space bar. There is nothing to get wrong.',
    holdNotYet: 'Both looks are still coming in.',
    diffButton: 'Show the difference',
    diffLabel: (later: number, earlier: number) => `Look ${later} minus look ${earlier}`,
    diffFainter: (limit: number) => `fainter later, −${limit}σ`,
    diffBrighter: (limit: number) => `+${limit}σ, brighter later`,
    diffHow: (sigma: string) =>
      `Grey: no change we can tell from the noise. The scale stops at 5 times this difference's own noise (σ = ${sigma} MJy/sr), after removing the level of the whole field.`,
    diffLoading: 'Reading both looks, photo by photo…',
    /** Both looks are rebuilt from the same detectors, so they mix colours alike, but not exactly. */
    diffColours: (detectors: number) =>
      `Each look is rebuilt from its own photos in the ${detectors} colour ranges both have, leaving out pixels flagged as saturated or bad. Something that moved shows as a dark and bright pair, but bright stars that didn't move can too, because each look blends photos with different blur and colours. A pair alone isn't proof of motion; the measured move, where there is one, is in the ring.`,
    diffScope: (range: string, narrowed: boolean) =>
      narrowed ? `Colours used: ${range}, where it shows.` : `Colours used: all, ${range}.`,
    diffAll: 'Use every colour',
    diffNarrow: 'Only where it shows',
    diffMasked:
      'Hatched: not compared. Saturated or bad in either look, or too few usable photos there.',
    diffTrouble:
      "The difference couldn't be made: the photos didn't all load, or too few pixels were usable in both looks.",
    /** Checked by Physics: one detector holds about 17 of SPHEREx's 102 colour bands. */
    holding: (lo: string, hi: string) =>
      `Holding: one detector's slice of infrared colours (${lo} to ${hi} microns). Good for position, not for brightness.`,
    holdingNoBand:
      "Holding: one detector's slice of infrared colours. Good for position, not for brightness.",
    allColours: 'Let go: all colours, which is fine for position.',
    replay: 'Replay',
    why: 'Why?',
  },
  /**
   * A saturated star's brightness from the unsaturated edges of its image (event pipeline,
   * 14 Nov): later pass ÷ earlier, per colour range, at matching colours. Wording agreed with the
   * pipeline: say where and how much; no "varies", and no cause (it isn't ours to claim).
   */
  brightness: {
    range: (lo: number, hi: number) => `${lo}–${hi} µm`,
    sentence: (
      name: string,
      parts: { range: string; r: number; err: number }[],
      from: string,
      to: string,
      sys: number | null,
    ) => {
      const fig = (r: number, e: number) => `${r.toFixed(2)} ± ${e.toFixed(2)}`;
      const how = 'from the unsaturated edges of its image, compared at matching colours';
      const check = sys
        ? ` Comparison stars in the same photos scatter by about ${Math.round(sys * 100)}%.`
        : '';
      const [one] = parts;
      if (parts.length === 1 && one)
        return `At ${one.range}, ${name} was ${copyPhrase(one.r)} in ${to} as in ${from} (${fig(one.r, one.err)}), ${how}.${check}`;
      const clauses = parts.map((p) => `at ${p.range} ${copyPhrase(p.r)} (${fig(p.r, p.err)})`);
      return `${name} in ${to}, against ${from}: ${clauses.join('; ')}; ${how}.${check}`;
    },
    combined: '(A and B together: they sit inside one SPHEREx pixel)',
    combinedSentence: 'That is A and B together: they sit inside one SPHEREx pixel.',
    row: (
      later: number,
      earlier: number,
      measured: readonly (readonly [string, number, number])[],
      unreliable: string[],
    ) =>
      `look ${later} ÷ look ${earlier}: ${measured.map(([range, r, e]) => `${range} ${r.toFixed(2)} ± ${e.toFixed(2)}`).join(', ')}${unreliable.length ? `; not reliable at ${unreliable.join(', ')}` : ''}`,
    noneForPair: (a: number, b: number) =>
      `no colour range passes the checks between looks ${a} and ${b}`,
    howHeading: 'How was this measured?',
    how: (
      sys: number | null,
      steady: { lo: string; hi: string } | null,
      notes: { toleranceAfter: boolean; combined: boolean },
    ) =>
      `SPHEREx's detector saturates at the star's centre, so the centre is left out. The edges of its image, which aren't saturated, are compared between the two looks, in photos paired at matching colours. A colour range gets a number only if two rings at different distances from the centre agree within 10% (a partial check that dimming doesn't change which part of the edge is measured), the change is more than 3 times its total error, and at least 10 photo pairs exist.${sys ? ` Comparison stars measured the same way in the same photos set the systematic error: ${Math.round(sys * 100)}%.` : ''}${steady ? ` The method was also tried on Barnard's Star, which saturates too but holds steady: in the colour ranges given a number here it gives ${steady.lo === steady.hi ? steady.lo : `${steady.lo} to ${steady.hi}`} for it, where 1 means no change; a range that fails this test isn't trusted.${notes.toleranceAfter ? " That test's tolerance was chosen after seeing its results." : ''}` : ''}${notes.combined ? ' RW Aurigae A and B sit inside one SPHEREx pixel, so this is their combined light.' : ''} Another range shows as not reliable, without a number.`,
  },
  /** The context map: IRSA's SPHEREx DR1 all-sky HiPS cube in CDS Aladin Lite (14 Nov). */
  context: {
    heading: "SPHEREx's all-sky map around it",
    what: "Every SPHEREx DR1 photo of this part of the sky added together, one colour at a time: IRSA's map, shown with CDS's Aladin Lite. It shows what shines in which colour; being all photos at once, it can't show motion, and it isn't for measuring brightness. The box is the lens's field.",
    slider: 'Colour (wavelength)',
    blue: '0.77 µm',
    red: '5 µm',
    wavelength: (um: string, blank: boolean) =>
      blank ? `${um} µm: blank in this map` : `${um} µm`,
    failed: "The map didn't load: it comes from CDS and IRSA over the web.",
  },
  /** "Spot the mover": only where the eye test says it can be seen (Barnard's Star). */
  spot: {
    button: 'Spot the mover',
    heading: 'Which way did it go?',
    what: 'Try finding it yourself before the arrow tells you.',
    prompt: (name: string) =>
      `${name} hops between the two looks, numbered under the lens. Tap the lens on the side it moved to.`,
    nudge: "That's the ring's centre: tap a little way out, on the side it moved to.",
    showMe: 'Show me',
    look: (n: number) => `Look ${n}`,
    keys: 'Or use the arrow keys: ↑ north, ↓ south, ← east, → west (east is on the left, as on the sky).',
    yes: (dir: string) => `Yes: it moved ${dir}, the way the arrow points.`,
    close: (dir: string) =>
      `Not quite: it moved ${dir}, the way the arrow points. Your tap is the cross.`,
    shown: (dir: string) => `It moved ${dir}, the way the arrow points.`,
    again: 'Try again',
  },
  /** Keyboard help (the ? key). */
  keys: {
    title: 'Keys',
    hint: 'Keys: Space to compare, ← → for each look, D for the difference, ? for all.',
    close: 'Close',
    list: [
      ['Space', 'Hold to compare the two looks, in one colour'],
      ['← →', 'The first or second look; in Watch or a look at any spot, the photos one by one'],
      ['D', 'Show or hide the difference'],
      ['/', 'Find a star or a position'],
      ['+ −', 'Zoom the sky'],
      ['↑ ↓ ← →', 'Turn the sky (on the sky)'],
      ['Esc', 'Back to the sky'],
      ['?', 'This list'],
    ] as [string, string][],
  },
  /** "Surprise me": famous fast stars and variables (public/data/surprise.json, Gaia DR3). */
  surprise: {
    button: 'Surprise me: a famous fast star',
    /** Before the looks are chosen: Gaia's motion only. */
    mover: (pm: string) =>
      `Gaia measures it crossing the sky at ${pm} arcseconds a year. This is a look at SPHEREx's photos, not our measurement.`,
    /** With the two looks shown: how far that motion alone carries it between them. */
    moverShift: (pm: string, arcsec: string, px: string, under: boolean) =>
      `Gaia measures it crossing the sky at ${pm} arcseconds a year: about ${arcsec} arcseconds, or ${px} SPHEREx pixels, between the two looks shown${under ? ', under one pixel, so it may not show' : ''}. This is a look at SPHEREx's photos, not our measurement.`,
    variable:
      "Other telescopes see it brighten and fade over months. This is a look at SPHEREx's photos, not a measurement of its brightness.",
  },
  look: {
    /** Known asteroids in a live look's photos (SkyBoT, IMCCE), 14 Nov. */
    movers: {
      asking: 'Asking SkyBoT (IMCCE) for known asteroids in these photos…',
      none: 'No known asteroid or comet brighter than magnitude 19 crosses this field in these photos (SkyBoT, IMCCE).',
      some: (names: string[], nearEarth: boolean) =>
        `Known asteroids in these photos, marked with diamonds where their orbits put them at each photo's time (SkyBoT, IMCCE): ${names.join(', ')}.${nearEarth ? " Near-Earth ones are approximate: positions are for the Earth's centre, not SPHEREx." : ''}`,
      failed: "SkyBoT (IMCCE) didn't answer, so known asteroids aren't marked.",
    },
    /** The any-spot spectrum (event pipeline's recipe in the browser), 14 Nov. */
    spectrum: {
      what: "Measure the brightness of this exact spot in up to 10 photos per colour range, each at that photo's own wavelength.",
      button: (size: string) => `Measure its spectrum (reads about ${size})`,
      reading: (done: number, total: number) =>
        total ? `Measuring photo ${done} of ${total}…` : 'Choosing photos…',
      failed: "The spectrum couldn't be measured: SPHEREx's photos of this spot didn't load.",
      status: (status: string, reason: string) =>
        status === 'measured'
          ? `Measured${reason ? `: ${reason}` : ''}.`
          : status === 'binned only'
            ? `Shape only: averaged in wavelength bins; single photos are too faint to read (${reason}).`
            : `Not measurable here: ${reason}.`,
      shapeCaption: (n: number) =>
        `The line joins averages of about 10 neighbouring photos each (squares, with their error bars); the ${n} faint dots are the single photos, too noisy to read on their own.`,
      caption: (n: number, flagged: number) =>
        `Each dot is one photo at its own wavelength (${n} photos)${flagged ? `; hollow dots (${flagged}) had a flag touching the aperture, so they aren't measurements` : ''}.`,
      caveat:
        'It measures everything within 15″ of this spot together: not checked for neighbouring stars in the aperture. Each pass saw slightly different colours, so compare passes only at matching wavelengths.',
    },
    /** Every photo of the look's colour range, played like Watch (14 Nov, with the cloud helper). */
    range: {
      heading: 'Every photo in this colour range',
      what: 'Play every photo of this spot taken in the same colour range as the pair above, in date order.',
      button: (n: number, of: number, size: string) =>
        of > n
          ? `Play ${n} of its ${of.toLocaleString('en-GB')} photos, spread through time (about ${size})`
          : `Play all ${n} photos (about ${size})`,
      reading: (done: number, total: number) => `Reading photo ${done} of ${total}…`,
      failed: "These photos didn't load, so there's nothing to play.",
      span: (n: number, lo: string, hi: string) => `${n} photos, from ${lo} to ${hi} microns.`,
      drift:
        "Each is at its own wavelength in that range, so a star's brightness can change between them with colour alone; the fair pair above is the comparison.",
      back: 'Back to the fair pair',
      again: (n: number) => `Play the ${n} photos again`,
    },
    finding: 'Finding SPHEREx photos of this spot.',
    probing: (done: number, total: number, of: number) =>
      `Found ${of.toLocaleString('en-GB')} photos. Checking which colour ${total} of them saw here, for a fair comparison: ${done} done.`,
    deep: "This spot is in one of SPHEREx's deep fields, photographed far more often than the rest of the sky; the look picks a few.",
    found: (n: number, from: string, to: string) =>
      `SPHEREx photographed this spot ${n} times between ${from} and ${to}.`,
    foundSlots: 'SPHEREx photographed this spot {n} times between {from} and {to}.',
    picking: (n: number) => `Picking ${n} for a fair comparison.`,
    showing: (shown: number, of: number) => `Showing ${shown} of ${of} photos.`,
    honest: "A look, not a search. We haven't searched this spot for movers.",
    /** Round 3: the honesty line as the first thing on screen, before any number. */
    chip: 'A look, not a search',
    photosHere: 'photos of this spot',
    reading: (n: number) => `reading ${n} in one colour`,
    shownHeading: (n: number, of: number) => `${n} of ${of} shown`,
    sameColourChip: 'same colour',
    fieldWhy: 'Wider fields show faster movers but read more.',
    onePhotoOnly: 'In one photo only: could be an asteroid, a satellite or a cosmic ray.',
    meetOne: "Most of the sky holds still. Meet one that doesn't.",
    stop: 'Stop',
    photoDetails: (name: string, microns: string, file: string) =>
      `${name}, ${microns} microns. Original file: ${file}`,
    fieldLabel: 'Field of view',
    field: (arcmin: number) => `${arcmin}′`,
    sameColour: (n: number, microns: string) =>
      `${n === 2 ? 'Both photos are' : `All ${n} photos are`} in the same infrared colour, about ${microns} microns, so the comparison is fair.`,
    photoName: (look: number, date: string) =>
      `${['First', 'Second', 'Third', 'Fourth'][look - 1] ?? `Look ${look}`} look, ${date}`,
    wobble:
      'Positions come straight from each photo, so steady stars may seem to shift a little between them.',
    noPhotos: 'We found no SPHEREx photos of this spot in this release.',
    indexRelease: (release: string) =>
      `From the ${release.toUpperCase()} sky index, an older release; the five wanderers use DR1 + QR3.`,
    oneLook: "All of them come from a single look, so there's nothing to compare yet.",
    noPair:
      "But no two of its looks were taken in the same infrared colour, so we can't compare them fairly.",
  },
  trouble: {
    slow: "Still coming in over a slow connection. Keep exploring; this lens will light up when it's ready.",
    offline: "You're offline. The five wanderers still work.",
    'index-missing': "We can't look up this spot right now. The five wanderers still work.",
    'pack-missing': "This wanderer's photos didn't load. Try again, or pick another.",
    'photos-missing': "SPHEREx's photos of this spot didn't load. Try again, or pick another spot.",
  },
  status: {
    MEASURED: 'measured',
    PREDICTED: 'predicted',
    MODEL: 'model',
    NOT_RELIABLE: 'not reliable',
    NOT_MEASURABLE_YET: 'not measurable yet',
    NO_DATA: 'no data',
    MOCK: 'placeholder',
  },
  /** Per-wanderer honest lines for status shows and cards (numbers come from packs). */
  cases: {
    /** Physics, 29 Oct: the two seasons view this field rotated about 180°, which flips a small fixed camera offset. */
    barnard: {
      /** Truth: Physics (tied to orientation; source not yet known). Plainness: The Bridge (half a turn, not "opposite way"). */
      sharedShift:
        "That isn't motion: the telescope saw this patch turned half a circle the second time, which flips a tiny fixed offset in how positions are measured.",
    },
    'r-dra': {
      status: 'Too bright for SPHEREx to measure, for now.',
      /** Event pack, 14 Nov: its edges were measured, but the comparison stars sit in its glare. */
      statusGlare:
        "Not measured yet: R Draconis saturates SPHEREx's detector, and its glare reaches the stars we'd use to check its edges, so a brightness change can't be checked in this field.",
      story:
        "This giant star swells and dims over about eight months, as other telescopes have measured. It's so bright it overwhelms SPHEREx's camera, and its glare reaches its neighbours, so we can't check a change here yet.",
    },
    'rw-aur': {
      /** Event packs (14 Nov): the star saturates the aperture in most photos, so no brightness yet. */
      statusUnmeasured: (basis: string | null) =>
        `Not measured yet: too bright for SPHEREx's detector where it matters${basis ? ` (${basis})` : ''}.`,
      /** Physics, 13 Nov (DR1+QR3 pack): scatter above every control star in some detectors; "possible variability, not confirmed; no light curve". */
      /** Physics, 13 Nov: "scatters", not "varies" (a scatter about a line in wavelength, not a light curve); comparison stars aren't checked steady; say why it's unconfirmed. */
      statusScatter: (above: number, of: number, thin: { range: number; controls: number }[]) =>
        `In ${above} of SPHEREx's ${of} colour ranges its brightness scatters more than every comparison star in the same photos. Not confirmed: ${
          thin.length
            ? `only ${list(thin.map((t) => String(t.controls)))} comparison stars in range${thin.length > 1 ? 's' : ''} ${list(thin.map((t) => String(t.range)))}, and `
            : ''
        }no light curve yet.`,
      story:
        'A young star still wrapped in dust. SPHEREx may see it flicker in its longest colours, but compared with steady stars in the same photos, we cannot confirm it yet.',
    },
    w0855: {
      story:
        "Faint, and sitting beside a brighter neighbour star. It's too faint to follow by eye here, so the arrow is our measurement of its move.",
    },
    'epsind-b': {
      story:
        'Two brown dwarfs too close to tell apart: they share one dot. They move together with their bright parent star.',
    },
  },
  card: {
    moved: (range: string) => `Moved ${range}, measured`,
    movedOne: 'Moved about {lo} arcseconds, measured',
    /** The card's own line for a measured move: the number and the way, not a word. */
    chipMoved: '≈ {lo}″ {dir}',
    comingSoon: 'Coming in the next version',
    meetFive: 'Meet the five',
  },
  /** "What am I seeing?": every layer on the sky and where it comes from (UI round, Neural). */
  legend: {
    title: 'What am I seeing?',
    layers: [
      "Photos: NASA SPHEREx's Data Release 1 and Quick Release 3, from NASA/IPAC IRSA.",
      'Lights with names: the five wanderers, whose SPHEREx photos open when you pick one.',
      'Background stars and their names: the Hipparcos catalogue and the IAU, not SPHEREx.',
      'The soft band: the Milky Way, from Gaia star counts, not SPHEREx.',
      'Faint lines: constellation figures, only a guide.',
      'Blue patches, when shown: where SPHEREx looked that week, from its own photo records.',
    ],
  },
  /** One status vocabulary, the same word, colour and mark everywhere (UI round, Physics). */
  statusChip: {
    measured: 'moved, measured',
    /** A saturated star's brightness change, measured from its image's edges (event packs). */
    brightness: 'brightness changed, measured',
    /** The chip for a measured brightness change names its direction, as "moved" does. */
    fainter: 'fainter, measured',
    brighter: 'brighter, measured',
    unconfirmed: 'not confirmed',
    unmeasured: 'not measured yet',
  },
  /** The key in the dock: only the marks a screen uses. */
  key: {
    label: 'Key',
    measured: 'measured',
    unconfirmed: 'not confirmed',
    unmeasured: 'not measured',
    predicted: 'predicted',
    steady: 'steady stars',
    flag: 'flagged pixel',
    photo: 'one SPHEREx photo',
    look: 'a look, not a search',
    catalogue: 'catalogue, not SPHEREx',
  },
  /**
   * Round 3: one number, one line, one mark, then the same rows in the same order for every
   * object (Z's facts label in the night theme). A missing fact is a dash with its reason.
   */
  facts: {
    about: 'about',
    arcsecDir: (direction: string) => `arcseconds ${direction}`,
    coin: 'like a 2 cm coin seen from {metres} m',
    measuredOn: 'Measured on',
    measuredOnValue: (counts: number[]) =>
      counts.length >= 2 ? `${counts[0]} + ${counts[1]} photos` : `${counts[0] ?? 0} photos`,
    predicted: 'Predicted',
    predictedValue: '{value} px · {source}',
    steady: 'Steady stars',
    steadyCorrected: 'shared {common} px → taken out → ≤ {band} px left',
    steadyPlain: '≤ {band} px for 9 in 10',
    secondCheck: 'Second check',
    secondCheckValue: 'other detectors agree',
    move: 'Move',
    brightness: 'Brightness',
    spectrum: 'Spectrum',
    spectrumMeasured: 'measured · chart below',
    spectrumTooBright: 'too bright: saturated',
    spectrumBlended: 'too faint beside a brighter star',
    notMeasured: 'not measured',
    looks: 'The looks',
    flags: 'Flags',
    catalogue: 'Catalogue',
    /** The reasons beside a dash: why a row is empty. */
    dash: {
      none: '—',
      loading: '…',
      noPrediction: '— no catalogue prediction',
      nothingToCompare: '— nothing measured to compare',
      positionShow: '— not measured: this show is about position',
      brightnessShow: '— not measured: this show is about brightness',
      pairUnverified: '— measured for this pair, not verified yet, so not shown',
      pairUnmeasured: '— not measured for this pair',
      look: '— a look, not searched',
      noCatalogue: '— not drawn on a look',
    },
    rwAurUnmeasured: (basis: string | null) =>
      `not measurable yet: the star saturates SPHEREx's detector${basis ? ` (${basis})` : ''}`,
    /** DR1+QR3: name the ranges and how few comparison stars some of them had, which is why it's unconfirmed. */
    /** Physics, 13 Nov: show the odds, 1 in (n + 1); the comparison stars are masked like the target, so they're fair, bar unchecked saturation effects. */
    rwAurScatter: (ranges: { range: number; controls: number | null }[]) =>
      `not confirmed: scatters more than every comparison star in colour range${ranges.length > 1 ? 's' : ''} ${list(
        ranges.map((r) => String(r.range)),
      )}. A steady star would do that by chance about ${list(
        ranges.map((r) =>
          r.controls == null ? 'unknown' : `1 time in ${r.controls + 1} (range ${r.range})`,
        ),
      )}. Its centre is too bright to use, so only its edges are measured; the comparison stars are measured the same way, so these odds are fair, unless the saturation also disturbs pixels around the centre (not checked). No light curve yet`,
    rDraBrightness: 'too bright to measure, for now',
    /** The pack's own reason: the comparison stars "vary by N%", in the star's glare. */
    glareBrightness: (pct: number | null) =>
      `can't be checked in this field: the comparison stars sit in the star's glare${pct ? ` and vary by ${pct}% between looks` : ''}`,
    unitPx: 'px',
    arcsec: '″',
  },
  evidence: {
    whyShift: 'Why do other stars seem to shift a little?',
    heading: 'How do we know?',
    /** For status shows, where nothing was measured: the looks only, no claim. */
    looksHeading: 'The two looks',
    firstLook: (month: string) => `First look, ${month}`,
    secondLook: (month: string) => `Second look, ${month}`,
    /** The Bridge, 29 Oct: "steady stars" everywhere on screen. */
    /** Physics, 29 Oct: the median is only typical; the p90 and the target's own error are larger, so no "wobble" claim. */
    stillStars:
      'Steady stars in the same photos seem to shift only about {value} pixels, typically. The move above is many times larger than that.',
    /** Used only when the steady stars share a clearly non-zero shift and the headline is relative to them. */
    stillStarsShared:
      'Steady stars in the same photos all seem to shift {value} pixels the same way.',
    stillStarsCancel: (name: string) =>
      `We measure ${name} against those stars, so the shared shift cancels out.`,
    secondGroup:
      'Photos in a different set of infrared colours measured the same move, within their uncertainty.',
    howSure: 'How sure',
    measuredLabel: 'measured',
    predictedLabel: 'predicted',
    wobbleLabel: 'how far steady stars seem to shift',
    /** Physics, 29 Oct: with a relative headline the band is the scatter after the shared shift, not the shift itself. */
    wobbleLabelCorrected: 'how far steady stars scatter, once their shared shift is removed',
  },
  moon: 'The full Moon, to scale. This view is the little square.',
  insets: { realSize: 'The move at its real size', moon: 'The full Moon, to scale' },
  meetAnother: 'Meet another wanderer',
  ribbon: {
    gap: 'SPHEREx was looking elsewhere',
    compared: 'compared',
    photos: 'photos, by date and colour',
    /** A live look learns the colour only of the photos it checks. */
    checked: (of: number) => `checked for colour, of ${of.toLocaleString('en-GB')}`,
  },
  watch: {
    pickHeading: 'Watch every photo of one of the five',
    pickHint:
      'Pick one to play all its photos, one colour range at a time, or click a light on the sky.',
    windowsHeading: 'Colours SPHEREx saw here',
    window: (n: number) => (n === 1 ? '1 photo' : `${n} photos`),
    range: (lo: number, hi: number) => `${lo} to ${hi} microns`,
    playHint: 'Pick a colour to watch every photo taken in it, in date order.',
    coaddHeading: 'Each colour range, all its photos added together',
    coaddHint:
      'Adding many photos lifts faint things out of the noise; a star that moved is smeared between its positions. Pick one to see it in the lens.',
    coaddLoading: 'Adding up the photos…',
    coaddLabel: (range: string, n: number) => `${range}: ${n} photos added together`,
    seriesLabel: 'Step through the photos',
    /** The photo on screen, on demand (the challenge asks for metadata such as flags). */
    meta: {
      heading: 'About this photo',
      taken: 'Taken',
      takenValue: (date: string, time: string) => `${date}, ${time} UTC`,
      colour: 'Colour',
      colourValue: (microns: string, width: string, detector: number) =>
        `${microns} microns, a band ${width} microns wide, on detector ${detector} of 6`,
      uncertain: 'The colour map has a known jump near here, so this colour is approximate.',
      file: 'Original file',
      flags: 'Flagged squares',
      flagNames: {
        saturated: 'too bright',
        rejected: 'unreliable',
        source: 'known source',
        outlier: 'outlier',
      },
      movers: 'Known asteroids',
      moversAsking: 'asking SkyBoT…',
      moversNone: 'none brighter than magnitude 19 in this field',
      moversFailed: "SkyBoT (IMCCE) didn't answer, so none are marked",
      moverItem: (name: string, vmag: string | null, nearEarth: boolean) =>
        `${name}${vmag ? ` (magnitude ${vmag})` : ''}${nearEarth ? ', near-Earth: position approximate' : ''}`,
      /** The orbit's prediction for the photo's time, seen from the Earth's centre. */
      moversNote:
        "Diamonds: where SkyBoT (IMCCE) puts each known asteroid or comet at this photo's time, from its orbit, seen from the Earth's centre. A prediction, not a SPHEREx detection.",
    },
    earlier: '‹ Earlier',
    later: 'Later ›',
    play: 'Play',
    pause: 'Pause',
    frame: (i: number, n: number, date: string, microns: string) =>
      `Photo ${i} of ${n}, ${date}, ${microns} microns`,
  },
  search: {
    unreadable: (reason: string) =>
      `We couldn't find that name or read that position (${reason}). Try a name like Vega or Barnard's Star, or a position like 17 57 48 +04 41 36.`,
    wandererSoon: (name: string) => `That's ${name}. Its show arrives in the next version.`,
  },
  share: {
    copy: 'Copy link',
    copied: 'Link copied',
    openFull: 'Open in Planetes',
    aladin: 'Open in Aladin Lite',
  },
  /** Catalogue overlays (checklist C6), from Physics' overlay files: catalogue, not SPHEREx. */
  overlay: {
    title: 'Catalogue stars on the photos',
    gaia: 'Gaia stars, as circles ({n}): catalogue, not SPHEREx',
    catwise: 'CatWISE sources, as squares ({n}): catalogue, not SPHEREx',
    gaiaShort: 'Gaia',
    catwiseShort: 'CatWISE',
    gaiaHint: 'Gaia stars, drawn on the lens as circles: catalogue, not SPHEREx',
    catwiseHint: 'CatWISE sources, drawn on the lens as squares: catalogue, not SPHEREx',
  },
  /** Spectra on the fly (checklist C3), from Physics' per-photo photometry; lines checked by Physics. */
  spectrum: {
    heading: 'Its infrared spectrum',
    caption:
      'The combined light of the two brown dwarfs, photo by photo: each dot is one SPHEREx photo at its own wavelength.',
    x: 'wavelength, microns',
    y: 'brightness, mJy',
    tooBright:
      "Too bright: SPHEREx's detector saturates on this star, so it can't measure its spectrum.",
    blended: 'Too faint and too close to a brighter star for a clean spectrum.',
  },
  /** The photos' own flags (checklist C8): outlined on request, never hidden. Truth: Physics, 29 Oct (FLAGS header MP_* comments; FINDINGS D-1: OUTLIER at 67% of 293 known asteroids). */
  flags: {
    title: 'Flags in these photos',
    saturated: 'Too bright to measure reliably (always outlined)',
    rejected: 'Marked unreliable by the pipeline (cosmic rays, bad pixels, ghosts…)',
    source:
      "Where the pipeline's map has a known source (a fixed map; it doesn't follow moving objects)",
    outlier:
      'Flagged as an outlier (changed in this photo): set on about two-thirds of the known asteroids we checked, so never hidden',
    unit: (n: number) => (n === 1 ? 'square' : 'squares'),
  },
  lensName: 'SPHEREx photo in the lens',
  rooms: { play: 'Play', learn: 'Learn', watch: 'Watch' },
  /** The Learn room: a one-minute guided tour (Rubin SkyViewer's "Please guide me" pattern). */
  tour: {
    eyebrow: (n: number, of: number) => `A one-minute tour, ${n} of ${of}`,
    title: 'A one-minute tour',
    steps: [
      'SPHEREx has photographed the whole sky at least twice, in 102 infrared colours.',
      'Between its looks, almost every star holds still. A few nearby ones visibly move, like this runaway.',
      "Barnard's Star moved north between two looks. Watch the ring: it holds still, and the star doesn't.",
      'WISE 0855 is one of the coldest brown dwarfs known, faint and fast. SPHEREx caught it moving west.',
      'ε Indi B is two brown dwarfs in one dot. SPHEREx also measured its light colour by colour: its spectrum is below.',
      "Some stars change brightness instead. RW Aurigae may flicker, but SPHEREx can't confirm it yet, and says so.",
      "Your turn: pick a light, click anywhere in the sky, or type a position or a star's name.",
    ],
    back: 'Back',
    next: 'Next',
    skip: 'Skip the tour',
    done: 'Start exploring',
  },
  nav: { backToSky: 'Back to the sky', home: 'Planetes: back to the start', credits: 'Credits' },
  /** Long text: the button under a clamped line or two (src/ui/fit.ts). */
  fit: { more: 'More', less: 'Less' },
  /** The appearance switch: the page only; the sky and the photos stay night in both. */
  scheme: {
    group: 'Appearance',
    system: 'Match this device',
    light: 'Light',
    dark: 'Dark',
  },
  /**
   * The credits page: sources as a table, the makers as short cards with their full records
   * folded (the records are the owners' own words, CONSENSUS §1.7), the acknowledgements the
   * archives ask for printed verbatim in small type, and the dates as a footer line.
   */
  credits: {
    title: 'Credits',
    back: 'Planetes',
    lede: 'Every photo, star and name on screen, and where it comes from.',
    columns: { what: 'On screen', source: 'Source', terms: 'Terms' },
    sources: [
      {
        what: 'Photographs',
        source:
          "NASA SPHEREx spectral images, Data Release 1 and Quick Release 3, served by NASA/IPAC IRSA from its public AWS bucket and found with IRSA's image search",
        terms: 'Public data',
        link: 'https://irsa.ipac.caltech.edu/Missions/spherex.html',
      },
      {
        what: 'Live looks',
        source:
          "Cut out by our own small helper on Cloudflare Workers, run close to NASA's bucket: it reads the same files with the same code and sends back only the cutout, kept near you for next time. If it can't be reached, your browser reads NASA's files directly. It is sent only the photo's name and the spot on the sky.",
        terms: 'Our own code',
      },
      {
        what: "SPHEREx's all-sky map",
        source:
          "SPHEREx DR1 all-sky map in 102 colours (IRSA's HiPS cube), shown with Aladin Lite v3 (CDS, Strasbourg), loaded from jsDelivr",
        terms: 'Aladin Lite: GPL-3.0',
        link: 'https://aladin.cds.unistra.fr/AladinLite/',
      },
      {
        what: 'Background stars',
        source: 'Hipparcos main catalogue (ESA, 1997), via the ESA Gaia archive',
        terms: 'Labelled as catalogue, not SPHEREx',
      },
      {
        what: 'Star names',
        source: 'IAU Catalog of Star Names, IAU Working Group on Star Names (WGSN)',
        terms: 'Public domain',
        link: 'https://exopla.net/star-names/modern-iau-star-names/',
      },
      {
        what: 'Milky Way glow',
        source:
          'Gaia DR3: 305 million stars brighter than magnitude 18, of 1.8 billion counted, on a log scale',
        terms: 'Gaia acknowledgement below',
      },
      {
        what: 'Catalogue overlays and predictions',
        source:
          "Gaia DR3; CatWISE2020 (Marocco et al. 2021, ApJS 253, 8), via IRSA; WISE 0855's motion from Luhman & Esplin (2016)",
        terms: 'Acknowledgements below',
      },
      {
        what: 'Constellation figures',
        source: "Stellarium 'modern' sky culture, Stellarium's team",
        terms: 'CC BY-SA 4.0 (shared alike)',
      },
      {
        what: 'Earth (3D view)',
        source:
          "Blue Marble Next Generation, a month of 2004 each, NASA Visible Earth (NASA Goddard Space Flight Center; Reto Stöckli). Night lights: Black Marble 2016, NASA Earth Observatory (Miguel Román, NASA GSFC). Brightness of Earthshine set to Earth's average reflectance (~30%)",
        terms: 'NASA imagery, credited; no endorsement implied',
      },
      {
        what: 'SPHEREx (3D view)',
        source:
          "Our own schematic model. Sizes, parts and finishes from NASA/JPL's SPHEREx press kit and Bock et al. 2025, 'The SPHEREx Satellite Mission' (arXiv:2511.02985); proportions of the inner shields, the bus and the panel's mounting approximate, from NASA/JPL-Caltech photos (PIA26537, PIA26543, PIA26531)",
        terms: 'Not an official model',
      },
      {
        what: "SPHEREx's orbit and pointing",
        source:
          'Bock et al. 2025 (arXiv:2511.02985): semi-major axis 7037.4 km, inclination 97.951°, ascending node at 6:00 local time; line of sight tipped 8° towards the solar panel. Its place on the orbit for a photo is approximate',
        terms: 'Published figures',
      },
      {
        what: '3D drawing',
        source: 'three.js',
        terms: 'MIT licence',
      },
      {
        what: 'Constellation names',
        source: 'd3-celestial, © 2015 Olaf Frohn',
        terms: 'BSD-3-Clause (licence ships with the data)',
      },
    ],
    makersHeading: 'Made by',
    recordLabel: 'How it was made',
    makers: [
      {
        role: 'Measurements and data packs',
        who: "This project's own pipeline (pipeline/ in the repository)",
        when: '14–15 Nov 2026, during the event',
        facts: [
          'SPHEREx DR1 + QR3, read during the event',
          'Flagged pixels left out, never filled in',
          'astropy · NumPy · SciPy',
        ],
        record: [
          "For each target, the pipeline searches IRSA for every SPHEREx photo of it, reads only the part of each file around the target, and resamples it onto one north-up grid. Each photo's own wavelength table gives the colour it saw at the target. Photos are grouped into passes (gaps over 60 days) and combined per pass and per detector (a median), leaving out pixels the SPHEREx pipeline flagged as saturated or as artefacts; the OUTLIER flag is kept on purpose, because real moving objects trip it.",
          "A move is measured by fitting each pass's picture (only the wings when the centre is saturated), together with nearby Gaia stars held fixed, then subtracting the shift the steady stars share. A pair of passes gets a number only if at least two detectors give a fit and 90% of the steady stars agree to within 0.2 pixels; otherwise it is shown as not reliable, without a number.",
        ],
      },
      {
        role: 'The viewer',
        who: 'Team Planetes, with AI assistance (Claude, by Anthropic)',
        when: 'Practised from 29 Oct; this entry from 14 Nov 2026',
        facts: [
          'No number on screen without its measurement',
          'TypeScript · Vite · HTML canvas · three.js',
        ],
        record: [
          "The idea is Sumit's. Before the event he practised in private projects; what this entry reuses from them, the viewer's front end included, is listed in PRIOR_WORK.md in the repository. Claude wrote most of the code and text under the team's direction and review.",
          'Inspired by WiseView and the Backyard Worlds: Planet 9 project, where volunteers found brown dwarfs by blinking WISE images.',
        ],
      },
    ],
    priorWork: {
      label: 'Prior work and AI use: PRIOR_WORK.md',
      link: 'https://github.com/sumit7194/planetes-spherex/blob/main/PRIOR_WORK.md',
    },
    ackHeading: 'Acknowledgements, as the archives ask them to be printed',
    acknowledgements: [
      /** As IRSA's SPHEREx page asks it to be printed (Physics, checked 29 Oct). */
      'This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.',
      /** IRSA's own sentence for its datasets and services. */
      'This dataset or service is made available by the Infrared Science Archive (IRSA) at IPAC, which is operated by the California Institute of Technology under contract with the National Aeronautics and Space Administration.',
      'This publication makes use of data products from the Wide-field Infrared Survey Explorer, which is a joint project of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, funded by the National Aeronautics and Space Administration.',
      'This research has made use of the Aladin sky atlas, developed at CDS, Strasbourg Observatory, France.',
      'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.',
    ],
    footer: ['NASA Space Apps Challenge 2026 · Planet X and SPHEREx', 'Data: SPHEREx DR1 + QR3'],
  },
} as const;

/** Sign-off log for the copy deck: key path → who approved and when. */
export const review: Record<string, { truth?: string; plainness?: string }> = {
  'v0 deck': {
    plainness: 'The Bridge, 29 Oct (2026-10-29_v0_copy_review.md)',
    truth: 'Physics, 29 Oct: show.holding wording and range checked',
  },
  'v1 lines': {
    plainness: 'The Bridge, 29 Oct (2026-10-29_v1_copy_review.md)',
    truth:
      'Physics, 29 Oct: cases.barnard.sharedShift, evidence.stillStars (rewritten), evidence.secondGroup',
  },
};
