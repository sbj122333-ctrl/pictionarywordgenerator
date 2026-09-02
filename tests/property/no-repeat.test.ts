/**
 * NFR-07. These are the product.
 *
 * If any assertion in this file fails, the app's one claim is false and nothing
 * downstream matters. BUILD_PLAN task 4 is the gate for the whole project.
 */
import { describe, it, expect } from 'vitest';
import type { TierMemory } from '../../src/engine/types';
import { createDeck, reconcile } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';
import { decodeBitmap } from '../../src/engine/bitmap';
import { bundleFromOrds, syntheticBundle } from '../helpers/synthetic';

describe('no-repeat / single tier', () => {
  it('serves all 10,000 words of a 10,000-word tier with zero repeats', () => {
    const bundle = syntheticBundle(10_000);
    const persisted: TierMemory[] = [];
    const deck = createDeck(bundle, createTierMemory(), [], (next) => persisted.push(next));

    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) {
      const word = deck.draw();
      expect(word, `ran dry at draw ${i}`).not.toBeNull();
      expect(seen.has(word?.ord ?? -1), `repeat at draw ${i}`).toBe(false);
      seen.add(word?.ord ?? -1);
    }

    expect(seen.size).toBe(10_000);
    expect(deck.draw()).toBeNull();
    expect(deck.remaining()).toBe(0);
    expect(deck.depletion()).toBe(1);
  });
});

describe('no-repeat / across sessions', () => {
  it('survives 10 rounds of 50 draws with the adapter torn down between each', () => {
    const bundle = syntheticBundle(10_000);
    let memory = createTierMemory();
    const seen = new Set<number>();

    for (let session = 0; session < 10; session += 1) {
      // A whole new Deck each time, built only from what was persisted — this
      // is what a cold app launch actually does.
      const persisted: TierMemory[] = [];
      const deck = createDeck(bundle, memory, [], (next) => persisted.push(next));
      for (let i = 0; i < 50; i += 1) {
        const word = deck.draw();
        expect(word).not.toBeNull();
        expect(seen.has(word?.ord ?? -1), `repeat in session ${session}, draw ${i}`).toBe(false);
        seen.add(word?.ord ?? -1);
      }
      memory = persisted[persisted.length - 1] as TierMemory;
    }

    expect(seen.size).toBe(500);
  });
});

describe('no-repeat / corpus update', () => {
  it('holds across a +200 / -50 corpus change', () => {
    const before = syntheticBundle(1_000);
    let memory = createTierMemory();
    const seen = new Set<number>();

    const persistedA: TierMemory[] = [];
    const deckA = createDeck(before, memory, [], (next) => persistedA.push(next));
    for (let i = 0; i < 500; i += 1) seen.add(deckA.draw()?.ord ?? -1);
    memory = persistedA[persistedA.length - 1] as TierMemory;
    expect(seen.size).toBe(500);

    // 50 retired (their ords become tombstones), 200 added at the tail.
    const survivingOrds = before.words.map((w) => w.o).filter((o) => o >= 50);
    const addedOrds = Array.from({ length: 200 }, (_, i) => 1_000 + i);
    const after = bundleFromOrds([...survivingOrds, ...addedOrds]);

    memory = reconcile(after, memory);
    const persistedB: TierMemory[] = [];
    const deckB = createDeck(after, memory, [], (next) => persistedB.push(next));

    for (let i = 0; i < 150; i += 1) {
      const word = deckB.draw();
      expect(word, `ran dry at draw ${i} after the corpus change`).not.toBeNull();
      expect(seen.has(word?.ord ?? -1), `repeat across the corpus boundary at draw ${i}`).toBe(false);
      seen.add(word?.ord ?? -1);
    }

    expect(seen.size).toBe(650);
  });

  it('keeps retired ords in the bitmap as tombstones', () => {
    const before = syntheticBundle(100);
    const persisted: TierMemory[] = [];
    const deck = createDeck(before, createTierMemory(), [], (next) => persisted.push(next));
    const drawn = new Set<number>();
    for (let i = 0; i < 40; i += 1) drawn.add(deck.draw()?.ord ?? -1);

    const memory = persisted[persisted.length - 1] as TierMemory;
    const shrunk = bundleFromOrds(before.words.map((w) => w.o).filter((o) => o >= 60));
    const next = reconcile(shrunk, memory);

    const survivors = decodeBitmap(next.seen);
    for (const ord of drawn) {
      expect(survivors.has(ord), `ord ${ord} lost its tombstone`).toBe(true);
    }
  });
});

describe('burn-on-reveal', () => {
  it('persists the burn before draw() returns', () => {
    const bundle = syntheticBundle(50);
    const persisted: TierMemory[] = [];
    const deck = createDeck(bundle, createTierMemory(), [], (next) => persisted.push(next));

    const word = deck.draw();
    expect(word).not.toBeNull();
    // The persist call has already happened by the time draw() hands the word
    // back — the caller cannot paint a word whose burn is not yet durable.
    expect(persisted).toHaveLength(1);
    expect(decodeBitmap((persisted[0] as TierMemory).seen).has(word?.ord ?? -1)).toBe(true);
  });

  it('loses a word drawn but never resolved', () => {
    const bundle = syntheticBundle(200);
    const persisted: TierMemory[] = [];
    const deck = createDeck(bundle, createTierMemory(), [], (next) => persisted.push(next));

    const abandoned = deck.draw()?.ord ?? -1;
    // No outcome recorded. The adapter is discarded as if the tab was killed.
    const memory = persisted[persisted.length - 1] as TierMemory;

    const rebuilt = createDeck(bundle, memory, [], () => {});
    for (let i = 0; i < 199; i += 1) {
      expect(rebuilt.draw()?.ord).not.toBe(abandoned);
    }
    expect(rebuilt.draw()).toBeNull();
  });
});

describe('prng / determinism', () => {
  it('produces an identical deck from the same seed', () => {
    const bundle = syntheticBundle(500);
    const memory: TierMemory = { seed: 123_456, cursor: 0, seen: '', cycles: 0 };

    const runA: number[] = [];
    const deckA = createDeck(bundle, { ...memory }, [], () => {});
    for (let i = 0; i < 500; i += 1) runA.push(deckA.draw()?.ord ?? -1);

    const runB: number[] = [];
    const deckB = createDeck(bundle, { ...memory }, [], () => {});
    for (let i = 0; i < 500; i += 1) runB.push(deckB.draw()?.ord ?? -1);

    expect(runB).toEqual(runA);
  });

  it('diverges on a different seed', () => {
    const bundle = syntheticBundle(500);
    const deckA = createDeck(bundle, { seed: 1, cursor: 0, seen: '', cycles: 0 }, [], () => {});
    const deckB = createDeck(bundle, { seed: 2, cursor: 0, seen: '', cycles: 0 }, [], () => {});
    const a = Array.from({ length: 20 }, () => deckA.draw()?.ord);
    const b = Array.from({ length: 20 }, () => deckB.draw()?.ord);
    expect(b).not.toEqual(a);
  });
});
