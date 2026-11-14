/** Plain-language numbers for the public: every value from a measurement, never hand-typed. */

import type { Measurement } from '../data/pack/types';

const ARCSEC_PER_RAD = 206_265;

/**
 * A number to fixed decimals, rounded half up as people expect. toFixed(2) gives 0.04 for
 * 0.045, because 0.045 is stored as 0.04499…; Physics' checker caught it on WISE 0855.
 */
export function fixed(x: number, decimals = 2): string {
  const k = 10 ** decimals;
  return (Math.sign(x) * (Math.round(Math.abs(x) * k + 1e-6) / k)).toFixed(decimals);
}

/**
 * The whole number of arcseconds printed for a move: the measured value alone, rounded
 * (Physics, 29 Oct). A "6 to 7" bracket read as the uncertainty; the number line beside it
 * carries the real error, and the prediction sits on its own.
 */
export function arcsecAbout(measured: number): number {
  return Math.round(measured);
}

/** "about 6 arcseconds", from the measured value. */
export function arcsecAboutText(measured: number): string {
  return `about ${arcsecAbout(measured)} arcseconds`;
}

/**
 * The coin analogy, by Physics' rule (29 Oct): the distance at which a 2 cm coin spans the
 * midpoint of the printed range, rounded to the nearest 50 m, so the coin's own angle always
 * falls inside the range printed beside it. Throws if it ever wouldn't.
 */
export function coinDistanceMetres(printedLo: number, printedHi: number): number {
  // "About 6" (one whole number printed) honestly means 6 ± 0.5.
  const [lo, hi] =
    printedLo === printedHi ? [printedLo - 0.5, printedHi + 0.5] : [printedLo, printedHi];
  const mid = (lo + hi) / 2;
  const metres = Math.round(0.02 / (mid / ARCSEC_PER_RAD) / 50) * 50;
  const angle = (0.02 / metres) * ARCSEC_PER_RAD;
  if (angle < lo || angle > hi)
    throw new Error(`coin at ${metres} m is ${angle}″, outside ${lo}–${hi}″`);
  return metres;
}

/** "1.10 ± 0.05" with two decimals; never called for a null value. */
export function withError(m: Measurement): string {
  if (m.value === null) throw new Error(`${m.key} has no value (${m.status})`);
  return m.error === undefined
    ? m.value.toFixed(2)
    : `${m.value.toFixed(2)} ± ${m.error.toFixed(2)}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "September 2025" from a Modified Julian Date. */
/** "12 March 2026" for an MJD. */
export function dayMonthYear(mjd: number): string {
  const d = new Date(Date.UTC(1858, 10, 17) + mjd * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Hours and minutes in UTC, e.g. "05:31". */
export function utcTime(mjd: number): string {
  const d = new Date(Date.UTC(1858, 10, 17) + mjd * 86_400_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export function monthYear(mjd: number): string {
  const d = new Date(Date.UTC(1858, 10, 17) + mjd * 86_400_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
