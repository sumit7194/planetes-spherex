/**
 * The homepage band (variant D, agreed with Viewer, 14 Nov): one row per target, every photo a
 * dot at its date coloured by its wavelength (the show pages' dock, from the first second), a
 * typed spot as a sixth row of week bars, and one week cursor that shows that week's photos on
 * the sky. The survey's scale is one sentence, computed at build time (pipeline/build_band.py).
 *
 * The rows are real buttons (they open the target); the dots are an aria-hidden canvas, so a
 * screen reader hears each row's name, status and photo count instead of a picture.
 */
import { h } from './dom';
import { wavelengthColour } from './figures';
import type { BandFile } from '../app/passes';

export type BandRow = {
  id: string;
  name: string;
  /** The status chip, as on the cards (ember dot when measured). */
  chip: HTMLElement | null;
  /** Its accessible name: "Barnard's Star, moved about 10″ north, measured, 358 photos in 3 passes". */
  label: string;
  frames: [number, number, number][];
  disabled: boolean;
};

export type BandSpot = {
  /** "Your spot" / "Barnard's Star" */
  title: string;
  /** "3 passes", or "looking…" while the sky index answers. */
  short: string;
  /** Photos per week, or null while loading. */
  counts: number[] | null;
};

export type BandText = {
  label: string;
  week: string;
  noWeek: string;
  play: string;
  pause: string;
  close: string;
  showing: (week: string) => string;
  seam: string;
  through: (date: string) => string;
  flat: string;
};

export type SkyBandInput = {
  data: BandFile;
  rows: BandRow[];
  spot: BandSpot | null;
  /** The line over the rows: the survey sentence, or the typed spot's. */
  line: string;
  /** The week shown on the sky, or null when coverage is off (the default). */
  week: number | null;
  /** "24 to 30 April 2025 · 21,700 photos" for the shown week. */
  weekText: (k: number) => string;
  playing: boolean;
  canPlay: boolean;
  text: BandText;
  onOpen: (id: string) => void;
  onLit: (id: string | null) => void;
  onWeek: (k: number) => void;
  onPlay: () => void;
  onClose: () => void;
  /** In Look around, the week's band is often behind you: a way to the flat map (else null). */
  onFlat: (() => void) | null;
  /** The way to the page about the challenge's five tests (under the rows' names). */
  testsLink?: { href: string; text: string };
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86_400_000);

/** The band, and a way to move its week cursor without rebuilding it (a drag keeps its grip). */
export type SkyBand = { el: HTMLElement; setWeek: (week: number | null, playing: boolean) => void };

