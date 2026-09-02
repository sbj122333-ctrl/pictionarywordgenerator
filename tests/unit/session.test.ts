/**
 * Session state machine and scoring. BUILD_PLAN tasks 7 and 11,
 * TECHNICAL_SPEC §5.
 *
 * The machine is worth testing in its own right because one method in it carries
 * the whole burn-on-reveal guarantee: `reveal()` is the only thing that draws.
 * If a draw ever moved anywhere else, a word could be burned that nobody saw,
 * and no other test in this suite would notice.
 */
import { describe, it, expect } from 'vitest';
import type { Deck, PackedWord, RuntimeBundle, Tier } from '../../src/engine/types';
import { createDeck } from '../../src/engine/deck';
import { createTierMemory } from '../../src/engine/storage';
import type { Phase } from '../../src/state/session';
import { GameSession, canTransition } from '../../src/state/session';
import { historySummary } from '../../src/ui/screens/settings';

const PHASES: Phase[] = ['idle', 'ready', 'playing', 'resolved', 'summary'];

function bundle(count: number, tier: Tier = 'moderate'): RuntimeBundle {
  const words: PackedWord[] = Array.from({ length: count }, (_, i) => ({
    o: i,
    t: `word ${i}`,
    w: 1,
    c: `cat-${i % 4}`,
    ...(tier === 'god' ? { m: `meaning ${i}` } : {}),
  }));
  return {
    corpusVersion: 't',
    tier,
    points: tier === 'god' ? 4 : 2,
    count,
    maxOrd: count - 1,
    words,
  };
}

function make(count = 20, tier: Tier = 'moderate', teams: string[] = []): GameSession {
  const source = bundle(count, tier);
  const deck: Deck = createDeck(source, createTierMemory(), [], () => {});
  return new GameSession({
    tier,
    deck,
    teams: teams.map((name) => ({ name, score: 0 })),
    onDraw: () => {},
  });
}

