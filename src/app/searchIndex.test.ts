import { describe, expect, it } from 'vitest';
import { nearby, normalise, placeAt, search, type Entry } from './searchIndex';

const E = (
  id: string,
  name: string,
  kind: Entry['kind'],
  ra: number,
  dec: number,
  extra: Partial<Entry> = {},
): Entry => ({
  id,
  name,
  names: [name, ...(extra.names ?? [])],
  kind,
  at: { ra, dec },
  ...(extra.mag !== undefined ? { mag: extra.mag } : {}),
});

const INDEX: Entry[] = [
  E('barnard', "Barnard's Star", 'test', 269.45, 4.77, { names: ['GJ 699', 'Barnard'] }),
  E('epsind-b', 'ε Indi B', 'test', 331.1, -56.8, { names: ['Epsilon Indi B', 'eps Ind B'] }),
  E('w0855', 'WISE 0855', 'test', 133.76, -7.24),
  E('betelgeuse', 'Betelgeuse', 'star', 88.79, 7.41, { mag: 0.5 }),
  E('bellatrix', 'Bellatrix', 'star', 81.28, 6.35, { mag: 1.6 }),
  E('rasalhague', 'Rasalhague', 'star', 263.73, 12.56, { mag: 2.1 }),
  E('cebalrai', 'Cebalrai', 'star', 265.87, 4.57, { mag: 2.8 }),
  E('orion', 'Orion', 'constellation', 83, 5),
  E('mira', 'Mira', 'surprise', 34.84, -2.98),
];

const names = (q: string) => search(INDEX, q).map((m) => m.entry.name);

describe('search as you type', () => {
  it('normalises accents, case, Greek letters and their abbreviations, and punctuation', () => {
    expect(normalise('  Barnard’s  STAR ')).toBe('barnards star');
    expect(normalise('ε Indi B')).toBe('epsilon indi b');
    expect(normalise('eps Ind B')).toBe('epsilon ind b');
    expect(normalise('α Cen')).toBe(normalise('alpha Cen'));
    expect(normalise('alf Cen')).toBe('alpha cen');
    expect(normalise('Proxima-Cen')).toBe('proxima cen');
  });
  it('ranks exact, then prefix, with the five first among equals', () => {
    expect(names('b')[0]).toBe("Barnard's Star");
    expect(names('bel')).toEqual(['Bellatrix']);
    expect(names('be').slice(0, 2)).toEqual(['Betelgeuse', 'Bellatrix']); // brighter first
  });
  it('matches word starts and aliases, one result per object', () => {
    expect(names('eps ind')).toEqual(['ε Indi B']);
    expect(names('epsilon indi b')).toEqual(['ε Indi B']);
    expect(names('gj 69')).toEqual(["Barnard's Star"]);
    expect(names('barn st')).toEqual(["Barnard's Star"]);
  });
  it('forgives one typo from four letters on, but ranks it low', () => {
    expect(names('betelguese')).toEqual(['Betelgeuse']);
    expect(names('barnrd')).toEqual(["Barnard's Star"]);
    expect(names('bxx')).toEqual([]);
  });
  it('finds substrings from three letters', () => {
    expect(names('salha')).toEqual(['Rasalhague']);
    expect(names('lla')).toEqual([]); // under four letters, only starts count
  });
  it('lists what is near a position, nearest first, the five winning ties', () => {
    const near = nearby(INDEX, { ra: 269.0, dec: 5.0 }, 10);
    expect(near.map((n) => n.entry.id)).toEqual(['barnard', 'cebalrai', 'rasalhague']);
    expect(nearby(INDEX, { ra: 269.0, dec: 5.0 }, 10, 3, 'barnard').map((n) => n.entry.id)).toEqual(
      ['cebalrai', 'rasalhague'],
    );
  });
  it('moves a J2000 place by its proper motion', () => {
    // Barnard's Star from SIMBAD (J2000) to 2026: about 4.5′ north.
    const p = placeAt(
      { ra: 269.4520769586187, dec: 4.69336496657667 },
      -801.551,
      10362.394,
      2000,
      2026,
    );
    expect((p.dec - 4.69336496657667) * 60).toBeCloseTo(4.49, 2);
    expect(p.ra).toBeLessThan(269.4520769586187);
  });
});
