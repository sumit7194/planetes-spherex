/**
 * Light or dark: the visitor's pick (System, Light, Dark), remembered in this browser, else the
 * system's setting. The page head resolves it before first paint; this keeps it current and
 * draws the switch. Only the interface changes; the sky and the photos keep the night palette.
 */

import { h } from './dom';

export type SchemePick = 'system' | 'light' | 'dark';

const KEY = 'planetes-scheme';
const systemLight = matchMedia('(prefers-color-scheme: light)');

function stored(): SchemePick {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pick: SchemePick): void {
  const root = document.documentElement;
  root.dataset['scheme'] = pick;
  root.dataset['ui'] =
    pick === 'light' || (pick === 'system' && systemLight.matches) ? 'light' : 'dark';
}

/** Follows the system's setting while the pick is System. */
export function watchScheme(): void {
  apply(stored());
  systemLight.addEventListener('change', () => apply(stored()));
  // A pick made in another tab of this site.
  addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) {
      apply(stored());
      document.dispatchEvent(new Event('planetes-scheme'));
    }
  });
}

const ICONS: Record<SchemePick, string> = {
  // Half a disc: whichever the device uses.
  system:
    '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>',
  light:
    '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  dark: '<path d="M12.6 10.2A5.6 5.6 0 0 1 5.8 3.4a5.6 5.6 0 1 0 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
};

/** Three small buttons, the current pick pressed; labels come from the copy deck. */
export function schemeSwitch(labels: Record<SchemePick, string>, group: string): HTMLElement {
  const wrap = h('div', { class: 'scheme-switch glass', role: 'group', 'aria-label': group });
  const buttons = (['system', 'light', 'dark'] as const).map((pick) => {
    const b = h('button', {
      type: 'button',
      'data-pick': pick,
      'aria-label': labels[pick],
      title: labels[pick],
    });
    b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICONS[pick]}</svg>`;
    b.addEventListener('click', () => {
      try {
        if (pick === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pick);
      } catch {
        /* storage blocked: the pick still holds for this visit */
      }
      apply(pick);
      mark();
    });
    return b;
  });
  const mark = () => {
    const now = document.documentElement.dataset['scheme'] ?? 'system';
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset['pick'] === now));
  };
  wrap.append(...buttons);
  mark();
  document.addEventListener('planetes-scheme', mark);
  return wrap;
}
