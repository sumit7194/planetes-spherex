import './styles.css';
import { type Context, CUBE_UM, BLANK_FRAMES, openContext } from './aladin';
import { fmtDec, fmtRa, parseSky, project, propagate, resolveName, sepArcsec, type Sky } from './coords';
import {
  type Cell,
  type Exposure,
  type Pack,
  DETECTORS,
  cellImage,
  cellOf,
  cellSat,
  fmtDate,
  frameImage,
  loadFrames,
  loadPack,
  mjdToYear,
  passLabel,
  sharedDetectors,
} from './pack';
import { View, blit, cross, cssVar, diffImage, diffLegendGradient, drawSaturation, drawScale, greyImage, ring } from './render';
import { spectrumSvg } from './spectrum';
import { type Stretch, sharedStretch } from './stretch';

/* ------------------------------------------------------------------ state */

type Mode = 'blink' | 'diff' | 'stack' | 'photos';
interface UI {
  mode: Mode;
  det: number; // 0 = all colours together
  pass: number; // current pass (blink)
  photo: number; // index into the photo list (photos mode)
  a: number; // difference: from pass
  b: number; // difference: to pass
  fov: number; // crop size in pixels
  playing: boolean;
  speed: number; // ms per frame
  bright: number; // 0..100
  contrast: number; // 0..100
  invert: boolean;
  showCat: boolean;
  showSat: boolean;
  showTrack: boolean;
  specFlagged: boolean;
  hidden: Set<number>;
}

interface TargetInfo {
  slug: string;
  name: string;
  kind: string;
  ra: number;
  dec: number;
  det?: number; // default colour range: where the target itself is clearest
  motionDets?: number[] | null; // colour ranges where the target outshines its neighbours
}

const infoOf = (p: Pack) => index.find((x) => x.slug === p.slug);

const PACK_ROOT = './packs';
const SERVICE = (import.meta.env.VITE_SERVICE_URL as string | undefined) ?? '';
const app = document.getElementById('app')!;
let index: TargetInfo[] = [];
let timer: number | undefined;
let ctxView: Context | null = null;

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/* ------------------------------------------------------------------ routing */

async function route() {
  stop();
  const q = new URLSearchParams(location.search);
  if (!index.length) {
    try {
      index = (await (await fetch(`${PACK_ROOT}/index.json`)).json()).targets;
    } catch {
      index = [];
    }
  }
  const t = q.get('t');
  const ra = parseFloat(q.get('ra') ?? '');
  const dec = parseFloat(q.get('dec') ?? '');
  if (t && index.some((x) => x.slug === t)) return showPack(`${PACK_ROOT}/${t}`, q);
  if (Number.isFinite(ra) && Number.isFinite(dec)) {
    // A position within 2 arcminutes of one of the five opens its prepared pack.
    const near = index.find((x) => sepArcsec({ ra, dec }, x) < 120);
    if (near) return showPack(`${PACK_ROOT}/${near.slug}`, q);
    return showLook({ ra, dec }, q);
  }
  return showHome();
}

function go(params: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  history.pushState(null, '', `?${q}`);
  route();
}

window.addEventListener('popstate', route);

document.getElementById('search')!.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('q') as HTMLInputElement;
  const s = input.value.trim();
  if (!s) return;
  const sky = parseSky(s);
  if (sky) return go({ ra: sky.ra.toFixed(6), dec: sky.dec.toFixed(6) });
  const known = index.find((x) => norm(x.name).includes(norm(s)) || norm(x.slug) === norm(s));
  if (known) return go({ t: known.slug });
  input.disabled = true;
  const prev = input.placeholder;
  input.value = '';
  input.placeholder = `Looking up “${s}” at CDS Sesame…`;
  const r = await resolveName(s);
  input.disabled = false;
  input.placeholder = prev;
  if (r) go({ ra: r.ra.toFixed(6), dec: r.dec.toFixed(6) });
  else {
    input.value = s;
    input.setCustomValidity('Not found. Try RA and Dec, e.g. 133.7600 −7.2426');
    input.reportValidity();
    setTimeout(() => input.setCustomValidity(''), 3000);
  }
});
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const schemeEl = document.getElementById('scheme')!;
function applyScheme(pick: string) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.ui = pick === 'light' || pick === 'dark' ? pick : dark ? 'dark' : 'light';
  schemeEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === pick)));
}
let schemePick = 'auto';
try {
  schemePick = localStorage.getItem('planetes-scheme') || 'auto';
} catch {
  /* private mode */
}
applyScheme(schemePick);
schemeEl.addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button');
  if (!b) return;
  schemePick = b.dataset.s!;
  try {
    localStorage.setItem('planetes-scheme', schemePick);
  } catch {
    /* private mode */
  }
  applyScheme(schemePick);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyScheme(schemePick));

/* ------------------------------------------------------------------ home */

async function showHome() {
  document.title = "Planetes · watch SPHEREx's sky change";
  app.innerHTML = '';
  const hero = h(`
    <section class="hero">
      <div>
        <h1>SPHEREx photographed the whole sky, again and again.</h1>
        <p class="lede">NASA's SPHEREx maps the entire sky every six months, in 102 colours of infrared light.
        Give Planetes a position and it plays SPHEREx's photos of that spot, pass after pass, so whatever moved
        or changed stands out: nearby stars, cold brown dwarfs, stars that brighten and fade.</p>
        <div class="row-btns" style="margin-top:22px">
          <a class="btn primary" href="?t=barnard">Start with Barnard's Star</a>
          <a class="btn" href="?ra=133.7600&amp;dec=-7.2426">Type a position: WISE 0855</a>
        </div>
        <div class="howto panel" style="margin-top:26px">
          <b style="color:var(--starlight);font-weight:600">How to look</b>
          <ol>
            <li>Each frame stacks every SPHEREx photo of the spot from one six-month pass, in one detector's colour range.</li>
            <li>Watch the ring. It holds still; a nearby star walks out of it. SPHEREx pixels are 6.2″, so a move of one or two pixels is a real discovery-sized change.</li>
            <li>Switch to <i>Difference</i>: a moving star becomes a dark-and-bright pair; a star that changed brightness becomes a ring.</li>
          </ol>
        </div>
      </div>
      <div class="lens-wrap">
        <div class="hud"><div><div class="big" id="h1"></div><div class="sub" id="h2"></div></div></div>
        <div class="stage on-sky"><canvas class="main" width="560" height="560" aria-label="Barnard's Star in SPHEREx, blinking between passes"></canvas></div>
      </div>
    </section>`);
  app.append(hero);
  app.append(band(null));
  // A live lens on the landing: Barnard's Star blinking between its first and last pass.
  try {
    const p = await loadPack(`${PACK_ROOT}/barnard`);
    const cv = hero.querySelector('canvas') as HTMLCanvasElement;
    const passes = p.passes.filter((ps) => cellOf(p, ps.i, 6));
    const pair = [passes[0], passes[passes.length - 1]];
    const n = p.grid.n;
    const m = n / 4;
    const imgs = pair.map((ps) => cellImage(p, cellOf(p, ps.i, 6)!, 'display'));
    const x0 = (n - m) / 2;
    const crop = (im: Float32Array) => {
      const out = new Float32Array(m * m);
      for (let y = 0; y < m; y++) out.set(im.subarray((x0 + y) * n + x0, (x0 + y) * n + x0 + m), y * m);
      return out;
    };
    const s = sharedStretch(imgs.map(crop), { floorP: 0.05, ceilingP: 0.999 });
    const ctx = cv.getContext('2d')!;
    const v = new View(n, m, cv.width);
    const c0 = project(p.grid.crval[0], p.grid.crval[1], n, p.grid.pixArcsec, p.target.ra, p.target.dec);
    let k = 0;
    const frame = () => {
      if (!document.body.contains(cv)) return stop();
      blit(ctx, greyImage(imgs[k], n, s), v);
      ring(ctx, v.X(c0.x), v.Y(c0.y), v.S * 2.2, 'rgba(239,232,221,0.6)', [], 2);
      drawScale(ctx, v, p.grid.pixArcsec, cv.width / cv.getBoundingClientRect().width || 1);
      (hero.querySelector('#h1') as HTMLElement).textContent = `Barnard's Star · ${passLabel(pair[k])}`;
      (hero.querySelector('#h2') as HTMLElement).textContent = `SPHEREx, 4.4–5.0 µm · watch the ring`;
      k = 1 - k;
    };
    frame();
    stop();
    timer = window.setInterval(frame, 900);
  } catch {
    /* the pack isn't built yet */
  }
}

