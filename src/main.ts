import './styles/tokens.css';
import './styles/base.css';
import './styles/header.css';
import './styles/app.css';
import './styles/mark.css';
import './styles/glass.css';
import { copy, list } from './copy/en';
import {
  type Entry,
  initialState,
  transition,
  type ViewerEvent,
  type ViewerState,
} from './app/state';
import {
  COVERAGE_RELEASES,
  framesReleases,
  NEAR_WANDERER_DEG,
  PACK_RELEASES,
  WANDERERS,
  pastPlace,
  offsetAt,
  motionDirection,
  trackTicks,
  WANDERER_EPOCH,
} from './app/targets';
import {
  blendingNeighbour,
  clearestDetector,
  pairDetectors,
  planCandidates,
  probeChoice,
  type LiveCandidate,
  type LookPlan,
} from './app/live';
import { playFlipbook, playReveal, showRevealStill } from './app/reveal';
import {
  predictionLabel,
  primaryPair,
  brightnessPair,
  brightnessRatios,
  type BrightnessRatio,
  scatterTest,
  seasonsIn,
  showFor,
  type Show,
} from './app/shows';
import {
  parseSkyPosition,
  degText,
  positionText,
  positionFromQuery,
  separationDeg,
  type SkyPosition,
} from './data/coords';
import {
  apertureFlux,
  catwiseNear,
  loadIndexMeta,
  type CatwiseStar,
  readNative,
  gaiaNear,
  findPhotos,
  helperActive,
  liveSpectrum,
  helperAddress,
  probePhoto,
  readPhoto,
  warmUp,
  type LiveSpectrum,
  seasonsOf as passesOf,
  type LivePhoto,
  type LiveFrame,
} from './data/live/dr1qr3';
import { loadCoverage, type Coverage } from './data/coverage';
import { passCount, passStarts, weekCounts, type BandFile } from './app/passes';
import { skyBand, type SkyBand } from './ui/skyBand';
import { combobox, type ComboOption } from './ui/combobox';
import {
  nearby,
  normalise,
  placeAt,
  search as searchNames,
  type Entry as SearchEntry,
} from './app/searchIndex';
import { DEEP_MAX_FOV, deepMark, patchesForView, type Patch } from './app/deepStars';
import {
  COLOUR_SHIFT,
  colourPanels,
  colourRatio,
  skyToPixel,
  type ColourPanel,
} from './app/colourShift';
import { colourShiftFigure, ratioCanvas } from './ui/colourShift';
import { npix, pixelCentre } from './data/healpix';
import {
  loadPack,
  loadTile as loadPackTile,
  loadBundle,
  loadBundledTile,
  stackPair,
  type LoadedPack,
  type Tile,
} from './data/pack/load';
import { coadd } from './data/pack/coadd';
import { knownMoversAt, observerFromHeader, type Observer } from './data/live/skybot';
import { fieldRadiusDeg, marksAt, type MoverMark } from './app/movers';
import type { Detector } from './data/colour/cwave';
import { FlagMask, type Frame, type TargetId } from './data/pack/types';
import { LensView, type LensOverlay, type Shift } from './render/lens';
import {
  DIFF_LIMIT,
  diffGradient,
  difference,
  inSigma,
  renderDifference,
  strictLook,
} from './render/difference';
import { differenceFilm, type DifferenceFrame, type FilmInput } from './data/live/film';
import { targetPlaceAt, type PassPlaces } from './app/targetPlace';
import { NEAR_DEG, SkyView, type CatalogueStar, type Figure, type Lantern } from './render/sky';
import {
  apertureSN,
  BLEND_ARCSEC,
  majorityFlags,
  photoGrid,
  placesOf,
  relevantStars,
  samePixelProbes,
  stuckOnDetector,
  flagNamesNear,
  INFO_FLAGS,
  MATCH_ARCSEC,
  recentre,
  SPOT_SN,
  tileGrid,
  verdict,
  type SpotFacts,
  type Verdict,
} from './app/spotCheck';
import { fadedTile } from './render/fade';
import { renderTimeColour, TIME_EARLY, TIME_LATE } from './render/timeColour';
import { sharedStretch, type Stretch } from './render/stretch';
import { parseGlow } from './render/milkyway';
import { canRun3D, watchQuality } from './render/quality';
import { h, prefersReducedMotion } from './ui/dom';
import { listenControl } from './ui/listen';
import { parseTab, tabbedPanel, type PanelTab, type TabSpec } from './ui/tabs';
import { fitLabels, fitText } from './ui/fit';
import { lensGlass } from './ui/glass';
import { schemeChoice, watchScheme } from './ui/scheme';
import { markSvg } from './ui/mark';
import { BLANK_FRAMES, CUBE_UM, FIRST_FRAME, openContextMap, type ContextMap } from './ui/context';
import {
  colourWindows,
  howSure,
  photoDots,
  ribbon,
  binSpectrum,
  spectrumFigure,
  svg,
  thumbnail,
  wavelengthColour,
  type SpectrumPoint,
} from './ui/figures';
import { pastPathFigure } from './ui/pastPath';
import {
  arcsecAbout,
  arcsecAboutText,
  coinDistanceMetres,
  dayMonthYear,
  fixed,
  monthYear,
  utcTime,
} from './ui/numbers';

/* ---------- theme: Infrared by default, Night observatory under ?theme=observatory ---------- */

const theme =
  new URLSearchParams(location.search).get('theme') === 'observatory' ? 'observatory' : null;
if (theme) document.documentElement.dataset['theme'] = theme;
watchScheme();
fitLabels(copy.fit.more, copy.fit.less);
void document.fonts.ready.then(() => fitText());
/** ?embed=1: for an iframe on another site. Minimal chrome, and a link out to the full viewer. */
const embedded = new URLSearchParams(location.search).get('embed') === '1';
if (embedded) document.documentElement.dataset['embed'] = '1';

/* ---------- state ---------- */

let state: ViewerState = initialState;
const packs = new Map<TargetId, LoadedPack>();
let current: { pack: LoadedPack; show: Show; pair: [Tile, Tile] } | null = null;
let showing: 0 | 1 | null = null;
/** The difference of the pair on screen, while the visitor has it on (noise in MJy/sr). */
/** Colour by date (E3): the shown pair as one blue/orange picture in the lens. */
let colouring = false;
/** The same, for a live look's fair pair. */
let liveColouring = false;
/** Fade between the looks (3b): how far towards the later look, 0–1; null when off. */
let fadeAt: number | null = null;
let differencing: {
  sigma: number;
  masked: number;
  detectors: number;
  /** The colours used, e.g. "3.8–5 µm", and whether they are narrowed to the target's own. */
  range: string;
  narrowed: boolean;
  canNarrow: boolean;
} | null = null;
/**
 * "Spot the mover" (Zooniverse-style known answer): the lens blinks the two looks without the
 * arrow; the visitor taps where the target is in the later look, then sees the measured answer.
 * Only where Physics' eye test says the hop can be seen with the ring (Barnard's Star today).
 */
let spot: {
  state: 'playing' | 'done';
  hit: boolean | null;
  timer: number;
  /** The last tap was on the ring's centre: ask for a side. */
  nudge?: boolean;
  /** Overlays hidden while playing (they hint at the answer), put back afterwards. */
  saved: {
    predicted: LensOverlay['predicted'];
    catalogue: LensOverlay['catalogue'];
    movers: LensOverlay['movers'] | null;
  };
} | null = null;
/** One live region for the game, kept across renders so screen readers announce changes. */
const spotStatus = h('p', { class: 'spot-status', role: 'status' });

/** Bumped whenever something else takes the lens, so a difference still loading is dropped. */
let diffRequest = 0;
let diffBusy = false;
/** The visitor asked for every shared colour, not just those where the target shows. */
let diffAllColours = false;
let diffTrouble = false;
/** The season pair a visitor picked per target; the pack's measured pair otherwise. */
const chosenPair = new Map<TargetId, [number, number]>();
let stopReveal: (() => void) | null = null;
let holdTimer = 0;
let searchNote = '';
/** A live look at a typed spot: its plan, the photos as they land, and what's shown. */
let live: {
  at: SkyPosition;
  plan: LookPlan<LivePhoto> | null;
  /** While checking colours: photos checked so far, of how many, of all found. */
  probe: { done: number; total: number; of: number } | null;
  /** Every photo of the spot in the sky index (the spectrum picks from these). */
  photos: LivePhoto[];
  /** G1: Gaia and CatWISE for this look's marks, fetched on the first toggle. */
  catalogues?: { gaia: CatFetch; catwise: CatFetch };
  landed: {
    candidate: LiveCandidate<LivePhoto>;
    tile: Tile;
    key: string;
    /** SPHEREx's position at this photo (header), for SkyBoT's places (G2). */
    observer: Observer | null;
  }[];
  /** Known asteroids per shown photo, once SkyBoT answers. */
  movers: MoverMark[][] | 'failed' | null;
  spectrum: {
    state: 'reading' | 'done' | 'failed';
    done: number;
    total: number;
    result: LiveSpectrum | null;
    abort: AbortController;
  } | null;
  tiles: Tile[];
  stretch: Stretch | null;
  done: boolean;
  abort: AbortController;
  /** The probed photos, so another colour can be planned without probing again. */
  probed: LookProbed | null;
  /** Which colour range the look shows and why (Physics + Viewer, 14 Nov); null before chosen. */
  colour: LookColour | null;
  /** True while each colour's pair is read to find where the centre shows clearest. */
  choosingColour: boolean;
} | null = null;
/** A live look (`typeof live` right after its `= null` would narrow to null). */
type LiveLook = Parameters<typeof finishLook>[0];

function dispatch(event: ViewerEvent): void {
  state = transition(state, event);
  render();
}

/** In an embed, the wordmark opens this same view in the full viewer, in a new tab. */
function openFullLink(): HTMLElement {
  const a = h(
    'a',
    { class: 'home', href: '#', target: '_blank', rel: 'noopener', title: copy.share.openFull },
    markSvg(),
    h('span', { class: 'home-name' }, 'Planetes'),
  );
  a.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('embed');
    a.setAttribute('href', url.toString());
  });
  return a;
}

/* ---------- layout: one persistent room ---------- */

const app = document.getElementById('app') as HTMLElement;
// Set the place before any child exists, so nothing transitions in from a default state.
app.dataset['place'] = state.place.kind;

const skyCanvas = h('canvas', { class: 'sky', width: 1120, height: 1120, 'aria-label': 'Sky map' });
const lensCanvas = h('canvas', { class: 'lens', width: 720, height: 720, 'aria-label': 'Lens' });
/** While a look's photos are found and read: a faint arc sweeping the empty lens, like SPHEREx's
 * own scan ring (Sumit, 15 Nov: subtle loading hints). Placed over the lens in render(). */
const lensScan = h('div', { class: 'lens-scan', 'aria-hidden': 'true', hidden: true });
const locatorCanvas = h('canvas', {
  class: 'locator',
  width: 360,
  height: 180,
  'aria-hidden': 'true',
});
const trueScale = h('canvas', {
  class: 'true-scale-canvas',
  width: 200,
  height: 200,
  'aria-hidden': 'true',
});
const moonDisc = h('div', { class: 'moon-disc', role: 'img', 'aria-label': copy.moon });
const moon = h('figure', { class: 'moon' }, moonDisc, h('figcaption', {}, copy.insets.moon));
const trueScaleFig = h(
  'figure',
  { class: 'true-scale' },
  trueScale,
  h('figcaption', {}, copy.insets.realSize),
);
const lensLabel = h('div', { class: 'lens-labels', 'aria-live': 'polite' });
/** Inside the sky, the hero slot is a ring on the backdrop: the zone of interest, where the lens will open. */
const focusRing = h('div', { class: 'focus', 'aria-hidden': 'true' });
/** Under the ring: what you're looking toward, by the nearest named star. */
const focusCaption = h('p', { class: 'focus-caption', 'aria-live': 'polite' });
const entrySwitch = h('div', {
  class: 'entry-switch glass',
  role: 'group',
  'aria-label': 'Map style',
});
const dial = h('div', { class: 'dial glass', role: 'group', 'aria-label': 'Room' });
/** Where the search input sits in the header when it isn't in the homepage column. */
const searchAnchor = document.createComment('search');
const search = h('input', {
  class: 'search glass',
  type: 'search',
  placeholder: copy.home.placeholder,
  enterkeyhint: 'go',
  autocomplete: 'off',
  spellcheck: 'false',
  // Positions are ICRS (J2000): an old B1950 position is up to ~0.7° off by precession alone.
  title: copy.search.frame,
});
/**
 * The wordmark is the way home: from a show it goes back to the sky (aimed at the light just
 * left); on the sky it returns to the opening view. A chevron appears beside it in a show.
 */
const homeLink = h(
  'a',
  { class: 'home', href: './' },
  h('span', { class: 'home-back', 'aria-hidden': 'true' }, '‹'),
  markSvg(),
  h('span', { class: 'home-name' }, 'Planetes'),
  // The line under the name (Sumit, 15 Nov; Viewer's wording): explains the Greek, claims nothing.
  h('span', { class: 'home-tagline' }, copy.nav.tagline),
);
// No aria-live over the whole column: every tab switch would re-announce it. Status lines
// carry role="status" themselves.
const words = h('section', { class: 'words' });
const band = h('footer', { class: 'band' });

const header = h(
  'header',
  { class: 'top' },
  h('h1', { class: 'wordmark' }, embedded ? openFullLink() : homeLink),
  dial,
  searchAnchor,
  h('a', { class: 'credits-link', href: 'credits.html' }, copy.nav.credits),
);

const stage = h(
  'div',
  { class: 'stage' },
  h(
    'div',
    { class: 'view' },
    entrySwitch,
    skyCanvas,
    focusRing,
    focusCaption,
    lensCanvas,
    lensScan,
    locatorCanvas,
    trueScaleFig,
    moon,
    lensLabel,
  ),
  words,
);
app.append(header, stage, band);
lensGlass(app);

const sky = new SkyView(skyCanvas);
// No edge chips for the five: the homepage band's rows reach all of them (Viewer, 14 Nov).
sky.edgeChips = false;
const locator = new SkyView(locatorCanvas);
const lens = new LensView(lensCanvas);
// Screen readers hear what the lens shows, not just "Lens": its caption, kept in step.
new MutationObserver(() => {
  // A child's own aria-label first (the look pill names both looks with a separator; Viewer).
  const parts = [...lensLabel.children]
    .map((c) => (c.getAttribute('aria-label') ?? c.textContent)?.trim())
    .filter(Boolean);
  const text = parts.length ? parts.join('. ') : lensLabel.textContent?.trim();
  lensCanvas.setAttribute('aria-label', text ? `${copy.lensName}: ${text}` : copy.lensName);
}).observe(lensLabel, { childList: true, subtree: true, characterData: true });
lensCanvas.setAttribute('role', 'img');
// On the dev server only: the sky in the console, for checking the zoom ladder by hand.
if (import.meta.env.DEV) Object.assign(globalThis, { planetesSky: sky });

/**
 * Puts the sky canvas where the entry needs it: in the hero slot for the globe and flat map,
 * or behind the whole page for the inside view, with the ring as its optical axis.
 */
function placeSky(entry: Entry): void {
  // The sky is always the page's backdrop; the hero slot only anchors it (see fitBackdrop).
  if (!skyCanvas.classList.contains('backdrop')) {
    skyCanvas.classList.add('backdrop');
    app.prepend(skyCanvas);
  }
  if (entry === 'inside' && !lookedInside) {
    const first = WANDERERS[0];
    if (first) sky.centreOn(first.at);
    lookedInside = true;
  }
  sky.setEntry(entry);
  fitBackdrop();
}

let lookedInside = false;

/** Sizes the backdrop to the window and tells the sky where the ring is. */
function fitBackdrop(): void {
  if (!skyCanvas.classList.contains('backdrop')) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  skyCanvas.width = Math.round(window.innerWidth * dpr);
  skyCanvas.height = Math.round(window.innerHeight * dpr);
  refocus();
}

/** Tells the sky where the hero slot is now (it moves when a narrow page scrolls). */
function refocus(): void {
  const dpr = skyCanvas.width / Math.max(1, window.innerWidth);
  // And where the page's words and cards sit, so the sky keeps its names out from under them.
  sky.setQuiet(
    state.place.kind === 'sky'
      ? [words, band, header, entrySwitch].map((el) => {
          const b = el.getBoundingClientRect();
          return { x: b.left * dpr, y: b.top * dpr, w: b.width * dpr, h: b.height * dpr };
        })
      : [],
  );
  const r = focusRing.getBoundingClientRect();
  sky.setFocus({
    x: (r.left + r.width / 2) * dpr,
    y: (r.top + r.height / 2) * dpr,
    r: (r.width / 2) * dpr,
  });
}
window.addEventListener('resize', fitBackdrop);
// The slot settles after fonts and data arrive, so refit whenever it changes size.
new ResizeObserver(() => fitBackdrop()).observe(focusRing);
// The hero is sized from what the header and the dock leave, measured, not guessed: the dock
// is taller in a show (its photo dots and the five cards) than on the sky.
const chrome = new ResizeObserver(() => {
  const used = header.getBoundingClientRect().height + band.getBoundingClientRect().height;
  app.style.setProperty('--chrome', `${Math.round(used + 56)}px`);
});
chrome.observe(header);
chrome.observe(band);
let refocusQueued = false;
window.addEventListener(
  'scroll',
  () => {
    if (refocusQueued) return;
    refocusQueued = true;
    requestAnimationFrame(() => {
      refocusQueued = false;
      refocus();
    });
  },
  { passive: true },
);

const spaceButton = h('button', { type: 'button', 'data-space': '' }, copy.sky.entrySpace);
for (const entry of ['inside', 'flat'] as const) {
  const b = h('button', { type: 'button', 'data-entry': entry }, copy.sky.entrySwitch[entry]);
  b.addEventListener('click', () => {
    // The visitor's own pick: leaving Learn won't undo it (Viewer, 15 Nov).
    learnFrom = tourSetEntry = null;
    goEntry(entry);
  });
  entrySwitch.append(b);
  // "From space" (Earth, the orbit and the ring) lives in Learn, step 1, since 14 Nov.
}
spaceButton.addEventListener('click', goSpace);
for (const [dir, label] of [
  [-1, '−'],
  [1, '+'],
] as const) {
  const b = h(
    'button',
    { type: 'button', class: 'zoom', 'aria-label': dir > 0 ? copy.sky.zoomIn : copy.sky.zoomOut },
    label,
  );
  b.addEventListener('click', () => sky.zoomStep(dir));
  entrySwitch.append(b);
}
/** Riding along with SPHEREx (on by default in Look around); dragging or flying pauses it. */
const rideButton = h('button', { type: 'button', class: 'ride', 'data-ride': '' }, '');
rideButton.addEventListener('click', () => sky.ride(!sky.riding));
// Riding is Learn-only now (step 1, "Ride along"); the button stays for that card's state.
function markRide(): void {
  rideButton.textContent = sky.riding ? copy.sky.riding.riding : copy.sky.riding.ride;
  rideButton.setAttribute('aria-pressed', String(sky.riding));
  // Riding is motion, so under reduced motion it's off and the control is hidden.
  rideButton.hidden = state.entry !== 'inside' || sky.steppedOut || prefersReducedMotion();
}
/**
 * Zoomed out as far as Look around goes: on the homepage that's the end (stepping out to Earth
 * lives in Learn); a quiet offer of the whole-sky map appears under the view switch, once.
 */
const wholeSkyHint = h(
  'button',
  { type: 'button', class: 'whole-sky-hint', hidden: true },
  copy.sky.wholeSky,
);
entrySwitch.after(wholeSkyHint);
let wholeSkyOffered = false;
let wholeSkyTimer = 0;
sky.onWiderWanted = () => {
  if (wholeSkyOffered || state.place.kind !== 'sky') return;
  wholeSkyOffered = true;
  wholeSkyHint.hidden = false;
  window.clearTimeout(wholeSkyTimer);
  wholeSkyTimer = window.setTimeout(() => (wholeSkyHint.hidden = true), 8000);
};
wholeSkyHint.addEventListener('click', () => {
  wholeSkyHint.hidden = true;
  const at = { ra: sky.centre.ra, dec: sky.centre.dec };
  switchEntry('flat');
  // The spot you were looking at, centred on the map.
  sky.centreOn(at);
});

sky.onRide = () => {
  markRide();
  if (state.room === 'learn') render();
};
// Under reduced motion stepping out cuts between stills: a short fade joins them.
sky.onCut = () => crossFade(true);

/**
 * SPHEREx's real pointing (Physics' timelines, one row per exposure): an ordinary day by
 * default, or 24 h round a target's photo, starting at the moment it was taken.
 */
type TimelineFile = { label: string; rows: [number, number, number, number, number, string][] };
const timelines = new Map<string, Promise<TimelineFile | null>>();
function loadTimeline(label: string): Promise<TimelineFile | null> {
  let p = timelines.get(label);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/pointing/pointing_${label}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<TimelineFile>) : null))
      .catch(() => null);
    timelines.set(label, p);
  }
  return p;
}
async function rideTimeline(target: TargetId | null): Promise<void> {
  const t = (target && (await loadTimeline(target))) || (await loadTimeline('ordinary-2025-11-15'));
  if (!t) return;
  // Round a target, start at the photo: the exposure pointing nearest it.
  const w = target ? WANDERERS.find((x) => x.id === target) : null;
  let start: number | null = null;
  if (w) {
    let best = Infinity;
    for (const r of t.rows) {
      const d = Math.hypot(
        (r[1] - w.at.ra) * Math.cos((w.at.dec * Math.PI) / 180),
        r[2] - w.at.dec,
      );
      if (d < best) {
        best = d;
        start = r[0];
      }
    }
  }
  sky.setTimeline(t, start);
}
void rideTimeline(null);

/**
 * The view control: Look around (through SPHEREx's eye; again, from space, steps back in) and
 * the flat all-sky map, a different projection, so it cross-fades.
 */
function goEntry(entry: Entry): void {
  if (entry === 'inside' && state.entry === 'inside') sky.stepOutTo(0);
  else if (entry !== state.entry) switchEntry(entry);
}
/** Steps out from SPHEREx to Earth and its orbit (from the flat map, via Look around). */
function goSpace(): void {
  if (state.entry !== 'inside') switchEntry('inside');
  sky.stepOutTo(1);
}
// Play and Learn only (Sumit and Viewer, 14 Nov): Watch was a second door to the panel's Watch
// tab, which is where a star's photos over time live; on the five's pages that tab still uses
// the 'watch' room state, and Play stays lit.
for (const room of ['play', 'learn'] as const) {
  const b = h('button', { type: 'button', 'data-room': room }, copy.rooms[room]);
  b.addEventListener('click', () => {
    if (room === state.room) return;
    const go = () => {
      leaveDifference();
      // Leaving Learn resets in render(), whichever way the visitor leaves.
      if (watching !== null) void playColour(watching);
      dispatch({ type: 'setRoom', room });
      if (room === 'learn') runTourStep(0);
    };
    // Play <-> Learn re-lays the page (the column, the band, the search's place): the browser
    // glides each named part to its new place instead of a one-frame jump (Sumit, 15 Nov).
    // Without View Transitions, or under reduced motion, it simply switches.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(go);
    else go();
  });
  dial.append(b);
}
homeLink.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  goHome();
});

/** Out of a show: back to the sky. On the sky: the opening view, as on first arrival. */
function goHome(): void {
  if (state.place.kind !== 'sky') {
    leaveShow();
    return;
  }
  if (state.room !== 'play') dispatch({ type: 'setRoom', room: 'play' });
  if (state.entry !== 'inside') switchEntry('inside');
  else sky.stepOutTo(0);
  const first = WANDERERS[0];
  if (first) void sky.flyTo(first.at, 60, prefersReducedMotion() ? 0 : 900);
}

// Each light carries its name and its one-line story, on the sky itself.
const lanterns: Lantern[] = WANDERERS.map((w) => ({
  id: w.id,
  at: w.at,
  label: copy.wanderers[w.id].name,
  story: copy.wanderers[w.id].short,
  ready: w.ready,
}));
sky.labels = {
  sun: copy.sky.sunToday,
  photo: copy.sky.photoSize,
  photoDetail: copy.sky.photoDetail,
  moon: copy.sky.moonToScale,
  stepOut: copy.sky.stepOut,
  lens: copy.sky.lensField,
  outOfView: copy.sky.outOfView,
  earthBelow: copy.sky.riding.earthBelow,
  surface: copy.sky.riding.surface,
  riding: copy.sky.riding.note,
  ghost: copy.sky.riding.ghost,
  ghostBehind: copy.sky.riding.ghostBehind,
  trueSize: copy.sky.riding.trueSize,
  ridingReal: copy.sky.riding.ridingReal,
  ridingGap: copy.sky.riding.ridingGap,
  sunOn: copy.sky.sunOn,
  scaleAtSpherex: copy.sky.riding.scaleAtSpherex,
  scaleAtEarth: copy.sky.riding.scaleAtEarth,
  earth: copy.sky.riding.earth,
};
sky.onSelect = (id) => void go(id as TargetId);
// Anywhere else on the sky is real and clickable: a tap opens a look at that spot (near a
// wanderer, its show), the same as typing the position.
sky.onSkyTap = (at) => {
  // N7: on the tour's last step, a click on the sky is the visitor taking over. The tour ends
  // into that spot, and focus goes to where they landed (Viewer). A drag isn't a click (sky.ts).
  const fromTour = state.room === 'learn' && TOUR_TRY[tourStep] === 'sky';
  if (fromTour) {
    endTour();
    focusLandingUntil = performance.now() + 15000;
  }
  const near = WANDERERS.find((w) => w.ready && separationDeg(w.at, at) < NEAR_WANDERER_DEG);
  if (near) void go(near.id);
  else void openLook(at);
};
/* ---------- a star the mouse rests on: name, visible brightness, when SPHEREx photographed it ---------- */
const starTip = h('div', { class: 'star-tip', hidden: true, 'aria-hidden': 'true' });
document.body.append(starTip);
let starTipSeq = 0;
// Mouse only (touch keeps tap = look), on the sky, not during a Surprise flight.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
sky.starTipsAllowed = () => finePointer.matches && state.place.kind === 'sky' && !surpriseFlight;
// Stars are moved to today when the catalogue loads, so a star's own place is today's.
sky.onStarTap = (at) => sky.onSkyTap(at);
sky.onStarRest = (s) => {
  const seq = ++starTipSeq;
  if (!s) {
    starTip.hidden = true;
    return;
  }
  const t = copy.sky.starTip;
  const passes = h('span', { class: 'star-tip-passes' }, t.checking);
  starTip.replaceChildren(
    ...[
      h('strong', {}, s.name ?? t.unnamed(s.hip)),
      s.name ? h('span', { class: 'star-tip-hip' }, t.hip(s.hip)) : null,
      h('span', {}, t.brightness(s.v.toFixed(1))),
      passes,
      h('span', { class: 'star-tip-click' }, t.click),
    ].filter((x): x is HTMLElement => x !== null),
  );
  // Beside the star, never on it; flipped to its left near the right edge or the search column.
  starTip.hidden = false;
  starTip.style.left = '0px';
  starTip.style.top = '0px';
  const w = starTip.offsetWidth;
  const ht = starTip.offsetHeight;
  const column = document.querySelector('.words')?.getBoundingClientRect();
  let x = s.x + 14;
  let y = s.y - ht - 10;
  if (y < 64) y = s.y + 14;
  const hits = (bx: number) =>
    !!column &&
    column.width > 0 &&
    bx < column.right &&
    bx + w > column.left &&
    y < column.bottom &&
    y + ht > column.top;
  if (x + w > innerWidth - 8 || hits(x)) x = s.x - 14 - w;
  starTip.style.left = `${Math.max(8, x)}px`;
  starTip.style.top = `${Math.min(innerHeight - ht - 8, y)}px`;
  // "checking…" for at most a second; the dates fill in when the sky index answers (tiles are
  // cached), and a failure leaves the line out rather than showing an error.
  const giveUp = window.setTimeout(() => {
    if (seq === starTipSeq && passes.textContent === t.checking) passes.remove();
  }, 1000);
  findPhotos(s.at)
    .then((photos) => {
      if (seq !== starTipSeq) return;
      passes.textContent = photos.length ? t.passes(passesText(photos.map((p) => p.mjd))) : t.none;
      if (!passes.isConnected) starTip.insertBefore(passes, starTip.lastChild);
    })
    .catch(() => {
      if (seq === starTipSeq) passes.remove();
    })
    .finally(() => window.clearTimeout(giveUp));
};

sky.setLanterns(lanterns);
locator.setLanterns(lanterns.map((l) => ({ ...l, label: '' })));
/** Hipparcos places are for J1991.25. */
const HIPPARCOS_EPOCH = 1991.25;
void fetch(`${import.meta.env.BASE_URL}catalog/bright-stars-v9.json`)
  .then((r) => r.json() as Promise<{ stars: CatalogueStar[] }>)
  .then((c) => {
    // Every star at today's place, once: Hipparcos places are for J1991.25, and the bright,
    // nearby stars move most (Arcturus ~80″ since then), which shows at the close-up's 4′. The
    // dots, figures, names, tips and clicks then all agree (Viewer, 14 Nov). The proper
    // motions are spent here, so they're zeroed.
    c.stars = c.stars.map(([ra, dec, v, bv, hip, pa, pd]): CatalogueStar => {
      const p = placeAt({ ra, dec }, pa ?? 0, pd ?? 0, HIPPARCOS_EPOCH, NOW_YEAR);
      return hip === undefined ? [p.ra, p.dec, v, bv] : [p.ra, p.dec, v, bv, hip, 0, 0];
    });
    sky.setStars(c.stars);
    locator.setStars(c.stars);
    catalogueStars = c.stars;
    indexStarNames();
    return loadFigures(c.stars);
  })
  .then((figures) => {
    sky.setFigures(figures);
    figureLabels = figures.flatMap((f) => (f.labels[0] ? [{ name: f.name, at: f.labels[0] }] : []));
    rebuildSearchIndex();
  })
  .catch(() => undefined);

void fetch(`${import.meta.env.BASE_URL}catalog/milkyway-gaia-dr3-n64.bin`)
  .then((r) => r.arrayBuffer())
  .then((bin) => sky.setGlow(parseGlow(bin)))
  .catch(() => undefined);

/** Constellation figures from their HIP pairs, placed with the catalogue's own positions. */
async function loadFigures(stars: CatalogueStar[]): Promise<Figure[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}catalog/constellations-modern.json`);
  const file = (await res.json()) as {
    figures: { name: string; label_radec_deg: [number, number][]; hip_pairs: [number, number][] }[];
  };
  const at = new Map<number, { ra: number; dec: number }>();
  for (const [ra, dec, , , hip] of stars) if (hip !== undefined) at.set(hip, { ra, dec });
  return file.figures.map((f) => ({
    name: f.name,
    labels: f.label_radec_deg.map(([ra, dec]) => ({ ra: ((ra % 360) + 360) % 360, dec })),
    segments: f.hip_pairs.flatMap(([a, b]) => {
      const p = at.get(a);
      const q = at.get(b);
      return p && q ? [[p, q] as [typeof p, typeof q]] : [];
    }),
  }));
}
void fetch(`${import.meta.env.BASE_URL}catalog/star-names-iau.json`)
  .then((r) => r.json() as Promise<{ hip_to_name: Record<string, { name_diacritics: string }> }>)
  .then((n) => {
    starNames = new Map(
      Object.entries(n.hip_to_name).map(([hip, v]) => [Number(hip), v.name_diacritics]),
    );
    sky.setNames(starNames);
    indexStarNames();
    rebuildSearchIndex();
  })
  .catch(() => undefined);

/* ---------- names in the search box: the five by any common name, and the IAU-named stars ---------- */

let catalogueStars: CatalogueStar[] = [];

/* ---------- fainter stars when zoomed in: Gaia DR3 by sky patch (src/app/deepStars.ts) ---------- */
type DeepMark = [number, number, number, number | null];
const deepPatches = new Map<string, DeepMark[] | 'pending' | 'failed'>();
let deepQueue: Patch[] = [];
let deepRunning = 0;
let deepWanted: Patch[] = [];
let deepViewKey = '';
/** Hipparcos stars by 18″ cell, so a Gaia star already drawn isn't drawn twice. */
let hipCells: Map<string, [number, number][]> | null = null;
const cellOf = (ra: number, dec: number) => `${Math.round(ra * 200)},${Math.round(dec * 200)}`;

function isHipparcosStar(ra: number, dec: number): boolean {
  if (!hipCells) {
    hipCells = new Map();
    for (const [sra, sdec] of catalogueStars) {
      const k = cellOf(sra, sdec);
      const list = hipCells.get(k) ?? [];
      list.push([sra, sdec]);
      hipCells.set(k, list);
    }
  }
  const [cr, cd] = [Math.round(ra * 200), Math.round(dec * 200)];
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const [sra, sdec] of hipCells.get(`${cr + i},${cd + j}`) ?? [])
        if (separationDeg({ ra, dec }, { ra: sra, dec: sdec }) < 4 / 3600) return true;
  return false;
}

function deepKey(p: Patch): string {
  return `${p.tier.order}/${p.pix}`;
}

function pumpDeep(): void {
  const base = helperAddress();
  if (!base) return;
  while (deepRunning < 6 && deepQueue.length) {
    const p = deepQueue.shift();
    if (!p) break;
    const key = deepKey(p);
    if (deepPatches.has(key)) continue;
    deepPatches.set(key, 'pending');
    deepRunning++;
    fetch(`${base}/v1/gaiapatch?order=${p.tier.order}&pix=${p.pix}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { stars: [number, number, number, number | null, number, number][] }) => {
        const marks = d.stars
          .map((row) => deepMark(row, NOW_YEAR))
          // Never a Hipparcos star twice, at any tier: a bright star with a poor Gaia magnitude
          // could land in a fainter tier (Viewer, 14 Nov). Stars Gaia gives no motion (its
          // 2-parameter solutions) keep their 2016 place: the helper sends 0 for them.
          .filter((m) => !isHipparcosStar(m[0], m[1]));
        deepPatches.set(key, marks);
      })
      // ESA's archive is slow at times: a patch that fails is simply not drawn, and asked again
      // on a later view (Viewer: fail quietly).
      .catch(() => deepPatches.set(key, 'failed'))
      .finally(() => {
        deepRunning--;
        showDeep();
        pumpDeep();
      });
  }
}

function showDeep(): void {
  const out: DeepMark[] = [];
  for (const p of deepWanted) {
    const got = deepPatches.get(deepKey(p));
    if (Array.isArray(got)) for (const m of got) out.push(m);
  }
  sky.setDeepStars(out);
}

/** Every half second: the patches this view needs, fetched in view order, six at a time. */
function followDeep(): void {
  const v = sky.viewNow();
  const step = Math.max(0.01, v.fov / 10);
  const key =
    v.inside && v.fov <= DEEP_MAX_FOV
      ? `${Math.round(v.centre.ra / step)},${Math.round(v.centre.dec / step)},${Math.round(Math.log(v.fov) * 20)}`
      : 'off';
  if (key === deepViewKey) return;
  deepViewKey = key;
  deepWanted = patchesForView(v);
  // A failed patch is tried again when it's wanted again; keep the cache to ~800 patches.
  for (const p of deepWanted)
    if (deepPatches.get(deepKey(p)) === 'failed') deepPatches.delete(deepKey(p));
  if (deepPatches.size > 800)
    for (const k of [...deepPatches.keys()].slice(0, deepPatches.size - 800)) deepPatches.delete(k);
  // Coarse tiers first (they hold the brighter stars and are few), then the rest.
  deepQueue = deepWanted.filter((p) => !deepPatches.has(deepKey(p)));
  showDeep();
  pumpDeep();
}
sky.deepNote = copy.sky.gaiaNote;
window.setInterval(followDeep, 500);
let starNames = new Map<number, string>();
/** Search key (lower case, no accents or punctuation) → catalogue position (epoch J1991.25). */
const namedStars = new Map<string, SkyPosition>();

const searchKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ε/g, 'epsilon')
    .replace(/[^a-z0-9+-]/g, '');

/** What people call the five, so "Barnard's Star" or "eps Ind B" finds them like a position. */
const WANDERER_NAMES: Record<TargetId, string[]> = {
  barnard: ["Barnard's Star", 'Barnard', 'Barnards star', 'GJ 699', 'HIP 87937', 'BD+04 3561a'],
  w0855: [
    'WISE 0855',
    'W0855',
    'WISE 0855-0714',
    'WISE J0855',
    'WISE J0855-0714',
    'WISE J0855−0714',
    'WISE J085510.83-071442.5',
    'WISE J085510.83−071442.5',
  ],
  'epsind-b': [
    'Epsilon Indi B',
    'eps Ind B',
    'eps Indi B',
    'ε Indi B',
    'Epsilon Indi Ba',
    'Epsilon Indi Bb',
  ],
  'rw-aur': ['RW Aurigae', 'RW Aur'],
  'r-dra': ['R Draconis', 'R Dra'],
};
const wandererByName = new Map<string, TargetId>(
  Object.entries(WANDERER_NAMES).flatMap(([id, names]) =>
    names.map((n) => [searchKey(n), id as TargetId] as const),
  ),
);

function indexStarNames(): void {
  if (!catalogueStars.length || !starNames.size) return;
  for (const [ra, dec, , , hip] of catalogueStars) {
    const name = hip === undefined ? undefined : starNames.get(hip);
    if (name) namedStars.set(searchKey(name), { ra, dec });
  }
}

/* ---------- the sky answers the page, and the page the sky ---------- */

sky.onHover = (id) => {
  for (const c of band.querySelectorAll<HTMLElement>('.card'))
    c.classList.toggle('lit', c.dataset['id'] === id);
};
sky.onTurn = ({ near, narrowest, onLight }) => {
  const w = onLight && WANDERERS.find((x) => x.id === onLight);
  const caption =
    narrowest && w
      ? (touchOnly ? copy.sky.tapToOpen : copy.sky.scrollToOpen)(copy.wanderers[w.id].name)
      : narrowest
        ? touchOnly
          ? copy.sky.nothingHereTouch
          : copy.sky.nothingHere
        : near
          ? near.sepDeg <= NEAR_DEG
            ? copy.sky.lookingNear(near.name)
            : copy.sky.nearestNamed(near.name)
          : '';
  // Drawn on the sky beside the aim; the hidden element still announces it.
  focusCaption.textContent = caption;
  sky.caption = caption;
  requestAnimationFrame(() => sky.draw());
};

/** Touch screens have no scroll wheel or Shift key, so the hints say so. */
const touchOnly = matchMedia('(hover: none)').matches;

/* ---------- one zoom from the flat map into Look around ---------- */

/** Zooming far into the flat map hands over to Look around, at the same spot. */
sky.onHandOver = (_to, under) => {
  const at = under ?? sky.lookCentre();
  lookedInside = true;
  switchEntry('inside');
  sky.centreOn(at);
  sky.setFov(70);
};

