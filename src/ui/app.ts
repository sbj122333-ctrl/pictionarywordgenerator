/**
 * The shell: routing, screen lifecycle, and the wiring between the engine and
 * the six screens.
 *
 * Deliberately the only place that knows about all of them. Screens take props
 * and return nodes; the engine takes a bundle and a memory and returns a deck.
 * Neither knows this file exists.
 */
import './tokens.css';
import './base.css';

import type { Deck, RuntimeBundle, Settings, Theme, Tier } from '../engine/types';
import { TIERS, TIER_LABELS } from '../engine/types';
import { createDeck } from '../engine/deck';
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
import { coverScreen, playScreen } from './screens/game';
import type { TierStatus } from './screens/tier-select';
import { tierSelectScreen } from './screens/tier-select';
import { teamSetupScreen } from './screens/teams';
import { installCard, summaryScreen } from './screens/summary';
import { settingsScreen } from './screens/settings';
import { recycleScreen } from './screens/recycle';

type View =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'tiers' }
  | { name: 'teams' }
  | { name: 'game' }
  | { name: 'summary' }
  | { name: 'settings' }
  | { name: 'recycle'; tier: Tier };

const TWISTS = [
  'Non-dominant hand',
  'Eyes closed',
  'No lifting the pen',
  'One continuous line',
  'Ten seconds only',
];

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export class App {
  private view: View = { name: 'loading' };
  private store: AppStore | null = null;
  private manifest: CorpusManifest | null = null;
  private session: GameSession | null = null;
  private handle: ScreenHandle | null = null;

  private readonly bundles = new Map<Tier, RuntimeBundle>();
  private readonly decks = new Map<Tier, Deck>();

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

    // Browser back out of a game lands on tier select with the record intact.
    // The words already drawn stay burned, which is right — they were revealed.
    window.addEventListener('popstate', () => {
      if (this.view.name === 'tiers') return;
      this.session?.abandon();
      this.session = null;
      this.view = { name: 'tiers' };
      this.render();
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
      this.view = { name: 'tiers' };
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

  private go(view: View, push = true): void {
    if (push && this.view.name === 'tiers' && view.name !== 'tiers') {
      history.pushState({ view: view.name }, '');
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
      case 'tiers':
        return this.tiers();
      case 'teams':
        return this.teamSetup();
      case 'game':
        return this.game();
      case 'summary':
        return this.summary();
      case 'settings':
        return this.settings();
      case 'recycle':
        return this.recycle(this.view.tier);
    }
  }

  // -------------------------------------------------------------------------
  // Tier status
  //
  // Remaining is derived from the seen-bitmap and the manifest total, so all
  // four counts are on screen from the first load without downloading four
  // bundles. Once a tier's deck exists it answers for itself.
  // -------------------------------------------------------------------------

  private status(): Record<Tier, TierStatus> {
    const out = {} as Record<Tier, TierStatus>;
    for (const tier of TIERS) {
      const total = this.manifest?.tiers[tier].count ?? 0;
      const memory = this.store?.tierMemory(tier);
      const deck = this.decks.get(tier);
      const seen = memory ? decodeBitmap(memory.seen).size : 0;
      out[tier] = {
        total,
        remaining: deck ? deck.remaining() : Math.max(0, total - seen),
        cycles: memory?.cycles ?? 0,
      };
    }
    return out;
  }

  private tiers(): HTMLElement {
    const banner = this.wiped
      ? el(
          'div',
          { class: 'banner' },
          el('p', { class: 'banner__title', text: 'Your word history is gone' }),
          el('p', {
            text: 'This browser cleared its stored data. If you kept a memory code, restore it in Settings.',
          }),
        )
      : this.teams.length > 0
        ? el(
            'div',
            { class: 'banner' },
            el('p', { class: 'banner__title', text: `Scoring with ${this.teams.length} teams` }),
            el('p', { text: 'Pick a tier to start. Tap “Teams” again to change them.' }),
          )
        : null;

    const screen = tierSelectScreen({
      status: this.status(),
      banner,
      onPick: (tier) => void this.startGame(tier),
      onRecycle: (tier) => this.go({ name: 'recycle', tier }),
      onSettings: () => this.go({ name: 'settings' }),
    });

    // Team setup is opt-in and lives beside Settings, because the default path
    // is meant to be tap-a-tier-and-play. DESIGN_SPEC §3.2.
    screen.querySelector('.screen__foot')?.prepend(
      el(
        'button',
        {
          class: 'btn btn--quiet',
          type: 'button',
          on: { click: () => this.go({ name: 'teams' }) },
        },
        this.teams.length > 0 ? 'Teams' : 'Add teams',
      ),
    );

    return screen;
  }

  private teamSetup(): HTMLElement {
    return teamSetupScreen({
      onStart: (teams) => {
        this.teams = teams;
        this.go({ name: 'tiers' }, false);
      },
      onSkip: () => {
        this.teams = [];
        this.go({ name: 'tiers' }, false);
      },
      onBack: () => this.go({ name: 'tiers' }, false),
    });
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  private async deckFor(tier: Tier): Promise<Deck> {
    const existing = this.decks.get(tier);
    if (existing) return existing;

    const store = this.store;
    if (!store) throw new Error('not booted');

    // Lazily fetched: starting a tier downloads that tier and nothing else.
    const bundle = this.bundles.get(tier) ?? (await loadBundle(tier));
    this.bundles.set(tier, bundle);

    const deck = createDeck(
      bundle,
      store.tierMemory(tier),
      store.memory.recent,
      (next) => store.setTierMemory(tier, next),
    );
    this.decks.set(tier, deck);
    return deck;
  }

  private async startGame(tier: Tier): Promise<void> {
    const store = this.store;
    if (!store) return;

    this.view = { name: 'loading' };
    this.render();

    let deck: Deck;
    try {
      deck = await this.deckFor(tier);
    } catch {
      this.go(
        { name: 'error', message: `The ${TIER_LABELS[tier].name} words could not be loaded.` },
        false,
      );
      return;
    }

    if (deck.remaining() === 0) {
      this.go({ name: 'recycle', tier });
      return;
    }

    this.session = new GameSession({
      tier,
      deck,
      teams: this.teams,
      onDraw: (word) => {
        store.noteDrawn(word.ord);
        store.save();
      },
    });
    this.session.toCover();
    this.go({ name: 'game' });
  }

  private game(): HTMLElement {
    const session = this.session;
    const store = this.store;
    if (!session || !store) return el('div', { class: 'screen' });

    if (session.phase === 'cover') {
      this.twist =
        store.settings.twists && Math.random() < 0.2
          ? (TWISTS[Math.floor(Math.random() * TWISTS.length)] ?? null)
          : null;

      const handle = coverScreen({
        tier: session.tier,
        teamName: session.scoring ? (session.teams[session.activeTeam]?.name ?? null) : null,
        round: session.rounds.length + 1,
        onReveal: () => {
          const word = session.reveal();
          if (!word) this.endSession();
          else this.render();
        },
      });
      this.handle = handle;
      return handle.node;
    }

    if (session.phase === 'playing' && session.current) {
      const handle = playScreen({
        word: session.current,
        tier: session.tier,
        remaining: session.remaining(),
        depletion: session.depletion(),
        timerSeconds: store.settings.timerSeconds,
        twist: this.twist,
        onResolve: (outcome) => this.resolve(outcome),
        onHint: () => session.revealHint(),
        onQuit: () => {
          session.abandon();
          this.session = null;
          this.go({ name: 'tiers' }, false);
        },
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

    return el(
      'div',
      { class: 'screen', style: `--tier-ink: var(--t-${session.tier})` },
      el(
        'header',
        { class: 'screen__head' },
        el('p', { class: 'label', text: 'Last word' }),
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
              el('p', { class: 'banner__title', text: 'That was the last word' }),
              el('p', { text: `You have played every word in ${TIER_LABELS[session.tier].name}.` }),
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
                    session.nextRound();
                    this.render();
                  },
                },
              },
              session.scoring ? 'Next team' : 'Next drawer',
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
      tier: session.tier,
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
      onPlayAgain: () => void this.startGame(session.tier),
      onChangeTier: () => {
        this.session = null;
        this.go({ name: 'tiers' }, false);
      },
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
      tierStatus: this.status(),
      onSettings: (patch: Partial<Settings>) => store.updateSettings(patch),
      onTheme: (theme: Theme) => store.setTheme(theme),
      onImport: async (code) => {
        const parsed = await importMemoryCode(code);
        if (!parsed.ok) return parsed.error;
        const merged = mergeMemoryCode(store.memory, parsed);
        store.memory = merged.next;
        store.save();
        // A deck built from the old bitmap would still serve restored words.
        this.decks.clear();
        this.go({ name: 'settings' }, false);
        return null;
      },
      onBack: () => this.go({ name: 'tiers' }, false),
    });

    // The code is deflated asynchronously; the field fills in when it lands
    // rather than holding the whole screen back for it.
    void exportMemoryCode(store.memory).then((code) => {
      const field = screen.querySelector<HTMLTextAreaElement>('.code');
      if (field) field.value = code;
    });

    return screen;
  }

  private recycle(tier: Tier): HTMLElement {
    const store = this.store;
    return recycleScreen({
      tier,
      total: this.manifest?.tiers[tier].count ?? 0,
      cycles: store?.tierMemory(tier).cycles ?? 0,
      onRecycle: () => {
        void this.deckFor(tier).then((deck) => {
          deck.recycle();
          void this.startGame(tier);
        });
      },
      onBack: () => this.go({ name: 'tiers' }, false),
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
