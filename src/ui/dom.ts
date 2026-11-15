type Attrs = Record<string, string | number | boolean | undefined>;

/** Creates an element with attributes and children; strings become text nodes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children)
    if (c !== null && c !== undefined) el.append(typeof c === 'string' ? text(c) : c);
  return el;
}

/**
 * Numbers as data (Sumit and Viewer, 15 Nov): a true minus sign before a number ("−7.2", not
 * "-7.2"), and an uncertainty ("± 1.5″") in the quiet tone so a value reads as one value with
 * its error. Applied to every string the page builds.
 */
export function minus(s: string): string {
  return s.replace(/(^|[\s([:=≈~])-(?=\.?\d)/g, '$1−');
}
/**
 * "± x″" as span.unc (quieter), and "RA … , Dec …" as span.coords, which keeps the sans font's
 * slashed zero (prose takes a plain zero: tokens.css, Sumit 15 Nov).
 */
const MARKED =
  /(±\s?[\d.,]+\s?(?:″|"|′|px|%|mag|µm|°)?|RA [\dh m s.°]+, Dec [−+]?[\d°′″. ]+[\d°′″])/;
function text(s: string): Node {
  const t = minus(s);
  if (!t.includes('±') && !t.includes('RA ')) return document.createTextNode(t);
  const f = document.createDocumentFragment();
  for (const part of t.split(MARKED)) {
    if (!part) continue;
    const cls = part.startsWith('±') ? 'unc' : MARKED.test(part) ? 'coords' : '';
    if (cls) {
      const u = document.createElement('span');
      u.className = cls;
      u.textContent = part;
      f.append(u);
    } else f.append(document.createTextNode(part));
  }
  return f;
}

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