/** The latest SPHEREx photo of a spot, MJD, from the sky index (null if none or offline). */
async function latestPhotoMjd(at: SkyPosition): Promise<number | null> {
  try {
    const last = (await findPhotos(at)).reduce((m, p) => Math.max(m, p.mjd), -Infinity);
    return Number.isFinite(last) ? last : null;
  } catch {
    return null;
  }
}
// Looking around yourself: the sky moves to when SPHEREx photographed the spot looked at.
sky.onSettle = (at) => {
  void latestPhotoMjd(at).then((mjd) => sky.setLookDate(mjd));
  // The aim's coordinates are drawn under the caption; announce them once the view settles.
  focusCaption.textContent = [sky.caption, positionText(at, sky.centre.fov)]
    .filter(Boolean)
    .join('. ');
};

/**
 * A short cross-fade from the sky as it was to the sky as it is, so changing view at the
 * same spot reads as one continuous zoom rather than a jump.
 */
function crossFade(quick = false): void {
  if ((prefersReducedMotion() && !quick) || state.place.kind !== 'sky') return;
  const still = h('canvas', {
    class: quick ? 'backdrop sky-fade quick' : 'backdrop sky-fade',
    width: skyCanvas.width,
    height: skyCanvas.height,
    'aria-hidden': 'true',
  });
  still.getContext('2d')?.drawImage(skyCanvas, 0, 0);
  skyCanvas.after(still);
  requestAnimationFrame(() => still.classList.add('gone'));
  still.addEventListener('transitionend', () => still.remove(), { once: true });
  setTimeout(() => still.remove(), 1000);
}

/** Which view button is lit: "From space" once stepped out of Look around. */
function markEntry(): void {
  const out = state.entry === 'inside' && sky.steppedOut;
  for (const b of entrySwitch.querySelectorAll<HTMLElement>('button[data-entry]'))
    b.setAttribute('aria-pressed', String(!out && b.dataset['entry'] === state.entry));
  spaceButton.setAttribute('aria-pressed', String(out));
}
sky.onStepped = () => {
  markEntry();
  markRide();
};

function switchEntry(entry: Entry, fade = true): void {
  if (fade) crossFade();
  dispatch({ type: 'setEntry', entry });
  render();
  placeSky(entry);
  writeUrl();
}

/** Leaves a show for the sky; from the inside view, aimed at the light just left. */
function leaveShow(): void {
  typedNote = null;
  const target = 'target' in state.place ? state.place.target : null;
  const lookedAt = live?.at ?? null;
  stopReveal?.();
  stopLook();
  current = null;
  dropDifference();
  endSpot(false);
  dispatch({ type: 'backToSky' });
  // A ride from here starts at the moment SPHEREx photographed this target.
  if (target) void rideTimeline(target);
  writeUrl();
  if (state.entry === 'inside') {
    const w = WANDERERS.find((x) => x.id === target);
    const aim = w?.at ?? lookedAt;
    if (aim) sky.centreOn(aim);
    sky.setFov(8);
  }
}
// Scrolling out of the lens is the same zoom, one rung up: back into the sky.
lensCanvas.addEventListener(
  'wheel',
  (e) => {
    if (state.place.kind === 'sky' || e.deltaY <= 0) return;
    e.preventDefault();
    if (state.entry !== 'inside') switchEntry('inside');
    leaveShow();
  },
  { passive: false },
);

/* ---------- packs: prefetched on load, so opening a wanderer is instant ---------- */

async function getPack(id: TargetId): Promise<LoadedPack> {
  const cached = packs.get(id);
  if (cached) return cached;
  // Newest release first; an older pack only while the new one isn't published.
  let last: unknown = null;
  for (const release of PACK_RELEASES) {
    try {
      const p = await loadPack(release, id);
      packs.set(id, p);
      return p;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(`no pack for ${id}`);
}
for (const w of WANDERERS) {
  if (w.ready)
    void getPack(w.id)
      .then(() => {
        // Once its pack says whether a move was measured, the lantern takes its hue.
        const l = lanterns.find((x) => x.id === w.id);
        // Ember for any measurement: a move, or a brightness change.
        if (l) l.measured = ['measured', 'brightness'].includes(caseStatus(w.id) ?? '');
        sky.setLanterns(lanterns);
        render();
      })
      .catch(() => undefined);
}

/* ---------- search: a typed position near a wanderer opens its case ---------- */

/** Said in the summary when the visitor typed where a mover used to be. */
/** Whether the arrival note's path figure is open (in Compare's body). */
let pathShown = false;
let typedNote: {
  id: TargetId;
  text: string;
  /** Where the visitor typed, and the year the wanderer was there: for the path figure. */
  path?: { typed: SkyPosition; year: number };
} | null = null;
/** An angle for people: arcminutes from one, else arcseconds. */
function angleText(arcsec: number): string {
  return arcsec >= 60 ? `${(arcsec / 60).toFixed(1)}′` : `${Math.round(arcsec)}″`;
}

// Open the connections a live look will use while the visitor is still typing (once a page).
search.addEventListener('focus', warmUp, { once: true });

/* ---------- search as you type (Sumit, 14 Nov; agreed with Viewer) ---------- */

/** The active option's spot (before Enter): the band's sixth row and the sky's spot lines. */
let typed: {
  key: string;
  at: SkyPosition;
  name: string | null;
  mjds: number[] | null;
  failed: boolean;
} | null = null;
let typedSeq = 0;
let lastFlown = '';
let followTimer = 0;

/** Every name the page knows, rebuilt as each source arrives (the five, surprises, stars, figures). */
let searchIndex: SearchEntry[] = [];
let surpriseList: SurpriseSpot[] = [];
let figureLabels: { name: string; at: SkyPosition }[] = [];
function rebuildSearchIndex(): void {
  const five: SearchEntry[] = WANDERERS.map((w) => ({
    id: w.id,
    name: copy.wanderers[w.id].name,
    names: [copy.wanderers[w.id].name, ...WANDERER_NAMES[w.id]],
    kind: 'test',
    at: w.at,
  }));
  const spots: SearchEntry[] = surpriseList.map((x) => ({
    id: `surprise:${x.name}`,
    name: x.name,
    names: [x.name],
    kind: 'surprise',
    at: { ra: x.ra, dec: x.dec },
  }));
  const stars: SearchEntry[] = [];
  for (const [ra, dec, v, , hip] of catalogueStars) {
    const name = hip === undefined ? undefined : starNames.get(hip);
    if (name)
      stars.push({ id: `hip:${hip}`, name, names: [name], kind: 'star', at: { ra, dec }, mag: v });
  }
  const figs: SearchEntry[] = figureLabels.map((f) => ({
    id: `con:${f.name}`,
    name: f.name,
    names: [f.name],
    kind: 'constellation',
    at: f.at,
  }));
  // Dwarf planets move a degree or more a year, so they open "Why a far planet loops", not a spot.
  const pages: SearchEntry[] = [
    {
      id: 'page:makemake',
      name: 'Makemake',
      names: ['Makemake', '136472'],
      kind: 'page',
      at: { ra: 199.3, dec: 21.9 },
    },
    {
      id: 'page:haumea',
      name: 'Haumea',
      names: ['Haumea', '136108'],
      kind: 'page',
      at: { ra: 220.3, dec: 14.2 },
    },
  ];
  searchIndex = [...five, ...spots, ...stars, ...figs, ...pages];
}
// After the whole module has run (loadSurprises' cache is declared further down).
queueMicrotask(
  () =>
    void loadSurprises().then((list) => {
      surpriseList = list;
      rebuildSearchIndex();
    }),
);

/** SIMBAD's answer for a name (through the helper), cached per name for the page's life. */
type Resolved = {
  found: boolean;
  name?: string;
  type?: string | null;
  ra?: number;
  dec?: number;
  pmra?: number | null;
  pmdec?: number | null;
};
const simbadCache = new Map<string, Resolved | 'failed'>();
let simbadPending: { key: string; abort: AbortController; done: Promise<void> } | null = null;
let simbadTimer = 0;
function lookUp(q: string): void {
  const key = normalise(q);
  if (simbadCache.has(key) || simbadPending?.key === key) return;
  simbadPending?.abort.abort();
  const abort = new AbortController();
  const done = fetch(`${helperAddress()}/v1/resolve?name=${encodeURIComponent(q.trim())}&v=2`, {
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]),
  })
    .then((r) =>
      r.ok ? (r.json() as Promise<Resolved>) : Promise.reject(new Error(String(r.status))),
    )
    .then((r) => void simbadCache.set(key, r))
    .catch(() => {
      if (!abort.signal.aborted) simbadCache.set(key, 'failed');
    })
    .finally(() => {
      if (simbadPending?.key === key) simbadPending = null;
      if (normalise(search.value) === key) refreshOptions();
    });
  simbadPending = { key, abort, done };
}

/** Today's place for a SIMBAD answer: moved from 2000 by its proper motion when it has one. */
const NOW_YEAR = 2000 + (Date.now() / 86_400_000 - 10957.5) / 365.25;
function simbadPlace(r: Resolved): { at: SkyPosition; moved: boolean } {
  const at = { ra: r.ra ?? 0, dec: r.dec ?? 0 };
  if (r.pmra == null || r.pmdec == null) return { at, moved: false };
  return { at: placeAt(at, r.pmra, r.pmdec, 2000, NOW_YEAR), moved: true };
}

