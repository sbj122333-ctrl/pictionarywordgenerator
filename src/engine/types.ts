/**
 * Shared types for the memory engine.
 *
 * These mirror docs/TECHNICAL_SPEC.md §2 exactly. If you change a shape here,
 * change it there too — the spec is what the next session reads.
 *
 * Nothing in src/engine/ may import from src/ui/ or src/state/, touch the DOM,
 * or call Math.random(). ESLint enforces all three.
 *
 * Two games, seven things you can pick, six decks.
 *
 *   Tier          the four Pictionary tiers. Drawn.
 *   CharadesDeck  the two film decks. Acted.
 *   DeckId        anything with a corpus bundle and a seen-bitmap of its own.
 *   PlayableDeck  anything you can tap on a deck-select screen — DeckId, plus
 *                 `mixed`, which has no corpus. Mixed deals alternately from the
 *                 two film decks and writes through to *their* bitmaps, so a
 *                 film seen in Mixed never comes back in Bollywood either. A
 *                 corpus of its own would have been the easy version and would
 *                 have broken the one guarantee this product makes.
 */

export type Tier = 'easy' | 'moderate' | 'hard' | 'expert' | 'god';
export type CharadesDeck = 'hindi' | 'english';

/** A deck with a bundle in public/corpus and a TierMemory in the record. */
export type DeckId = Tier | CharadesDeck;

/** A deck you can start a session with. `mixed` is a view over two others. */
export type PlayableDeck = DeckId | 'mixed';

export type Game = 'pictionary' | 'charades';

export const TIERS: readonly Tier[] = ['easy', 'moderate', 'hard', 'expert', 'god'] as const;
export const CHARADES_DECKS: readonly CharadesDeck[] = ['hindi', 'english'] as const;

/** Every deck that owns a corpus. Iterate this for storage, not TIERS. */
export const DECKS: readonly DeckId[] = [...TIERS, ...CHARADES_DECKS];

/** Every deck that can start a session, including the corpus-less `mixed`. */
export const PLAYABLE_DECKS: readonly PlayableDeck[] = [...DECKS, 'mixed'];

export const GAMES: readonly Game[] = ['pictionary', 'charades'] as const;

export const GAME_DECKS: Readonly<Record<Game, readonly PlayableDeck[]>> = {
  pictionary: TIERS,
  charades: [...CHARADES_DECKS, 'mixed'],
};

/** The decks `mixed` deals from, in the order it prefers on a tie. */
export const MIXED_SOURCES: readonly CharadesDeck[] = CHARADES_DECKS;

const CHARADES_SET = new Set<string>([...CHARADES_DECKS, 'mixed']);

export function gameOf(deck: PlayableDeck): Game {
  return CHARADES_SET.has(deck) ? 'charades' : 'pictionary';
}

/** Tier-weighted scoring. */
export const TIER_POINTS: Readonly<Record<Tier, number>> = {
  easy: 1,
  moderate: 2,
  hard: 3,
  expert: 4,
  god: 5,
};

/**
 * Films are flat at one point each. There is no difficulty gradient across the
 * film decks — Sholay and Tumbbad sit in the same deck — so weighting them
 * would be inventing a distinction the corpus does not make, and one point per
 * film makes the session score read as the number the room is already keeping.
 */
export const DECK_POINTS: Readonly<Record<DeckId, number>> = {
  ...TIER_POINTS,
  hindi: 1,
  english: 1,
};

/** What one entry in a deck is called. Pictionary deals words; charades, films. */
export interface Unit {
  one: string;
  many: string;
}

const WORD: Unit = { one: 'word', many: 'words' };
const FILM: Unit = { one: 'film', many: 'films' };

export interface DeckLabel {
  /** The deck's name, on its card and in the play header. */
  name: string;
  /** Difficulty for a tier, language for a film deck. */
  detail: string;
  unit: Unit;
}

export const DECK_LABELS: Readonly<Record<PlayableDeck, DeckLabel>> = {
  easy: { name: 'Doodle', detail: 'Easy', unit: WORD },
  moderate: { name: 'Sketch', detail: 'Moderate', unit: WORD },
  hard: { name: 'Cryptic', detail: 'Hard', unit: WORD },
  expert: { name: 'Enigma', detail: 'Very hard', unit: WORD },
  god: { name: 'God Mode', detail: 'Impossible', unit: WORD },
  hindi: { name: 'Bollywood', detail: 'Hindi films', unit: FILM },
  english: { name: 'Hollywood', detail: 'English films', unit: FILM },
  mixed: { name: 'Mixed Bag', detail: 'Both, alternating', unit: FILM },
};

export const GAME_LABELS: Readonly<Record<Game, { name: string; verb: string; blurb: string }>> = {
  pictionary: {
    name: 'Pictionary',
    verb: 'Draw it',
    blurb: 'Five tiers, from one-shape nouns up to named ideas out of somebody else’s field.',
  },
  charades: {
    name: 'Dumb Charades',
    verb: 'Act it out',
    blurb: 'Film titles, Hindi and English. No talking, no pointing, no writing anything down.',
  },
};

/** "1 film" / "9 films", with the count formatted for the UI's locale. */
export function plural(count: number, unit: Unit): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? unit.one : unit.many}`;
}

// ---------------------------------------------------------------------------
// Corpus — as shipped in public/corpus/<deck>.json
// ---------------------------------------------------------------------------

/** Single-character keys: this is the only payload that scales with corpus size. */
export interface PackedWord {
  /** Frozen ordinal. Append-only, never reused, never renumbered. */
  o: number;
  /** The word, phrase or film title shown to the player. */
  t: string;
  /** Word count, 1-8. UI shows pips for 1-4 and a numeric badge for 5+. */
  w: number;
  /** Category slug, used for anti-clustering. */
  c: string;
  /**
   * Plain-English meaning, shown under the word. Present on god tier only,
   * where it is mandatory — a God Mode term nobody in the room can define is
   * not a hard word, it is a dead round.
   */
  m?: string;
}

export interface RuntimeBundle {
  corpusVersion: string;
  tier: DeckId;
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
  /** God Mode only: the one-line meaning shown under the word. */
  meaning: string | null;
  tier: DeckId;
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
  tier: PlayableDeck;
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
  /**
   * Keyed by DeckId. The field is still called `tiers` because the stored
   * record is schema v1 and renaming it would orphan every existing history for
   * the sake of a word. Decks absent from an older record parse to a fresh
   * TierMemory, which is what makes the two film decks appear on an upgrade
   * without a migration.
   */
  tiers: Record<DeckId, TierMemory>;
  /** Last 50 ords drawn across all decks, for the recycle cooldown. */
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
  /** Next unseen word, burning it. Null when the deck is exhausted. */
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