export function skyBand(o: SkyBandInput): SkyBand {
  const weeks = o.data.weeks;
  const n = weeks.length;
  const t0 = weeks[0]?.start ?? 0;
  const t1 = weeks[n - 1]?.end ?? 1;
  const frac = (mjd: number) => (mjd - t0) / (t1 - t0);
  const weekFrac = (k: number) => {
    const w = weeks[k];
    return w ? frac((w.start + w.end) / 2) : 0;
  };

  /* ---- the rows' names: buttons that open the target ---- */
  const names = h('ol', { class: 'sb-names' });
  if (o.spot)
    names.append(
      h(
        'li',
        { class: 'sb-spot' },
        h('span', { class: 'sb-spot-name' }, o.spot.title),
        h('span', { class: 'sb-spot-short' }, o.spot.short),
      ),
    );
  for (const r of o.rows) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'sb-row',
        'data-id': r.id,
        'aria-label': r.label,
        disabled: r.disabled,
      },
      h('span', { class: 'sb-name' }, r.name),
      r.chip,
    );
    b.addEventListener('click', () => o.onOpen(r.id));
    b.addEventListener('pointerenter', () => o.onLit(r.id));
    b.addEventListener('pointerleave', () => o.onLit(null));
    b.addEventListener('focus', () => o.onLit(r.id));
    b.addEventListener('blur', () => o.onLit(null));
    names.append(h('li', {}, b));
  }

  /* ---- the track: dots on a canvas, under one week cursor ---- */
  const canvas = h('canvas', { class: 'sb-canvas', 'aria-hidden': 'true' });
  const cursor = h('span', { class: 'sb-cursor', 'aria-hidden': 'true' });
  let shown = o.week;
  const slider = h(
    'div',
    {
      class: 'sb-slider',
      role: 'slider',
      tabindex: 0,
      'aria-label': o.text.week,
      'aria-valuemin': 0,
      'aria-valuemax': n - 1,
    },
    cursor,
  );
  const weekAt = (clientX: number) => {
    const r = slider.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    const mjd = t0 + f * (t1 - t0);
    const k = weeks.findIndex((w) => mjd < w.end);
    return k < 0 ? n - 1 : k;
  };
  slider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    slider.focus({ preventScroll: true });
    slider.setPointerCapture(e.pointerId);
    o.onWeek(weekAt(e.clientX));
  });
  slider.addEventListener('pointermove', (e) => {
    if (slider.hasPointerCapture(e.pointerId)) o.onWeek(weekAt(e.clientX));
  });
  slider.addEventListener('keydown', (e) => {
    const from = shown ?? n - 1;
    const to =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? shown === null
          ? n - 1
          : from - 1
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? shown === null
            ? n - 1
            : from + 1
          : e.key === 'PageDown'
            ? from - 4
            : e.key === 'PageUp'
              ? from + 4
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? n - 1
                  : null;
    if (to === null) return;
    e.preventDefault();
    o.onWeek(Math.max(0, Math.min(n - 1, to)));
  });
  const track = h('div', { class: 'sb-track' }, canvas, slider);

  /* ---- the time axis: quarters, the release seam, the last released week ---- */
  const axis = h('div', { class: 'sb-axis', 'aria-hidden': 'true' });
  const placed: number[] = [];
  const put = (f: number, text: string, cls = '') => {
    if (f < 0 || f > 1 || placed.some((p) => Math.abs(p - f) < 0.085)) return;
    placed.push(f);
    const s = h('span', { class: cls }, text);
    s.style.left = `${(f * 100).toFixed(2)}%`;
    axis.append(s);
  };
  // The last day photographed (weeks end exclusive), as the week labels say it.
  const last = mjdToDate((weeks[n - 1]?.end ?? t1) - 1);
  put(
    1,
    o.text.through(`${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`),
    'end',
  );
  put(frac(o.data.survey.releaseSeamMjd), o.text.seam, 'seam');
  const start = mjdToDate(t0);
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m += 3) {
    const d = new Date(Date.UTC(y, m, 1));
    const f = frac(d.getTime() / 86_400_000 + 40587);
    if (f > 1) break;
    const mon = MONTHS[d.getUTCMonth()] ?? '';
    put(f, d.getUTCMonth() < 3 || placed.length === 2 ? `${mon} ${d.getUTCFullYear()}` : mon);
  }

  /* ---- the head: the one sentence, and the week shown ---- */
  const head = h('div', { class: 'sb-head' }, h('p', { class: 'sb-line' }, o.line));
  const weekText = h('span', { class: 'sb-week-text', role: 'status' });
  const play = h('button', { type: 'button', class: 'sb-play' });
  play.addEventListener('click', o.onPlay);
  play.hidden = !o.canPlay;
  const close = h(
    'button',
    { type: 'button', class: 'sb-close', 'aria-label': o.text.close, title: o.text.close },
    '×',
  );
  close.addEventListener('click', o.onClose);
  // After the rows in the DOM (keyboard: rows, then the week slider, then play), drawn top-right.
  const flat = o.onFlat ? h('button', { type: 'button', class: 'sb-flat' }, o.text.flat) : null;
  if (flat && o.onFlat) flat.addEventListener('click', o.onFlat);
  const weekControls = h('div', { class: 'sb-week' }, weekText, flat, play, close);
  const setWeek = (week: number | null, playing: boolean) => {
    shown = week;
    cursor.hidden = week === null;
    if (week !== null) cursor.style.left = `${(weekFrac(week) * 100).toFixed(3)}%`;
    slider.setAttribute('aria-valuenow', String(week ?? n - 1));
    slider.setAttribute('aria-valuetext', week === null ? o.text.noWeek : o.weekText(week));
    weekText.textContent = week === null ? '' : o.text.showing(o.weekText(week));
    weekText.hidden = week === null;
    close.hidden = week === null;
    if (flat) flat.hidden = week === null;
    play.textContent = playing ? o.text.pause : o.text.play;
    play.setAttribute('aria-pressed', String(playing));
  };
  setWeek(o.week, o.playing);

  const band = h(
    'section',
    { class: o.spot ? 'sky-band with-spot' : 'sky-band', 'aria-label': o.text.label },
    head,
    h('div', { class: 'sb-grid' }, names, track),
    weekControls,
    h(
      'div',
      { class: 'sb-axis-row' },
      o.testsLink
        ? h('a', { class: 'sb-tests', href: o.testsLink.href }, o.testsLink.text)
        : h('span'),
      axis,
    ),
  );
  band.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shown !== null) {
      e.preventDefault();
      o.onClose();
    }
  });

  /* ---- drawing, whenever the track has a size ---- */
  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = track.clientWidth;
    const H = track.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(band);
    const look = css.getPropertyValue('--look').trim() || '#6fb5e0';
    const line = css.getPropertyValue('--sb-rule').trim() || 'rgba(210,203,194,0.14)';
    // Row geometry from the names list itself, so dots and names can never drift apart.
    const top = track.getBoundingClientRect().top;
    const lis = [...names.children].map((li) => {
      const r = li.getBoundingClientRect();
      return { y: r.top - top, h: r.height };
    });
    ctx.fillStyle = line;
    for (const r of lis.slice(0, -1)) ctx.fillRect(0, Math.round(r.y + r.h) - 0.5, W, 1);
    // The release seam: DR1 to its left, QR3 to its right.
    const xs = frac(o.data.survey.releaseSeamMjd) * W;
    ctx.fillRect(Math.round(xs) - 0.5, 0, 1, H);
    let i = 0;
    if (o.spot) {
      const r = lis[i++];
      if (r && o.spot.counts) {
        ctx.fillStyle = look;
        const step = W / n;
        o.spot.counts.forEach((c, k) => {
          if (c > 0)
            ctx.fillRect(weekFrac(k) * W - step / 2 + 0.5, r.y + 3, Math.max(1, step - 1), r.h - 6);
        });
      }
    }
    const lo = Math.log(0.75);
    const span = Math.log(5) - lo;
    for (const row of o.rows) {
      const r = lis[i++];
      if (!r) continue;
      for (const [mjd, l] of row.frames) {
        const y = r.y + r.h - 3 - ((Math.log(l) - lo) / span) * (r.h - 6);
        ctx.fillStyle = wavelengthColour(l);
        ctx.fillRect(frac(mjd) * W - 0.8, y - 0.8, 1.6, 1.6);
      }
    }
  };
  // Rebuilt on every render: let go of the old band once it leaves the page.
  let seen = false;
  const ro = new ResizeObserver(() => {
    if (!band.isConnected) {
      if (seen) ro.disconnect();
      return;
    }
    seen = true;
    draw();
  });
  ro.observe(track);
  return { el: band, setWeek };
}