/** Coordinates, not a name: digits first, and only h/d/m/s and symbols besides (not "M31"). */
const looksLikeCoordinates = (q: string) => {
  const t = q.replace(/(^|[\s,(])(ra|dec|α|δ)\s*[:=]?/gi, ' ').trim();
  return /^[+\-−]?\d/.test(t) && /^[\d\s:+\-−.,°′″'"hdms]+$/i.test(t);
};

type Opt = ComboOption & { at?: SkyPosition; title?: string; packOf?: TargetId; go: () => void };
const awayText = (deg: number) => (deg >= 1 ? `${deg.toFixed(1)}°` : angleText(deg * 3600));

function entryOpt(e: SearchEntry, group?: string, away?: number): Opt {
  const f = copy.home.find;
  const spot =
    e.kind === 'surprise' ? surpriseList.find((x) => `surprise:${x.name}` === e.id) : undefined;
  const tag =
    e.kind === 'test'
      ? f.tags.test
      : e.kind === 'surprise'
        ? spot?.kind === 'variable'
          ? f.tags.variable
          : f.tags.mover
        : e.kind === 'star'
          ? f.tags.star
          : e.kind === 'page'
            ? f.tags.page
            : f.tags.constellation;
  const meta =
    e.kind === 'test'
      ? f.testMeta(copy.wanderers[e.id as TargetId].short)
      : e.kind === 'surprise'
        ? spot?.kind === 'variable'
          ? f.variableMeta
          : f.moverMeta(String(Math.round((spot?.pmArcsecYr ?? 0) * 10) / 10))
        : e.kind === 'star'
          ? f.starMeta(positionText(e.at, 60))
          : e.kind === 'page'
            ? f.pageMeta
            : f.constellationMeta;
  return {
    id: e.id,
    label: e.name,
    tag,
    meta: away !== undefined ? f.nearMeta(awayText(away), meta) : meta,
    ...(group ? { group } : {}),
    ...(e.kind !== 'constellation' && e.kind !== 'page' ? { at: e.at } : {}),
    title: e.name,
    ...(e.kind === 'test' ? { packOf: e.id as TargetId } : {}),
    go: () => goEntryOpt(e, spot),
  };
}

function goEntryOpt(e: SearchEntry, spot?: SurpriseSpot): void {
  searchNote = '';
  typedNote = null;
  if (e.kind === 'page') {
    location.href = 'loop.html';
    return;
  }
  if (e.kind === 'test') void openWanderer(e.id as TargetId);
  else if (e.kind === 'surprise' && spot) void openLook({ ra: spot.ra, dec: spot.dec }, spot);
  else if (e.kind === 'constellation') {
    // A constellation is a region, not a spot to look at: show it on the sky.
    if (state.place.kind !== 'sky') leaveShow();
    if (state.entry !== 'inside') switchEntry('inside');
    void sky.flyTo(e.at, 45, prefersReducedMotion() ? 0 : 1200);
  } else {
    // A named star: today's place from SIMBAD (its motion applied), else its Hipparcos place.
    void (async () => {
      const key = normalise(e.name);
      if (!simbadCache.has(key)) {
        lookUp(e.name);
        await Promise.race([simbadPending?.done, new Promise((r) => setTimeout(r, 1500))]);
      }
      const r = simbadCache.get(key);
      void openLook(r && r !== 'failed' && r.found ? simbadPlace(r).at : e.at);
    })();
  }
}

function buildOptions(q: string): { opts: Opt[]; footer: string } {
  const f = copy.home.find;
  const t = q.trim();
  if (!t) {
    // Empty: the challenge's five, each with its status (they were the strip's rows before the
    // strip moved to Learn; Viewer, 14 Nov), then a typed position and one more star to try.
    const ex = copy.home.examples;
    const opts: Opt[] = [];
    for (const wd of WANDERERS) {
      const e = searchIndex.find((x) => x.id === wd.id);
      if (!e) continue;
      opts.push({ ...entryOpt(e, f.fiveGroup), id: `five:${wd.id}`, tag: fiveStatus(wd.id) });
    }
    const w = searchIndex.find((e) => e.id === 'w0855');
    const tg = searchIndex.find((e) => e.name === ex.teegardenName);
    if (w)
      opts.push({
        id: 'try:w0855',
        label: ex.w0855,
        tag: f.tags.position,
        meta: ex.w0855Value,
        group: f.tryGroup,
        at: w.at,
        title: w.name,
        packOf: 'w0855',
        go: () => {
          search.value = ex.w0855Value;
          submitSearch();
        },
      });
    if (tg) opts.push({ ...entryOpt(tg, f.tryGroup), id: 'try:teegarden' });
    return { opts, footer: f.footer };
  }
  if (looksLikeCoordinates(t)) {
    const parsed = parseSkyPosition(t);
    if (!parsed.ok)
      return {
        opts: [
          {
            id: 'note:coords',
            label: /expected/.test(parsed.reason)
              ? f.keepTyping
              : copy.search.unreadable(parsed.reason),
            note: true,
            go: () => undefined,
          },
        ],
        footer: f.footer,
      };
    const at = parsed.position;
    const near = WANDERERS.find((x) => separationDeg(x.at, at) < NEAR_WANDERER_DEG);
    const past = near ? pastPlace(near, at) : null;
    const name = near ? copy.wanderers[near.id].name : null;
    const moved = past ? angleText(past.movedArcsec) : null;
    const first: Opt = {
      id: `pos:${at.ra.toFixed(5)},${at.dec.toFixed(5)}`,
      label: positionText(at),
      tag: f.tags.position,
      meta:
        near && name
          ? past && moved
            ? copy.home.echoPast(name, Math.floor(past.year + 0.05), moved)
            : copy.home.echoNear(name)
          : `${degText(at.ra)}, ${degText(at.dec)} · ${f.positionMeta}`,
      at: near?.at ?? at,
      title: near && name ? (moved ? copy.home.spotMoved(name, moved) : name) : copy.home.spotTitle,
      ...(near ? { packOf: near.id } : {}),
      go: submitSearch,
    };
    const around = nearby(searchIndex, at, 3, 4, near?.id).filter(
      (n) => n.entry.kind !== 'surprise' || n.sepDeg <= 1,
    );
    return {
      opts: [first, ...around.map((n) => entryOpt(n.entry, f.nearGroup, n.sepDeg))],
      footer: '',
    };
  }
  const matches = searchNames(searchIndex, t, 6);
  const local = matches.map((m) => entryOpt(m.entry));
  const opts: Opt[] = [...local];
  // Beyond our own names: SIMBAD, after 3 letters, when few local matches, debounced, and never
  // when a local name already answers (exactly or as its start) or one of the five does: the
  // typed text goes to CDS only for names the page doesn't know (Viewer; our credits say so).
  const answered = matches.some((m) => m.base >= 700 || m.entry.kind === 'test');
  if (t.length >= 3 && local.length < 3 && !answered) {
    const r = simbadCache.get(normalise(t));
    if (!helperAddress())
      opts.push({ id: 'note:nohelper', label: f.noHelper, note: true, go: () => undefined });
    else if (r === undefined) {
      opts.push({ id: 'note:looking', label: f.looking(t), note: true, go: () => undefined });
      window.clearTimeout(simbadTimer);
      simbadTimer = window.setTimeout(() => lookUp(t), 300);
    } else if (r === 'failed')
      opts.push({ id: 'note:failed', label: f.failed, note: true, go: () => undefined });
    else if (!r.found) {
      if (!local.length)
        opts.push({ id: 'note:none', label: f.notFound(t), note: true, go: () => undefined });
    } else if (
      // The same object as a local result (within 1′): don't list it twice.
      !local.some(
        (o) => o.at && r.ra !== undefined && separationDeg(o.at, simbadPlace(r).at) < 1 / 60,
      )
    ) {
      const { at, moved } = simbadPlace(r);
      opts.push({
        id: `simbad:${normalise(r.name ?? t)}`,
        label: r.name ?? t,
        tag: f.tags.simbad,
        meta: [
          f.simbadMeta(r.type ? (f.types[r.type] ?? f.otherType) : f.otherType, moved),
          ...WANDERERS.filter((w) => separationDeg(w.at, at) < 0.25).map((w) =>
            f.nearFive(copy.wanderers[w.id].name, awayText(separationDeg(w.at, at))),
          ),
        ].join(' · '),
        at,
        title: r.name ?? t,
        go: () => {
          searchNote = '';
          typedNote = null;
          void openLook(at);
        },
      });
    }
  }
  return { opts, footer: '' };
}

/** One of the five's status in the status vocabulary ("moved, measured", "fainter, measured"…). */
function fiveStatus(id: TargetId): string {
  const status = caseStatus(id);
  if (!status) return copy.home.find.tags.test;
  if (status === 'brightness')
    return cardChip(id, status)?.textContent || copy.statusChip.brightness;
  return copy.statusChip[status];
}

function refreshOptions(): void {
  const { opts, footer } = buildOptions(search.value);
  combo.setOptions(withPasses(opts), footer);
}

/**
 * When SPHEREx photographed a spot, by pass: "3 passes (Sep 2025, Mar 2026, Sep 2026)". The
 * months only when each pass has one start (a deep field's long continuous run counts as
 * several passes by Physics' rule, and one month would not name them).
 */
function passesText(mjds: number[]): string {
  const n = passCount(mjds);
  const starts = passStarts(mjds);
  return starts.length === n && n > 0
    ? copy.look.passesWhen(n, starts.map(shortMonth).join(', '))
    : copy.look.passes(n);
}

/** The followed option says when SPHEREx photographed it, once the sky index answers
 * (Viewer, 14 Nov: the most useful moment is before Enter; it was the strip's spot row). */
function withPasses(opts: Opt[]): Opt[] {
  const t = typed;
  if (!t || (!t.mjds && !t.failed)) return opts;
  const line = t.failed ? '' : t.mjds?.length ? passesText(t.mjds) : copy.home.find.notPhotographed;
  if (!line) return opts;
  return opts.map((o) =>
    o.at && `${o.at.ra.toFixed(4)},${o.at.dec.toFixed(4)}` === t.key
      ? { ...o, meta: o.meta ? `${o.meta} · ${line}` : line }
      : o,
  );
}

/** After the typed spot's photos arrive: the open list says so (never inside setOptions). */
function refreshPassesSoon(): void {
  queueMicrotask(() => {
    if (document.activeElement === search) refreshOptions();
  });
}

/** The sky and the band follow the active option (else the first): its spot lines and row now,
 * a short flight after a pause (Viewer: never on hover, not on phones, not under reduced motion). */
function followOpt(o: Opt | null): void {
  sky.setSpot(o?.at ?? null);
  if (!o?.at) {
    window.clearTimeout(followTimer);
    if (typed) {
      typed = null;
      typedSeq++;
      if (state.place.kind === 'sky') renderBand();
    }
    return;
  }
  const at = o.at;
  const key = `${at.ra.toFixed(4)},${at.dec.toFixed(4)}`;
  // The same spot again (the list re-rendered, e.g. a SIMBAD answer arrived): leave its pending
  // flight and lookup alone.
  if (typed?.key === key) return;
  window.clearTimeout(followTimer);
  typed = { key, at, name: o.title ?? null, mjds: null, failed: false };
  const seq = ++typedSeq;
  if (state.place.kind === 'sky') renderBand();
  // One of the five: the same photos as its row (its pack's), so the two counts agree.
  const own = o.packOf && bandData?.targets[o.packOf];
  if (own) {
    typed.mjds = own.map((f) => f[0]);
    if (state.place.kind === 'sky') renderBand();
    refreshPassesSoon();
  }
  followTimer = window.setTimeout(() => {
    flyToTyped(at, key);
    if (own) return;
    findPhotos(at)
      .then((photos) => {
        if (seq !== typedSeq || !typed) return;
        typed.mjds = photos.map((p) => p.mjd);
      })
      .catch(() => {
        if (seq === typedSeq && typed) typed.failed = true;
      })
      .finally(() => {
        if (seq !== typedSeq) return;
        if (state.place.kind === 'sky') renderBand();
        refreshPassesSoon();
      });
  }, 400);
}

/**
 * The sky turns to the active option before Enter: debounced, a short flight, never twice to
 * the same place, never on load, not on phones (the keyboard covers the sky), and not under
 * reduced motion.
 */
function flyToTyped(at: SkyPosition, key: string): void {
  if (key === lastFlown || prefersReducedMotion() || touchOnly) return;
  if (state.place.kind !== 'sky' || state.room !== 'play' || state.entry !== 'inside') return;
  if (sky.steppedOut) return;
  lastFlown = key;
  void sky.flyTo(at, 20, 600);
}

const combo = combobox(search, {
  query: () => refreshOptions(),
  active: (o) => followOpt((o as Opt | null) ?? null),
  choose: (o) => {
    const opt = o as Opt | null;
    // Only a SIMBAD lookup on the way: wait for it (about a second), then take its answer.
    if (!opt && simbadPending) {
      void Promise.race([simbadPending.done, new Promise((r) => setTimeout(r, 1200))]).then(() => {
        refreshOptions();
        const next = combo.current() as Opt | null;
        if (next) {
          combo.close();
          setTimeout(next.go, 0);
        }
      });
      return;
    }
    if (!opt || opt.note) return;
    combo.close();
    // The field gave up focus (so its list stays shut): land it on what opens, for keyboards.
    focusLandingUntil = performance.now() + 15000;
    visitorLeavesLearn();
    // Not inside the keydown: opening a look moves the field from the homepage column to the
    // header, and moving a focused field mid-event loses keys and autofill (Viewer, 14 Nov).
    setTimeout(opt.go, 0);
  },
  status: copy.home.find.count,
  labels: {
    field: copy.home.find.label,
    list: copy.home.find.results,
    hint: copy.home.find.footer,
  },
});
const searchBox = combo.el;

/** Opens what the field holds: one of the five, a named star, or a live look at a position. */
/** When the sky index was last updated after its first build (G3), or null. */
let indexUpdated: string | null = null;
void loadIndexMeta()
  .then((m) => {
    indexUpdated = m.updated ?? null;
    if (indexUpdated) render();
  })
  .catch(() => undefined);
const isoToMjd = (iso: string) => Date.parse(iso) / 86_400_000 + 40587;

/** A search is the visitor taking over: it leaves Learn like any other exit (Viewer, 15 Nov). */
function visitorLeavesLearn(): void {
  if (state.room === 'learn') dispatch({ type: 'setRoom', room: 'play' });
}

function submitSearch(): void {
  visitorLeavesLearn();
  // A name first: one of the five, or an IAU-named star (a look at its catalogue position).
  const key = searchKey(search.value);
  const wanderer = wandererByName.get(key);
  if (wanderer) {
    searchNote = '';
    void openWanderer(wanderer);
    return;
  }
  const star = namedStars.get(key);
  if (star) {
    searchNote = '';
    void openLook(star);
    return;
  }
  const parsed = parseSkyPosition(search.value);
  if (!parsed.ok) {
    searchNote = copy.search.unreadable(parsed.reason);
    render();
    return;
  }
  const near = WANDERERS.find((w) => separationDeg(w.at, parsed.position) < NEAR_WANDERER_DEG);
  searchNote = '';
  // A typed spot on a mover's past track: say when it was there and how far it has moved since
  // (the challenge's WISE 0855 coordinates are its 2010 place, 2.1′ from today's).
  typedNote = null;
  const past = near ? pastPlace(near, parsed.position) : null;
  if (near && past)
    typedNote = {
      id: near.id,
      text: copy.search.oldPlace(
        copy.wanderers[near.id].name,
        // A J2000 catalogue place (epoch 2000.0) falls at 1999.98 on the track: say 2000.
        Math.floor(past.year + 0.05),
        angleText(past.movedArcsec),
      ),
      path: { typed: parsed.position, year: past.year },
    };
  if (near?.ready) void openWanderer(near.id);
  else if (near) {
    searchNote = copy.search.wandererSoon(copy.wanderers[near.id].name);
    render();
  } else void openLook(parsed.position);
}
/** The close-up's field: 40 pack pixels of 6.15″. */
const CLOSE_UP_ARCSEC = 40 * 6.15;

/** "From your numbers to now": the wanderer's straight path from the typed year to today. */
function typedPathFigure(
  id: TargetId,
  path: { typed: SkyPosition; year: number } | undefined,
): HTMLElement | null {
  const w = WANDERERS.find((x) => x.id === id);
  if (!path || !w || !current) return null;
  const mjds = current.pack.manifest.frames.map((f) => f.mjd);
  const year = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;
  const t = copy.search.path;
  const name = copy.wanderers[id].name;
  const moved = Math.hypot(...Object.values(offsetAt(w, path.year)));
  const span: [number, number] = [year(Math.min(...mjds)), year(Math.max(...mjds))];
  // How far it moved while SPHEREx photographed it: between the first and the last photo.
  const p0 = offsetAt(w, span[0]);
  const p1 = offsetAt(w, span[1]);
  const inSpherex = Math.hypot(p1.east - p0.east, p1.north - p0.north);
  const fig = pastPathFigure({
    wanderer: w,
    typed: path.typed,
    year: path.year,
    spherex: span,
    closeUpArcsec: CLOSE_UP_ARCSEC,
    labels: {
      typed: t.typed,
      now: t.now,
      spherex: t.spherex(angleText(inSpherex)),
      closeUp: t.closeUp,
      north: t.north,
      east: t.east,
      scale: t.scale,
      alt: t.alt(
        name,
        Math.floor(path.year + 0.05),
        angleText(moved),
        motionDirection(w),
        angleText(Math.abs(inSpherex)),
      ),
    },
  });
  const source =
    current.show.kind === 'motion' && current.show.predictionSource
      ? // The drawing is straight motion only, so the prediction's "+ parallax" doesn't apply.
        predictionLabel(current.show.predictionSource).replace(/ \+ parallax$/, '')
      : t.catalogue;
  // ε Indi B's path is its companion's motion, not its own (B orbits A; Physics, 15 Nov).
  const sourceText = /Indi A/.test(source) ? t.companion : source;
  const ticks = trackTicks(path.year);
  const every = ticks.length > 1 ? (ticks[1] ?? 0) - (ticks[0] ?? 0) : WANDERER_EPOCH - path.year;
  return h(
    'figure',
    { class: 'past-path-fig' },
    fig,
    h('figcaption', { class: 'hint' }, t.caption(sourceText, Math.round(every))),
  );
}

/** The keys, in a native dialog (Esc closes it; focus returns to where it was). */
const keysDialog = h('dialog', { class: 'keys-dialog', 'aria-labelledby': 'keys-title' });
function openKeys(): void {
  if (keysDialog.open) {
    keysDialog.close();
    return;
  }
  const k = copy.keys;
  const close = h('button', { type: 'button' }, k.close);
  close.addEventListener('click', () => keysDialog.close());
  keysDialog.replaceChildren(
    h('h2', { id: 'keys-title' }, k.title),
    h(
      'dl',
      {},
      ...k.list.flatMap(([key, what]) => [h('dt', {}, h('kbd', {}, key)), h('dd', {}, what)]),
    ),
    schemeChoice(copy.scheme),
    h('div', { class: 'actions' }, close),
  );
  if (!keysDialog.isConnected) document.body.append(keysDialog);
  keysDialog.showModal();
}

/** The show's pair on the lens as it rests after the reveal: arrows full, look 2, its label. */
function restingPair(): void {
  if (!current) return;
  lens.setTiles(current.pair, sharedStretch(current.pair.map((t) => t.pixels)));
  lens.setOverlay({
    measured: current.show.kind === 'motion' ? current.show.measured : undefined,
    predicted: current.show.kind === 'motion' ? (current.show.predicted ?? undefined) : undefined,
  });
  showRevealStill(lens);
  showing = 1;
  setLensLabel(1, 8);
}

/**
 * Before an action takes the lens: finish the reveal (arrow at its full enlargement, not where
 * the animation was), and stop Watch's colour play, so no timer keeps drawing on top. True when
 * the show is ready for the action.
 */
function takeLens(): boolean {
  if (!current) return false;
  if (state.place.kind === 'reveal') {
    stopReveal?.();
    dispatch({ type: 'revealDone' });
    restingPair();
  }
  if (watching !== null || series) {
    stopReveal?.();
    watching = null;
    series = null;
    drawSeriesBar();
    restingPair();
  }
  return state.place.kind === 'ready';
}

/** ← → in a show: the first or second look on the lens (ending the reveal or a difference). */
function stepLook(index: 0 | 1): void {
  if (!takeLens() || !current) return;
  if (differencing) endDifference(false);
  // From a co-add picture (one tile) or the hold pair: the show's own pair first.
  restingPair();
  lens.show(index);
  showing = index;
  setLensLabel(index, 8);
  renderBand();
}
let liveShown = 0;

document.addEventListener('keydown', (e) => {
  if (keysDialog.open) return;
  if (e.key === '/' && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
    return;
  }
  if (e.key === 'Escape' && state.place.kind !== 'sky' && document.activeElement !== search) {
    leaveShow();
    return;
  }
  // The sky by keyboard: +/− zoom (through the same ladder as the wheel), arrows turn it.
  const typing = document.activeElement instanceof HTMLInputElement;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  // In a show, ← → step the series being watched.
  if (
    series &&
    (watching !== null || liveRange?.playing) &&
    (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  ) {
    series.step(e.key === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
    return;
  }
  if (e.key === '?') {
    openKeys();
    e.preventDefault();
    return;
  }
  // Arrows and letters mean nothing to a button, so they work after a click; only while typing
  // (a text field, a list, a slider) are they left alone.
  const free = !document.activeElement?.matches(
    'input, select, textarea, [contenteditable], [role="slider"]',
  );
  // While playing "Spot the mover", the arrows are the guesses: ↑ north, ← east (east is left).
  const guess: Record<string, Shift> = {
    ArrowUp: { east: 0, north: 2 },
    ArrowDown: { east: 0, north: -2 },
    ArrowLeft: { east: 2, north: 0 },
    ArrowRight: { east: -2, north: 0 },
  };
  if (free && spot?.state === 'playing' && guess[e.key]) {
    answerSpot(guess[e.key] ?? null);
    e.preventDefault();
    return;
  }
  if (free && current && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    stepLook(e.key === 'ArrowLeft' ? 0 : 1);
    e.preventDefault();
    return;
  }
  // In a series, D is "what changed".
  if (free && series && series.changed !== null && !e.repeat && (e.key === 'd' || e.key === 'D')) {
    series.toggleChanged();
    e.preventDefault();
    return;
  }
  if (free && current && !e.repeat && (e.key === 'd' || e.key === 'D')) {
    if (differencing) endDifference();
    else void showDifference();
    e.preventDefault();
    return;
  }
  // A live look: ← → step through its photos.
  if (
    free &&
    live?.done &&
    live.tiles.length &&
    (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  ) {
    stopReveal?.();
    const n = live.tiles.length;
    showLivePhoto((liveShown + (e.key === 'ArrowLeft' ? -1 : 1) + n) % n);
    e.preventDefault();
    return;
  }
  if (state.place.kind !== 'sky') return;
  const turn: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  if (e.key === '+' || e.key === '=') sky.zoomStep(1);
  else if (e.key === '-' || e.key === '_') sky.zoomStep(-1);
  else if (turn[e.key]) {
    const [dx, dy] = turn[e.key] ?? [0, 0];
    sky.nudge(dx, dy);
  } else return;
  e.preventDefault();
});

/* ---------- the show ---------- */

/** Opens a wanderer; from inside the sky, it first turns and zooms to look at it. */
async function go(id: TargetId): Promise<void> {
  const w = WANDERERS.find((x) => x.id === id);
  if (w && state.entry === 'inside' && state.place.kind === 'sky' && !prefersReducedMotion()) {
    await sky.flyTo(w.at, 12, 900);
  }
  await openWanderer(id);
}

async function openWanderer(id: TargetId): Promise<void> {
  if (typedNote?.id !== id) typedNote = null;
  stopReveal?.();
  watching = null;
  series = null;
  stopLook();
  dropDifference();
  endSpot(false);
  diffAllColours = false;
  colourShiftOn = false;
  colourRatioOn = false;
  lens.setOverlay({ contract: 'show', catalogue: null });
  dispatch({ type: 'tapLantern', target: id });
  writeUrl();
  let pack: LoadedPack;
  try {
    pack = await getPack(id);
  } catch {
    dispatch({ type: 'trouble', reason: 'pack-missing' });
    return;
  }
  // A pair from an old link may not exist in this pack: fall back to the pack's own.
  if (
    chosenPair.has(id) &&
    !stackPair(pack, 'all-colour', showFor(pack, chosenPair.get(id)).seasons)
  )
    chosenPair.delete(id);
  const show = showFor(pack, chosenPair.get(id));
  const pair = stackPair(pack, 'all-colour', show.seasons);
  if (!pair) {
    dispatch({ type: 'trouble', reason: 'pack-missing' });
    return;
  }
  current = { pack, show, pair };
  lens.setTiles(pair, sharedStretch(pair.map((t) => t.pixels)));
  lens.setOverlay({
    ringRadius: 3,
    // The ring is the contract: ember where a move was measured, mist where nothing was.
    contract: show.kind === 'motion' ? 'show' : 'status',
    measured: show.kind === 'motion' ? show.measured : undefined,
    predicted: show.kind === 'motion' ? (show.predicted ?? undefined) : undefined,
  });
  const w = WANDERERS.find((x) => x.id === id);
  if (w) {
    locator.setLanterns([
      { id: w.id, at: w.at, label: '', ready: true, measured: show.kind === 'motion' },
    ]);
    locator.frameWholeSky(w.at);
  }
  drawTrueScale(show);
  dispatch({ type: 'packReady' });
  startReveal();
}

function startReveal(): void {
  stopReveal?.();
  if (prefersReducedMotion()) {
    showRevealStill(lens);
    showing = 1;
    setLensLabel(1, 8);
    dispatch({ type: 'revealDone' });
    return;
  }
  stopReveal = playReveal(lens, {
    onStep: ({ season, arrowScale }) => {
      showing = season;
      setLensLabel(season, arrowScale);
      renderBand();
    },
    onDone: () => dispatch({ type: 'revealDone' }),
  });
}

/**
 * Under the lens, a two-state pill: which look is on screen, numbered as the dock's brackets.
 * The arrow's enlargement rides on its tip instead (×8), drawn by the lens.
 */
function setLensLabel(index: 0 | 1, arrowScale: number): void {
  const pill = h(
    'span',
    { class: 'look-pill', 'aria-label': lookName(index) },
    ...([0, 1] as const).flatMap((i) => [
      // Read as text, the two dates need a separator (Viewer); hidden on screen.
      i === 1 ? h('span', { class: 'visually-hidden' }, ' and ') : null,
      h(
        'span',
        { class: i === index ? 'on' : '' },
        h('b', {}, String(passNo(i))),
        ` ${lookMonth(i)}`,
      ),
    ]),
  );
  const parts: HTMLElement[] = [pill];
  if (current?.show.kind === 'motion' && arrowScale === 1)
    parts.push(h('span', { class: 'real-size' }, copy.show.arrowRealSize));
  lensLabel.replaceChildren(...parts);
}

/* ---------- a live look at any spot: the sky index, then two photos from the bucket ---------- */

/** The lens grid for live looks: the same size and scale as the packs'. */
/**
 * The live look's field of view (checklist C5): 4′, 8′ or 16′ across, at the packs' 6.15″
 * squares. Wider fields show faster movers but read more rows of each photo.
 */
const LOOK_FIELDS = [4, 8, 16] as const;
type LookField = (typeof LOOK_FIELDS)[number];
const SCALE_ARCSEC = 6.15;
const urlField = Number(new URLSearchParams(location.search).get('field'));
let lookField: LookField = (LOOK_FIELDS as readonly number[]).includes(urlField)
  ? (urlField as LookField)
  : 4;
const lookGrid = () => ({
  size: Math.round((lookField * 60) / SCALE_ARCSEC / 10) * 10,
  scaleArcsec: SCALE_ARCSEC,
});

/**
 * Bytes one photo costs at a grid size: through the cloud helper, its finished cutout (pixels
 * and flags); read from NASA directly, the image and flag rows (with room for a half-turn) plus
 * headers.
 */
function photoBytes(size: number): number {
  if (helperActive()) return size * size * 5 + 300;
  const rows = Math.ceil(size * Math.SQRT2) + 5;
  return rows * 8160 * 2 + 14_400;
}

/** "1.2 MB" or "40 kB": a cost shown on a button. */
function aboutSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

/** What a look costs at a field of view. */
function lookSize(photos: number, field: LookField): string {
  return aboutSize(photos * photoBytes(Math.round((field * 60) / SCALE_ARCSEC)));
}

/**
 * Photo reads and colour probes at once. Through the cloud helper each is one small request on
 * one shared connection, so many can go together; read from NASA directly, each photo splits
 * into 4–6 range requests and the browser allows ~6 connections per address, so a few.
 * Asked at the start of each phase, so a look that falls back mid-way slows down, not floods.
 */
const readsAtOnce = () => (helperActive() ? 24 : 3);
const probesAtOnce = () => (helperActive() ? 48 : 24);

/** Runs `fn` over `items`, at most `limit` at a time; a failed item is skipped, not fatal. */
async function eachLimited<T>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * DR1 + QR3 learns the colour at a spot only from each photo's own file, so: find every photo
 * of the spot in the sky index, probe a few per pass and detector for the colour they saw there
 * (headers and the wavelength table only, ~50 kB each), and plan the fair same-colour set from
 * those. The first two passes are probed first; the rest only if they hold no fair pair.
 */
/** What a look's colour choice needs again: every probed photo and the spot's pass facts. */
interface LookProbed {
  candidates: LiveCandidate<LivePhoto>[];
  meta: { total: number; firstMjd: number; lastMjd: number; seasons: number };
}

async function planLiveLook(
  at: SkyPosition,
  signal: AbortSignal,
  onProbe: (done: number, total: number, of: number) => void,
): Promise<{ plan: LookPlan<LivePhoto>; photos: LivePhoto[]; probed: LookProbed | null }> {
  const photos = await findPhotos(at);
  const probed: { value: LookProbed | null } = { value: null };
  const plan = await planFrom(photos, at, signal, onProbe, probed);
  return { plan, photos, probed: probed.value };
}

async function planFrom(
  photos: LivePhoto[],
  at: SkyPosition,
  signal: AbortSignal,
  onProbe: (done: number, total: number, of: number) => void,
  probed: { value: LookProbed | null } = { value: null },
): Promise<LookPlan<LivePhoto>> {
  if (!photos.length) return { kind: 'none' };
  const pass = passesOf(photos);
  const mjds = photos.map((p) => p.mjd);
  const meta = {
    total: photos.length,
    firstMjd: Math.min(...mjds),
    lastMjd: Math.max(...mjds),
    seasons: Math.max(...pass) + 1,
  };
  if (meta.seasons < 2) return { kind: 'one-season', ...meta };
  const candidates: LiveCandidate<LivePhoto>[] = [];
  // Read from NASA directly, probing stops early once a fair pair turns up: the look shows what
  // it has, sooner, but which pair depends on which probes answer first. Through the cloud
  // helper probes are cheap, so all the chosen ones run, and the same spot always gets the same
  // pair (a shared link shows what its sender saw).
  const enough = new AbortController();
  const stop = () => enough.abort();
  signal.addEventListener('abort', stop, { once: true });
  const thorough = helperActive();
  const probe = async (which: (p: number) => boolean) => {
    const idx = probeChoice(photos, pass).filter((i) => which(pass[i] ?? 0));
    let done = 0;
    onProbe(0, idx.length, photos.length);
    await eachLimited(idx, probesAtOnce(), async (i) => {
      const photo = photos[i];
      if (!photo || enough.signal.aborted) return;
      const pr = await probePhoto(photo, at, enough.signal).finally(() =>
        onProbe(++done, idx.length, photos.length),
      );
      if (!pr) return;
      candidates.push({
        id: photo.key,
        detector: photo.det as Detector,
        season: pass[i] ?? 0,
        mjd: photo.mjd,
        lambdaUm: pr.lambdaUm,
        colourUncertain: false,
        hit: photo,
      });
      if (!thorough && planCandidates(candidates, meta).kind === 'pair') stop();
    });
  };
  await probe((p) => p < 2);
  let plan = planCandidates(candidates, meta);
  if (plan.kind !== 'pair' && meta.seasons > 2 && !signal.aborted) {
    await probe((p) => p >= 2);
    plan = planCandidates(candidates, meta);
  }
  signal.removeEventListener('abort', stop);
  probed.value = { candidates, meta };
  return plan;
}

function stopLook(): void {
  live?.abort.abort();
  live?.spectrum?.abort.abort();
  if (liveRange) {
    liveRange.abort.abort();
    if (liveRange.playing) {
      stopReveal?.();
      series = null;
      drawSeriesBar();
    }
    liveRange = null;
  }
  live = null;
}

/* ---------- a live look's colour range, every photo in date order (the "little video") ---------- */

/** At most this many photos in a live colour-range series: evenly through time beyond it. */
const LIVE_RANGE_MAX = 80;

/** Every photo of the look's colour range (its fair pair's detector), read for "Play all". */
interface LiveRange {
  look: LiveLook;
  state: 'reading' | 'ready' | 'failed';
  done: number;
  total: number;
  frames: LiveFrame[];
  playing: boolean;
  abort: AbortController;
}
let liveRange: LiveRange | null = null;

/** The look's photos in its pair's detector, oldest first, thinned evenly to LIVE_RANGE_MAX. */
function rangePhotos(look: LiveLook): { photos: LivePhoto[]; of: number } {
  const plan = look.plan;
  if (plan?.kind !== 'pair') return { photos: [], of: 0 };
  const det = plan.pair.a.detector;
  const all = look.photos.filter((p) => p.det === det).sort((a, b) => a.mjd - b.mjd);
  if (all.length <= LIVE_RANGE_MAX) return { photos: all, of: all.length };
  const photos = Array.from(
    { length: LIVE_RANGE_MAX },
    (_, k) => all[Math.floor(((k + 0.5) * all.length) / LIVE_RANGE_MAX)] as LivePhoto,
  );
  return { photos, of: all.length };
}

/** Reads every photo of the colour range (each at its own wavelength), then plays them. */
async function startLiveRange(look: LiveLook): Promise<void> {
  const { photos } = rangePhotos(look);
  const job: LiveRange = {
    look,
    state: 'reading',
    done: 0,
    total: photos.length,
    frames: [],
    playing: false,
    abort: new AbortController(),
  };
  liveRange = job;
  render();
  const grid = lookGrid();
  await eachLimited(photos, readsAtOnce(), async (p) => {
    if (job.abort.signal.aborted) return;
    const f = await readPhoto(p, look.at, grid.size, grid.scaleArcsec, job.abort.signal).finally(
      () => {
        job.done++;
        const line = words.querySelector('.live-range .progress');
        if (line && liveRange === job)
          line.textContent = copy.look.range.reading(job.done, job.total);
      },
    );
    if (f) job.frames.push(f);
  });
  if (liveRange !== job || live !== look) return;
  job.frames.sort((a, b) => a.mjd - b.mjd);
  job.state = job.frames.length >= 2 ? 'ready' : 'failed';
  if (job.state === 'ready') watchLiveRange(job);
  else render();
}

/**
 * Plays the colour range in the lens like Watch does for the five: one shared stretch, hard
 * cuts at 2 per second, looping until paused; never on its own under reduced motion.
 */
function watchLiveRange(job: LiveRange): void {
  // The series takes the lens: colour by date ends (Viewer, 15 Nov).
  liveColouring = false;
  colouring = false;
  stopReveal?.();
  const frames = job.frames;
  job.playing = true;
  const play = runSeries({
    tiles: frames.map((f) => f.tile),
    film: frames.map((f) => ({
      tile: f.tile,
      mjd: f.mjd,
      lambdaUm: f.lambdaUm,
      bandwidthUm: f.bandwidthUm,
      detector: f.photo.det,
      // References at the same scan orientation cancel steady stars better (Physics' test).
      orientationDeg: f.photo.paDeg,
    })),
    label: (i) => {
      const f = frames[i];
      return f
        ? copy.watch.frame(i + 1, frames.length, dayMonthYear(f.mjd), fixed(f.lambdaUm))
        : '';
    },
  });
  render();
  // Known asteroids at each photo's own time.
  const grid = lookGrid();
  void moversOn(
    job.look.at,
    frames.map((f) => f.mjd),
    grid.size,
    grid.scaleArcsec,
    frames.map((f) => f.observerKm),
  ).then((marks) => {
    if (liveRange === job && job.playing && series === play && marks !== 'failed')
      play.setMovers(marks);
  });
}

/** Back from the colour range to the look's fair pair (its photos stay read, to play again). */
function leaveLiveRange(): void {
  const job = liveRange;
  if (!job?.playing) return;
  stopReveal?.();
  job.playing = false;
  series = null;
  drawSeriesBar();
  const look = job.look;
  if (live !== look || !look.stretch) return;
  lens.setTiles(look.tiles, look.stretch);
  if (Array.isArray(look.movers)) lens.setOverlay({ movers: look.movers });
  render();
  showLivePhoto(look.tiles.length - 1);
}

/** "Every photo in this colour range": a button with its size, progress, then the player. */
function liveRangeSection(look: LiveLook): HTMLElement | null {
  const c = copy.look.range;
  const { photos, of } = rangePhotos(look);
  // Only worth offering when it shows more than the look already does.
  if (photos.length <= look.tiles.length) return null;
  const job = liveRange?.look === look ? liveRange : null;
  const parts: (Node | null)[] = [h('h3', {}, c.heading)];
  const button = (label: string, act: () => void) => {
    const b = h('button', { type: 'button' }, label);
    b.addEventListener('click', act);
    return b;
  };
  if (!job) {
    const size = aboutSize(photos.length * photoBytes(lookGrid().size));
    parts.push(
      h('p', { class: 'hint' }, c.what),
      h(
        'div',
        { class: 'actions' },
        button(c.button(photos.length, of, size), () => void startLiveRange(look)),
      ),
    );
  } else if (job.state === 'reading') {
    parts.push(h('p', { class: 'hint progress', role: 'status' }, c.reading(job.done, job.total)));
  } else if (job.state === 'failed') {
    parts.push(h('p', { class: 'hint', role: 'status' }, c.failed));
  } else {
    const lambdas = job.frames.map((f) => f.lambdaUm).filter(Number.isFinite);
    const span = lambdas.length
      ? c.span(
          job.frames.length,
          job.total,
          fixed(Math.min(...lambdas)),
          fixed(Math.max(...lambdas)),
        )
      : '';
    parts.push(h('p', { class: 'hint' }, span, ' ', c.drift));
    if (job.playing)
      parts.push(
        seriesBar,
        filmNote,
        h('div', { class: 'actions' }, button(c.back, leaveLiveRange)),
      );
    else
      parts.push(
        h(
          'div',
          { class: 'actions' },
          button(c.again(job.frames.length), () => watchLiveRange(job)),
        ),
      );
  }
  return h('section', { class: 'live-range' }, ...parts);
}

/**
 * Finds SPHEREx's photos of a spot in the sky index, picks a fair same-colour set, reads just
 * those patches from the bucket (in parallel, each counted as it lands) and flips through
 * them. Nothing flips until both looks have a photo in; Stop keeps what has landed.
 * No arrow, no verdict: a look, not a search.
 */
/** A famous spot from public/data/surprise.json (Gaia DR3 position at 2026.0, checked 14 Nov). */
interface SurpriseSpot {
  name: string;
  kind: 'mover' | 'variable';
  note: string;
  ra: number;
  dec: number;
  pmArcsecYr: number;
  source: string;
}
let surprises: Promise<SurpriseSpot[]> | null = null;
function loadSurprises(): Promise<SurpriseSpot[]> {
  surprises ??= fetch(`${import.meta.env.BASE_URL}data/surprise.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ spots: SurpriseSpot[] }>) : { spots: [] }))
    .then((d) => d.spots)
    .catch(() => {
      surprises = null;
      return [];
    });
  return surprises;
}
/** The surprise on screen, if the look came from one (for its name, line and link). */
let surprise: SurpriseSpot | null = null;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * How far the star's catalogue motion carries it between the two looks on screen (motion only,
 * parallax left out), in arcseconds and SPHEREx pixels; before the looks are chosen, the rate.
 */
function surpriseShiftLine(s: SurpriseSpot): string {
  const plan = live?.plan;
  if (plan?.kind !== 'pair') return copy.surprise.mover(s.pmArcsecYr.toFixed(1));
  const years = Math.abs(plan.pair.b.mjd - plan.pair.a.mjd) / 365.25;
  const arcsec = s.pmArcsecYr * years;
  const px = arcsec / SCALE_ARCSEC;
  return copy.surprise.moverShift(
    s.pmArcsecYr.toFixed(1),
    arcsec.toFixed(1),
    px.toFixed(px < 1 ? 2 : 1),
    px < 1,
  );
}

/** The surprise the sky is flying to, if any (the button says so and waits). */
let surpriseFlight: string | null = null;
/** A flight the visitor interrupted: its dive, on offer for a few seconds (Viewer). */
let surpriseOffer: { spot: SurpriseSpot; timer: number } | null = null;
let surpriseCancelled = false;
/** Said to screen readers: where the sky is flying. */
const surpriseStatus = h('p', { class: 'visually-hidden', role: 'status' });
// In the header: appended to the body it sat below the page and made it scroll.
header.append(surpriseStatus);
// Any input during the flight takes over: no dive (Viewer: a quick nudge-back must count too).
for (const [target, ev] of [
  [skyCanvas, 'pointerdown'],
  [skyCanvas, 'wheel'],
  [window, 'keydown'],
  [search, 'focus'],
] as const)
  target.addEventListener(ev, () => {
    if (!surpriseFlight) return;
    surpriseCancelled = true;
    sky.cancelFlight();
  });

/**
 * A live look at a famous fast star or variable, a different one from the last. On the sky it
 * first flies there (great circle, pulled back on a long hop; at most 1.8 s), its RA/Dec lines
 * showing where it's going and its photo list loading meanwhile; then the dive (Sumit, 14 Nov).
 * On the flat map its place is marked for a moment instead; under reduced motion it cuts.
 */
async function surpriseMe(spotIn?: SurpriseSpot): Promise<void> {
  if (surpriseFlight) return;
  warmUp();
  if (surpriseOffer) {
    window.clearTimeout(surpriseOffer.timer);
    surpriseOffer = null;
  }
  const spots = spotIn ? [spotIn] : await loadSurprises();
  const others = spotIn ? spots : spots.filter((x) => x.name !== surprise?.name);
  const pick = others[Math.floor(Math.random() * others.length)];
  if (!pick) return;
  const at = { ra: pick.ra, dec: pick.dec };
  const onSky = state.place.kind === 'sky' && state.room === 'play' && !sky.steppedOut;
  const motion = !prefersReducedMotion();
  if (onSky && state.entry === 'inside' && motion && !spotIn) {
    surpriseFlight = pick.name;
    surpriseCancelled = false;
    surpriseStatus.textContent = copy.surprise.flying(pick.name);
    try {
      render();
      // Its lines and band row, but not the search's own short flight: this one is longer.
      lastFlown = `${at.ra.toFixed(4)},${at.dec.toFixed(4)}`;
      followOpt({
        id: `surprise:${pick.name}`,
        label: pick.name,
        at,
        title: pick.name,
        go: () => undefined,
      });
      void findPhotos(at).catch(() => undefined);
      await sky.flyTo(at, 20, SkyView.flightMs(separationDeg(sky.centre, at)));
      if (!surpriseCancelled) await new Promise((r) => setTimeout(r, 150));
    } finally {
      surpriseFlight = null;
      // No stale "Flying to…" left in the live region (Viewer).
      surpriseStatus.textContent = '';
    }
    if (surpriseCancelled || state.place.kind !== 'sky') {
      // The visitor took over: stay where they are, the spot still marked, its dive on offer.
      surpriseOffer = {
        spot: pick,
        timer: window.setTimeout(() => {
          surpriseOffer = null;
          if (state.place.kind === 'sky') render();
        }, 5000),
      };
      render();
      return;
    }
    followOpt(null);
  } else if (onSky && state.entry === 'flat') {
    // The whole-sky map: show where it is for a moment (no flight needed), then dive.
    sky.setSpot(at, pick.name);
    if (motion) await new Promise((r) => setTimeout(r, 400));
    sky.setSpot(null);
  }
  await openLook(at, pick);
}

async function openLook(
  at: SkyPosition,
  named: SurpriseSpot | null = null,
  opts: {
    detector?: Detector;
    reuse?: {
      photos: LivePhoto[];
      probed: LookProbed;
      checked: Set<Detector>;
      sn: Map<Detector, number | null>;
    };
  } = {},
): Promise<void> {
  surprise = named;
  liveColouring = false;
  fadeAt = null;
  if (markMode) {
    markMode = false;
    spotResult = null;
    spotSeq++;
    lensCanvas.style.cursor = '';
  }
  stopReveal?.();
  stopLook();
  endSpot(false);
  current = null;
  dropDifference();
  const look: NonNullable<typeof live> = {
    at,
    plan: null,
    probe: null,
    photos: [],
    landed: [],
    movers: null,
    spectrum: null,
    tiles: [],
    stretch: null,
    done: false,
    abort: new AbortController(),
    probed: null,
    colour: null,
    choosingColour: false,
  };
  live = look;
  dispatch({ type: 'goTo', at });
  writeUrl();
  trueScaleFig.hidden = true;
  lensLabel.replaceChildren();
  locator.setLanterns([{ id: 'look', at, label: '', ready: true, measured: false }]);
  locator.frameWholeSky(at);

  let plan: LookPlan<LivePhoto>;
  if (opts.reuse) {
    // Another colour of the same spot: the photos are already probed.
    look.photos = opts.reuse.photos;
    look.probed = opts.reuse.probed;
    plan = planCandidates(look.probed.candidates, look.probed.meta);
  } else {
    try {
      const found = await planLiveLook(at, look.abort.signal, (done, total, of) => {
        if (live !== look) return;
        look.probe = { done, total, of };
        const line = words.querySelector('.probing');
        const bar = line?.querySelector<HTMLElement>('.load-bar i');
        const count = line?.querySelector('.load-count');
        if (bar && count && !look.choosingColour) {
          bar.parentElement?.classList.remove('indeterminate');
          bar.style.width = `${Math.round((100 * done) / Math.max(1, total))}%`;
          count.textContent = copy.look.probingShort(done, total, of);
        } else render();
      });
      plan = found.plan;
      look.photos = found.photos;
      look.probed = found.probed;
    } catch {
      if (live === look)
        dispatch({ type: 'trouble', reason: navigator.onLine ? 'index-missing' : 'offline' });
      return;
    }
  }
  if (live !== look) return;
  if (plan.kind === 'pair' && look.probed)
    plan = await chooseColour(look, plan, opts.detector, opts.reuse?.checked, opts.reuse?.sn);
  if (live !== look) return;
  look.plan = plan;
  writeUrl();
  if (plan.kind !== 'pair') {
    dispatch({ type: 'indexReady', planned: 0 });
    dispatch({ type: 'seasonsIn', total: plan.kind === 'none' ? 0 : plan.total });
    return;
  }
  dispatch({ type: 'indexReady', planned: plan.set.length });
  const grid = lookGrid();
  await eachLimited(plan.set, readsAtOnce(), async (c) => {
    const frame = await readPhoto(c.hit, at, grid.size, grid.scaleArcsec, look.abort.signal);
    if (!frame || live !== look || look.done) return;
    look.landed.push({
      candidate: c,
      tile: frame.tile,
      key: c.hit.key,
      observer: frame.observerKm ?? null,
    });
    dispatch({ type: 'frameIn' });
  });
  if (live === look && !look.done) finishLook(look);
}

/** The colour a look shows: which detector, why, each colour's centre S/N, and which have pairs. */
interface LookColour {
  chosen: Detector;
  why: 'clearest' | 'shortest' | 'chosen';
  /** Each colour's score: the lower centre S/N of its pair's two photos (null: not measurable). */
  sn: Map<Detector, number | null>;
  /** Colours with a fair pair of their own. */
  pairs: Detector[];
  /** A colour asked for (by the visitor or a link) that has no fair pair here. */
  unavailable: Detector | null;
  /** Colours whose every photo has been checked: "no fair pair" is final only for these. */
  fullyChecked: Set<Detector>;
  /** The colour being checked photo by photo just now (its button says so). */
  checking: Detector | null;
  /** How many colours with a fair pair had a saturated centre (only when none stood out). */
  saturated: number;
  ofPairs: number;
  /** Physics' blend check: the nearest Gaia star (G < 19) within 2 px; undefined until Gaia answers. */
  blend?: { g: number; sepArcsec: number } | null | undefined;
}

/**
 * Picks the look's colour (Physics + Viewer, 14 Nov): the visitor's (or link's) choice when it
 * has a fair pair; else the colour where the source at the spot shows clearest (S/N ≥ 5, both
 * photos of each colour's pair read through the helper); else the shortest colour with a fair
 * pair, as before, and the summary says why. Without the helper the reads are too slow to try
 * six colours first, so it keeps the shortest and lets the visitor choose.
 */
async function chooseColour(
  look: LiveLook,
  plan: Extract<LookPlan<LivePhoto>, { kind: 'pair' }>,
  wanted: Detector | undefined,
  checked: Set<Detector> = new Set(),
  // Scores from the first choice, kept for the look's life (Viewer, 14 Nov).
  scored: Map<Detector, number | null> = new Map(),
): Promise<LookPlan<LivePhoto>> {
  const probed = look.probed;
  if (!probed) return plan;
  let pairs = pairDetectors(probed.candidates, probed.meta);
  const sn = new Map<Detector, number | null>(scored);
  const fully = new Set(checked);
  const saturatedIn = new Set<Detector>();
  // Known stars near the spot (Physics' blend check): asked now, answered whenever; it changes
  // only the words, never the colour shown.
  const gaia = gaiaNear(look.at, 15, look.abort.signal).catch(() => null);
  let chosen: Detector | null = null;
  let why: LookColour['why'] = 'shortest';
  if (wanted && pairs.includes(wanted)) {
    chosen = wanted;
    why = 'chosen';
  } else if (helperActive()) {
    look.choosingColour = true;
    render();
    // "Most clearly" must mean of all six (Viewer, 14 Nov): a colour without a fair pair in the
    // first sample is checked photo by photo first (cheap through the helper).
    for (const d of [1, 2, 3, 4, 5, 6] as Detector[]) {
      if (pairs.includes(d) || fully.has(d)) continue;
      if (await checkColourFully(look, d)) fully.add(d);
    }
    if (live !== look) return plan;
    pairs = pairDetectors(probed.candidates, probed.meta);
    const grid = lookGrid();
    await Promise.all(
      pairs.map(async (d) => {
        if (sn.has(d)) return;
        const p = planCandidates(probed.candidates, probed.meta, d);
        if (p.kind !== 'pair') return;
        const frames = await Promise.all(
          [p.pair.a, p.pair.b].map((c) =>
            readPhoto(c.hit, look.at, grid.size, grid.scaleArcsec, look.abort.signal).catch(
              () => null,
            ),
          ),
        );
        const each = frames.map((f) => {
          const m = f ? apertureFlux(f.tile) : null;
          // A saturated core is blank in the photo, so the aperture gives no number at all:
          // read the saturation flag on the centre pixels themselves.
          if (f && centreSaturated(f.tile)) saturatedIn.add(d);
          // A flagged or saturated aperture isn't a fair score: that colour is left out.
          return m && !m.flagged && m.sigma > 0 ? m.flux / m.sigma : null;
        });
        sn.set(d, each.some((x) => x === null) ? null : Math.min(...(each as number[])));
      }),
    );
    look.choosingColour = false;
    chosen = clearestDetector(sn);
    if (chosen) why = 'clearest';
  }
  const final = chosen ? planCandidates(probed.candidates, probed.meta, chosen) : plan;
  const shown = final.kind === 'pair' ? final : plan;
  look.colour = {
    chosen: shown.pair.a.detector as Detector,
    why,
    sn,
    pairs,
    unavailable: wanted && !pairs.includes(wanted) ? wanted : null,
    fullyChecked: fully,
    checking: null,
    saturated: why === 'shortest' ? pairs.filter((d) => saturatedIn.has(d)).length : 0,
    ofPairs: pairs.length,
  };
  const colour = look.colour;
  const year = 2000 + ((shown.pair.a.mjd + shown.pair.b.mjd) / 2 - 51544.5) / 365.25;
  void gaia.then((stars) => {
    if (live !== look || look.colour !== colour) return;
    colour.blend = stars ? blendingNeighbour(stars, look.at, year) : undefined;
    if (stars) render();
  });
  return shown;
}

/**
 * Checks the colour of every photo of one colour range at the spot (the first plan samples a few
 * per pass), so "no fair pair" there is final, not a sampling gap (Viewer's third state).
 */
async function checkColourFully(look: LiveLook, d: Detector): Promise<boolean> {
  const probed = look.probed;
  if (!probed) return false;
  let failed = 0;
  const have = new Set(probed.candidates.map((c) => c.id));
  const pass = passesOf(look.photos);
  const todo = look.photos
    .map((photo, i) => ({ photo, i }))
    .filter(({ photo }) => photo.det === d && !have.has(photo.key));
  await eachLimited(todo, probesAtOnce(), async ({ photo, i }) => {
    let pr: Awaited<ReturnType<typeof probePhoto>>;
    try {
      pr = await probePhoto(photo, look.at, look.abort.signal);
    } catch {
      failed++;
      return;
    }
    if (!pr || live !== look) return;
    probed.candidates.push({
      id: photo.key,
      detector: d,
      season: pass[i] ?? 0,
      mjd: photo.mjd,
      lambdaUm: pr.lambdaUm,
      colourUncertain: false,
      hit: photo,
    });
  });
  // "Every photo checked" only if every check answered: a busy helper mustn't make "no fair
  // pair" look final.
  return failed === 0 && live === look;
}

/** Whether any pixel within 2.5 px of a tile's centre is flagged saturated. */
function centreSaturated(tile: Tile): boolean {
  const n = tile.size;
  const c = (n - 1) / 2;
  for (let y = Math.floor(c - 2.5); y <= Math.ceil(c + 2.5); y++)
    for (let x = Math.floor(c - 2.5); x <= Math.ceil(c + 2.5); x++)
      if (Math.hypot(x - c, y - c) <= 2.5 && (tile.flags[y * n + x] ?? 0) & FlagMask.saturated)
        return true;
  return false;
}

/** The colour the keyboard should land on once the row is rebuilt (0: none). */
let refocusColour = 0;

/**
 * Shows the same spot in another colour: no new probing, a fresh read of that colour's photos.
 * A colour not yet checked photo by photo is checked first; if it still has no fair pair, it
 * stays off and says so.
 */
async function switchColour(look: LiveLook, d: Detector): Promise<void> {
  const probed = look.probed;
  const c = look.colour;
  if (!probed || !c) return;
  if (!c.pairs.includes(d) && !c.fullyChecked.has(d)) {
    c.checking = d;
    render();
    const complete = await checkColourFully(look, d);
    if (live !== look) return;
    c.checking = null;
    if (complete) c.fullyChecked.add(d);
    c.pairs = pairDetectors(probed.candidates, probed.meta);
    if (!c.pairs.includes(d)) {
      c.unavailable = d;
      render();
      return;
    }
  }
  if (document.activeElement?.closest('.colour-row')) refocusColour = d;
  void openLook(look.at, surprise, {
    detector: d,
    reuse: { photos: look.photos, probed, checked: new Set(c.fullyChecked), sn: c.sn },
  });
}

/** "Colour": six ranges as a radio group, the shown one ringed, those without a fair pair off. */
function colourRow(look: LiveLook): HTMLElement | null {
  const c = look.colour;
  if (!c) return null;
  const t = copy.look.colour;
  const rangeText = (d: Detector) => {
    const [lo, hi] = RANGES[d - 1] ?? [0, 0];
    return t.range(lo, hi);
  };
  const group = h('div', { class: 'colour-row', role: 'radiogroup', 'aria-label': t.label });
  const buttons: HTMLButtonElement[] = [];
  RANGES.forEach(([lo, hi], i) => {
    const d = (i + 1) as Detector;
    const has = c.pairs.includes(d);
    // Off only when every photo in it was checked and none make a fair pair.
    const open = has || !c.fullyChecked.has(d);
    const on = d === c.chosen;
    const sn = c.sn.get(d);
    const busy = c.checking === d;
    const b = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'data-det': String(d),
        class: on ? 'on' : '',
        'aria-checked': String(on),
        tabindex: on ? '0' : '-1',
        disabled: !open,
        'aria-busy': busy ? 'true' : undefined,
        style: `--swatch:${wavelengthColour(Math.sqrt(lo * hi))}`,
        'aria-label': has
          ? t.option(lo, hi, true, sn ?? null)
          : open
            ? t.unchecked(lo, hi)
            : t.option(lo, hi, false, null),
        title: has
          ? t.option(lo, hi, true, sn ?? null)
          : open
            ? t.unchecked(lo, hi)
            : t.option(lo, hi, false, null),
      },
      busy ? '…' : Math.sqrt(lo * hi).toFixed(1),
    ) as HTMLButtonElement;
    b.addEventListener('click', () => {
      if (!on && open && !c.checking) void switchColour(look, d);
    });
    buttons.push(b);
    group.append(b);
  });
  // Arrows move between the colours that can be shown, and show the one landed on.
  group.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const order = c.pairs.slice().sort((a, b) => a - b);
    const at = order.indexOf(c.chosen);
    const next = order[(at + step + order.length) % order.length];
    if (next && next !== c.chosen) void switchColour(look, next);
  });
  const why =
    c.why === 'chosen'
      ? t.whyChosen(rangeText(c.chosen))
      : c.why === 'clearest'
        ? t.whyClearest(rangeText(c.chosen))
        : c.saturated
          ? t.whySaturated(rangeText(c.chosen), c.saturated, c.ofPairs)
          : t.whyShortest(rangeText(c.chosen));
  return h(
    'div',
    { class: 'colour-choice' },
    // The "Same colour" strip above heads this row; the group keeps its label for screen readers.
    group,
    // Physics' blend line stays in view; the reasons fold, so the summary leaves the tabs room
    // at 1280x720 (Viewer's audit, 15 Nov).
    c.blend
      ? h('p', { class: 'hint colour-blend' }, t.blended(c.blend.g, c.blend.sepArcsec))
      : null,
    h(
      'details',
      { class: 'why colour-why' },
      h('summary', {}, t.whyThis),
      h(
        'p',
        { class: 'hint' },
        why,
        c.unavailable ? ` ${t.unavailable(rangeText(c.unavailable))}` : '',
        c.checking ? ` ${t.checking(rangeText(c.checking))}` : '',
      ),
      c.chosen <= 3 ? h('p', { class: 'hint' }, t.cold) : null,
    ),
  );
}

/** Whether the photos in so far cover two looks, so a comparison can start. */
function bothLooksIn(look: NonNullable<typeof live>): boolean {
  return new Set(look.landed.map((x) => x.candidate.season)).size >= 2;
}

/** Shows what has landed, oldest first, with one shared stretch; Stop calls this early. */
function finishLook(look: NonNullable<typeof live>): void {
  look.done = true;
  look.abort.abort();
  if (live !== look || look.plan?.kind !== 'pair') return;
  if (!bothLooksIn(look)) {
    dispatch({ type: 'trouble', reason: navigator.onLine ? 'photos-missing' : 'offline' });
    return;
  }
  look.landed.sort((x, y) => x.candidate.mjd - y.candidate.mjd);
  look.tiles = look.landed.map((x) => x.tile);
  look.stretch = sharedStretch(look.tiles.map((t) => t.pixels));
  lens.setTiles(look.tiles, look.stretch);
  lens.setOverlay({
    contract: 'look',
    ringRadius: 3,
    measured: undefined,
    predicted: undefined,
    catalogue: null,
  });
  dispatch({ type: 'seasonsIn', total: look.plan.total });
  flipLook();
  applyLiveCatalogue(look);
  const grid = lookGrid();
  void moversOn(
    look.at,
    look.landed.map((x) => x.candidate.mjd),
    grid.size,
    grid.scaleArcsec,
    look.landed.map((x) => x.observer),
  ).then((marks) => {
    if (live !== look) return;
    look.movers = marks;
    if (marks !== 'failed') lens.setOverlay({ movers: marks });
    render();
  });
}

/**
 * About how much the spectrum reads: up to 10 photos per colour range, each a 20-pixel box
 * (~0.25 MB of rows from NASA directly, ~2 kB through the cloud helper).
 */
const SPECTRUM_PER_DETECTOR = 10;
function spectrumSize(photos: LivePhoto[]): string {
  const perDet = [1, 2, 3, 4, 5, 6].map((d) =>
    Math.min(SPECTRUM_PER_DETECTOR, photos.filter((p) => p.det === d).length),
  );
  const n = perDet.reduce((a, b) => a + b, 0);
  return aboutSize(n * (helperActive() ? photoBytes(20) : 250_000));
}

/** Measures the spot's spectrum, photo by photo, at each photo's own wavelength. */
function startLiveSpectrum(look: NonNullable<typeof live>): void {
  const job: NonNullable<NonNullable<typeof live>['spectrum']> = {
    state: 'reading',
    done: 0,
    total: 0,
    result: null,
    abort: new AbortController(),
  };
  look.spectrum = job;
  render();
  void liveSpectrum(look.at, look.photos, {
    perDetector: SPECTRUM_PER_DETECTOR,
    concurrency: helperActive() ? 24 : 4,
    signal: job.abort.signal,
    onPoint: (_p, done, total) => {
      job.done = done;
      job.total = total;
      if (live === look) renderSpectrumProgress(job);
    },
  })
    .then((result) => {
      job.result = result;
      job.state = 'done';
    })
    .catch(() => {
      job.state = 'failed';
    })
    .finally(() => {
      if (live === look && look.spectrum === job) render();
    });
}

/** Updates the progress line in place, without rebuilding the words column per photo. */
function renderSpectrumProgress(job: NonNullable<NonNullable<typeof live>['spectrum']>): void {
  const line = words.querySelector('.live-spectrum .progress');
  if (line) line.textContent = copy.look.spectrum.reading(job.done, job.total);
}

/** The live look's spectrum: a button with its size, then progress, then the figure. */
function liveSpectrumSection(look: NonNullable<typeof live>): HTMLElement {
  const c = copy.look.spectrum;
  const parts: (Node | null)[] = [h('h3', {}, copy.spectrum.heading)];
  const job = look.spectrum;
  if (!job) {
    const b = h('button', { type: 'button' }, c.button(spectrumSize(look.photos)));
    b.addEventListener('click', () => startLiveSpectrum(look));
    parts.push(h('p', { class: 'hint' }, c.what), h('div', { class: 'actions' }, b));
  } else if (job.state === 'reading') {
    parts.push(h('p', { class: 'hint progress', role: 'status' }, c.reading(job.done, job.total)));
  } else if (job.state === 'failed' || !job.result) {
    parts.push(h('p', { class: 'hint', role: 'status' }, c.failed));
  } else {
    const r = job.result;
    const tuple = (p: LiveSpectrum['points'][number]): SpectrumPoint => [
      p.lambdaUm,
      p.fluxUJy,
      p.sigmaUJy,
      p.detector,
      p.season,
    ];
    parts.push(h('p', {}, c.status(r.status, r.reason)));
    // Shape only: the averaged line is the reading; single photos are drawn faint, not as data.
    const shapeOnly = r.status === 'binned only';
    if (r.points.length && r.status !== 'not measurable') {
      const pts = r.points.map(tuple);
      parts.push(
        spectrumFigure(
          pts,
          { x: copy.spectrum.x, y: copy.spectrum.y },
          shapeOnly ? [] : r.flagged.map(tuple),
          shapeOnly ? binSpectrum(pts) : null,
        ),
        h(
          'p',
          { class: 'hint' },
          shapeOnly
            ? c.shapeCaption(r.points.length)
            : c.caption(r.points.length, r.flagged.length),
        ),
      );
      // N8: measured points only (flagged ones are never played); a shape-only spectrum plays
      // its bins, and says so.
      const L = copy.spectrum.listen;
      if (r.status === 'measured' || shapeOnly)
        parts.push(
          listenControl(
            `live-${look.at.ra.toFixed(4)},${look.at.dec.toFixed(4)}`,
            shapeOnly
              ? binSpectrum(pts).map(([um, flux]) => ({ um, flux }))
              : pts.map(([um, flux]) => ({ um, flux })),
            {
              listen: L.listen,
              stop: L.stop,
              name: L.name('the spectrum at this spot'),
              mapping: shapeOnly ? `${L.mapping} ${L.binned}` : L.mapping,
            },
          ),
        );
    }
    parts.push(h('p', { class: 'hint small' }, c.caveat(r.blendChecked, r.neighbours.length > 0)));
  }
  return h('section', { class: 'spectrum-section live-spectrum' }, ...parts);
}

/** Known asteroids in the look's photos, in one line under them. */
function liveMoversLine(look: NonNullable<typeof live>): HTMLElement {
  const m = copy.look.movers;
  if (look.movers === null) return h('p', { class: 'hint' }, m.asking);
  if (look.movers === 'failed') return h('p', { class: 'hint' }, m.failed);
  const names = [...new Set(look.movers.flat().map((x) => x.name))];
  const nearEarth = look.movers.flat().some((x) => x.nearEarth);
  return h('p', { class: 'hint' }, names.length ? m.some(names, nearEarth) : m.none);
}

/** "Second look, 12 March 2026" for photo i of a live look. */
function livePhotoName(i: number): string {
  const look = live;
  const x = look?.landed[i];
  if (!look || !x) return '';
  const seasons = [...new Set(look.landed.map((y) => y.candidate.season))].sort((a, b) => a - b);
  return copy.look.photoName(
    seasons.indexOf(x.candidate.season) + 1,
    dayMonthYear(x.candidate.mjd),
  );
}

function showLivePhoto(i: number): void {
  if (liveRange?.playing) leaveLiveRange();
  // A single photo ends colour by date: the lens goes back to the photos first.
  if (liveColouring || fadeAt !== null) {
    liveColouring = false;
    fadeAt = null;
    if (live?.stretch) lens.setTiles(live.tiles, live.stretch);
    queueMicrotask(render);
  }
  liveShown = i;
  lens.show(i);
  lensLabel.replaceChildren(h('span', {}, livePhotoName(i)));
  for (const [k, t] of words.querySelectorAll('.look-strip .thumb').entries()) {
    t.classList.toggle('on', k === i);
  }
}

/** Hard cuts through the photos in time order, twice, ending on the last. */
function flipLook(): void {
  if (liveRange?.playing) leaveLiveRange();
  liveColouring = false;
  fadeAt = null;
  stopReveal?.();
  const n = live?.tiles.length ?? 0;
  if (n < 2) return;
  if (prefersReducedMotion()) {
    showLivePhoto(n - 1);
    return;
  }
  stopReveal = playFlipbook(lens, n, { onStep: showLivePhoto });
}

function lookMonth(index: 0 | 1): string {
  if (!current) return '';
  const season = current.show.seasons[index];
  const frames = current.pack.manifest.frames.filter((f) => f.season === season);
  return frames.length ? monthYear(frames.reduce((a, f) => a + f.mjd, 0) / frames.length) : '';
}

/** A look's number is its pass (1, 2, 3), not its place in the pair on screen. */
const passNo = (index: 0 | 1) => (current?.show.seasons[index] ?? index) + 1;
const lookName = (index: 0 | 1) => copy.show.look(passNo(index), lookMonth(index));

/** A small inset with the move at its real length, so the enlarged arrow is never misread. */
function drawTrueScale(show: Show): void {
  const ctx = trueScale.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, trueScale.width, trueScale.height);
  trueScaleFig.hidden = show.kind !== 'motion';
  if (show.kind !== 'motion') return;
  const k = trueScale.width / 10; // ten SPHEREx pixels across
  const c = trueScale.width / 2;
  ctx.strokeStyle = 'rgb(154 166 216 / 0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(i * k, 0);
    ctx.lineTo(i * k, trueScale.height);
    ctx.moveTo(0, i * k);
    ctx.lineTo(trueScale.width, i * k);
    ctx.stroke();
  }
  const dx = -show.measured.east * k;
  const dy = -show.measured.north * k;
  ctx.strokeStyle = '#7fd6c2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(c - dx / 2, c - dy / 2);
  ctx.lineTo(c + dx / 2, c + dy / 2);
  ctx.stroke();
}

/* ---------- hold to compare: spring-loaded, one detector, position only ---------- */

let holdT0 = 0;
function holdStart(): void {
  // Holding during the reveal ends it: the visitor has seen enough to want to compare.
  if (!takeLens() || !current) return;
  holdT0 = performance.now();
  const pair = stackPair(current.pack, 'one-detector', current.show.seasons);
  if (!pair) return;
  leaveDifference();
  dispatch({ type: 'holdStart' });
  lens.setTiles(pair, sharedStretch(pair.map((t) => t.pixels)));
  lens.setOverlay({ arrowProgress: 1 });
  const win = current.pack.manifest.stacks.find((s) => s.kind === 'one-detector')?.lambdaWindowUm;
  lensLabel.textContent = win
    ? copy.show.holding(win[0].toFixed(1), win[1].toFixed(1))
    : copy.show.holdingNoBand;
  let index = 0;
  holdTimer = globalThis.setInterval(() => {
    index = 1 - index;
    lens.show(index);
  }, 700);
}

function holdEnd(): void {
  if (state.place.kind !== 'holding' || !current) return;
  globalThis.clearInterval(holdTimer);
  lens.setTiles(current.pair, sharedStretch(current.pair.map((t) => t.pixels)));
  lens.show(1);
  lensLabel.textContent = copy.show.allColours;
  dispatch({ type: 'holdEnd' });
  // The tour that waits (N7): a real hold, not a tap, counts as trying it.
  if (performance.now() - holdT0 >= 500) tourTried('hold');
}

/** Photos already read, per pack and photo id: the difference and the colour pictures share them. */
const photoTiles = new Map<string, Promise<Tile>>();
function photoTile(pack: LoadedPack, f: Frame): Promise<Tile> {
  const key = `${pack.base}/${f.id}`;
  let p = photoTiles.get(key);
  if (!p) {
    // From its colour range's bundle when the pack has one: one download for all of them.
    const bundle = pack.manifest.bundles?.find((b) => b.detector === f.detector);
    p = bundle
      ? loadBundledTile(pack.base, pack.manifest.grid.size, bundle, f.id)
      : loadPackTile(pack.base, pack.manifest.grid.size, f);
    photoTiles.set(key, p);
    p.catch(() => photoTiles.delete(key));
  }
  return p;
}

/**
 * Shows the later look minus the earlier on the lens: each look rebuilt from its own photos with
 * the strict mask, from the detectors both looks have, then compared on a fixed ±5σ scale.
 */
async function showDifference(): Promise<void> {
  if (!takeLens() || !current) return;
  endFade(false);
  if (colouring) endTimeColour(false);
  endSpot(false);
  const shown = current;
  const req = ++diffRequest;
  diffBusy = true;
  diffTrouble = false;
  render();
  const [early, late] = shown.show.seasons;
  const frames = shown.pack.manifest.frames.filter((f) => f.season === early || f.season === late);
  lensLabel.replaceChildren(h('span', { class: 'look-pill diff-pill' }, copy.show.diffLoading));
  const fail = () => {
    diffBusy = false;
    diffTrouble = true;
    setLensLabel(1, 8);
    render();
  };
  let photos: { frame: Frame; tile: Tile }[];
  try {
    photos = await Promise.all(
      frames.map(async (frame) => ({ frame, tile: await photoTile(shown.pack, frame) })),
    );
  } catch {
    if (req === diffRequest) fail();
    return;
  }
  // The visitor may have moved on, or something else taken the lens, while the photos came in.
  if (req !== diffRequest || current !== shown || state.place.kind !== 'ready') return;
  diffBusy = false;
  const inLook = (season: number) =>
    photos
      .filter((p) => p.frame.season === season)
      .map((p) => ({ detector: p.frame.detector, tile: p.tile }));
  const has = (season: number) => new Set(inLook(season).map((p) => p.detector));
  const shared = [...has(early)].filter((d) => has(late).has(d)).sort();
  // By default only the colours where the target shows (W0855: 3.8–5 µm); elsewhere it is
  // noise and hatching. The visitor can ask for all.
  const motion = shown.pack.manifest.target.motionDetectors ?? [];
  const inMotion = shared.filter((d) => motion.includes(d));
  const both = !diffAllColours && inMotion.length ? inMotion : shared;
  const a = strictLook(`look${early}`, inLook(early), both);
  const b = strictLook(`look${late}`, inLook(late), both);
  const d = a && b ? difference(a, b) : null;
  if (!d) {
    fail();
    return;
  }
  differencing = {
    sigma: d.sigma,
    masked: d.masked,
    detectors: both.length,
    range: detectorRange(both),
    narrowed: both.length < shared.length,
    canNarrow: inMotion.length > 0 && inMotion.length < shared.length,
  };
  lens.setRendered([{ tile: d.tile, image: renderDifference(d.tile) }]);
  lens.setOverlay({ arrowProgress: 1 });
  lensLabel.replaceChildren(
    h('span', { class: 'look-pill diff-pill' }, copy.show.diffLabel(passNo(1), passNo(0))),
  );
  render();
  writeUrl();
}

function endDifference(redraw = true): void {
  if (!differencing || !current) return;
  differencing = null;
  lens.setTiles(current.pair, sharedStretch(current.pair.map((t) => t.pixels)));
  showRevealStill(lens);
  showing = 1;
  setLensLabel(1, 8);
  if (redraw) render();
  writeUrl();
}

/** Forgets the difference, and any still loading, when something else takes the lens. */
function dropDifference(): void {
  colouring = false;
  fadeAt = null;
  const had = differencing !== null || diffBusy;
  diffRequest++;
  differencing = null;
  diffBusy = false;
  diffTrouble = false;
  if (had) writeUrl();
}

/** The passes Physics' eye test used ("… season 0 -> 2)"), if the pack says. */
function eyePair(): [number, number] | null {
  const hit = current?.pack.manifest.eye.method?.match(/season (\d+)\s*->\s*(\d+)/);
  return hit ? [Number(hit[1]), Number(hit[2])] : null;
}

/** Only where the eye test says the hop can be seen with the ring, on the pair it tested. */
function canSpot(): boolean {
  const tested = eyePair();
  return (
    !!current &&
    current.show.kind === 'motion' &&
    current.pack.manifest.eye.status === 'seen-with-ring' &&
    !!tested &&
    tested[0] === current.show.seasons[0] &&
    tested[1] === current.show.seasons[1]
  );
}

/** Starts the game: blink the two looks, no arrow, wait for a tap. */
function startSpot(): void {
  if (!current || !canSpot()) return;
  leaveDifference();
  if (!takeLens()) return;
  endSpot(false);
  restingPair();
  const before = lens.overlay;
  // No arrows, catalogue marks or asteroid marks while playing: each hints at the answer.
  lens.setOverlay({
    arrowProgress: 0,
    guess: null,
    predicted: undefined,
    catalogue: null,
    movers: null,
  });
  let index = 1;
  lens.show(index);
  // 700 ms per look: well under 3 changes a second; still, under reduced motion, no blinking.
  const timer = prefersReducedMotion()
    ? 0
    : globalThis.setInterval(() => {
        index = 1 - index;
        lens.show(index);
        setLensLabel(index as 0 | 1, 8);
      }, 700);
  spot = {
    state: 'playing',
    hit: null,
    timer,
    saved: {
      predicted: before.predicted,
      catalogue: before.catalogue,
      movers: before.movers ?? null,
    },
  };
  setLensLabel(1, 8);
  render();
  // Focus on "Show me", so Space can't start a hold and silently end the game.
  requestAnimationFrame(() => words.querySelector<HTMLElement>('.spot-show')?.focus());
}

/** Shows one look while playing (stops the blinking): for reduced motion and keyboards. */
function spotLook(index: 0 | 1): void {
  if (spot?.state !== 'playing') return;
  globalThis.clearInterval(spot.timer);
  spot.timer = 0;
  lens.show(index);
  setLensLabel(index, 8);
}

/** The answer: the measured arrow, and whether the tap was on it. */
function answerSpot(guess: Shift | null): void {
  if (!current || !spot || spot.state !== 'playing' || current.show.kind !== 'motion') return;
  const m = current.show.measured;
  // The hop (under 2 pixels for Barnard's Star) is smaller than a fair tap target, so the
  // question is its direction: a tap counts if it lies within 45° of the measured move, seen
  // from the ring's centre. A tap on the centre itself asks again.
  if (guess && Math.hypot(guess.east, guess.north) < 0.5) {
    spot.nudge = true;
    render();
    return;
  }
  const cos = guess
    ? (guess.east * m.east + guess.north * m.north) /
      (Math.hypot(guess.east, guess.north) * Math.hypot(m.east, m.north) || 1)
    : 0;
  const hit = guess ? cos >= Math.SQRT1_2 : null;
  globalThis.clearInterval(spot.timer);
  spot = { state: 'done', hit, timer: 0, saved: spot.saved };
  showRevealStill(lens);
  lens.setOverlay({ guess, ...spot.saved });
  lens.show(1);
  showing = 1;
  setLensLabel(1, 8);
  render();
}

function endSpot(redraw = true): void {
  if (!spot) return;
  const was = spot;
  globalThis.clearInterval(spot.timer);
  spot = null;
  lens.setOverlay({ guess: null, ...was.saved });
  // Mid-game, the lens was blinking without its arrow: put the resting view back.
  if (was.state === 'playing' && current) restingPair();
  if (redraw) render();
}

lensCanvas.addEventListener('click', (e) => {
  if (spot?.state !== 'playing') return;
  answerSpot(lens.shiftAt(e.clientX, e.clientY));
});

/** The game's place in the words column: invite, prompt, or the answer. */
function spotSection(name: string): HTMLElement | null {
  if (!canSpot() || current?.show.kind !== 'motion') return null;
  const c = copy.spot;
  const direction = current.show.direction;
  if (!spot) {
    const b = h('button', { type: 'button' }, c.button);
    b.addEventListener('click', startSpot);
    return h(
      'div',
      { class: 'spot' },
      h('p', { class: 'hint' }, c.what),
      h('div', { class: 'actions' }, b),
    );
  }
  if (spot.state === 'playing') {
    spotStatus.textContent = spot.nudge ? c.nudge : c.prompt(name);
    const show = h('button', { type: 'button', class: 'spot-show' }, c.showMe);
    show.addEventListener('click', () => answerSpot(null));
    const looks = ([0, 1] as const).map((i) => {
      const b = h('button', { type: 'button' }, c.look(i + 1));
      b.addEventListener('click', () => spotLook(i));
      return b;
    });
    return h(
      'div',
      { class: 'spot' },
      spotStatus,
      h('p', { class: 'hint' }, c.keys),
      h('div', { class: 'actions' }, ...looks, show),
    );
  }
  spotStatus.textContent =
    spot.hit === null ? c.shown(direction) : spot.hit ? c.yes(direction) : c.close(direction);
  const again = h('button', { type: 'button' }, c.again);
  again.addEventListener('click', startSpot);
  return h('div', { class: 'spot' }, spotStatus, h('div', { class: 'actions' }, again));
}

/** Puts the pair back on the lens first, for actions that draw on top of it. */
function leaveDifference(): void {
  endFade(false);
  if (colouring) endTimeColour(false);
  if (differencing) endDifference(false);
  dropDifference();
  endSpot(false);
}

/** Colours: just where the target shows (default), or every colour both looks have. */
function diffScopeToggle(d: NonNullable<typeof differencing>): HTMLElement {
  const b = h(
    'button',
    { type: 'button', class: 'link-button' },
    d.narrowed ? copy.show.diffAll : copy.show.diffNarrow,
  );
  b.addEventListener('click', () => {
    diffAllColours = d.narrowed;
    void showDifference();
  });
  return h('p', { class: 'hint' }, copy.show.diffScope(d.range, d.narrowed), ' ', b);
}

/** Under the difference button: what the greys mean, and the noise they are measured in. */
function differenceKey(): HTMLElement | null {
  if (!differencing) return null;
  return h(
    'div',
    { class: 'diff-key' },
    h(
      'div',
      { class: 'diff-scale' },
      h('span', {}, copy.show.diffFainter(DIFF_LIMIT)),
      h('i', { style: `background: ${diffGradient()}`, 'aria-hidden': 'true' }),
      h('span', {}, copy.show.diffBrighter(DIFF_LIMIT)),
    ),
    // Which colours make the picture, and the switch where there is one: in view (Viewer).
    differencing.canNarrow
      ? diffScopeToggle(differencing)
      : h('p', { class: 'hint' }, copy.show.diffScope(differencing.range, false)),
    // The explanations fold so Compare fits at 1280x720 (Viewer's audit); the scale stays.
    h(
      'details',
      { class: 'why' },
      h('summary', {}, copy.show.diffHowToRead),
      h('p', { class: 'hint' }, copy.show.diffHow(differencing.sigma.toPrecision(2))),
      h('p', { class: 'hint' }, copy.show.diffColours(differencing.detectors)),
      differencing.masked
        ? h(
            'p',
            { class: 'hint' },
            h('i', { class: 'diff-hatch', 'aria-hidden': 'true' }),
            copy.show.diffMasked,
          )
        : null,
    ),
  );
}

/* ---------- "What's at this spot?" (D9; Physics' rules and Viewer's design, 15 Nov) ---------- */

/** Each check's state: still asking, answered, or no answer in time. */
type CheckState = 'asking' | 'done' | 'failed';
/** A known source near the spot, at its place on a look's date; sep in arcsec. */
interface SpotMatch {
  name: string;
  sep: number;
  /** Which catalogue, and its magnitude (G or W1) and Gaia colour, for which stars count. */
  cat?: 'gaia' | 'catwise';
  mag?: number | null;
  bpRp?: number | null;
}

interface SpotCheckResult {
  state: 'checking' | 'done';
  at: SkyPosition;
  /** S/N in the earlier and later look. */
  sn: [number | null, number | null];
  dates: [string, string];
  /** Seen at S/N >= 5 in N of the M photos read (null: photos not read). */
  seen: { n: number; m: number; masked: number } | null;
  facts: SpotFacts;
  verdict: Verdict | null;
  checked: {
    gaia: CheckState;
    catwise: CheckState;
    asteroids: CheckState;
    flags: CheckState;
    detector: CheckState;
  };
  /** D6: how many different detector places the photos that show it put it (information). */
  places: number | null;
  /**
   * D6: the same detector pixel in other photos looking elsewhere, bright in `bright` of `n`: at
   * each place when there are at most 2 (Physics' rule), else at the clearest photo's (information).
   */
  samePixel: { bright: number; n: number }[] | null;
  /** Known asteroids within R at a bright look's dates, at their closest (arcsec). */
  asteroidMatches: SpotMatch[];
  /** Whether SkyBoT's places were moved to SPHEREx's own position (every date had a header). */
  asteroidsFromSpherex: boolean;
  /** Where CatWISE came from: an archive's name, 'saved' (the target's overlay file), or null. */
  catwiseFrom: string | null;
  /** For the saved copy: when it was fetched and its magnitude cut, from the file itself. */
  catwiseSaved?: { date: string | null; cut: string | null };
  /** Known stars within R, nearest first, each at its closest over the two looks (Viewer 1b). */
  matches: SpotMatch[];
  /** Each flag name's count among the photos that show the spot (information). */
  flagCounts: [string, number][];
  /** Known sources within 2 px of the spot (G < 19, CatWISE, the page's target), nearest first. */
  close: SpotMatch[];
  /** On the five's pages: how far the target's predicted place is from the spot (closest look). */
  targetSep: number | null;
}
let markMode = false;
let spotResult: SpotCheckResult | null = null;
let spotSeq = 0;

/** What the check reads: the two looks, the grid's geometry and dates, and the looks' photos. */
function spotContext(): {
  early: Tile;
  late: Tile;
  size: number;
  scale: number;
  centre: SkyPosition;
  mjd: [number, number];
  photos: (at: SkyPosition) => Promise<{ photo: LivePhoto; look: 0 | 1 }[]>;
  /** On one of the five's pages: the page's own target (Physics' first check). */
  target?: { name: string; wanderer: (typeof WANDERERS)[number] };
  /** A fact about the target that helps read a blend (Physics; cited in targets.json). */
  targetFact?: { text: string; source: string };
} | null {
  if (current && 'target' in state.place) {
    const [early, late] = current.pair;
    if (!early || !late) return null;
    const g = current.pack.manifest.grid;
    const seasons = current.show.seasons;
    const frames = current.pack.manifest.frames;
    const mean = (season: number) => {
      const fs = frames.filter((f) => f.season === season);
      return fs.reduce((a, f) => a + f.mjd, 0) / Math.max(1, fs.length);
    };
    const ids: [Set<string>, Set<string>] = [
      new Set(frames.filter((f) => f.season === seasons[0]).map((f) => f.obsId)),
      new Set(frames.filter((f) => f.season === seasons[1]).map((f) => f.obsId)),
    ];
    const id = current.pack.manifest.target.id as TargetId;
    const wd = WANDERERS.find((x) => x.id === id);
    return {
      early,
      late,
      size: g.size,
      scale: g.pixelScaleArcsec,
      centre: g.centre,
      mjd: [mean(seasons[0]), mean(seasons[1])],
      ...(wd ? { target: { name: copy.wanderers[id].name, wanderer: wd } } : {}),
      ...(id in copy.spotCheck.targetFacts
        ? {
            targetFact: (
              copy.spotCheck.targetFacts as Record<string, { text: string; source: string }>
            )[id],
          }
        : {}),
      // The looks' photos at the clicked spot, matched to the sky index by photo id; at most 40
      // per look, spread through time.
      photos: async (at) => {
        const all = await findPhotos(at);
        const pick = (look: 0 | 1) => {
          const list = all.filter((p) => ids[look].has(p.obsId));
          const step = Math.max(1, list.length / 40);
          return Array.from(
            { length: Math.min(40, list.length) },
            (_, i) => list[Math.floor(i * step)],
          )
            .filter((p): p is LivePhoto => !!p)
            .map((photo) => ({ photo, look }));
        };
        return [...pick(0), ...pick(1)];
      },
    };
  }
  const look = live;
  const p = look ? livePairTiles(look) : null;
  if (!look || !p || look.plan?.kind !== 'pair') return null;
  const grid = lookGrid();
  const earlySeason = look.plan.pair.a.season;
  return {
    early: p[0],
    late: p[1],
    size: grid.size,
    scale: grid.scaleArcsec,
    centre: look.at,
    mjd: [p[2], p[3]],
    // A live look's own photos: the pair and the others read in its colour.
    photos: () =>
      Promise.resolve(
        look.landed.map((x) => ({
          photo: x.candidate.hit,
          look: (x.candidate.season === earlySeason ? 0 : 1) as 0 | 1,
        })),
      ),
  };
}

const yearOfMjd = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;

/** A promise that gives null if it hasn't answered in `ms` (Viewer: no check may hang the card). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((done) => setTimeout(() => done(null), ms)),
  ]);
}
/** The catalogues and SkyBoT get 8 s each; the photos 20 s, keeping what landed by then. */
const CHECK_MS = 8000;
const PHOTOS_MS = 20000;

/** Runs the check at a lens click (pack pixels from the lens centre). */
async function runSpotCheck(shift: Shift): Promise<void> {
  const ctx = spotContext();
  if (!ctx) return;
  const seq = ++spotSeq;
  const c = ctx.size / 2 - 0.5;
  // Tiles are north up, east left: east is to smaller x, north to larger y.
  const r = recentre(tileGrid(ctx.late), c - shift.east, c + shift.north);
  const eastPx = c - r.x;
  const northPx = r.y - c;
  const cosd = Math.cos((ctx.centre.dec * Math.PI) / 180);
  const at = {
    ra: (((ctx.centre.ra + (eastPx * ctx.scale) / 3600 / cosd) % 360) + 360) % 360,
    dec: ctx.centre.dec + (northPx * ctx.scale) / 3600,
  };
  lens.setOverlay({ guess: { east: eastPx, north: northPx } });
  const sn: [number | null, number | null] = [
    apertureSN(tileGrid(ctx.early), r.x, r.y),
    apertureSN(tileGrid(ctx.late), r.x, r.y),
  ];
  const facts: SpotFacts = {
    sn,
    asteroids: [[], []],
    stars: [[], []],
    artefacts: [[], []],
    info: [],
  };
  const result: SpotCheckResult = {
    state: 'checking',
    at,
    sn,
    dates: [monthYear(ctx.mjd[0]), monthYear(ctx.mjd[1])],
    seen: null,
    facts,
    verdict: null,
    checked: {
      gaia: 'asking',
      catwise: 'asking',
      asteroids: 'asking',
      flags: 'asking',
      detector: 'asking',
    },
    places: null,
    samePixel: null,
    asteroidMatches: [],
    asteroidsFromSpherex: false,
    catwiseFrom: null,
    matches: [],
    flagCounts: [],
    close: [],
    targetSep: null,
  };
  spotResult = result;
  render();
  const finish = () => {
    result.matches.sort((x, y) => x.sep - y.sep);
    result.close.sort((x, y) => x.sep - y.sep);
    result.asteroidMatches.sort((x, y) => x.sep - y.sep);
    result.state = 'done';
    // Physics' second rule: every known source within R, the page's target with no priority.
    facts.sources = [
      ...(facts.target && result.targetSep !== null
        ? [{ name: facts.target, sep: result.targetSep, kind: 'target' as const }]
        : []),
      ...result.asteroidMatches.map((m) => ({ ...m, kind: 'asteroid' as const })),
      ...relevantStars(result.matches).map((m) => ({
        name: m.name,
        sep: m.sep,
        kind: 'star' as const,
      })),
    ];
    result.verdict = verdict(facts);
    render();
  };
  // Physics' gate first: nothing at S/N >= 5 in either look, nothing to look up.
  if (!sn.some((v) => v !== null && v >= SPOT_SN)) {
    finish();
    return;
  }
  const stale = () => seq !== spotSeq || spotResult !== result;
  const sepOf = (pos: SkyPosition) => separationDeg(pos, at) * 3600;
  const lookYears = ctx.mjd.map(yearOfMjd) as [number, number];
  /** Keeps a source's closest approach over the two looks. */
  const note = (list: SpotMatch[], name: string, sep: number) => {
    const had = list.find((x) => x.name === name);
    if (had) had.sep = Math.min(had.sep, sep);
    else list.push({ name, sep });
  };
  /** A catalogue source moved to each look's date: matched within R, close within 2 px. */
  const place = (
    name: string,
    posAt: (year: number) => SkyPosition,
    blends: boolean,
    star: { cat: 'gaia' | 'catwise'; mag: number | null; bpRp?: number | null },
  ) => {
    for (const look of [0, 1] as const) {
      const sep = sepOf(posAt(lookYears[look]));
      if (blends && sep <= BLEND_ARCSEC) note(result.close, name, sep);
      if (sep <= MATCH_ARCSEC) {
        if (!facts.stars[look].includes(name)) facts.stars[look].push(name);
        note(result.matches, name, sep);
        const m = result.matches.find((x) => x.name === name);
        if (m) Object.assign(m, star);
      }
    }
  };
  // Physics' first check on the five's pages: the page's own target at its predicted place.
  if (ctx.target) {
    const { name, wanderer: w } = ctx.target;
    for (const look of [0, 1] as const) {
      const sep = sepOf(placeAt(w.at, w.pm.ra, w.pm.dec, WANDERER_EPOCH, lookYears[look]));
      if (sep <= MATCH_ARCSEC) facts.target = name;
      result.targetSep = Math.min(result.targetSep ?? Infinity, sep);
      if (sep <= BLEND_ARCSEC) note(result.close, name, sep);
    }
  }
  const update = () => {
    if (!stale()) render();
  };

  // Each check updates the card as it lands (Viewer 3).
  // Gaia's places are for 2016: a fast star has since moved far from them (Barnard's Star 10.4″
  // a year, ~105″ by 2026), so the cone is the helper's widest, 120″, and each star is moved to
  // the look's date before matching (found on Barnard's live look, 15 Nov).
  const gaia = within(gaiaNear(at, 120), CHECK_MS).then((stars) => {
    if (stale()) return;
    result.checked.gaia = stars ? 'done' : 'failed';
    for (const s of stars ?? []) {
      const name = `Gaia DR3 ${s.id}${s.g !== null ? ` (G ${s.g.toFixed(1)})` : ''}`;
      place(
        name,
        (yr) => placeAt({ ra: s.ra, dec: s.dec }, s.pmra || 0, s.pmdec || 0, 2016.0, yr),
        s.g !== null && s.g < 19,
        { cat: 'gaia', mag: s.g, bpRp: s.bpRp ?? null },
      );
    }
    update();
  });
  // G1 (15 Nov): the helper asks IRSA, then VizieR; if neither answers, one of the five's pages
  // uses the CatWISE rows saved in its overlay file (IRSA's answer when the pack was built).
  const cat = within(catwiseNear(at, 150), CHECK_MS).then(async (got) => {
    if (stale()) return;
    let cw = got?.stars ?? null;
    result.catwiseFrom = got ? got.archive : null;
    if (!cw && ctx.target) {
      const file = await loadOverlay(ctx.target.wanderer.id);
      cw = savedCatwise(file, at, 150);
      if (cw) {
        result.catwiseFrom = 'saved';
        result.catwiseSaved = {
          date: file?.fetched?.catwise2020 ?? null,
          cut: file?.fetched?.catwise_cut ?? null,
        };
      }
    }
    if (stale()) return;
    result.checked.catwise = cw ? 'done' : 'failed';
    for (const s of cw ?? [])
      place(
        `CatWISE2020 ${s.id}`,
        (yr) => placeAt({ ra: s.ra, dec: s.dec }, s.pmra, s.pmdec, yearOfMjd(57170), yr),
        true,
        { cat: 'catwise', mag: s.w1 },
      );
    update();
  });
  // Each photo of the looks, read small through the helper: is the spot there, and which flags.
  type PhotoRead = {
    look: 0 | 1;
    mjd: number;
    sn: number | null;
    flags: Set<string>;
    photo: LivePhoto;
    det: number;
    x: number;
    y: number;
    /** SPHEREx's own position at this photo (header X_SC/Y_SC/Z_SC), for SkyBoT's places. */
    observer: Observer | null;
  };
  const reads: PhotoRead[] = [];
  const photoReads = helperActive()
    ? within(
        ctx.photos(at).then(async (list) => {
          await eachLimited(list, 16, async ({ photo, look }) => {
            const box = await readNative(photo, at, 10).catch(() => null);
            if (!box) return;
            const g = photoGrid(box.image, box.flags, box.w, box.h, box.bits);
            const x = box.xt - box.x0;
            const y = box.yt - box.y0;
            reads.push({
              look,
              photo,
              det: photo.det,
              x: box.xt,
              y: box.yt,
              mjd: box.mjd,
              sn: apertureSN(g, x, y),
              flags: flagNamesNear(box.flags, box.w, box.h, x, y, box.bits),
              observer: observerFromHeader(box.header),
            });
          });
          return true;
        }),
        PHOTOS_MS,
      )
    : Promise.resolve(null);
  const photosDone = photoReads.then(() => {
    if (stale()) return null;
    // What landed by the deadline counts; the photos still reading are left out.
    const photos = reads.slice();
    if (!photos.length) {
      result.checked.flags = 'failed';
      update();
      return null;
    }
    result.checked.flags = 'done';
    const shows = photos.filter((p) => p.sn !== null && p.sn >= SPOT_SN);
    // Only photos that gave a number count; masked ones (saturated, flagged) are said apart.
    const measured = photos.filter((p) => p.sn !== null).length;
    result.seen = { n: shows.length, m: measured, masked: photos.length - measured };
    // Physics' majority rule: a flag counts only if it's set in more than half of the photos
    // that show the spot, per look; every name's count is shown as information.
    for (const look of [0, 1] as const)
      facts.artefacts[look] = majorityFlags(
        shows.filter((p) => p.look === look).map((p) => p.flags),
      ).counted;
    result.flagCounts = majorityFlags(shows.map((p) => p.flags)).fractions;
    facts.info = result.flagCounts.map(([n]) => n).filter((n) => INFO_FLAGS.has(n));
    result.places = placesOf(shows).length;
    update();
    return { shows, all: photos };
  });
  // D6 (Physics' rule): the detector pixel under the spot, read in other photos of that detector
  // where the spot itself lands elsewhere. A defect stays put; real sky moves on. At each place
  // when the spot shows at no more than 2; otherwise at its clearest photo, for information.
  const detector = photosDone.then(async (got) => {
    if (stale()) return;
    const shows = got?.shows ?? [];
    const places = placesOf(shows);
    const clearest = shows.reduce<PhotoRead | null>(
      (b, p) => (b && (b.sn ?? 0) >= (p.sn ?? 0) ? b : p),
      null,
    );
    const refs = places.length <= 2 ? places : clearest ? [clearest] : [];
    const counts = await Promise.all(
      refs.map(async (ref) => {
        const sns: number[] = [];
        await within(
          eachLimited(samePixelProbes(ref, got?.all ?? []), 8, async (p) => {
            const box = await readNative(p.photo, { x: ref.x, y: ref.y }, 10).catch(() => null);
            if (!box) return;
            const g = photoGrid(box.image, box.flags, box.w, box.h, box.bits);
            const v = apertureSN(g, ref.x - box.x0, ref.y - box.y0);
            if (v !== null) sns.push(v);
          }),
          CHECK_MS * 2,
        );
        return { bright: sns.filter((v) => v >= SPOT_SN).length, n: sns.length };
      }),
    );
    if (stale()) return;
    const read = counts.filter((c) => c.n > 0);
    result.checked.detector = read.length ? 'done' : 'failed';
    result.samePixel = read;
    facts.stuck = stuckOnDetector(places.length, read);
    update();
  });
  // SkyBoT at the dates of the photos that show the spot (or the looks' mean dates).
  const asteroids = photosDone.then(async (got) => {
    if (stale()) return;
    const shows = got?.shows ?? [];
    const by = (look: 0 | 1) => shows.filter((p) => p.look === look).map((p) => p.mjd);
    const dates: [number[], number[]] = [
      by(0).length ? by(0) : [ctx.mjd[0]],
      by(1).length ? by(1) : [ctx.mjd[1]],
    ];
    // Physics, 15 Nov: SkyBoT answers for Earth's centre; each photo's own header gives where
    // SPHEREx was, which moves a main-belt asteroid by up to ~1 px (checked against kete).
    const observerAt = new Map(shows.map((p) => [p.mjd, p.observer] as const));
    const allDates = [...dates[0], ...dates[1]];
    result.asteroidsFromSpherex = allDates.every((m) => !!observerAt.get(m));
    const moving = await within(
      knownMoversAt(at, allDates, MATCH_ARCSEC / 3600, undefined, (m) => observerAt.get(m) ?? null),
      CHECK_MS,
    );
    if (stale()) return;
    if (!moving || moving.failed > 0) {
      result.checked.asteroids = 'failed';
      update();
      return;
    }
    result.checked.asteroids = 'done';
    for (const look of [0, 1] as const)
      for (const m of dates[look])
        for (const o of moving.byMjd.get(m) ?? []) {
          const name = o.number ? `(${o.number}) ${o.name}` : o.name;
          if (!facts.asteroids[look].includes(name)) facts.asteroids[look].push(name);
          // A source for the verdict only at a look where the spot is >= 5 sigma.
          if ((sn[look] ?? 0) >= SPOT_SN) note(result.asteroidMatches, name, sepOf(o));
        }
    update();
  });
  // The verdict waits only for what answered (every check ends by its deadline).
  await Promise.all([gaia, cat, asteroids, detector]);
  if (stale()) return;
  finish();
}

/** The mark used for keyboard marking: arrows move it, Enter checks (Viewer's design). */
let markCross: Shift = { east: 0, north: 0 };

function setMarkMode(on: boolean): void {
  markMode = on;
  lensCanvas.style.cursor = on ? 'crosshair' : '';
  if (on) {
    lensCanvas.tabIndex = 0;
    markCross = { east: 0, north: 0 };
    lens.setOverlay({ guess: markCross });
  } else {
    lensCanvas.removeAttribute('tabindex');
    lens.setOverlay({ guess: null });
    spotResult = null;
    spotSeq++;
  }
  render();
}

lensCanvas.addEventListener('click', (e) => {
  if (!markMode) return;
  void runSpotCheck(lens.shiftAt(e.clientX, e.clientY));
});
lensCanvas.addEventListener('keydown', (e) => {
  if (!markMode) return;
  const step: Record<string, [number, number]> = {
    ArrowLeft: [1, 0],
    ArrowRight: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  const d = step[e.key];
  if (d) {
    e.preventDefault();
    e.stopPropagation();
    // East is left on the lens, as on the sky.
    markCross = { east: markCross.east + d[0], north: markCross.north + d[1] };
    lens.setOverlay({ guess: markCross });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    void runSpotCheck(markCross);
  } else if (e.key === 'Escape') {
    // Esc ends marking only, not the whole page (Viewer); focus goes back to the button.
    e.preventDefault();
    e.stopPropagation();
    setMarkMode(false);
    document.querySelector<HTMLElement>('[data-spot-button]')?.focus();
  }
});

/** The button that turns marking on, for Compare's actions. */
function markButton(): HTMLElement | null {
  if (!spotContext()) return null;
  const b = h(
    'button',
    {
      type: 'button',
      'aria-pressed': String(markMode),
      class: 'diff-toggle',
      'data-spot-button': '',
    },
    copy.spotCheck.button,
  );
  b.addEventListener('click', () => {
    setMarkMode(!markMode);
    if (markMode) lensCanvas.focus({ preventScroll: true });
  });
  return b;
}

/** Whether "How we checked" is open, kept across re-renders. */
let spotDetailsOpen = false;
/** The card scrolls into view when a check starts and when its verdict lands (Compare scrolls). */
let spotScrollFor: string | null = null;

function revealSpotCard(card: HTMLElement, key: string): HTMLElement {
  if (spotScrollFor !== key) {
    spotScrollFor = key;
    requestAnimationFrame(() =>
      card.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      }),
    );
  }
  return card;
}

/** A flag's plain name (Viewer: no raw bit names on the card). */
const plainFlag = (name: string) =>
  (copy.spotCheck.flagPlain as Record<string, string>)[name] ??
  name.toLowerCase().replace(/_/g, ' ');

/** "A at a″ and B at b″" (nearest first). */
function sourceList(
  list: { name: string; sep: number }[],
  fmt: (name: string, sep: string) => string,
): string {
  const parts = list.map((m) => fmt(m.name, m.sep.toFixed(1)));
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
    : (parts[0] ?? '');
}

/**
 * The card (Viewer's layout, 15 Nov): the verdict, "seen in N of M" and Copy report stay in view;
 * everything else folds into "How we checked". While checking, the checks show as they land.
 */
function spotCard(): HTMLElement | null {
  if (!markMode) return null;
  const t = copy.spotCheck;
  if (!spotResult) return h('p', { class: 'hint spot-check-hint' }, t.how);
  const r = spotResult;
  const v = r.verdict;
  const f = r.facts;
  const snText = (i: 0 | 1) => {
    const x = r.sn[i];
    return x === null ? t.snNone(r.dates[i]) : t.sn(r.dates[i], x.toFixed(1));
  };
  const checkLine = (state: CheckState, done: () => string, name: string) =>
    h(
      'li',
      {},
      state === 'done' ? done() : state === 'asking' ? t.asking(name) : t.notChecked(name),
    );
  const all = (x: [string[], string[]]) => [...new Set([...x[0], ...x[1]])];
  const withSep = (list: SpotMatch[], prefix = '') =>
    list.filter((m) => m.name.startsWith(prefix)).map((m) => t.away(m.name, m.sep.toFixed(1)));
  const detectorText = () =>
    t.checkDetector(
      r.places ?? 0,
      (r.samePixel ?? []).map((c) => t.brightIn(c.bright, c.n)).join(t.andAtTheOther),
    );
  const items = [
    checkLine(
      r.checked.asteroids,
      () => t.checkAsteroids(withSep(r.asteroidMatches), r.asteroidsFromSpherex),
      t.asteroidsName,
    ),
    checkLine(
      r.checked.gaia,
      () => t.checkStars('Gaia DR3', withSep(r.matches, 'Gaia')),
      'Gaia DR3',
    ),
    checkLine(
      r.checked.catwise,
      () =>
        t.checkStars(
          r.catwiseFrom === 'saved'
            ? t.catwiseSaved(r.catwiseSaved?.date ?? null, r.catwiseSaved?.cut ?? null)
            : r.catwiseFrom && r.catwiseFrom !== 'IRSA'
              ? t.catwiseVia(r.catwiseFrom)
              : 'CatWISE2020',
          withSep(r.matches, 'CatWISE'),
        ),
      t.catwiseName,
    ),
    checkLine(r.checked.flags, () => t.checkFlags(all(f.artefacts).map(plainFlag)), t.flagsName),
    checkLine(r.checked.detector, detectorText, t.detectorName),
  ];
  const checks = h('ul', { class: 'spot-check-list' }, ...items);
  const where = [
    // Full precision: positionText rounds to 10 s when given a field of view.
    h('p', { class: 'spot-check-at' }, positionText(r.at)),
    h('p', { class: 'hint' }, snText(0), ' · ', snText(1)),
  ];
  if (!v) {
    // Still checking: the checks in view as they land (Viewer 3).
    const gated = r.sn.some((x) => x !== null && x >= SPOT_SN);
    return revealSpotCard(
      h(
        'div',
        { class: 'spot-check-card', 'aria-live': 'polite' },
        h('p', { class: 'hint', role: 'status' }, t.checking),
        // The S/N per look only; the position joins "How we checked" when done (fit).
        where[1] ?? null,
        // One compact line while checking, each check marked as it answers (fit at 1280x720).
        gated
          ? h(
              'p',
              { class: 'hint spot-check-progress' },
              (
                [
                  [r.checked.asteroids, 'SkyBoT'],
                  [r.checked.gaia, 'Gaia'],
                  [r.checked.catwise, 'CatWISE'],
                  [r.checked.flags, t.photosShort],
                  [r.checked.detector, t.detectorShort],
                ] as [CheckState, string][]
              )
                .map(([st, name]) => `${name} ${st === 'done' ? '✓' : st === 'failed' ? '✗' : '…'}`)
                .join(' · '),
            )
          : null,
      ),
      `${spotSeq}:checking`,
    );
  }
  const shown: (HTMLElement | null)[] = [];
  const folded: (HTMLElement | null)[] = [...where];
  const head =
    v.kind === 'nothing'
      ? t.nothing
      : v.kind === 'blend'
        ? // Physics' blend, as one line (Viewer): where the light is centred, with no claim.
          t.blendHead(
            sourceList(
              v.sources.map((x) => ({
                name: x.kind === 'target' ? t.predictedPlace(x.name) : x.name,
                sep: x.sep,
              })),
              (name, sep) => `${sep}″ from ${name}`,
            ),
          )
        : v.kind === 'target'
          ? t.target(v.name, (r.targetSep ?? 0).toFixed(1))
          : v.kind === 'asteroid'
            ? t.asteroid(sourceList(r.asteroidMatches, t.away) || v.names.join(', '))
            : v.kind === 'star'
              ? t.star(sourceList(relevantStars(r.matches), t.away) || v.names.join(', '))
              : v.kind === 'artefact'
                ? v.stuck && !v.flags.length
                  ? t.stuck
                  : t.artefact(v.flags.map(plainFlag).join(', '))
                : t.unknown;
  shown.push(h('p', { class: 'spot-check-verdict', role: 'status' }, head));
  // A fact about the page's target, when it's one of the sources (Physics; cited in targets.json).
  // It folds into "How we checked" with a pointer here, so Compare fits (Viewer's fallback).
  const targetFact = spotContext()?.targetFact;
  const factHere =
    !!targetFact &&
    (v.kind === 'target' || (v.kind === 'blend' && v.sources.some((x) => x.kind === 'target')));

  if (v.kind === 'star' && v.flagged.length)
    shown.push(h('p', { class: 'hint' }, t.starFlagged(v.flagged.map(plainFlag).join(', '))));
  if (v.kind === 'artefact' && v.stuck && v.flags.length)
    shown.push(h('p', { class: 'hint' }, t.stuck));
  if (v.kind !== 'nothing') {
    // "Seen in N of M" and the pointer to the target's fact share one line (fit at 1280x720).
    if (r.seen || factHere)
      shown.push(
        h(
          'p',
          { class: 'hint' },
          r.seen ? t.seen(r.seen.n, r.seen.m, r.seen.masked) : '',
          r.seen && factHere ? ' ' : '',
          factHere ? t.factPointer : '',
        ),
      );
    // Physics' blend note: another known source within 2 px, beyond R, not already named.
    const named = new Set<string>(r.matches.map((m) => m.name));
    if (v.kind === 'blend') v.sources.forEach((x) => named.add(x.name));
    if (v.kind === 'target') named.add(v.name);
    if (v.kind === 'star' || v.kind === 'asteroid') v.names.forEach((n) => named.add(n));
    const other = r.close.find((x) => !named.has(x.name));
    if (other) shown.push(h('p', { class: 'hint' }, t.blend(other.name, other.sep.toFixed(1))));
    if (factHere && targetFact)
      folded.push(h('p', { class: 'hint' }, targetFact.text, ' ', t.factSource(targetFact.source)));
    folded.push(checks);
    // The field guide, at the card that matches this verdict (Viewer).
    const fg =
      v.kind === 'blend'
        ? '#blend'
        : v.kind === 'artefact'
          ? '#bad-pixel'
          : v.kind === 'star'
            ? '#ordinary-star'
            : '';
    folded.push(h('p', { class: 'hint' }, h('a', { href: `fieldguide.html${fg}` }, t.fieldGuide)));
    if (r.flagCounts.length && r.seen) {
      const n = r.seen.n;
      folded.push(
        h(
          'p',
          { class: 'hint' },
          t.flagCounts(
            r.flagCounts
              .map(([name, k], i) =>
                i === 0 ? t.flagCountFirst(plainFlag(name), k, n) : t.flagCount(plainFlag(name), k),
              )
              .join('; '),
          ),
        ),
      );
    }
    if (v.kind === 'unknown') {
      shown.push(h('p', { class: 'hint' }, t.unknownWhy));
      if (v.faint) shown.push(h('p', { class: 'hint' }, t.faint));
      shown.push(
        h(
          'p',
          { class: 'hint' },
          t.next,
          ' ',
          h(
            'a',
            {
              href: `http://byw.tools/wiseview#ra=${r.at.ra.toFixed(5)}&dec=${r.at.dec.toFixed(5)}&size=176`,
              target: '_blank',
              rel: 'noopener',
            },
            'WiseView',
          ),
          ' · ',
          h(
            'a',
            {
              href: 'https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9',
              target: '_blank',
              rel: 'noopener',
            },
            'Backyard Worlds',
          ),
        ),
      );
      // The limit matters most for an unknown: keep it in view (Viewer).
      shown.push(h('p', { class: 'hint' }, t.limits));
    } else folded.push(h('p', { class: 'hint' }, t.limits));
  }
  const details = h(
    'details',
    { class: 'spot-check-how' },
    h('summary', {}, t.howChecked(v.kind === 'nothing' ? 0 : items.length)),
    ...folded,
  ) as HTMLDetailsElement;
  details.open = spotDetailsOpen;
  details.addEventListener('toggle', () => {
    spotDetailsOpen = details.open;
  });
  const copyBtn = h('button', { type: 'button', class: 'link-button' }, t.copy);
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(spotReport(r)).then(() => {
      copyBtn.textContent = t.copied;
    });
  });
  return revealSpotCard(
    h(
      'div',
      { class: 'spot-check-card', 'aria-live': 'polite' },
      ...shown,
      // Copy report sits beside "How we checked", on one row.
      h('div', { class: 'spot-check-foot' }, details, copyBtn),
    ),
    `${spotSeq}:done`,
  );
}

