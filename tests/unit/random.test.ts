import { describe, it, expect } from 'vitest';
import { freshSeed, mulberry32, seededShuffle } from '../../src/engine/random';

describe('mulberry32', () => {
  it('returns an identical sequence across repeated construction', () => {
    const a = mulberry32(12_345);
    const b = mulberry32(12_345);
    const left = Array.from({ length: 100 }, () => a());
    const right = Array.from({ length: 100 }, () => b());
    expect(right).toEqual(left);
  });

  it('diverges within the first 10 values on a different seed', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    expect(a.some((v, i) => v !== b[i])).toBe(true);
  });

  it('stays inside [0, 1)', () => {
    const rand = mulberry32(987_654_321);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('treats the seed as uint32, so negatives and floats still work', () => {
    expect(() => mulberry32(-1)()).not.toThrow();
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)());
  });
});

describe('seededShuffle', () => {
  it('is a strict permutation of its input', () => {
    const input = Array.from({ length: 1_000 }, (_, i) => i);
    const out = seededShuffle(input, 77);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate its input', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const snapshot = [...input];
    seededShuffle(input, 5);
    expect(input).toEqual(snapshot);
  });

  it('is deterministic for a given seed', () => {
    const input = Array.from({ length: 500 }, (_, i) => i);
    expect(seededShuffle(input, 31)).toEqual(seededShuffle(input, 31));
  });

  it('actually reorders', () => {
    const input = Array.from({ length: 500 }, (_, i) => i);
    expect(seededShuffle(input, 31)).not.toEqual(input);
  });

  it('handles empty and single-element inputs', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle([9], 1)).toEqual([9]);
  });
});

describe('freshSeed', () => {
  it('returns a uint32', () => {
    for (let i = 0; i < 100; i += 1) {
      const seed = freshSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('does not return the same value every time', () => {
    const seeds = new Set(Array.from({ length: 50 }, freshSeed));
    expect(seeds.size).toBeGreaterThan(1);
  });
});
