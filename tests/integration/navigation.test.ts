// @vitest-environment jsdom
/**
 * Back-button routing.
 *
 * The bug this suite exists to prevent: back closed the app from every screen,
 * not just from tier select. `go()` pushed a history entry only when the
 * *current* view was `tiers`, and `startGame()` switches to `loading` before it
 * navigates — so the game screen was entered with no entry of its own, and the
 * hardware back button on Android sailed straight past the app mid-round.
 *
 * The rule now: every screen but tier select owns a history entry, so back is
 * always "the previous screen", and only at tier select — where the app has no
 * entry left to pop — does it leave.
 *
 * jsdom runs history traversals asynchronously, hence `popped()` rather than a
 * bare call to `history.back()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from '../../src/ui/app';
import { resetCorpusCache } from '../../src/state/corpus';
import { TIERS } from '../../src/engine/types';

const WORDS = Array.from({ length: 12 }, (_, i) => ({
  o: i,
  t: `word ${i}`,
  w: 1,
  c: `cat-${i % 3}`,
}));

const manifest = {
  corpusVersion: 'test.1',
  tiers: Object.fromEntries(
    TIERS.map((tier) => [tier, { count: WORDS.length, maxOrd: WORDS.length - 1, points: 2 }]),
  ),
};

const bundleFor = (tier: string): unknown => ({
  corpusVersion: 'test.1',
  tier,
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

const startEasy = (): void => {
  root.querySelectorAll<HTMLButtonElement>('.tier-card')[0]?.click();
};

describe('history', () => {
  it('lands on tier select with an entry of its own', () => {
    expect(root.querySelector('.tiers')).not.toBeNull();
    expect(viewName()).toBe('tiers');
  });

  it('gives the game screen a history entry — the bug that closed the app', async () => {
    startEasy();
    await vi.waitFor(() => expect(root.querySelector('.play')).not.toBeNull());
    expect(viewName()).toBe('game');
  });

  it('returns to tier select from the game instead of leaving the app', async () => {
    startEasy();
    await vi.waitFor(() => expect(root.querySelector('.play')).not.toBeNull());

    await popped(() => history.back());

    expect(root.querySelector('.tiers')).not.toBeNull();
    expect(root.querySelector('.play')).toBeNull();
    expect(viewName()).toBe('tiers');
  });

  it('returns to tier select from settings and from team setup', async () => {
    for (const label of ['Settings', 'Add teams']) {
      const button = [...root.querySelectorAll<HTMLButtonElement>('.screen__foot .btn')].find((b) =>
        b.textContent?.includes(label),
      );
      button?.click();
      expect(root.querySelector('.tiers')).toBeNull();

      await popped(() => history.back());
      expect(root.querySelector('.tiers'), label).not.toBeNull();
      expect(viewName()).toBe('tiers');
    }
  });

  it('keeps one entry per visit, so one back always reaches tier select', async () => {
    // An in-app Back button must spend the entry it arrived on rather than
    // stacking a second one — otherwise the hardware button appears to do
    // nothing the first time it is pressed.
    const settings = [...root.querySelectorAll<HTMLButtonElement>('.screen__foot .btn')].find((b) =>
      b.textContent?.includes('Settings'),
    );
    settings?.click();

    const done = [...root.querySelectorAll<HTMLButtonElement>('.screen__foot .btn')].find((b) =>
      b.textContent?.trim().startsWith('Done'),
    );
    expect(done, 'settings has a Done button').toBeDefined();

    await popped(() => done?.click());
    expect(root.querySelector('.tiers')).not.toBeNull();
    expect(viewName()).toBe('tiers');
  });

  it('abandons an unfinished game on the way out, leaving drawn words burned', async () => {
    startEasy();
    await vi.waitFor(() => expect(root.querySelector('.play')).not.toBeNull());

    const before = root.querySelector('.tier-card__left')?.textContent;
    await popped(() => history.back());
    const after = root.querySelector('.tier-card__left')?.textContent;

    // One word was revealed, so one word is gone — leaving mid-round does not
    // hand it back.
    expect(after).not.toBe(before);
    expect(after).toContain(`${WORDS.length - 1} words left`);
  });
});
