/**
 * The search field's dropdown (ARIA combobox 1.2, list autocomplete; agreed with Viewer, 14 Nov).
 * The field keeps focus; ↑ ↓ move the active option (aria-activedescendant), Enter chooses it
 * (or the first one), Esc closes the list, a second Esc clears the field, Tab leaves. Resting
 * the mouse on an option makes it the active one too (Sumit, 14 Nov), after a short pause and
 * only on real pointer movement, so a pointer passing over (or the list scrolling under a still
 * one) doesn't swing the sky. One highlight glides between options, for keys, mouse and typing.
 * Options are rendered on every keystroke; the screen-reader count is debounced so it doesn't
 * chatter.
 */
import { h } from './dom';

export interface ComboOption {
  id: string;
  label: string;
  /** A word for what it is ("challenge test", "star", "SIMBAD"…). */
  tag?: string;
  /** One quiet line under the label: what Enter does, or where it is. */
  meta?: string;
  /** A heading shown above this option when it starts a new group ("Near here"). */
  group?: string;
  /** A row that says something but can't be chosen ("looking up…", "can't read that"). */
  note?: boolean;
}

export interface Combobox {
  /** The field and its list, to place on the page together. */
  el: HTMLElement;
  setOptions(options: ComboOption[], footer?: string): void;
  /** The option Enter would choose now: the active one, else the first choosable. */
  current(): ComboOption | null;
  open(): void;
  close(): void;
}

let uid = 0;

export function combobox(
  input: HTMLInputElement,
  on: {
    /** Every edit (no debounce: the list must keep up with each key). */
    query: (q: string) => void;
    /** The option the sky should follow (active, else the first choosable), or null. */
    active: (o: ComboOption | null) => void;
    choose: (o: ComboOption | null) => void;
    status: (n: number) => string;
    labels: { field: string; list: string; hint: string };
  },
): Combobox {
  const listId = `search-list-${++uid}`;
  const list = h('ul', {
    class: 'combo-list',
    id: listId,
    role: 'listbox',
    'aria-label': on.labels.list,
  });
  const footerEl = h('p', { class: 'combo-footer', id: `${listId}-hint` });
  const pop = h('div', { class: 'combo-pop', hidden: true }, list, footerEl);
  const live = h('p', { class: 'visually-hidden', role: 'status' });
  // The field's description, always there (the footer hint shows only while the field is empty).
  const hint = h('p', { class: 'visually-hidden', id: `${listId}-desc` }, on.labels.hint);
  const el = h('div', { class: 'combo' }, input, pop, live, hint);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  // A short name; the long hint stays a description (Viewer: the title was its only name).
  input.setAttribute('aria-label', on.labels.field);
  input.setAttribute('aria-describedby', `${listId}-desc`);

  let options: ComboOption[] = [];
  let active = -1;
  let statusTimer = 0;
  let hoverTimer = 0;
  // The highlight: one element that slides to the option Enter would choose.
  const glide = h('li', { class: 'combo-glide', role: 'presentation', 'aria-hidden': 'true' });
  const choosable = () => options.filter((o) => !o.note);

  const current = (): ComboOption | null =>
    (active >= 0 ? options[active] : undefined) ?? choosable()[0] ?? null;

  function paint(scroll = true): void {
    const shown = current();
    let at: HTMLElement | null = null;
    for (const li of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const on = li.dataset['i'] === String(active);
      li.setAttribute('aria-selected', String(on));
      li.classList.toggle('active', on);
      if (on && scroll) li.scrollIntoView({ block: 'nearest' });
      if (shown && li.dataset['i'] === String(options.indexOf(shown))) at = li;
    }
    if (at) {
      glide.style.transform = `translateY(${at.offsetTop}px)`;
      glide.style.height = `${at.offsetHeight}px`;
    }
    glide.classList.toggle('on', !!at);
    glide.classList.toggle('chosen', active >= 0);
    const a = active >= 0 ? options[active] : undefined;
    if (a) input.setAttribute('aria-activedescendant', `${listId}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function setOptions(next: ComboOption[], footer = ''): void {
    // Keep the active option across a re-render when it's still there (a SIMBAD answer arriving
    // mustn't jump the keyboard), else fall back to none (the first is the default).
    const was = active >= 0 ? options[active]?.id : undefined;
    options = next;
    active = was ? options.findIndex((o) => o.id === was && !o.note) : -1;
    list.replaceChildren(
      glide,
      ...options.flatMap((o, i) => {
        const head =
          o.group && (i === 0 || options[i - 1]?.group !== o.group)
            ? [h('li', { class: 'combo-group', role: 'presentation' }, o.group)]
            : [];
        const li = h(
          'li',
          o.note
            ? { class: 'combo-note', role: 'presentation' }
            : {
                class: 'combo-opt',
                role: 'option',
                id: `${listId}-${i}`,
                'data-i': i,
                'aria-selected': 'false',
              },
          h(
            'span',
            { class: 'combo-label' },
            o.label,
            o.tag ? h('span', { class: 'combo-tag' }, o.tag) : null,
          ),
          o.meta ? h('span', { class: 'combo-meta' }, o.meta) : null,
        );
        if (!o.note) {
          // Mouse: choose on click; mousedown is held so the field keeps focus (and the list).
          li.addEventListener('mousedown', (e) => e.preventDefault());
          li.addEventListener('click', () => {
            active = i;
            on.choose(o);
          });
          // Resting the mouse here makes it the active option (only real movement counts).
          li.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse' || active === i) return;
            window.clearTimeout(hoverTimer);
            hoverTimer = window.setTimeout(() => {
              if (options[i] !== o) return;
              active = i;
              paint(false);
              on.active(current());
            }, 90);
          });
          li.addEventListener('pointerleave', () => window.clearTimeout(hoverTimer));
        }
        return [...head, li];
      }),
    );
    footerEl.textContent = footer;
    footerEl.hidden = !footer;
    paint();
    on.active(current());
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (live.textContent = on.status(choosable().length)), 500);
  }

  function open(): void {
    if (!options.length && !footerEl.textContent) return;
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close(): void {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function move(step: number): void {
    const ids = options.map((o, i) => (o.note ? -1 : i)).filter((i) => i >= 0);
    if (!ids.length) return;
    const at = ids.indexOf(active);
    active =
      ids[
        at < 0 ? (step > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, at + step))
      ] ?? -1;
    paint();
    on.active(current());
  }

  input.addEventListener('input', () => {
    active = -1;
    on.query(input.value);
    open();
  });
  input.addEventListener('focus', () => {
    on.query(input.value);
    open();
  });
  input.addEventListener('blur', () => close());
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (pop.hidden) open();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      on.choose(current());
    } else if (e.key === 'Escape') {
      if (!pop.hidden) {
        e.preventDefault();
        close();
      } else if (input.value) {
        e.preventDefault();
        input.value = '';
        active = -1;
        on.query('');
      }
    }
  });

  return { el, setOptions, current, open, close };
}
