/**
 * Session state machine. TECHNICAL_SPEC §5.
 *
 *   idle ──pick tier──► ready ──start──► cover ──reveal──► playing
 *                         ▲                                   │
 *                         │                          ┌────────┴────────┐
 *                         │                       got it / pass / timeout
 *                         │                                   │
 *                         └──────── next drawer ◄─────── resolved
 *                                        │
 *                                   end session
 *                                        ▼
 *                                     summary
 *
 * Only `cover → playing` draws a word, and it draws on the reveal, not on entry
 * to the cover screen. That ordering is what makes the burn crash-safe: the word
 * does not exist until someone has asked to see it, and by the time they do the
 * burn is already durable.
 */
import type { Deck, RuntimeWord, Tier } from '../engine/types';

export type Phase = 'idle' | 'ready' | 'cover' | 'playing' | 'resolved' | 'summary';
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
  hintUsed: boolean;
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
  ready: ['cover', 'idle'],
  cover: ['playing', 'idle'],
  playing: ['resolved', 'idle'],
  resolved: ['cover', 'summary', 'idle'],
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
  hintRevealed = false;
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

  /** ready → cover, and resolved → cover. Never draws. */
  toCover(): void {
    this.to('cover');
    this.current = null;
    this.hintRevealed = false;
  }

  /**
   * cover → playing. The only edge that draws.
   *
   * INVARIANT 4: the word is not in the document before this runs. The caller
   * renders the word screen from the value returned here — it must not have been
   * fetched, pre-rendered, hidden or held at opacity 0 beforehand.
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

  /** God Mode only. Irreversible, and halves the round's award. */
  revealHint(): void {
    if (this.phase === 'playing' && this.current?.hint) this.hintRevealed = true;
  }

  resolve(outcome: Outcome): void {
    const word = this.current;
    this.to('resolved');
    if (!word) return;

    // All three outcomes burn the word — the burn already happened on reveal.
    // Only "got it" scores.
    const points = outcome === 'got' ? this.award(word.points) : 0;
    if (points > 0 && this.scoring) {
      const team = this.teams[this.activeTeam];
      if (team) team.score += points;
    }

    this.rounds.push({
      ord: word.ord,
      text: word.text,
      outcome,
      points,
      hintUsed: this.hintRevealed,
      team: this.scoring ? this.activeTeam : null,
    });
  }

  private award(base: number): number {
    return this.hintRevealed ? Math.ceil(base / 2) : base;
  }

  /** resolved → cover, passing the device to the next drawer. */
  nextRound(): void {
    if (this.scoring) this.activeTeam = (this.activeTeam + 1) % this.teams.length;
    this.toCover();
  }

  end(): void {
    this.to('summary');
    this.current = null;
  }

  abandon(): void {
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
