/**
 * Recycle cooldown. TECHNICAL_SPEC §3.4, BUILD_PLAN task 4.
 *
 * A new cycle must never open with a word from the session that just ended —
 * that is the moment a player is most likely to notice a repeat and conclude
 * the whole guarantee is fake.
 */
import { describe, it, expect } from 'vitest';
import type { TierMemory } from '../../src/engine/types';
import { applyCooldown, createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';
import { syntheticBundle } from '../helpers/synthetic';

describe('recycle / cooldown ordering', () => {
  it('pushes every recent ord out of the first half', () => {
    const deck = Array.from({ length: 1_000 }, (_, i) => i);
    const recent = deck.slice(0, 50);
    const cooled = applyCooldown(deck, recent);

    expect([...cooled].sort((a, b) => a - b)).toEqual([...deck].sort((a, b) => a - b));

    const firstHalf = new Set(cooled.slice(0, Math.floor(cooled.length / 2)));
    for (const ord of recent) {
      expect(firstHalf.has(ord), `ord ${ord} is still in the first half`).toBe(false);
    }
  });

  it('is a no-op when nothing is recent', () => {
    const deck = Array.from({ length: 100 }, (_, i) => i);
    expect(applyCooldown(deck, [])).toEqual(deck);
  });

  it('copes when more than half the deck is on cooldown', () => {
    const deck = Array.from({ length: 60 }, (_, i) => i);
    const cooled = applyCooldown(deck, deck.slice(0, 50));
    expect([...cooled].sort((a, b) => a - b)).toEqual(deck);
  });
});

describe('recycle / behaviour', () => {
  it('does not serve last session words in the first half of a new cycle', () => {
    const bundle = syntheticBundle(1_000);
    const persisted: TierMemory[] = [];
    const first = createDeck(bundle, createTierMemory(), [], (next) => persisted.push(next));

    const recent: number[] = [];
    for (let i = 0; i < 50; i += 1) recent.push(first.draw()?.ord ?? -1);

    const memory = persisted[persisted.length - 1] as TierMemory;
    const next = createDeck(bundle, memory, recent, (m) => persisted.push(m));
    next.recycle();

    const cold = new Set(recent);
    for (let i = 0; i < 500; i += 1) {
      const ord = next.draw()?.ord ?? -1;
      expect(cold.has(ord), `cooled ord ${ord} came back at draw ${i}`).toBe(false);
    }
  });

  it('clears the bitmap and counts the cycle', () => {
    const bundle = syntheticBundle(100);
    const persisted: TierMemory[] = [];
    const deck = createDeck(bundle, createTierMemory(), [], (next) => persisted.push(next));

    for (let i = 0; i < 100; i += 1) deck.draw();
    expect(deck.draw()).toBeNull();
    expect(deck.remaining()).toBe(0);

    deck.recycle();
    expect(deck.remaining()).toBe(100);
    expect(deck.depletion()).toBe(0);
    expect((persisted[persisted.length - 1] as TierMemory).cycles).toBe(1);

    const seen = new Set<number>();
    for (let i = 0; i < 100; i += 1) seen.add(deck.draw()?.ord ?? -1);
    expect(seen.size).toBe(100);
  });

  it('draws a fresh seed on recycle so the new cycle is a different order', () => {
    const bundle = syntheticBundle(200);
    const persisted: TierMemory[] = [];
    const deck = createDeck(bundle, { seed: 5, cursor: 0, seen: '', cycles: 0 }, [], (n) =>
      persisted.push(n),
    );
    deck.recycle();
    expect((persisted[persisted.length - 1] as TierMemory).seed).not.toBe(5);
  });
});
