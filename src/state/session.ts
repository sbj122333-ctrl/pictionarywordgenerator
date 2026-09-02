/**
 * Session state machine. TECHNICAL_SPEC §5.
 *
 *   idle ──pick tier──► ready ──reveal──► playing
 *                         ▲                  │
 *                         │         ┌────────┴────────┐
 *                         │      got it / pass / timeout
 *                         │                  │
 *                         └── next drawer ◄─ resolved
 *                                  │
 *                             end session
 *                                  ▼
 *                               summary
 *
 * `reveal()` is the only edge that draws, and it draws at the moment the word is
 * about to paint. That ordering is what makes the burn crash-safe: the burn is
 * durable before the caller has anything to render.
 *
 * There is no cover screen. The interstitial was removed at Sabuj's request
 * (Sep 2026): the handover moment is now the "Next drawer" button on the
 * resolved screen, which is where the phone actually changes hands.
 */
import type { Deck, RuntimeWord, Tier } from '../engine/types';

export type Phase = 'idle' | 'ready' | 'playing' | 'resolved' | 'summary';
export type Outcome = 'got' | 'pass' | 'timeout';

export interface Team {
  name: string;
  score: number;
}

export interface Round {
  ord: number;
  text: string;
  outcome: Outcome;
  points: number;
  team: number | null;
}

/**
 * Every legal edge, written down. Anything absent from this table cannot happen:
 * `to()` refuses it rather than trusting callers to only ask for sensible things.
 *
 * `idle` appears as a target on the in-game phases and is not in the diagram.
 * That edge is Esc, and browser-back, which DESIGN_SPEC §5 requires — leaving a
 * game must land on tier select with the record intact, not wedge the machine.
 * Words already drawn stay burned, which is correct: they were revealed.
 */
const TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  idle: ['ready'],
  ready: ['playing', 'idle'],
  // `playing → summary` is the exhausted draw: `reveal()` has already entered
  // `playing` when the deck answers null, and the only thing left to do with a
  // tier that has run dry is end the session.
  playing: ['resolved', 'summary', 'idle'],
  resolved: ['playing', 'summary', 'idle'],
  summary: ['idle', 'ready'],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface SessionOptions {
  tier: Tier;
  deck: Deck;
  teams: Team[];
  /** Called after every draw so the cooldown window stays current. */
  onDraw: (word: RuntimeWord) => void;
}

export class GameSession {
  phase: Phase = 'ready';
  current: RuntimeWord | null = null;
  rounds: Round[] = [];
  activeTeam = 0;
  /** Set when the tier runs dry mid-session. */
  exhausted = false;

  readonly tier: Tier;
  readonly teams: Team[];
  private readonly deck: Deck;
  private readonly onDraw: (word: RuntimeWord) => void;

  constructor(options: SessionOptions) {
    this.tier = options.tier;
    this.deck = options.deck;
    this.teams = options.teams;
    this.onDraw = options.onDraw;
  }

  get scoring(): boolean {
    return this.teams.length > 0;
  }

  remaining(): number {
    return this.deck.remaining();
  }

  depletion(): number {
    return this.deck.depletion();
  }

  private to(phase: Phase): void {
    if (!canTransition(this.phase, phase)) {
      throw new Error(`illegal transition ${this.phase} -> ${phase}`);
    }
    this.phase = phase;
  }

  /**
   * ready → playing, and resolved → playing. The only edge that draws.
   *
   * INVARIANT 2: the burn is persisted inside `deck.draw()` before it returns,
   * so it is already durable by the time the caller has a word to paint.
   */
  reveal(): RuntimeWord | null {
    this.to('playing');
    const word = this.deck.draw();
    if (!word) {
      this.exhausted = true;
      this.current = null;
      return null;
    }
    this.current = word;
    this.onDraw(word);
    return word;
  }

  resolve(outcome: Outcome): void {
    const word = this.current;
    this.to('resolved');
    if (!word) return;

    // All three outcomes burn the word — the burn already happened on reveal.
    // Only "got it" scores.
    const points = outcome === 'got' ? word.points : 0;
    if (points > 0 && this.scoring) {
      const team = this.teams[this.activeTeam];
      if (team) team.score += points;
    }

    this.rounds.push({
      ord: word.ord,
      text: word.text,
      outcome,
      points,
      team: this.scoring ? this.activeTeam : null,
    });
  }

  /**
   * resolved → playing, passing the device to the next drawer and drawing their
   * word in one step. Returns null when the tier ran dry.
   */
  nextRound(): RuntimeWord | null {
    if (this.scoring) this.activeTeam = (this.activeTeam + 1) % this.teams.length;
    return this.reveal();
  }

  end(): void {
    this.to('summary');
    this.current = null;
  }

  /**
   * Leave the game. Idempotent on purpose: browser-back, Esc and an explicit
   * quit can all reach this, sometimes twice for one departure, and a thrown
   * "illegal transition" in the middle of navigation is worse than a no-op.
   */
  abandon(): void {
    if (this.phase === 'idle') return;
    this.to('idle');
    this.current = null;
  }

  get hits(): number {
    return this.rounds.filter((r) => r.outcome === 'got').length;
  }

  get ords(): number[] {
    return this.rounds.map((r) => r.ord);
  }

  get winner(): Team | null {
    if (!this.scoring) return null;
    return [...this.teams].sort((a, b) => b.score - a.score)[0] ?? null;
  }

  /** True when the top score is shared — the summary must not crown a winner. */
  get drawn(): boolean {
    if (!this.scoring) return false;
    const top = this.winner?.score ?? 0;
    return this.teams.filter((t) => t.score === top).length > 1;
  }
}
