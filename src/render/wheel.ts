/**
 * A wheel event's movement in CSS pixels. Chrome and Safari report pixels; Firefox with a
 * mouse wheel reports lines (deltaMode 1), and some setups report pages (deltaMode 2). Left
 * as lines, a notch would zoom about sixteen times less in Firefox.
 */

const LINE_PX = 16;

export function wheelPixels(
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  pagePx: number,
): { dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? Math.max(1, pagePx) : 1;
  return { dx: e.deltaX * unit, dy: e.deltaY * unit };
}