/** Meet the five: round chips with a thumbnail of each target's latest pass. */
function band(current: string | null): HTMLElement {
  const el = h(`<nav class="band" aria-label="The five challenge targets"><span class="band-label">Meet the five</span><ul class="rail"></ul></nav>`);
  const rail = el.querySelector('.rail')!;
  for (const t of index) {
    const li = h(`<li><a class="card" href="?t=${t.slug}" ${t.slug === current ? 'aria-current="page"' : ''}><canvas width="16" height="16"></canvas><span class="card-text"><strong>${esc(t.name)}</strong><span>${t.kind === 'mover' ? 'moves' : 'changes in brightness'}</span></span></a></li>`);
    rail.append(li);
    loadPack(`${PACK_ROOT}/${t.slug}`)
      .then((p) => {
        const det = bestDet(p);
        const c = cellOf(p, p.passes[p.passes.length - 1].i, det) ?? p.cells.find((x) => x.det === det);
        if (!c) return;
        const n = p.grid.n;
        const m = n / 4;
        const x0 = (n - m) / 2;
        const im = cellImage(p, c, 'display');
        const crop = new Float32Array(m * m);
        for (let y = 0; y < m; y++) crop.set(im.subarray((x0 + y) * n + x0, (x0 + y) * n + x0 + m), y * m);
        const cv = li.querySelector('canvas')!;
        cv.width = m;
        cv.height = m;
        cv.getContext('2d')!.putImageData(greyImage(crop, m, sharedStretch([crop], { floorP: 0.05, ceilingP: 0.999 })), 0, 0);
      })
      .catch(() => li.querySelector('.card-text span:last-child')!.replaceChildren('being built'));
  }
  return el;
}

