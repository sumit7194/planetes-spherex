import { describe, expect, it } from 'vitest';

import { parseTab, pickTab, tabAfterKey, type PanelTab } from './tabs';

const ORDER: PanelTab[] = ['compare', 'watch', 'facts', 'spectrum'];

describe('panel tabs', () => {
  it('reads only known tab names from the URL', () => {
    expect(parseTab('facts')).toBe('facts');
    expect(parseTab('nope')).toBeNull();
    expect(parseTab(null)).toBeNull();
  });

  it('moves like a standard tablist: arrows wrap, Home and End jump, other keys do nothing', () => {
    expect(tabAfterKey(ORDER, 'compare', 'ArrowRight')).toBe('watch');
    expect(tabAfterKey(ORDER, 'spectrum', 'ArrowRight')).toBe('compare');
    expect(tabAfterKey(ORDER, 'compare', 'ArrowLeft')).toBe('spectrum');
    expect(tabAfterKey(ORDER, 'facts', 'Home')).toBe('compare');
    expect(tabAfterKey(ORDER, 'watch', 'End')).toBe('spectrum');
    expect(tabAfterKey(ORDER, 'watch', 'a')).toBeNull();
  });

  it('falls back to the first tab when the page lacks the one asked for', () => {
    expect(pickTab(ORDER, 'facts')).toBe('facts');
    expect(pickTab(['compare', 'facts'], 'watch')).toBe('compare');
    expect(pickTab(['facts', 'spectrum'], null)).toBe('facts');
    expect(parseTab('series')).toBeNull();
  });
});