/** Plain text: the spot, the dates, the photos, what was checked and what matched. */
function spotReport(r: SpotCheckResult): string {
  const t = copy.spotCheck;
  const v = r.verdict;
  const f = r.facts;
  const all = (x: [string[], string[]]) => [...new Set([...x[0], ...x[1]])].join(', ') || 'none';
  return [
    `Planetes: What's at this spot? (SPHEREx DR1 + QR3)`,
    `Position (ICRS): RA ${r.at.ra.toFixed(5)}°, Dec ${r.at.dec.toFixed(5)}° (${positionText(r.at)})`,
    `Looks: ${r.dates[0]} (S/N ${r.sn[0]?.toFixed(1) ?? 'n/a'}), ${r.dates[1]} (S/N ${r.sn[1]?.toFixed(1) ?? 'n/a'})`,
    r.seen
      ? `Seen at S/N >= 5 in ${r.seen.n} of ${r.seen.m} photos with a number (${r.seen.masked} more masked at the spot: saturated or flagged)`
      : 'Photos: not read one by one',
    `Verdict: ${v?.kind ?? 'n/a'}${v?.kind === 'target' ? ` (${v.name}, predicted position ${r.targetSep?.toFixed(1) ?? '?'}" from the light's centre)` : v?.kind === 'blend' ? ` (${v.sources.map((x) => `${x.name}${x.kind === 'target' ? ' (predicted place)' : ''} at ${x.sep.toFixed(1)}"`).join('; ')}; can't be separated at 6" pixels)` : v?.kind === 'artefact' && v.stuck ? ' (stays put on the detector)' : ''}`,
    `Known asteroids (SkyBoT, within ${MATCH_ARCSEC.toFixed(1)}" at a bright look's dates; places ${r.asteroidsFromSpherex ? "moved to SPHEREx's own position from each photo's header" : "for Earth's centre"}): ${r.checked.asteroids === 'done' ? r.asteroidMatches.map((m) => `${m.name} at ${m.sep.toFixed(1)}"`).join('; ') || 'none' : 'not checked'}`,
    `Known stars (Gaia DR3, CatWISE2020, moved to each look's date): ${r.checked.gaia === 'done' || r.checked.catwise === 'done' ? r.matches.map((m) => `${m.name} at ${m.sep.toFixed(1)}"`).join('; ') || 'none' : 'not checked'}${r.checked.catwise === 'done' ? '' : ' (CatWISE2020 not checked)'}`,
    `Known sources within 2 px (12.3"): ${r.close.map((m) => `${m.name} at ${m.sep.toFixed(1)}"`).join('; ') || 'none'}`,
    `Detector test (information): shows at ${r.places ?? 'n/a'} detector places; same detector pixel bright (S/N >= 5) in ${r.samePixel?.length ? r.samePixel.map((c) => `${c.bright} of ${c.n}`).join(' and ') : 'n/a'} other photos looking elsewhere; stays put: ${r.facts.stuck ? 'yes' : 'no'} (rule: <= 2 places and bright in more than half of >= 3)`,
    `Artefact flags (v4 FIT_REJECT, by name; counted if set in more than half the photos that show the spot): ${r.checked.flags === 'done' ? all(f.artefacts) : 'not checked'}`,
    `Flag counts among the ${r.seen?.n ?? 0} photos that show it: ${r.flagCounts.map(([n, k]) => `${n} ${k}`).join(', ') || 'none'}`,
    t.reportNote,
    `Link: ${location.href}`,
  ].join('\n');
}

/** The pair the fade blends: the five's shown looks, or a live look's fair pair. */
function fadePair(): { a: Tile; b: Tile; early: string; late: string } | null {
  if (current && 'target' in state.place) {
    const [a, b] = current.pair;
    return a && b ? { a, b, early: lookMonth(0), late: lookMonth(1) } : null;
  }
  const look = live;
  const p = look ? livePairTiles(look) : null;
  return p ? { a: p[0], b: p[1], early: monthYear(p[2]), late: monthYear(p[3]) } : null;
}

/** Shows the blend at `t` (0–1) in the lens; the first move takes the lens from the others. */
function showFade(t: number): void {
  const pair = fadePair();
  if (!pair) return;
  if (fadeAt === null) {
    if (current && 'target' in state.place) {
      if (!takeLens()) return;
      if (differencing) endDifference(false);
      if (colouring) endTimeColour(false);
      endSpot(false);
    } else {
      if (liveRange?.playing) leaveLiveRange();
      stopReveal?.();
      if (liveColouring) liveColouring = false;
    }
  }
  fadeAt = t;
  const stretch = sharedStretch([pair.a.pixels, pair.b.pixels]);
  lens.setTiles([fadedTile(pair.a, pair.b, t)], stretch);
  lens.show(0);
  lens.setOverlay({ measured: undefined, predicted: undefined, arrowProgress: 0 });
  lensLabel.replaceChildren(
    h(
      'span',
      { class: 'look-pill diff-pill' },
      copy.show.fade.label(Math.round(t * 100), pair.late),
    ),
  );
}

/** Puts the photos back on the lens: the five's resting pair, or the live look's photos. */
function endFade(redraw = true): void {
  if (fadeAt === null) return;
  fadeAt = null;
  if (current && 'target' in state.place) {
    lens.setTiles(current.pair, sharedStretch(current.pair.map((t) => t.pixels)));
    showRevealStill(lens);
    showing = 1;
    setLensLabel(1, 8);
  } else if (live?.stretch) {
    lens.setTiles(live.tiles, live.stretch);
    showLivePhoto(live.tiles.length - 1);
  }
  if (redraw) render();
}

/**
 * Compare's views as one segmented row (Viewer's audit, 15 Nov): Difference (the five) · Colour by
 * date · Fade, one at a time, then "What's at this spot?", which works on top of any of them (a
 * change is clicked in the difference). Only the active view's controls render below the row, so
 * Compare fits at 1280x720 with no scroll.
 */
function compareModes(look: LiveLook | null): HTMLElement {
  const m = copy.show.modes;
  const five = !look;
  const shiftCase = five && current ? COLOUR_SHIFT[current.pack.manifest.target.id] : undefined;
  const active = colourShiftOn
    ? 'shift'
    : differencing
      ? 'diff'
      : (five ? colouring : liveColouring)
        ? 'date'
        : fadeAt !== null
          ? 'fade'
          : null;
  const seg = (
    key: 'diff' | 'date' | 'fade' | 'shift',
    label: string,
    start: () => void,
    end: () => void,
  ) => {
    const on = active === key;
    const b = h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(on),
        class: on ? 'on' : '',
        ...(key === 'diff' ? { 'aria-busy': String(diffBusy), disabled: diffBusy } : {}),
      },
      label,
    );
    b.addEventListener('click', () => {
      // A view takes the path figure's slot (Viewer: the two never stack).
      pathShown = false;
      // "Light by colour" doesn't take the lens; any other view ends it.
      if (key !== 'shift') colourShiftOn = false;
      if (on) end();
      else start();
    });
    return b;
  };
  const views = h(
    'div',
    { class: 'mode-row', role: 'group', 'aria-label': m.label },
    five
      ? seg(
          'diff',
          m.diff,
          () => void showDifference(),
          () => endDifference(),
        )
      : null,
    seg(
      'date',
      m.byDate,
      () => (look ? showLiveTimeColour(look) : showTimeColour()),
      () => (look ? endLiveTimeColour() : endTimeColour()),
    ),
    fadePair()
      ? seg(
          'fade',
          m.fade,
          () => {
            showFade(0);
            render();
          },
          () => endFade(),
        )
      : null,
    // Physics' demonstration, only on a page that has one (WISE 0855).
    shiftCase
      ? seg(
          'shift',
          m.shift,
          () => {
            if (differencing) endDifference(false);
            if (colouring) endTimeColour(false);
            endFade(false);
            colourShiftOn = true;
            render();
          },
          () => {
            colourShiftOn = false;
            render();
          },
        )
      : null,
  );
  return h('div', { class: 'mode-bar' }, views, markButton());
}

