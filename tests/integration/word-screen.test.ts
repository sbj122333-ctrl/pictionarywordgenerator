// @vitest-environment jsdom
/**
 * The word screen. TECHNICAL_SPEC §8.3.
 *
 * The cover interstitial that used to sit in front of this screen was removed in
 * Sep 2026, and with it the "word absent from the DOM before the reveal"
 * assertion — there is no longer a screen in between for it to be absent during.
 * What survives that change, and is tested here, is the half that still holds:
 * the word does not exist until `reveal()` is called, and `reveal()` burns it.
 *
 * The God Mode meaning is the other thing worth pinning. It is unconditional —
 * no button, no points penalty — and it must appear on god tier and nowhere
 * else, because a meaning under a Doodle word gives the answer away.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PackedWord, RuntimeBundle } from '../../src/engine/types';
import { createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';
import { GameSession } from '../../src/state/session';
import { playScreen } from '../../src/ui/screens/game';

const WORD = 'zzqqx-sentinel-word';

function bundle(words: PackedWord[], tier: RuntimeBundle['tier'] = 'hard'): RuntimeBundle {
  return {
    corpusVersion: 'test.1',
    tier,
    points: tier === 'god' ? 4 : 3,
    count: words.length,
    maxOrd: Math.max(...words.map((w) => w.o)),
    words,
  };
}

function session(words: PackedWord[], tier: RuntimeBundle['tier'] = 'hard'): GameSession {
  const source = bundle(words, tier);
  const deck = createDeck(source, createTierMemory(), [], () => {});
  return new GameSession({ tier, deck, teams: [], onDraw: () => {} });
}

beforeEach(() => {
  // jsdom implements neither of these, and the play screen consults both.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  document.body.textContent = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.textContent = '';
});

const render = (word: PackedWord, tier: RuntimeBundle['tier'] = 'hard'): HTMLElement => {
  const game = session([word], tier);
  const drawn = game.reveal();
  const node = playScreen({
    word: drawn!,
    tier,
    remaining: 0,
    depletion: 0,
    timerSeconds: null,
    twist: null,
    onResolve: () => {},
    onQuit: () => {},
  }).node;
  document.body.appendChild(node);
  return node;
};

describe('drawing a word', () => {
  it('has nothing to paint until reveal, and burns the word when it does', () => {
    const game = session([{ o: 0, t: WORD, w: 2, c: 'abstract' }]);

    expect(game.current).toBeNull();
    expect(game.remaining()).toBe(1);
    expect(document.body.innerHTML).not.toContain(WORD);

    const drawn = game.reveal();
    expect(drawn?.text).toBe(WORD);
    expect(game.remaining()).toBe(0);
  });

  it('puts the word in the document once the screen is built from it', () => {
    const node = render({ o: 0, t: WORD, w: 2, c: 'abstract' });
    expect(node.querySelector('.word')?.textContent).toBe(WORD);
  });
});

describe('the word screen', () => {
  it('shows a pip per word for one to four', () => {
    for (const count of [1, 2, 3, 4]) {
      document.body.textContent = '';
      const node = render({ o: 0, t: 'a phrase here', w: count, c: 'x' });
      expect(node.querySelectorAll('.pips__dot')).toHaveLength(count);
      expect(node.querySelector('.pips__count')).toBeNull();
    }
  });

  it('shows a numeric badge from five words up', () => {
    const node = render({ o: 0, t: 'a rather long phrase indeed', w: 6, c: 'x' });
    expect(node.querySelectorAll('.pips__dot')).toHaveLength(0);
    expect(node.querySelector('.pips__count')?.textContent).toBe('6 words');
  });

  it('hides the timer ring entirely when the timer is off', () => {
    const node = render({ o: 0, t: 'something', w: 1, c: 'x' });
    expect(node.querySelector('.timer')).toBeNull();
  });

  it('announces the word once through a live region', () => {
    const node = render({ o: 0, t: WORD, w: 1, c: 'x' });
    const live = node.querySelector('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe(WORD);
  });

  it('offers no hint button anywhere — the feature is gone', () => {
    const god = render(
      { o: 0, t: 'bystander effect', w: 2, c: 'biases', m: 'A crowd watched. Nobody helped.' },
      'god',
    );
    expect(god.querySelector('.hint-btn')).toBeNull();
    expect(god.textContent).not.toContain('points)');
  });

  it('prints the meaning under the word on god tier, with no tap needed', () => {
    const god = render(
      { o: 0, t: 'bystander effect', w: 2, c: 'biases', m: 'A crowd watched. Nobody helped.' },
      'god',
    );
    expect(god.querySelector('.meaning')?.textContent).toBe('A crowd watched. Nobody helped.');

    // And it sits below the word, which is the whole point of the request.
    const stage = god.querySelector('.play__stage');
    const order = [...(stage?.children ?? [])].map((child) => child.className);
    expect(order.indexOf('meaning')).toBeGreaterThan(order.findIndex((c) => c.startsWith('word')));
  });

  it('prints no meaning on the other three tiers', () => {
    for (const tier of ['easy', 'moderate', 'hard'] as const) {
      document.body.textContent = '';
      const node = render({ o: 0, t: 'no meaning here', w: 3, c: 'x' }, tier);
      expect(node.querySelector('.meaning'), tier).toBeNull();
    }
  });

  it('resolves on G, P and T, and leaves on Escape', () => {
    const game = session([{ o: 0, t: WORD, w: 1, c: 'x' }]);
    const word = game.reveal();
    const onResolve = vi.fn();
    const onQuit = vi.fn();
    const handle = playScreen({
      word: word!,
      tier: 'hard',
      remaining: 0,
      depletion: 0,
      timerSeconds: null,
      twist: null,
      onResolve,
      onQuit,
    });

    handle.onKey?.(new KeyboardEvent('keydown', { key: 'g' }));
    handle.onKey?.(new KeyboardEvent('keydown', { key: 'P' }));
    handle.onKey?.(new KeyboardEvent('keydown', { key: 't' }));
    handle.onKey?.(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onResolve.mock.calls.map((c) => c[0])).toEqual(['got', 'pass', 'timeout']);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
