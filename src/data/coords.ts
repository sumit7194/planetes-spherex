/**
 * Sky positions typed by people: decimal degrees, sexagesimal with spaces or colons,
 * or unit letters (08h55m10.831s −07d14m42.53s). Typographic minus signs and
 * prime marks are accepted, because judges will paste the challenge page's own text.
 */

export interface SkyPosition {
  /** Right ascension in degrees, 0 ≤ ra < 360. */
  ra: number;
  /** Declination in degrees, −90 ≤ dec ≤ 90. */
  dec: number;
}

export type ParseResult = { ok: true; position: SkyPosition } | { ok: false; reason: string };

const MINUS = /[−‒–—﹣－]/g;
const PRIME = /[′’']/g;
const DOUBLE_PRIME = /[″”"]|''/g;

function normalise(input: string): string {
  return (
    input
      // "RA 8h 55m 11s, Dec −7° 14′ 43″" (the page's own readouts) reads as the numbers alone.
      .replace(/(^|[\s,(])(ra|dec|α|δ)\s*[:=]?(?=[\s\d+\-−])/gi, '$1 ')
      .replace(MINUS, '-')
      .replace(DOUBLE_PRIME, 's')
      .replace(PRIME, 'm')
      .replace(/[°º]/g, 'd')
      .replace(/,/g, ' ')
      .trim()
  );
}

/** Splits a normalised string into the RA part and the Dec part. */
function splitParts(s: string): [string, string] | null {
  // A sign always starts the declination when it follows something.
  const signed = s.match(/^(.*?\S)\s*([+-]\s*\d.*)$/);
  if (signed?.[1] && signed[2]) return [signed[1].trim(), signed[2].replace(/^([+-])\s+/, '$1')];

  const tokens = s.split(/\s+/);
  if (tokens.length === 2) return [tokens[0] ?? '', tokens[1] ?? ''];
  if (tokens.length === 6) return [tokens.slice(0, 3).join(' '), tokens.slice(3).join(' ')];
  return null;
}

/** Reads one sexagesimal or decimal component into [sign, a, b, c] with unit hints. */
function components(part: string): { sign: 1 | -1; values: number[]; hours: boolean } | null {
  let p = part.trim();
  let sign: 1 | -1 = 1;
  if (p.startsWith('-')) {
    sign = -1;
    p = p.slice(1);
  } else if (p.startsWith('+')) {
    p = p.slice(1);
  }
  const hours = /h/i.test(p);
  const values = p
    .split(/[\s:hdms]+/i)
    .filter((t) => t.length > 0)
    .map(Number);
  if (values.length === 0 || values.length > 3 || values.some((v) => !Number.isFinite(v))) {
    return null;
  }
  return { sign, values, hours };
}

function sexagesimal(values: number[]): number {
  const [a = 0, b = 0, c = 0] = values;
  return a + b / 60 + c / 3600;
}

export function parseSkyPosition(input: string): ParseResult {
  const s = normalise(input);
  if (s.length === 0) return { ok: false, reason: 'empty' };

  const parts = splitParts(s);
  if (!parts) return { ok: false, reason: 'expected a right ascension and a declination' };

  const raC = components(parts[0]);
  const decC = components(parts[1]);
  if (!raC || !decC) return { ok: false, reason: 'could not read the numbers' };

  // One bare number for RA means degrees; three parts mean hours unless marked otherwise.
  const raIsHours = raC.hours || raC.values.length > 1;
  let ra = sexagesimal(raC.values) * (raIsHours ? 15 : 1) * raC.sign;
  const dec = sexagesimal(decC.values) * decC.sign;

  if (raIsHours && sexagesimal(raC.values) >= 24)
    return { ok: false, reason: 'hours must be below 24' };
  if (Math.abs(dec) > 90) return { ok: false, reason: 'declination must be between −90 and +90' };
  ra = ((ra % 360) + 360) % 360;
  return { ok: true, position: { ra, dec } };
}

/** Great-circle separation in degrees (haversine; stable for small angles). */
export function separationDeg(a: SkyPosition, b: SkyPosition): number {
  const rad = Math.PI / 180;
  const dDec = (b.dec - a.dec) * rad;
  const dRa = (b.ra - a.ra) * rad;
  const h =
    Math.sin(dDec / 2) ** 2 +
    Math.cos(a.dec * rad) * Math.cos(b.dec * rad) * Math.sin(dRa / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / rad;
}

/**
 * A spot from a link: ?at=<ra>,<dec> in degrees, or ?ra=…&dec=…, each in degrees or
 * sexagesimal (the challenge suggests coordinates in the URL). Null when absent or unreadable.
 */
export function positionFromQuery(q: URLSearchParams): SkyPosition | null {
  const at = q.get('at');
  const ra = q.get('ra');
  const dec = q.get('dec');
  const text = at ? at.replace(',', ' ') : ra && dec ? `${ra}, ${dec}` : null;
  if (!text) return null;
  const r = parseSkyPosition(text);
  return r.ok ? r.position : null;
}

/* ---------- writing positions for people (the echo, the grid labels, the centre readout) ---------- */

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Right ascension in hours, rounded to `stepSec` seconds of time and written with only the
 * parts that step needs: 3600 → "9h", 60 → "8h 55m", 1 → "8h 55m 11s".
 */
export function raText(deg: number, stepSec = 1): string {
  const total = Math.round(((((deg % 360) + 360) % 360) * 240) / stepSec) * stepSec;
  const t = total % 86400;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (stepSec >= 3600) return `${h}h`;
  if (stepSec >= 60) return `${h}h ${pad2(m)}m`;
  return `${h}h ${pad2(m)}m ${pad2(s)}s`;
}

/**
 * Declination, rounded to `stepArcsec` and written with a true minus sign and prime marks:
 * 3600 → "−7°", 60 → "−7° 15′", 1 → "−7° 14′ 43″". The equator is "0°", never "+0°".
 */
export function decText(deg: number, stepArcsec = 1): string {
  const total = Math.round((Math.abs(deg) * 3600) / stepArcsec) * stepArcsec;
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sign = total === 0 ? '' : deg < 0 ? '−' : '+';
  if (stepArcsec >= 3600) return `${sign}${d}°`;
  if (stepArcsec >= 60) return `${sign}${d}° ${pad2(m)}′`;
  return `${sign}${d}° ${pad2(m)}′ ${pad2(s)}″`;
}

/** Decimal degrees with a true minus sign: "133.795°", "−7.245°". */
export function degText(deg: number, places = 3): string {
  const v = deg.toFixed(places);
  return `${v.startsWith('-') ? '−' : ''}${v.replace('-', '')}°`;
}

/** "RA 8h 55m 11s, Dec −7° 14′ 43″" at a precision that suits the view's width (degrees). */
export function positionText(p: SkyPosition, fovDeg = 0): string {
  const [ra, dec] =
    fovDeg > 35 ? [60, 3600] : fovDeg > 12 ? [60, 60] : fovDeg > 0 ? [10, 10] : [1, 1];
  return `RA ${raText(p.ra, ra)}, Dec ${decText(p.dec, dec)}`;
}
