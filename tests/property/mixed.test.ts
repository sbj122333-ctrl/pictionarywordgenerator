/**
 * The Mixed deck. TECHNICAL_SPEC §3.8.
 *
 * Mixed exists to be played instead of, and alongside, the two decks it deals
 * from — so the assertion that matters is not "Mixed does not repeat itself",
 * it is "Mixed and its sources cannot repeat each other, in any order, across
 * a rebuild". A separate corpus would pass the first and fail the second, which
 * is exactly why there isn't one.
 */
import { describe, it, expect } from 'vitest';
import type { Deck, TierMemory } from '../../src/engine/types';
import { createDeck } from '../../src/engine/deck';
import { createMixedDeck } from '../../src/engine/mixed';
import { createTierMemory } from '../../src/engine/storage';
import { syntheticBundle } from '../helpers/synthetic';

const HINDI = syntheticBundle(400, 8, 0, 'hindi');
const ENGLISH = syntheticBundle(400, 8, 400, 'english');

interface Rig {
  hindi: Deck;
  english: Deck;
  mixed: Deck;
  memory: { hindi: TierMemory; english: TierMemory };
}

/** Builds all three decks over one pair of persisted memories, as the app does. */
function rig(seed?: { hindi: TierMemory; english: TierMemory }): Rig {
  const memory = seed ?? { hindi: createTierMemory(), english: createTierMemory() };

  const hindi = createDeck(HINDI, memory.hindi, [], (next) => {
    memory.hindi = next;
  });
  const english = createDeck(ENGLISH, memory.english, [], (next) => {
    memory.english = next;
  });
  const mixed = createMixedDeck([
    { deck: hindi, total: HINDI.count },
    { deck: english, total: ENGLISH.count },
  ]);

  return { hindi, english, mixed, memory };
}

const drawMany = (deck: Deck, n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const word = deck.draw();
    if (!word) break;
    out.push(word.ord);
  }
  return out;
};

describe('mixed deals from both film decks', () => {
  it('interleaves them rather than clustering — no three in a row from one deck', () => {
    const { mixed } = rig();
    const ords = drawMany(mixed, 200);
    expect(ords).toHaveLength(200);

    const side = ords.map((o) => (o < 400 ? 'h' : 'e'));
    for (let i = 2; i < side.length; i += 1) {
      expect(
        side[i] === side[i - 1] && side[i] === side[i - 2],
        `three from ${side[i]} in a row at draw ${i}`,
      ).toBe(false);
    }

    // Equal-sized sources, so an even split is the only proportional answer.
    expect(side.filter((s) => s === 'h')).toHaveLength(100);
  });

  it('reports remaining and depletion across both sources', () => {
    const { mixed } = rig();
    expect(mixed.remaining()).toBe(800);
    expect(mixed.depletion()).toBe(0);

    drawMany(mixed, 80);
    expect(mixed.remaining()).toBe(720);
    expect(mixed.depletion()).toBeCloseTo(0.1, 5);
  });

  it('burns into the source decks, so Bollywood never serves what Mixed already did', () => {
    const { hindi, english, mixed } = rig();
    const fromMixed = new Set(drawMany(mixed, 300));

    for (const ord of drawMany(hindi, 250)) {
      expect(fromMixed.has(ord), `hindi re-served ${ord}`).toBe(false);
    }
    for (const ord of drawMany(english, 250)) {
      expect(fromMixed.has(ord), `english re-served ${ord}`).toBe(false);
    }
  });

  it('and the reverse: Mixed never serves what the source decks already did', () => {
    const { hindi, english, mixed } = rig();
    const seen = new Set([...drawMany(hindi, 120), ...drawMany(english, 90)]);

    for (const ord of drawMany(mixed, 400)) {
      expect(seen.has(ord), `mixed re-served ${ord}`).toBe(false);
    }
  });

  it('holds the guarantee across a rebuild, which is where a cursor would lose it', () => {
    const first = rig();
    const seen = new Set(drawMany(first.mixed, 260));

    // Storage round-trip: new Deck instances over the persisted memories.
    const second = rig(first.memory);
    for (const ord of drawMany(second.mixed, 500)) {
      expect(seen.has(ord), `${ord} came back after a rebuild`).toBe(false);
      seen.add(ord);
    }
    expect(seen.size).toBe(760);
  });

  it('empties completely, then answers null rather than repeating', () => {
    const { mixed } = rig();
    const ords = drawMany(mixed, 900);
    expect(ords).toHaveLength(800);
    expect(new Set(ords).size).toBe(800);
    expect(mixed.draw()).toBeNull();
    expect(mixed.remaining()).toBe(0);
    expect(mixed.depletion()).toBe(1);
  });

  it('keeps dealing from whichever source still has films when the other runs dry', () => {
    const small = syntheticBundle(20, 4, 1000, 'hindi');
    const big = syntheticBundle(200, 8, 2000, 'english');
    const a = createDeck(small, createTierMemory(), [], () => {});
    const b = createDeck(big, createTierMemory(), [], () => {});
    const mixed = createMixedDeck([
      { deck: a, total: small.count },
      { deck: b, total: big.count },
    ]);

    const ords = drawMany(mixed, 220);
    expect(ords).toHaveLength(220);
    expect(new Set(ords).size).toBe(220);
    expect(mixed.remaining()).toBe(0);
  });

  it('recycles both sources, because it has no history of its own to clear', () => {
    const { hindi, english, mixed } = rig();
    drawMany(mixed, 800);
    expect(hindi.remaining()).toBe(0);
    expect(english.remaining()).toBe(0);

    mixed.recycle();
    expect(mixed.remaining()).toBe(800);
    expect(hindi.remaining()).toBe(400);
    expect(english.remaining()).toBe(400);
  });
});
