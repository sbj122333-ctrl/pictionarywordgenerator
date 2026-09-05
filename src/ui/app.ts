/**
 * The shell: routing, screen lifecycle, and the wiring between the engine and
 * the screens.
 *
 * Deliberately the only place that knows about all of them. Screens take props
 * and return nodes; the engine takes a bundle and a memory and returns a deck.
 * Neither knows this file exists.
 *
 * Two games now sit above the decks, and this file is where that shows: `home`
 * picks a game, `decks` lists that game's decks, and everything downstream —
 * the play screen, the summary, the recycle prompt — takes a PlayableDeck and
 * does not care which game it came from.
 */
import './tokens.css';
import './base.css';

import type {
  Deck,
  DeckId,
  Game,
  PlayableDeck,
  RuntimeBundle,
  Settings,
  Theme,
} from '../engine/types';
import {
  CHARADES_DECKS,
  DECKS,
  DECK_LABELS,
  GAMES,
  GAME_DECKS,
  MIXED_SOURCES,
  gameOf,
  plural,
} from '../engine/types';
import { createDeck } from '../engine/deck';
import { createMixedDeck } from '../engine/mixed';
import { decodeBitmap } from '../engine/bitmap';
import { exportMemoryCode, importMemoryCode, mergeMemoryCode } from '../engine/memory-code';
import type { CorpusManifest } from '../state/corpus';
import { loadBundle } from '../state/corpus';
import type { AppStore } from '../state/store';
import { applyTheme, boot } from '../state/store';
import type { Outcome, Team } from '../state/session';
import { GameSession } from '../state/session';
import { clear, el } from './dom';
import type { ScreenHandle } from './screens/game';
import { playScreen } from './screens/game';
import type { DeckStatus } from './screens/tier-select';
import { deckSelectScreen } from './screens/tier-select';
import { homeScreen } from './screens/home';
import { teamSetupScreen } from './screens/teams';
import { installCard, summaryScreen } from './screens/summary';
import { settingsScreen } from './screens/settings';
import { recycleScreen } from './screens/recycle';

type View =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'home' }
  | { name: 'decks'; game: Game }
  | { name: 'teams' }
  | { name: 'game' }
  | { name: 'summary' }
  | { name: 'settings' }
  | { name: 'recycle'; deck: PlayableDeck };

/**
 * Twists are flavour, not engine — and they have to be flavour the game can
 * actually take. "No lifting the pen" means nothing to somebody miming Sholay,
 * and a charades twist told to a drawer is just noise.
 */