/** The detector where the target is clearest: highest median S/N of clean photometry. */
function bestDet(p: Pack): number {
  const pref = infoOf(p)?.det;
  if (pref && p.cells.some((c) => c.det === pref)) return pref;
  let best = 6;
  let bestSn = -Infinity;
  for (const d of DETECTORS) {
    const sn = p.exposures.filter((e) => e.det === d.det && e.phot && !e.phot.flagged).map((e) => e.phot!.flux / Math.max(1e-6, e.phot!.err));
    if (sn.length < 3) continue;
    sn.sort((a, b) => a - b);
    const m = sn[sn.length >> 1];
    if (m > bestSn) {
      bestSn = m;
      best = d.det;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ a look at a spot without a pack */

async function showLook(sky: Sky, q: URLSearchParams) {
  document.title = `Planetes · ${fmtRa(sky.ra)} ${fmtDec(sky.dec)}`;
  app.innerHTML = '';
  const page = h(`
    <section class="view">
      <div>
        <div class="stage on-sky"><div id="aladin-box" style="height:auto;aspect-ratio:1"></div></div>
        <div class="aladin-bar"><span class="label">Colour</span><input type="range" min="0" max="101" value="96" id="lam"><span id="lamv" class="ctl"></span></div>
      </div>
      <div class="side">
        <div class="status"><i style="background:var(--look)"></i>A look</div>
        <h1>${fmtRa(sky.ra)}<br>${fmtDec(sky.dec)}</h1>
        <p class="blurb">This is SPHEREx's first all-sky map at this spot (data release 1, all of its photos combined, one frame per colour).
        Drag the colour slider to see the sky from 0.75 to 5 micrometres.</p>
        <div id="live"></div>
        <div class="row-btns"><button class="btn small" id="copy">Copy link</button>
        <a class="btn small" target="_blank" rel="noopener" href="https://irsa.ipac.caltech.edu/applications/spherex/?__action=layout.showDropDown&view=MultiTableSearchCmd">SPHEREx data at IRSA</a></div>
      </div>
    </section>`);
  app.append(page);
  const live = page.querySelector('#live')!;
  if (SERVICE) {
    live.append(h(`<div class="panel" style="margin-top:0"><h2>Watch it change</h2><p class="hint">Stacking every SPHEREx photo of this spot by pass takes about a minute: the photos are read straight from NASA's archive.</p><button class="btn primary" id="build">Build the time series</button><p class="hint" id="bstat"></p></div>`));
    live.querySelector('#build')!.addEventListener('click', () => buildLive(sky, live.querySelector('#bstat')!));
  } else {
    live.append(
      h(`<div class="panel" style="margin-top:0"><h2>Watch it change</h2><p class="hint">Time series for any spot need the Planetes pack builder (a small Python program that reads SPHEREx's photos from NASA's public archive). The online demo has the five challenge targets ready; to build this spot yourself:</p><pre style="white-space:pre-wrap;font-size:13px;margin:0">cd pipeline && uv run python build_pack.py --ra ${sky.ra.toFixed(5)} --dec ${sky.dec.toFixed(5)}</pre></div>`),
    );
  }
  page.querySelector('#copy')!.addEventListener('click', copyLink);
  await mountContext(page.querySelector('#aladin-box') as HTMLElement, sky, 0.25, page.querySelector('#lam') as HTMLInputElement, page.querySelector('#lamv') as HTMLElement);
  void q;
}

async function buildLive(sky: Sky, stat: Element) {
  stat.textContent = 'Searching SPHEREx at IRSA and reading photos…';
  try {
    const r = await fetch(`${SERVICE}/pack?ra=${sky.ra}&dec=${sky.dec}`);
    if (!r.ok) throw new Error(`${r.status}`);
    const { base } = (await r.json()) as { base: string };
    await showPack(base.startsWith('http') ? base : `${SERVICE}${base}`, new URLSearchParams(location.search));
  } catch (e) {
    stat.textContent = `The pack service did not answer (${(e as Error).message}). The five prepared targets still work.`;
  }
}

async function mountContext(el: HTMLElement, sky: Sky, fov: number, slider: HTMLInputElement, label: HTMLElement) {
  const show = () => {
    const i = +slider.value;
    label.textContent = `${CUBE_UM[i].toFixed(2)} µm${BLANK_FRAMES.has(i) ? ' (blank: dichroic)' : ''}`;
  };
  show();
  try {
    ctxView = await openContext(el, sky.ra, sky.dec, fov);
    ctxView.setFrame(+slider.value);
    slider.addEventListener('input', () => {
      show();
      ctxView?.setFrame(+slider.value);
    });
  } catch (e) {
    el.innerHTML = `<p class="empty">The sky map (Aladin Lite) could not load: ${esc((e as Error).message)}</p>`;
  }
  return ctxView;
}

/* ------------------------------------------------------------------ a pack: the main view */

async function showPack(base: string, q: URLSearchParams) {
  app.innerHTML = '<p class="loading">Loading SPHEREx photos…</p>';
  let p: Pack;
  try {
    p = await loadPack(base);
  } catch (e) {
    app.innerHTML = `<p class="empty">Could not load this pack: ${esc((e as Error).message)}</p>`;
    return;
  }
  document.title = `Planetes · ${p.name}`;
  const n = p.grid.n;
  const shared = sharedDetectors(p);
  const passes = p.passes.filter((ps) => p.cells.some((c) => c.pass === ps.i));
  const first = passes[0].i;
  const last = passes[passes.length - 1].i;
  const ui: UI = {
    mode: (q.get('mode') as Mode) || 'blink',
    det: q.has('det') ? +q.get('det')! : bestDet(p),
    pass: first,
    photo: 0,
    a: q.has('a') ? +q.get('a')! - 1 : first,
    b: q.has('b') ? +q.get('b')! - 1 : last,
    fov: q.has('fov') ? +q.get('fov')! : p.kind === 'mover' ? n / 4 : p.kind === 'look' ? n : n / 2,
    playing: true,
    speed: 700,
    bright: 50,
    contrast: 50,
    invert: false,
    showCat: false,
    showSat: true,
    showTrack: true,
    specFlagged: false,
    hidden: new Set(),
  };
  if (!['blink', 'diff', 'stack', 'photos'].includes(ui.mode)) ui.mode = 'blink';
  if (ui.det !== 0 && !DETECTORS.some((d) => d.det === ui.det)) ui.det = bestDet(p);

  const motion = measureMotion(p);
  const bright = brightnessChange(p);
  const blends = blendWarnings(p);
  const t = p.target;

  app.innerHTML = '';
  const page = h(`
  <div>
    <section class="view">
      <div>
        <div class="lens-wrap">
          <div class="hud"><div><div class="big" id="hud1"></div><div class="sub" id="hud2"></div></div><div class="warnline" id="hud3"></div></div>
          <div class="stage on-sky"><canvas class="main" width="720" height="720" aria-label="SPHEREx photos of ${esc(p.name)}"></canvas></div>
          <div class="probe" id="probe" hidden></div>
        </div>
        <div class="controls">
          <div class="seg glass" role="group" aria-label="View" id="modes">
            <button data-m="blink" title="Play one stacked frame per pass">Blink</button>
            <button data-m="diff" title="Subtract one pass from another">Difference</button>
            <button data-m="stack" title="Add every pass together: deeper, but motion blurs">Stack</button>
            <button data-m="photos" title="Every single photo in time order">Every photo</button>
          </div>
          <button class="btn small" id="play"></button>
          <label class="ctl"><span class="label">Speed</span><input type="range" min="150" max="2000" step="50" id="speed"></label>
        </div>
        <div class="controls">
          <div class="seg glass" role="group" aria-label="Colour (detector)" id="dets">
            <button data-d="0" title="All shared detectors, weighted by noise">All</button>
            ${DETECTORS.map((d) => `<button data-d="${d.det}" title="Detector ${d.det}: ${d.lo}–${d.hi} µm">${d.lo}–${d.hi} µm</button>`).join('')}
          </div>
        </div>
        <div class="controls">
          <div class="seg glass" role="group" aria-label="Field of view" id="fovs">
            ${[n, n / 2, n / 4].map((m) => `<button data-f="${m}">${((m * p.grid.pixArcsec) / 60).toFixed(1)}′</button>`).join('')}
          </div>
          <label class="ctl"><span class="label">Brightness</span><input type="range" min="0" max="100" id="bright"></label>
          <label class="ctl"><span class="label">Contrast</span><input type="range" min="0" max="100" id="contrast"></label>
          <label class="ctl"><input type="checkbox" id="invert"> Invert</label>
        </div>
        <div class="controls">
          <span class="label">Show</span>
          <label class="ctl"><input type="checkbox" id="track"> <span class="mk predicted"></span>predicted path</label>
          <label class="ctl"><input type="checkbox" id="cat"> catalogue stars (Gaia ○, CatWISE □)</label>
          <label class="ctl"><input type="checkbox" id="sat"> <span class="mk flag"></span>saturated pixels</label>
        </div>
        <div class="timeline" id="timeline"></div>
        <div id="difflegend" class="controls" hidden></div>
        <div class="panel" style="margin-top:16px">
          <div class="kind" style="margin-bottom:8px" id="detsTitle">This pass in all six colour ranges</div>
          <div class="dets" id="detgrid"></div>
        </div>
      </div>
      <aside class="side">
        <div class="eyebrow" id="status"></div>
        <h1>${esc(p.name)}</h1>
        <p class="lead" id="lead"></p>
        <p class="blurb">${esc(p.blurb || 'A look at this spot: real SPHEREx photos, by pass and by colour.')}</p>
        <div class="row-btns">
          <button class="btn small" id="copy">Copy link</button>
          <button class="btn small" id="embed">Embed</button>
          <a class="btn small quiet" href="#spectrum">Spectrum ↓</a>
          <a class="btn small quiet" href="#context">Sky map ↓</a>
        </div>
        <dl class="facts" id="facts"></dl>
      </aside>
    </section>
    <section class="panel spectrum" id="spectrum">
      <h2>Its spectrum, on the fly</h2>
      <p class="hint">SPHEREx's filter changes colour across each detector, so every photo sees the target at its own wavelength.
      One quick brightness measurement per photo (light within ${p.photometry.radiusPx} pixels, minus the local sky), plotted against that photo's wavelength, traces the spectrum.
      Colours are passes: where they disagree, the target changed.</p>
      <div id="specWarn"></div>
      <div id="specChart"></div>
      <div class="legend" id="specLegend"></div>
    </section>
    <section class="panel" id="context">
      <h2>The sky around it, in 102 colours</h2>
      <p class="hint">SPHEREx's first all-sky map (IRSA's DR1 HiPS cube, every photo combined, so it shows colour, not change). The blue square is the area above. Drag the slider through the colours; brown dwarfs appear only at the longest wavelengths.</p>
      <div id="aladin-box"></div>
      <div class="aladin-bar"><span class="label">Colour</span><input type="range" min="0" max="101" value="96" id="lam"><span id="lamv" class="ctl"></span></div>
    </section>
  </div>`);
  app.append(page);
  app.append(band(p.slug));

  const canvas = page.querySelector('canvas.main') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const $ = <T extends HTMLElement>(s: string) => page.querySelector(s) as T;
  const photosOf = (det: number) => p.exposures.filter((e) => e.det === det).sort((a, b) => a.mjd - b.mjd);

  // Sigma per detector: the typical noise of a one-pass stack (median over passes).
  const sigmaOf = (det: number) => {
    const s = p.cells.filter((c) => c.det === det && c.stats.sigma).map((c) => c.stats.sigma!);
    s.sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 1;
  };

  /** One pass's image for the chosen colour: a detector's stack, or all shared detectors in units of their noise. */
  function passImage(pass: number, policy: 'display' | 'strict'): Float32Array | null {
    if (ui.det !== 0) {
      const c = cellOf(p, pass, ui.det);
      return c ? cellImage(p, c, policy) : null;
    }
    const out = new Float32Array(n * n);
    let k = 0;
    for (const d of shared) {
      const c = cellOf(p, pass, d);
      if (!c) continue;
      const im = cellImage(p, c, policy);
      const s = sigmaOf(d);
      for (let i = 0; i < out.length; i++) out[i] += im[i] / s;
      k++;
    }
    if (!k) return null;
    for (let i = 0; i < out.length; i++) out[i] /= Math.sqrt(k);
    return out;
  }

  function stackImage(): Float32Array | null {
    const ims = passes.map((ps) => passImage(ps.i, 'display')).filter((x): x is Float32Array => !!x);
    if (!ims.length) return null;
    const out = new Float32Array(n * n);
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      let k = 0;
      for (const im of ims) if (Number.isFinite(im[i])) (s += im[i]), k++;
      out[i] = k ? s / k : NaN;
    }
    return out;
  }

  /** One shared stretch for everything being compared (never per frame: that would hide real changes). */
  let stretchCache = { key: '', s: null as Stretch | null };
  function stretch(): Stretch {
    const key = `${ui.det}|${ui.mode}|${ui.fov}`;
    if (stretchCache.key !== key) {
      const ims =
        ui.mode === 'photos' && p.frames
          ? photosOf(ui.det || bestDet(p)).slice(0, 60).map((e) => frameImage(p, e))
          : passes.map((ps) => passImage(ps.i, 'display')).filter((x): x is Float32Array => !!x);
      // Only the pixels on screen set the stretch, so a bright star outside the view can't wash it out.
      const x0 = (n - ui.fov) / 2;
      const crop = (im: Float32Array) => {
        const out = new Float32Array(ui.fov * ui.fov);
        for (let y = 0; y < ui.fov; y++) out.set(im.subarray((x0 + y) * n + x0, (x0 + y) * n + x0 + ui.fov), y * ui.fov);
        return out;
      };
      stretchCache = { key, s: sharedStretch(ims.map(crop), { floorP: 0.05, ceilingP: 0.999 }) };
    }
    const base = stretchCache.s!;
    const span = base.ceiling - base.floor;
    const ceiling = base.floor + span * 10 ** ((50 - ui.bright) / 30);
    const soft = base.soft * 10 ** ((ui.contrast - 50) / 25);
    return { floor: base.floor, ceiling, soft };
  }

  const dpr = () => canvas.width / canvas.getBoundingClientRect().width || 1;

  function draw() {
    const v = new View(n, ui.fov, canvas.width);
    ctx.fillStyle = '#0c1120';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let hud1 = '';
    let hud2 = '';
    let hud3 = '';
    let year = mjdToYear((passes[0].mjdMin + passes[passes.length - 1].mjdMax) / 2);
    let curPass: number | null = null;
    let satCell: Cell | undefined;
    const colourName = ui.det ? `${DETECTORS[ui.det - 1].lo}–${DETECTORS[ui.det - 1].hi} µm (detector ${ui.det})` : `all colours (${shared.length} detectors)`;
    if (ui.mode === 'blink') {
      const im = passImage(ui.pass, 'display');
      const ps = passes.find((x) => x.i === ui.pass)!;
      curPass = ui.pass;
      if (im) blit(ctx, greyImage(im, n, stretch(), ui.invert), v);
      const c = ui.det ? cellOf(p, ui.pass, ui.det) : undefined;
      satCell = c;
      year = mjdToYear((ps.mjdMin + ps.mjdMax) / 2);
      hud1 = `Pass ${passes.indexOf(ps) + 1} of ${passes.length} · ${passLabel(ps)}`;
      hud2 = `${colourName} · ${c ? `stack of ${c.n} photos` : `${ps.used} photos`} · ${ps.releases.join('+')}`;
      hud3 = im ? '' : 'No photos in this colour on this pass';
    } else if (ui.mode === 'diff') {
      const A = passImage(ui.a, 'strict');
      const B = passImage(ui.b, 'strict');
      const pa = passes.find((x) => x.i === ui.a)!;
      const pb = passes.find((x) => x.i === ui.b)!;
      if (A && B) {
        const sig = ui.det ? Math.hypot(cellOf(p, ui.a, ui.det)?.stats.sigma ?? 1, cellOf(p, ui.b, ui.det)?.stats.sigma ?? 1) : Math.SQRT2;
        blit(ctx, diffImage(A, B, sig, n, 5), v);
      }
      hud1 = `Pass ${passes.indexOf(pb) + 1} minus pass ${passes.indexOf(pa) + 1}`;
      hud2 = `${passLabel(pb)} − ${passLabel(pa)} · ${colourName} · scale ±5σ`;
      hud3 = A && B ? '' : 'This colour is missing on one of the passes';
      year = mjdToYear((pa.mjdMin + pb.mjdMax) / 2);
    } else if (ui.mode === 'stack') {
      const im = stackImage();
      if (im) blit(ctx, greyImage(im, n, stretch(), ui.invert), v);
      hud1 = `All ${passes.length} passes added together`;
      hud2 = `${colourName} · deeper, but anything that moved is smeared`;
    } else {
      const list = photosOf(ui.det || bestDet(p));
      const e = list[ui.photo % Math.max(1, list.length)];
      if (e && p.frames) {
        blit(ctx, greyImage(frameImage(p, e), n, stretch(), ui.invert), v);
        curPass = e.pass;
        year = mjdToYear(e.mjd);
        hud1 = `Photo ${(ui.photo % list.length) + 1} of ${list.length} · ${fmtDate(e.mjd)}`;
        hud2 = `${e.lam.toFixed(3)} µm at the target · ${e.release} · ${e.obsId}`;
        hud3 = 'Each photo sees a slightly different colour, so brightness flickers even when nothing changed';
      } else hud1 = 'Loading every photo…';
    }

    // Overlays (in device pixels).
    const d = dpr();
    const theme = { measured: cssVar('--sky-show'), predicted: cssVar('--sky-predicted'), flag: cssVar('--sky-flag'), look: cssVar('--sky-look') };
    if (ui.showSat && satCell) drawSaturation(ctx, cellSat(p, satCell), n, v, theme.flag);
    if (ui.showCat) {
      for (const s of p.catalog) {
        const pos = propagate(s, year);
        const g = project(p.grid.crval[0], p.grid.crval[1], n, p.grid.pixArcsec, pos.ra, pos.dec);
        const X = v.X(g.x);
        const Y = v.Y(g.y);
        if (X < -10 || Y < -10 || X > v.W + 10 || Y > v.W + 10) continue;
        ctx.save();
        ctx.strokeStyle = 'rgba(179,174,219,0.75)';
        ctx.lineWidth = 1.2 * d;
        const r = Math.max(5 * d, v.S * 0.9);
        if (s.cat.startsWith('Gaia')) ring(ctx, X, Y, r, 'rgba(179,174,219,0.75)', [], 1.2 * d);
        else ctx.strokeRect(X - r * 0.85, Y - r * 0.85, r * 1.7, r * 1.7);
        ctx.restore();
      }
    }
    if (ui.showTrack && p.kind !== 'look') {
      // Fixed reference ring at the target's mean position: "watch the ring, it holds still".
      const c0 = project(p.grid.crval[0], p.grid.crval[1], n, p.grid.pixArcsec, t.ra, t.dec);
      ring(ctx, v.X(c0.x), v.Y(c0.y), v.S * 2.2, 'rgba(239,232,221,0.55)', [], 1.5 * d);
      if (p.kind === 'mover') {
        // Predicted path across the passes (catalogue proper motion), dashed lilac.
        ctx.save();
        ctx.strokeStyle = theme.predicted;
        ctx.setLineDash([5 * d, 4 * d]);
        ctx.lineWidth = 1.5 * d;
        ctx.beginPath();
        passes.forEach((ps, k) => {
          const pos = propagate(t, mjdToYear((ps.mjdMin + ps.mjdMax) / 2));
          const g = project(p.grid.crval[0], p.grid.crval[1], n, p.grid.pixArcsec, pos.ra, pos.dec);
          if (k) ctx.lineTo(v.X(g.x), v.Y(g.y));
          else ctx.moveTo(v.X(g.x), v.Y(g.y));
        });
        ctx.stroke();
        ctx.restore();
        const now = propagate(t, year);
        const g = project(p.grid.crval[0], p.grid.crval[1], n, p.grid.pixArcsec, now.ra, now.dec);
        ring(ctx, v.X(g.x), v.Y(g.y), v.S * 0.7, theme.predicted, [3 * d, 3 * d], 1.5 * d);
        // Rough measured centroid for this pass (ember), when this tool has one.
        if (curPass !== null && ui.det) {
          const c = cellOf(p, curPass, ui.det);
          if (c?.centroid) cross(ctx, v.X(c.centroid.x), v.Y(c.centroid.y), v.S * 0.45, theme.measured, 2 * d);
        }
      }
    }
    drawScale(ctx, v, p.grid.pixArcsec, d);
    $('#hud1').textContent = hud1;
    $('#hud2').textContent = hud2;
    $('#hud3').textContent = hud3;
    syncControls();
  }

  /* -------- controls */
  const modes = $('#modes');
  const detsSeg = $('#dets');
  const fovs = $('#fovs');
  const playBtn = $('#play') as HTMLButtonElement;
  const speed = $('#speed') as HTMLInputElement;
  const brightIn = $('#bright') as HTMLInputElement;
  const contrastIn = $('#contrast') as HTMLInputElement;
  speed.value = String(2150 - ui.speed);
  brightIn.value = String(ui.bright);
  contrastIn.value = String(ui.contrast);
  ($('#invert') as HTMLInputElement).checked = ui.invert;
  ($('#track') as HTMLInputElement).checked = ui.showTrack;
  ($('#cat') as HTMLInputElement).checked = ui.showCat;
  ($('#sat') as HTMLInputElement).checked = ui.showSat;

  function syncControls() {
    modes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === ui.mode)));
    detsSeg.querySelectorAll('button').forEach((b) => {
      const dd = +b.dataset.d!;
      b.setAttribute('aria-pressed', String(dd === ui.det));
      b.disabled = dd !== 0 && !p.cells.some((c) => c.det === dd);
      if (dd === 0) b.disabled = ui.mode === 'photos' || !shared.length;
    });
    fovs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.f! === ui.fov)));
    playBtn.textContent = ui.playing ? '❚❚ Pause' : '▶ Play';
    playBtn.disabled = ui.mode === 'diff' || ui.mode === 'stack';
    $('#timeline')
      .querySelectorAll<HTMLButtonElement>('.passchip')
      .forEach((b) => {
        const i = +b.dataset.p!;
        b.setAttribute('aria-current', String(ui.mode === 'blink' && i === ui.pass));
        b.classList.toggle('pick-a', ui.mode === 'diff' && i === ui.a);
        b.classList.toggle('pick-b', ui.mode === 'diff' && i === ui.b);
      });
    $('#difflegend').hidden = ui.mode !== 'diff';
  }

  function setUrl() {
    const qq = new URLSearchParams(location.search);
    qq.set('mode', ui.mode);
    qq.set('det', String(ui.det));
    qq.set('fov', String(ui.fov));
    if (ui.mode === 'diff') {
      qq.set('a', String(passes.findIndex((x) => x.i === ui.a) + 1));
      qq.set('b', String(passes.findIndex((x) => x.i === ui.b) + 1));
    } else {
      qq.delete('a');
      qq.delete('b');
    }
    history.replaceState(null, '', `?${qq}`);
  }

  modes.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest('button');
    if (!b) return;
    ui.mode = b.dataset.m as Mode;
    if (ui.mode === 'photos') {
      if (ui.det === 0) ui.det = bestDet(p);
      ui.photo = 0;
      draw();
      await loadFrames(p);
      stretchCache.key = '';
    }
    restart();
    setUrl();
    draw();
    renderDetGrid();
  });
  detsSeg.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button');
    if (!b || b.disabled) return;
    ui.det = +b.dataset.d!;
    ui.photo = 0;
    setUrl();
    draw();
    renderDetGrid();
  });
  fovs.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button');
    if (!b) return;
    ui.fov = +b.dataset.f!;
    setUrl();
    draw();
  });
  playBtn.addEventListener('click', () => {
    ui.playing = !ui.playing;
    restart();
    draw();
  });
  speed.addEventListener('input', () => {
    ui.speed = 2150 - +speed.value;
    restart();
  });
  brightIn.addEventListener('input', () => {
    ui.bright = +brightIn.value;
    draw();
    renderDetGrid();
  });
  contrastIn.addEventListener('input', () => {
    ui.contrast = +contrastIn.value;
    draw();
    renderDetGrid();
  });
  const bindCheck = (id: string, key: 'invert' | 'showTrack' | 'showCat' | 'showSat') =>
    ($(id) as HTMLInputElement).addEventListener('change', (ev) => {
      ui[key] = (ev.target as HTMLInputElement).checked;
      draw();
      renderDetGrid();
    });
  bindCheck('#invert', 'invert');
  bindCheck('#track', 'showTrack');
  bindCheck('#cat', 'showCat');
  bindCheck('#sat', 'showSat');

  // Pass chips: click shows that pass (blink); in difference mode the first click picks "from", the next "to".
  const tl = $('#timeline');
  let pickNext: 'a' | 'b' = 'a';
  passes.forEach((ps, k) => {
    const chip = h(`<button class="passchip" data-p="${ps.i}"><b><span class="dot" style="background:var(--pass-${ps.i % 4})"></span>Pass ${k + 1}</b>${passLabel(ps)} · ${ps.used} photos · ${ps.releases.join('+')}</button>`);
    chip.addEventListener('click', () => {
      if (ui.mode === 'diff') {
        if (pickNext === 'a') ui.a = ps.i;
        else ui.b = ps.i;
        pickNext = pickNext === 'a' ? 'b' : 'a';
        setUrl();
      } else {
        if (ui.mode !== 'blink') ui.mode = 'blink';
        ui.pass = ps.i;
        ui.playing = false;
        restart();
      }
      draw();
      renderDetGrid();
    });
    tl.append(chip);
  });
  $('#difflegend').append(
    h(`<div class="ctl" style="gap:10px;flex-wrap:wrap"><span style="display:inline-block;width:160px;height:10px;border-radius:5px;background:${diffLegendGradient()}"></span>
      <span>darker in the later pass ← → brighter in the later pass (±5σ). Grey: masked (saturated or flagged). Click two passes to compare. Something that moved shows as a dark and bright pair; a ring means it changed colour or brightness, not position.</span></div>`),
  );

  // Hover probe: offset from the target and the stacked value.
  canvas.addEventListener('mousemove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const v = new View(n, ui.fov, canvas.width);
    const X = ((ev.clientX - r.left) / r.width) * canvas.width;
    const Y = ((ev.clientY - r.top) / r.height) * canvas.height;
    const gx = v.gx(X);
    const gy = v.gy(Y);
    const c = (n - 1) / 2;
    const e = (c - gx) * p.grid.pixArcsec;
    const nn = (gy - c) * p.grid.pixArcsec;
    const pr = $('#probe');
    pr.hidden = false;
    pr.textContent = `${Math.abs(e).toFixed(0)}″ ${e >= 0 ? 'E' : 'W'}, ${Math.abs(nn).toFixed(0)}″ ${nn >= 0 ? 'N' : 'S'} of centre`;
  });
  canvas.addEventListener('mouseleave', () => ($('#probe').hidden = true));
  canvas.addEventListener('click', () => {
    ui.playing = !ui.playing;
    restart();
    draw();
  });

  /* -------- six-colour strip */
  function renderDetGrid() {
    const g = $('#detgrid');
    g.innerHTML = '';
    const pass = ui.mode === 'diff' ? ui.b : ui.pass;
    $('#detsTitle').textContent = ui.mode === 'diff' ? 'Difference in each colour range' : `Pass ${passes.findIndex((x) => x.i === pass) + 1} in each colour range`;
    for (const d of DETECTORS) {
      const btn = h(`<button aria-pressed="${ui.det === d.det}" title="Show ${d.lo}–${d.hi} µm"><canvas width="${n}" height="${n}"></canvas><span>${d.lo}–${d.hi} µm</span></button>`) as HTMLButtonElement;
      const cv = btn.querySelector('canvas')!;
      const c = cellOf(p, pass, d.det);
      if (c) {
        if (ui.mode === 'diff') {
          const ca = cellOf(p, ui.a, d.det);
          if (ca) cv.getContext('2d')!.putImageData(diffImage(cellImage(p, ca, 'strict'), cellImage(p, c, 'strict'), Math.hypot(ca.stats.sigma ?? 1, c.stats.sigma ?? 1), n), 0, 0);
        } else {
          const ims = passes.map((ps) => cellOf(p, ps.i, d.det)).filter((x): x is Cell => !!x).map((x) => cellImage(p, x, 'display'));
          cv.getContext('2d')!.putImageData(greyImage(cellImage(p, c, 'display'), n, sharedStretch(ims, { floorP: 0.05, ceilingP: 0.999 }), ui.invert), 0, 0);
        }
      } else btn.disabled = true;
      btn.addEventListener('click', () => {
        ui.det = d.det;
        setUrl();
        draw();
        renderDetGrid();
      });
      g.append(btn);
    }
  }

  /* -------- animation */
  function tick() {
    if (ui.mode === 'blink') {
      const k = passes.findIndex((x) => x.i === ui.pass);
      ui.pass = passes[(k + 1) % passes.length].i;
    } else if (ui.mode === 'photos') ui.photo++;
    draw();
    renderDetGridIfBlink();
  }
  let gridTick = 0;
  function renderDetGridIfBlink() {
    if (ui.mode === 'blink' && ++gridTick % 1 === 0) renderDetGrid();
  }
  function restart() {
    stop();
    if (ui.playing && (ui.mode === 'blink' || ui.mode === 'photos')) timer = window.setInterval(tick, ui.mode === 'photos' ? Math.max(120, ui.speed / 3) : ui.speed);
  }

  /* -------- facts */
  renderFacts();
  function renderFacts() {
    const f = $('#facts');
    const st = $('#status');
    const releases = p.releases.join(' + ');
    const nPhotos = p.exposures.length;
    const span = (passes[passes.length - 1].mjdMax - passes[0].mjdMin) / 365.25;
    const lead = $('#lead');
    if (p.kind === 'mover') {
      st.innerHTML = motion ? `<span class="mk measured"></span>Moves · measured here, roughly` : `<span class="mk unmeasured"></span>Moves · not measured here`;
      lead.textContent = motion
        ? `Watch the ring: it holds still. The star walks out of it, about ${motion.measArc.toFixed(0)}″ ${motion.dirText} in ${motion.years < 1.2 ? 'a year' : `${motion.years.toFixed(1)} years`}.`
        : 'Watch the ring: it holds still.';
    } else if (p.kind === 'variable') {
      st.innerHTML = `<span class="mk unconfirmed"></span>Changes in brightness`;
      lead.textContent = 'Same place, different light. Compare its spectrum pass by pass, below.';
    } else {
      st.innerHTML = `<span class="mk look"></span>A look`;
      lead.textContent = 'Real SPHEREx photos of this spot, by pass and by colour. No verdicts.';
    }
    const rows: string[] = [];
    rows.push(fact('Position', `${fmtRa(t.ra)} ${fmtDec(t.dec)}`, `at ${t.epoch.toFixed(1)}${t.pmSource && p.kind === 'mover' ? ` · motion from ${esc(t.pmSource)}` : ''}`));
    rows.push(fact('Photos', `${nPhotos} SPHEREx photos in ${passes.length} passes over ${span.toFixed(1)} years`, `${releases} · read from NASA's archive (IRSA)`));
    if (motion) {
      const m = motion;
      rows.push(
        fact(
          '<span class="mk measured"></span>Moved',
          `≈ ${m.measArc.toFixed(1)}″ ${m.dirText} (${m.measPx.toFixed(2)} ± ${m.errPx.toFixed(2)} px)`,
          `Pass ${m.from + 1} → ${m.to + 1}, ${m.years.toFixed(2)} years. Rough: light-weighted centre of each stack, median of ${m.nDet} colour range${m.nDet > 1 ? 's' : ''}${m.saturated ? '; uses saturated pixels' : ''}.`,
        ),
      );
      rows.push(fact('<span class="mk predicted"></span>Predicted', `${m.predArc.toFixed(1)}″ (${m.predPx.toFixed(2)} px)`, `From the catalogue proper motion (${esc(t.pmSource ?? 'catalogue')}). ${m.agree}`));
    } else if (p.kind === 'mover') {
      rows.push(fact('Moved', 'not measured', 'This tool could not find a centre in enough colour ranges.'));
    }
    if (bright) rows.push(fact('Brightness', bright.text, bright.note));
    const flags = Object.entries(p.flagFractionsCore)
      .filter(([k, v]) => v >= 0.005 && k !== 'FULLSAMPLE')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `<span class="chip ${['SOURCE', 'OUTLIER'].includes(k) ? '' : 'flag'}" title="${esc(flagHelp(k))}">${esc(k.toLowerCase().replace("_", " "))} ${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%</span>`)
      .join('');
    rows.push(fact('<span class="mk flag"></span>Flags', `<div class="chips">${flags || '<span class="chip">none</span>'}</div>`, 'Share of pixels near the target that the SPHEREx pipeline flagged, over all photos. Hover a flag for what it means. Moving objects often trip "outlier"; this tool never hides those pixels.'));
    const near = p.catalog.length;
    rows.push(fact('<span class="mk cat"></span>Catalogue', `${near} known stars in view`, 'Gaia DR3 (circles) and CatWISE2020 (squares), moved to each pass\'s date by their proper motions.'));
    f.innerHTML = rows.join('');
  }

  /* -------- spectrum */
  function renderSpectrum() {
    const { svg, nGood, nFlagged } = spectrumSvg(p.exposures, { showFlagged: ui.specFlagged, passes, hiddenPasses: ui.hidden });
    $('#specChart').innerHTML = svg;
    const leg = $('#specLegend');
    leg.innerHTML = '';
    passes.forEach((ps, k) => {
      const lab = h(`<label class="ctl"><input type="checkbox" ${ui.hidden.has(ps.i) ? '' : 'checked'}> <span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--pass-${ps.i % 4})"></span> Pass ${k + 1} · ${passLabel(ps)}</label>`);
      lab.querySelector('input')!.addEventListener('change', (ev) => {
        if ((ev.target as HTMLInputElement).checked) ui.hidden.delete(ps.i);
        else ui.hidden.add(ps.i);
        renderSpectrum();
      });
      leg.append(lab);
    });
    const fl = h(`<label class="ctl"><input type="checkbox" ${ui.specFlagged ? 'checked' : ''}> show ${nFlagged} flagged photos <span class="mk flag" style="border-radius:50%"></span></label>`);
    fl.querySelector('input')!.addEventListener('change', (ev) => {
      ui.specFlagged = (ev.target as HTMLInputElement).checked;
      renderSpectrum();
    });
    leg.append(fl);
    leg.append(h(`<span>${nGood} clean measurements</span>`));
    const warn = $('#specWarn');
    warn.innerHTML = '';
    if (nGood < 10 && nFlagged > nGood)
      warn.append(h(`<div class="warn">Too bright to measure: almost every photo has saturated or flagged pixels at the target, so these numbers are not brightness measurements.</div>`));
    for (const b of blends) warn.append(h(`<div class="warn">${b}</div>`));
  }
  renderSpectrum();

  $('#copy').addEventListener('click', copyLink);
  $('#embed').addEventListener('click', () => {
    const code = `<iframe src="${location.href}" width="900" height="760" style="border:0" title="${esc(p.name)} in SPHEREx (Planetes)"></iframe>`;
    navigator.clipboard?.writeText(code);
    ($('#embed') as HTMLButtonElement).textContent = 'Embed code copied';
  });

  setUrl();
  draw();
  renderDetGrid();
  restart();

  // The context map loads lazily, once the panel is near the screen.
  const box = $('#aladin-box');
  const io = new IntersectionObserver(async (ents) => {
    if (!ents.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const c = await mountContext(box, { ra: t.ra, dec: t.dec }, 0.3, $('#lam') as HTMLInputElement, $('#lamv'));
    if (c) {
      c.setBox(p.grid.crval[0], p.grid.crval[1], (n * p.grid.pixArcsec) / 3600);
      c.setCatalog(p.catalog, 2026.0, (s) => propagate(s, 2026.0));
    }
  }, { rootMargin: '300px' });
  io.observe(box);
}