/** "Light by colour" is open (Physics' D2 vs D6 demonstration; the five's pages only). */
let colourShiftOn = false;
/** Inside it, the colour ratio (N2) instead of the 2 × 2 grid. */
let colourRatioOn = false;

/** The demonstration's block: the two colours side by side, the marks, and the distances. */
function colourShiftBlock(): HTMLElement | null {
  if (!current) return null;
  const pack = current.pack;
  const id = pack.manifest.target.id as TargetId;
  const c = COLOUR_SHIFT[id];
  const w = WANDERERS.find((x) => x.id === id);
  if (!c || !w) return null;
  const g = pack.manifest.grid;
  const geo = { size: g.size, scaleArcsec: g.pixelScaleArcsec, centre: g.centre };
  const target = { at: w.at, pmRa: w.pm.ra, pmDec: w.pm.dec, epoch: WANDERER_EPOCH };
  const t = copy.show.colourShift;
  const name = copy.wanderers[id].name;
  const range = (d: number) => detectorRange([d]);
  // Both looks the page compares, earlier first (Physics: never just the clearer one).
  const looks = current.show.seasons.map((season, i) => {
    const stack = (kind: 'one-detector' | 'all-colour', d?: number) => {
      const s = pack.manifest.stacks.find(
        (x) => x.kind === kind && x.season === season && (d === undefined || x.detectors[0] === d),
      );
      return s ? pack.stacks.get(s.id) : undefined;
    };
    const a = stack('one-detector', c.detectors[0]);
    const b = stack('one-detector', c.detectors[1]);
    const all = current?.pair[i];
    const frames = pack.manifest.frames.filter((f) => f.season === season);
    const mjd = frames.reduce((sum, f) => sum + f.mjd, 0) / Math.max(1, frames.length);
    if (!a || !b || !all) return null;
    const year = yearOfMjd(mjd);
    const panels = colourPanels(c, [tileGrid(a), tileGrid(b)], tileGrid(all), geo, target, year);
    return { a, b, panels, mjd, year };
  });
  const [early, late] = looks;
  if (!early || !late) return null;
  const cell = (tile: Tile, p: ColourPanel, date: string) => ({
    tile,
    panel: p,
    alt: t.alt(date, range(p.detector), p.fromNeighbour.toFixed(1), p.fromTarget.toFixed(1), name),
  });
  // How far each source moved between the looks, from the two predicted places (checked live).
  const moved = (pos: (year: number) => SkyPosition) =>
    separationDeg(pos(early.year), pos(late.year)) * 3600;
  const n = c.neighbour;
  const targetMoved = moved((yr) => placeAt(w.at, w.pm.ra, w.pm.dec, WANDERER_EPOCH, yr));
  const neighbourMoved = moved((yr) =>
    placeAt({ ra: n.ra, dec: n.dec }, n.pmra, n.pmdec, 2016.0, yr),
  );
  // N2 (Physics, 15 Nov): the colour ratio, long ÷ short, as a second way to read the same two
  // colours. It failed its validation on this field (the target isn't the reddest source), and
  // the caption says so; it's never offered as a cold-object finder on its own.
  const ratioToggle = h(
    'button',
    { type: 'button', class: 'link-button', 'aria-pressed': String(colourRatioOn) },
    colourRatioOn ? t.ratio.hide : t.ratio.show,
  );
  ratioToggle.addEventListener('click', () => {
    colourRatioOn = !colourRatioOn;
    render();
  });
  if (colourRatioOn && c.reddest) {
    const q = c.reddest;
    const maps = [early, late].map((L) => {
      const r = colourRatio(L.a, L.b);
      const date = monthYear(L.mjd);
      return h(
        'figure',
        {},
        ratioCanvas(
          r,
          {
            reddest: skyToPixel({ ra: q.ra, dec: q.dec }, geo),
            target: skyToPixel(placeAt(w.at, w.pm.ra, w.pm.dec, WANDERER_EPOCH, L.year), geo),
          },
          t.ratio.alt(date, name),
        ),
        h('figcaption', {}, date),
      );
    });
    // Compact for 1280x720: the key beside the maps; what red means in a fold.
    const sw = (style: string, text: string, cls = 'cs-swatch') =>
      h('li', {}, h('span', { class: cls, style, 'aria-hidden': 'true' }), text);
    return h(
      'div',
      { class: 'diff-key colour-shift-key' },
      h(
        'p',
        { class: 'cs-question' },
        t.ratio.question(range(c.detectors[1]), range(c.detectors[0])),
        ' ',
        ratioToggle,
      ),
      h(
        'div',
        { class: 'cs-ratio-row' },
        ...maps,
        h(
          'ul',
          { class: 'cs-key cs-ratio-key' },
          sw('background: rgb(47 143 134)', t.ratio.red),
          sw('background: rgb(92 97 110)', t.ratio.equal),
          sw('background: rgb(227 237 165)', t.ratio.blue),
          sw('', t.ratio.masked, 'cs-swatch cs-hatch'),
          h(
            'li',
            {},
            h('span', { class: 'cs-glyph light', 'aria-hidden': 'true' }, '○'),
            t.ratio.ring,
          ),
          h(
            'li',
            {},
            h('span', { class: 'cs-glyph target', 'aria-hidden': 'true' }, '◇'),
            t.keyTarget(name),
          ),
        ),
      ),
      h('p', { class: 'hint' }, t.ratio.caption(name)),
      h(
        'details',
        { class: 'why' },
        h('summary', {}, t.ratio.whatRed),
        h('p', { class: 'hint' }, t.ratio.redMeans),
      ),
    );
  }
  return h(
    'div',
    { class: 'diff-key colour-shift-key' },
    h('p', { class: 'cs-question' }, t.question, ' ', c.reddest ? ratioToggle : ''),
    colourShiftFigure({
      columns: [
        t.column(c.detectors[0], range(c.detectors[0])),
        t.column(c.detectors[1], range(c.detectors[1])),
      ],
      rows: [early, late].map((L) => {
        const date = monthYear(L.mjd);
        // Short, horizontal row labels; the full date is in each panel's name (Viewer).
        const short = new Date((L.mjd - 40587) * 86400000).toLocaleDateString('en-GB', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
        return {
          label: short,
          cells: [cell(L.a, L.panels[0], date), cell(L.b, L.panels[1], date)] as [
            ReturnType<typeof cell>,
            ReturnType<typeof cell>,
          ],
        };
      }),
      key: {
        light: t.keyLight,
        neighbour: t.keyNeighbour(n.g.toFixed(1)),
        target: t.keyTarget(name),
      },
      aside: [
        // Lead with what's robust: the shift off the neighbour between the colours (Viewer).
        h(
          'p',
          { class: 'hint' },
          t.shift(
            [early, late].map((L) => ({
              date: monthYear(L.mjd),
              short: L.panels[0].fromNeighbour.toFixed(1),
              long: L.panels[1].fromNeighbour.toFixed(1),
            })),
            name,
          ),
          ' ',
          t.motion(
            name,
            targetMoved.toFixed(1),
            neighbourMoved < 0.01 ? null : neighbourMoved.toFixed(2),
          ),
        ),
      ],
    }),
    h(
      'details',
      { class: 'why' },
      h('summary', {}, t.howHeading),
      h(
        'p',
        { class: 'hint' },
        t.how,
        ' ',
        t.distances(
          [early, late].map((L) => ({
            date: monthYear(L.mjd),
            fromNeighbour: L.panels[1].fromNeighbour.toFixed(1),
            fromTarget: L.panels[1].fromTarget.toFixed(1),
          })),
          name,
        ),
      ),
    ),
  );
}

/** The one block under the views: the path figure, or the spot card, or the active view's own. */
function compareModeBlock(look: LiveLook | null, pathFig: HTMLElement | null): HTMLElement | null {
  if (pathFig) return pathFig;
  const card = spotCard();
  // The fade's slider stays with the card (it's one line); the keys give way to it.
  if (fadeAt !== null) return card ? h('div', {}, fadeControl() ?? '', card) : fadeControl();
  if (card) return card;
  if (colourShiftOn && !look) return colourShiftBlock();
  if (differencing) return differenceKey();
  return look ? liveTimeColourKey(look) : timeColourKey();
}

/** "Fade between the looks": a slider from the earlier look to the later (Viewer, 15 Nov). */
function fadeControl(): HTMLElement | null {
  const pair = fadePair();
  if (!pair) return null;
  const f = copy.show.fade;
  const value = Math.round((fadeAt ?? 0) * 100);
  const input = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    value: String(value),
    class: 'fade-range',
    'aria-label': f.name,
    'aria-valuetext': f.valueText(value, pair.late),
  }) as HTMLInputElement;
  // Dragging redraws only the lens, never the page, so the slider keeps the pointer.
  input.addEventListener('input', () => {
    const v = Number(input.value);
    input.setAttribute('aria-valuetext', f.valueText(v, pair.late));
    showFade(v / 100);
  });
  // Other buttons' pressed states catch up once the drag ends.
  input.addEventListener('change', () => render());
  const reset =
    fadeAt !== null ? h('button', { type: 'button', class: 'link-button' }, f.off) : null;
  reset?.addEventListener('click', () => endFade());
  return h(
    'div',
    { class: 'fade-control' },
    h('span', { class: 'fade-end' }, pair.early),
    input,
    h('span', { class: 'fade-end' }, pair.late),
    reset,
  );
}

/** A live look's fair pair: the earlier and later photo's tiles, from those read. */
function livePairTiles(look: LiveLook): [Tile, Tile, number, number] | null {
  const plan = look.plan;
  if (plan?.kind !== 'pair') return null;
  const at = (key: string) => look.landed.findIndex((x) => x.key === key);
  const ia = at(plan.pair.a.hit.key);
  const ib = at(plan.pair.b.hit.key);
  const a = look.tiles[ia];
  const b = look.tiles[ib];
  if (!a || !b) return null;
  return [a, b, plan.pair.a.mjd, plan.pair.b.mjd];
}

function showLiveTimeColour(look: LiveLook): void {
  const pair = livePairTiles(look);
  if (!pair) return;
  endFade(false);
  const [a, b, ta, tb] = pair;
  if (liveRange?.playing) leaveLiveRange();
  stopReveal?.();
  liveColouring = true;
  lens.setRendered([
    { tile: b, image: renderTimeColour(a, b, sharedStretch([a.pixels, b.pixels])) },
  ]);
  lensLabel.replaceChildren(
    h(
      'span',
      { class: 'look-pill diff-pill' },
      copy.show.byDateLabel(monthYear(ta), monthYear(tb)),
    ),
  );
  render();
}

function endLiveTimeColour(redraw = true): void {
  if (!liveColouring) return;
  const look = live;
  // showLivePhoto puts the photos back on the lens and clears the flag.
  if (look?.stretch) showLivePhoto(look.tiles.length - 1);
  else liveColouring = false;
  if (redraw) render();
}

/** The live look's key: the pair's dates, and the same caveats (no measured move here). */
function liveTimeColourKey(look: LiveLook): HTMLElement | null {
  const pair = liveColouring ? livePairTiles(look) : null;
  if (!pair) return null;
  const k = copy.show.byDateKey;
  const swatch = (rgb: readonly number[]) =>
    h('i', {
      class: 'date-swatch',
      style: `background: rgb(${rgb.join(' ')})`,
      'aria-hidden': 'true',
    });
  return h(
    'div',
    { class: 'diff-key date-key' },
    h(
      'p',
      { class: 'date-scale' },
      swatch(TIME_EARLY),
      h('span', {}, monthYear(pair[2])),
      swatch(TIME_LATE),
      h('span', {}, monthYear(pair[3])),
      swatch([255, 255, 255]),
      h('span', {}, k.white),
    ),
    h(
      'details',
      { class: 'why' },
      h('summary', {}, k.howToRead),
      h('p', { class: 'hint' }, k.brightness),
      h('p', { class: 'hint' }, k.speckle),
      h('p', { class: 'hint' }, k.fringes),
      h('p', { class: 'hint' }, h('i', { class: 'diff-hatch', 'aria-hidden': 'true' }), k.masked),
    ),
  );
}

/** Shows the pair as one picture: the earlier look blue, the later orange, white = didn't move. */
function showTimeColour(): void {
  if (!takeLens() || !current) return;
  endFade(false);
  if (differencing) endDifference(false);
  dropDifference();
  endSpot(false);
  const [a, b] = current.pair;
  if (!a || !b) return;
  colouring = true;
  lens.setRendered([
    { tile: b, image: renderTimeColour(a, b, sharedStretch([a.pixels, b.pixels])) },
  ]);
  // No arrows over it: the colours are the comparison (as with the difference).
  lens.setOverlay({ measured: undefined, predicted: undefined, arrowProgress: 0 });
  lensLabel.replaceChildren(
    h('span', { class: 'look-pill diff-pill' }, copy.show.byDateLabel(lookMonth(0), lookMonth(1))),
  );
  render();
}

function endTimeColour(redraw = true): void {
  if (!colouring || !current) return;
  colouring = false;
  lens.setTiles(current.pair, sharedStretch(current.pair.map((t) => t.pixels)));
  showRevealStill(lens);
  showing = 1;
  setLensLabel(1, 8);
  if (redraw) render();
}

function smallMoveLine(k: typeof copy.show.byDateKey): HTMLElement | null {
  const show = current?.show;
  if (show?.kind !== 'motion') return null;
  const px = show.lengthPx;
  if (px >= 1.5) return null;
  return h(
    'p',
    { class: 'hint' },
    px < 1 ? k.smallMove(fixed(px, 1), angleText(show.lengthArcsec)) : k.narrowMove(fixed(px, 1)),
  );
}

/** Under the actions while colouring: which date is which colour, and what else tints. */
function timeColourKey(): HTMLElement | null {
  if (!colouring) return null;
  const k = copy.show.byDateKey;
  const swatch = (rgb: readonly number[]) =>
    h('i', {
      class: 'date-swatch',
      style: `background: rgb(${rgb.join(' ')})`,
      'aria-hidden': 'true',
    });
  return h(
    'div',
    { class: 'diff-key date-key' },
    h(
      'p',
      { class: 'date-scale' },
      swatch(TIME_EARLY),
      h('span', {}, lookMonth(0)),
      swatch(TIME_LATE),
      h('span', {}, lookMonth(1)),
      swatch([255, 255, 255]),
      h('span', {}, k.white),
    ),
    // How big this pair's move is, with the page's own numbers (Viewer, 15 Nov): under a pixel
    // the still can only show a faint fringe, and saying so points to the clearer views.
    smallMoveLine(k),
    // The caveats fold away so Compare fits at 1280x720 (Viewer's audit); the scale stays.
    h(
      'details',
      { class: 'why' },
      h('summary', {}, k.howToRead),
      h('p', { class: 'hint' }, k.brightness),
      h('p', { class: 'hint' }, k.fringes),
      h('p', { class: 'hint' }, h('i', { class: 'diff-hatch', 'aria-hidden': 'true' }), k.masked),
    ),
  );
}

/** Space holds to compare, except where it already means something: a focused control. */
function spaceIsFree(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  if (el.classList.contains('hold')) return true;
  return !el.matches('button, a, input, select, textarea, summary, [contenteditable]');
}
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && spaceIsFree()) {
    e.preventDefault();
    holdStart();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') holdEnd();
});

/* ---------- rendering ---------- */

function caseLine(id: TargetId): string {
  const p = packs.get(id);
  if (!p) return copy.card.comingSoon;
  const s = showFor(p);
  if (s.kind === 'motion') {
    return copy.card.moved(arcsecAboutText(s.lengthArcsec));
  }
  return id === 'r-dra' || id === 'rw-aur' ? statusText(id, p) : '';
}

/** A status target's one-line status: from its pack's own test when it has one (RW Aur on DR1+QR3). */
/** Why RW Aur's brightness isn't measured, from its pack ("286 of 303 photos saturated…"). */
function rwAurUnmeasured(pack: LoadedPack): string | null {
  const m = pack.measurements.find((x) => x.key === 'brightness-change');
  return m && m.status !== 'MEASURED' ? (m.basis[0] ?? null) : null;
}

/** "September 2025": the mean date of a pass's photos. */
function passMonth(pack: LoadedPack, season: number): string {
  const f = pack.manifest.frames.filter((x) => x.season === season);
  return f.length ? monthYear(f.reduce((a, x) => a + x.mjd, 0) / f.length) : '';
}

/** Whether any brightness measurement's basis says this (the pipeline's own caveats). */
function basisSays(pack: LoadedPack, re: RegExp): boolean {
  return pack.measurements.some(
    (m) => m.key.startsWith('brightness') && re.test(m.basis.join(' ')),
  );
}

/** What the steady-star test gave in the detectors with a number: "1.00" to "1.03". */
function steadyRange(ratios: BrightnessRatio[]): { lo: string; hi: string } | null {
  const vals = ratios
    .filter((r) => r.ratio != null && r.steady?.passed)
    .flatMap((r) => r.steady?.ratios ?? []);
  if (!vals.length) return null;
  return { lo: Math.min(...vals).toFixed(2), hi: Math.max(...vals).toFixed(2) };
}

