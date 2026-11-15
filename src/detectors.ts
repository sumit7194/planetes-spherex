/**
 * "Detectors in progress" (detectors.html, Sumit 15 Nov): the research detectors, each with its
 * method, the test it faced and its numbers, what it hasn't shown, and when it was built. The
 * top disclosure is Physics'; no candidates, no counts of unknowns, no ember (nothing here was
 * measured by this tool: Viewer).
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/header.css';
import './styles/credits.css';
import './styles/mark.css';
import './styles/detectors.css';
import { copy } from './copy/en';
import { h } from './ui/dom';
import { siteHeader } from './ui/header';
import { v4Explorer } from './ui/v4explorer';
import { watchScheme } from './ui/scheme';

watchScheme();
document.body.prepend(siteHeader('detectors'));

const t = copy.detectors;
const root = document.getElementById('detectors') as HTMLElement;

type Card = (typeof t.cards)[number];

function card(c: Card): HTMLElement {
  const f = t.fields;
  const href = 'planHref' in c ? c.planHref : undefined;
  return h(
    'article',
    { class: 'dt-card', id: c.id },
    h('h2', {}, c.title),
    h(
      'dl',
      {},
      h('dt', {}, f.looks),
      h('dd', {}, c.looks),
      h('dt', {}, f.status),
      h('dd', {}, h('span', { class: 'dt-status' }, c.status)),
      h('dt', {}, f.test),
      h('dd', {}, ...c.test.map((x) => h('p', {}, x))),
      h('dt', {}, f.notShown),
      h('dd', {}, c.notShown),
      h('dt', {}, f.built),
      h('dd', {}, c.built),
      h('dt', {}, f.plan),
      h('dd', {}, href ? h('a', { href }, c.plan) : c.plan),
      ...('reproduce' in c
        ? [h('dt', {}, t.reproduce), h('dd', {}, h('code', {}, c.reproduce))]
        : []),
    ),
  );
}

root.append(
  h('h1', {}, t.title),
  h(
    'div',
    { class: 'dt-disclosure', role: 'note' },
    h('p', { class: 'dt-lead' }, t.disclosureLead),
    h('p', {}, t.disclosure),
  ),
  h('p', { class: 'dt-summary' }, t.summary),
  h('div', { class: 'dt-grid' }, ...t.cards.map(card)),
);
void v4Explorer().then((x) => root.append(x));
