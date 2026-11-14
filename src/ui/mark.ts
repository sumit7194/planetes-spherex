/**
 * The Planetes mark: a lens ring with one star in two places — faint where SPHEREx first saw
 * it, ember where it saw it next. On hover it flicks between the two like a blink
 * comparator, the device that found Pluto in the first search for a Planet X.
 */

const SVG = `
<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <circle class="mark-ring" cx="16" cy="16" r="12.5" />
  <path class="mark-trail" d="M11.6 19.6 Q 14 14.6 19.2 12.6" />
  <circle class="mark-then" cx="10.8" cy="20.4" r="2.1" />
  <circle class="mark-glow" cx="20.6" cy="12" r="5" />
  <circle class="mark-now" cx="20.6" cy="12" r="2.9" />
</svg>`;

export function markSvg(): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = SVG.trim();
  return t.content.firstElementChild as SVGSVGElement;
}
