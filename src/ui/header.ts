/**
 * The header of the text pages (tests, field guide, loop, credits): the same brand row as the
 * app's (header.css) at the same place and size, then links to the other pages, the current one
 * marked (Sumit, 15 Nov: the name and icon kept moving between pages).
 */
import { copy } from '../copy/en';
import { h } from './dom';
import { markSvg } from './mark';

export type SitePage = 'tests' | 'fieldguide' | 'loop' | 'credits';

const LINKS: [SitePage, string][] = [
  ['tests', 'tests.html'],
  ['fieldguide', 'fieldguide.html'],
  ['loop', 'loop.html'],
  ['credits', 'credits.html'],
];

export function siteHeader(current: SitePage): HTMLElement {
  const home = h(
    'a',
    { class: 'home', href: './', 'aria-label': copy.nav.backToSky, title: copy.nav.backToSky },
    h('span', { class: 'home-back', 'aria-hidden': 'true' }, '‹'),
    markSvg(),
    h('span', { class: 'home-name' }, 'Planetes'),
    h('span', { class: 'home-tagline' }, copy.nav.tagline),
  );
  // Back to where the visitor came from, when that's this site's sky (as the old back links did).
  home.addEventListener('click', (e) => {
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.origin === location.origin && !/\.html$/.test(from.pathname)) {
        e.preventDefault();
        history.back();
      }
    } catch {
      /* a plain link then */
    }
  });
  return h(
    'header',
    { class: 'top site-top' },
    h('div', { class: 'wordmark' }, home),
    h(
      'nav',
      { class: 'site-nav', 'aria-label': copy.nav.pagesLabel },
      ...LINKS.map(([id, href]) =>
        h('a', { href, ...(id === current ? { 'aria-current': 'page' } : {}) }, copy.nav.pages[id]),
      ),
    ),
  );
}
