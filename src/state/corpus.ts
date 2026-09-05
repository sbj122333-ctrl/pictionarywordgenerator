/**
 * Corpus loading. TECHNICAL_SPEC §2.2.
 *
 * Bundles are fetched lazily — starting a game downloads that tier and nothing
 * else. But DESIGN_SPEC §3.1 also requires the words-remaining count on every
 * tier card from the first second, because that count IS the product's
 * differentiator and burying it would be a strange way to lead.
 *
 * Both hold because remaining is computable from the seen-bitmap plus a total,
 * and the totals live in a ~200-byte manifest generated from the bundles at
 * build time. Four numbers, not 16.6 KB of words.
 */
import type { DeckId, RuntimeBundle } from '../engine/types';
import { DECKS } from '../engine/types';

export interface TierSummary {
  count: number;
  maxOrd: number;
  points: number;
}

export interface CorpusManifest {
  corpusVersion: string;
  tiers: Record<DeckId, TierSummary>;
}

const base = import.meta.env.BASE_URL || '/';
const corpusUrl = (file: string): string => `${base.replace(/\/$/, '')}/corpus/${file}`;

let manifestPromise: Promise<CorpusManifest> | null = null;
const bundles = new Map<DeckId, Promise<RuntimeBundle>>();

export function loadManifest(): Promise<CorpusManifest> {
  manifestPromise ??= fetch(corpusUrl('manifest.json'))
    .then(async (r) => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      return fill((await r.json()) as CorpusManifest);
    })
    .catch((error: unknown) => {
      manifestPromise = null;
      throw error;
    });
  return manifestPromise;
}

/**
 * Fills in any deck the fetched manifest does not mention.
 *
 * `manifest.json` is not content-hashed and vercel.json caches /corpus/ for an
 * hour, so for up to an hour after a corpus release a returning browser can pair
 * freshly-served app code with the manifest from the release before it. That is
 * exactly what happened when the film decks were added: every read of
 * `manifest.tiers.hindi` would have been `undefined.count` — boot throws,
 * reconcile throws, and the app shows its error screen until the cache expires.
 *
 * A missing deck reads as zero instead. Its card says "Loading…", the bundle
 * still fetches on tap, and the count corrects itself on the next load. Nothing
 * is lost by under-reporting: `reconcileWithMaxOrd` never drops a bit above the
 * ceiling it is given, so a short maxOrd cannot resurrect anything.
 */
function fill(manifest: CorpusManifest): CorpusManifest {
  const tiers = {} as Record<DeckId, TierSummary>;
  for (const deck of DECKS) {
    tiers[deck] = manifest.tiers?.[deck] ?? { count: 0, maxOrd: 0, points: 1 };
  }
  return { corpusVersion: manifest.corpusVersion, tiers };
}

export function loadBundle(deck: DeckId): Promise<RuntimeBundle> {
  let pending = bundles.get(deck);
  if (!pending) {
    pending = fetch(corpusUrl(`${deck}.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`${deck} bundle ${r.status}`);
        return r.json() as Promise<RuntimeBundle>;
      })
      .catch((error: unknown) => {
        bundles.delete(deck);
        throw error;
      });
    bundles.set(deck, pending);
  }
  return pending;
}

/** Test seam: lets a test start from a known-empty cache. */
export function resetCorpusCache(): void {
  manifestPromise = null;
  bundles.clear();
}

export function emptyManifest(): CorpusManifest {
  return fill({ corpusVersion: '', tiers: {} as Record<DeckId, TierSummary> });
}
