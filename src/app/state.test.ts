import { describe, expect, it } from 'vitest';
import { contractOf, initialState, transition, type ViewerEvent, type ViewerState } from './state';

const run = (events: ViewerEvent[], from: ViewerState = initialState) =>
  events.reduce(transition, from);
const here = { ra: 10, dec: 20 };

describe('curated show', () => {
  it('goes sky → diving → reveal → ready ⇄ holding', () => {
    const s = run([
      { type: 'tapLantern', target: 'barnard' },
      { type: 'packReady' },
      { type: 'revealDone' },
      { type: 'holdStart' },
    ]);
    expect(s.place).toEqual({ kind: 'holding', target: 'barnard' });
    expect(transition(s, { type: 'holdEnd' }).place.kind).toBe('ready');
  });

  it('does not allow holding before the reveal has finished', () => {
    const s = run([
      { type: 'tapLantern', target: 'barnard' },
      { type: 'packReady' },
      { type: 'holdStart' },
    ]);
    expect(s.place.kind).toBe('reveal');
  });
});

describe('live look', () => {
  it('fills, then becomes a look only when both seasons are in', () => {
    const filling = run([
      { type: 'goTo', at: here },
      { type: 'indexReady', planned: 12 },
      { type: 'frameIn' },
    ]);
    expect(filling.place).toMatchObject({ kind: 'filling', shown: 1, planned: 12 });
    expect(transition(filling, { type: 'holdStart' })).toBe(filling);
    const look = transition(filling, { type: 'seasonsIn', total: 188 });
    expect(look.place).toMatchObject({ kind: 'look', total: 188 });
  });

  it('never counts more frames than planned', () => {
    const s = run([
      { type: 'goTo', at: here },
      { type: 'indexReady', planned: 1 },
      { type: 'frameIn' },
      { type: 'frameIn' },
    ]);
    expect(s.place).toMatchObject({ shown: 1 });
  });

  it('keeps the position when trouble happens', () => {
    const s = run([
      { type: 'goTo', at: here },
      { type: 'trouble', reason: 'slow' },
    ]);
    expect(s.place).toEqual({ kind: 'trouble', reason: 'slow', at: here });
  });
});

describe('the colour is the contract', () => {
  it('marks curated places as a show and live places as a look', () => {
    expect(contractOf({ kind: 'reveal', target: 'w0855' })).toBe('show');
    expect(contractOf({ kind: 'filling', at: here, shown: 0, planned: 12 })).toBe('look');
    expect(contractOf({ kind: 'sky' })).toBe('none');
  });
});

describe('room and entry', () => {
  it('changes the room without leaving the place, and backToSky resets to play', () => {
    const s = run([
      { type: 'tapLantern', target: 'barnard' },
      { type: 'setRoom', room: 'watch' },
    ]);
    expect(s.place.kind).toBe('diving');
    expect(s.room).toBe('watch');
    expect(transition(s, { type: 'backToSky' })).toMatchObject({
      place: { kind: 'sky' },
      room: 'play',
    });
  });
});
