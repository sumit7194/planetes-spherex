import './styles/tokens.css';
import './styles/base.css';
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
} from './app/targets';
import { planCandidates, probeChoice, type LiveCandidate, type LookPlan } from './app/live';
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
  positionFromQuery,
  separationDeg,
  type SkyPosition,
} from './data/coords';
import {
  findPhotos,
  helperActive,
  liveSpectrum,
  probePhoto,
  readPhoto,
  warmUp,
  type LiveSpectrum,
  seasonsOf as passesOf,
  type LivePhoto,
  type LiveFrame,
} from './data/live/dr1qr3';
import { loadCoverage, type Coverage } from './data/coverage';
import { npix, pixelCentre } from './data/healpix';
import {
  loadPack,
  loadTile as loadPackTile,
  stackPair,
  type LoadedPack,
  type Tile,
} from './data/pack/load';
import { coadd } from './data/pack/coadd';
import { knownMoversAt } from './data/live/skybot';
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
import { sharedStretch, type Stretch } from './render/stretch';
import { parseGlow } from './render/milkyway';
import { canRun3D, watchQuality } from './render/quality';
import { h, prefersReducedMotion } from './ui/dom';
import { parseTab, tabbedPanel, type PanelTab, type TabSpec } from './ui/tabs';
import { fitLabels, fitText } from './ui/fit';
import { lensGlass } from './ui/glass';
import { schemeSwitch, watchScheme } from './ui/scheme';
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
  type SpectrumPoint,
} from './ui/figures';
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
/** Whether the viewer has dragged or zoomed the sky yet (the move hint goes after that). */
let movedSky = false;
/** A live look at a typed spot: its plan, the photos as they land, and what's shown. */
let live: {
  at: SkyPosition;
  plan: LookPlan<LivePhoto> | null;
  /** While checking colours: photos checked so far, of how many, of all found. */
  probe: { done: number; total: number; of: number } | null;
  /** Every photo of the spot in the sky index (the spectrum picks from these). */
  photos: LivePhoto[];
  landed: { candidate: LiveCandidate<LivePhoto>; tile: Tile; key: string }[];
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
const search = h('input', {
  class: 'search glass',
  type: 'search',
  placeholder: copy.sky.search,
  // Positions are ICRS (J2000): an old B1950 position is up to ~0.7° off by precession alone.
  title: copy.search.frame,
  'aria-description': copy.search.frame,
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
  search,
  schemeSwitch(copy.scheme, copy.scheme.group),
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
const locator = new SkyView(locatorCanvas);
const lens = new LensView(lensCanvas);
// Screen readers hear what the lens shows, not just "Lens": its caption, kept in step.
new MutationObserver(() => {
  const parts = [...lensLabel.children].map((c) => c.textContent?.trim()).filter(Boolean);
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
  b.addEventListener('click', () => goEntry(entry));
  entrySwitch.append(b);
  // Between them, "From space": stepping out from SPHEREx to Earth and its orbit.
  if (entry === 'inside') entrySwitch.append(spaceButton);
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
entrySwitch.append(rideButton);
function markRide(): void {
  rideButton.textContent = sky.riding ? copy.sky.riding.riding : copy.sky.riding.ride;
  rideButton.setAttribute('aria-pressed', String(sky.riding));
  // Riding is motion, so under reduced motion it's off and the control is hidden.
  rideButton.hidden = state.entry !== 'inside' || sky.steppedOut || prefersReducedMotion();
}
sky.onRide = () => markRide();
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
for (const room of ['play', 'learn', 'watch'] as const) {
  const b = h('button', { type: 'button', 'data-room': room }, copy.rooms[room]);
  b.addEventListener('click', () => {
    if (room !== state.room) leaveDifference();
    if (room !== 'watch' && watching !== null) void playColour(watching);
    if (room === 'watch') watchOpened = true;
    dispatch({ type: 'setRoom', room });
    if (room === 'learn') runTourStep(0);
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
sky.onFirstMove = () => {
  movedSky = true;
  if (state.place.kind === 'sky') render();
};
// Anywhere else on the sky is real and clickable: a tap opens a look at that spot (near a
// wanderer, its show), the same as typing the position.
sky.onSkyTap = (at) => {
  const near = WANDERERS.find((w) => w.ready && separationDeg(w.at, at) < NEAR_WANDERER_DEG);
  if (near) void go(near.id);
  else void openLook(at);
};
sky.setLanterns(lanterns);
locator.setLanterns(lanterns.map((l) => ({ ...l, label: '' })));
void fetch(`${import.meta.env.BASE_URL}catalog/bright-stars-v8.json`)
  .then((r) => r.json() as Promise<{ stars: CatalogueStar[] }>)
  .then((c) => {
    sky.setStars(c.stars);
    locator.setStars(c.stars);
    catalogueStars = c.stars;
    indexStarNames();
    return loadFigures(c.stars);
  })
  .then((figures) => sky.setFigures(figures))
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
  })
  .catch(() => undefined);

/* ---------- names in the search box: the five by any common name, and the IAU-named stars ---------- */

let catalogueStars: CatalogueStar[] = [];
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
  barnard: ["Barnard's Star", 'Barnard', 'Barnards star', 'GJ 699', 'HIP 87937'],
  w0855: ['WISE 0855', 'WISE 0855-0714', 'WISE J0855', 'WISE J085510.83-071442.5'],
  'epsind-b': ['Epsilon Indi B', 'eps Ind B', 'ε Indi B', 'Epsilon Indi Ba', 'Epsilon Indi Bb'],
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
sky.onHandOver = () => {
  const at = sky.lookCentre();
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
sky.onSettle = (at) => void latestPhotoMjd(at).then((mjd) => sky.setLookDate(mjd));

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
let typedNote: { id: TargetId; text: string } | null = null;
/** An angle for people: arcminutes from one, else arcseconds. */
function angleText(arcsec: number): string {
  return arcsec >= 60 ? `${(arcsec / 60).toFixed(1)}′` : `${Math.round(arcsec)}″`;
}

// Open the connections a live look will use while the visitor is still typing (once a page).
search.addEventListener('focus', warmUp, { once: true });
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
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
        Math.floor(past.year),
        angleText(past.movedArcsec),
      ),
    };
  if (near?.ready) void openWanderer(near.id);
  else if (near) {
    searchNote = copy.search.wandererSoon(copy.wanderers[near.id].name);
    render();
  } else void openLook(parsed.position);
});
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
    ...([0, 1] as const).map((i) =>
      h(
        'span',
        { class: i === index ? 'on' : '' },
        h('b', {}, String(passNo(i))),
        ` ${lookMonth(i)}`,
      ),
    ),
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
async function planLiveLook(
  at: SkyPosition,
  signal: AbortSignal,
  onProbe: (done: number, total: number, of: number) => void,
): Promise<{ plan: LookPlan<LivePhoto>; photos: LivePhoto[] }> {
  const photos = await findPhotos(at);
  return { plan: await planFrom(photos, at, signal, onProbe), photos };
}

async function planFrom(
  photos: LivePhoto[],
  at: SkyPosition,
  signal: AbortSignal,
  onProbe: (done: number, total: number, of: number) => void,
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

/** A live look at a famous fast star or variable, a different one from the last. */
async function surpriseMe(): Promise<void> {
  warmUp();
  const spots = await loadSurprises();
  const others = spots.filter((x) => x.name !== surprise?.name);
  const pick = others[Math.floor(Math.random() * others.length)];
  if (!pick) return;
  await openLook({ ra: pick.ra, dec: pick.dec }, pick);
}

async function openLook(at: SkyPosition, named: SurpriseSpot | null = null): Promise<void> {
  surprise = named;
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
  };
  live = look;
  dispatch({ type: 'goTo', at });
  writeUrl();
  trueScaleFig.hidden = true;
  lensLabel.replaceChildren();
  locator.setLanterns([{ id: 'look', at, label: '', ready: true, measured: false }]);
  locator.frameWholeSky(at);

  let plan: LookPlan<LivePhoto>;
  try {
    const found = await planLiveLook(at, look.abort.signal, (done, total, of) => {
      if (live !== look) return;
      look.probe = { done, total, of };
      const line = words.querySelector('.probing');
      if (line) line.textContent = copy.look.probing(done, total, of);
      else render();
    });
    plan = found.plan;
    look.photos = found.photos;
  } catch {
    if (live === look)
      dispatch({ type: 'trouble', reason: navigator.onLine ? 'index-missing' : 'offline' });
    return;
  }
  if (live !== look) return;
  look.plan = plan;
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
    look.landed.push({ candidate: c, tile: frame.tile, key: c.hit.key });
    dispatch({ type: 'frameIn' });
  });
  if (live === look && !look.done) finishLook(look);
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
  const grid = lookGrid();
  void moversOn(
    look.at,
    look.landed.map((x) => x.candidate.mjd),
    grid.size,
    grid.scaleArcsec,
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

function holdStart(): void {
  // Holding during the reveal ends it: the visitor has seen enough to want to compare.
  if (!takeLens() || !current) return;
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
}

/** Photos already read, per pack and photo id: the difference and the colour pictures share them. */
const photoTiles = new Map<string, Promise<Tile>>();
function photoTile(pack: LoadedPack, f: Frame): Promise<Tile> {
  const key = `${pack.base}/${f.id}`;
  let p = photoTiles.get(key);
  if (!p) {
    p = loadPackTile(pack.base, pack.manifest.grid.size, f);
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
    h('p', { class: 'hint' }, copy.show.diffHow(differencing.sigma.toPrecision(2))),
    h('p', { class: 'hint' }, copy.show.diffColours(differencing.detectors)),
    differencing.canNarrow ? diffScopeToggle(differencing) : null,
    differencing.masked
      ? h(
          'p',
          { class: 'hint' },
          h('i', { class: 'diff-hatch', 'aria-hidden': 'true' }),
          copy.show.diffMasked,
        )
      : null,
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
function legend(): HTMLElement {
  const d = h(
    'details',
    { class: 'legend', open: legendOpen },
    h('summary', {}, copy.legend.title),
    h('ul', {}, ...copy.legend.layers.map((l) => h('li', {}, l))),
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
      return spectrum ? [tourCard(), spectrum] : [tourCard()];
    }
  }
  return showWords();
}

/** The landing's three things to do, as chips: a mark, a verb, and a few words under it. */
function verbChips(): HTMLElement {
  const v = copy.sky.verbs;
  const chip = (icon: string, verb: string, sub: string) =>
    h(
      'li',
      {},
      h('span', { class: `verb-icon ${icon}`, 'aria-hidden': 'true' }),
      h('span', {}, h('b', {}, verb), h('small', {}, sub)),
    );
  return h(
    'ul',
    { class: 'verbs' },
    chip('pick', v.pick, v.pickSub),
    chip('anywhere', touchOnly ? v.anywhereTouch : v.anywhere, v.anywhereSub),
    movedSky ? null : chip('move', touchOnly ? v.moveTouch : v.move, v.moveSub),
  );
}

/** Takes the visitor to a famous fast star or variable, for a live look. */
function surpriseButton(): HTMLElement {
  const b = h('button', { type: 'button', class: 'surprise' }, copy.surprise.button);
  b.addEventListener('click', () => void surpriseMe());
  return h('div', { class: 'actions' }, b);
}

function showWords(): Node[] {
  const place = state.place;
  if (place.kind === 'sky' && state.room === 'watch') {
    // Watch needs a target: say so, and offer the five, rather than look like Play.
    const pick = h('div', { class: 'actions watch-pick' });
    for (const w of WANDERERS.filter((x) => x.ready)) {
      const b = h('button', { type: 'button' }, copy.wanderers[w.id].name);
      b.addEventListener('click', () => void go(w.id));
      pick.append(b);
    }
    return [h('h2', {}, copy.watch.pickHeading), h('p', {}, copy.watch.pickHint), pick, legend()];
  }
  if (place.kind === 'sky') {
    const parts: (HTMLElement | null)[] = [
      h('h2', {}, copy.sky.invitation),
      verbChips(),
      surpriseButton(),
      searchNote ? h('p', { class: 'hint' }, searchNote) : null,
      sweepControl(),
      legend(),
    ];
    return parts.filter((x): x is HTMLElement => x !== null);
  }
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
  const diff = h(
    'button',
    {
      type: 'button',
      'aria-pressed': String(!!differencing),
      'aria-busy': String(diffBusy),
      disabled: diffBusy,
      class: 'diff-toggle',
    },
    copy.show.diffButton,
  );
  diff.addEventListener('click', () => (differencing ? endDifference() : void showDifference()));
  actions.append(diff, replay);
  out.push(actions);
  // Only while the pack is still arriving; during the reveal, holding simply ends it.
  if (canHold && !ready && place.kind !== 'reveal')
    out.push(h('p', { class: 'hint' }, copy.show.holdNotYet));
  const key = differenceKey();
  if (key) out.push(key);
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
      render();
    });
    summary.splice(1, 0, h('p', { class: 'typed-note', role: 'status' }, typedNote.text, close));
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
  compare.push(
    h('h3', {}, copy.facts.looks),
    pairChooser(id),
    looksRow(),
    spotRow,
    h(
      'div',
      { class: 'actions links' },
      copyLinkButton(),
      aladinLink(current.pack.manifest.grid.centre),
      keysBtn,
    ),
    h(
      'p',
      { class: 'release-line' },
      copy.show.release(
        current.pack.manifest.release,
        framesReleases(current.pack.manifest.frames.map((f) => f.mjd)),
      ),
    ),
  );
  const facts: (Node | null)[] = [...factsTop, h('dl', { class: 'facts' }, ...rows)];
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
    facts.push(h('details', { class: 'why' }, h('summary', {}, copy.show.why), h('p', {}, story)));
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
    const p = live?.probe;
    out.push(h('h2', {}, copy.look.finding));
    if (p)
      out.push(
        h('p', { class: 'hint probing', role: 'status' }, copy.look.probing(p.done, p.total, p.of)),
      );
    return out.filter((x): x is HTMLElement => x !== null);
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
          'seasons' in plan ? ` · ${copy.look.passes(plan.seasons)}` : '',
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
      replay.addEventListener('click', flipLook);
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
          h('h3', {}, copy.look.shownHeading(look.tiles.length, plan.total)),
          strip,
          h('div', { class: 'actions' }, replay, copyLinkButton(), aladinLink(look.at)),
          liveMoversLine(look),
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
            ...factRow('look', copy.facts.move, copy.facts.dash.look),
            ...factRow('unmeasured', copy.facts.predicted, copy.facts.dash.none),
            ...factRow('unmeasured', copy.facts.steady, copy.facts.dash.none),
            ...factRow('unmeasured', copy.facts.brightness, copy.facts.dash.none),
            ...factRow('unmeasured', copy.facts.spectrum, copy.facts.dash.none),
            ...factRow('flag', copy.facts.flags, flagsControl(look.tiles)),
            ...factRow('catalogue', copy.facts.catalogue, copy.facts.dash.noCatalogue),
          ),
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
};
type OverlayFile = {
  gaia_dr3?: OverlaySource[];
  catwise2020?: OverlaySource[];
  season_mean_mjd?: Record<string, number>;
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

/* ---------- Learn: a one-minute guided tour of the sky and the five ---------- */

let tourStep = 0;
/** What each step shows: the sky, a flight to the runaway, the shows, then the sky again. */
const TOUR_ACTS: (() => void)[] = [
  // "The whole sky": the flat all-sky map, wherever the visitor was.
  () => {
    if (state.place.kind !== 'sky') leaveShow();
    goEntry('flat');
  },
  // Back inside, turning toward the runaway.
  () => {
    if (state.place.kind !== 'sky') leaveShow();
    void (async () => {
      if (state.entry !== 'inside') await goEntry('inside');
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

function runTourStep(i: number): void {
  tourStep = Math.max(0, Math.min(TOUR_ACTS.length - 1, i));
  try {
    TOUR_ACTS[tourStep]?.();
  } finally {
    // Leaving a show resets the room to Play; the tour keeps it on Learn, whatever the step did.
    if (state.room !== 'learn') dispatch({ type: 'setRoom', room: 'learn' });
    render();
  }
}

function endTour(): void {
  dispatch({ type: 'setRoom', room: 'play' });
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
    h('p', { class: 'tour-line' }, steps[tourStep] ?? ''),
    h('div', { class: 'actions' }, back, next, skip),
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
  signal?: AbortSignal,
): Promise<MoverMark[][] | 'failed'> {
  const { byMjd, failed } = await knownMoversAt(
    centre,
    mjds,
    fieldRadiusDeg(size, scaleArcsec),
    signal,
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
    parts.push(
      spectrumFigure(d.exposures, { x: copy.spectrum.x, y: copy.spectrum.y }),
      h('p', { class: 'hint' }, copy.spectrum.caption),
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
  return h(
    'a',
    { class: 'quiet-link', href: url, target: '_blank', rel: 'noopener' },
    copy.share.aladin,
  );
}

/** "RA 17h 57m 48s, Dec +4° 41′" for the eyebrow. */
function formatPosition(place: typeof state.place): string {
  if (!('at' in place) || !place.at) return '';
  const { ra, dec } = place.at;
  const h_ = ra / 15;
  const hh = Math.floor(h_);
  const mm = Math.floor((h_ - hh) * 60);
  const ss = Math.round(((h_ - hh) * 60 - mm) * 60);
  const sign = dec < 0 ? '−' : '+';
  const d = Math.abs(dec);
  const dd = Math.floor(d);
  const dm = Math.round((d - dd) * 60);
  return `RA ${hh}h ${mm}m ${ss}s, Dec ${sign}${dd}° ${dm}′`;
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
}

function drawBand(): void {
  const place = state.place;
  const dock = (middle: HTMLElement | null, key: HTMLElement) =>
    middle ? h('div', { class: 'dock-row' }, middle, key) : key;
  if (place.kind === 'sky') {
    band.replaceChildren(dock(weeksFigure(), markKey('sky')), caseRail());
    return;
  }
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
    band.replaceChildren(dock(dots, markKey('look')), caseRail());
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
}

function stopSweep(): void {
  if (sweep.timer) window.clearInterval(sweep.timer);
  sweep.timer = 0;
  sweepPlay.textContent = copy.sky.sweep.play;
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

function sweepControl(): HTMLElement | null {
  const c = sweep.coverage;
  if (!c) return null;
  const toggle = h(
    'button',
    { type: 'button', class: 'sweep-toggle', 'aria-expanded': String(sweep.open) },
    sweep.open ? copy.sky.sweep.close : copy.sky.sweep.open,
  );
  toggle.addEventListener('click', toggleSweep);
  if (!sweep.open) return h('section', { class: 'sweep' }, toggle);
  const placeholder =
    c.meta.status === 'MEASURED'
      ? null
      : h('p', { class: 'hint placeholder' }, copy.sky.sweep.placeholder);
  return h(
    'section',
    { class: 'sweep open' },
    toggle,
    placeholder,
    sweepLabel,
    sweepFrames,
    h('div', { class: 'sweep-row' }, sweepPlay, sweepSlider),
    // A two-swatch key instead of a sentence (the sentence stays for screen readers).
    h(
      'p',
      { class: 'sweep-key', 'aria-label': copy.sky.sweep.soFar },
      h('i', { class: 'sofar', 'aria-hidden': 'true' }),
      h('span', { 'aria-hidden': 'true' }, copy.sky.sweep.keySoFar),
      h('i', { class: 'week', 'aria-hidden': 'true' }),
      h('span', { 'aria-hidden': 'true' }, copy.sky.sweep.keyWeek),
    ),
    h('p', { class: 'hint' }, touchOnly ? copy.sky.sweep.hintTouch : copy.sky.sweep.hint),
    c.meta.caption && c.meta.status === 'MEASURED'
      ? h(
          'details',
          { class: 'why' },
          h('summary', {}, copy.sky.sweep.why),
          h('p', { class: 'hint' }, c.meta.caption),
        )
      : null,
  );
}

function render(): void {
  markRide();
  sky.marks = state.place.kind === 'sky';
  app.dataset['place'] = state.place.kind;
  // On the sky, the header, the words and the band sit on the night in either scheme.
  for (const el of [header, stage, band]) el.classList.toggle('on-sky', state.place.kind === 'sky');
  app.dataset['room'] = state.room;
  app.dataset['entry'] = state.entry;
  app.dataset['show'] = current?.show.kind ?? 'none';
  for (const b of dial.querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(b.dataset['room'] === state.room));
  markEntry();
  const inShow = state.place.kind !== 'sky';
  homeLink.setAttribute('aria-label', inShow ? copy.nav.backToSky : copy.nav.home);
  homeLink.title = inShow ? copy.nav.backToSky : copy.nav.home;
  const tabHadFocus = !!(document.activeElement as HTMLElement | null)?.closest?.('.panel-tabs');
  words.replaceChildren(...renderWords());
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
  }
  history.replaceState(null, '', `?${q}`);
}

const q = new URLSearchParams(location.search);
const wantedEntry = q.get('entry');
// ?entry=globe (old links) now means stepping out to Earth and the orbit from Look around.
const entry = wantedEntry === 'flat' ? 'flat' : 'inside';
dispatch({ type: 'setEntry', entry });
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
  void (spot ? loadSurprises() : Promise.resolve([])).then((list) =>
    openLook(
      wantedAt,
      // The name only if the link's position really is that star (within 5″).
      list.find(
        (x) =>
          slug(x.name) === spot && separationDeg(wantedAt, { ra: x.ra, dec: x.dec }) * 3600 < 5,
      ) ?? null,
    ),
  );
}
