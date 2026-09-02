/**
 * FR-16, BUILD_PLAN task 5.
 *
 * The membership assertion is the important one. Anti-clustering runs after the
 * shuffle, and if it could ever add or drop an element it would quietly break
 * the no-repeat guarantee that everything else in this project exists to
 * protect.
 */
import { describe, it, expect } from 'vitest';
import type { TierMemory } from '../../src/engine/types';
import { LOOKAHEAD, applyAntiClustering } from '../../src/engine/cluster';
import { createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';
import { seededShuffle } from '../../src/engine/random';
import { syntheticBundle } from '../helpers/synthetic';

const WINDOW = 20;

function categoryOf(bundle: ReturnType<typeof syntheticBundle>) {
  const map = new Map(bundle.words.map((w) => [w.o, w.c]));
  return (ord: number): string => map.get(ord) ?? '';
}

describe('anti-clustering / permutation', () => {
  it('reorders without ever changing membership', () => {
    const bundle = syntheticBundle(5_000);
    const before = seededShuffle(
      bundle.words.map((w) => w.o),
      99,
    );
    const after = applyAntiClustering(before, categoryOf(bundle));

    expect(after).toHaveLength(before.length);
    expect([...after].sort((a, b) => a - b)).toEqual([...before].sort((a, b) => a - b));
    expect(new Set(after).size).toBe(before.length);
  });

  it('leaves the input array untouched', () => {
    const bundle = syntheticBundle(200);
    const before = seededShuffle(
      bundle.words.map((w) => w.o),
      7,
    );
    const snapshot = [...before];
    applyAntiClustering(before, categoryOf(bundle));
    expect(before).toEqual(snapshot);
  });
});

describe('anti-clustering / constraint', () => {
  it('never places the same category twice in a row', () => {
    const bundle = syntheticBundle(5_000);
    const cat = categoryOf(bundle);
    const ordered = applyAntiClustering(
      seededShuffle(
        bundle.words.map((w) => w.o),
        4_242,
      ),
      cat,
    );

    for (let i = 1; i < ordered.length; i += 1) {
      expect(cat(ordered[i] as number), `consecutive repeat at index ${i}`).not.toBe(
        cat(ordered[i - 1] as number),
      );
    }
  });

  it('holds every category to its proportional share of a 20-draw window', () => {
    // There is no fixed quota any more — see the note at the top of cluster.ts.
    // A category is entitled to its own fraction of the window and no more, so
    // the bound is derived from the deck rather than picked. One slot of slack
    // absorbs rounding at the window boundary.
    const bundle = syntheticBundle(5_000);
    const cat = categoryOf(bundle);
    const ordered = applyAntiClustering(
      seededShuffle(
        bundle.words.map((w) => w.o),
        4_242,
      ),
      cat,
    );

    const totals = new Map<string, number>();
    for (const ord of ordered) {
      const c = cat(ord);
      totals.set(c, (totals.get(c) ?? 0) + 1);
    }
    const capOf = (c: string): number =>
      Math.ceil((WINDOW * (totals.get(c) ?? 0)) / ordered.length) + 1;

    for (let start = 0; start + WINDOW <= ordered.length; start += 1) {
      const counts = new Map<string, number>();
      for (let i = start; i < start + WINDOW; i += 1) {
        const c = cat(ordered[i] as number);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const [c, n] of counts) {
        expect(
          n,
          `${c} appears ${n} times in the window at ${start} (share allows ${capOf(c)})`,
        ).toBeLessThanOrEqual(capOf(c));
      }
    }
  });

  it('terminates on a tier with a single category', () => {
    // Best-effort, never blocking: nothing here can satisfy the constraint, and
    // the pass has to return the deck intact rather than spin or throw.
    const bundle = syntheticBundle(500, 1);
    const before = bundle.words.map((w) => w.o);
    const after = applyAntiClustering(before, categoryOf(bundle));
    expect([...after].sort((a, b) => a - b)).toEqual([...before].sort((a, b) => a - b));
  });
});

describe('anti-clustering / no-repeat still holds', () => {
  it('draws a full 3,000-word tier with clustering enabled and no repeats', () => {
    const bundle = syntheticBundle(3_000);
    const persisted: TierMemory[] = [];
    const deck = createDeck(bundle, createTierMemory(), [], (next) => persisted.push(next));

    const seen = new Set<number>();
    for (let i = 0; i < 3_000; i += 1) {
      const ord = deck.draw()?.ord ?? -1;
      expect(seen.has(ord), `repeat at draw ${i}`).toBe(false);
      seen.add(ord);
    }
    expect(seen.size).toBe(3_000);
  });
});

describe('anti-clustering / lookahead bound', () => {
  it('never moves an element more than LOOKAHEAD positions earlier', () => {
    // The recycle cooldown depends on this bound to keep cold ords out of the
    // first half of a fresh deck. If it ever widened, that guarantee would go
    // with it silently.
    const bundle = syntheticBundle(2_000);
    const before = seededShuffle(
      bundle.words.map((w) => w.o),
      31,
    );
    const after = applyAntiClustering(before, categoryOf(bundle));

    const wasAt = new Map(before.map((ord, i) => [ord, i]));
    for (let i = 0; i < after.length; i += 1) {
      const from = wasAt.get(after[i] as number) ?? i;
      expect(from - i, `element moved ${from - i} places earlier`).toBeLessThanOrEqual(LOOKAHEAD);
    }
  });
});
