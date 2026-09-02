/**
 * Category anti-clustering. TECHNICAL_SPEC §3.5, FR-16.
 *
 * One hard rule: **the same category never appears twice in a row.** That is the
 * thing a room actually notices, and it holds absolutely wherever the deck makes
 * it possible.
 *
 * There is deliberately no fixed per-window quota. The original spec asked for
 * "no more than 3 in any 20 draws", which reads like a clustering rule but is a
 * rate limit in disguise: 3-in-20 caps a category at 15% of a deck. Three of the
 * four shipping tiers hold a category above that — `states` is 19% of Cryptic,
 * `idioms` 17% of Sketch, `philosophy` 15% of God Mode — so the quota was not
 * merely hard to satisfy, it was arithmetically impossible, and enforcing it
 * only moved the surplus rather than removing it: refusing a category while it
 * is over quota drains everything else first and leaves Cryptic finishing on
 * forty unbroken `states`.
 *
 * So the deck is scheduled proportionally instead. At each position, among the
 * candidates in reach, take the category furthest BELOW its fair share of the
 * trailing window — where fair share is that category's portion of the words
 * still unplaced. A category holding a fifth of what remains is entitled to a
 * fifth of the window and is spread evenly at that rate; one holding a
 * twentieth is held to a twentieth. Nothing accumulates, so nothing has to be
 * dumped at the end.
 *
 * Ranking by deficit rather than by raw size is what stops the obvious failure
 * of a plain most-remaining-first greedy: with `states` at 38 and `social` at
 * 30, "always take the biggest that is not the last one" alternates the two of
 * them for sixteen straight draws. Once `states` is at its share, its deficit
 * goes negative and something else wins.
 *
 * This only ever swaps the order — every input word is emitted exactly once — so
 * the no-repeat guarantee is untouched. Asserted in
 * tests/property/anti-clustering.test.ts rather than assumed.
 *
 * A word can move at most POOL - 1 positions earlier (it has to reach the pool
 * to be picked), which is the bound the recycle cooldown in deck.ts relies on.
 */

const WINDOW = 20;

/** Sliding pool size. Wider means better mixing and a longer reach backwards. */
const POOL = 48;

/**
 * The furthest a word can travel towards the front of the deck. Exported because
 * the recycle cooldown depends on it: the cooldown boundary sits this much past
 * halfway so a cooled ord cannot be pulled back into the first half.
 */
export const LOOKAHEAD = POOL - 1;

export function applyAntiClustering(
  deck: readonly number[],
  categoryOf: (ord: number) => string,
): number[] {
  const n = deck.length;
  if (n <= 2) return deck.slice();

  // Resolved once and indexed alongside the ords. The loop consults them tens of
  // times per position.
  const cats = deck.map(categoryOf);

  /** How many words of each category are still unplaced. */
  const unplaced = new Map<string, number>();
  for (const cat of cats) unplaced.set(cat, (unplaced.get(cat) ?? 0) + 1);

  /** Categories among the last WINDOW - 1 emitted, counted for O(1) lookup. */
  const recentCount = new Map<string, number>();
  const recent: string[] = [];

  const out: number[] = [];
  const pool: number[] = [];
  let next = 0;

  const refill = (): void => {
    while (pool.length < POOL && next < n) {
      pool.push(next);
      next += 1;
    }
  };
  refill();

  while (pool.length > 0) {
    const last = recent[recent.length - 1];
    const totalLeft = n - out.length;

    let pick = -1;
    let bestDeficit = -Infinity;
    let bestLeft = -1;

    for (let p = 0; p < pool.length; p += 1) {
      const cat = cats[pool[p] as number] as string;
      if (cat === last) continue;

      const left = unplaced.get(cat) ?? 0;
      // How many slots of the trailing window this category is entitled to,
      // minus how many it has already taken. Positive means under-served.
      const deficit = (WINDOW * left) / totalLeft - (recentCount.get(cat) ?? 0);

      if (deficit > bestDeficit || (deficit === bestDeficit && left > bestLeft)) {
        bestDeficit = deficit;
        bestLeft = left;
        pick = p;
      }
    }

    // Everything in reach is the category just played. Nothing to be done — take
    // the next word rather than block. Only reachable on a deck whose remaining
    // words are all one category, which is the tail of a single-category tier.
    if (pick < 0) pick = 0;

    const source = pool[pick] as number;
    pool.splice(pick, 1);

    const cat = cats[source] as string;
    out.push(deck[source] as number);
    unplaced.set(cat, (unplaced.get(cat) ?? 1) - 1);

    recent.push(cat);
    recentCount.set(cat, (recentCount.get(cat) ?? 0) + 1);
    if (recent.length >= WINDOW) {
      const dropped = recent.shift() as string;
      recentCount.set(dropped, (recentCount.get(dropped) ?? 1) - 1);
    }

    refill();
  }

  return out;
}
