import { describe, expect, it } from 'vitest';
import { nextTier, p90 } from './quality';

const rules = { min: 0, max: 1, start: 1 };
const many = (n: number, ms: number) => Array.from({ length: n }, () => ms);

describe('measured quality tiers', () => {
  it('reads the slowest tenth of frames', () => {
    expect(p90([...many(90, 10), ...many(10, 40)])).toBe(40);
  });
  it('drops a tier when frames run slow for two seconds', () => {
    expect(nextTier(1, { slow: many(60, 30), calm: many(600, 30) }, 20_000, rules)).toBe(0);
  });
  it('raises one only after a long calm stretch', () => {
    expect(nextTier(0, { slow: many(60, 8), calm: many(600, 8) }, 20_000, rules)).toBe(1);
    expect(nextTier(0, { slow: many(60, 8), calm: many(100, 8) }, 20_000, rules)).toBe(0);
  });
  it('raises on a 60 Hz screen that keeps up (frames can never be under 16.7 ms there)', () => {
    const steady = [...many(540, 16.7), ...many(60, 18)];
    expect(nextTier(0, { slow: many(60, 16.7), calm: steady }, 20_000, rules)).toBe(1);
    const dropping = [...many(400, 16.7), ...many(200, 33.3)];
    expect(nextTier(0, { slow: many(60, 16.7), calm: dropping }, 20_000, rules)).toBe(0);
  });
  it('raises only with headroom when the drawing work is measured', () => {
    const steady = many(600, 16.7);
    expect(nextTier(0, { slow: steady, calm: steady, work: many(600, 4) }, 20_000, rules)).toBe(1);
    expect(nextTier(0, { slow: steady, calm: steady, work: many(600, 13) }, 20_000, rules)).toBe(0);
    // 9.3 ms + 3 ms for the 3D tier fits in 80% of 16.7 ms; 12 ms + 3 ms doesn't.
    const up = { min: 0, max: 2, start: 1 };
    expect(nextTier(1, { slow: steady, calm: steady, work: many(600, 9.3) }, 20_000, up)).toBe(2);
    expect(nextTier(1, { slow: steady, calm: steady, work: many(600, 12) }, 20_000, up)).toBe(1);
  });
  it("ignores the browser's occasional skipped frame when our work is light", () => {
    const noisy = [...many(540, 16.7), ...many(60, 33.4)];
    const up = { min: 0, max: 2, start: 1 };
    const w = { slow: noisy.slice(0, 120), calm: noisy, work: many(600, 5) };
    expect(nextTier(1, w, 20_000, up)).toBe(2);
    expect(nextTier(2, { ...w, work: many(600, 8) }, 20_000, up)).toBe(2);
  });
  it('drops when our drawing nears the budget, or most frames are missed', () => {
    const up = { min: 0, max: 2, start: 2 };
    const steady = many(600, 16.7);
    expect(nextTier(2, { slow: steady, calm: steady, work: many(600, 16) }, 20_000, up)).toBe(1);
    const missed = many(600, 33.4);
    expect(
      nextTier(2, { slow: missed, calm: missed, work: many(600, 6), refresh: 16.7 }, 20_000, up),
    ).toBe(1);
    // Below the 3D tier, missed frames with light work are the browser's: no drop.
    expect(
      nextTier(1, { slow: missed, calm: missed, work: many(600, 4), refresh: 16.7 }, 20_000, up),
    ).toBe(1);
    // A 30 Hz display (Safari in Low Power Mode) that keeps up isn't slow.
    expect(
      nextTier(2, { slow: missed, calm: missed, work: many(600, 6), refresh: 33.4 }, 20_000, up),
    ).toBe(2);
  });
  it('treats a 120 Hz display drawn at 60 fps as smooth enough', () => {
    const up = { min: 0, max: 2, start: 1 };
    const fast = many(600, 8.3);
    expect(
      nextTier(1, { slow: fast, calm: fast, work: many(600, 7), refresh: 8.3 }, 20_000, up),
    ).toBe(2);
  });
  it('changes at most once every ten seconds, and stays within bounds', () => {
    expect(nextTier(1, { slow: many(60, 30), calm: many(600, 30) }, 5_000, rules)).toBe(1);
    expect(nextTier(0, { slow: many(60, 30), calm: many(600, 30) }, 20_000, rules)).toBe(0);
    expect(nextTier(1, { slow: many(60, 8), calm: many(600, 8) }, 20_000, rules)).toBe(1);
  });
});