describe('transition table', () => {
  const legal: Array<[Phase, Phase]> = [
    ['idle', 'ready'],
    ['ready', 'playing'],
    ['playing', 'resolved'],
    ['playing', 'summary'],
    ['resolved', 'playing'],
    ['resolved', 'summary'],
    ['summary', 'idle'],
    ['summary', 'ready'],
  ];

  it('allows every edge in the diagram', () => {
    for (const [from, to] of legal) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('allows leaving any in-game phase for tier select, and nothing else extra', () => {
    // Esc and browser-back. DESIGN_SPEC §5.
    for (const phase of ['ready', 'playing', 'resolved'] as Phase[]) {
      expect(canTransition(phase, 'idle'), `${phase} -> idle`).toBe(true);
    }

    const allowed = new Set([
      ...legal.map(([a, b]) => `${a}->${b}`),
      'ready->idle',
      'playing->idle',
      'resolved->idle',
    ]);

    for (const from of PHASES) {
      for (const to of PHASES) {
        if (allowed.has(`${from}->${to}`)) continue;
        expect(canTransition(from, to), `${from} -> ${to} should be illegal`).toBe(false);
      }
    }
  });

  it('refuses an illegal transition at runtime rather than half-applying it', () => {
    const session = make();
    expect(() => session.resolve('got')).toThrow(/illegal transition/);
    expect(session.phase).toBe('ready');
  });
});

describe('drawing', () => {
  it('draws on the reveal and nowhere else', () => {
    const session = make(10);

    expect(session.remaining()).toBe(10);
    expect(session.current).toBeNull();

    session.reveal();
    expect(session.remaining()).toBe(9);
    expect(session.current).not.toBeNull();

    // Resolving must not draw: the burn already happened, and drawing here
    // would spend a word on a screen nobody is looking at.
    session.resolve('got');
    expect(session.remaining()).toBe(9);

    // nextRound() is a reveal, so exactly one more word leaves the deck.
    expect(session.nextRound()).not.toBeNull();
    expect(session.remaining()).toBe(8);
    expect(session.current).not.toBeNull();
  });

  it('reports exhaustion instead of throwing when the tier runs dry', () => {
    const session = make(1);
    expect(session.reveal()).not.toBeNull();
    session.resolve('got');
    expect(session.nextRound()).toBeNull();
    expect(session.exhausted).toBe(true);
  });

  it('lets an exhausted draw fall through to the summary', () => {
    const session = make(1);
    session.reveal();
    session.resolve('got');
    session.nextRound();
    expect(() => session.end()).not.toThrow();
    expect(session.phase).toBe('summary');
  });

  it('takes a second abandon without throwing', () => {
    // Esc, browser-back and an explicit quit can all land here for one
    // departure. Navigation must not be able to throw.
    const session = make(5);
    session.reveal();
    session.abandon();
    expect(() => session.abandon()).not.toThrow();
    expect(session.phase).toBe('idle');
  });
});

describe('scoring', () => {
  const playRound = (session: GameSession, outcome: 'got' | 'pass' | 'timeout'): void => {
    // A round that has just been resolved is already drawn by nextRound(); only
    // the first round of a session needs a reveal of its own.
    if (session.phase !== 'playing') session.reveal();
    session.resolve(outcome);
  };

  it('awards tier-weighted points, and only for got it', () => {
    const session = make(10, 'moderate', ['A', 'B']);
    playRound(session, 'got');
    expect(session.teams[0]?.score).toBe(2);

    session.nextRound();
    playRound(session, 'pass');
    expect(session.teams[1]?.score).toBe(0);

    session.nextRound();
    playRound(session, 'timeout');
    expect(session.teams[0]?.score).toBe(2);
  });

  it('awards God Mode in full — the meaning is free, there is no hint to pay for', () => {
    const session = make(10, 'god', ['A']);
    playRound(session, 'got');
    expect(session.rounds[0]?.points).toBe(4);
    expect(session.teams[0]?.score).toBe(4);
  });

  it('rotates teams between rounds', () => {
    const session = make(10, 'moderate', ['A', 'B', 'C']);
    expect(session.activeTeam).toBe(0);
    playRound(session, 'got');
    session.nextRound();
    expect(session.activeTeam).toBe(1);
    session.resolve('got');
    session.nextRound();
    expect(session.activeTeam).toBe(2);
    session.resolve('got');
    session.nextRound();
    expect(session.activeTeam).toBe(0);
  });

  it('runs unscored when teams were skipped', () => {
    const session = make(10);
    expect(session.scoring).toBe(false);
    playRound(session, 'got');
    expect(session.rounds[0]?.points).toBe(2);
    expect(session.rounds[0]?.team).toBeNull();
    expect(session.winner).toBeNull();
  });

  it('reports a draw rather than crowning whoever sorted first', () => {
    const session = make(10, 'moderate', ['A', 'B']);
    playRound(session, 'got');
    session.nextRound();
    session.resolve('got');
    expect(session.teams[0]?.score).toBe(2);
    expect(session.teams[1]?.score).toBe(2);
    expect(session.drawn).toBe(true);
  });

  it('records every round for the summary', () => {
    const session = make(10, 'moderate', ['A']);
    playRound(session, 'got');
    session.nextRound();
    session.resolve('timeout');

    expect(session.rounds).toHaveLength(2);
    expect(session.hits).toBe(1);
    expect(session.ords).toHaveLength(2);
    expect(new Set(session.ords).size).toBe(2);
  });
});

describe('history summary copy', () => {
  it('does not say "1 tiers"', () => {
    expect(historySummary(1, 1)).toBe('1 word played across 1 tier.');
    expect(historySummary(32, 1)).toBe('32 words played across 1 tier.');
    expect(historySummary(1_200, 4)).toBe('1,200 words played across 4 tiers.');
    expect(historySummary(0, 0)).toBe('Nothing played yet on this browser.');
  });
});
