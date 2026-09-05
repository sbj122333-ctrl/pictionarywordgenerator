/**
 * The Mixed deck. TECHNICAL_SPEC §3.8.
 *
 * Mixed is not a corpus. It is a `Deck` that holds the Bollywood and Hollywood
 * decks and delegates every draw to one of them, so the film it serves is burned
 * in that deck's own bitmap and persisted through that deck's own writer.
 *
 * That is the whole point, and it is worth being explicit about why the obvious
 * alternative is wrong. A third bundle of "mixed" films would have been half an
 * hour's work and would have broken the product's only promise in two
 * directions at once: films duplicated across decks could be served twice, and
 * films unique to Mixed would be unreachable to anyone who never picks it. A
 * deck that shares its sources' memory has neither problem — play Mixed for an
 * hour and Bollywood opens on the films Mixed did not reach.
 *
 * Which source to take from is decided by proportional scheduling rather than a
 * coin flip, for the same reason the category scheduler in cluster.ts is:
 * randomness clusters. Weighted-random selection across two decks of 430 films
 * produces runs of five or six from one language often enough for a room to
 * notice and call it broken. Instead each draw goes to whichever source has
 * served the smaller fraction of what it started the session holding, which
 * interleaves them exactly in proportion to their sizes — strict alternation
 * when they are equal, two-to-one when one is twice the other — and needs no
 * PRNG, which the engine could not reach for anyway.
 *
 * Ties go to the earlier source, so the deal is reproducible from the same
 * inputs. That matters for the same reason the seeded shuffle does: a bug report
 * has to be replayable.
 */
import type { Deck, RuntimeWord } from './types';

export interface MixedSource {
  deck: Deck;
  /** The source's full corpus size, so the combined depletion is honest. */
  total: number;
}

export function createMixedDeck(sources: readonly MixedSource[]): Deck {
  const served = sources.map(() => 0);

  /** The source furthest behind its share, or -1 when every source is spent. */
  const next = (): number => {
    let pick = -1;
    let lowest = Infinity;

    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      if (!source) continue;
      const left = source.deck.remaining();
      if (left <= 0) continue;

      const taken = served[i] ?? 0;
      const share = taken / (taken + left);
      if (share < lowest) {
        lowest = share;
        pick = i;
      }
    }

    return pick;
  };

  const remaining = (): number =>
    sources.reduce((total, source) => total + source.deck.remaining(), 0);

  return {
    draw(): RuntimeWord | null {
      const index = next();
      if (index < 0) return null;

      const source = sources[index];
      if (!source) return null;

      // The burn happens inside the source deck, before it returns — INVARIANT
      // 2 holds here because this function does nothing to weaken it.
      const word = source.deck.draw();
      if (word) served[index] = (served[index] ?? 0) + 1;
      return word;
    },

    remaining,

    depletion(): number {
      const total = sources.reduce((n, source) => n + source.total, 0);
      if (total <= 0) return 1;
      return (total - remaining()) / total;
    },

    /**
     * Recycles every source. Mixed cannot be recycled independently of the decks
     * it deals from — it has no history of its own to clear — so finishing Mixed
     * and starting again is the same act as starting both film decks again, and
     * the recycle screen says so.
     */
    recycle(): void {
      for (const source of sources) source.deck.recycle();
      for (let i = 0; i < served.length; i += 1) served[i] = 0;
    },
  };
}