const TWISTS: Readonly<Record<Game, readonly string[]>> = {
  pictionary: [
    'Non-dominant hand',
    'Eyes closed',
    'No lifting the pen',
    'One continuous line',
    'Ten seconds only',
  ],
  charades: [
    'No pointing at anything',
    'Stay seated',
    'One hand behind your back',
    'Feet must not move',
    'Thirty seconds only',
  ],
};

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export class App {
  private view: View = { name: 'loading' };
  private store: AppStore | null = null;
  private manifest: CorpusManifest | null = null;
  private session: GameSession | null = null;
  private handle: ScreenHandle | null = null;

  private readonly bundles = new Map<DeckId, RuntimeBundle>();
  private readonly decks = new Map<PlayableDeck, Deck>();

  private teams: Team[] = [];
  private wiped = false;
  private installEvent: InstallPromptEvent | null = null;
  private twist: string | null = null;
  private audio: AudioContext | null = null;

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.render();

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installEvent = event as InstallPromptEvent;
    });

    // ----------------------------------------------------------------------
    // History
    //
    // Every screen that is not the game picker gets its own history entry, and
    // the view it represents is carried *in* that entry's state. Back then means
    // "the screen the entry before this one describes", which is the previous
    // screen, and only at home — where there is no entry of ours left to pop —
    // does back leave the app.
    //
    // The bug this replaces: the old code pushed an entry only when leaving the
    // deck list, and `startGame()` switches to `loading` before it navigates. So
    // the game screen never got an entry at all, and Android's back button went
    // straight past the app and closed it mid-round.
    // ----------------------------------------------------------------------
    history.replaceState({ view: { name: 'home' } satisfies View }, '');

    window.addEventListener('popstate', (event) => {
      const state = event.state as { view?: View } | null;
      this.show(state?.view ?? { name: 'home' });
    });

    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      this.handle?.onKey?.(event);
    });

    try {
      const booted = await boot();
      this.store = booted.store;
      this.manifest = booted.manifest;
      this.wiped = booted.wiped;
      applyTheme(booted.store.theme);
      this.view = { name: 'home' };
    } catch {
      this.view = {
        name: 'error',
        message: 'The word list could not be loaded. Check your connection and reload.',
      };
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.handle?.destroy?.();
    this.handle = null;
    clear(this.root);
    this.root.appendChild(this.screen());
  }

  /**
   * Navigate forward. `push` adds a history entry; `false` replaces the current
   * one, which is right when a screen is standing in for the one already there
   * (loading → game, game → summary) and wrong everywhere else.
   */
  private go(view: View, push = true): void {
    const state = { view };
    if (push) history.pushState(state, '');
    else history.replaceState(state, '');
    this.show(view);
  }

  /**
   * Go back one screen. In-app back buttons delegate to the browser rather than
   * navigating themselves, so the two never drift apart — otherwise a tap on
   * "Back" leaves a spent entry behind and the hardware back button appears to
   * do nothing.
   */
  private back(): void {
    history.back();
  }

  /** Apply a view. The single place a screen change becomes visible. */
  private show(view: View): void {
    // Leaving a game that has not been ended abandons it. The summary needs the
    // session, so it is not a departure; neither is re-entering the game.
    if (
      this.view.name === 'game' &&
      view.name !== 'game' &&
      view.name !== 'summary' &&
      view.name !== 'loading'
    ) {
      this.session?.abandon();
      this.session = null;
    }
    this.view = view;
    this.render();
  }

  private screen(): HTMLElement {
    switch (this.view.name) {
      case 'loading':
        return el('div', { class: 'screen' }, el('p', { class: 'note', text: 'Loading…' }));
      case 'error':
        return el(
          'div',
          { class: 'screen' },
          el('h1', { class: 'title', text: 'Something went wrong' }),
          el('p', { class: 'subtitle', text: this.view.message }),
        );
      case 'home':
        return this.home();
      case 'decks':
        return this.deckSelect(this.view.game);
      case 'teams':
        return this.teamSetup();
      case 'game':
        return this.game();
      case 'summary':
        return this.summary();
      case 'settings':
        return this.settings();
      case 'recycle':
        return this.recycle(this.view.deck);
    }
  }

  // -------------------------------------------------------------------------
  // Deck status
  //
  // Remaining is derived from the seen-bitmap and the manifest total, so every
  // count is on screen from the first load without downloading six bundles.
  // Once a deck exists it answers for itself.
  //
  // Mixed is the sum of its sources, because that is literally what it is.
  // -------------------------------------------------------------------------

  private deckStatus(deck: DeckId): DeckStatus {
    const total = this.manifest?.tiers[deck].count ?? 0;
    const memory = this.store?.tierMemory(deck);
    const live = this.decks.get(deck);
    const seen = memory ? decodeBitmap(memory.seen).size : 0;
    return {
      total,
      remaining: live ? live.remaining() : Math.max(0, total - seen),
      cycles: memory?.cycles ?? 0,
    };
  }

  private status(): Record<PlayableDeck, DeckStatus> {
    const out = {} as Record<PlayableDeck, DeckStatus>;
    for (const deck of DECKS) out[deck] = this.deckStatus(deck);

    const sources = MIXED_SOURCES.map((deck) => out[deck]);
    out.mixed = {
      total: sources.reduce((n, s) => n + s.total, 0),
      remaining: sources.reduce((n, s) => n + s.remaining, 0),
      // A Mixed "round 2" only means something once BOTH film decks have been
      // through a cycle — it deals from the pair, so the pair is what counts.
      cycles: sources.reduce((n, s) => Math.min(n, s.cycles), Number.MAX_SAFE_INTEGER),
    };
    if (!Number.isFinite(out.mixed.cycles)) out.mixed.cycles = 0;

    return out;
  }

  // -------------------------------------------------------------------------
  // Home
  // -------------------------------------------------------------------------

  private home(): HTMLElement {
    const status = this.status();

    const line = (game: Game): string => {
      const decks = game === 'pictionary' ? GAME_DECKS.pictionary : CHARADES_DECKS;
      const total = decks.reduce((n, deck) => n + status[deck].total, 0);
      if (total === 0) return 'Loading…';
      const left = decks.reduce((n, deck) => n + status[deck].remaining, 0);
      const unit = DECK_LABELS[decks[0] ?? 'easy'].unit;
      return left === 0 ? 'Every deck complete' : `${plural(left, unit)} left`;
    };

    const screen = homeScreen({
      status: Object.fromEntries(GAMES.map((game) => [game, line(game)])) as Record<Game, string>,
      banner: this.wiped
        ? el(
            'div',
            { class: 'banner' },
            el('p', { class: 'banner__title', text: 'Your history is gone' }),
            el('p', {
              text: 'This browser cleared its stored data. If you kept a memory code, restore it in Settings.',
            }),
          )
        : null,
      onPick: (game) => this.go({ name: 'decks', game }),
      onSettings: () => this.go({ name: 'settings' }),
    });

    return screen;
  }

  // -------------------------------------------------------------------------
  // Deck select
  // -------------------------------------------------------------------------

  private deckSelect(game: Game): HTMLElement {
    return deckSelectScreen({
      game,
      status: this.status(),
      teamsLabel: this.teams.length > 0 ? 'Teams' : 'Add teams',
      banner:
        this.teams.length > 0
          ? el(
              'div',
              { class: 'banner' },
              el('p', { class: 'banner__title', text: `Scoring with ${this.teams.length} teams` }),
              el('p', { text: 'Pick a deck to start. Tap “Teams” again to change them.' }),
            )
          : null,
      onPick: (deck) => void this.startGame(deck),
      onRecycle: (deck) => this.go({ name: 'recycle', deck }),
      onTeams: () => this.go({ name: 'teams' }),
      onSettings: () => this.go({ name: 'settings' }),
      onBack: () => this.back(),
    });
  }

  private teamSetup(): HTMLElement {
    return teamSetupScreen({
      onStart: (teams) => {
        this.teams = teams;
        this.back();
      },
      onSkip: () => {
        this.teams = [];
        this.back();
      },
      onBack: () => this.back(),
    });
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  private async bundleFor(deck: DeckId): Promise<RuntimeBundle> {
    // Lazily fetched: starting a deck downloads that deck and nothing else.
    const bundle = this.bundles.get(deck) ?? (await loadBundle(deck));
    this.bundles.set(deck, bundle);
    return bundle;
  }

  private async deckFor(deck: PlayableDeck): Promise<Deck> {
    const existing = this.decks.get(deck);
    if (existing) return existing;

    const store = this.store;
    if (!store) throw new Error('not booted');

    // Mixed wraps the SAME Deck instances the film decks use, so a film burned
    // here is burned there and the counts on the deck-select screen stay in
    // agreement with themselves. A second set of instances over the same
    // bitmaps would drift the moment either was played.
    if (deck === 'mixed') {
      const sources = await Promise.all(
        MIXED_SOURCES.map(async (source) => ({
          deck: await this.deckFor(source),
          total: this.manifest?.tiers[source].count ?? 0,
        })),
      );
      const mixed = createMixedDeck(sources);
      this.decks.set('mixed', mixed);
      return mixed;
    }

    const bundle = await this.bundleFor(deck);
    const built = createDeck(bundle, store.tierMemory(deck), store.memory.recent, (next) =>
      store.setTierMemory(deck, next),
    );
    this.decks.set(deck, built);
    return built;
  }

  /**
   * `replace` is set when the game is taking over a history entry that already
   * belongs to this session — "play again" from the summary, or starting a deck
   * you have just recycled. Backing out of those should land on the deck list,
   * not on a finished summary or a recycle prompt you already answered.
   */
  private async startGame(deck: PlayableDeck, replace = false): Promise<void> {
    const store = this.store;
    if (!store) return;

    this.view = { name: 'loading' };
    this.render();

    let built: Deck;
    try {
      built = await this.deckFor(deck);
    } catch {
      const labels = DECK_LABELS[deck];
      this.go(
        { name: 'error', message: `The ${labels.name} ${labels.unit.many} could not be loaded.` },
        false,
      );
      return;
    }

    if (built.remaining() === 0) {
      this.go({ name: 'recycle', deck }, !replace);
      return;
    }

    const session = new GameSession({
      tier: deck,
      deck: built,
      teams: this.teams,
      onDraw: (word) => {
        store.noteDrawn(word.ord);
        store.save();
      },
    });
    this.session = session;

    // No cover screen: the first word is drawn here and painted immediately.
    if (!session.reveal()) {
      this.session = null;
      this.go({ name: 'recycle', deck }, !replace);
      return;
    }

    this.twist = this.pickTwist(deck);
    this.go({ name: 'game' }, !replace);
  }

  /** One in five rounds when twists are on. Not in the engine — this is flavour. */
  private pickTwist(deck: PlayableDeck): string | null {
    if (!this.store?.settings.twists) return null;
    if (Math.random() >= 0.2) return null;
    const pool = TWISTS[gameOf(deck)];
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  private game(): HTMLElement {
    const session = this.session;
    const store = this.store;
    if (!session || !store) return el('div', { class: 'screen' });

    if (session.phase === 'playing' && session.current) {
      const handle = playScreen({
        word: session.current,
        deck: session.tier,
        remaining: session.remaining(),
        depletion: session.depletion(),
        timerSeconds: store.settings.timerSeconds,
        twist: this.twist,
        onResolve: (outcome) => this.resolve(outcome),
        onQuit: () => this.back(),
      });
      this.handle = handle;
      return handle.node;
    }

    return this.resolved();
  }

  private resolve(outcome: Outcome): void {
    const session = this.session;
    if (!session) return;
    if (outcome === 'timeout') this.beep();
    session.resolve(outcome);
    this.render();
  }

  private resolved(): HTMLElement {
    const session = this.session;
    if (!session) return el('div', { class: 'screen' });

    const last = session.rounds[session.rounds.length - 1];
    const outOfWords = session.remaining() === 0;
    const labels = DECK_LABELS[session.tier];

    return el(
      'div',
      { class: 'screen', style: `--tier-ink: var(--t-${session.tier})` },
      el(
        'header',
        { class: 'screen__head' },
        el('p', { class: 'label', text: `Last ${labels.unit.one}` }),
        el('h1', { class: 'title', text: last?.text ?? '' }),
        el('p', {
          class: 'subtitle',
          text: last
            ? last.outcome === 'got'
              ? `Got it${last.points > 0 ? ` · ${last.points} ${last.points === 1 ? 'point' : 'points'}` : ''}`
              : last.outcome === 'pass'
                ? 'Passed'
                : 'Timed out'
            : '',
        }),
      ),
      el(
        'div',
        { class: 'screen__body' },
        session.scoring
          ? el(
              'ul',
              { class: 'scores' },
              ...session.teams.map((team, index) =>
                el(
                  'li',
                  { class: index === session.activeTeam ? 'scores__winner' : '' },
                  el('span', { text: team.name }),
                  el('span', { text: `${team.score}` }),
                ),
              ),
            )
          : null,
        outOfWords
          ? el(
              'div',
              { class: 'banner' },
              el('p', { class: 'banner__title', text: `That was the last ${labels.unit.one}` }),
              el('p', {
                text: `You have played every ${labels.unit.one} in ${labels.name}.`,
              }),
            )
          : null,
      ),
      el(
        'div',
        { class: 'screen__foot' },
        outOfWords
          ? null
          : el(
              'button',
              {
                class: 'btn btn--primary',
                type: 'button',
                on: {
                  click: () => {
                    // Draws and paints in one step. Whoever taps this is the
                    // person the phone is being handed to.
                    if (!session.nextRound()) {
                      this.endSession();
                      return;
                    }
                    this.twist = this.pickTwist(session.tier);
                    this.render();
                  },
                },
              },
              session.scoring ? 'Next team' : 'Next player',
            ),
        el(
          'button',
          { class: 'btn', type: 'button', on: { click: () => this.endSession() } },
          'End session',
        ),
      ),
    );
  }

  private endSession(): void {
    const session = this.session;
    const store = this.store;
    if (!session || !store) return;

    if (session.rounds.length > 0) {
      store.addSession({
        at: Date.now(),
        tier: session.tier,
        ords: session.ords,
        hits: session.hits,
        ...(session.scoring
          ? { teams: session.teams.map((t) => ({ name: t.name, score: t.score })) }
          : {}),
      });
    }

    session.end();
    this.go({ name: 'summary' }, false);
  }

  private summary(): HTMLElement {
    const session = this.session;
    const store = this.store;
    if (!session || !store) return el('div', { class: 'screen' });

    // FR-10: after the first COMPLETED session, never before.
    const showInstall =
      !store.settings.installDismissed &&
      store.hasCompletedSession &&
      (this.installEvent !== null || isIos());

    return summaryScreen({
      deck: session.tier,
      rounds: session.rounds,
      teams: session.teams,
      winner: session.winner,
      drawn: session.drawn,
      installCard: showInstall
        ? installCard({
            ios: this.installEvent === null,
            onInstall: () => {
              void this.installEvent?.prompt();
              store.updateSettings({ installDismissed: true });
            },
            onDismiss: () => {
              store.updateSettings({ installDismissed: true });
              this.render();
            },
          })
        : null,
      onPlayAgain: () => void this.startGame(session.tier, true),
      onChangeDeck: () => this.back(),
    });
  }

  // -------------------------------------------------------------------------
  // Settings and recycle
  // -------------------------------------------------------------------------

  private settings(): HTMLElement {
    const store = this.store;
    if (!store) return el('div', { class: 'screen' });

    const screen = settingsScreen({
      settings: store.settings,
      theme: store.theme,
      degraded: store.degraded,
      memoryCode: 'Generating…',
      deckStatus: this.status(),
      onSettings: (patch: Partial<Settings>) => store.updateSettings(patch),
      onTheme: (theme: Theme) => store.setTheme(theme),
      onImport: async (code) => {
        const parsed = await importMemoryCode(code);
        if (!parsed.ok) return parsed.error;
        const merged = mergeMemoryCode(store.memory, parsed);
        store.memory = merged.next;
        store.save();
        // A deck built from the old bitmap would still serve restored entries.
        this.decks.clear();
        this.go({ name: 'settings' }, false);
        return null;
      },
      onBack: () => this.back(),
    });

    // The code is deflated asynchronously; the field fills in when it lands
    // rather than holding the whole screen back for it.
    void exportMemoryCode(store.memory).then((code) => {
      const field = screen.querySelector<HTMLTextAreaElement>('.code');
      if (field) field.value = code;
    });

    return screen;
  }

  private recycle(deck: PlayableDeck): HTMLElement {
    const status = this.status();
    return recycleScreen({
      deck,
      total: status[deck].total,
      cycles: status[deck].cycles,
      onRecycle: () => {
        void this.deckFor(deck).then((built) => {
          built.recycle();
          void this.startGame(deck, true);
        });
      },
      onBack: () => this.back(),
    });
  }

  /** A short tone on time-up. Opt-out, and silent if audio is unavailable. */
  private beep(): void {
    if (!this.store?.settings.sound) return;
    try {
      this.audio ??= new AudioContext();
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.0001, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, this.audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audio.currentTime + 0.4);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(this.audio.currentTime + 0.4);
    } catch {
      // Autoplay policy, no audio device, or a browser that will not allocate a
      // context. None of it is worth interrupting a round for.
    }
  }
}

function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}
