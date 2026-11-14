/**
 * The viewer's flow as an explicit state machine, so impossible states can't happen
 * (no hold before both seasons are in, no arrow on a live spot).
 *
 *   sky ──tapLantern──▶ diving ──packReady──▶ reveal ──revealDone──▶ ready ⇄ holding
 *    │                                                               │
 *    └──tapSky / search──▶ finding ──indexReady──▶ filling ──seasonsIn──▶ look
 *
 * Learn is a room setting (the dial), not a separate place, so it lives in `room`; 'watch' is the
 * room state behind a five's page Watch tab (no longer in the dial).
 */

import type { SkyPosition } from '../data/coords';
import type { TargetId } from '../data/pack/types';

export type Room = 'play' | 'learn' | 'watch';
/** How the sky is shown: a globe, a flat map, or from inside it, looking out. */
export type Entry = 'flat' | 'inside';

export type Place =
  | { kind: 'sky' }
  | { kind: 'diving'; target: TargetId }
  | { kind: 'reveal'; target: TargetId }
  | { kind: 'ready'; target: TargetId }
  | { kind: 'holding'; target: TargetId }
  | { kind: 'finding'; at: SkyPosition }
  | { kind: 'filling'; at: SkyPosition; shown: number; planned: number }
  | { kind: 'look'; at: SkyPosition; shown: number; total: number }
  | { kind: 'trouble'; reason: Trouble; at?: SkyPosition };

export type Trouble = 'offline' | 'index-missing' | 'slow' | 'pack-missing' | 'photos-missing';

export interface ViewerState {
  place: Place;
  room: Room;
  entry: Entry;
}

export type ViewerEvent =
  | { type: 'tapLantern'; target: TargetId }
  | { type: 'packReady' }
  | { type: 'revealDone' }
  | { type: 'holdStart' }
  | { type: 'holdEnd' }
  | { type: 'goTo'; at: SkyPosition }
  | { type: 'indexReady'; planned: number }
  | { type: 'frameIn' }
  | { type: 'seasonsIn'; total: number }
  | { type: 'trouble'; reason: Trouble }
  | { type: 'backToSky' }
  | { type: 'setRoom'; room: Room }
  | { type: 'setEntry'; entry: Entry };

/** Look around is the first screen (Sumit, 29 Oct); the globe and flat map are one click away. */
export const initialState: ViewerState = { place: { kind: 'sky' }, room: 'play', entry: 'inside' };

/** Pure transition function. Unknown or impossible events leave the state unchanged. */
export function transition(state: ViewerState, event: ViewerEvent): ViewerState {
  const { place } = state;
  const at = (p: Place): ViewerState => ({ ...state, place: p });

  switch (event.type) {
    case 'setRoom':
      return { ...state, room: event.room };
    case 'setEntry':
      return { ...state, entry: event.entry };
    case 'backToSky':
      return { ...state, place: { kind: 'sky' }, room: 'play' };
    case 'trouble':
      return at({
        kind: 'trouble',
        reason: event.reason,
        ...('at' in place ? { at: place.at } : {}),
      });

    case 'tapLantern':
      return at({ kind: 'diving', target: event.target });
    case 'packReady':
      return place.kind === 'diving' ? at({ kind: 'reveal', target: place.target }) : state;
    case 'revealDone':
      return place.kind === 'reveal' ? at({ kind: 'ready', target: place.target }) : state;
    case 'holdStart':
      return place.kind === 'ready' ? at({ kind: 'holding', target: place.target }) : state;
    case 'holdEnd':
      return place.kind === 'holding' ? at({ kind: 'ready', target: place.target }) : state;

    case 'goTo':
      // Watch is a tab of one of the five's pages; a new look starts in Play.
      return {
        ...state,
        place: { kind: 'finding', at: event.at },
        room: state.room === 'watch' ? 'play' : state.room,
      };
    case 'indexReady':
      return place.kind === 'finding'
        ? at({ kind: 'filling', at: place.at, shown: 0, planned: event.planned })
        : state;
    case 'frameIn':
      return place.kind === 'filling'
        ? at({ ...place, shown: Math.min(place.shown + 1, place.planned) })
        : state;
    case 'seasonsIn':
      return place.kind === 'filling'
        ? at({ kind: 'look', at: place.at, shown: place.shown, total: event.total })
        : state;
  }
}

/** A measured show (gold) or an honest look (blue): "the colour is the contract". */
export function contractOf(place: Place): 'show' | 'look' | 'none' {
  switch (place.kind) {
    case 'diving':
    case 'reveal':
    case 'ready':
    case 'holding':
      return 'show';
    case 'finding':
    case 'filling':
    case 'look':
      return 'look';
    default:
      return 'none';
  }
}
