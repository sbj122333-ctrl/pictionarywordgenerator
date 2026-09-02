/**
 * The engine against the corpus that actually ships.
 *
 * The synthetic tests use 12 evenly-sized categories, which is the easy case.
 * Real tiers are lumpy — God Mode is mostly `biases` and `philosophy`, and a
 * category holding a third of a tier is a much harder constraint to satisfy
 * than twelve holding a twelfth each. A pass on synthetic data says the
 * algorithm is correct; this says it is correct on the input it will be given.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeBundle, Tier } from '../../src/engine/types';
import { TIERS } from '../../src/engine/types';
import { createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';

const WINDOW = 20;

function bundle(tier: Tier): RuntimeBundle {
  return JSON.parse(
    readFileSync(join('public', 'corpus', `${tier}.json`), 'utf8'),
  ) as RuntimeBundle;
}

const manifest = JSON.parse(
  readFileSync(join('public', 'corpus', 'manifest.json'), 'utf8'),
) as { corpusVersion: string; tiers: Record<Tier, { count: number; maxOrd: number }> };

describe.each(TIERS)('%s tier', (tier) => {
  const source = bundle(tier);

  it('agrees with the manifest', () => {
    expect(source.corpusVersion).toBe(manifest.corpusVersion);
    expect(source.count).toBe(manifest.tiers[tier].count);
    expect(source.maxOrd).toBe(manifest.tiers[tier].maxOrd);
    expect(source.words).toHaveLength(source.count);
  });

  it('has globally unique ordinals', () => {
    expect(new Set(source.words.map((w) => w.o)).size).toBe(source.count);
  });

  it('serves every word exactly once', () => {
    const deck = createDeck(source, createTierMemory(), [], () => {});
    const seen = new Set<number>();
    for (let i = 0; i < source.count; i += 1) {
      const word = deck.draw();
      expect(word, `ran dry at draw ${i} of ${source.count}`).not.toBeNull();
      expect(seen.has(word?.ord ?? -1), `repeat at draw ${i}`).toBe(false);
      seen.add(word?.ord ?? -1);
    }
    expect(deck.draw()).toBeNull();
    expect(seen.size).toBe(source.count);
  });

  it('never serves the same category twice running', () => {
    const deck = createDeck(source, createTierMemory(), [], () => {});
    const order: string[] = [];
    for (let i = 0; i < source.count; i += 1) {
      const word = deck.draw();
      if (word) order.push(word.category);
    }

    const categories = new Set(order);
    const biggest = Math.max(
      ...[...categories].map((c) => order.filter((x) => x === c).length),
    );

    // Alternation is only possible while no category holds more than half the
    // tier. Assert the premise rather than assume it — if a corpus release ever
    // breaks it, this should say so plainly instead of failing below.
    expect(biggest * 2, `one category holds ${biggest} of ${order.length}`).toBeLessThanOrEqual(
      order.length,
    );

    for (let i = 1; i < order.length; i += 1) {
      expect(order[i], `consecutive ${order[i]} at draw ${i} in ${tier}`).not.toBe(order[i - 1]);
    }
  });

  it('holds every category to its proportional share of a 20-draw window', () => {
    // There is no fixed per-window quota — see the note at the top of
    // cluster.ts. A category is entitled to its own fraction of the window and
    // no more, so the bound is derived from the tier rather than picked. One
    // slot of slack absorbs rounding at the window boundary.
    const deck = createDeck(source, createTierMemory(), [], () => {});
    const order: string[] = [];
    for (let i = 0; i < source.count; i += 1) {
      const word = deck.draw();
      if (word) order.push(word.category);
    }

    const totals = new Map<string, number>();
    for (const c of order) totals.set(c, (totals.get(c) ?? 0) + 1);
    const capOf = (c: string): number =>
      Math.ceil((WINDOW * (totals.get(c) ?? 0)) / order.length) + 1;

    for (let start = 0; start + WINDOW <= order.length; start += 1) {
      const counts = new Map<string, number>();
      for (let i = start; i < start + WINDOW; i += 1) {
        const c = order[i] as string;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const [c, n] of counts) {
        expect(
          n,
          `${c} appears ${n} times in ${tier} window ${start} ` +
            `(${totals.get(c)} of ${order.length} words allows ${capOf(c)})`,
        ).toBeLessThanOrEqual(capOf(c));
      }
    }
  });
});

describe('god tier hints', () => {
  it('carries a hint on every word, 8 to 90 characters', () => {
    for (const word of bundle('god').words) {
      expect(word.h, `${word.t} has no hint`).toBeTruthy();
      expect(word.h?.length ?? 0, `${word.t}: "${word.h}"`).toBeGreaterThanOrEqual(8);
      expect(word.h?.length ?? 0, `${word.t}: "${word.h}"`).toBeLessThanOrEqual(90);
    }
  });

  it('carries no hint anywhere else', () => {
    for (const tier of ['easy', 'moderate', 'hard'] as Tier[]) {
      for (const word of bundle(tier).words) {
        expect(word.h, `${tier}/${word.t} has a hint it should not`).toBeUndefined();
      }
    }
  });
});

describe('ordinals across tiers', () => {
  it('never reuses an ordinal between tiers', () => {
    const all = new Set<number>();
    let total = 0;
    for (const tier of TIERS) {
      for (const word of bundle(tier).words) {
        all.add(word.o);
        total += 1;
      }
    }
    // A collision would make one tier's seen-bitmap silently mark another's
    // words as played.
    expect(all.size).toBe(total);
  });
});
