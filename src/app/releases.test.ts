import { describe, expect, it } from 'vitest';
import { framesReleases } from './targets';

describe('framesReleases', () => {
  it('names only the releases the frames come from', () => {
    expect(framesReleases([60801, 61000, 61174.29])).toEqual(['DR1']);
    expect(framesReleases([60903, 61269])).toEqual(['DR1', 'QR3']);
  });
});