/** "3.8–5 µm", or "1.1–2.4 µm and 3.8–5 µm": runs of neighbouring detectors, merged. */
function detectorRange(detectors: number[]): string {
  const runs: [number, number][] = [];
  for (const d of [...detectors].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  return list(
    runs.map(([a, b]) => copy.brightness.range(RANGES[a - 1]?.[0] ?? 0, RANGES[b - 1]?.[1] ?? 0)),
  );
}

/**
 * A saturated star's measured brightness change, from its pack's ratio keys for the headline
 * pair: one sentence when the passing detectors are neighbours that agree within their errors
 * (using the pack's own combined value), otherwise one clause per detector. Null if none passed.
 */
function brightnessSentence(name: string, pack: LoadedPack): string | null {
  const pair = brightnessPair(pack);
  const change = pack.measurements.find((m) => m.key === 'brightness-change');
  const value = change?.status === 'MEASURED' ? change.value : null;
  if (!pair || value == null) return null;
  const ok = brightnessRatios(pack, pair).filter((r) => r.ratio != null);
  if (!ok.length) return null;
  const from = passMonth(pack, pair[0]);
  const to = passMonth(pack, pair[1]);
  const sys = ok.find((r) => r.systematic != null)?.systematic ?? null;
  const neighbours = ok.every((r, i) => i === 0 || r.detector === (ok[i - 1]?.detector ?? 0) + 1);
  const agree = ok.every(
    (r) => Math.abs((r.ratio ?? 0) - value) <= Math.hypot(r.error ?? 0, change?.error ?? 0),
  );
  const parts =
    neighbours && agree
      ? [{ range: detectorRange(ok.map((r) => r.detector)), r: value, err: change?.error ?? 0 }]
      : ok.map((r) => ({ range: detectorRange([r.detector]), r: r.ratio ?? 0, err: r.error ?? 0 }));
  const line = copy.brightness.sentence(name, parts, from, to, sys);
  return basisSays(pack, /combined light/) ? `${line} ${copy.brightness.combinedSentence}` : line;
}

/**
 * When the edges were measured but the check failed because the comparison stars sit in the
 * star's own glare (R Dra): how much they varied, from the pack's basis; null otherwise.
 */
function glare(pack: LoadedPack): { pct: number | null } | null {
  const m = pack.measurements.find((x) => x.key === 'brightness-change');
  const text = m && m.status !== 'MEASURED' ? m.basis.join(' ') : '';
  if (!/glare/.test(text)) return null;
  const pct = text.match(/vary by (\d+)%/);
  return { pct: pct ? Number(pct[1]) : null };
}

function statusText(id: 'r-dra' | 'rw-aur', pack: LoadedPack): string {
  const measured = brightnessSentence(copy.wanderers[id].name, pack);
  if (measured) return measured;
  if (id === 'r-dra')
    return glare(pack) ? copy.cases['r-dra'].statusGlare : copy.cases['r-dra'].status;
  const t = scatterTest(pack);
  if (!t?.above.length) return copy.cases['rw-aur'].statusUnmeasured(rwAurUnmeasured(pack));
  const thin = t.detectors
    .filter((d) => t.thin.includes(d.detector))
    .map((d) => ({ range: d.detector, controls: d.controls ?? 0 }));
  return copy.cases['rw-aur'].statusScatter(t.above.length, t.detectors.length, thin);
}

/** Every layer on the sky and its source, one click away (a native disclosure). */
let legendOpen = false;
function legend(withKey = false): HTMLElement {
  const d = h(
    'details',
    { class: 'legend', open: legendOpen },
    h('summary', {}, copy.legend.title),
    h('ul', {}, ...copy.legend.layers.map((l) => h('li', {}, l))),
    // On the homepage the marks' key lives here, not in the band (Viewer, 14 Nov).
    withKey ? markKey('sky') : null,
    withKey ? h('p', { class: 'hint' }, h('a', { href: 'tests.html' }, copy.tests.link)) : null,
    withKey
      ? h('p', { class: 'hint' }, h('a', { href: 'fieldguide.html' }, copy.fieldguide.linkShort))
      : null,
    // Light or dark lives here, not in the header (Sumit, 15 Nov): every device reaches it.
    schemeChoice(copy.scheme),
  );
  // The words re-render on every state change; the legend stays as the viewer left it.
  d.addEventListener('toggle', () => (legendOpen = d.open));
  return d;
}

/** The card's status line, with a moved range tagged for Physics' checker. */
function caseNodes(id: TargetId): Node[] {
  const p = packs.get(id);
  const s = p && showFor(p);
  if (!s || s.kind !== 'motion') return [document.createTextNode(caseLine(id))];
  const keys = [s.keys.north, s.keys.east];
  return fill(copy.card.movedOne, {
    lo: claim(String(arcsecAbout(s.lengthArcsec)), id, keys, 'derived:arcsec-about'),
  });
}

/**
 * A card's status line. A measured move shows its number and its way ("≈ 6″ north", tagged
 * for the checker); the others keep the shared words ("not confirmed", "not measured yet").
 */
/** A chip's words: a measured brightness change says which way (headline pair). */
function chipLabel(id: TargetId, status: keyof typeof copy.statusChip): string {
  if (status !== 'brightness') return copy.statusChip[status];
  const v = packs.get(id)?.measurements.find((m) => m.key === 'brightness-change')?.value;
  return v == null ? copy.statusChip.brightness : copy.statusChip[v < 1 ? 'fainter' : 'brighter'];
}

function cardChip(id: TargetId, status: keyof typeof copy.statusChip): HTMLElement {
  const p = packs.get(id);
  const s = p && showFor(p);
  if (status !== 'measured' || !s || s.kind !== 'motion')
    return h('span', { class: `chip ${status}` }, chipLabel(id, status));
  return h(
    'span',
    { class: 'chip measured', title: copy.statusChip.measured },
    // One span inside the chip, so the number, ″ and the way read as one line, not gapped.
    h(
      'span',
      {},
      ...fill(copy.card.chipMoved, {
        lo: claim(
          String(arcsecAbout(s.lengthArcsec)),
          id,
          [s.keys.north, s.keys.east],
          'derived:arcsec-about',
        ),
        dir: s.direction,
      }),
    ),
  );
}

/** Each wanderer's status in the one shared vocabulary. */
function caseStatus(id: TargetId): keyof typeof copy.statusChip | null {
  const p = packs.get(id);
  if (!p) return null;
  if (showFor(p).kind === 'motion') return 'measured';
  if (p.measurements.some((m) => m.key === 'brightness-change' && m.status === 'MEASURED'))
    return 'brightness';
  // RW Aur is "not confirmed" only while its pack has a scatter test above its comparison stars.
  return id === 'rw-aur' && scatterTest(p)?.above.length ? 'unconfirmed' : 'unmeasured';
}

/**
 * "Meet the five": one quiet strip of chips, not a row of identical cards, so the lanterns
 * on the sky stay the bold element. Each chip opens its full status line on hover or focus.
 */
function caseRail(currentId?: TargetId): HTMLElement {
  return h(
    'div',
    { class: 'strip' },
    h('span', { class: 'strip-label' }, copy.card.meetFive),
    h(
      'ol',
      { class: 'rail' },
      ...WANDERERS.map((w) => {
        const p = packs.get(w.id);
        const stack = p?.manifest.stacks.filter((s) => s.kind === 'all-colour').at(-1);
        const tile = stack && p?.stacks.get(stack.id);
        const status = caseStatus(w.id);
        const card = h(
          'button',
          {
            type: 'button',
            class: w.id === currentId ? 'card current' : 'card',
            'data-id': w.id,
            disabled: !w.ready,
            'aria-current': w.id === currentId ? 'true' : undefined,
          },
          tile
            ? thumbnail(tile, sharedStretch([tile.pixels]), 40, copy.wanderers[w.id].name)
            : h('span', { class: 'thumb empty' }),
          h(
            'span',
            { class: 'card-text' },
            h('strong', {}, copy.wanderers[w.id].name),
            status
              ? cardChip(w.id, status)
              : // Ready but its pack still loading: say nothing rather than "coming soon".
                w.ready
                ? null
                : h('span', { class: 'chip' }, copy.card.comingSoon),
            h('span', { class: 'this-week-badge' }, copy.sky.sweep.thisWeek),
          ),
          h(
            'span',
            { class: 'card-more', role: 'tooltip' },
            copy.wanderers[w.id].short,
            '. ',
            ...caseNodes(w.id),
          ),
        );
        card.addEventListener('click', () => void go(w.id));
        card.addEventListener('pointerenter', () => sky.setLit(w.id));
        card.addEventListener('pointerleave', () => sky.setLit(null));
        return h('li', {}, card);
      }),
    ),
  );
}

/** With three or more passes, buttons for each pair of looks; the measured pair is marked. */
function pairChooser(id: TargetId): HTMLElement | null {
  if (!current) return null;
  const seasons = seasonsIn(current.pack);
  if (seasons.length < 3) return null;
  const shown = current.show.seasons;
  // The pair carrying the headline number: the measured move, or the measured brightness.
  const primary =
    showFor(current.pack).kind === 'motion'
      ? primaryPair(current.pack)
      : current.pack.measurements.some(
            (m) => m.key === 'brightness-change' && m.status === 'MEASURED',
          )
        ? brightnessPair(current.pack)
        : null;
  const same = (a: [number, number], b: [number, number] | null) =>
    b !== null && a[0] === b[0] && a[1] === b[1];
  const pairs: [number, number][] = [];
  for (let i = 0; i < seasons.length; i++)
    for (let j = i + 1; j < seasons.length; j++) pairs.push([seasons[i] ?? 0, seasons[j] ?? 0]);
  return h(
    'div',
    { class: 'pairs', role: 'group', 'aria-label': copy.show.pairs },
    h('span', { class: 'pairs-label' }, copy.show.pairs),
    ...pairs.map((p) => {
      const on = same(p, shown);
      const b = h(
        'button',
        {
          type: 'button',
          class: on ? 'on' : '',
          'aria-pressed': String(on),
          title: same(p, primary) ? copy.show.pairMeasured : '',
        },
        `${p[0] + 1} ↔ ${p[1] + 1}`,
        same(p, primary) ? h('span', { class: 'mk measured', 'aria-hidden': 'true' }) : null,
      );
      b.addEventListener('click', () => {
        if (on) return;
        chosenPair.set(id, p);
        void openWanderer(id);
      });
      return b;
    }),
  );
}

/** The looks of the pair on screen, small, numbered by their pass as the lens pill numbers them. */
function looksRow(): HTMLElement | null {
  if (!current) return null;
  const { pair } = current;
  const stretch = sharedStretch(pair.map((t) => t.pixels));
  return h(
    'div',
    { class: 'looks' },
    ...([0, 1] as const).map((i) =>
      h(
        'figure',
        {},
        thumbnail(pair[i], stretch, 72, lookName(i)),
        h('figcaption', {}, h('b', {}, String(passNo(i))), ' ', lookMonth(i)),
      ),
    ),
  );
}

/** A row of the facts list: a mark, a term, and a value (a dash and a reason when missing). */
function factRow(mark: string, term: string, ...value: (Node | string | null)[]): Node[] {
  return [
    h('dt', {}, h('span', { class: `mk ${mark}`, 'aria-hidden': 'true' }), term),
    h('dd', {}, ...value.filter((v): v is Node | string => v !== null)),
  ];
}

/** The spectrum row's value: measured (chart below), or why not, in a few words. */
function spectrumValue(id: TargetId): string {
  const d = spectra.get(id);
  if (d?.status === 'measured' && d.exposures.length) return copy.facts.spectrumMeasured;
  return id === 'w0855' ? copy.facts.spectrumBlended : copy.facts.spectrumTooBright;
}

function renderWords(): Node[] {
  const place = state.place;
  if (state.room === 'learn') {
    if (place.kind === 'sky') return [tourCard()];
    // In a show, the card alone while the lens does the showing; ε Indi B's step points at
    // its spectrum, so that one stays.
    if ('target' in place) {
      const spectrum = place.target === 'epsind-b' ? spectrumSection(place.target) : null;
      // N7: WISE 0855's Two colours, once the visitor chose it from the tour.
      const shift = place.target === 'w0855' && colourShiftOn ? colourShiftBlock() : null;
      return [tourCard(), spectrum, shift].filter((x): x is HTMLElement => x !== null);
    }
  }
  return showWords();
}

/**
 * The homepage column (agreed with Viewer, 14 Nov): the headline, the search field itself
 * (moved here from the header on the homepage only) with its dropdown, which holds the examples
 * (Sumit: "use them as a drop down… when clicked or start typing"), Surprise me, and a quiet
 * line for clicking the sky.
 */
function homeColumn(): HTMLElement[] {
  const parts: (HTMLElement | null)[] = [
    h('h2', { class: 'home-headline' }, copy.home.headline),
    h('p', { class: 'home-welcome' }, touchOnly ? copy.home.welcomeTouch : copy.home.welcome),
    h('div', { class: 'home-search on-sky' }, searchBox),
    searchNote ? h('p', { class: 'hint search-note', role: 'alert' }, searchNote) : null,
    surpriseButton(),
    // Judges need this; it lived in the strip, which moved to Learn (Viewer, 14 Nov).
    h('p', { class: 'home-tests' }, h('a', { href: 'tests.html' }, copy.tests.linkShort)),
    legend(true),
  ];
  return parts.filter((x): x is HTMLElement => x !== null);
}

/** Takes the visitor to a famous fast star or variable, for a live look. */
function surpriseButton(): HTMLElement {
  const b = h(
    'button',
    {
      type: 'button',
      class: 'surprise',
      disabled: !!surpriseFlight,
      'aria-busy': surpriseFlight ? 'true' : undefined,
    },
    surpriseFlight
      ? copy.surprise.flying(surpriseFlight)
      : surpriseOffer
        ? copy.surprise.openIt(surpriseOffer.spot.name)
        : copy.surprise.button,
  );
  // After an interrupted flight the button opens that star, for a few seconds.
  const offer = surpriseOffer;
  b.addEventListener('click', () => void (offer ? surpriseMe(offer.spot) : surpriseMe()));
  return h('div', { class: 'actions' }, b);
}

function showWords(): Node[] {
  const place = state.place;
  if (place.kind === 'sky') return homeColumn();
  if (place.kind === 'trouble') return [h('p', {}, copy.trouble[place.reason])];
  if (!('target' in place)) return lookWords();
  const w = copy.wanderers[place.target];
  if (!current || place.kind === 'diving') {
    return [h('p', { class: 'eyebrow' }, w.short), h('h2', {}, copy.show.expectation)];
  }

  // While the visitor plays "Spot the mover", the column holds only the question: the
  // headline and the facts would give the answer away.
  if (spot?.state === 'playing') {
    const game = spotSection(w.name);
    return [h('p', { class: 'eyebrow' }, w.short), h('h2', {}, copy.spot.heading), game].filter(
      (x): x is HTMLElement => x !== null,
    );
  }

  const { show } = current;
  const id = place.target;
  const ready = place.kind === 'ready' || place.kind === 'holding';
  const caseCopy: object | undefined = copy.cases[id as keyof typeof copy.cases];
  const story = caseCopy && 'story' in caseCopy ? String(caseCopy.story) : null;
  const status = caseStatus(id);
  const eyebrow = h(
    'p',
    { class: 'eyebrow' },
    status ? h('span', { class: `chip ${status}` }, chipLabel(id, status)) : null,
    h('span', {}, w.short),
  );
  // Ask for the spectrum early: its row says what it holds.
  const spectrum = spectrumSection(id);

  // The five's pages use the same summary + tabs; Watch is the Watch room itself.
  const pack = current.pack;
  const fiveTabs = (
    compare: (Node | null)[],
    facts: (Node | null)[],
    spectrumTab: (Node | null)[],
  ): TabSpec[] => [
    tabSpec('compare', compare),
    tabSpec(
      'watch',
      state.room === 'watch'
        ? [
            colourWindows(pack, playColour, watching),
            ...(watching !== null ? [seriesBar, filmNote, seriesMeta] : []),
            // The two extra views share one fold so the tab fits while a film plays.
            h(
              'details',
              { class: 'why coadds-fold' },
              h('summary', {}, copy.watch.moreViews),
              coaddSection(pack),
              contextSection(pack),
            ),
          ]
        : [],
      {
        badge: String(pack.manifest.frames.length),
        badgeLabel: copy.panel.badge.photos(String(pack.manifest.frames.length)),
        cue: watchCue(),
      },
    ),
    tabSpec('facts', facts),
    tabSpec(
      'spectrum',
      spectrumTab.length ? spectrumTab : [h('p', { class: 'hint' }, copy.panel.noSpectrum)],
      {
        badge: spectra.get(id)?.status === 'measured' ? '●' : null,
        badgeLabel: copy.panel.badge.measured,
      },
    ),
  ];

  const out: (HTMLElement | null)[] = [eyebrow];
  const rows: Node[] = [];

  if (show.kind === 'motion') {
    const keys = [show.keys.north, show.keys.east];
    const about = arcsecAbout(show.lengthArcsec);
    const metres = coinDistanceMetres(about, about);
    const predictedPx = show.predicted
      ? Math.hypot(show.predicted.east, show.predicted.north)
      : null;
    out.push(
      h('h2', {}, ready ? copy.show.movedDir(w.name, show.direction) : copy.show.expectation),
    );
    // Until the pack is in, the headline's place is held (it arrived seconds later and pushed
    // the tabs down: Sumit, 15 Nov).
    if (!ready)
      out.push(
        h(
          'div',
          { class: 'hero-move skel-hero', 'aria-hidden': 'true' },
          h('span', { class: 'about' }, '\u00a0'),
          skel('big skel-num', '00″'),
          h(
            'span',
            { class: 'unit' },
            skel('', 'arcseconds north'),
            skel('dates', 'Aug 2025 → Aug 2026'),
          ),
        ),
      );
    if (ready) {
      // One number with its unit, then the line that backs it up.
      out.push(
        h(
          'div',
          { class: 'hero-move' },
          h('span', { class: 'about' }, copy.facts.about),
          h(
            'span',
            { class: 'big' },
            claim(String(about), id, keys, 'derived:arcsec-about'),
            copy.facts.arcsec,
          ),
          directionArrow(show.measured),
          h(
            'span',
            { class: 'unit' },
            h('span', {}, copy.facts.arcsecDir(show.direction)),
            h('span', { class: 'dates' }, `${lookMonth(0)} → ${lookMonth(1)}`),
          ),
        ),
        howSure(
          show.lengthPx,
          show.measuredError,
          predictedPx,
          show.stillStar?.p90 ?? null,
          current.pack.manifest.grid.pixelScaleArcsec,
          [
            h(
              'span',
              {},
              h('span', { class: 'mk measured', 'aria-hidden': 'true' }),
              claim(fixed(show.lengthPx), id, keys, 'derived:length'),
              ' ± ',
              claim(fixed(show.measuredError), id, keys, 'derived:length-error'),
              ` ${copy.facts.unitPx} ${copy.evidence.measuredLabel}`,
            ),
            predictedPx !== null
              ? h(
                  'span',
                  {},
                  h('span', { class: 'mk predicted', 'aria-hidden': 'true' }),
                  claim(fixed(predictedPx), id, keys, 'derived:predicted-length'),
                  ` ${copy.facts.unitPx} ${copy.evidence.predictedLabel}`,
                )
              : null,
            show.stillStar?.p90 != null
              ? h(
                  'span',
                  {},
                  h('span', { class: 'mk steady', 'aria-hidden': 'true' }),
                  copy.facts.steady.toLowerCase(),
                )
              : null,
          ].filter((x): x is HTMLElement => x !== null),
        ),
        h(
          'p',
          { class: 'coin-line' },
          h('span', { class: 'coin', 'aria-hidden': 'true' }),
          ...fill(copy.facts.coin, { metres: claim(String(metres), id, keys, 'derived:coin') }),
        ),
      );
    } else {
      out.push(h('p', { class: 'hint' }, copy.show.trueScale));
    }

    // The same rows, in the same order, for every object (Z): a dash and a reason where empty.
    const moveBits = [
      show.measuredOn.length ? copy.facts.measuredOnValue(show.measuredOn) : null,
      show.measuredBy,
      show.agreesWith ? copy.facts.secondCheckValue : null,
    ].filter((x): x is string => !!x);
    rows.push(...factRow('measured', copy.facts.move, moveBits.join(' · ')));
    rows.push(
      ...(predictedPx !== null
        ? factRow(
            'predicted',
            copy.facts.predicted,
            ...fill(copy.facts.predictedValue, {
              value: claim(fixed(predictedPx), id, keys, 'derived:predicted-length'),
              source: show.predictionSource ? predictionLabel(show.predictionSource) : '',
            }),
          )
        : factRow('unmeasured', copy.facts.predicted, copy.facts.dash.noPrediction)),
    );
    const still = show.stillStar;
    if (still?.p90 != null) {
      const band = still.p90Key ? claim(fixed(still.p90), id, [still.p90Key]) : fixed(still.p90);
      rows.push(
        ...factRow(
          'steady',
          copy.facts.steady,
          ...(show.relative && still.common != null
            ? fill(copy.facts.steadyCorrected, {
                band,
                common: still.commonKeys
                  ? claim(fixed(still.common), id, still.commonKeys, 'derived:length')
                  : fixed(still.common),
              })
            : fill(copy.facts.steadyPlain, { band })),
        ),
      );
    } else rows.push(...factRow('unmeasured', copy.facts.steady, copy.facts.dash.none));
    rows.push(...factRow('unmeasured', copy.facts.brightness, copy.facts.dash.positionShow));
  } else {
    // A status show leads with its status; the story folds away.
    const primary = primaryPair(current.pack);
    const line =
      show.kind === 'status' && show.pairNote
        ? copy.show[show.pairNote === 'unverified' ? 'pairUnverified' : 'pairUnmeasured'](
            show.seasons[0] + 1,
            show.seasons[1] + 1,
            primary[0] + 1,
            primary[1] + 1,
          )
        : id === 'r-dra' || id === 'rw-aur'
          ? statusText(id, current.pack)
          : null;
    out.push(h('h2', {}, w.name), line ? h('p', { class: 'status-line' }, line) : null);
    if (show.kind === 'status' && show.pairNote) {
      // Still a position story, just no trusted number for this pair.
      const why =
        show.pairNote === 'unverified'
          ? copy.facts.dash.pairUnverified
          : copy.facts.dash.pairUnmeasured;
      rows.push(...factRow('unmeasured', copy.facts.move, why));
      rows.push(...factRow('unmeasured', copy.facts.predicted, copy.facts.dash.nothingToCompare));
      rows.push(...factRow('unmeasured', copy.facts.steady, copy.facts.dash.nothingToCompare));
      rows.push(...factRow('unmeasured', copy.facts.brightness, copy.facts.dash.positionShow));
    } else {
      rows.push(...factRow('unmeasured', copy.facts.move, copy.facts.dash.brightnessShow));
      rows.push(...factRow('unmeasured', copy.facts.predicted, copy.facts.dash.nothingToCompare));
      rows.push(...factRow('unmeasured', copy.facts.steady, copy.facts.dash.nothingToCompare));
      const scatter = id === 'rw-aur' ? scatterTest(current.pack) : null;
      const ratios = brightnessRatios(current.pack, show.seasons);
      if (ratios.some((r) => r.ratio != null))
        rows.push(
          ...factRow(
            'measured',
            copy.facts.brightness,
            copy.brightness.row(
              show.seasons[1] + 1,
              show.seasons[0] + 1,
              ratios
                .filter((r) => r.ratio != null)
                .map((r) => [detectorRange([r.detector]), r.ratio ?? 0, r.error ?? 0] as const),
              ratios.filter((r) => r.ratio == null).map((r) => detectorRange([r.detector])),
            ),
            basisSays(current.pack, /combined light/) ? ` ${copy.brightness.combined}` : '',
            h(
              'details',
              { class: 'why' },
              h('summary', {}, copy.brightness.howHeading),
              h(
                'p',
                {},
                copy.brightness.how(
                  ratios.find((r) => r.systematic != null)?.systematic ?? null,
                  steadyRange(ratios),
                  {
                    toleranceAfter: basisSays(current.pack, /chosen after seeing/),
                    combined: basisSays(current.pack, /combined light/),
                  },
                ),
              ),
            ),
          ),
        );
      else if (glare(current.pack))
        rows.push(
          ...factRow(
            'unmeasured',
            copy.facts.brightness,
            `— ${copy.facts.glareBrightness(glare(current.pack)?.pct ?? null)}`,
          ),
        );
      else if (ratios.length)
        rows.push(
          ...factRow(
            'unmeasured',
            copy.facts.brightness,
            `— ${copy.brightness.noneForPair(show.seasons[0] + 1, show.seasons[1] + 1)}`,
          ),
        );
      else if (scatter?.above.length)
        rows.push(
          ...factRow(
            'unconfirmed',
            copy.facts.brightness,
            copy.facts.rwAurScatter(
              scatter.above.map((d) => ({
                range: d,
                controls: scatter.detectors.find((x) => x.detector === d)?.controls ?? null,
              })),
            ),
          ),
        );
      else if (id === 'rw-aur')
        rows.push(
          ...factRow(
            'unmeasured',
            copy.facts.brightness,
            `— ${copy.facts.rwAurUnmeasured(rwAurUnmeasured(current.pack))}`,
          ),
        );
      else
        rows.push(
          ...factRow('unmeasured', copy.facts.brightness, `— ${copy.facts.rDraBrightness}`),
        );
    }
  }
  const measuredSpectrum = spectra.get(id)?.status === 'measured';
  rows.push(
    ...factRow(
      measuredSpectrum ? 'measured' : 'unmeasured',
      copy.facts.spectrum,
      measuredSpectrum ? spectrumValue(id) : `— ${spectrumValue(id)}`,
    ),
  );
  rows.push(
    ...factRow(
      'flag',
      copy.facts.flags,
      flagsControl(current.pair, current.pack.manifest.target.id),
    ),
  );
  rows.push(
    ...factRow('catalogue', copy.facts.catalogue, overlaySection(id) ?? copy.facts.dash.loading),
  );

  const canHold = !!stackPair(current.pack, 'one-detector', show.seasons);
  const actions = h('div', { class: 'actions' });
  if (canHold) {
    const hold = h(
      'button',
      { type: 'button', class: 'primary hold', disabled: !ready && place.kind !== 'reveal' },
      copy.show.hold,
      h('kbd', {}, copy.show.holdKey),
    );
    hold.addEventListener('pointerdown', holdStart);
    hold.addEventListener('pointerup', holdEnd);
    hold.addEventListener('pointerleave', holdEnd);
    actions.append(hold);
  }
  const replay = h('button', { type: 'button' }, copy.show.replay);
  replay.addEventListener('click', () => {
    leaveDifference();
    dispatch({ type: 'tapLantern', target: id });
    dispatch({ type: 'packReady' });
    startReveal();
  });
  actions.append(replay);
  out.push(actions);
  // The views as one row; the active one's block is placed with the path figure below.
  out.push(compareModes(null));
  // Only while the pack is still arriving; during the reveal, holding simply ends it.
  if (canHold && !ready && place.kind !== 'reveal')
    out.push(h('p', { class: 'hint' }, copy.show.holdNotYet));
  out.push(spotSection(w.name));
  if (!touchOnly) out.push(h('p', { class: 'hint keys-hint' }, copy.keys.hint));
  if (diffTrouble) out.push(h('p', { class: 'hint', role: 'status' }, copy.show.diffTrouble));

  // Option A: the summary keeps the name and the headline result (ember when measured); the
  // rest goes in tabs. "How sure" and the coin line move to Facts with the rows.
  const isSummary = (n: HTMLElement | null) =>
    !!n &&
    (n === eyebrow ||
      n.tagName === 'H2' ||
      n.classList.contains('hero-move') ||
      n.classList.contains('status-line'));
  const isFact = (n: HTMLElement | null) =>
    !!n &&
    (n.classList.contains('how-sure') ||
      n.classList.contains('coin-line') ||
      (n.tagName === 'P' && n.classList.contains('hint') && n.textContent === copy.show.trueScale));
  const summary: (Node | null)[] = out.filter(isSummary);
  if (typedNote?.id === id) {
    // An arrival message: it closes with ✕, or by itself once another tab is opened.
    const close = h(
      'button',
      { type: 'button', class: 'typed-close', 'aria-label': copy.search.closeNote },
      '✕',
    );
    close.addEventListener('click', () => {
      typedNote = null;
      pathShown = false;
      render();
    });
    // The path figure opens in Compare's body, not here: the summary must fit without scrolling
    // and keep the measured result first (Viewer, 15 Nov). One control on every screen size.
    const see = typedNote.path
      ? h(
          'button',
          { type: 'button', class: 'link-button', 'aria-expanded': String(pathShown) },
          pathShown ? copy.search.path.hide : copy.search.path.show,
        )
      : null;
    see?.addEventListener('click', () => {
      pathShown = !pathShown;
      if (pathShown && activeTab() !== 'compare') selectTab('compare');
      else render();
    });
    summary.splice(
      1,
      0,
      h('p', { class: 'typed-note', role: 'status' }, typedNote.text, see ? ' ' : '', see, close),
    );
  }
  // "How sure": its one-line legend (measured ± error, predicted) stays open; the chart folds.
  const factsTop = out.filter(isFact).map((n) => {
    if (!n?.classList.contains('how-sure')) return n;
    const legend = n.querySelector('.legend');
    return h(
      'details',
      { class: 'why how-sure-fold' },
      h('summary', {}, ...(legend ? Array.from(legend.cloneNode(true).childNodes) : [])),
      n,
    );
  });
  // Compare: the main buttons, the looks, then one quiet row of the rest (Spot the mover's
  // explanation becomes its tooltip; the keys line lives in the ? help).
  let compare = out.filter(
    (n) => n && !isSummary(n) && !isFact(n) && !n.classList.contains('keys-hint'),
  );
  const spotEl = !spot ? compare.find((n) => n?.classList.contains('spot')) : undefined;
  const spotBtn = spotEl?.querySelector('button') ?? null;
  let spotRow: HTMLElement | null = null;
  if (spotBtn) {
    // The explanation stays visible beside the button (touch has no tooltips) and is its description.
    const what = h('span', { class: 'hint spot-what', id: 'spot-what' }, copy.spot.what);
    spotBtn.setAttribute('aria-describedby', 'spot-what');
    spotRow = h('div', { class: 'actions spot-row' }, spotBtn, what);
    compare = compare.filter((n) => n !== spotEl);
  }
  const keysBtn = touchOnly
    ? null
    : h(
        'button',
        { type: 'button', class: 'keys-button', 'aria-haspopup': 'dialog' },
        copy.keys.button,
      );
  keysBtn?.addEventListener('click', openKeys);
  // On the Hold/Replay line, which has room: no extra height (Viewer's audit).
  actions.append(copyLinkButton(), ...(keysBtn ? [keysBtn] : []));
  // The path from the typed year to today (queue #4) takes the active view's slot.
  const pathFig = pathShown && typedNote?.id === id ? typedPathFigure(id, typedNote.path) : null;
  const modeBar = compare.findIndex((n) => n?.classList.contains('mode-bar'));
  compare.splice(modeBar + 1, 0, compareModeBlock(null, pathFig));
  // The chooser is labelled "Compare looks" itself, so no heading (Viewer's audit: fit).
  // While marking, the lens shows the look, so the thumbnails give way to the card (fit).
  // "Two colours" shows both looks itself, so the chooser gives way too (fit).
  compare.push(
    colourShiftOn ? null : pairChooser(id),
    markMode || colourShiftOn ? null : looksRow(),
    spotRow,
  );
  const facts: (Node | null)[] = [
    ...factsTop,
    h('dl', { class: 'facts' }, ...rows),
    // Moved from Compare (Viewer's audit): the release, links out and the tests page, one line.
    factsFooter(
      current.pack.manifest.grid.centre,
      copy.show.release(
        current.pack.manifest.release,
        framesReleases(current.pack.manifest.frames.map((f) => f.mjd)),
      ),
      true,
    ),
  ];
  if (show.kind === 'motion' && show.stillStar?.common != null && show.relative) {
    const cause = id === 'barnard' ? copy.cases.barnard.sharedShift : null;
    facts.push(
      h(
        'details',
        { class: 'why' },
        h('summary', {}, copy.evidence.whyShift),
        h('p', {}, [cause, copy.evidence.stillStarsCancel(w.name)].filter(Boolean).join(' ')),
      ),
    );
  }
  if (story)
    facts.push(
      h(
        'details',
        { class: 'why' },
        h('summary', {}, copy.show.whyNamed(copy.wanderers[id].name)),
        h('p', {}, story),
      ),
    );
  // In the Watch room the summary (with the measured result) is the same; only the tab differs.
  return panelOf(
    summary,
    fiveTabs(state.room === 'watch' ? [] : compare, facts, spectrum ? [spectrum] : []),
  );
}

/** The context sections, one per target, kept across renders (their slider and open state). */
const contextSections = new Map<TargetId, { section: HTMLElement; show: () => void }>();
/** One Aladin for the page, moved into whichever section is open and re-aimed there. */
const contextBox = h('div', { class: 'context-map' });
let contextMap: Promise<ContextMap> | null = null;
/** Opens near 2.2 µm, where stars are bright and the sky is dark; the slider goes 0.77–5 µm. */
const CONTEXT_START = CUBE_UM.findIndex((um) => um >= 2.2);

/**
 * SPHEREx's own all-sky map around the target (IRSA's DR1 HiPS cube in Aladin Lite), one colour
 * at a time, with the lens's field as a box. Loaded only when first opened.
 */
function contextSection(pack: LoadedPack): HTMLElement {
  const id = pack.manifest.target.id;
  const cached = contextSections.get(id);
  if (cached) {
    // Back on a target whose map was left open: the one map comes back here, aimed again.
    if ((cached.section as HTMLDetailsElement).open) cached.show();
    return cached.section;
  }
  const g = pack.manifest.grid;
  const fieldDeg = (g.size * g.pixelScaleArcsec) / 3600;
  const slot = h('div', { class: 'context-slot' });
  const slider = h('input', {
    type: 'range',
    min: String(FIRST_FRAME),
    max: String(CUBE_UM.length - 1),
    step: '1',
    value: String(CONTEXT_START),
    'aria-label': copy.context.slider,
  }) as HTMLInputElement;
  const value = h('output', { class: 'context-um' });
  const label = () => {
    const i = Number(slider.value);
    const text = copy.context.wavelength((CUBE_UM[i] ?? 0).toFixed(2), BLANK_FRAMES.has(i));
    value.textContent = text;
    slider.setAttribute('aria-valuetext', text);
  };
  label();
  const section = h(
    'details',
    { class: 'why context' },
    h('summary', {}, copy.context.heading),
    h('p', { class: 'hint' }, copy.context.what),
    slot,
    h(
      'div',
      { class: 'context-bar' },
      h('span', {}, copy.context.blue),
      slider,
      h('span', {}, copy.context.red),
      value,
    ),
  ) as HTMLDetailsElement;
  const ready = () => contextMap ?? Promise.reject(new Error('map not opened'));
  slider.addEventListener('input', () => {
    label();
    void ready()
      .then((m) => m.setFrame(Number(slider.value)))
      .catch(() => undefined);
  });
  const show = () => {
    slot.append(contextBox);
    if (!contextMap) {
      const look = getComputedStyle(document.documentElement).getPropertyValue('--sky-look');
      contextMap = openContextMap(contextBox, look.trim() || '#6fb7d6');
      contextMap.catch(() => {
        contextMap = null;
        contextBox.replaceChildren(h('p', { class: 'hint' }, copy.context.failed));
      });
    }
    void contextMap
      .then((m) => {
        m.aim(g.centre, fieldDeg * 4, fieldDeg);
        m.setFrame(Number(slider.value));
      })
      .catch(() => undefined);
  };
  section.addEventListener('toggle', () => {
    if (section.open) show();
  });
  contextSections.set(id, { section, show });
  return section;
}

/** The move's direction as an arrow on the sky's own axes: north up, east to the left. */
function directionArrow(v: { east: number; north: number }): HTMLElement {
  const deg = (Math.atan2(-v.east, v.north) * 180) / Math.PI;
  return h(
    'span',
    { class: 'dir', 'aria-hidden': 'true', style: `transform: rotate(${deg.toFixed(1)}deg)` },
    '↑',
  );
}

/**
 * A copy-deck template with {slots} filled by text or elements, so a sentence keeps its
 * numbers as separate, checkable elements.
 */
function fill(template: string, slots: Record<string, Node | string>): Node[] {
  return template
    .split(/(\{[a-z]+\})/)
    .filter(Boolean)
    .map((part) => {
      const m = /^\{([a-z]+)\}$/.exec(part);
      const slot = m?.[1] ? slots[m[1]] : undefined;
      return slot === undefined
        ? document.createTextNode(part)
        : typeof slot === 'string'
          ? document.createTextNode(slot)
          : slot;
    });
}

/**
 * One rendered number, marked for Physics' checker: data-claim names the pack and its keys
 * (joined with +), data-claim-kind how the number derives from them.
 */
function claim(text: string, pack: string, keys: string[], kind = 'value'): HTMLElement {
  return h('span', { 'data-claim': `${pack}/${keys.join('+')}`, 'data-claim-kind': kind }, text);
}

/* ---------- loading placeholders (Sumit, 15 Nov) ----------
   While a page loads, its column keeps the shape it will have when ready: faint placeholders where
   the number, the colour row and the tabs will be, so nothing jumps when the data lands. */
const skel = (cls = '', text = '\u00a0') =>
  h('span', { class: `skel ${cls}`.trim(), 'aria-hidden': 'true' }, text);

function skelColourRow(): HTMLElement {
  return h(
    'div',
    { class: 'colour-row skel-row', 'aria-hidden': 'true' },
    ...RANGES.map(() => skel('skel-pill')),
  );
}

function skelTabbed(): HTMLElement {
  const t = copy.panel.tabs;
  return h(
    'div',
    { class: 'panel-tabbed skel-tabbed', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'skel-tabs' },
      ...[t.compare, t.watch, t.facts, t.spectrum].map((x) => h('span', {}, x)),
    ),
    h(
      'div',
      { class: 'skel-body' },
      skel('skel-line'),
      h('div', { class: 'skel-thumbs' }, skel('skel-thumb'), skel('skel-thumb')),
      h('div', { class: 'skel-actions' }, skel('skel-pill'), skel('skel-pill'), skel('skel-pill')),
      skel('skel-line short'),
    ),
  );
}

/** A thin progress line and one quiet line of words, in place of a ticking sentence. */
function loadProgress(
  p: { done: number; total: number; of: number } | null | undefined,
  choosing: boolean,
): HTMLElement {
  const pct = p ? Math.round((100 * p.done) / Math.max(1, p.total)) : 0;
  return h(
    'div',
    { class: 'probing', role: 'status' },
    h('div', { class: `load-bar${p ? '' : ' indeterminate'}` }, h('i', { style: `width:${pct}%` })),
    h(
      'p',
      { class: 'load-count' },
      choosing
        ? copy.look.colour.choosing
        : p
          ? copy.look.probingShort(p.done, p.total, p.of)
          : copy.look.findingShort,
    ),
  );
}

/** The words beside a live look: what was found, what is shown, and what it isn't. */
function lookWords(): HTMLElement[] {
  const place = state.place;
  const plan = live?.plan ?? null;
  // The honesty line comes first, before any number: a look, not a search.
  const out: (HTMLElement | null)[] = [
    h(
      'p',
      { class: 'eyebrow' },
      h('span', { class: 'chip look' }, copy.look.chip),
      h('span', {}, formatPosition(place)),
    ),
    surprise ? h('h2', {}, surprise.name) : null,
    surprise ? h('p', {}, surprise.note) : null,
    surprise
      ? h(
          'p',
          { class: 'hint' },
          surprise.kind === 'mover' ? surpriseShiftLine(surprise) : copy.surprise.variable,
        )
      : null,
  ];
  if (place.kind === 'finding' || !plan) {
    // The ready page's shape, in placeholders: the count, the dates, the colour row, the tabs.
    out.push(
      h(
        'div',
        { class: 'hero-count loading', role: 'heading', 'aria-level': '2' },
        skel('big skel-num', '000'),
        h(
          'span',
          { class: 'unit' },
          h('span', {}, copy.look.findingShort),
          skel('dates', 'May 2025 → May 2026'),
        ),
      ),
      loadProgress(live?.probe, !!live?.choosingColour),
      skelColourRow(),
    );
    return [
      h(
        'div',
        { class: 'panel-summary', 'aria-busy': 'true' },
        ...out.filter((x): x is HTMLElement => x !== null),
      ),
      skelTabbed(),
    ];
  }
  if (plan.kind === 'none') {
    out.push(h('h2', {}, copy.look.noPhotos));
    return out.filter((x): x is HTMLElement => x !== null);
  }
  // One number: how many photos of this spot, and when.
  out.push(
    h(
      'div',
      { class: 'hero-count', role: 'heading', 'aria-level': '2' },
      h('span', { class: 'big' }, plan.total.toLocaleString('en-GB')),
      h(
        'span',
        { class: 'unit' },
        h('span', {}, copy.look.photosHere),
        h(
          'span',
          { class: 'dates' },
          `${monthYear(plan.firstMjd)} → ${monthYear(plan.lastMjd)}`,
          // Passes by Physics' rule, as the homepage band counts them (the plan's own "seasons"
          // cut deep fields into quarter-year steps for blinking, so they'd say 6 at R Draconis).
          // The count only: the range already names the first and last months (typography, 15 Nov).
          'seasons' in plan
            ? ` · ${copy.look.passes(live?.photos.length ? passCount(live.photos.map((p) => p.mjd)) : plan.seasons)}`
            : '',
        ),
      ),
    ),
  );
  if (live?.photos.some((p) => p.deep)) out.push(h('p', { class: 'hint' }, copy.look.deep));
  if (plan.kind === 'one-season') out.push(h('p', {}, copy.look.oneLook));
  else if (plan.kind === 'no-pair') out.push(h('p', {}, copy.look.noPair));
  else if (live) {
    const look = live;
    const filling = place.kind === 'filling';
    const lambdas = (filling ? plan.set : look.landed.map((x) => x.candidate)).map(
      (c) => c.lambdaUm,
    );
    const lambda = (plan.pair.a.lambdaUm + plan.pair.b.lambdaUm) / 2;
    out.push(fairColourStrip(lambdas, lambda));
    const row = colourRow(look);
    if (row) out.push(row);
    if (filling) {
      // Pips fill as each photo arrives.
      out.push(
        h(
          'p',
          { class: 'pips', 'aria-label': copy.look.showing(look.landed.length, plan.set.length) },
          ...plan.set.map((_, i) => h('i', { class: i < look.landed.length ? 'on' : '' })),
          h('span', {}, copy.look.reading(plan.set.length)),
        ),
      );
      if (bothLooksIn(look) && look.landed.length < plan.set.length) {
        const stop = h('button', { type: 'button' }, copy.look.stop);
        stop.addEventListener('click', () => finishLook(look));
        out.push(h('div', { class: 'actions' }, stop));
      }
    }
    if (place.kind === 'look' && look.stretch) {
      const stretch = look.stretch;
      const strip = h('div', { class: 'look-strip' });
      look.tiles.forEach((t, i) => {
        const x = look.landed[i];
        const thumb = thumbnail(t, stretch, 56, livePhotoName(i));
        // The photo's details on hover: when, which colour, and the original file in the archive.
        thumb.title = x
          ? copy.look.photoDetails(
              livePhotoName(i),
              fixed(x.candidate.lambdaUm),
              x.key.split('/').pop() ?? '',
            )
          : livePhotoName(i);
        thumb.addEventListener('click', () => {
          stopReveal?.();
          showLivePhoto(i);
        });
        strip.append(h('figure', {}, thumb, h('figcaption', {}, h('b', {}, String(i + 1)))));
      });
      const replay = h('button', { type: 'button' }, copy.show.replay);
      replay.addEventListener('click', () => {
        if (liveColouring) endLiveTimeColour(false);
        flipLook();
      });
      // Option A: the summary so far stays fixed; what to do with the spot goes in tabs.
      out.push(
        h(
          'p',
          { class: 'state-line' },
          h('span', { class: 'mk look', 'aria-hidden': 'true' }),
          copy.panel.lookState,
        ),
      );
      const range = rangePhotos(look);
      return panelOf(out, [
        tabSpec('compare', [
          // While marking, the lens shows the look; the thumbnails give way to the card (fit).
          markMode ? null : strip,
          // "N of M shown" rides on the actions line rather than a heading (fit at 1280x720).
          h(
            'div',
            { class: 'actions' },
            replay,
            copyLinkButton(),
            h(
              'span',
              { class: 'hint shown-count' },
              copy.look.shownHeading(look.tiles.length, plan.total),
            ),
          ),
          compareModes(look),
          compareModeBlock(look, null),
          // The field's asteroid line gives way to the spot card while marking (fit).
          markMode ? null : liveMoversLine(look),
        ]),
        tabSpec('watch', [liveRangeSection(look), fieldControl(look.tiles.length)], {
          badge: range.photos.length > 2 ? String(range.photos.length) : null,
          badgeLabel: copy.panel.badge.photos(String(range.photos.length)),
          cue: watchCue(),
        }),
        tabSpec('facts', [
          // The same rows as a show's, so a look's empty rows say plainly what it isn't.
          h(
            'dl',
            { class: 'facts' },
            // N4 (Physics): no sensitivity limit is said until the registered fake-mover run
            // gives one; folded into this row so the panel keeps its height (fit at 1280×720).
            ...factRow(
              'look',
              copy.facts.move,
              `${copy.facts.dash.look} (${copy.facts.sensitivityLead} `,
              h('a', { href: 'tests.html#yardstick' }, copy.facts.sensitivityNotYet),
              ')',
            ),
            ...factRow('unmeasured', copy.facts.predicted, copy.facts.dash.none),
            ...factRow('unmeasured', copy.facts.steady, copy.facts.dash.none),
            ...factRow('unmeasured', copy.facts.brightness, copy.facts.dash.none),
            ...factRow('unmeasured', copy.facts.spectrum, copy.facts.dash.none),
            ...factRow('flag', copy.facts.flags, flagsControl(look.tiles)),
            ...factRow('catalogue', copy.facts.catalogue, liveCatalogueChips(look)),
          ),
          // Moved from Compare (Viewer's audit).
          factsFooter(look.at, null, false),
          h(
            'details',
            { class: 'why' },
            h('summary', {}, copy.evidence.whyShift),
            h('p', {}, copy.look.wobble),
          ),
        ]),
        tabSpec('spectrum', [liveSpectrumSection(look)], {
          badge: look.spectrum?.result ? '●' : null,
          badgeLabel: copy.panel.badge.measured,
        }),
      ]);
    }
  }
  if (place.kind === 'filling')
    return [
      h(
        'div',
        { class: 'panel-summary', 'aria-busy': 'true' },
        ...out.filter((x): x is HTMLElement => x !== null),
      ),
      skelTabbed(),
    ];
  return out.filter((x): x is HTMLElement => x !== null);
}

/**
 * The fair-colour rule, drawn: SPHEREx's range from 0.75 to 5 µm as the infrared ramp, with a
 * tick for each photo compared. When they all sit on one tick, the comparison is fair.
 */
function fairColourStrip(lambdas: number[], lambda: number): HTMLElement {
  const L0 = Math.log(0.75);
  const L1 = Math.log(5);
  const at = (um: number) => ((Math.log(um) - L0) / (L1 - L0)) * 100;
  return h(
    'div',
    {
      class: 'fair-colour',
      role: 'img',
      'aria-label': copy.look.sameColour(lambdas.length, lambda.toFixed(2)),
    },
    h(
      'p',
      { class: 'fc-label' },
      h('span', { class: 'chip measured-colour' }, copy.look.sameColourChip),
      h('span', {}, `${lambda.toFixed(2)} µm`),
    ),
    h(
      'div',
      { class: 'fc-ramp' },
      ...lambdas.map((um) => h('i', { style: `left:${at(um).toFixed(1)}%` })),
    ),
    h('p', { class: 'fc-axis' }, h('span', {}, '0.75 µm'), h('span', {}, '5 µm')),
  );
}

type OverlaySource = {
  at_season: Record<string, [number, number, number, number]>;
  target: boolean;
  /** CatWISE rows also carry these (pipeline/planetes_pack.py write_overlay). */
  source_name?: string;
  W1?: number | null;
  W2?: number | null;
  pmra_arcsec_yr?: number | null;
  pmdec_arcsec_yr?: number | null;
};
type OverlayFile = {
  gaia_dr3?: OverlaySource[];
  catwise2020?: OverlaySource[];
  season_mean_mjd?: Record<string, number>;
  /** When each catalogue was asked (YYYY-MM-DD) and CatWISE's cut (planetes_pack.write_overlay). */
  fetched?: { gaia_dr3?: string; catwise2020?: string; catwise_cut?: string };
};

