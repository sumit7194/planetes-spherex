/**
 * The Planetes mark (Sumit's pick, 15 Nov): a lens ring drawn in SPHEREx's own wavelength colours,
 * 0.75 µm (cream) round to 5 µm (teal), the app's same-colour scale (src/ui/figures.ts), with one
 * star in two places inside: faint where SPHEREx first saw it, ember where it saw it next. On hover
 * it flicks between the two like a blink comparator, the device that found Pluto in the first search for a Planet X.
 */

const SVG = `
<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <g class="mark-ring" fill="none">
  <path class="mark-band" d="M16.00 3.70A12.3 12.3 0 0 1 18.26 3.91" stroke="#f7f4c8" />
  <path class="mark-band" d="M18.14 3.89A12.3 12.3 0 0 1 20.33 4.49" stroke="#f2f3c2" />
  <path class="mark-band" d="M20.21 4.44A12.3 12.3 0 0 1 22.26 5.41" stroke="#eef1bd" />
  <path class="mark-band" d="M22.15 5.35A12.3 12.3 0 0 1 24.00 6.66" stroke="#e9f0b7" />
  <path class="mark-band" d="M23.91 6.58A12.3 12.3 0 0 1 25.50 8.19" stroke="#e4efb1" />
  <path class="mark-band" d="M25.42 8.09A12.3 12.3 0 0 1 26.72 9.96" stroke="#e0edab" />
  <path class="mark-band" d="M26.65 9.85A12.3 12.3 0 0 1 27.60 11.91" stroke="#dbeca6" />
  <path class="mark-band" d="M27.56 11.79A12.3 12.3 0 0 1 28.13 13.99" stroke="#d6eaa0" />
  <path class="mark-band" d="M28.11 13.86A12.3 12.3 0 0 1 28.30 16.13" stroke="#d2e99a" />
  <path class="mark-band" d="M28.30 16.00A12.3 12.3 0 0 1 28.09 18.26" stroke="#cce795" />
  <path class="mark-band" d="M28.11 18.14A12.3 12.3 0 0 1 27.51 20.33" stroke="#c6e593" />
  <path class="mark-band" d="M27.56 20.21A12.3 12.3 0 0 1 26.59 22.26" stroke="#c0e390" />
  <path class="mark-band" d="M26.65 22.15A12.3 12.3 0 0 1 25.34 24.00" stroke="#b9e18e" />
  <path class="mark-band" d="M25.42 23.91A12.3 12.3 0 0 1 23.81 25.50" stroke="#b3de8b" />
  <path class="mark-band" d="M23.91 25.42A12.3 12.3 0 0 1 22.04 26.72" stroke="#acdc89" />
  <path class="mark-band" d="M22.15 26.65A12.3 12.3 0 0 1 20.09 27.60" stroke="#a6da86" />
  <path class="mark-band" d="M20.21 27.56A12.3 12.3 0 0 1 18.01 28.13" stroke="#a0d784" />
  <path class="mark-band" d="M18.14 28.11A12.3 12.3 0 0 1 15.87 28.30" stroke="#99d581" />
  <path class="mark-band" d="M16.00 28.30A12.3 12.3 0 0 1 13.74 28.09" stroke="#92d280" />
  <path class="mark-band" d="M13.86 28.11A12.3 12.3 0 0 1 11.67 27.51" stroke="#8bcf81" />
  <path class="mark-band" d="M11.79 27.56A12.3 12.3 0 0 1 9.74 26.59" stroke="#84cc82" />
  <path class="mark-band" d="M9.85 26.65A12.3 12.3 0 0 1 8.00 25.34" stroke="#7dc983" />
  <path class="mark-band" d="M8.09 25.42A12.3 12.3 0 0 1 6.50 23.81" stroke="#76c684" />
  <path class="mark-band" d="M6.58 23.91A12.3 12.3 0 0 1 5.28 22.04" stroke="#6fc285" />
  <path class="mark-band" d="M5.35 22.15A12.3 12.3 0 0 1 4.40 20.09" stroke="#68bf86" />
  <path class="mark-band" d="M4.44 20.21A12.3 12.3 0 0 1 3.87 18.01" stroke="#61bc87" />
  <path class="mark-band" d="M3.89 18.14A12.3 12.3 0 0 1 3.70 15.87" stroke="#5ab988" />
  <path class="mark-band" d="M3.70 16.00A12.3 12.3 0 0 1 3.91 13.74" stroke="#54b588" />
  <path class="mark-band" d="M3.89 13.86A12.3 12.3 0 0 1 4.49 11.67" stroke="#4fb189" />
  <path class="mark-band" d="M4.44 11.79A12.3 12.3 0 0 1 5.41 9.74" stroke="#4aad89" />
  <path class="mark-band" d="M5.35 9.85A12.3 12.3 0 0 1 6.66 8.00" stroke="#45a98a" />
  <path class="mark-band" d="M6.58 8.09A12.3 12.3 0 0 1 8.19 6.50" stroke="#40a68a" />
  <path class="mark-band" d="M8.09 6.58A12.3 12.3 0 0 1 9.96 5.28" stroke="#3ba28b" />
  <path class="mark-band" d="M9.85 5.35A12.3 12.3 0 0 1 11.91 4.40" stroke="#369e8b" />
  <path class="mark-band" d="M11.79 4.44A12.3 12.3 0 0 1 13.99 3.87" stroke="#319a8c" />
  <path class="mark-band" d="M13.86 3.89A12.3 12.3 0 0 1 16.13 3.70" stroke="#2c968c" />
  </g>
  <circle class="mark-then" cx="11.6" cy="19.6" r="2.2" />
  <circle class="mark-now" cx="20" cy="12.6" r="3.3" />
</svg>`;

export function markSvg(): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = SVG.trim();
  return t.content.firstElementChild as SVGSVGElement;
}
