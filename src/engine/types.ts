/**
 * Shared types for the memory engine.
 *
 * These mirror docs/TECHNICAL_SPEC.md §2 exactly. If you change a shape here,
 * change it there too — the spec is what the next session reads.
 *
 * Nothing in src/engine/ may import from src/ui/ or src/state/, touch the DOM,
 * or call Math.random(). ESLint enforces all three.
 */

export type Tier = 'easy' | 'moderate' | 'hard' | 'god';

export const TIERS: readonly Tier[] = ['easy', 'moderate', 'hard', 'god'] as const;

/** Tier-weighted scoring. A revealed hint halves the round's award. */
export const TIER_POINTS: Readonly<Record<Tier, number>> = {
  easy: 1,
  moderate: 2,
  hard: 3,
  god: 4,
};

export const TIER_LABELS: Readonly<Record<Tier, { name: string; difficulty: string }>> = {
  easy: { name: 'Doodle', difficulty: 'Easy' },
  moderate: { name: 'Sketch', difficulty: 'Moderate' },
  hard: { name: 'Cryptic', difficulty: 'Hard' },
  god: { name: 'God Mode', difficulty: 'Impossible' },
};

// ---------------------------------------------------------------------------
// Corpus — as shipped in public/corpus/<tier>.json
// ---------------------------------------------------------------------------

/** Single-character keys: this is the only payload that scales with corpus size. */
export interface PackedWord {
  /** Frozen ordinal. Append-only, never reused, never renumbered. */
  o: number;
  /** The word or phrase shown to the drawer. */
  t: string;
  /** Word count, 1-7. UI shows pips for 1-4 and a numeric badge for 5+. */
  w: number;
  /** Category slug, used for anti-clustering. */
  c: string;
  /** Hint. Present on god tier only, where it is mandatory. */
  h?: string;
}

export interface RuntimeBundle {
  corpusVersion: string;
  tier: Tier;
  points: number;
  count: number;
  maxOrd: number;
  words: PackedWord[];
}

/** What the UI receives from `Deck.draw()`. */
export interface RuntimeWord {
  ord: number;
  text: string;
  words: number;
  category: string;
  hint: string | null;
  tier: Tier;
  points: number;
}

// ---------------------------------------------------------------------------
// Device memory — the single persisted record, localStorage key `dq.v1`
// ---------------------------------------------------------------------------

export interface TierMemory {
  /** uint32 from crypto.getRandomValues, seeds the deck shuffle. */
  seed: number;
  /** Index into the materialised deck. Never the source of truth — the bitmap is. */
  cursor: number;
  /** Base64 dense bitmap indexed by ord. */
  seen: string;
  /** Completed exhaustions, for the deck-complete badge. */
  cycles: number;
}

export interface SessionRecord {
  at: number;
  tier: Tier;
  ords: number[];
  hits: number;
  teams?: Array<{ name: string; score: number }>;
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  timerSeconds: 60 | 90 | 120 | null;
  twists: boolean;
  sound: boolean;
  /** Display preference. Lives here because there is only ever one key. */
  theme: Theme;
  /** FR-10: one dismissal of the install card is remembered forever. */
  installDismissed: boolean;
}

export interface DeviceMemory {
  v: 1;
  corpusVersion: string;
  /** Epoch ms, written every load. Used for wipe detection. */
  heartbeat: number;
  tiers: Record<Tier, TierMemory>;
  /** Last 50 ords drawn across all tiers, for the recycle cooldown. */
  recent: number[];
  /** Last 3 sessions, for the summary screen. */
  sessions: SessionRecord[];
  settings: Settings;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  read(): DeviceMemory | null;
  /** Must be synchronous: a word is burned before it paints. */
  write(m: DeviceMemory): void;
  clear(): void;
}

export interface Deck {
  /** Next unseen word, burning it. Null when the tier is exhausted. */
  draw(): RuntimeWord | null;
  /** Unseen words left in this cycle. */
  remaining(): number;
  /** 0-1. The UI warns at >= 0.9. */
  depletion(): number;
  /** Fresh cycle: new seed, cleared bitmap, cooldown applied to recent ords. */
  recycle(): void;
}

export const STORAGE_KEY = 'dq.v1';
export const RECENT_WINDOW = 50;
export const DEPLETION_WARNING = 0.9;

export function defaultSettings(): Settings {
  return {
    timerSeconds: 90,
    twists: false,
    sound: true,
    theme: 'system',
    installDismissed: false,
  };
}
