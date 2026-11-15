/**
 * Light or dark (Sumit, 15 Nov, with Viewer): dark by default for everyone, since the sky and the
 * photos are always night and a light panel beside them reads as two apps; Light stays as a choice
 * for readers who read light-on-dark poorly (astigmatism, bright rooms, projectors). The choice
 * lives in "What am I seeing?" and the keys dialog, not the header, and no longer follows the
 * device's setting. The page head resolves it before first paint; this keeps it current.
 */

import { h } from './dom';

export type SchemePick = 'dark' | 'light';

const KEY = 'planetes-scheme';

/** The stored choice; anything else (nothing, or an old "system") is dark. */
function stored(): SchemePick {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(pick: SchemePick): void {
  const root = document.documentElement;
  root.dataset['scheme'] = pick;
  root.dataset['ui'] = pick;
}

/**
 * Design lab (dev server only, Sumit 15 Nov): ?lab=<name> adds design-lab/<name>.css to this page,
 * so look variants can be compared on the real pages. The folder is git-ignored and never built.
 */
function devLab(): void {
  if (!import.meta.env.DEV) return;
  const name = new URLSearchParams(location.search).get('lab');
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `/design-lab/${name}.css`;
  document.head.append(link);
  document.documentElement.dataset['lab'] = name;
}

export function watchScheme(): void {
  devLab();
  apply(stored());
  // A choice made in another tab of this site.
  addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) {
      apply(stored());
      document.dispatchEvent(new Event('planetes-scheme'));
    }
  });
}

/** "Appearance: Dark · Light", the current choice pressed; labels come from the copy deck. */
export function schemeChoice(labels: { group: string; dark: string; light: string }): HTMLElement {
  const buttons = (['dark', 'light'] as const).map((pick) => {
    const b = h(
      'button',
      { type: 'button', class: 'link-button', 'data-pick': pick },
      labels[pick],
    );
    b.addEventListener('click', () => {
      try {
        if (pick === 'dark') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pick);
      } catch {
        /* storage blocked: the choice still holds for this visit */
      }
      apply(pick);
      document.dispatchEvent(new Event('planetes-scheme'));
    });
    return b;
  });
  const mark = () => {
    const now = document.documentElement.dataset['scheme'] === 'light' ? 'light' : 'dark';
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset['pick'] === now));
  };
  mark();
  document.addEventListener('planetes-scheme', mark);
  return h(
    'p',
    { class: 'scheme-choice', role: 'group', 'aria-label': labels.group },
    `${labels.group}: `,
    buttons[0] ?? '',
    ' · ',
    buttons[1] ?? '',
  );
}
