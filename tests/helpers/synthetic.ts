/**
 * Synthetic corpora for the property tests.
 *
 * The no-repeat assertions run against generated ordinals rather than the seed
 * corpus, so they can exercise launch-scale volumes (10,000 words) instead of
 * the 1,100 that happen to exist today. TECHNICAL_SPEC §8.1.
 */
import type { DeckId, PackedWord, RuntimeBundle } from '../../src/engine/types';

export function syntheticBundle(
  count: number,
  categories = 12,
  startOrd = 0,
  tier: DeckId = 'easy',
): RuntimeBundle {
  const words: PackedWord[] = [];
  for (let i = 0; i < count; i += 1) {
    words.push({
      o: startOrd + i,
      t: `word-${startOrd + i}`,
      w: 1,
      c: `cat-${i % categories}`,
    });
  }
  return {
    corpusVersion: 'test.1',
    tier,
    points: 1,
    count: words.length,
    maxOrd: count === 0 ? 0 : startOrd + count - 1,
    words,
  };
}

/** A bundle built from an explicit ord list — used for corpus-change tests. */
export function bundleFromOrds(ords: readonly number[], categories = 12): RuntimeBundle {
  const words: PackedWord[] = ords.map((o, i) => ({
    o,
    t: `word-${o}`,
    w: 1,
    c: `cat-${i % categories}`,
  }));
  return {
    corpusVersion: 'test.2',
    tier: 'easy',
    points: 1,
    count: words.length,
    maxOrd: ords.length === 0 ? 0 : Math.max(...ords),
    words,
  };
}
