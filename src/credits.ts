/**
 * The credits page: what's on screen and where it comes from, as a table; who made the
 * measurements, the research layer and the viewer, as short cards with their full records
 * folded; the archives' acknowledgements verbatim in small type; the dates as a footer.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/header.css';
import './styles/credits.css';
import './styles/mark.css';
import { copy } from './copy/en';
import { h } from './ui/dom';
import { siteHeader } from './ui/header';
import { watchScheme } from './ui/scheme';

watchScheme();
document.body.prepend(siteHeader('credits'));

const c = copy.credits;
const root = document.getElementById('credits') as HTMLElement;

const table = h(
  'table',
  { class: 'sources' },
  h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { scope: 'col' }, c.columns.what),
      h('th', { scope: 'col' }, c.columns.source),
      h('th', { scope: 'col' }, c.columns.terms),
    ),
  ),
  h(
    'tbody',
    {},
    ...c.sources.map((s) =>
      h(
        'tr',
        {},
        h('th', { scope: 'row' }, s.what),
        h(
          'td',
          {},
          'link' in s && s.link ? h('a', { href: s.link, rel: 'noopener' }, s.source) : s.source,
        ),
        h('td', { class: 'terms' }, s.terms),
      ),
    ),
  ),
);

// Who made what: one line each, with the record folded behind it.
const makers = h(
  'dl',
  { class: 'makers' },
  ...c.makers.flatMap((m) => [
    h('dt', {}, m.role),
    h(
      'dd',
      {},
      h('span', { class: 'who' }, m.who),
      h('span', { class: 'when' }, m.when),
      h('span', { class: 'facts' }, m.facts.join(' · ')),
      m.record.length
        ? h('details', {}, h('summary', {}, c.recordLabel), ...m.record.map((r) => h('p', {}, r)))
        : null,
    ),
  ]),
);

root.append(
  h('h1', {}, c.title),
  h('p', { class: 'lede' }, c.lede),
  table,
  h('h2', {}, c.makersHeading),
  h('p', { class: 'byline' }, c.byline, ' ', h('a', { href: c.repo.href }, c.repo.text)),
  makers,
  h('p', { class: 'prior' }, h('a', { href: 'tests.html' }, copy.tests.link)),
  h('p', { class: 'prior' }, h('a', { href: 'detectors.html' }, copy.detectors.linkShort)),
  h(
    'section',
    { class: 'acks' },
    h('h2', {}, c.ackHeading),
    ...c.acknowledgements.map((a) => h('p', {}, a)),
  ),
  h('footer', {}, ...c.footer.map((f) => h('span', {}, f))),
);