function fact(k: string, v: string, note = '') {
  return `<dt>${k}</dt><dd>${v}${note ? `<span class="note">${note}</span>` : ''}</dd>`;
}

function flagHelp(k: string): string {
  const H: Record<string, string> = {
    SOURCE: 'Pixel belongs to a detected source (not a problem).',
    OUTLIER: 'Pixel differs from other photos of the same spot. Moving objects trip this; never hidden here.',
    OVERFLOW: 'The detector saturated: the value is not reliable.',
    SUR_ERROR: 'The up-the-ramp fit failed, usually from saturation.',
    BLOOM: 'Charge spilled from a saturated neighbour.',
    NONLINEAR: 'The detector response was nonlinear (very bright).',
    TRANSIENT: 'A short-lived hit, e.g. a cosmic ray.',
    HALO: 'Scattered light around a bright star.',
    DICHROIC: 'Affected by the dichroic beam-splitter edge.',
    PERSIST: 'Afterimage of an earlier bright source.',
    GHOST: 'Optical ghost of a bright star.',
    HOT: 'Hot pixel.',
    COLD: 'Cold (dead) pixel.',
    NONFUNC: 'Non-functional pixel.',
  };
  return H[k] ?? 'SPHEREx pipeline flag.';
}

function copyLink() {
  navigator.clipboard?.writeText(location.href);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/* ------------------------------------------------------------------ measurements from the pack */

interface Motion {
  from: number;
  to: number;
  years: number;
  measPx: number;
  errPx: number;
  measArc: number;
  predPx: number;
  predArc: number;
  dirText: string;
  agree: string;
  nDet: number;
  saturated: boolean;
}

/** Rough motion between the first and last pass: median over colour ranges of the centroid shift. */
function measureMotion(p: Pack): Motion | null {
  if (p.kind !== 'mover') return null;
  const passes = p.passes.filter((ps) => p.cells.some((c) => c.pass === ps.i));
  // Prefer the pair with the longest baseline that most detectors share.
  const a = passes[0].i;
  const b = passes[passes.length - 1].i;
  const dx: number[] = [];
  const dy: number[] = [];
  let px = 0;
  let py = 0;
  let saturated = false;
  const use = infoOf(p)?.motionDets ?? DETECTORS.map((d) => d.det);
  for (const d of DETECTORS) {
    if (!use.includes(d.det)) continue;
    const ca = cellOf(p, a, d.det);
    const cb = cellOf(p, b, d.det);
    if (!ca?.centroid || !cb?.centroid) continue;
    dx.push(cb.centroid.x - ca.centroid.x);
    dy.push(cb.centroid.y - ca.centroid.y);
    px = cb.predicted.x - ca.predicted.x;
    py = cb.predicted.y - ca.predicted.y;
    const sa = cellSat(p, ca);
    const c = Math.round(ca.predicted.y) * p.grid.n + Math.round(ca.predicted.x);
    if (sa[c] >= 128) saturated = true;
  }
  if (dx.length < Math.min(2, use.length)) return null;
  const med = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1];
  const mx = med(dx);
  const my = med(dy);
  const mad = (v: number[], m: number) => med(v.map((x) => Math.abs(x - m))) * 1.4826;
  const errPx = Math.max(0.02, Math.hypot(mad(dx, mx), mad(dy, my)) / Math.sqrt(dx.length));
  const measPx = Math.hypot(mx, my);
  const predPx = Math.hypot(px, py);
  const pa = p.passes.find((x) => x.i === a)!;
  const pb = p.passes.find((x) => x.i === b)!;
  const years = ((pb.mjdMin + pb.mjdMax) / 2 - (pa.mjdMin + pa.mjdMax) / 2) / 365.25;
  // Grid x grows to the west (east is left), y to the north.
  const east = -mx;
  const north = my;
  const dir = (() => {
    const ang = (Math.atan2(east, north) * 180) / Math.PI; // 0 = north, 90 = east
    const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return names[Math.round((((ang % 360) + 360) % 360) / 45) % 8];
  })();
  const diff = Math.hypot(mx - px, my - py);
  const agree =
    diff <= Math.max(2 * errPx, 0.25)
      ? `Agrees with the measurement (difference ${diff.toFixed(2)} px).`
      : `Differs from the rough measurement by ${diff.toFixed(2)} px: treat the rough number with care.`;
  return {
    from: passes.findIndex((x) => x.i === a),
    to: passes.findIndex((x) => x.i === b),
    years,
    measPx,
    errPx,
    measArc: measPx * p.grid.pixArcsec,
    predPx,
    predArc: predPx * p.grid.pixArcsec,
    dirText: dir,
    agree,
    nDet: dx.length,
    saturated,
  };
}

