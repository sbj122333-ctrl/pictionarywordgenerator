import { describe, it, expect } from 'vitest';
import { decodeBitmap, encodeBitmap } from '../../src/engine/bitmap';
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url } from '../../src/engine/base64';
import { mulberry32 } from '../../src/engine/random';

describe('base64', () => {
  it('round-trips arbitrary byte lengths, including the padding cases', () => {
    for (let len = 0; len < 32; len += 1) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + 11) & 0xff;
      expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
      expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  it('round-trips every possible byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it('emits url-safe output with no padding', () => {
    const bytes = new Uint8Array([251, 255, 190, 0, 1]);
    const url = bytesToBase64Url(bytes);
    expect(url).not.toMatch(/[+/=]/);
  });
});

describe('bitmap / round trip', () => {
  it('survives 1,000 random ord sets', () => {
    const rand = mulberry32(2_024);
    for (let trial = 0; trial < 1_000; trial += 1) {
      const maxOrd = 1 + Math.floor(rand() * 2_000);
      const set = new Set<number>();
      const size = Math.floor(rand() * maxOrd);
      for (let i = 0; i < size; i += 1) set.add(Math.floor(rand() * maxOrd));
      const back = decodeBitmap(encodeBitmap(set, maxOrd));
      expect(back.size, `trial ${trial}`).toBe(set.size);
      for (const ord of set) expect(back.has(ord), `trial ${trial}, ord ${ord}`).toBe(true);
    }
  });

  it('handles the empty set', () => {
    expect(decodeBitmap(encodeBitmap(new Set(), -1)).size).toBe(0);
    expect(decodeBitmap('').size).toBe(0);
    expect(decodeBitmap(encodeBitmap(new Set(), 100)).size).toBe(0);
  });

  it('keeps ords beyond maxOrd rather than dropping them', () => {
    // Dropping one would resurrect a played word — the single failure this
    // product cannot have.
    const set = new Set([0, 5, 9_999]);
    expect([...decodeBitmap(encodeBitmap(set, 100))].sort((a, b) => a - b)).toEqual([0, 5, 9_999]);
  });

  it('encodes a saturated 23,700-ord bitmap in under 4,000 characters', () => {
    const set = new Set<number>();
    for (let ord = 0; ord < 23_700; ord += 1) set.add(ord);
    const encoded = encodeBitmap(set, 23_699);
    expect(encoded.length).toBeLessThanOrEqual(4_000);
    expect(decodeBitmap(encoded).size).toBe(23_700);
  });

  it('is stable — the same set encodes to the same string', () => {
    const set = new Set([3, 1, 4, 1, 5, 9, 2, 6]);
    expect(encodeBitmap(set, 20)).toBe(encodeBitmap(new Set([...set].reverse()), 20));
  });
});
