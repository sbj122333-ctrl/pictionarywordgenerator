// @vitest-environment jsdom
/**
 * FR-08 / invariant 4. TECHNICAL_SPEC §8.3.
 *
 * "cover → reveal puts the word in the DOM; before reveal, assert the word
 * string is ABSENT from document.body.innerHTML. This is a real test, not a
 * formality — it is the one bug that silently ruins gameplay."
 *
 * The failure mode this catches has no symptom. A word pre-rendered at
 * opacity 0, or behind [hidden], or in a detached node attached on tap, looks
 * completely correct in every screenshot and every manual pass. It only shows up
 * as a room where somebody keeps guessing suspiciously fast.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PackedWord, RuntimeBundle } from '../../src/engine/types';
import { createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';
import { GameSession } from '../../src/state/session';
import { coverScreen, playScreen } from '../../src/ui/screens/game';

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
  const game = new GameSession({ tier, deck, teams: [], onDraw: () => {} });
  game.toCover();
  return game;
}

beforeEach(() => {
  // jsdom implements neither of these, and the play screen consults both.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.body.textContent = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.textContent = '';
});

describe('the cover screen', () => {
  it('does not put the word in the document before the reveal', () => {
    const game = session([{ o: 0, t: WORD, w: 2, c: 'abstract' }]);

    const cover = coverScreen({
      tier: 'hard',
      teamName: null,
      round: 1,
      onReveal: () => {},
    });
    document.body.appendChild(cover.node);

    expect(document.body.innerHTML).not.toContain(WORD);
    // Nor anywhere else in the document, including attributes and any detached
    // node that has since been attached.
    expect(document.documentElement.outerHTML).not.toContain(WORD);
    // And nothing has been drawn — the burn happens on the reveal, not on entry.
    expect(game.current).toBeNull();
    expect(game.remaining()).toBe(1);
  });

  it('puts the word in the document on the reveal, and only then', () => {
    const game = session([{ o: 0, t: WORD, w: 2, c: 'abstract' }]);
    const root = document.createElement('div');
    document.body.appendChild(root);

    const cover = coverScreen({
      tier: 'hard',
      teamName: 'Team 2',
      round: 7,
      onReveal: () => {
        const word = game.reveal();
        root.textContent = '';
        if (word) {
          root.appendChild(
            playScreen({
              word,
              tier: 'hard',
              remaining: game.remaining(),
              depletion: game.depletion(),
              timerSeconds: null,
              twist: null,
              onResolve: () => {},
              onHint: () => {},
              onQuit: () => {},
            }).node,
          );
        }
      },
    });
    root.appendChild(cover.node);

    expect(document.body.innerHTML).not.toContain(WORD);

    const button = root.querySelector('button.cover');
    expect(button).not.toBeNull();
    (button as HTMLButtonElement).click();

    expect(document.body.innerHTML).toContain(WORD);
    expect(game.remaining()).toBe(0);
  });

  it('is a button with an accessible name, not a click-handled div', () => {
    const cover = coverScreen({ tier: 'easy', teamName: null, round: 1, onReveal: () => {} });
    document.body.appendChild(cover.node);

    const button = document.body.querySelector('button.cover');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(10);
  });

  it('reveals on Space and Enter', () => {
    const reveal = vi.fn();
    const cover = coverScreen({ tier: 'easy', teamName: null, round: 1, onReveal: reveal });
    cover.onKey?.(new KeyboardEvent('keydown', { key: ' ' }));
    cover.onKey?.(new KeyboardEvent('keydown', { key: 'Enter' }));
    cover.onKey?.(new KeyboardEvent('keydown', { key: 'q' }));
    expect(reveal).toHaveBeenCalledTimes(2);
  });
});

describe('the word screen', () => {
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
      onHint: () => game.revealHint(),
      onQuit: () => {},
    }).node;
    document.body.appendChild(node);
    return node;
  };

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

  it('offers a hint on god tier only, and swaps it for the text once revealed', () => {
    document.body.textContent = '';
    const plain = render({ o: 0, t: 'no hint here', w: 3, c: 'x' }, 'hard');
    expect(plain.querySelector('.hint-btn')).toBeNull();

    document.body.textContent = '';
    const god = render(
      { o: 0, t: 'bystander effect', w: 2, c: 'biases', h: 'A crowd watched. Nobody helped.' },
      'god',
    );
    const button = god.querySelector<HTMLButtonElement>('.hint-btn');
    expect(button?.textContent).toContain('½ points');

    button?.click();
    expect(god.querySelector('.hint-btn')).toBeNull();
    expect(god.querySelector('.hint-text')?.textContent).toBe('A crowd watched. Nobody helped.');
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
      onHint: () => {},
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
