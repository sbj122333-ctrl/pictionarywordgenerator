// @vitest-environment jsdom
/**
 * Back-button routing.
 *
 * The bug this suite exists to prevent: back closed the app from every screen,
 * not just from the front one. `go()` pushed a history entry only when the
 * *current* view was the deck list, and `startGame()` switches to `loading`
 * before it navigates — so the game screen was entered with no entry of its own,
 * and the hardware back button on Android sailed straight past the app
 * mid-round.
 *
 * The rule now: every screen but the game picker owns a history entry, so back
 * is always "the previous screen", and only at home — where the app has no entry
 * left to pop — does it leave. Adding Dumb Charades put a screen in front of the
 * deck list, which makes that rule load-bearing one level deeper: home → decks →
 * game has to unwind one screen at a time.
 *
 * jsdom runs history traversals asynchronously, hence `popped()` rather than a
 * bare call to `history.back()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from '../../src/ui/app';
import { resetCorpusCache } from '../../src/state/corpus';
import { DECKS } from '../../src/engine/types';

const WORDS = Array.from({ length: 12 }, (_, i) => ({
  o: i,
  t: `word ${i}`,
  w: 1,
  c: `cat-${i % 3}`,
}));

const manifest = {
  corpusVersion: 'test.1',
  tiers: Object.fromEntries(
    DECKS.map((deck) => [deck, { count: WORDS.length, maxOrd: WORDS.length - 1, points: 2 }]),
  ),
};

const bundleFor = (deck: string): unknown => ({
  corpusVersion: 'test.1',
  tier: deck,
  points: 2,
  count: WORDS.length,
  maxOrd: WORDS.length - 1,
  words: WORDS,
});

function stubFetch(): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = String(input);
    const body = url.includes('manifest')
      ? manifest
      : bundleFor(url.split('/').pop()?.replace('.json', '') ?? 'easy');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
}

/** Runs `action`, then settles once jsdom has delivered the popstate. */
async function popped(action: () => void): Promise<void> {
  const landed = new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
  });
  action();
  await landed;
  await Promise.resolve();
}

let root: HTMLDivElement;

beforeEach(async () => {
  stubFetch();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  resetCorpusCache();
  localStorage.clear();
  document.body.textContent = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  await new App(root).start();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.textContent = '';
});

const viewName = (): string | undefined =>
  (history.state as { view?: { name?: string } } | null)?.view?.name;

/** Index 0 is Pictionary, index 1 is Dumb Charades — GAMES order. */
const openGame = (index: number): void => {
  root.querySelectorAll<HTMLButtonElement>('.game-card')[index]?.click();
};

const startFirstDeck = (): void => {
  openGame(0);
  root.querySelectorAll<HTMLButtonElement>('.tier-card')[0]?.click();
};

const footButton = (label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('.screen__foot .btn')].find((b) =>
    b.textContent?.includes(label),
  );

describe('history', () => {
  it('lands on the game picker with an entry of its own', () => {
    expect(root.querySelector('.games')).not.toBeNull();
    expect(root.querySelectorAll('.game-card')).toHaveLength(3);
    expect(viewName()).toBe('home');
  });

  it('offers Hexhaven as a link out, not an in-app game', () => {
    // It has no corpus and no bitmap, so it must not be reachable through the
    // GAMES path — a regression here would mean widening Record<Game, ...>.
    const away = root.querySelector<HTMLAnchorElement>('.game-card--away');
    expect(away).not.toBeNull();
    expect(away?.tagName).toBe('A');
    expect(away?.getAttribute('href')).toBe('/hexhaven/');
    // and it is last, so the GAMES indices used elsewhere in this file hold
    expect([...root.querySelectorAll('.game-card')].indexOf(away!)).toBe(2);
  });

  it('opens a deck list per game — four tiers, three film decks', async () => {
    openGame(0);
    expect(root.querySelectorAll('.tier-card')).toHaveLength(4);
    expect(viewName()).toBe('decks');

    await popped(() => footButton('All games')?.click());
    openGame(1);
    expect(root.querySelectorAll('.tier-card')).toHaveLength(3);
  });

  it('returns to the game picker from a deck list', async () => {
    openGame(1);
    expect(root.querySelector('.games')).toBeNull();

    await popped(() => history.back());
    expect(root.querySelector('.games')).not.toBeNull();
    expect(viewName()).toBe('home');
  });

  it('gives the game screen a history entry — the bug that closed the app', async () => {
    startFirstDeck();
    await vi.waitFor(() => expect(root.querySelector('.play')).not.toBeNull());
    expect(viewName()).toBe('game');
  });

  it('returns to the deck list from the game instead of leaving the app', async () => {
    startFirstDeck();
    await vi.waitFor(() => expect(root.querySelector('.play')).not.toBeNull());

    await popped(() => history.back());

    expect(root.querySelector('.tiers')).not.toBeNull();
    expect(root.querySelector('.play')).toBeNull();
    expect(viewName()).toBe('decks');
  });

  it('returns to the deck list from settings and from team setup', async () => {
    openGame(0);
    for (const label of ['Settings', 'Add teams']) {
      footButton(label)?.click();
      expect(root.querySelector('.tiers')).toBeNull();

      await popped(() => history.back());
      expect(root.querySelector('.tiers'), label).not.toBeNull();
      expect(viewName()).toBe('decks');
    }
  });

  it('keeps one entry per visit, so one back always reaches the deck list', async () => {
    // An in-app Back button must spend the entry it arrived on rather than
    // stacking a second one — otherwise the hardware button appears to do
    // nothing the first time it is pressed.
    openGame(0);
    footButton('Settings')?.click();

    const done = [...root.querySelectorAll<HTMLButtonElement>('.screen__foot .btn')].find((b) =>
      b.textContent?.trim().startsWith('Done'),
    );
    expect(done, 'settings has a Done button').toBeDefined();

    await popped(() => done?.click());
    expect(root.querySelector('.tiers')).not.toBeNull();
    expect(viewName()).toBe('decks');
  });

  it('abandons an unfinished game on the way out, leaving drawn words burned', async () => {
    startFirstDeck();
    await vi.waitFor(() => expect(root.querySelector('.play')).not.toBeNull());

    await popped(() => history.back());

    // One word was revealed, so one word is gone — leaving mid-round does not
    // hand it back.
    const after = root.querySelector('.tier-card__left')?.textContent;
    expect(after).toContain(`${WORDS.length - 1} words left`);
  });

  it('counts the mixed deck as both film decks together', () => {
    openGame(1);
    const counts = [...root.querySelectorAll('.tier-card__left')].map((n) => n.textContent);
    expect(counts[0]).toContain(`${WORDS.length} films left`);
    expect(counts[1]).toContain(`${WORDS.length} films left`);
    expect(counts[2]).toContain(`${WORDS.length * 2} films left`);
  });
});