/** Loads a wanderer's overlay file once (null if missing); the cache below fills as it lands. */
const overlayLoads = new Map<TargetId, Promise<OverlayFile | null>>();
function loadOverlay(id: TargetId): Promise<OverlayFile | null> {
  let p = overlayLoads.get(id);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/overlays/overlay_${id}.json`)
      // Python writes missing values as NaN, which isn't JSON; read it as null.
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => (t ? (JSON.parse(t.replace(/\bNaN\b/g, 'null')) as OverlayFile) : null))
      .catch(() => null);
    overlayLoads.set(id, p);
  }
  return p;
}

/**
 * The target's own row as places per pass, for targetPlaceAt. Some files mark more than one row
 * as the target (RW Aur's A and B; a CatWISE neighbour), so take the one closest to the grid
 * centre, which is the target's own position.
 */
function passPlaces(file: OverlayFile | null): PassPlaces | null {
  if (!file?.season_mean_mjd) return null;
  const offset = (r: OverlaySource) => {
    const at = Object.values(r.at_season);
    return at.reduce((a, v) => a + Math.hypot(v[2], v[3]), 0) / Math.max(1, at.length);
  };
  const rows = [...(file.gaia_dr3 ?? []), ...(file.catwise2020 ?? [])].filter((r) => r.target);
  const row = rows.sort((a, b) => offset(a) - offset(b))[0];
  return row ? { seasonMjd: file.season_mean_mjd, atSeason: row.at_season } : null;
}

/**
 * CatWISE rows saved in a target's overlay file, as the helper would give them: positions moved
 * back from the file's first pass to CatWISE's own epoch (MJD 57170), motions in mas/yr, within
 * `radiusArcsec` of `at`. Null when the file has none (G1, 15 Nov).
 */
function savedCatwise(
  file: OverlayFile | null,
  at: SkyPosition,
  radiusArcsec: number,
): CatwiseStar[] | null {
  const rows = file?.catwise2020;
  if (!rows?.length || !file?.season_mean_mjd) return null;
  const out: CatwiseStar[] = [];
  for (const r of rows) {
    const key = Object.keys(r.at_season)[0];
    const p = key === undefined ? undefined : r.at_season[key];
    const t = key === undefined ? undefined : file.season_mean_mjd[key];
    if (!p || t === undefined || !r.source_name) continue;
    const pmra = (r.pmra_arcsec_yr ?? 0) * 1000;
    const pmdec = (r.pmdec_arcsec_yr ?? 0) * 1000;
    const back = placeAt({ ra: p[0], dec: p[1] }, pmra, pmdec, yearOfMjd(t), yearOfMjd(57170));
    if (separationDeg(back, at) * 3600 > radiusArcsec) continue;
    out.push({
      id: r.source_name,
      ra: back.ra,
      dec: back.dec,
      pmra,
      pmdec,
      w1: r.W1 ?? null,
      w2: r.W2 ?? null,
    });
  }
  return out;
}

/** Physics' catalogue overlay files, by wanderer (null while loading, or if missing). */
const overlays = new Map<TargetId, OverlayFile | null>();
let overlayOn = { gaia: false, catwise: false };

/** Marks for the tiles on show: each tile's season, each source's offset at that season. */
function overlayMarks(file: OverlayFile, seasons: number[]): NonNullable<LensOverlay['catalogue']> {
  const pick = (rows: OverlaySource[] | undefined, kind: 'gaia' | 'catwise', season: number) =>
    (rows ?? [])
      .filter((r) => !r.target)
      .flatMap((r) => {
        const at = r.at_season[String(season)];
        return at ? [{ east: at[2] / 6.15, north: at[3] / 6.15, kind }] : [];
      });
  return seasons.map((season) => [
    ...(overlayOn.gaia ? pick(file.gaia_dr3, 'gaia', season) : []),
    ...(overlayOn.catwise ? pick(file.catwise2020, 'catwise', season) : []),
  ]);
}

/** The opt-in catalogue overlay for a show: Gaia (and CatWISE where we have it). */
function overlaySection(id: TargetId): HTMLElement | null {
  if (!overlays.has(id)) {
    overlays.set(id, null);
    void loadOverlay(id)
      .then((d) => {
        overlays.set(id, d);
        if ('target' in state.place && state.place.target === id) render();
      })
      .catch(() => undefined);
    return null;
  }
  const file = overlays.get(id);
  if (!file || !current) return null;
  const seasons = current.show.seasons;
  const apply = () => lens.setOverlay({ catalogue: overlayMarks(file, seasons) });
  // A toggle per catalogue, with its count; the counts leave out the target's own row and are
  // tagged so Physics' checker counts them too.
  const chip = (
    key: 'gaia' | 'catwise',
    rows: OverlaySource[] | undefined,
    list: 'gaia_dr3' | 'catwise2020',
    label: string,
    hint: string,
  ) => {
    if (!rows?.length) return null;
    const b = h(
      'button',
      {
        type: 'button',
        class: `flag-chip ${key}`,
        title: hint,
        'aria-pressed': String(overlayOn[key]),
      },
      h('span', { class: `mk cat-${key}`, 'aria-hidden': 'true' }),
      `${label} `,
      claim(String(rows.filter((r) => !r.target).length), id, [], `count:overlay:${list}`),
    );
    b.addEventListener('click', () => {
      overlayOn = { ...overlayOn, [key]: !overlayOn[key] };
      b.setAttribute('aria-pressed', String(overlayOn[key]));
      apply();
    });
    return b;
  };
  apply();
  return h(
    'span',
    { class: 'chip-row' },
    chip('gaia', file.gaia_dr3, 'gaia_dr3', copy.overlay.gaiaShort, copy.overlay.gaiaHint),
    chip(
      'catwise',
      file.catwise2020,
      'catwise2020',
      copy.overlay.catwiseShort,
      copy.overlay.catwiseHint,
    ),
  );
}

/* ---------- G1: Gaia and CatWISE marks on a live look (Viewer's design, 15 Nov) ---------- */

/** One catalogue's answer for a live look: positions with their own epoch (Julian year). */
type CatFetch = {
  state: 'idle' | 'loading' | 'done' | 'failed';
  stars: { ra: number; dec: number; pmra: number; pmdec: number; epoch: number }[];
};
/** The five's cuts (planetes_pack.py), so a count means the same thing on every page. */
const LIVE_CUTS = { gaia: 19.5, catwise: 17 } as const;

/** Every star's place at each shown look's own date, in lens pixels from the centre. */
function liveCatalogueMarks(look: NonNullable<typeof live>): LensOverlay['catalogue'] {
  const cats = look.catalogues;
  if (!cats || !(overlayOn.gaia || overlayOn.catwise)) return null;
  const grid = lookGrid();
  const half = grid.size / 2;
  const cosd = Math.cos((look.at.dec * Math.PI) / 180);
  return look.landed.map((x) => {
    const yr = yearOfMjd(x.candidate.mjd);
    const marks: { east: number; north: number; kind: 'gaia' | 'catwise' }[] = [];
    for (const kind of ['gaia', 'catwise'] as const) {
      if (!overlayOn[kind] || cats[kind].state !== 'done') continue;
      for (const st of cats[kind].stars) {
        const p = placeAt({ ra: st.ra, dec: st.dec }, st.pmra, st.pmdec, st.epoch, yr);
        const east = ((((p.ra - look.at.ra + 540) % 360) - 180) * cosd * 3600) / grid.scaleArcsec;
        const north = ((p.dec - look.at.dec) * 3600) / grid.scaleArcsec;
        // The centre source isn't hidden: on a look there's no prediction to protect (Viewer).
        if (Math.abs(east) <= half && Math.abs(north) <= half) marks.push({ east, north, kind });
      }
    }
    return marks;
  });
}

function applyLiveCatalogue(look: NonNullable<typeof live>): void {
  if (live !== look || !look.done) return;
  lens.setOverlay({ catalogue: liveCatalogueMarks(look) });
}

/** Sources inside the cutout (what the marks show), for the chip's count. */
function liveCatalogueCount(look: NonNullable<typeof live>, kind: 'gaia' | 'catwise'): number {
  const grid = lookGrid();
  const halfArcsec = (grid.size / 2) * grid.scaleArcsec;
  const cosd = Math.cos((look.at.dec * Math.PI) / 180);
  return (look.catalogues?.[kind].stars ?? []).filter(
    (st) =>
      Math.abs((((st.ra - look.at.ra + 540) % 360) - 180) * cosd * 3600) <= halfArcsec &&
      Math.abs((st.dec - look.at.dec) * 3600) <= halfArcsec,
  ).length;
}

/** Fetched once, on the first toggle, sized to the cutout's half-diagonal (Viewer). */
function fetchLiveCatalogue(look: NonNullable<typeof live>, kind: 'gaia' | 'catwise'): void {
  look.catalogues ??= {
    gaia: { state: 'idle', stars: [] },
    catwise: { state: 'idle', stars: [] },
  };
  const c = look.catalogues[kind];
  if (c.state !== 'idle') return;
  c.state = 'loading';
  const grid = lookGrid();
  const r = Math.min(700, Math.ceil((grid.size / 2) * grid.scaleArcsec * Math.SQRT2) + 10);
  const done = (stars: CatFetch['stars'] | null) => {
    c.state = stars ? 'done' : 'failed';
    c.stars = stars ?? [];
    if (live === look) {
      applyLiveCatalogue(look);
      render();
    }
  };
  if (kind === 'gaia')
    void gaiaNear(look.at, r, undefined, LIVE_CUTS.gaia)
      .then((g) =>
        done(
          g
            ? g.map((x) => ({ ra: x.ra, dec: x.dec, pmra: x.pmra, pmdec: x.pmdec, epoch: 2016.0 }))
            : null,
        ),
      )
      .catch(() => done(null));
  else
    void catwiseNear(look.at, r, undefined, LIVE_CUTS.catwise)
      .then((w) =>
        done(
          w
            ? w.stars.map((x) => ({
                ra: x.ra,
                dec: x.dec,
                pmra: x.pmra,
                pmdec: x.pmdec,
                epoch: yearOfMjd(57170),
              }))
            : null,
        ),
      )
      .catch(() => done(null));
}

/** The five's own chips, reused on a live look: same shapes, words, state and hint. */
function liveCatalogueChips(look: NonNullable<typeof live>): HTMLElement {
  const o = copy.overlay;
  // A catalogue already switched on (perhaps on one of the five) is fetched for this look too.
  for (const kind of ['gaia', 'catwise'] as const)
    if (overlayOn[kind] && look.done) fetchLiveCatalogue(look, kind);
  const chip = (kind: 'gaia' | 'catwise', label: string, hint: string, tried: string) => {
    const c = look.catalogues?.[kind];
    const failed = c?.state === 'failed';
    const b = h(
      'button',
      {
        type: 'button',
        class: `flag-chip ${kind}`,
        title: failed ? o.notReachableTitle(tried) : hint,
        'aria-pressed': String(overlayOn[kind] && !failed),
        'aria-busy': String(c?.state === 'loading'),
        // Not `disabled`: a disabled button drops keyboard focus. Pressing it tries again (Viewer).
        'aria-disabled': String(failed),
        'data-chip': kind,
      },
      h('span', { class: `mk cat-${kind}`, 'aria-hidden': 'true' }),
      failed
        ? o.notReachable(label)
        : c?.state === 'done'
          ? `${label} ${liveCatalogueCount(look, kind)}`
          : c?.state === 'loading'
            ? `${label} …`
            : label,
    );
    b.addEventListener('click', () => {
      if (c?.state === 'failed') {
        // A retry: back through "…" to an answer or "not reachable now" again.
        c.state = 'idle';
        overlayOn = { ...overlayOn, [kind]: true };
      } else overlayOn = { ...overlayOn, [kind]: !overlayOn[kind] };
      if (overlayOn[kind]) fetchLiveCatalogue(look, kind);
      applyLiveCatalogue(look);
      render();
    });
    return b;
  };
  const shown = (['gaia', 'catwise'] as const).some(
    (k) => overlayOn[k] && look.catalogues?.[k].state === 'done',
  );
  return h(
    'span',
    { class: 'chip-row' },
    chip('gaia', o.gaiaShort, o.gaiaHint, o.gaiaArchive),
    chip('catwise', o.catwiseShort, o.catwiseHint, o.catwiseArchives),
    // The title's "not SPHEREx", made visible while marks are drawn (touch has no titles; Viewer).
    shown ? h('span', { class: 'hint small' }, o.otherTelescopes) : null,
  );
}

/* ---------- Learn: a short guided tour of the sky and the five ---------- */

let tourStep = 0;
/** What each step shows: the sky, a flight to the runaway, the shows, then the sky again. */
const TOUR_ACTS: (() => void)[] = [
  // "How SPHEREx sees the sky": out to Earth, the orbit and the scanning ring (3D, or the 2D
  // Earth without WebGL; a cut instead of a flight under reduced motion). Ride along is here.
  () => {
    if (state.place.kind !== 'sky') leaveShow();
    sky.ride(false);
    // In whichever view the visitor was (Sumit, 15 Nov: pressing Learn shouldn't switch Look
    // around to the flat map); the coverage sweep draws on both.
    tourSweep(true);
  },
  // "From out here": Earth and SPHEREx's orbit (3D, or the 2D Earth without WebGL). Ride along.
  () => {
    if (state.place.kind !== 'sky') leaveShow();
    tourSweep(false);
    // As goSpace, with the view change recorded as the tour's.
    if (state.entry !== 'inside') tourEntry('inside');
    sky.stepOutTo(1);
  },
  // "The whole sky": the flat all-sky map, wherever the visitor was.
  () => {
    if (state.place.kind !== 'sky') leaveShow();
    tourSweep(false);
    sky.ride(false);
    tourEntry('flat');
  },
  // Back inside, turning toward the runaway.
  () => {
    if (state.place.kind !== 'sky') leaveShow();
    tourSweep(false);
    sky.ride(false);
    void (async () => {
      if (state.entry !== 'inside') tourEntry('inside');
      const w = WANDERERS.find((x) => x.id === 'barnard');
      if (w) void sky.flyTo(w.at, 20, prefersReducedMotion() ? 0 : 1200);
    })();
  },
  () => void openWanderer('barnard'),
  () => void openWanderer('w0855'),
  () => void openWanderer('epsind-b'),
  () => void openWanderer('rw-aur'),
  () => {
    if (state.place.kind !== 'sky') leaveShow();
  },
];

/**
 * N7, the tour that waits (Viewer's design, 15 Nov): three steps offer one thing to try. The
 * tour notices it, says what was seen, and never blocks Next or Skip, never acts for the visitor
 * (no auto-play), and after 20 s of nothing shows a quiet static hint. The same under reduced
 * motion.
 */
type TryKind = 'hold' | 'shift' | 'sky';
const TOUR_TRY: Partial<Record<number, TryKind>> = { 4: 'hold', 5: 'shift', 8: 'sky' };
let tourDone = false;
/** Set when the tour ends into a spot: render() moves focus to where the visitor landed. */
let focusLandingUntil = 0;
let tourWaiting = false;
let tourIdle = 0;
function tourTried(kind: TryKind): void {
  if (state.room !== 'learn' || TOUR_TRY[tourStep] !== kind || tourDone) return;
  tourDone = true;
  tourWaiting = false;
  globalThis.clearTimeout(tourIdle);
  render();
}

function runTourStep(i: number): void {
  tourStep = Math.max(0, Math.min(TOUR_ACTS.length - 1, i));
  tourDone = false;
  tourWaiting = false;
  colourShiftOn = false;
  globalThis.clearTimeout(tourIdle);
  if (TOUR_TRY[tourStep])
    tourIdle = globalThis.setTimeout(() => {
      if (state.room !== 'learn' || tourDone) return;
      tourWaiting = true;
      render();
    }, 20000);
  try {
    TOUR_ACTS[tourStep]?.();
  } finally {
    // Leaving a show resets the room to Play; the tour keeps it on Learn, whatever the step did.
    if (state.room !== 'learn') dispatch({ type: 'setRoom', room: 'learn' });
    render();
  }
}

function endTour(): void {
  globalThis.clearTimeout(tourIdle);
  leaveLearn();
  dispatch({ type: 'setRoom', room: 'play' });
}

/**
 * Learn, step 1: the ring is the real weekly coverage, sweeping on the flat map (our own files),
 * not a drawing. Under reduced motion one week is shown, still.
 */
function tourSweep(on: boolean): void {
  sky.coverageStrength = on ? 2.4 : 1;
  if (!on) {
    if (sweep.open) closeWeek();
    return;
  }
  if (!sweep.coverage) return;
  sweep.open = true;
  setWeek(sweep.week || 0, false);
  playSweep();
}

/** Leaving Learn: riding stops and the view steps back inside (both live in Learn only). */
function leaveLearn(): void {
  tourSweep(false);
  sky.ride(false);
  if (state.entry === 'inside' && sky.steppedOut) sky.stepOutTo(0);
  // Back to the view the visitor came from, if the view is still the one the tour set; a
  // target's page keeps its own view.
  const from = learnFrom;
  const tourSet = tourSetEntry;
  learnFrom = tourSetEntry = null;
  if (from && state.place.kind === 'sky' && state.entry === tourSet && state.entry !== from)
    goEntry(from);
}

/** Learn, step 2: ride along with SPHEREx's real pointing (motion, so not under reduced motion). */
function rideAlong(): HTMLElement | null {
  if (prefersReducedMotion()) return null;
  const b = h(
    'button',
    { type: 'button', class: 'ride-along', 'aria-pressed': String(sky.riding) },
    sky.riding ? copy.home.riding : copy.home.rideAlong,
  );
  b.addEventListener('click', () => {
    // Riding is seen from inside: step back in first, then follow the telescope.
    if (state.entry === 'inside' && sky.steppedOut) sky.stepOutTo(0);
    sky.ride(!sky.riding);
  });
  return h('div', { class: 'actions' }, b);
}

/** The tour's card in the words column: one sentence, and Back, Next and Skip. */
function tourCard(): HTMLElement {
  const steps = copy.tour.steps;
  const last = tourStep === steps.length - 1;
  const back = h('button', { type: 'button', disabled: tourStep === 0 }, copy.tour.back);
  back.addEventListener('click', () => runTourStep(tourStep - 1));
  const next = h(
    'button',
    { type: 'button', class: 'primary' },
    last ? copy.tour.done : copy.tour.next,
  );
  next.addEventListener('click', () => (last ? endTour() : runTourStep(tourStep + 1)));
  // Skip keeps its place on the last step, so the buttons never move under the pointer.
  const skip = h(
    'button',
    { type: 'button', class: 'quiet', style: last ? 'visibility:hidden' : undefined },
    copy.tour.skip,
  );
  skip.addEventListener('click', endTour);
  const dots = h(
    'span',
    { class: 'tour-dots', 'aria-hidden': 'true' },
    ...steps.map((_, i) => h('i', { class: i === tourStep ? 'on' : i < tourStep ? 'done' : '' })),
  );
  return h(
    'section',
    { class: 'tour' },
    h(
      'p',
      { class: 'eyebrow' },
      h('span', { class: 'visually-hidden' }, copy.tour.eyebrow(tourStep + 1, steps.length)),
      h('span', { 'aria-hidden': 'true' }, copy.tour.title),
      dots,
    ),
    // Once Two colours is open beside the card (N7), the step's line steps down a size so the
    // figure fits the column at 1280×720 without scrolling.
    h(
      'p',
      { class: tourDone && TOUR_TRY[tourStep] === 'shift' ? 'tour-line compact' : 'tour-line' },
      steps[tourStep] ?? '',
    ),
    tryLine(last),
    // The last step points to the field guide (Viewer).
    tourStep === steps.length - 1
      ? h(
          'p',
          { class: 'hint' },
          h('a', { href: 'fieldguide.html' }, copy.fieldguide.linkShort),
          ' · ',
          h('a', { href: 'loop.html' }, copy.loop.linkShort),
        )
      : null,
    tourStep === 0 ? h('p', { class: 'hint' }, copy.home.ringNote) : null,
    tourStep === 1 ? rideAlong() : null,
    h('div', { class: 'actions' }, back, next, skip),
  );
}

/** The step's one thing to try (N7), announced politely when it changes. */
function tryLine(last: boolean): HTMLElement | null {
  const kind = TOUR_TRY[tourStep];
  if (!kind) return null;
  const t = copy.tour.tryIt;
  const parts: (Node | string)[] = [];
  if (tourDone && kind === 'hold') parts.push(t.barnardDone);
  else if (tourDone && kind === 'shift') parts.push(t.w0855Done);
  else if (kind === 'hold') {
    parts.push(t.barnard, ' ');
    const hold = h(
      'button',
      { type: 'button', class: 'hold' },
      copy.show.hold,
      h('kbd', {}, copy.show.holdKey),
    );
    hold.addEventListener('pointerdown', holdStart);
    hold.addEventListener('pointerup', holdEnd);
    hold.addEventListener('pointerleave', holdEnd);
    parts.push(hold);
  } else if (kind === 'shift') {
    parts.push(t.w0855, ' ');
    const b = h('button', { type: 'button' }, t.w0855Button);
    b.addEventListener('click', () => {
      colourShiftOn = true;
      tourTried('shift');
      render();
    });
    parts.push(b);
  } else parts.push(t.sky);
  return h(
    'div',
    { class: 'tour-try', 'aria-live': 'polite' },
    h('p', {}, ...parts),
    tourWaiting && !tourDone
      ? h('p', { class: 'hint' }, last ? t.waitingDone : t.waitingNext)
      : null,
  );
}

/* ---------- Watch: every photo in one colour, in date order (checklist R3) ---------- */

/** The colour range (detector 1–6) being played in the lens, if any. */
let watching: number | null = null;

/* ---------- the words column's tabs (option A: a fixed summary, then tabs) ---------- */

/** On phones the tabbed column is a bottom sheet: peek (the summary), half, or full height. */
type SheetHeight = 'peek' | 'half' | 'full';
let sheetHeight: SheetHeight = 'half';
const SHEET_NEXT: Record<SheetHeight, SheetHeight> = { peek: 'half', half: 'full', full: 'peek' };
const sheetHandle = h(
  'button',
  { type: 'button', class: 'sheet-handle', 'aria-label': copy.panel.sheet.half },
  h('span', { 'aria-hidden': 'true' }),
);
sheetHandle.addEventListener('click', () => {
  sheetHeight = SHEET_NEXT[sheetHeight];
  words.dataset['sheet'] = sheetHeight;
  sheetHandle.setAttribute('aria-label', copy.panel.sheet[sheetHeight]);
});

/** The open tab per page: 'live' for live looks, else the target's id. */
const panelTabs = new Map<string, PanelTab>();
/** Whether the visitor has opened Watch anywhere this visit (the quiet cue shows once). */
let watchOpened = false;
/** A shared link's ?tab=, for the page that link opens only. */
let startTab = parseTab(new URLSearchParams(location.search).get('tab'));
let startTabPage: string | null = null;

/** The Watch cue: once the pair has played (a ready show or a finished look), until opened. */
function watchCue(): boolean {
  return !watchOpened && (state.place.kind === 'ready' || state.place.kind === 'look');
}

function pageKey(): string {
  return 'target' in state.place ? state.place.target : 'live';
}

/** The tab on show: on the five's pages Watch is the Watch room itself. */
function activeTab(): PanelTab {
  const key = pageKey();
  if (key !== 'live' && state.room === 'watch') return 'watch';
  if (startTab && startTabPage === null) startTabPage = key;
  const fromLink = startTabPage === key ? startTab : null;
  const t = panelTabs.get(key) ?? fromLink ?? 'compare';
  return key !== 'live' && t === 'watch' ? 'compare' : t;
}

/**
 * Opens a tab. On the five's pages Watch is the Watch room (as the dial's Watch), and leaving it
 * ends a playing series first; on a live look, leaving Watch returns the lens to the pair.
 */
function selectTab(tab: PanelTab): void {
  const key = pageKey();
  const was = activeTab();
  startTab = null;
  typedNote = null;
  panelTabs.set(key, tab);
  if (tab === 'watch') watchOpened = true;
  if (key === 'live') {
    if (was === 'watch' && tab !== 'watch') leaveLiveRange();
    writeUrl();
    render();
    return;
  }
  if (tab === 'watch') {
    leaveDifference();
    if (state.room !== 'watch') dispatch({ type: 'setRoom', room: 'watch' });
    else render();
  } else {
    if (watching !== null) void playColour(watching);
    if (state.room === 'watch') dispatch({ type: 'setRoom', room: 'play' });
    else render();
  }
  writeUrl();
}

function tabSpec(id: PanelTab, content: (Node | null)[], extra: Partial<TabSpec> = {}): TabSpec {
  const key = id === 'watch' && pageKey() !== 'live' ? 'watchFive' : id;
  return {
    id,
    label: copy.panel.tabs[id as keyof typeof copy.panel.tabs],
    hint: copy.panel.hints[key as keyof typeof copy.panel.hints],
    content,
    ...extra,
  };
}

function panelOf(summary: (Node | null)[], tabs: TabSpec[]): HTMLElement[] {
  return tabbedPanel({
    summary,
    tabs,
    active: activeTab(),
    label: copy.panel.label,
    onSelect: selectTab,
  });
}
/** The photo of the series on screen, ringed in the dock. */
let seriesPhoto: string | null = null;
/** The series being watched: step it by hand, or let it play (never on its own under reduced motion). */
let series: {
  step: (delta: number) => void;
  paused: boolean;
  toggle: () => void;
  /** Whether the "what changed" film is on (null: too few photos for one). */
  changed: boolean | null;
  toggleChanged: () => void;
  setMovers: (m: MoverMark[][]) => void;
  redraw: () => void;
} | null = null;
const seriesBar = h('div', { class: 'series-bar actions', role: 'group' });
const seriesMeta = h('details', { class: 'why photo-meta' });

/**
 * Plays every photo of the wanderer taken in one colour range, in date order: one shared
 * stretch, hard cuts at 2 per second, looping until paused. One colour range at a time, so
 * what changes is position, not colour. Earlier/Later step it by hand (and ← →); under reduced
 * motion it starts paused. Pressing the same window again returns to the comparison.
 */
async function playColour(detector: number): Promise<void> {
  if (!current) return;
  leaveDifference();
  stopReveal?.();
  series = null;
  if (watching === detector) {
    watching = null;
    lens.setTiles(current.pair, sharedStretch(current.pair.map((t) => t.pixels)));
    lens.show(1);
    lens.setOverlay({
      measured: current.show.kind === 'motion' ? current.show.measured : undefined,
    });
    setLensLabel(1, 8);
    render();
    return;
  }
  watching = detector;
  render();
  const pack = current.pack;
  const frames = pack.manifest.frames
    .filter((f) => f.detector === detector)
    .sort((a, b) => a.mjd - b.mjd);
  // One download for the whole colour range: the lens keeps the pair meanwhile, and the label
  // says how much is coming (Viewer, 14 Nov).
  const bundle = pack.manifest.bundles?.find((b) => b.detector === detector);
  if (bundle) {
    const mb = (bundle.bytesPerFrame * bundle.frameIds.length) / 1e6;
    const say = (pct: number) => {
      if (watching === detector && current?.pack === pack)
        lensLabel.replaceChildren(h('span', {}, copy.watch.loading(frames.length, mb, pct)));
    };
    say(0);
    await loadBundle(pack.base, bundle, (got, total) => say(Math.floor((100 * got) / total))).catch(
      () => undefined,
    );
    if (watching !== detector || current?.pack !== pack) return;
  }
  const tiles = await Promise.all(frames.map((f) => photoTile(pack, f)));
  if (watching !== detector || current?.pack !== pack) return;
  // No arrows over a series: they belong to the two compared looks.
  lens.setOverlay({ measured: undefined, predicted: undefined, arrowProgress: 0 });
  const g = pack.manifest.grid;
  const id = pack.manifest.target.id as TargetId;
  // Where the catalogue puts the wanderer at each photo's time, for the "what changed" film.
  const places = await loadOverlay(id).then((file) => passPlaces(file));
  if (watching !== detector || current?.pack !== pack) return;
  const play = runSeries({
    tiles,
    film: frames.map((f, k) => ({
      tile: tiles[k] as Tile,
      mjd: f.mjd,
      lambdaUm: f.lambdaUm,
      bandwidthUm: f.bandwidthUm,
      detector: f.detector,
    })),
    label: (i) => {
      const f = frames[i];
      return f
        ? copy.watch.frame(i + 1, frames.length, dayMonthYear(f.mjd), fixed(f.lambdaUm))
        : '';
    },
    onFrame: (i) => {
      const f = frames[i];
      const t = tiles[i];
      seriesPhoto = f?.id ?? null;
      renderBand();
      if (f && t) drawPhotoMeta(id, f, t, i);
    },
    targetAt: places
      ? frames.map((f) => targetPlaceAt(places, f.mjd, g.pixelScaleArcsec))
      : undefined,
  });
  // Known asteroids at each photo's own time, once SkyBoT answers.
  runMovers = null;
  void moversOn(
    g.centre,
    frames.map((f) => f.mjd),
    g.size,
    g.pixelScaleArcsec,
    frames.map((f) => f.observerKm),
  ).then((marks) => {
    if (watching !== detector || current?.pack !== pack || series !== play) return;
    runMovers = marks;
    if (marks !== 'failed') play.setMovers(marks);
    play.redraw();
  });
}

/** A playing series' "what changed" film, made on first asking and kept with the series. */
interface FilmPanel {
  frame: DifferenceFrame;
  ok: boolean;
  tile: Tile;
  image: HTMLCanvasElement;
}

interface SeriesSource {
  tiles: Tile[];
  /** The same photos as the film needs them: date, colour, band width, detector. */
  film: FilmInput[];
  /** The lens label for photo i. */
  label: (i: number) => string;
  /** Anything else to update for photo i (Watch: the dock ring and the photo's details). */
  onFrame?: ((i: number) => void) | undefined;
  /** The catalogue's place for the target at each photo's time (the five only). */
  targetAt?: ({ east: number; north: number } | null)[] | undefined;
}

/**
 * Plays a series in the lens: one shared stretch, hard cuts at 2 per second, looping until
 * paused, never on its own under reduced motion; Earlier/Later step it (and ← →). "Show what
 * changed" swaps in each photo minus the same spot on other dates near its colour (Physics'
 * film, src/data/live/film.ts), drawn like the show's difference: grey ±5σ, hatched where
 * unusable. Returns the series, so late answers (SkyBoT) can check it's still the one playing.
 */
function runSeries(src: SeriesSource): NonNullable<typeof series> {
  // A series (Watch, Play all, the film) takes the lens: colour by date and the fade end.
  liveColouring = false;
  colouring = false;
  fadeAt = null;
  const n = src.tiles.length;
  const stretch = sharedStretch(src.tiles.map((t) => t.pixels));
  let i = 0;
  let timer = 0;
  let film: FilmPanel[] | null = null;
  let movers: MoverMark[][] | null = null;
  const overlay = () => lens.setOverlay({ movers, target: src.targetAt ?? null });
  const showFrame = () => {
    lens.show(i);
    const panel = s.changed ? film?.[i] : undefined;
    lensLabel.replaceChildren(
      panel
        ? h(
            'span',
            { class: 'look-pill diff-pill' },
            `${src.label(i)} · ${panel.ok ? copy.film.pill : copy.film.none}`,
          )
        : h('span', {}, src.label(i)),
    );
    filmFrameLine.textContent = panel ? filmFrameText(panel, !src.targetAt) : '';
    src.onFrame?.(i);
  };
  const pause = () => {
    window.clearInterval(timer);
    s.paused = true;
  };
  const play = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      i = (i + 1) % n;
      showFrame();
    }, 500);
    s.paused = false;
  };
  const fill = () => {
    if (s.changed && film) lens.setRendered(film.map((x) => ({ tile: x.tile, image: x.image })));
    else lens.setTiles(src.tiles, stretch);
    overlay();
  };
  const s: NonNullable<typeof series> = {
    paused: true,
    // Needs a few other dates to compare with.
    changed: n >= 4 ? false : null,
    step: (delta) => {
      pause();
      i = (i + delta + n) % n;
      showFrame();
      drawSeriesBar();
    },
    toggle: () => {
      if (s.paused) play();
      else pause();
      drawSeriesBar();
    },
    toggleChanged: () => {
      if (s.changed === null) return;
      film ??= makeFilm(src);
      s.changed = !s.changed;
      fill();
      showFrame();
      drawFilmNote(s.changed, !!src.targetAt);
      drawSeriesBar();
    },
    setMovers: (m) => {
      movers = m;
      overlay();
    },
    redraw: showFrame,
  };
  series = s;
  drawFilmNote(false, false);
  fill();
  stopReveal = pause;
  showFrame();
  if (!prefersReducedMotion()) play();
  drawSeriesBar();
  return s;
}

/** The film for a series: each photo minus its other-date, nearest-colour reference, in σ. */
function makeFilm(src: SeriesSource): FilmPanel[] {
  const frames = differenceFilm(src.film);
  return frames.map((frame, k) => {
    const size = src.tiles[k]?.size ?? 0;
    const d = frame.ok ? inSigma(`film-${k}`, size, frame.pixels) : null;
    const tile: Tile = d?.tile ?? {
      id: `film-${k}`,
      size,
      pixels: new Float32Array(size * size).fill(NaN),
      flags: new Uint8Array(size * size),
    };
    return { frame, ok: !!d, tile, image: renderDifference(tile) };
  });
}

/** Under the series bar while the film shows: the key, Physics' words, and this photo's references. */
const filmNote = h('div', { class: 'film-note diff-key' });
const filmFrameLine = h('p', { class: 'hint film-frame' });

/** orientationKnown: only live looks pass the photos' orientation (packs carry none yet). */
function filmFrameText(p: FilmPanel, orientationKnown: boolean): string {
  if (!p.ok) return copy.film.noRefs;
  const f = p.frame;
  return copy.film.refs(
    f.refCount,
    f.maxDlamSteps.toFixed(1),
    monthYear(f.refMeanMjd),
    orientationKnown ? (f.sameOrientation ? 'same' : 'mixed') : null,
  );
}

function drawFilmNote(on: boolean, target: boolean): void {
  if (!on) {
    filmNote.replaceChildren();
    return;
  }
  filmNote.replaceChildren(
    h(
      'div',
      { class: 'diff-scale' },
      h('span', {}, copy.film.fainter(DIFF_LIMIT)),
      h('i', { style: `background: ${diffGradient()}`, 'aria-hidden': 'true' }),
      h('span', {}, copy.film.brighter(DIFF_LIMIT)),
    ),
    filmFrameLine,
    // Physics' full wording, one click away so the Watch tab fits while a film plays.
    h(
      'details',
      { class: 'why film-howto' },
      h('summary', {}, copy.film.howToRead),
      h('p', { class: 'hint' }, copy.film.label),
      ...(target ? [h('p', { class: 'hint' }, copy.film.target)] : []),
    ),
  );
}

/** Earlier · Play/Pause · Later for the series being watched; updated in place, so focus stays. */
function drawSeriesBar(): void {
  if (!series) {
    seriesBar.replaceChildren();
    return;
  }
  const s = series;
  const button = (label: string, act: () => void) => {
    const b = h('button', { type: 'button' }, label);
    b.addEventListener('click', act);
    return b;
  };
  const focused = seriesBar.contains(document.activeElement)
    ? [...seriesBar.children].indexOf(document.activeElement as Element)
    : -1;
  seriesBar.setAttribute('aria-label', copy.watch.seriesLabel);
  seriesBar.replaceChildren(
    button(copy.watch.earlier, () => s.step(-1)),
    button(s.paused ? copy.watch.play : copy.watch.pause, () => s.toggle()),
    button(copy.watch.later, () => s.step(1)),
  );
  if (s.changed !== null) {
    const b = button(s.changed ? copy.film.photos : copy.film.show, () => s.toggleChanged());
    b.setAttribute('aria-pressed', String(s.changed));
    seriesBar.append(b);
  }
  if (focused >= 0) (seriesBar.children[focused] as HTMLElement | undefined)?.focus();
}

/**
 * Date, colour, detector, file and flag counts for the photo on screen, folded away until
 * asked for. The flag counts are tagged for Physics' checker, like the show's.
 */
function drawPhotoMeta(pack: string, f: Frame, t: Tile, i: number): void {
  const m = copy.watch.meta;
  const count = (bit: number) => t.flags.reduce((n, x) => n + (x & bit ? 1 : 0), 0);
  const kinds = ['saturated', 'rejected', 'source', 'outlier'] as const;
  const flagParts = kinds.flatMap((k, j) => [
    j ? ', ' : '',
    h(
      'span',
      {
        'data-claim': `${pack}/${f.id}`,
        'data-claim-kind': `count:flag:${Math.log2(FlagMask[k])}`,
      },
      String(count(FlagMask[k])),
    ),
    ` ${m.flagNames[k]}`,
  ]);
  const row = (term: string, ...value: (Node | string)[]) => [
    h('dt', {}, term),
    h('dd', {}, ...value),
  ];
  const open = (seriesMeta as HTMLDetailsElement).open;
  seriesMeta.replaceChildren(
    h('summary', {}, m.heading),
    h(
      'dl',
      {},
      ...row(m.taken, m.takenValue(dayMonthYear(f.mjd), utcTime(f.mjd))),
      ...row(m.colour, m.colourValue(fixed(f.lambdaUm), fixed(f.bandwidthUm, 3), f.detector)),
      ...(f.colourUncertain ? row('', m.uncertain) : []),
      ...row(m.file, h('code', {}, f.obsId)),
      ...row(m.flags, ...flagParts),
      ...row(m.movers, ...moverRow(i)),
    ),
  );
  (seriesMeta as HTMLDetailsElement).open = open;
}

/**
 * Known asteroids and comets on each photo of a run, at each photo's own time (SkyBoT, asked
 * once per quarter day). 'failed' if any of SkyBoT's answers didn't come.
 */
async function moversOn(
  centre: SkyPosition,
  mjds: number[],
  size: number,
  scaleArcsec: number,
  /** SPHEREx's position per photo (same order as mjds), when known: places as SPHEREx saw them. */
  observers?: (Observer | null | undefined)[],
  signal?: AbortSignal,
): Promise<MoverMark[][] | 'failed'> {
  // Keyed by date: safe because one exposure has one time and one position. Never pass stacked
  // or mean-date frames through this (they have no single position; Viewer, 15 Nov).
  const at = new Map(mjds.map((m, i) => [m, observers?.[i] ?? null] as const));
  const { byMjd, failed } = await knownMoversAt(
    centre,
    mjds,
    fieldRadiusDeg(size, scaleArcsec),
    signal,
    (m) => at.get(m) ?? null,
  );
  if (failed > 0) return 'failed';
  return mjds.map((m) => marksAt(byMjd.get(m) ?? [], centre, size, scaleArcsec));
}

/** The known movers of the colour run on screen: per photo, null while asking, or 'failed'. */
let runMovers: MoverMark[][] | null | 'failed' = null;

/** The "Known asteroids" row of a photo's details. */
function moverRow(i: number): (Node | string)[] {
  const m = copy.watch.meta;
  if (runMovers === 'failed') return [m.moversFailed];
  if (!runMovers) return [m.moversAsking];
  const here = runMovers[i] ?? [];
  if (!here.length) return [m.moversNone];
  return [
    here.map((x) => m.moverItem(x.name, x.vmag?.toFixed(1) ?? null, x.nearEarth)).join('; '),
    h('span', { class: 'hint mover-note' }, m.moversNote),
  ];
}

/** The six per-detector co-adds of each wanderer, once added up (checklist C2). */
const coadds = new Map<string, { tile: Tile; n: number; range: [number, number] }[] | null>();
const RANGES: [number, number][] = [
  [0.75, 1.1],
  [1.1, 1.6],
  [1.6, 2.4],
  [2.4, 3.8],
  [3.8, 4.4],
  [4.4, 5.0],
];

/**
 * Six small pictures, one per colour range, each the mean of every photo taken in it: what the
 * challenge suggests for signal-to-noise. Picking one shows it large in the lens.
 */
function coaddSection(pack: LoadedPack): HTMLElement {
  const id = pack.manifest.target.id;
  const heading = h('h3', {}, copy.watch.coaddHeading);
  if (!coadds.has(id)) {
    coadds.set(id, null);
    void Promise.all(
      RANGES.map(async (range, i) => {
        // Made when the pack was built (six small files), else added up here from every photo.
        const made = pack.manifest.coadds?.find((c) => c.detector === i + 1);
        if (made)
          return {
            tile: await loadPackTile(pack.base, pack.manifest.grid.size, made),
            n: made.n,
            range,
          };
        const frames = pack.manifest.frames.filter((f) => f.detector === i + 1);
        const tiles = await Promise.all(frames.map((f) => photoTile(pack, f)));
        return { tile: coadd(`coadd_D${i + 1}`, tiles), n: tiles.length, range };
      }),
    )
      .then((list) => {
        coadds.set(id, list);
        if (state.room === 'watch') render();
      })
      .catch(() => undefined);
  }
  const list = coadds.get(id);
  if (!list)
    return h(
      'section',
      { class: 'coadds' },
      heading,
      h('p', { class: 'hint' }, copy.watch.coaddLoading),
    );
  const grid = h('div', { class: 'coadd-grid' });
  for (const c of list) {
    const label = copy.watch.coaddLabel(copy.watch.range(c.range[0], c.range[1]), c.n);
    const b = h('button', { type: 'button', title: label, 'aria-label': label });
    b.append(thumbnail(c.tile, sharedStretch([c.tile.pixels]), 60, label));
    b.append(h('span', {}, `${c.range[0]}–${c.range[1]} µm`));
    b.addEventListener('click', () => {
      leaveDifference();
      stopReveal?.();
      watching = null;
      series = null;
      drawSeriesBar();
      lens.setTiles([c.tile], sharedStretch([c.tile.pixels]));
      lens.setOverlay({ measured: undefined, predicted: undefined });
      lensLabel.replaceChildren(h('span', {}, label));
    });
    grid.append(b);
  }
  return h(
    'section',
    { class: 'coadds' },
    heading,
    h('p', { class: 'hint small' }, copy.watch.coaddHint),
    grid,
  );
}

/** Physics' spectrum files, by wanderer, once loaded (null while loading, or if missing). */
const spectra = new Map<TargetId, { status: string; exposures: SpectrumPoint[] } | null>();

/**
 * The wanderer's spectrum where SPHEREx can measure it (ε Indi B), and otherwise one plain line
 * saying why not. Loaded on first view; the words re-render when it arrives.
 */
function spectrumSection(id: TargetId): HTMLElement | null {
  if (!spectra.has(id)) {
    spectra.set(id, null);
    void fetch(`${import.meta.env.BASE_URL}data/spectra/spectrum_${id}.json`)
      .then((r) =>
        r.ok ? (r.json() as Promise<{ status: string; exposures: SpectrumPoint[] }>) : null,
      )
      .then((d) => {
        spectra.set(id, d);
        if ('target' in state.place && state.place.target === id) render();
      })
      .catch(() => undefined);
    return null;
  }
  const d = spectra.get(id);
  if (!d) return null;
  const parts: (Node | null)[] = [h('h3', {}, copy.spectrum.heading)];
  if (d.status === 'measured' && d.exposures.length) {
    const L = copy.spectrum.listen;
    parts.push(
      spectrumFigure(d.exposures, { x: copy.spectrum.x, y: copy.spectrum.y }),
      h('p', { class: 'hint' }, copy.spectrum.caption),
      listenControl(
        `pack-${id}`,
        d.exposures.map(([um, flux]) => ({ um, flux })),
        {
          listen: L.listen,
          stop: L.stop,
          name: L.name(`${copy.wanderers[id].name}'s spectrum`),
          mapping: L.mapping,
        },
      ),
    );
  } else {
    parts.push(
      h('p', { class: 'hint' }, id === 'w0855' ? copy.spectrum.blended : copy.spectrum.tooBright),
    );
  }
  return h('section', { class: 'spectrum-section' }, ...parts);
}

