/**
 * Long text, one rule everywhere (13 Nov). Text comes from the data, so any string can be longer
 * than its slot. Each slot has a line budget, set in one table below:
 *  - one line: cut with "…"; the full text shows on hover (title), and screen readers get it all;
 *  - several lines: clamped, with a "More" button that appears only when something is hidden.
 * Nothing is removed from the page: clamping is visual, so search and screen readers see all.
 */

const RULES: [selector: string, lines: number][] = [
  ['.words .status-line', 3],
  // Text rows only: a row of chips or buttons is never clamped, so no control can hide.
  ['.words .facts dd:not(:has(button, .chip, a))', 2],
  ['.card-text strong', 1],
];

let labels = { more: 'More', less: 'Less' };
export function fitLabels(more: string, less: string): void {
  labels = { more, less };
}

const watched = new Set<Element>();
const resize = new ResizeObserver((entries) => {
  for (const e of entries) check(e.target as HTMLElement);
});
let ids = 0;

/** Applies the line budgets under `root`, now and whenever a fitted element changes size. */
export function fitText(root: ParentNode = document): void {
  for (const el of watched) {
    if (!el.isConnected) {
      resize.unobserve(el);
      watched.delete(el);
    }
  }
  for (const [selector, lines] of RULES) {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      const fresh = !el.dataset['fit'];
      // A fitted element whose text was replaced in place lost its body: wrap it again.
      if (!fresh && (lines === 1 || el.querySelector(':scope > .fit-body'))) continue;
      el.dataset['fit'] = String(lines);
      if (lines > 1) {
        el.querySelector(':scope > .fit-more')?.remove();
        wrap(el, lines);
      }
      watched.add(el);
      resize.observe(el);
    }
  }
}

/** Moves the text into a clamped body, so a "More" button can follow it inside the same slot. */
function wrap(el: HTMLElement, lines: number): void {
  const body = document.createElement('span');
  body.className = 'fit-body';
  body.id = `fit-${++ids}`;
  body.style.setProperty('--fit-lines', String(lines));
  body.append(...el.childNodes);
  el.append(body);
}

function check(el: HTMLElement): void {
  if (el.dataset['fit'] === '1') {
    const cut = el.scrollWidth > el.clientWidth + 1;
    if (cut && !el.title) {
      el.title = el.textContent?.trim() ?? '';
      el.dataset['fitTitle'] = '';
    } else if (!cut && 'fitTitle' in el.dataset) {
      el.removeAttribute('title');
      delete el.dataset['fitTitle'];
    }
    return;
  }
  const body = el.querySelector<HTMLElement>(':scope > .fit-body');
  if (!body) return;
  let more = el.querySelector<HTMLButtonElement>(':scope > .fit-more');
  // Controls arrived after the first pass (chips, links): never clamp them out of reach.
  if (body.querySelector('button, a, .chip')) {
    body.classList.add('open');
    more?.remove();
    return;
  }
  const open = body.classList.contains('open');
  const hidden = !open && body.scrollHeight > body.clientHeight + 1;
  if (!hidden && !open) {
    more?.remove();
    return;
  }
  if (!more) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fit-more';
    btn.setAttribute('aria-controls', body.id);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const now = !body.classList.contains('open');
      body.classList.toggle('open', now);
      btn.setAttribute('aria-expanded', String(now));
      btn.textContent = now ? labels.less : labels.more;
    });
    el.append(btn);
    more = btn;
  }
  more.setAttribute('aria-expanded', String(open));
  more.textContent = open ? labels.less : labels.more;
}
