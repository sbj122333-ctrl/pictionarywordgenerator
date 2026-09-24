/**
 * The engine against the corpus that actually ships.
 *
 * The synthetic tests use 12 evenly-sized categories, which is the easy case.
 * Real decks are lumpy — God Mode is mostly `biases` and `philosophy`, and a
 * category holding a third of a deck is a much harder constraint to satisfy
 * than twelve holding a twelfth each. A pass on synthetic data says the
 * algorithm is correct; this says it is correct on the input it will be given.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckId, RuntimeBundle } from '../../src/engine/types';
import { CHARADES_DECKS, DECKS, TIERS } from '../../src/engine/types';
import { createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';

const WINDOW = 20;

/** Films run one word longer than Pictionary phrases; nothing else differs. */
const MAX_WORDS: Readonly<Record<DeckId, number>> = {
  easy: 7,
  moderate: 7,
  hard: 7,
  expert: 7,
  god: 7,
  hindi: 8,
  english: 8,
};

function bundle(deck: DeckId): RuntimeBundle {
  return JSON.parse(
    readFileSync(join('public', 'corpus', `${deck}.json`), 'utf8'),
  ) as RuntimeBundle;
}

const manifest = JSON.parse(
  readFileSync(join('public', 'corpus', 'manifest.json'), 'utf8'),
) as { corpusVersion: string; tiers: Record<DeckId, { count: number; maxOrd: number }> };

describe.each(DECKS)('%s deck', (deck) => {
  const source = bundle(deck);

  it('agrees with the manifest', () => {
    expect(source.corpusVersion).toBe(manifest.corpusVersion);
    expect(source.count).toBe(manifest.tiers[deck].count);
    expect(source.maxOrd).toBe(manifest.tiers[deck].maxOrd);
    expect(source.words).toHaveLength(source.count);
  });

  it('has globally unique ordinals', () => {
    expect(new Set(source.words.map((w) => w.o)).size).toBe(source.count);
  });

  it('serves every entry exactly once', () => {
    const built = createDeck(source, createTierMemory(), [], () => {});
    const seen = new Set<number>();
    for (let i = 0; i < source.count; i += 1) {
      const word = built.draw();
      expect(word, `ran dry at draw ${i} of ${source.count}`).not.toBeNull();
      expect(seen.has(word?.ord ?? -1), `repeat at draw ${i}`).toBe(false);
      seen.add(word?.ord ?? -1);
    }
    expect(built.draw()).toBeNull();
    expect(seen.size).toBe(source.count);
  });

  it('never serves the same category twice running', () => {
    const built = createDeck(source, createTierMemory(), [], () => {});
    const order: string[] = [];
    for (let i = 0; i < source.count; i += 1) {
      const word = built.draw();
      if (word) order.push(word.category);
    }

    const categories = new Set(order);
    const biggest = Math.max(
      ...[...categories].map((c) => order.filter((x) => x === c).length),
    );

    // Alternation is only possible while no category holds more than half the
    // deck. Assert the premise rather than assume it — if a corpus release ever
    // breaks it, this should say so plainly instead of failing below.
    expect(biggest * 2, `one category holds ${biggest} of ${order.length}`).toBeLessThanOrEqual(
      order.length,
    );

    for (let i = 1; i < order.length; i += 1) {
      expect(order[i], `consecutive ${order[i]} at draw ${i} in ${deck}`).not.toBe(order[i - 1]);
    }
  });

  it('holds every category to its proportional share of a 20-draw window', () => {
    // There is no fixed per-window quota — see the note at the top of
    // cluster.ts. A category is entitled to its own fraction of the window and
    // no more, so the bound is derived from the deck rather than picked. One
    // slot of slack absorbs rounding at the window boundary.
    const built = createDeck(source, createTierMemory(), [], () => {});
    const order: string[] = [];
    for (let i = 0; i < source.count; i += 1) {
      const word = built.draw();
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
          `${c} appears ${n} times in ${deck} window ${start} ` +
            `(${totals.get(c)} of ${order.length} entries allows ${capOf(c)})`,
        ).toBeLessThanOrEqual(capOf(c));
      }
    }
  });
});

/**
 * The pip count is the ONLY signal the guessers get about the shape of the
 * answer, so an inflated one is worse than no pips at all. The build used to
 * count words with the same normaliser it uses for ordinal keys, which turns
 * every non-alphanumeric run into a space — so "gambler's fallacy" shipped as
 * three pips for a two-word phrase, and 57 entries were wrong the same way.
 * Apostrophes and hyphens are inside words; everything else separates them.
 *
 * Film titles are the same trap wearing a different hat, which is why they are
 * written without full stops inside a word: "Munna Bhai M.B.B.S." would count
 * six, and a charades player holds that number up on their fingers before they
 * start.
 */