let shownFlags = 0;
/**
 * The photos' own flags, by kind, with how many squares carry each in the photos shown.
 * Saturated is always outlined; the others outline on request. Nothing is ever hidden.
 */
function flagsControl(tiles: Tile[], pack?: string): HTMLElement {
  const count = (bit: number) =>
    tiles.reduce((n, t) => n + t.flags.reduce((m, f) => m + (f & bit ? 1 : 0), 0), 0);
  // In a show the tiles are the pack's own stacks, so the counts can be checked (count:flag).
  const num = (bit: number) => {
    const c = count(bit).toLocaleString('en-GB');
    return pack
      ? h(
          'b',
          {
            'data-claim': `${pack}/${tiles.map((t) => t.id).join('+')}`,
            'data-claim-kind': `count:flag:${Math.log2(bit)}`,
          },
          c,
        )
      : h('b', {}, c);
  };
  const names = copy.watch.meta.flagNames;
  // Too bright is always outlined; the other three outline on request. Each chip says what
  // the flag means on hover (the truth-checked lines), and nothing is ever hidden.
  const chips: HTMLElement[] = [
    h(
      'span',
      { class: 'flag-chip on fixed', title: copy.flags.saturated },
      h('span', { class: 'mk flag', 'aria-hidden': 'true' }),
      num(FlagMask.saturated),
      ` ${names.saturated}`,
    ),
  ];
  for (const [name, bit] of [
    ['rejected', FlagMask.rejected],
    ['source', FlagMask.source],
    ['outlier', FlagMask.outlier],
  ] as const) {
    const b = h(
      'button',
      {
        type: 'button',
        class: `flag-chip ${name}`,
        title: copy.flags[name],
        'aria-pressed': String((shownFlags & bit) !== 0),
      },
      h('span', { class: `mk flag ${name}`, 'aria-hidden': 'true' }),
      num(bit),
      ` ${names[name]}`,
    );
    b.addEventListener('click', () => {
      shownFlags ^= bit;
      b.setAttribute('aria-pressed', String((shownFlags & bit) !== 0));
      lens.setOverlay({ extraFlags: shownFlags });
    });
    chips.push(b);
  }
  return h('span', { class: 'chip-row' }, ...chips);
}

/** The field-of-view choice under a live look, with what it costs to read. */
function fieldControl(photos: number): HTMLElement {
  const group = h('div', { class: 'field', role: 'group', 'aria-label': copy.look.fieldLabel });
  group.append(h('span', {}, copy.look.fieldLabel));
  for (const f of LOOK_FIELDS) {
    const b = h(
      'button',
      { type: 'button', 'aria-pressed': String(f === lookField) },
      h('span', {}, copy.look.field(f)),
      h('small', {}, lookSize(photos, f)),
    );
    b.addEventListener('click', () => {
      if (f === lookField || !live) return;
      lookField = f;
      writeUrl();
      void openLook(live.at);
    });
    group.append(b);
  }
  return h('div', {}, group, h('p', { class: 'hint small' }, copy.look.fieldWhy));
}

/**
 * Copies a link to exactly this view (the position or wanderer is in the URL), for sharing or
 * for embedding with &embed=1. Says "Link copied" for a moment.
 */
function copyLinkButton(): HTMLElement {
  const b = h('button', { type: 'button', class: 'quiet' }, copy.share.copy);
  b.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('embed');
    void navigator.clipboard?.writeText(url.toString()).then(() => {
      b.textContent = copy.share.copied;
      setTimeout(() => (b.textContent = copy.share.copy), 1600);
    });
  });
  return b;
}

/**
 * The same spot in CDS's Aladin Lite (the challenge suggests it), for its other surveys and
 * catalogues. Opens in a new tab.
 */
function aladinLink(at: { ra: number; dec: number }): HTMLElement {
  const target = `${at.ra.toFixed(5)} ${at.dec >= 0 ? '+' : ''}${at.dec.toFixed(5)}`;
  const url = `https://aladin.cds.unistra.fr/AladinLite/?target=${encodeURIComponent(target)}&fov=0.25`;
  const aladin = h(
    'a',
    { class: 'quiet-link', href: url, target: '_blank', rel: 'noopener' },
    copy.share.aladin,
  );
  // WiseView (the challenge's model): WISE's own photos of the same spot from 2010 on, a longer
  // time span than SPHEREx's, which shows slow movers better. It reads #ra=&dec= and fills the
  // rest with its defaults; only the position is sent.
  const wise = h(
    'a',
    {
      class: 'quiet-link',
      href: `http://byw.tools/wiseview#ra=${at.ra.toFixed(5)}&dec=${at.dec.toFixed(5)}&size=176`,
      target: '_blank',
      rel: 'noopener',
      title: copy.share.wiseviewTitle,
    },
    copy.share.wiseview,
  );
  // One labelled line, so the two read as a pair at any width (Viewer, 14 Nov).
  return h('p', { class: 'out-links' }, copy.share.openIn, ' ', aladin, ' · ', wise);
}

/**
 * Facts' footer, one line (Viewer's audit): where the data comes from, this spot in Aladin and
 * WiseView, and (on the five's pages) the tests page.
 */
function factsFooter(at: SkyPosition, release: string | null, tests: boolean): HTMLElement {
  const links = aladinLink(at);
  return h(
    'div',
    { class: 'facts-foot' },
    // The data and how it was tested on one line; places to open this spot on the other (Viewer).
    release || tests
      ? h(
          'p',
          { class: 'hint' },
          release ?? '',
          release && tests ? ' · ' : '',
          tests ? h('a', { href: 'tests.html' }, copy.tests.linkShort) : null,
        )
      : null,
    h('p', { class: 'hint' }, ...Array.from(links.childNodes)),
  );
}

/** "RA 17h 57m 48s, Dec +4° 41′ 00″" for the eyebrow: the same format as the echo and readout. */
function formatPosition(place: typeof state.place): string {
  if (!('at' in place) || !place.at) return '';
  return positionText(place.at);
}

/**
 * The dock's key: the cards' three status marks (they're on every screen), in the cards' own
 * words, plus only the marks this screen adds.
 */
function markKey(kind: 'sky' | 'motion' | 'status' | 'look' | 'watch'): HTMLElement {
  const k = copy.key;
  const status: [string, string][] = [
    ['measured', k.measured],
    ['unconfirmed', copy.statusChip.unconfirmed],
    ['unmeasured', copy.statusChip.unmeasured],
  ];
  const extra: [string, string][] =
    kind === 'sky'
      ? [['catalogue', k.catalogue]]
      : kind === 'motion'
        ? [
            ['predicted', k.predicted],
            ['steady', k.steady],
            ['flag', k.flag],
          ]
        : kind === 'watch'
          ? [
              ['photo', k.photo],
              ['flag', k.flag],
            ]
          : kind === 'status'
            ? [['flag', k.flag]]
            : [
                ['look', k.look],
                ['flag', k.flag],
              ];
  return h(
    'ul',
    { class: 'mark-key', 'aria-label': k.label },
    ...[...status, ...extra].map(([mark, label]) =>
      h('li', {}, h('span', { class: `mk ${mark}`, 'aria-hidden': 'true' }), label),
    ),
  );
}

function renderBand(): void {
  drawBand();
  fitText(band);
  // The band's height changes (rows arrive, a typed row): the sky's quiet zones follow it.
  requestAnimationFrame(refocus);
}

function drawBand(): void {
  const place = state.place;
  const dock = (middle: HTMLElement | null, key: HTMLElement) =>
    middle ? h('div', { class: 'dock-row' }, middle, key) : key;
  band.hidden = false;
  if (place.kind === 'sky' && state.room !== 'learn') {
    // The strip (when SPHEREx photographed the five, a typed spot, the weeks) lives in Learn
    // (Sumit, 14 Nov): Play's sky is the search and the map, and the map takes the room.
    skyBandNow = null;
    band.replaceChildren();
    band.hidden = true;
    return;
  }
  if (place.kind === 'sky') {
    const rows = homeBand();
    if (rows) {
      // Rebuilt on each render: keep the keyboard where it was (a row, the slider, play).
      const a = document.activeElement as HTMLElement | null;
      const sel =
        !a || !band.contains(a)
          ? null
          : a.dataset['id']
            ? `.sb-row[data-id="${a.dataset['id']}"]`
            : a.classList.contains('sb-slider')
              ? '.sb-slider'
              : a.classList.contains('sb-play') || a.classList.contains('sb-close')
                ? '.sb-play'
                : a.classList.contains('sb-flat')
                  ? '.sb-slider'
                  : null;
      band.replaceChildren(rows.el);
      skyBandNow = rows;
      if (sel) (band.querySelector(sel) as HTMLElement | null)?.focus({ preventScroll: true });
      markWeekRows();
      return;
    }
    skyBandNow = null;
    band.replaceChildren(dock(weeksFigure(), markKey('sky')), caseRail());
    return;
  }
  skyBandNow = null;
  if (!current || !('target' in place)) {
    // A live look: its own photos as dots, the compared pair bracketed.
    const plan = live?.plan;
    const dots =
      plan?.kind === 'pair'
        ? photoDots(
            plan.all,
            [plan.pair.a.season, plan.pair.b.season],
            null,
            null,
            undefined,
            copy.ribbon.checked(plan.total),
          )
        : null;
    // Still finding: a placeholder the ribbon's size, so the band doesn't grow when it lands.
    const waiting =
      !dots && (place.kind === 'finding' || place.kind === 'filling')
        ? h(
            'div',
            { class: 'ribbon-figure skel-ribbon', 'aria-hidden': 'true' },
            skel('skel-block'),
          )
        : null;
    band.replaceChildren(dock(dots ?? waiting, markKey('look')), caseRail());
    return;
  }
  // One dock everywhere: the photos as dots, then the same five cards as on the sky.
  const shown = showing === null ? null : current.show.seasons[showing];
  const watch =
    state.room === 'watch' && watching !== null
      ? { detector: watching, current: seriesPhoto }
      : undefined;
  band.replaceChildren(
    dock(
      ribbon(current.pack, current.show.seasons, shown, watch),
      markKey(
        state.room === 'watch' ? 'watch' : current.show.kind === 'motion' ? 'motion' : 'status',
      ),
    ),
    caseRail(place.target),
  );
}

/* ---------- the homepage band: the five as rows, a typed spot, one week cursor ---------- */

let bandData: BandFile | null = null;
let skyBandNow: SkyBand | null = null;
void fetch(`${import.meta.env.BASE_URL}data/band/band.json`)
  .then((r) => (r.ok ? (r.json() as Promise<BandFile>) : null))
  .catch(() => null)
  .then((d) => {
    bandData = d?.format === 'planetes-band/1' ? d : null;
    if (bandData && state.place.kind === 'sky') renderBand();
  });

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const shortMonth = (mjd: number) => {
  const d = new Date((mjd - 40587) * 86_400_000);
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

function homeBand(): SkyBand | null {
  const d = bandData;
  if (!d) return null;
  const rows = WANDERERS.map((w) => {
    const frames = d.targets[w.id] ?? [];
    const passes = passCount(frames.map((f) => f[0]));
    const status = caseStatus(w.id);
    const chip = status ? cardChip(w.id, status) : null;
    // Spoken, not drawn: "moved about 10″ north, measured", "fainter, measured".
    const chipText = chip?.textContent ?? '';
    const said =
      status === 'measured' && chipText.startsWith('≈')
        ? `${chipText.replace(/^≈\s*/, 'moved about ')}, measured`
        : chipText;
    return {
      id: w.id,
      name: copy.wanderers[w.id].name,
      chip,
      label: copy.home.rowLabel(
        copy.wanderers[w.id].name,
        said || copy.card.comingSoon,
        frames.length,
        passes,
      ),
      frames,
      disabled: !w.ready,
    };
  });
  const t = typed;
  const name = t?.name ?? copy.home.spotTitle;
  const starts = t?.mjds ? passStarts(t.mjds) : [];
  const line = !t
    ? // G3: once the photo list is newer than the coverage map, say so (Viewer, 15 Nov).
      indexUpdated
      ? `${d.survey.line} ${copy.home.coverageAsOf(dayMonthYear(isoToMjd(indexUpdated)))}`
      : d.survey.line
    : t.failed
      ? copy.home.spotFailed(name)
      : !t.mjds
        ? copy.home.spotLoading(name)
        : copy.home.spotLine(name, starts.length, starts.map(shortMonth).join(', '), t.mjds.length);
  const c = sweep.coverage;
  return skyBand({
    data: d,
    rows,
    spot: t
      ? {
          title: t.name ?? copy.home.spotTitle,
          short: t.mjds
            ? copy.home.spotPasses(starts.length)
            : t.failed
              ? ''
              : copy.home.spotLooking,
          counts: t.mjds ? weekCounts(t.mjds, d.weeks) : null,
        }
      : null,
    line,
    week: sweep.open ? sweep.week : null,
    weekText: (k) => {
      const w = d.weeks[k];
      const cw = c?.meta.weeks[k];
      if (!w) return '';
      const from = new Date((w.start - 40587) * 86_400_000);
      const to = new Date((w.end - 1 - 40587) * 86_400_000);
      const same = from.getUTCMonth() === to.getUTCMonth();
      const day = (x: Date) =>
        `${x.getUTCDate()} ${SHORT_MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
      return copy.home.band.weekText(
        same ? String(from.getUTCDate()) : day(from).replace(/ \d{4}$/, ''),
        day(to),
        cw?.frames ?? 0,
      );
    },
    playing: !!sweep.timer,
    canPlay: !!c && !prefersReducedMotion(),
    text: copy.home.band,
    onOpen: (id) => void go(id as TargetId),
    onLit: (id) => sky.setLit(id as TargetId | null),
    onWeek: (k) => {
      // First use turns the week's photos on (off by default; Viewer, 14 Nov).
      if (!sweep.coverage) return;
      sweep.open = true;
      setWeek(k, false);
    },
    onPlay: () => {
      if (sweep.timer) return stopSweep();
      if (!sweep.open) {
        sweep.open = true;
        sweep.week = 0;
        setWeek(0, true);
      }
      playSweep();
    },
    onClose: closeWeek,
    onFlat: state.entry === 'inside' ? () => switchEntry('flat') : null,
    testsLink: { href: 'tests.html', text: copy.tests.linkShort },
  });
}

/** Turns the week's photos off the sky (Esc, or the band's ×). */
function closeWeek(): void {
  const hadFocus = band.contains(document.activeElement);
  sweep.open = false;
  stopSweep();
  sky.setCoverage(null);
  sky.setDate(new Date());
  skyBandNow?.setWeek(null, false);
  markWeekRows();
  if (hadFocus)
    (band.querySelector('.sb-slider') as HTMLElement | null)?.focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !sweep.open || state.place.kind !== 'sky' || e.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return;
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  closeWeek();
});

/** A row lights when its target was photographed in the week shown. */
function markWeekRows(): void {
  const c = sweep.coverage;
  const counts = c && sweep.open ? c.week(sweep.week) : null;
  for (const row of band.querySelectorAll<HTMLElement>('.sb-row')) {
    const target = WANDERERS.find((x) => x.id === row.dataset['id']);
    const pix = c && target ? pixelOf(c.nside, target.at) : undefined;
    row.classList.toggle('this-week', !!counts && pix !== undefined && (counts[pix] ?? 0) > 0);
  }
}

/**
 * The landing's dock: how many photos SPHEREx took each week, one bar a week. It is also the
 * way into "Where did SPHEREx look?": a bar opens the sweep at its week.
 */
function weeksFigure(): HTMLElement | null {
  const c = sweep.coverage;
  if (!c) return null;
  const weeks = c.meta.weeks;
  const most = Math.max(1, ...weeks.map((w) => w.frames));
  const total = weeks.reduce((n, w) => n + w.frames, 0);
  const W = 1000;
  const bw = W / weeks.length;
  const s = svg('svg', {
    viewBox: `0 0 ${W} 52`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': copy.sky.weeks.label(total, weeks.length),
  });
  weeks.forEach((w, i) => {
    const hgt = (w.frames / most) * 44;
    const bar = svg('rect', {
      x: i * bw + bw * 0.15,
      y: 48 - hgt,
      width: bw * 0.7,
      height: Math.max(1, hgt),
      class: sweep.open && i === sweep.week ? 'wk on' : 'wk',
    });
    bar.addEventListener('click', () => {
      if (!sweep.open) toggleSweep();
      setWeek(i, false);
      renderBand();
    });
    s.append(bar);
  });
  const first = weeks[0]?.startUtc ?? '';
  const last = weeks[weeks.length - 1]?.endUtc ?? '';
  return h(
    'div',
    { class: 'ribbon-figure weeks' },
    h(
      'p',
      { class: 'ribbon-count' },
      h('b', {}, total.toLocaleString('en-GB')),
      h('span', {}, copy.sky.weeks.unit(weeks.length)),
    ),
    h(
      'div',
      {},
      s as unknown as Node,
      h(
        'div',
        { class: 'ribbon-labels' },
        h('span', {}, monthDay(first)),
        h('span', {}, monthDay(last)),
      ),
    ),
  );
}

function renderMoon(): void {
  const g = current
    ? current.pack.manifest.grid
    : live
      ? { size: lookGrid().size, pixelScaleArcsec: SCALE_ARCSEC }
      : null;
  if (!g) return;
  const fieldArcmin = (g.size * g.pixelScaleArcsec) / 60;
  // The full Moon is about 31 arcminutes across; the square is this view, to scale.
  moonDisc.style.setProperty('--field', `${((fieldArcmin / 31) * 100).toFixed(1)}%`);
  moonDisc.title = copy.moon;
}

/* ---------- the time sweep: where SPHEREx looked, week by week ---------- */

const sweep = { coverage: null as Coverage | null, open: false, week: 0, timer: 0 };
const sweepLabel = h('p', { class: 'sweep-week' });
const sweepFrames = h('p', { class: 'hint' });
const sweepSlider = h('input', { type: 'range', min: '0', value: '0', 'aria-label': 'Week' });
const sweepPlay = h('button', { type: 'button', class: 'sweep-play' }, copy.sky.sweep.play);
sweepSlider.addEventListener('input', () => setWeek(Number(sweepSlider.value), false));
sweepPlay.addEventListener('click', () => (sweep.timer ? stopSweep() : playSweep()));
sky.onSweep = (step) => {
  if (sweep.open) setWeek(sweep.week + step, false);
};

void (async () => {
  for (const release of COVERAGE_RELEASES) {
    const c = await loadCoverage(import.meta.env.BASE_URL, release);
    if (c) return c;
  }
  return null;
})().then((c) => {
  sweep.coverage = c;
  if (c) sweepSlider.max = String(c.meta.weeks.length - 1);
  render();
});

/** Shows the week on the sky: its coverage, and the Sun where it was then. */
function setWeek(week: number, fromPlay: boolean): void {
  const c = sweep.coverage;
  if (!c) return;
  const n = c.meta.weeks.length;
  sweep.week = ((week % n) + n) % n;
  if (!fromPlay) stopSweep();
  const w = c.meta.weeks[sweep.week];
  if (!w) return;
  sweepSlider.value = String(sweep.week);
  // "24 to 30 April 2025", or the full dates when the week crosses a month.
  const from = new Date(`${w.startUtc}T00:00:00Z`);
  const to = new Date(`${w.endUtc}T00:00:00Z`);
  const sameMonth =
    from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear();
  sweepLabel.textContent = copy.sky.sweep.week(
    sameMonth ? String(from.getUTCDate()) : monthDay(w.startUtc),
    monthDay(w.endUtc),
  );
  sweepFrames.textContent = copy.sky.sweep.frames(w.frames);
  sky.setCoverage(c, sweep.week);
  sky.setDate(new Date(((w.startMjd + w.endMjd) / 2 - 40587) * 86_400_000));
  skyBandNow?.setWeek(sweep.open ? sweep.week : null, !!sweep.timer);
  markWeekRows();
  // The cards answer: a light under that week's band was photographed then.
  const counts = c.week(sweep.week);
  for (const card of band.querySelectorAll<HTMLElement>('.card')) {
    const target = WANDERERS.find((x) => x.id === card.dataset['id']);
    const pix = target && pixelOf(c.nside, target.at);
    card.classList.toggle('this-week', pix !== undefined && (counts[pix] ?? 0) > 0);
  }
}

/** The nside-N NESTED pixel holding a position, by nearest centre (fine at nside 16). */
const pixelCache = new Map<string, number>();
function pixelOf(nside: number, p: { ra: number; dec: number }): number {
  const key = `${nside}:${p.ra}:${p.dec}`;
  const hit = pixelCache.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestSep = Infinity;
  for (let pix = 0; pix < npix(nside); pix++) {
    const sep = separationDeg(p, pixelCentre(nside, pix));
    if (sep < bestSep) {
      bestSep = sep;
      best = pix;
    }
  }
  pixelCache.set(key, best);
  return best;
}

function monthDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function playSweep(): void {
  if (prefersReducedMotion()) return;
  stopSweep();
  sweepPlay.textContent = copy.sky.sweep.pause;
  sweep.timer = window.setInterval(() => setWeek(sweep.week + 1, true), 450);
  skyBandNow?.setWeek(sweep.open ? sweep.week : null, true);
}

function stopSweep(): void {
  if (sweep.timer) window.clearInterval(sweep.timer);
  sweep.timer = 0;
  sweepPlay.textContent = copy.sky.sweep.play;
  skyBandNow?.setWeek(sweep.open ? sweep.week : null, false);
}

function toggleSweep(): void {
  sweep.open = !sweep.open;
  if (sweep.open) setWeek(sweep.week, false);
  else {
    stopSweep();
    sky.setCoverage(null);
    sky.setDate(new Date());
  }
  render();
}

/** The room at the last render, so leaving Learn by any route resets what only Learn uses. */
let renderedRoom = state.room;
/**
 * What the tour did to the view (Viewer, 15 Nov): the visitor's view before the tour first moved
 * it, and the view the tour last set. Leaving Learn restores the first only if the view is still
 * the tour's; a view the visitor picked themselves during Learn is theirs to keep.
 */
let learnFrom: Entry | null = null;
let tourSetEntry: Entry | null = null;
function tourEntry(e: Entry): void {
  learnFrom ??= state.entry;
  tourSetEntry = e;
  // Out at Earth, step back in before changing view, so the sky isn't left stepped out behind
  // the flat map (Back from "From out here").
  if (e !== 'inside' && state.entry === 'inside' && sky.steppedOut) sky.stepOutTo(0);
  goEntry(e);
}

/** The place whose column was last drawn as placeholders (null when it was ready). */
let wordsLoadingFor: string | null = null;

/** The faint scan arc over the lens while a look's photos are found and read. */
function placeLensScan(): void {
  const k = state.place.kind;
  const on = (k === 'finding' || k === 'filling') && !live?.landed.length;
  lensScan.hidden = !on;
  if (!on) return;
  // Placed by CSS on the lens's own box (5% inset, 90% wide), never measured mid-dive (Sumit:
  // the arc sat off-centre for a moment while the lens was still scaling in).
}

function render(): void {
  // Leaving Learn by any route (Play, the logo, a target, the back button), not only Play's
  // button: its brighter coverage, the sweep, riding and the step out all end (Sumit, 15 Nov:
  // the logo kept Learn's coverage in Play).
  if (renderedRoom === 'learn' && state.room !== 'learn') {
    renderedRoom = state.room;
    leaveLearn();
  }
  renderedRoom = state.room;
  markRide();
  // Scrolling out stops at the widest sky everywhere; Earth is Learn's tour step (Sumit, 15 Nov).
  if (state.place.kind !== 'sky' || state.entry !== 'inside') wholeSkyHint.hidden = true;
  sky.marks = state.place.kind === 'sky';
  app.dataset['place'] = state.place.kind;
  // On the sky, the header, the words and the band sit on the night in either scheme.
  for (const el of [header, stage, band]) el.classList.toggle('on-sky', state.place.kind === 'sky');
  app.dataset['room'] = state.room;
  app.dataset['entry'] = state.entry;
  app.dataset['show'] = current?.show.kind ?? 'none';
  for (const b of dial.querySelectorAll('button'))
    b.setAttribute(
      'aria-pressed',
      String(b.dataset['room'] === (state.room === 'watch' ? 'play' : state.room)),
    );
  markEntry();
  const inShow = state.place.kind !== 'sky';
  homeLink.setAttribute('aria-label', inShow ? copy.nav.backToSky : copy.nav.home);
  homeLink.title = inShow ? copy.nav.backToSky : copy.nav.home;
  const tabHadFocus = !!(document.activeElement as HTMLElement | null)?.closest?.('.panel-tabs');
  const searchHadFocus = document.activeElement === search;
  const caret = [search.selectionStart, search.selectionEnd] as const;
  const colourHadFocus = !!(document.activeElement as HTMLElement | null)?.closest?.('.colour-row');
  const active = document.activeElement as HTMLElement | null;
  const landingFree = !active || active === document.body || !!active.dataset['landing'];
  // A catalogue chip keeps the keyboard through the rebuild its own press causes (Viewer).
  const chipHadFocus = active?.dataset['chip'] ?? null;
  const wasLoading = wordsLoadingFor;
  words.replaceChildren(...renderWords());
  // Loading ends: the column fades in once instead of snapping (never on every rebuild).
  const nowLoading = !!words.querySelector('[aria-busy="true"].panel-summary, .skel-hero');
  const placeId = JSON.stringify(
    'target' in state.place
      ? state.place.target
      : 'at' in state.place
        ? state.place.at
        : state.place.kind,
  );
  wordsLoadingFor = nowLoading ? placeId : null;
  if (wasLoading === placeId && !nowLoading) {
    words.classList.remove('arrive');
    void words.offsetWidth;
    words.classList.add('arrive');
  }
  placeLensScan();
  // The sky's spoken caption ("Looking near …") belongs to the sky: off a page, it's emptied so a
  // screen reader doesn't hear the old sky place during a look (Viewer).
  if (state.place.kind !== 'sky') focusCaption.textContent = '';
  // N7: after the tour ends into a spot, focus lands on where the visitor arrived (the look's
  // summary, or a page's heading), and stays there as the column is rebuilt (Viewer).
  // For a short while (the look's column is rebuilt as its photos arrive, sometimes with no
  // heading), it's re-applied whenever focus is on nothing or on the landing itself, never taken
  // from something the visitor chose.
  if (chipHadFocus)
    words
      .querySelector<HTMLElement>(`[data-chip="${chipHadFocus}"]`)
      ?.focus({ preventScroll: true });
  if (performance.now() < focusLandingUntil && state.place.kind !== 'sky' && landingFree) {
    const t = words.querySelector<HTMLElement>('.panel-summary, h2');
    if (t) {
      t.tabIndex = -1;
      t.dataset['landing'] = '1';
      t.focus({ preventScroll: true });
    }
  }
  // The colour row keeps the keyboard: it's rebuilt on every render (each photo arriving), so
  // focus returns to the shown colour whenever it was in the row, and after a switch once the
  // new colour is on screen (Viewer, 14 Nov).
  if (colourHadFocus || refocusColour) {
    const b = words.querySelector<HTMLElement>('.colour-row [aria-checked="true"]');
    if (b && (!refocusColour || Number(b.dataset['det']) === refocusColour)) {
      b.focus({ preventScroll: true });
      refocusColour = 0;
    }
  }
  // The search input lives in the homepage column, and in the header everywhere else.
  if (!words.contains(searchBox)) searchAnchor.after(searchBox);
  if (searchHadFocus && document.activeElement !== search) {
    search.focus({ preventScroll: true });
    if (caret[0] !== null) search.setSelectionRange(caret[0], caret[1]);
  }
  app.classList.toggle('home', words.contains(search));
  if (tabHadFocus)
    (words.querySelector('.panel-tabs [aria-selected="true"]') as HTMLElement | null)?.focus();
  const tabbed = !!words.querySelector('.panel-tabbed');
  words.classList.toggle('tabbed', tabbed);
  // Phones: the tabbed column is a sheet with three heights; the handle steps through them.
  if (tabbed) {
    words.prepend(sheetHandle);
    words.dataset['sheet'] = sheetHeight;
  } else delete words.dataset['sheet'];
  // Tabbed pages give the words column the full height: the band sits under the lens only.
  app.classList.toggle('panel-full', tabbed);
  // Shown once the page has its final shape (the tabbed column), not the half-built first pass.
  if (
    state.place.kind !== 'sky' &&
    app.classList.contains('booting') &&
    (app.classList.contains('panel-full') || state.place.kind === 'trouble')
  )
    // The tabbed layout settles a frame or two later: reveal just after it.
    setTimeout(() => app.classList.remove('booting'), 120);
  markMore();
  requestAnimationFrame(refocus);
  renderBand();
  renderMoon();
  fitText(app);
}

/** Flags the words column when it has more below than it shows. */
function markMore(): void {
  const scrolls = getComputedStyle(words).overflowY !== 'visible';
  words.classList.toggle(
    'more',
    scrolls && words.scrollHeight - words.scrollTop - words.clientHeight > 4,
  );
}
words.addEventListener('scroll', markMore, { passive: true });
addEventListener('resize', markMore);

/* ---------- URL state: ?entry=globe|flat|inside&target=barnard ---------- */

function writeUrl(): void {
  const q = new URLSearchParams({ entry: state.entry });
  if (theme) q.set('theme', theme);
  if (embedded) q.set('embed', '1');
  if ('at' in state.place && lookField !== 4) q.set('field', String(lookField));
  if (state.place.kind !== 'sky') {
    const tab = activeTab();
    if (tab !== 'compare') q.set('tab', tab);
  }
  if ('target' in state.place) {
    q.set('target', state.place.target);
    const pair = chosenPair.get(state.place.target);
    if (pair) q.set('looks', `${pair[0] + 1}-${pair[1] + 1}`);
    if (differencing) q.set('view', 'difference');
  } else if ('at' in state.place && state.place.at) {
    q.set('at', `${state.place.at.ra.toFixed(5)},${state.place.at.dec.toFixed(5)}`);
    if (surprise) q.set('spot', slug(surprise.name));
    // The colour shown, so a shared link shows what its sender saw.
    if (live?.colour) q.set('det', String(live.colour.chosen));
  }
  history.replaceState(null, '', `?${q}`);
}

const q = new URLSearchParams(location.search);
// N6's distance dial was folded into "Why a far planet loops" (Sumit, 15 Nov): old links land on its model.
if (q.get('demo') === 'dial') location.replace('./loop.html?view=model');
const wantedEntry = q.get('entry');
// ?entry=globe (old links) now means stepping out to Earth and the orbit from Look around.
const entry = wantedEntry === 'flat' ? 'flat' : 'inside';
dispatch({ type: 'setEntry', entry });
// A link straight to a page: the app stays hidden until that page is laid out, then fades in,
// instead of drawing the homepage first and re-laying out (Sumit, 15 Nov). Never longer than 1.5 s.
if (q.get('target') || q.get('at')) {
  app.classList.add('booting');
  setTimeout(() => app.classList.remove('booting'), 1500);
}
render();
placeSky(entry);
locator.setEntry('flat');
sky.start(prefersReducedMotion());
// Earth drawn without WebGL samples the same monthly NASA Blue Marble as the 3D view.
sky.setEarthMap(
  (m) => `${import.meta.env.BASE_URL}textures/earth-day-${String(m).padStart(2, '0')}.jpg`,
);
if (wantedEntry === 'globe') sky.stepOutTo(1);
// How much this device can draw, measured from its frames (Neural's rules): the light tier
// draws a coarser glow, fewer stars and a cheaper blur. Tier 2 is reserved for full 3D.
// Tier 2 (full 3D) only where WebGL2 runs on a screen wider than a phone's; ?detail=3d forces
// it, ?detail=simple keeps the light tier. three.js loads only when tier 2 is first reached.
const detail = q.get('detail');
const allow3D = detail !== 'simple' && (detail === '3d' || canRun3D());
let scene3dLoading = false;
watchQuality(
  {
    min: 0,
    max: detail === 'simple' ? 0 : allow3D ? 2 : 1,
    start: detail === '3d' ? 2 : detail === 'simple' ? 0 : 1,
  },
  (tier) => {
    sky.setQuality(tier);
    app.dataset['quality'] = String(tier);
    if (tier >= 2 && !scene3dLoading) {
      scene3dLoading = true;
      // Look around and stepping out: Earth, the orbit and SPHEREx in full 3D.
      void import('./render/scene/scene3d')
        .then(({ Scene3D }) => {
          const theme = getComputedStyle(document.documentElement);
          const scene3d = new Scene3D(
            {
              dayUrl: (m) =>
                `${import.meta.env.BASE_URL}textures/earth-day-${String(m).padStart(2, '0')}.jpg`,
              nightUrl: `${import.meta.env.BASE_URL}textures/earth-night.jpg`,
            },
            {
              orbit: theme.getPropertyValue('--sky-mist').trim() || '#d2cbc2',
              look: theme.getPropertyValue('--sky-look').trim() || '#6fb7d6',
            },
          );
          sky.setScene3D(scene3d);
          if (import.meta.env.DEV)
            Object.assign(window, { scene3d, sky, setTier: (t: number) => sky.setQuality(t) });
        })
        .catch(() => sky.setScene3D(null));
    }
  },
  () => sky.workMs,
);
if (import.meta.env.DEV) Object.assign(window, { sky });
const wanted = WANDERERS.find((w) => w.id === q.get('target') && w.ready);
const wantedAt = positionFromQuery(q);
// The flat map's projection: Equal Earth (Viewer, 14 Nov); ?flatmap=hammer for comparison.
if (q.get('flatmap') === 'hammer') sky.flatProjection = 'hammer';
const wantedLooks = q
  .get('looks')
  ?.split('-')
  .map((x) => Number(x) - 1);
// Earlier look first, two different looks: a reversed pair would flip the difference.
if (
  wanted &&
  wantedLooks?.length === 2 &&
  wantedLooks.every((x) => Number.isInteger(x) && x >= 0) &&
  (wantedLooks[0] ?? 0) < (wantedLooks[1] ?? 0)
)
  chosenPair.set(wanted.id, [wantedLooks[0] ?? 0, wantedLooks[1] ?? 1]);
// A shared ?tab=watch on one of the five opens the Watch room (on their pages Watch is the room).
if (wanted && startTab === 'watch') dispatch({ type: 'setRoom', room: 'watch' });
if (wanted)
  void openWanderer(wanted.id).then(() => {
    if (q.get('view') === 'difference') void showDifference();
  });
else if (wantedAt) {
  // A shared surprise keeps its name and line, if the spot is still in the list.
  const spot = q.get('spot');
  const det = Number(q.get('det'));
  const wantedDet = Number.isInteger(det) && det >= 1 && det <= 6 ? (det as Detector) : undefined;
  void (spot ? loadSurprises() : Promise.resolve([])).then((list) =>
    openLook(
      wantedAt,
      // The name only if the link's position really is that star (within 5″).
      list.find(
        (x) =>
          slug(x.name) === spot && separationDeg(wantedAt, { ra: x.ra, dec: x.dec }) * 3600 < 5,
      ) ?? null,
      wantedDet ? { detector: wantedDet } : {},
    ),
  );
}
