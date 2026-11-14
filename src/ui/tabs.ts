/**
 * The words column as a fixed summary plus tabs (Sumit's pick, 14 Nov: option A of
 * notes/design/side-panel.html). The summary always shows what this place is and what was or
 * wasn't measured; the tabs hold what a visitor does with it, each sized to fit the column, so
 * the column never scrolls.
 *
 * Keyboard: the standard tablist pattern. ← → Home End move between tabs only while a tab has
 * focus (← → elsewhere already step photos and guesses); Enter/Space are native button clicks.
 */
import { h } from './dom';

export type PanelTab = 'compare' | 'watch' | 'facts' | 'spectrum' | 'series' | 'coadds';

export const PANEL_TABS: readonly PanelTab[] = [
  'compare',
  'watch',
  'facts',
  'spectrum',
  'series',
  'coadds',
];

/** A tab name from the URL, or null when it isn't one. */
export function parseTab(s: string | null): PanelTab | null {
  return s && (PANEL_TABS as readonly string[]).includes(s) ? (s as PanelTab) : null;
}

/** Where a tablist key moves focus: ← → wrap around, Home and End jump; null for other keys. */
export function tabAfterKey(
  order: readonly PanelTab[],
  at: PanelTab,
  key: string,
): PanelTab | null {
  const i = order.indexOf(at);
  if (i < 0 || !order.length) return null;
  if (key === 'ArrowRight') return order[(i + 1) % order.length] ?? null;
  if (key === 'ArrowLeft') return order[(i - 1 + order.length) % order.length] ?? null;
  if (key === 'Home') return order[0] ?? null;
  if (key === 'End') return order[order.length - 1] ?? null;
  return null;
}

/** The tab to show: the one asked for if this page has it, else the page's first. */
export function pickTab(order: readonly PanelTab[], wanted: PanelTab | null | undefined): PanelTab {
  return wanted && order.includes(wanted) ? wanted : (order[0] ?? 'compare');
}

export interface TabSpec {
  id: PanelTab;
  label: string;
  /** One line under the tab row: what to do here. */
  hint: string;
  content: (Node | null)[];
  /** A small count or word after the label (e.g. the number of photos). */
  badge?: string | null;
  /** A quiet dot: something new here the visitor hasn't opened yet. */
  cue?: boolean;
}

let focusAfterRender: PanelTab | null = null;

/**
 * Builds [summary, tabs] for the words column. `onSelect` stores the choice and re-renders;
 * after a keyboard move the new tab gets focus once it is back in the page.
 */
export function tabbedPanel(opts: {
  summary: (Node | null)[];
  tabs: TabSpec[];
  active: PanelTab;
  label: string;
  onSelect: (tab: PanelTab) => void;
}): HTMLElement[] {
  const order = opts.tabs.map((t) => t.id);
  const active = pickTab(order, opts.active);
  const list = h('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': opts.label });
  for (const t of opts.tabs) {
    const on = t.id === active;
    const b = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${t.id}`,
        'aria-selected': String(on),
        'aria-controls': `tabpanel-${t.id}`,
        tabindex: on ? 0 : -1,
        'data-tab': t.id,
        class: t.cue && !on ? 'cue' : undefined,
      },
      h('span', {}, t.label),
      t.badge ? h('small', { class: 'badge' }, t.badge) : null,
    );
    b.addEventListener('click', () => {
      if (!on) opts.onSelect(t.id);
    });
    list.append(b);
  }
  list.addEventListener('keydown', (e) => {
    const at = (document.activeElement as HTMLElement | null)?.dataset['tab'] as
      PanelTab | undefined;
    if (!at) return;
    const next = tabAfterKey(order, at, e.key);
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    focusAfterRender = next;
    opts.onSelect(next);
  });
  const tab = opts.tabs.find((t) => t.id === active);
  const panel = h(
    'div',
    {
      class: `panel-body tab-${active}`,
      role: 'tabpanel',
      id: `tabpanel-${active}`,
      'aria-labelledby': `tab-${active}`,
    },
    tab?.hint ? h('p', { class: 'tab-hint' }, tab.hint) : null,
    ...(tab?.content ?? []),
  );
  if (focusAfterRender) {
    const want = focusAfterRender;
    focusAfterRender = null;
    requestAnimationFrame(() =>
      (list.querySelector(`[data-tab="${want}"]`) as HTMLElement | null)?.focus(),
    );
  }
  return [
    h('div', { class: 'panel-summary' }, ...opts.summary),
    h('div', { class: 'panel-tabbed' }, list, panel),
  ];
}