describe('word counts', () => {
  const expected = (text: string): number =>
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’'-]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean).length;

  it.each(DECKS)('%s: the pip count is the number of words to guess', (deck) => {
    for (const word of bundle(deck).words) {
      expect(word.w, `${word.t}`).toBe(expected(word.t));
      expect(word.w, `${word.t}`).toBeGreaterThanOrEqual(1);
      expect(word.w, `${word.t}`).toBeLessThanOrEqual(MAX_WORDS[deck]);
    }
  });

  it('does not let a possessive or a hyphen add a phantom word', () => {
    const all = DECKS.flatMap((deck) => bundle(deck).words);
    const check = (text: string, words: number): void => {
      const found = all.find((w) => w.t === text);
      expect(found, `${text} is missing from the corpus`).toBeDefined();
      expect(found?.w, text).toBe(words);
    };
    check("gambler's fallacy", 2);
    check('t-shirt', 1);
    check('let the cat out of the bag', 7);
    check('Mughal-e-Azam', 1);
    check('WALL-E', 1);
    check('Spider-Man', 1);
  });
});

const MEANING_DECKS: readonly DeckId[] = ['expert', 'god'];

describe('enigma and god tier meanings', () => {
  it.each(MEANING_DECKS)('%s: carries a meaning on every word, 8 to 120 characters', (deck) => {
    for (const word of bundle(deck).words) {
      expect(word.m, `${word.t} has no meaning`).toBeTruthy();
      expect(word.m?.length ?? 0, `${word.t}: "${word.m}"`).toBeGreaterThanOrEqual(8);
      expect(word.m?.length ?? 0, `${word.t}: "${word.m}"`).toBeLessThanOrEqual(120);
    }
  });

  it('carries no meaning anywhere else', () => {
    // A meaning under a Doodle word hands the room the answer, and a meaning
    // under a film title hands them the film.
    for (const deck of DECKS.filter((d) => !MEANING_DECKS.includes(d))) {
      for (const word of bundle(deck).words) {
        expect(word.m, `${deck}/${word.t} has a meaning it should not`).toBeUndefined();
      }
    }
  });
});

describe('ordinals across decks', () => {
  it('never reuses an ordinal between decks', () => {
    const all = new Set<number>();
    let total = 0;
    for (const deck of DECKS) {
      for (const word of bundle(deck).words) {
        all.add(word.o);
        total += 1;
      }
    }
    // A collision would make one deck's seen-bitmap silently mark another's
    // entries as played.
    expect(all.size).toBe(total);
  });

  /**
   * The reason charades ordinal keys are namespaced `film:<norm>` while
   * Pictionary keys stay bare. Sixteen film titles are also Pictionary words —
   * "Gravity", "Queen", "Casino", "Ship of Theseus" — and they are different
   * cards in different games. Sharing an ordinal would mean drawing "Gravity"
   * in Cryptic silently spent the film, and vice versa.
   */
  it('gives a film and a Pictionary word of the same name different ordinals', () => {
    const norm = (s: string): string =>
      s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const words = new Map<string, number>();
    for (const tier of TIERS) {
      for (const word of bundle(tier).words) words.set(norm(word.t), word.o);
    }

    const shared: string[] = [];
    for (const deck of CHARADES_DECKS) {
      for (const film of bundle(deck).words) {
        const twin = words.get(norm(film.t));
        if (twin === undefined) continue;
        shared.push(film.t);
        expect(film.o, `${film.t} shares an ordinal with the Pictionary word`).not.toBe(twin);
      }
    }

    // Guard the guard: if the overlap ever falls to zero this test stops
    // testing anything, and should be deleted rather than quietly passing.
    expect(shared.length, 'no title overlaps a Pictionary word any more').toBeGreaterThan(0);
  });
});

describe('the mixed deck', () => {
  it('ships no corpus of its own', () => {
    // Mixed deals from the two film decks and writes to their bitmaps. A
    // mixed.json would mean films that can be served twice, or films only ever
    // reachable from one screen. See src/engine/mixed.ts.
    expect(existsSync(join('public', 'corpus', 'mixed.json'))).toBe(false);
    expect(Object.keys(manifest.tiers)).not.toContain('mixed');
  });
});

describe('film titles', () => {
  const films = CHARADES_DECKS.flatMap((deck) => bundle(deck).words);

  it('fit the word screen — 44 characters at most', () => {
    for (const film of films) {
      expect(film.t.length, `${film.t} is ${film.t.length} chars`).toBeLessThanOrEqual(44);
    }
  });

  it('appears once across both film decks', () => {
    const seen = new Set(films.map((f) => f.t.toLowerCase()));
    expect(seen.size).toBe(films.length);
  });

  it('clears ten heavy sessions per deck, and Mixed clears twenty', () => {
    // A charades session is ~25 draws: acting a title takes longer than drawing
    // a cat, and the room talks more between rounds.
    for (const deck of CHARADES_DECKS) {
      expect(bundle(deck).count, `${deck} is short of the 10-session bar`).toBeGreaterThanOrEqual(
        250,
      );
    }
    expect(films.length).toBeGreaterThanOrEqual(500);
  });
});