/** Brightness change between passes at matched wavelengths (same colour, never across colours). */
function brightnessChange(p: Pack): { text: string; note: string } | null {
  const clean = p.exposures.filter((e) => e.phot && !e.phot.flagged);
  const all = p.exposures.filter((e) => e.phot);
  if (p.kind === 'variable' && clean.length < Math.max(10, all.length * 0.1)) {
    return { text: 'too bright to measure here', note: 'Nearly every photo is saturated or flagged at the star, so SPHEREx can show it but this tool cannot measure its brightness.' };
  }
  const passes = p.passes.map((x) => x.i);
  if (p.kind === 'mover') return null; // a mover's aperture follows it; brightness is not the story here
  if (passes.length < 2 || clean.length < 20) return null;
  const a = passes[0];
  const b = passes[passes.length - 1];
  const bin = (l: number) => Math.round(Math.log(l) / 0.02); // 2% wide wavelength bins
  const A = new Map<number, number[]>();
  const B = new Map<number, number[]>();
  for (const e of clean) {
    const m = e.pass === a ? A : e.pass === b ? B : null;
    if (!m) continue;
    const k = bin(e.lam);
    m.set(k, [...(m.get(k) ?? []), e.phot!.flux]);
  }
  const ratios: number[] = [];
  const med = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1];
  for (const [k, va] of A) {
    const vb = B.get(k);
    if (!vb) continue;
    const ma = med(va);
    const mb = med(vb);
    if (ma > 0 && mb > 0) ratios.push(mb / ma);
  }
  if (ratios.length < 5) return null;
  const r = med(ratios);
  const sorted = [...ratios].sort((x, y) => x - y);
  const lo = sorted[Math.floor(sorted.length * 0.16)];
  const hi = sorted[Math.ceil(sorted.length * 0.84) - 1];
  const pct = (r - 1) * 100;
  const steady = lo <= 1 && hi >= 1;
  return {
    text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}% from pass 1 to pass ${p.passes.length} ${steady ? '(within the scatter)' : ''}`,
    note: `Median ratio over ${ratios.length} matched wavelengths (middle 68%: ${lo.toFixed(2)}–${hi.toFixed(2)}). Quick aperture photometry; compare like with like.`,
  };
}

/** Catalogue stars close enough to the target to add light to its aperture. */
function blendWarnings(p: Pack): string[] {
  const out: string[] = [];
  const r = (p.photometry.radiusPx + 1) * p.grid.pixArcsec;
  const t = propagate(p.target, 2026.0);
  for (const s of p.catalog) {
    const pos = propagate(s, 2026.0);
    const sep = sepArcsec(pos, t);
    if (sep < 3 || sep > r) continue;
    // Gaia only: CatWISE splits fast movers into several fragments, which would flag the target itself.
    if (s.band !== 'G' || s.mag == null || s.mag > 19.5) continue;
    out.push(`The measurement may include light from ${esc(s.cat)} ${esc(s.id)} (${s.band} ${s.mag}) ${sep.toFixed(1)}″ away, especially at short wavelengths where the target is faint.`);
  }
  return [...new Set(out)].slice(0, 3);
}

route();

export type { Exposure };
