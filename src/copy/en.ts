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
    /** Zoomed out as far as Look around goes, on the homepage (Viewer, 14 Nov). */
    wholeSky: 'See the whole sky: Flat map',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    sunToday: 'The Sun today, on its yearly path',
    /** The Sun on the day SPHEREx last photographed the spot looked at (Sumit, 14 Nov: say why). */
    sunOn: 'The Sun on {date}, when SPHEREx last photographed this spot',
    /** Under the aim's readout while the zoomed-in sky shows Gaia's fainter stars. */
    gaiaNote: 'Fainter stars: Gaia DR3 (ESA), not SPHEREx',
    /** A star the mouse rests on (Viewer, 14 Nov): honest and short. */
    starTip: {
      unnamed: (hip: number) => `A star · HIP ${hip}`,
      hip: (hip: number) => `HIP ${hip}`,
      // "Visible": Hipparcos's eye-like band, not SPHEREx's infrared brightness.
      brightness: (v: string) => `visible brightness ${v} (Hipparcos)`,
      checking: 'checking SPHEREx’s photos…',
      passes: (text: string) => `photographed in ${text}`,
      none: 'not photographed in DR1 + QR3 yet',
      click: 'Click to look',
    },
    lookingNear: (star: string) => `Looking near ${star}`,
    nearestNamed: (star: string) => `Nearest named star: ${star}`,
    lensField: 'a close-up shows this much',
    scrollToOpen: (name: string) =>
      `You've zoomed in as far as this map goes. Scroll once more to open ${name}.`,
    tapToOpen: (name: string) =>
      `You've zoomed in as far as this map goes. Tap ${name} to open it.`,
    /** Zoomed in as far as the map goes, away from the five: any spot opens a live look. */
    nothingHere:
      "You've zoomed in as far as this map goes. Click here for SPHEREx's own photos of this spot.",
    nothingHereTouch:
      "You've zoomed in as far as this map goes. Tap here for SPHEREx's own photos of this spot.",
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
  /**
   * The homepage (agreed with Viewer, 14 Nov): the search in the right-hand column, the band as
   * the five rows (variant D). Headline: what the visitor can do, not a claim about change.
   */
  home: {
    /** Sumit, 14 Nov: the old two-line instruction felt unwelcoming. A question, then the facts. */
    headline: 'Where would you like to look?',
    welcome:
      'SPHEREx has photographed every spot in the sky, months apart. Type a star or a position, or click the sky.',
    welcomeTouch:
      'SPHEREx has photographed every spot in the sky, months apart. Type a star or a position, or tap the sky.',
    placeholder: "A position (RA, Dec) or a star's name",
    /** Under the field while it's empty: what to type, and the frame (ICRS). */
    echoEmpty: "RA and Dec in ICRS (J2000), in degrees or hours, or a star's name.",
    echoPartial: 'Keep typing: a right ascension, then a declination.',
    echoName: (name: string, enter: string) => `✓ ${name} · ${enter}`,
    echoPosition: (ra: string, dec: string, enter: string) => `✓ RA ${ra}, Dec ${dec} · ${enter}`,
    /** A typed spot on a target's past track (the challenge's WISE 0855 coordinates). */
    echoPast: (name: string, year: number, moved: string) =>
      `✓ That's where ${name} was in ${year}; it has moved ${moved} since. Enter opens its page.`,
    /** A typed spot right next to one of the five. */
    echoNear: (name: string) => `✓ Right by ${name}. Enter opens its page.`,
    /** The sixth row's name when the spot is one of the five's past places. */
    spotMoved: (name: string, moved: string) => `${name} (${moved} from your spot)`,
    enter: 'press Enter',
    enterTouch: 'press Go',
    examplesLabel: 'Try',
    /** The challenge page's own coordinates for WISE 0855 (its 2010 place). */
    examples: {
      w0855: 'Type a position, like this',
      w0855Value: '08h55m10.831s −07d14m42.53s',
      barnard: "Barnard's Star",
      teegarden: "Teegarden's Star, 5″ a year",
      teegardenName: "Teegarden's Star",
    },
    quiet: 'or click anywhere on the sky · drag to look around',
    quietTouch: 'or tap anywhere on the sky · drag to look around',
    /** The band (variant D). */
    band: {
      label: 'When SPHEREx photographed them',
      week: 'Week shown on the sky',
      noWeek: 'No week shown. Use the arrow keys to show one on the sky.',
      play: 'Play the weeks',
      pause: 'Pause',
      close: 'Stop showing the week',
      showing: (week: string) => `On the sky: ${week}`,
      seam: 'DR1 | QR3',
      /** In Look around the week's band is often behind you: the flat map shows all of it. */
      flat: 'See it on the flat map',
      through: (date: string) => `to ${date}`,
      weekText: (from: string, to: string, n: number) =>
        `${from} to ${to}, ${n.toLocaleString('en-GB')} photos`,
    },
    /** One row's accessible name. */
    rowLabel: (name: string, status: string, photos: number, passes: number) =>
      `${name}, ${status}, ${photos} photos in ${passes} ${passes === 1 ? 'pass' : 'passes'}`,
    spotTitle: 'Your spot',
    spotLooking: 'looking…',
    spotPasses: (n: number) => (n === 1 ? '1 pass' : `${n} passes`),
    spotLine: (name: string, passes: number, months: string, photos: number) =>
      passes === 0
        ? `${name}: not photographed in the data released so far (DR1 + QR3).`
        : `${name}: photographed in ${passes === 1 ? '1 pass' : `${passes} passes`} (${months}), ${photos.toLocaleString('en-GB')} photos.`,
    spotLoading: (name: string) => `${name}: looking it up in the sky index…`,
    spotFailed: (name: string) => `${name}: the sky index couldn't be reached just now.`,
    /** Under Learn's first step: what the blue band is. */
    ringNote:
      "The blue band is one week of SPHEREx's photos, from its own records; it moves on as the weeks play.",
    /** Search as you type (agreed with Viewer, 14 Nov): the dropdown's words. */
    find: {
      tags: {
        test: 'challenge test',
        mover: 'fast star',
        variable: 'variable',
        star: 'star',
        constellation: 'constellation',
        simbad: 'SIMBAD',
        position: 'position',
      },
      fiveGroup: 'The challenge’s five',
      notPhotographed: 'not photographed in DR1 + QR3 yet',
      tryGroup: 'Or try',
      nearGroup: 'Near here',
      footer: 'RA and Dec in ICRS (J2000), in degrees or hours, or a name.',
      count: (n: number) => (n === 0 ? 'No matches' : n === 1 ? '1 match' : `${n} matches`),
      testMeta: (short: string) => `${short} · opens its page`,
      moverMeta: (pm: string) => `moves ${pm}″ a year · a live look`,
      variableMeta: 'its brightness changes · a live look',
      starMeta: (pos: string) => `${pos} · a live look`,
      constellationMeta: 'shows it on the sky',
      positionMeta: 'a live look at this spot',
      simbadMeta: (type: string | null, moved: boolean) =>
        `${type ? `${type} · ` : ''}${moved ? 'moved to today by its motion' : 'position for 2000'} · a live look`,
      nearMeta: (away: string, meta: string) => `${away} away · ${meta}`,
      looking: (q: string) => `Looking up “${q}” in SIMBAD…`,
      notFound: (q: string) => `“${q}” isn’t in SIMBAD either.`,
      failed: 'SIMBAD couldn’t be reached just now.',
      keepTyping: 'Keep typing: a right ascension, then a declination.',
      label: 'Search the sky: a name or a position',
      results: 'Results',
      noHelper: 'Names beyond this page’s own list need our helper, which is off.',
      nearFive: (name: string, away: string) => `${name} (a challenge test) is ${away} away`,
      /** SIMBAD's object types, in plain words (Viewer, 14 Nov). */
      types: {
        'PM*': 'fast-moving star',
        'LM*': 'low-mass star',
        'BD*': 'brown dwarf',
        'BY*': 'variable star',
        'V*': 'variable star',
        'Mi*': 'variable star (Mira)',
        'RR*': 'variable star',
        'Ce*': 'variable star (Cepheid)',
        'SB*': 'double star',
        '**': 'double star',
        'EB*': 'eclipsing double star',
        '*': 'star',
        's*r': 'red supergiant',
        'WD*': 'white dwarf',
        Pl: 'planet host',
        AGN: 'galaxy',
        G: 'galaxy',
        GiG: 'galaxy',
        GiP: 'galaxy',
        Sy1: 'galaxy',
        Sy2: 'galaxy',
        SBG: 'galaxy',
        QSO: 'quasar',
        HII: 'nebula',
        EmO: 'nebula',
        RNe: 'nebula',
        PN: 'planetary nebula',
        SNR: 'supernova remnant',
        OpC: 'star cluster',
        GlC: 'star cluster',
        'Cl*': 'star cluster',
      } as Record<string, string>,
      otherType: 'object (SIMBAD)',
    },
    rideAlong: 'Ride along',
    riding: 'Riding along',
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
        ? `Data: SPHEREx ${parts.join(' + ')} (IRSA${parts.includes('QR3') ? '' : '; no QR3 here yet'})`
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
    /** Colour by date (E3, Viewer's design): the shown pair as one blue/orange picture. */
    byDate: 'Colour by date',
    /** Compare's views, one at a time (Viewer's audit, 15 Nov). */
    modes: {
      label: 'Views',
      diff: 'Difference',
      byDate: 'Colour by date',
      fade: 'Fade',
      shift: 'Two colours',
    },
    /** Physics' demonstration (15 Nov): where the light sits in a short and a long colour. */
    colourShift: {
      question: 'Whose light is it? The same spot in a short and a long colour.',
      column: (det: number, range: string) => `D${det} · ${range}`,
      keyLight: "light's centre",
      keyNeighbour: (g: string) => `neighbour (Gaia, G ${g})`,
      keyTarget: (name: string) => `${name}, predicted`,
      shift: (looks: { date: string; short: string; long: string }[], name: string) =>
        `From the short colour to the long one, the light moves off the neighbour: ${looks
          .map((l) => `${l.short}″ → ${l.long}″ (${l.date})`)
          .join(', ')}, towards ${name}'s side.`,
      motion: (name: string, t: string, n: string | null) =>
        `${name} moved ${t}″ between the two looks; the neighbour ${n === null ? 'under 0.01″' : `${n}″`}.`,
      alt: (date: string, range: string, n: string, t: string, name: string) =>
        `${date}, ${range}: the light's centre is ${n}″ from the neighbour and ${t}″ from ${name}'s predicted place.`,
      ratio: {
        show: 'Show the colour ratio',
        hide: '← Two colours',
        question: (long: string, short: string) => `Colour ratio, ${long} ÷ ${short}:`,
        red: 'more 4.4–5 µm light',
        equal: 'equal',
        blue: 'more 1.1–1.6 µm light',
        masked: 'too faint, saturated or flagged',
        ring: 'the reddest source here: a quasar, not WISE 0855',
        caption: (name: string) =>
          `On this field the ratio doesn't pick out ${name}: its neighbour's light hides it. The reddest real source (ringed) is a quasar (Gaia: no parallax or motion, classified quasar; WISE W1−W2 = 1.24), not a brown dwarf.`,
        whatRed: 'What the colours mean',
        redMeans:
          'Teal means more light at 4.4–5 µm than at 1.1–1.6 µm ("redder", as astronomers say): cool brown dwarfs, but also distant quasars and dusty galaxies. Grey means equally bright in both colours (per unit frequency); ordinary stars look pale yellow-green. The map shows the central 40 × 40 pixels of the field. Both looks are shown; each stack has its own noise level, and pixels below S/N 5 in either colour are hatched.',
        alt: (date: string, name: string) =>
          `${date}: colour ratio of the whole field, the quasar ringed and ${name}'s predicted place marked.`,
      },
      howHeading: 'How this was measured',
      how: "Each look, 9 × 9 SPHEREx pixels, each colour stretched on its own. The light's centre is found as in \"What's at this spot?\": the brightest pixel near the spot, then the light-weighted middle of the 3 × 3 around it, so no shares of light are given. Centres are good to about 1″ in both colours: the brighter short colour has less noise, but the same pixel-grid limit. Both places are moved to each look's date.",
      distances: (
        looks: { date: string; fromNeighbour: string; fromTarget: string }[],
        name: string,
      ) =>
        `In the long colour the centre is ${looks
          .map(
            (l) =>
              `${l.fromNeighbour}″ from the neighbour and ${l.fromTarget}″ from ${name} (${l.date})`,
          )
          .join('; ')}. With centres good to about 1″, it sits between the two, not on either.`,
    },
    /** Fade between the two looks (3b, Viewer's design): the pixel values blended. */
    fade: {
      name: 'Fade between the two looks',
      valueText: (pct: number, late: string) => `${pct}% of the way to ${late}`,
      label: (pct: number, late: string) => `Fade: ${pct}% of the way to ${late}`,
      off: 'Back to the looks',
    },
    byDateLabel: (early: string, late: string) =>
      `Colour by date: ${early} blue, ${late} orange, white where nothing moved`,
    byDateKey: {
      howToRead: 'How to read the colours',
      white: "white: didn't move",
      brightness:
        'A star tinted all over changed brightness, not place: orange-heavy if it got brighter, blue-heavy if fainter (RW Aurigae flickers). A move shows as a blue copy and an orange copy side by side.',
      smallMove: (px: string, arcsec: string) =>
        `It moved ${px} px (${arcsec}), under one pixel: only a faint fringe here. Hold to compare or Difference shows it better.`,
      narrowMove: (px: string) =>
        `This move is ${px} px, so its fringe is narrow; Hold to compare shows it too.`,
      fringes:
        'Thin coloured fringes on steady stars come from the blur changing between the two looks, not from motion.',
      masked: 'Hatched: masked or saturated in either look, so no colour is shown.',
      speckle:
        'Coloured speckle in the dark background is noise: these are single photos, not stacks.',
    },
    diffButton: 'Show the difference',
    diffHowToRead: 'How to read the difference',
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
    whyNamed: (name: string) => `Why ${name}?`,
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
    button: 'Keys ?',
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
    button: 'Surprise me: a famous fast or changing star',
    /** While the sky flies to it (Sumit, 14 Nov: fly, then dive). */
    flying: (name: string) => `Flying to ${name}…`,
    /** After a flight the visitor interrupted: the dive, on offer for a few seconds. */
    openIt: (name: string) => `Open ${name}`,
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
    passes: (n: number) => `${n} pass${n === 1 ? '' : 'es'}`,
    /** Choosing the look's colour range (Physics + Viewer, 14 Nov). */
    colour: {
      label: 'Colour',
      range: (lo: number, hi: number) => `${lo}–${hi} µm`,
      option: (lo: number, hi: number, has: boolean, sn: number | null) =>
        has
          ? `${lo} to ${hi} microns${sn !== null ? `, the light at your spot at signal-to-noise ${Math.round(sn)}` : ''}`
          : `${lo} to ${hi} microns: no fair pair here`,
      choosing: 'Finding the colour where your spot shows clearest…',
      whyThis: 'Why this colour?',
      whyClearest: (range: string) =>
        `Shown at ${range}, where the light at your spot stands out most clearly.`,
      whyShortest: (range: string) =>
        `Shown at ${range}: nothing clear sits at your spot, so this is the shortest colour with a fair pair. Pick another colour to look.`,
      whyChosen: (range: string) => `Shown at ${range}, as chosen.`,
      whySaturated: (range: string, n: number, of: number) =>
        n === of
          ? `Shown at ${range}: the star at your spot is so bright it saturates SPHEREx's detector in all ${of} colours with a fair pair, so none can be scored; this is the shortest of them. Pick another colour to look.`
          : `Shown at ${range}: the star at your spot saturates SPHEREx's detector in ${n} of the ${of} colours with a fair pair and doesn't stand out clearly in the others, so this is the shortest of them. Pick another colour to look.`,
      unavailable: (range: string) => `There's no fair pair at ${range} here.`,
      cold: 'Cold objects such as brown dwarfs show best at 3–5 µm.',
      /** Physics' blend line (14 Nov): text only, never changes the colour picked. */
      blended: (g: number, sep: number) =>
        `Blended: a Gaia star (G ${g.toFixed(1)}) ${sep.toFixed(1)}″ away sits inside the aperture. The clearest colour may show that star, not your object.`,
      unchecked: (lo: number, hi: number) =>
        `${lo} to ${hi} microns: not every photo checked yet; choosing it checks them`,
      checking: (range: string) => `Checking every photo at ${range}…`,
    },
    passesWhen: (n: number, months: string) => `${n} pass${n === 1 ? '' : 'es'} (${months})`,
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
      /** Whether Gaia DR3 was asked about neighbours in the aperture (through the cloud helper). */
      caveat: (checked: boolean, blended: boolean) =>
        `It measures everything within 15″ of this spot together. ${!checked ? "Neighbouring stars in that circle weren't checked: Gaia's archive couldn't be reached." : blended ? 'Checked against Gaia DR3 for neighbouring stars.' : 'Checked against Gaia DR3: no known star there is bright enough to add much light, though one too faint for Gaia could.'} Each pass saw slightly different colours, so compare passes only at matching wavelengths.`,
    },
    /** Every photo of the look's colour range, played like Watch (14 Nov, with the cloud helper). */
    range: {
      heading: 'Every photo in this colour range',
      what: 'Play every photo of this spot taken in the same colour range as the fair pair, in date order.',
      button: (n: number, of: number, size: string) =>
        of > n
          ? `Play ${n} of its ${of.toLocaleString('en-GB')} photos, spread through time (about ${size})`
          : `Play all ${n} photos (about ${size})`,
      reading: (done: number, total: number) => `Reading photo ${done} of ${total}…`,
      failed: "These photos didn't load, so there's nothing to play.",
      /** of: photos asked for; some may not cover the spot (the edge of a photo). */
      span: (n: number, of: number, lo: string, hi: string) =>
        `${n < of ? `${n} of ${of} photos cover this spot` : `${n} photos`}, from ${lo} to ${hi} microns.`,
      drift:
        "Each is at its own wavelength in that range, so a star's brightness can change between them with colour alone; the fair pair (Compare) is the comparison.",
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
      'The grid: right ascension (hours) and declination (degrees), ICRS (J2000), the coordinates you can type. The dashed line is the ecliptic, the Sun’s yearly path.',
      "Blue, on the sky and on a row of the band: photographed that week, from SPHEREx's own photo records.",
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
    spectrumMeasured: 'measured · see Spectrum',
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
    moreViews: 'More ways to look: all photos added together, and SPHEREx\u2019s sky map',
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
    loading: (n: number, mb: number, pct: number) =>
      `Loading ${n} photos (${mb.toFixed(1)} MB)… ${pct}%`,
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
  /** The "what changed" film on a series (queue #8; method and label reviewed by Physics, 14 Nov). */
  film: {
    show: 'Show what changed',
    photos: 'Show the photos',
    pill: 'what changed',
    howToRead: 'How to read this',
    none: 'not enough other dates in this colour',
    fainter: (limit: number) => `fainter, −${limit}σ`,
    brighter: (limit: number) => `+${limit}σ, brighter`,
    /** turn: 'same' / 'mixed' when the photos' orientation is known (live looks), else null. */
    refs: (n: number, steps: string, month: string, turn: 'same' | 'mixed' | null) =>
      `This photo minus the median of ${n} photos from other dates (around ${month}), within ${steps} colour step${steps === '1.0' ? '' : 's'}${turn === 'same' ? ', taken with SPHEREx turned the same way' : turn === 'mixed' ? ', references from both scan orientations' : ''}.`,
    noRefs:
      'Not enough photos from other dates in this colour to compare this one with, so it is hatched.',
    /** Physics' required wording, verbatim except "Hatched" for the grey view's masked pixels. */
    label:
      'Each photo minus the same spot on other dates, at the nearest colours (within one colour step). Something that moved far shows as a bright spot; a slow mover shows as a dark–bright pair that points the same way on every detector and turns steadily with date. Still bright stars also leave rings and pairs, because the blur changes with colour, so a pair alone is not proof of motion. Hatched = masked (saturated or flagged). A picture, not a measurement.',
    target:
      "The lilac cross is where the catalogue puts the star at each photo's time (its motion only), so its own change can be told from other stars'.",
  },
  search: {
    unreadable: (reason: string) =>
      `We couldn't find that name or read that position (${reason}). Try a name like Vega or Barnard's Star, or a position like 17 57 48 +04 41 36 (ICRS, J2000).`,
    /** The search box's tooltip: which coordinate system a typed position is read in. */
    frame:
      'A star name, or a position as RA and Dec in ICRS (J2000), e.g. 08h55m10.8s −7d14m42s. Old B1950 positions are not converted.',
    wandererSoon: (name: string) => `That's ${name}. Its show arrives in the next version.`,
    /** The typed spot is where a moving target was in an earlier year. */
    oldPlace: (name: string, year: number, moved: string) =>
      `You typed where ${name} was in about ${year}; it has moved ${moved} since. Here it is now.`,
    closeNote: 'Close this note',
    /** The path from the typed year to today, under the arrival note (queue #4). */
    path: {
      typed: (year: number) => `${year}: your numbers`,
      now: '2026',
      spherex: (arcsec: string) => `SPHEREx (${arcsec})`,
      closeUp: 'the close-up',
      north: 'N',
      east: 'E',
      scale: (len: string) => len,
      alt: (name: string, year: number, moved: string, dir: string, spherex: string) =>
        `The path ${name}'s catalogue motion gives from ${year} to 2026: ${moved} towards the ${dir}, in a straight line. SPHEREx's photos cover only the last ${spherex} of it.`,
      caption: (source: string, every: number) =>
        `The path its catalogue motion gives: north up, east left, as on the sky. Ticks every ${every} years; the bright stretch is what SPHEREx photographed; the square is the close-up. Straight motion from the ${source}: the yearly parallax wobble (about a second of arc) is far smaller than this drawing and under one SPHEREx pixel.`,
      show: 'See the path',
      hide: 'Hide the path',
      catalogue: 'catalogue proper motion',
      companion:
        'motion of its companion star ε Indi A (Gaia DR3); B orbits A, so its own motion differs slightly',
    },
  },
  share: {
    copy: 'Copy link',
    copied: 'Link copied',
    openFull: 'Open in Planetes',
    openIn: 'Open this spot in:',
    aladin: 'Aladin Lite',
    wiseview: 'WiseView',
    wiseviewTitle:
      "The same spot in WISE's photos from 2010 on (WiseView, Backyard Worlds): a longer span of years than SPHEREx's. WiseView is http only, so your browser may warn before opening it.",
  },
  /** "What's at this spot?" (D9): Physics' rules and wording, Viewer's design (15 Nov). */
  spotCheck: {
    button: "What's at this spot?",
    how: 'Click a spot in the lens, or use the arrow keys and Enter. Esc stops.',
    checking: 'Checking the photos and the catalogues…',
    sn: (date: string, sn: string) => `${date}: S/N ${sn}`,
    snNone: (date: string) => `${date}: off the photo`,
    nothing: 'Nothing clear at this pixel (below S/N 5 in both looks).',
    target: (name: string, sep: string) =>
      `This is ${name} (its predicted position is ${sep}″ from the spot).`,
    away: (name: string, sep: string) => `${name}, ${sep}″ away`,
    blend: (name: string, sep: string) =>
      `Another source lies within 12″ (${name}, ${sep}″ away); at SPHEREx's 6″ pixels these blend.`,
    flagCounts: (list: string) => `Flags in the photos that show it (information): ${list}.`,
    flagCount: (name: string, k: number) => `${name} in ${k}`,
    asking: (what: string) => `${what}: checking…`,
    blendHead: (list: string) =>
      `Blend: the light is centred ${list}. At SPHEREx's 6″ pixels they can't be separated.`,
    predictedPlace: (name: string) => `${name}'s predicted place`,
    stuck:
      'Probably a detector defect: it sits in the same detector pixel whatever SPHEREx points at.',
    howChecked: (n: number) => (n ? `How we checked (${n})` : 'Where and how bright'),
    brightIn: (bright: number, n: number) =>
      `in ${bright === 0 ? 'none' : bright * 2 <= n ? `only ${bright}` : String(bright)} of ${n}`,
    andAtTheOther: ', and at its other place ',
    flagCountFirst: (name: string, k: number, n: number) => `${name} in ${k} of ${n}`,
    /** Plain names for the flags (Viewer, 15 Nov), by the files' own bit names. */
    /**
     * Plain names for the flags. The authority is each plane's own description in the FLAGS
     * header (the MSKDnnnn card), quoted beside each name; checked 15 Nov on
     * level2_2025W19_1B_0116_1D3 (DR1, l2b-v27) after HALO had been misread (Viewer, Physics).
     * These labels are for DR1 l2b-v27 headers: QR2's names came from MP_ keys, and a later
     * release may describe its planes differently, so re-check against MSKD on any new release.
     * Wording signed by Physics, 15 Nov.
     * PHANTOM, REFERENCE and SATELLITE_HALO are in v4's FIT_REJECT list but are not planes in the
     * DR1 files, so they never fire here.
     */
    flagPlain: {
      TRANSIENT: 'jump during the exposure', // MSKD0000 "Transient detected during SUR"
      OVERFLOW: 'pixel filled up (overflow)', // MSKD0001 "Overflow detected during SUR"
      SUR_ERROR: 'onboard processing error', // MSKD0002 "Error in onboard processing"
      PHANTOM: 'phantom', // not a plane in DR1 files
      REFERENCE: 'reference pixel', // not a plane in DR1 files (JREF/KREF: "physical reference rows/cols on H2RG")
      NONFUNC: 'permanently unusable pixel', // MSKD0006 "Permanently unusable"
      DICHROIC: 'low efficiency (dichroic)', // MSKD0007 "Low efficiency due to dichroic"
      MISSING_DATA: 'data lost onboard', // MSKD0009 "Onboard data lost"
      HOT: 'hot pixel', // MSKD0010 "Hot pixel"
      COLD: 'unusually low signal', // MSKD0011 "Anomalously low signal"
      FULLSAMPLE: 'full readout kept', // MSKD0012 "Pixel full sample history is available" (not a fault)
      PHANMISS: 'phantom correction not applied', // MSKD0014 "Phantom correction was not applied"
      NONLINEAR: 'brightness correction not reliable here', // MSKD0015 "Nonlinearity correction cannot be applied reliably"
      PERSIST: 'afterglow (persistence)', // MSKD0017 "Persistent charge above threshold"
      OUTLIER: 'outlier', // MSKD0019 "Pixel flagged by Detect Outliers"
      CROSSTALK: 'crosstalk', // MSKD0020 "Pixel affected by crosstalk."
      SOURCE: 'known source', // MSKD0021 "Pixel mapped to a known source"
      GHOST: 'ghost of a bright source in the photo', // MSKD0022 "Affected by a bright source inside the exposure"
      GHOST_FPA: 'ghost of a bright source on another detector', // MSKD0023 "Affected by a bright source on another detector"
      GHOST_EXT: 'ghost of a bright source outside the view', // MSKD0024 "Pixel affected by a bright source outside FOV"
      STREAK: 'streak', // MSKD0025 "Pixel affected by a streak"
      BLOOM: 'bloom', // MSKD0026 "Pixel part of a bloom artifact"
      SNOWBALL: 'snowball', // MSKD0027 "Pixel part of a snowball artifact"
      HALO: 'halo around a hit', // MSKD0028 "Pixel part of a transient halo"; HISTORY "cosmic ray halo flagging"
      SATELLITE_HALO: 'halo around a streak', // not a plane in DR1 files (L2 N_SAT_HALO: "streak halo")
    },
    /** Facts about one of the five that help read a blend (Physics, 15 Nov; sources in targets.json). */
    targetFacts: {
      w0855: {
        text: "WISE 0855 is very faint below about 4 µm and much brighter near 4.5 µm (Spitzer, Vega magnitudes: 17.4 at 3.6 µm, 13.9 at 4.5 µm), so in shorter colours this light is mostly the neighbour; Compare adds all colours. Measured on this page: in 0.75–3.8 µm the light is centred within 0.8″ of the neighbour. In 3.8–5 µm it sits 2.6–6.2″ from the neighbour, on the line towards WISE 0855's predicted place (the two are 6.4–9.5″ apart, depending on the date).",
        source:
          'Luhman 2014, ApJL 786, L18 (Spitzer 3.6 and 4.5 µm); Schneider et al. 2016, ApJL 823, L35 (HST, J ≈ 26.4)',
      },
    },
    factSource: (src: string) => `(${src})`,
    factPointer: "Why it's mostly the neighbour here: see How we checked.",
    detectorName: 'Detector check',
    checkDetector: (places: number, brightText: string) =>
      `Detector check (information): it appears at ${places} different place${places === 1 ? '' : 's'} on SPHEREx's detectors. The detector pixel under it is bright ${brightText} photos of other parts of the sky. A detector defect would sit in the same pixel whatever SPHEREx points at.`,
    asteroid: (names: string) => `A known asteroid: ${names}.`,
    star: (names: string) => `A known star: ${names}.`,
    starFlagged: (flags: string) =>
      `Flags at this pixel too (${flags}): a bright or saturated star gets flagged.`,
    artefact: (flags: string) => `Probably an artefact (flags: ${flags}).`,
    unknown: 'Not in Gaia, CatWISE or the known-asteroid list: a candidate, not a discovery.',
    unknownWhy:
      "Most spots like this are noise, artefacts or blends we can't separate at 6″ pixels.",
    faint: 'Faint: likely noise.',
    next: "To take it further, check it in other surveys first. Backyard Worlds takes brown-dwarf candidates; asteroid reports go to the Minor Planet Center through an observatory code, so a single SPHEREx look isn't enough.",
    limits:
      "Two looks months apart can't show an object's path, so this check can't tell a new asteroid from an artefact.",
    seen: (n: number, m: number, masked: number) =>
      m
        ? `Seen at S/N 5 or more in ${n} of the ${m} photos read${masked ? ` (${masked} more masked here: saturated or flagged)` : ''}.`
        : `${masked === 1 ? 'The one photo read is' : masked === 2 ? 'Both photos read are' : `All ${masked} photos read are`} masked here (saturated or flagged), so none gives a number.`,
    photosShort: 'photos',
    detectorShort: 'detector',
    checkAsteroids: (names: string[]) =>
      `Known asteroids (SkyBoT, at the photos' dates): ${names.length ? names.join(', ') : 'none within 9″'}. SkyBoT's places are for Earth's centre; seen from SPHEREx, a main-belt asteroid can sit up to about 1 pixel from them (more for near-Earth asteroids).`,
    checkStars: (cat: string, names: string[]) =>
      `${cat}, moved to each look's date: ${names.length ? names.join(', ') : 'none within 9″'}`,
    checkFlags: (artefacts: string[]) =>
      `Artefact flags in most photos: ${artefacts.length ? artefacts.join(', ') : 'none'}.`,
    notChecked: (what: string) => `${what}: couldn't be checked just now`,
    asteroidsName: 'Known asteroids (SkyBoT)',
    catwiseName: 'CatWISE2020 (its archive at IRSA)',
    flagsName: 'Flags in each photo (needs the cloud helper)',
    fieldGuide: 'What fools you: real examples of artefacts and blends →',
    copy: 'Copy report',
    copied: 'Report copied',
    reportNote:
      'A look, not a measurement. Unknowns are candidates, not discoveries; most are noise, artefacts or blends.',
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
      "Too bright: its centre saturates SPHEREx's detector, and SPHEREx's PSF model doesn't reach far enough out to measure its spectrum from the star's edges.",
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
  /** The words column as a fixed summary plus tabs (option A, Sumit, 14 Nov). */
  panel: {
    label: 'What to do with this spot',
    tabs: { compare: 'Compare', watch: 'Watch', facts: 'Facts', spectrum: 'Spectrum' },
    hints: {
      compare: 'Blink two same-colour photos taken months apart: did anything move?',
      watch: 'Play every photo in this colour range in date order, or what changed.',
      // Empty: the colour windows' own heading says it right below.
      watchFive: '',
      facts: 'What was measured here, how sure it is, and what wasn\u2019t.',
      spectrum: 'How bright this spot is at each wavelength SPHEREx sees.',
    },
    /** The summary's honest state line for a live look. */
    lookState: 'Not measured: a look at the photos, not a search or a measurement',
    noSpectrum: 'No spectrum for this one yet.',
    /** What a tab's badge says to a screen reader. */
    badge: { photos: (n: string) => `${n} photos`, measured: 'measured' },
    /** The phone sheet's handle: what a press does next. */
    sheet: {
      peek: 'Showing the summary only. Show more',
      half: 'Showing half. Show all',
      full: 'Showing all. Show the summary only',
    },
  },
  /** The Learn room: a short guided tour (Rubin SkyViewer's "Please guide me" pattern). */
  tour: {
    eyebrow: (n: number, of: number) => `A short tour, ${n} of ${of}`,
    title: 'A short tour',
    steps: [
      'How SPHEREx sees the sky: it scans a ring of sky at right angles to the Sun; as Earth orbits, the ring sweeps the whole sky every six months.',
      'From out here: Earth, and SPHEREx on its orbit about 660 km up, looking out, away from Earth.',
      'SPHEREx has photographed the whole sky at least twice, in 102 infrared colours.',
      'Between its looks, almost every star holds still. A few nearby ones visibly move, like this runaway.',
      "Barnard's Star moved north between two looks. Watch the ring: it holds still, and the star doesn't.",
      'WISE 0855 is one of the coldest brown dwarfs known, faint and fast. SPHEREx caught it moving west.',
      'ε Indi B is two brown dwarfs in one dot. SPHEREx also measured its light colour by colour: its spectrum is below.',
      "Some stars change brightness instead. RW Aurigae may flicker, but SPHEREx can't confirm it yet, and says so.",
      "Your turn: type a position or a star's name, pick a light, or click anywhere in the sky.",
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
    light: 'Light',
    dark: 'Dark',
  },
  /**
   * The credits page: sources as a table, the makers as short cards with their full records
   * folded (the records are the owners' own words, CONSENSUS §1.7), the acknowledgements the
   * archives ask for printed verbatim in small type, and the dates as a footer line.
   */
  /**
   * "How we tested" (tests.html): the challenge's five as a benchmark, our own method tests and
   * our machinery checks, as facts in columns (Viewer, 14 Nov). Only the challenge quotes, the
   * "what makes it hard" lines, the limits and the after-seeing list are written by hand; every
   * number comes from the packs or the committed run outputs.
   */
  /** "What fools you" (fieldguide.html, queue N1; Viewer's design, Physics' rules). */
  fieldguide: {
    back: 'Planetes',
    title: 'What fools you',
    lede: 'Real SPHEREx photos of things that look like a discovery and aren’t, or aren’t new. Every example is a real photo; none is drawn.',
    notInSky: 'Not in the sky',
    inSkyNotNew: 'In the sky, but not new',
    looksLike: 'Looks like:',
    flagged: 'The pipeline flagged this; the flag name is the evidence.',
    confirmed: 'Confirmed by independent evidence, below.',
    howToTell: 'How to tell:',
    openSpot: 'Open this spot',
    linkShort: 'What fools you →',
    fromTests: 'Artefacts we know about: what fools you →',
    hatchKey: 'Hatched: masked by other flags. Red outline: the flag this card is about.',
    marksKey: '+ the light’s centre · ○ the Gaia star · ◇ WISE 0855’s predicted place',
    loadFailed: 'The examples couldn’t be loaded just now.',
    note: 'Examples come from photos we already had for our five targets and the live look, not a random sample of the sky. Each is the clearest example our fixed rule found (prereg/fieldguide/PLAN.md).',
    stretch:
      'Every panel uses the lens’s stretch rule (asinh from the 5th percentile to the brightest pixel), shared by the panels of one card and set from the pixels the card isn’t about, so the flagged pixels can show as white. Hatched: masked by other flags. Red outline: the flag the card is about.',
  },
  tests: {
    title: 'How we tested',
    back: 'Planetes',
    lede: 'The challenge asks for a tool that shows how any patch of sky changes, and names five objects to test it on. Here is what our tool does with each, what it measured, and what it can’t do, followed by the tests we added ourselves.',
    challengeLabel: 'The challenge, on its five tests:',
    challengeQuote:
      'Test your tool on Barnard’s Star, Epsilon Indi B (a pair of brown dwarfs orbiting a star), WISE 0855 (a fast-moving brown dwarf Right Ascension 08h55m10.831s, declination -7d14m42.53s), and variable stars RW Aurigae and R Draconis.',
    challengeSource: 'NASA Space Apps Challenge 2026, “Planet X and SPHEREx”',
    challengeLink: 'https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/',
    groups: {
      five: 'The challenge’s five',
      method: 'Tests of our method we added',
      machinery: 'Checks of our own machinery',
    },
    columns: { seen: 'Seen in the photos', measured: 'Measured', limit: 'Limit' },
    hardLabel: 'What makes it hard',
    liveAtChallenge: 'The live tool at the challenge’s position',
    liveAtCatalogue: 'The live tool at its catalogue position',
    notMeasuredSee: 'Not measured (see Limit).',
    earlierLabel: 'An earlier test',
    open: 'Open its page',
    tryLive: 'Try the live tool there',
    seen: {
      'seen-with-ring': 'Yes: the move is visible by eye (Physics’ eye test).',
      faint: 'Faint: hard to spot by eye (Physics’ eye test).',
      unseen: 'No: not visible by eye (Physics’ eye test).',
      untested: 'Not tested by eye: a brightness change, not a move.',
    } as Record<string, string>,
    movedMeasured: (arcsec: string, err: string, dir: string, from: string, to: string) =>
      `Moved ${arcsec}″ ± ${err}″ ${dir}, ${from} to ${to}.`,
    predicted: (arcsec: string, source: string) => `Predicted ${arcsec}″ (${source}).`,
    stillStars: (px: string) => `Still stars in the same photos: ${px} px median shift.`,
    brightness: (word: string, ratio: string, err: string) =>
      `${word}: ${ratio} ± ${err} of its brightness, last pass over first.`,
    notMeasured: (why: string) => `No: ${why}`,
    five: {
      barnard: {
        quote: '',
        hard: 'The fastest-moving star in the sky (about 10″ a year), and bright enough to saturate SPHEREx’s detectors.',
        limit:
          'Its centre is saturated, so its place comes from its image as a whole; its brightness isn’t measured. Its east component (± 2.6″ on its own) also carries a method effect of about 0.1 pixel (0.6″) that isn’t included in that error.',
        live: 'Opens 361 photos in 3 passes, compared at 0.86 µm.',
      },
      'epsind-b': {
        quote: 'Epsilon Indi B (a pair of brown dwarfs orbiting a star)',
        hard: 'Two brown dwarfs 0.7″ apart, about 7′ from their bright star, ε Indi A.',
        limit:
          'SPHEREx’s pixels are 6.15″ wide, so the pair is one dot: the move is of the pair together.',
        live: 'Opens 467 photos in 4 passes, compared at 0.75 µm, where brown dwarfs are faint.',
      },
      w0855: {
        quote: '',
        hard: 'One of the coldest brown dwarfs known: almost invisible at SPHEREx’s shorter wavelengths. And the position given is its 2010 place, 2.1′ from where it is now.',
        limit:
          'Its first pass (May 2025) has too few usable photos, so only the half-year pair gives a number.',
        live: 'At the challenge’s exact position: 258 photos in 3 passes, compared at 1.02 µm, where WISE 0855 is too faint to see, and the star now sits 2.1′ off-centre, at the edge of the 4′ close-up. The live tool alone doesn’t show it there; its page (and Enter in the search, which says so) uses 3–5 µm and its present place.',
      },
      'rw-aur': {
        quote: '',
        hard: 'A young star whose brightness flickers, and bright enough to saturate SPHEREx.',
        limit:
          'Measured only from the unsaturated edges of its image, in the colour ranges that pass a steady-star test; RW Aurigae A and B share one pixel, so it’s their combined light. An earlier pre-registered test on the previous release saw the same dimming but couldn’t confirm it (see below).',
        live: 'Opens 335 photos in 3 passes, compared at 1.62 µm. A live look shows the photos; it doesn’t measure brightness.',
        earlier:
          'An earlier pre-registered test, on the previous data release (QR2), saw the same dimming (about 42% and 50% in two colour ranges) but could not confirm it: one range’s change was under 5 times its error, and one comparison star changed more than RW Aurigae. The new measurement uses a different check (a steady bright star measured the same way) and passes it.',
      },
      'r-dra': {
        quote: '',
        hard: 'A giant star that brightens and fades over about eight months, bright enough to saturate SPHEREx, in one of the fields SPHEREx photographs most often.',
        limit:
          'Its glare reaches the comparison stars in its field, which vary by 34% between passes, so the method can’t be checked here. Re-checked with comparison stars outside its glare: a possible dimming of about 40%. Not confirmed: the same method on steady stars as saturated as R Draconis didn’t stay steady enough (it failed in two colour ranges and couldn’t be tried in the third).',
        live: 'Opens 2,500 photos in 3 passes (a deep field; the look picks a few), compared at 0.82 µm. A live look doesn’t measure brightness.',
      },
    } as Record<
      string,
      { quote: string; hard: string; limit: string; live: string; earlier?: string }
    >,
    liveNote:
      'Checked by hand on 14 November 2026 at the challenge’s position (WISE 0855) or the catalogue position (the others).',
    seasonPairs: {
      title: 'A search for slow movers between passes',
      what: 'Compares each star’s place between two passes, without being told where the target is; a “candidate” moves consistently in at least two detectors by more than 5 times what still stars do.',
      result: (found: number, of: number, falseAlarms: number, pairs: number) =>
        `ε Indi B was the only candidate in ${found} of its ${of} pass pairs (missed in ${of - found}); no other candidate in any of the ${pairs} pass pairs of the five fields (${falseAlarms} false alarms).`,
      rate: (lo: string, hi: string) =>
        `Its rate: ${lo} to ${hi}″ a year; the catalogue says 4.68.`,
      limit:
        'Developed on these five fields, so it isn’t a blind test of them. WISE 0855 is too faint for it and Barnard’s Star too bright. Its real test is the yardstick below, on 240 other fields.',
      registered: 'Not registered beforehand: a prototype.',
      output: 'Run output',
    },
    yardstick: {
      title: 'How faint and slow a mover can that search find?',
      what: 'Fake slow movers planted in 40 other fields, with false alarms counted on 200 more; the plan, the fields and the scores were fixed before any photo is read.',
      status:
        'Registered before any photo is read: commit 4db4606 (the plan, the fields, the two model spectra and their hashes). Not run yet.',
    },
    twins: {
      title: 'Finding stars with the same colours',
      what: 'Gives every star a spectrum from SPHEREx’s own photos and finds its closest match by shape, with nothing learned.',
      v1: (ratio: string, rho: string) =>
        `A star’s closest match differs from it in Gaia’s colour ${ratio} times as much as a random star does; the main shape tracks Gaia’s colour (rank correlation ${rho}). Passed its rule, but an easy test: that pattern is just temperature.`,
      v2: (sameField: string, expect: string, w12: string) =>
        `Harder tests: no sign of agreement beyond colour at 3–5 µm (ratio ${w12}, where 1 means no better than random), and ${sameField} of matches come from the star’s own field against ${expect} by chance: the spectra still carry each field’s systematics.`,
      registered:
        'v1’s rule was written in the script before running, but committed together with its result. v3, the real test (60 fields, 12 locked), was committed before any of its photos are read: commit 5aad43f.',
    },
    outlier: {
      title: 'NASA’s “outlier” flag as a mover finder',
      what: 'Could the pipeline’s own OUTLIER flag find moving objects cheaply? Tested by Physics on two test patches, against known asteroids.',
      result:
        'Ruled out: it catches known asteroids only to about magnitude 19, with hundreds of false clusters for every real one; skipping catalogued sources makes it worse.',
    },
    machinery: [
      {
        title: 'Where each photo looks',
        result:
          'Our sky index places a photo’s pixels within 0.00009 pixels of astropy’s full solution, on every photo checked (a 9 × 9 grid of points on each).',
      },
      {
        title: 'The cloud helper',
        result:
          'Frames cut out by our helper on Cloudflare match the browser’s own reading of the same NASA files (correlation 0.999996); both use the same reader code.',
      },
    ],
    afterTitle: 'Choices made after seeing these fields',
    afterLede:
      'General methods only, but some choices were made after seeing data from these five fields. Each is listed here and next to the number it affects.',
    after: [
      'Brightness from a saturated star’s edges: the steady-star tolerance (1.00 ± 0.06) was chosen after seeing Barnard’s Star’s results (said in RW Aurigae’s “how”).',
      'The slow-mover search: developed and debugged on these five fields (a sloped background added after a false alarm in Barnard’s Star’s field; the glare rule changed after it hid ε Indi B itself). Its independent test is the registered yardstick on other sky, not yet run.',
      'The “what changed” film: its brightness-scale fit leaves the target out and was narrowed after an over-fit (×1.35) was seen on RW Aurigae’s film; its same-orientation references, colour-step tolerance and background-plane removal were also set after looking at these fields.',
      'The “it was here in 2010” note: its tolerances were set with WISE 0855’s challenge position in mind.',
      'Which stars in a pack count as the target: a matching motion is required, after the target flags were re-checked on these fields.',
      'Spot the mover: offered only where Physics’ eye test says the move can be seen. That eye test was not blind (Physics knew which star and which way it should move), and ε Indi B’s “faint” rather than “seen” was a judgement call.',
      'RW Aurigae’s cutout: re-made 48 pixels wide (from 40) after the first left too few comparison stars.',
      'Barnard’s Star’s headline pair is a year apart (passes 1 and 3): the half-year pairs were marked not reliable after its edge fit’s offset was seen to flip with the scan direction.',
      'WISE 0855: fitted together with its G 16.3 neighbour, after the all-colour picture showed the neighbour pulling its centre.',
      'R Draconis “not measurable yet”: set after its flagged area was seen to exceed the star-image model’s reach in every detector.',
      'R Draconis: comparison stars moved 4–15′ out after the ones in its field proved to sit in its glare; the steady-star check used for RW Aurigae covers a fainter, less saturated star than R Draconis.',
      'Barnard’s Star’s east component: a later check found a method effect of about 0.1 pixel in east, not included in its quoted error; no number was changed, and it is said next to that number.',
    ],
    afterDesigned:
      'Designed for these targets, not chosen from results: the still and comparison stars (Gaia G ≤ 15.5, in the frame, masked to the target’s saturated radius). Never set on these fields: the fast-mover search’s thresholds, its fake-mover yardstick, and the check that fakes are found like real asteroids, all fixed on other sky first.',
    afterPending: 'List reviewed and completed by Physics, 14 November 2026.',
    /** Viewer (14 Nov): a resource we looked at and didn't use belongs here, not in the credits. */
    notUsed:
      "Considered and not used: Canada's NEOSSat photos (the CSA's asteroid-watching telescope, in the Canadian Astronomy Data Centre). CADC's search didn't answer when we tried during the event.",
    footer:
      'Every number above is read from the same data files as the tool itself, or from the run outputs linked.',
    /** The way in, from the band, a target's Facts tab, the legend and the credits page. */
    link: 'The challenge’s five tests: how we tested',
    linkShort: 'How we tested →',
  },
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
        what: 'Names in the search',
        source:
          "The five, the IAU star names and the constellations are in the page itself. A name it doesn't know is looked up in SIMBAD (CDS, Strasbourg) through CDS's Sesame name resolver, by our helper: only the typed name is sent, to the helper and from there to CDS (or its Harvard mirror).",
        terms: 'Acknowledgement requested',
        link: 'https://simbad.cds.unistra.fr/simbad/',
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
        what: 'Fainter stars when zoomed in',
        source:
          "Gaia DR3 (ESA), fetched one sky patch at a time through our helper from ESA's Gaia archive and kept near you for next time; only the patch's number is sent",
        terms: 'Labelled as Gaia, not SPHEREx',
      },
      {
        what: 'This spot in WISE photos',
        source:
          "WiseView (Backyard Worlds), the tool the challenge names as a model: WISE's photos from 2010 on, a longer span than SPHEREx's. Linked from each look; only the position is sent.",
        terms: 'Linked, not embedded',
        link: 'http://byw.tools/wiseview',
      },
      {
        what: 'Explore SPHEREx yourself',
        source:
          "IRSA's SPHEREx Data Explorer (search, cutouts, its own spectrum tool), the Moving Object Search Tool for asteroids, and IRSA's SPHEREx tutorial notebooks for reading these files in Python",
        terms: 'NASA/IPAC IRSA',
        link: 'https://caltech-ipac.github.io/irsa-tutorials/spherex/',
      },
      {
        what: "What's at this spot?",
        source:
          'Gaia DR3 (ESA), CatWISE2020 (NASA/IPAC IRSA) and known asteroids (SkyBoT, IMCCE), asked through our helper. Only the clicked position is sent: to our helper, and from there to ESA, IRSA and IMCCE.',
        terms: 'Checks, not discoveries',
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
        what: 'Spectrum neighbour check',
        source:
          "Gaia DR3 stars around the spot, asked from ESA's Gaia archive by our cloud helper, with the same rule as our pipeline",
        terms: 'Gaia acknowledgement below',
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
      /** As CDS asks for SIMBAD (search names it doesn't hold locally go there; 14 Nov). */
      'This research has made use of the SIMBAD database, CDS, Strasbourg Astronomical Observatory, France.',
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
