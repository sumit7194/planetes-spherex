/**
 * The lens of the liquid glass (13 Nov), Chromium only: the only engine that applies an SVG
 * filter inside backdrop-filter (Safari and Firefox accept the syntax, then draw nothing, so
 * @supports can't decide). Elsewhere the glass is blur, tint and rim alone (glass.css).
 *
 * Each glass control gets a displacement map the size of its own box: flat in the middle, and
 * across a rim band (the bezel) the sky is bent inward along the edge's normal, more steeply
 * near the edge, the way a thick convex rim refracts. Rebuilt when the control changes size.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const BEZEL = 12; // px of rim that bends
const BEND = 10; // px the sky moves at the very edge

const chromium = (): boolean => {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } })
    .userAgentData?.brands;
  return !!brands?.some((b) => /Chromium/.test(b.brand));
};

let defs: SVGDefsElement | null = null;
let count = 0;
const sizes = new WeakMap<Element, string>();
const resize = new ResizeObserver((entries) => {
  for (const e of entries) build(e.target as HTMLElement);
});

/** Gives every `.glass` element under `root` a lens, if the browser can draw one. */
export function lensGlass(root: ParentNode = document): void {
  if (!chromium()) return;
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  if (!defs) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.append(defs);
    document.body.append(svg);
  }
  for (const el of root.querySelectorAll<HTMLElement>('.glass:not([data-lens])')) {
    el.dataset['lens'] = `glass-lens-${++count}`;
    resize.observe(el);
  }
}

function build(el: HTMLElement): void {
  const w = Math.round(el.offsetWidth);
  const hgt = Math.round(el.offsetHeight);
  const id = el.dataset['lens'];
  if (!defs || !id || w < 4 || hgt < 4 || sizes.get(el) === `${w}x${hgt}`) return;
  sizes.set(el, `${w}x${hgt}`);
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, hgt / 2);
  const map = displacementMap(w, hgt, r);
  let filter = defs.querySelector<SVGFilterElement>(`#${id}`);
  if (!filter) {
    filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = id;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    const img = document.createElementNS(SVG_NS, 'feImage');
    img.setAttribute('result', 'map');
    img.setAttribute('preserveAspectRatio', 'none');
    const disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    disp.setAttribute('scale', String(BEND * 2));
    filter.append(img, disp);
    defs.append(filter);
    el.style.setProperty('--glass-lens', `url(#${id})`);
  }
  for (const node of [filter, filter.querySelector('feImage')]) {
    node?.setAttribute('x', '0');
    node?.setAttribute('y', '0');
    node?.setAttribute('width', String(w));
    node?.setAttribute('height', String(hgt));
  }
  filter.querySelector('feImage')?.setAttribute('href', map);
}

/**
 * Red and green carry x and y displacement around mid-grey (128 = none). Inside the bezel the
 * pixel samples from further in along the inward normal of the rounded box, by (1 − d/BEZEL)²:
 * zero where the bezel starts, the full bend at the edge.
 */
function displacementMap(w: number, hgt: number, r: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, hgt);
  const hx = w / 2 - r;
  const hy = hgt / 2 - r;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - hgt / 2;
      const qx = Math.abs(px) - hx;
      const qy = Math.abs(py) - hy;
      // Distance in from the edge of the rounded box, and the inward normal there.
      let depth: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        depth = r - len;
        nx = (-qx / len) * Math.sign(px);
        ny = (-qy / len) * Math.sign(py);
      } else if (qx > qy) {
        depth = r - qx;
        nx = -Math.sign(px);
        ny = 0;
      } else {
        depth = r - qy;
        nx = 0;
        ny = -Math.sign(py);
      }
      const t = depth < BEZEL ? (1 - Math.max(depth, 0) / BEZEL) ** 2 : 0;
      const i = (y * w + x) * 4;
      img.data[i] = 128 + Math.round(nx * t * 127);
      img.data[i + 1] = 128 + Math.round(ny * t * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}
