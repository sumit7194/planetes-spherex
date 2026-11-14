/**
 * N8, "Listen" (Viewer's design, 15 Nov): a measured spectrum played as sound. Wavelength sets
 * both when a note plays and its pitch (short wavelengths high, long ones low, log-spaced over two
 * octaves across 0.75–5 µm); brightness sets loudness (log flux, clamped so faint points are still
 * heard). About 4 s in all.
 *
 * Honesty: only the points the chart draws as measurements are played. Flagged (hollow) photos
 * are left out, and a stretch of wavelength with no measured point is silence. Many photos share
 * nearly the same wavelength, so points are grouped in narrow 0.05 µm bands and each band plays
 * the median of its own measured points: nothing is interpolated or smoothed across bands.
 * Nothing about any feature is said in sound or words.
 *
 * Opt-in only: one explicit button, no autoplay, one AudioContext made on the first press.
 * Playback stops when the button leaves the page (a tab or page change) or the page is hidden.
 */
import { h } from './dom';

const L0 = 0.75;
const L1 = 5.0;
const SECONDS = 4;
const BAND_UM = 0.05;
const F_HIGH = 880; // at 0.75 µm
const OCTAVES = 2; // down to 220 Hz at 5 µm

export interface Note {
  um: number;
  flux: number;
}

/** The notes: measured points grouped in narrow wavelength bands, median flux per band. */
export function notesFrom(points: { um: number; flux: number }[]): Note[] {
  const bands = new Map<number, number[]>();
  for (const p of points) {
    if (!Number.isFinite(p.um) || !Number.isFinite(p.flux) || p.um < L0 || p.um > L1) continue;
    const k = Math.floor((p.um - L0) / BAND_UM);
    const list = bands.get(k) ?? [];
    list.push(p.flux);
    bands.set(k, list);
  }
  return [...bands]
    .sort((a, b) => a[0] - b[0])
    .map(([k, fs]) => {
      const s = [...fs].sort((a, b) => a - b);
      const mid = s.length >> 1;
      const median = s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
      return { um: L0 + (k + 0.5) * BAND_UM, flux: median };
    });
}

/** Pitch for a wavelength: short high, long low, log-spaced. */
export function pitchHz(um: number): number {
  const t = Math.max(0, Math.min(1, (um - L0) / (L1 - L0)));
  return F_HIGH * 2 ** (-OCTAVES * t);
}

/** Loudness 0.15–1 from log flux across the notes; zero or negative flux plays at the floor. */
export function loudness(notes: Note[]): number[] {
  const pos = notes.map((n) => n.flux).filter((f) => f > 0);
  if (!pos.length) return notes.map(() => 0.15);
  const lo = Math.log10(Math.min(...pos));
  const hi = Math.log10(Math.max(...pos));
  return notes.map((n) =>
    n.flux > 0 && hi > lo ? 0.15 + 0.85 * ((Math.log10(n.flux) - lo) / (hi - lo)) : 0.15,
  );
}

let ctx: AudioContext | null = null;
let playing: { key: string; stop: () => void } | null = null;

function play(key: string, notes: Note[], onEnd: () => void): void {
  playing?.stop();
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  void ctx.resume();
  const ac = ctx;
  const master = ac.createGain();
  master.gain.value = 0.18;
  master.connect(ac.destination);
  const t0 = ac.currentTime + 0.05;
  const gains = loudness(notes);
  const slot = (BAND_UM / (L1 - L0)) * SECONDS;
  notes.forEach((n, i) => {
    const at = t0 + ((n.um - L0) / (L1 - L0)) * SECONDS;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = pitchHz(n.um);
    // A short note filling its band's slot, with soft edges so neighbours join and gaps are silent.
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gains[i] ?? 0.15, at + slot * 0.25);
    g.gain.setValueAtTime(gains[i] ?? 0.15, at + slot * 0.85);
    g.gain.linearRampToValueAtTime(0, at + slot * 1.1);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + slot * 1.15);
  });
  const end = globalThis.setTimeout(finish, (SECONDS + 0.3) * 1000);
  function finish(): void {
    globalThis.clearTimeout(end);
    globalThis.clearInterval(watch);
    document.removeEventListener('visibilitychange', onHide);
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setValueAtTime(0, ac.currentTime);
    master.disconnect();
    if (playing?.key === key) playing = null;
    onEnd();
  }
  const onHide = () => document.hidden && finish();
  document.addEventListener('visibilitychange', onHide);
  // Stop when no button for this spectrum is on the page any more (another tab or page).
  const watch = globalThis.setInterval(() => {
    if (!document.querySelector(`[data-listen="${CSS.escape(key)}"]`)) finish();
  }, 300);
  playing = { key, stop: finish };
}

/**
 * The button and its one-line mapping. `key` names the spectrum (so a re-rendered button keeps
 * its Play/Stop state), `name` is the accessible name, and `points` are the measured points.
 */
export function listenControl(
  key: string,
  points: { um: number; flux: number }[],
  t: { listen: string; stop: string; name: string; mapping: string },
): HTMLElement | null {
  const notes = notesFrom(points);
  if (notes.length < 2) return null;
  // ▶ Listen / ■ Stop; the glyph is decoration, the word is the name.
  const label = (state: boolean) => [
    h('span', { 'aria-hidden': 'true' }, state ? '■ ' : '▶ '),
    state ? t.stop : t.listen,
  ];
  const on = playing?.key === key;
  const b = h(
    'button',
    {
      type: 'button',
      'aria-pressed': String(on),
      'aria-label': t.name,
      'data-listen': key,
      class: 'listen',
    },
    ...label(on),
  );
  const set = (state: boolean) => {
    b.setAttribute('aria-pressed', String(state));
    b.replaceChildren(...label(state));
  };
  b.addEventListener('click', () => {
    if (playing?.key === key) {
      playing.stop();
      return;
    }
    set(true);
    play(key, notes, () => {
      for (const el of document.querySelectorAll(`[data-listen="${CSS.escape(key)}"]`)) {
        el.setAttribute('aria-pressed', 'false');
        el.replaceChildren(...label(false));
      }
    });
  });
  // In an .actions row, so it takes the page's own pill button style (Viewer).
  return h('div', { class: 'actions listen-row' }, b, h('span', { class: 'hint' }, t.mapping));
}
