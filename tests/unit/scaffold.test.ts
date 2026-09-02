import { describe, it, expect } from 'vitest';
import { TIERS, TIER_POINTS, defaultSettings } from '../../src/engine/types';

describe('scaffold', () => {
  it('declares four tiers in escalating order', () => {
    expect(TIERS).toEqual(['easy', 'moderate', 'hard', 'god']);
  });
  it('weights points by tier', () => {
    expect(TIERS.map((t) => TIER_POINTS[t])).toEqual([1, 2, 3, 4]);
  });
  it('defaults twists off - they are opt-in', () => {
    expect(defaultSettings().twists).toBe(false);
  });
});
