/**
 * Manifest loading across a corpus release.
 *
 * `public/corpus/manifest.json` is the one shipped file that is neither
 * content-hashed nor short-cached — vercel.json gives /corpus/ an hour — so for
 * up to an hour after a release a browser can hold the previous manifest while
 * running the new app code. Adding the film decks is the case that made that
 * matter: every `manifest.tiers.hindi` would have been `undefined.count`, and
 * boot, reconcile and the deck-select screen would all have thrown.
 *
 * A deck the manifest does not mention reads as zero and corrects itself on the
 * next load, which is the only failure mode this product can afford here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { emptyManifest, loadManifest, resetCorpusCache } from '../../src/state/corpus';
import { reconcileAll } from '../../src/state/store';
import { createDeviceMemory } from '../../src/engine/storage';
import { DECKS, TIERS } from '../../src/engine/types';

/** A manifest from before the film decks existed: four tiers and nothing else. */
const PREVIOUS = {
  corpusVersion: '2026.09.2',
  tiers: Object.fromEntries(TIERS.map((t) => [t, { count: 100, maxOrd: 99, points: 2 }])),
};

function stubFetch(body: unknown): void {
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetCorpusCache();
});

describe('loadManifest', () => {
  it('fills in decks a stale manifest has never heard of', async () => {
    resetCorpusCache();
    stubFetch(PREVIOUS);

    const manifest = await loadManifest();

    expect(Object.keys(manifest.tiers).sort()).toEqual([...DECKS].sort());
    expect(manifest.tiers.hindi).toEqual({ count: 0, maxOrd: 0, points: 1 });
    // The decks it does know are passed through untouched.
    expect(manifest.tiers.easy).toEqual({ count: 100, maxOrd: 99, points: 2 });
  });

  it('survives a manifest with no tiers at all rather than throwing', async () => {
    resetCorpusCache();
    stubFetch({ corpusVersion: 'x' });

    const manifest = await loadManifest();
    for (const deck of DECKS) expect(manifest.tiers[deck].count).toBe(0);
  });

  it('lets a release-day reconcile run without touching stored history', async () => {
    resetCorpusCache();
    stubFetch(PREVIOUS);
    const manifest = await loadManifest();

    const memory = createDeviceMemory('2026.09.1');
    // Something played in a deck the stale manifest does not list.
    memory.tiers.hindi = { seed: 1, cursor: 0, seen: 'BA==', cycles: 0 };

    const next = reconcileAll(memory, manifest);

    expect(next.corpusVersion).toBe('2026.09.2');
    // A short maxOrd never drops a bit: the ord stays seen, so the film stays
    // played. Under-reporting a total is safe; resurrecting an entry is not.
    expect(next.tiers.hindi.seen).toBe(memory.tiers.hindi.seen);
  });

  it('emptyManifest covers every deck, so a pre-boot render has numbers to show', () => {
    const empty = emptyManifest();
    expect(Object.keys(empty.tiers).sort()).toEqual([...DECKS].sort());
  });
});
