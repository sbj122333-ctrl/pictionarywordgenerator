/**
 * The memory engine. TECHNICAL_SPEC §3.1-3.4.
 *
 * This module is the product. Everything else is a way to look at it.
 */
import type { Deck, PackedWord, RuntimeBundle, RuntimeWord, TierMemory } from './types';
import { decodeBitmap, encodeBitmap } from './bitmap';
import { freshSeed, seededShuffle } from './random';
import { LOOKAHEAD, applyAntiClustering } from './cluster';

/**
 * Moves recently-drawn ords into the back half of a deck so a new cycle never
 * opens with a word from last session.
 *
 * Two corrections to the version printed in TECHNICAL_SPEC §3.4, both needed to
 * meet the acceptance criterion in BUILD_PLAN task 4 ("after recycle(), none of
 * the previous 50 ords sit in the first half"):
 *
 *   1. The split is taken against the FULL deck length, not `head.length`. The
 *      printed `Math.floor(head.length / 2)` puts the cold block at
 *      (n - cold) / 2, which is still inside the first half of the result.
 *   2. A LOOKAHEAD margin is added, because anti-clustering runs after this and
 *      can pull an element up to that many positions earlier — enough to drag a
 *      cold ord back across the halfway line.
 *
 * Same intent as the spec, arithmetic that actually holds.
 */
export function applyCooldown(deck: readonly number[], recent: readonly number[]): number[] {
  const cold = new Set(recent);
  if (cold.size === 0) return deck.slice();
  const head: number[] = [];
  const tail: number[] = [];
  for (const ord of deck) (cold.has(ord) ? tail : head).push(ord);
  const mid = Math.min(head.length, Math.ceil(deck.length / 2) + LOOKAHEAD);
  return [...head.slice(0, mid), ...tail, ...head.slice(mid)];
}

/**
 * Re-anchors a tier after a corpus release. TECHNICAL_SPEC §3.3.
 *
 * The bitmap is keyed by ord, so it stays valid across the change: new words
 * are simply absent from it, and retired words sit in it as tombstones. No word
 * already seen is ever served again — which is why the bitmap, and not the
 * cursor, is the source of truth.
 */
export function reconcile(bundle: RuntimeBundle, memory: TierMemory): TierMemory {
  return reconcileWithMaxOrd(bundle.maxOrd, memory);
}

/**
 * The same operation addressed by ord ceiling rather than by bundle.
 *
 * Reconciliation needs nothing from a bundle but its `maxOrd`, and that number
 * is in the corpus manifest. Taking it directly means a corpus release can be
 * reconciled for all four tiers at boot, off ~200 bytes, instead of forcing a
 * download of 16.6 KB of words the player may not go on to play.
 */
export function reconcileWithMaxOrd(maxOrd: number, memory: TierMemory): TierMemory {
  const seen = decodeBitmap(memory.seen);
  return {
    seed: freshSeed(),
    cursor: 0,
    seen: encodeBitmap(seen, maxOrd),
    cycles: memory.cycles,
  };
}

export interface DeckOptions {
  /** Defaults to on. Off only so tests can isolate the shuffle from the reorder. */
  antiCluster?: boolean;
}

export function createDeck(
  bundle: RuntimeBundle,
  memory: TierMemory,
  recent: readonly number[],
  persist: (next: TierMemory) => void,
  options: DeckOptions = {},
): Deck {
  const byOrd = new Map<number, PackedWord>();
  for (const word of bundle.words) byOrd.set(word.o, word);

  const seen = decodeBitmap(memory.seen);
  let seed = memory.seed;
  let cycles = memory.cycles;

  const categoryOf = (ord: number): string => byOrd.get(ord)?.c ?? '';

  function materialise(withSeed: number): number[] {
    const unseen: number[] = [];
    for (const word of bundle.words) if (!seen.has(word.o)) unseen.push(word.o);
    let next = seededShuffle(unseen, withSeed);
    next = applyCooldown(next, recent);
    if (options.antiCluster !== false) next = applyAntiClustering(next, categoryOf);
    return next;
  }

  let deck = materialise(seed);

  /**
   * Always 0 on a fresh materialisation, and that is deliberate.
   *
   * TECHNICAL_SPEC §3.2 says "cursor if the deck length is unchanged since last
   * run, else 0". Every ord in `deck` is unseen by construction, so any draw
   * since the last run removes an entry and changes the length — the two
   * branches collapse into one. Carrying a stored cursor forward would skip
   * that many unseen words. The stored value is kept in the record because a
   * bug report is reproducible from {seed, cursor}, not because it is read back.
   */
  let cursor = 0;

  const snapshot = (): TierMemory => ({
    seed,
    cursor,
    seen: encodeBitmap(seen, bundle.maxOrd),
    cycles,
  });

  const toRuntimeWord = (packed: PackedWord): RuntimeWord => ({
    ord: packed.o,
    text: packed.t,
    words: packed.w,
    category: packed.c,
    meaning: packed.m ?? null,
    tier: bundle.tier,
    points: bundle.points,
  });

  return {
    draw(): RuntimeWord | null {
      if (cursor >= deck.length) return null;
      const ord = deck[cursor] as number;
      const packed = byOrd.get(ord);

      // INVARIANT 2: the word burns on reveal, not on outcome. The burn is
      // persisted here, synchronously, BEFORE the word is handed to the caller
      // to paint. A force-quit between these two lines must lose the word, not
      // leak it back into the pool.
      cursor += 1;
      seen.add(ord);
      persist(snapshot());

      return packed ? toRuntimeWord(packed) : null;
    },

    remaining(): number {
      return Math.max(0, deck.length - cursor);
    },

    depletion(): number {
      if (bundle.count <= 0) return 1;
      return (bundle.count - Math.max(0, deck.length - cursor)) / bundle.count;
    },

    recycle(): void {
      seen.clear();
      seed = freshSeed();
      cycles += 1;
      deck = materialise(seed);
      cursor = 0;
      persist(snapshot());
    },
  };
}
