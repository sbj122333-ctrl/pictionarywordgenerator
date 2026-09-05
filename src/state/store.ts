/**
 * Device memory, boot and reconciliation. TECHNICAL_SPEC §4.
 *
 * One record, one key, one migration path. The store owns it; nothing else
 * writes storage.
 */
import type { DeckId, DeviceMemory, SessionRecord, Settings, Theme, TierMemory } from '../engine/types';
import { DECKS, RECENT_WINDOW } from '../engine/types';
import { createDeviceMemory } from '../engine/storage';
import { reconcileWithMaxOrd } from '../engine/deck';
import type { CorpusManifest } from './corpus';
import { loadManifest } from './corpus';
import { IndexedDbMirror, LocalStorageAdapter, browserStore } from './adapters';

const SESSION_FLAG = 'dq.seen';

export class AppStore {
  constructor(
    private readonly adapter: LocalStorageAdapter,
    public memory: DeviceMemory,
  ) {}

  get settings(): Settings {
    return this.memory.settings;
  }

  get degraded(): boolean {
    return this.adapter.degraded;
  }

  save(): void {
    this.adapter.write(this.memory);
  }

  updateSettings(patch: Partial<Settings>): void {
    this.memory.settings = { ...this.memory.settings, ...patch };
    this.save();
  }

  tierMemory(deck: DeckId): TierMemory {
    return this.memory.tiers[deck];
  }

  setTierMemory(deck: DeckId, next: TierMemory): void {
    this.memory.tiers[deck] = next;
    this.save();
  }

  /**
   * Records a draw for the recycle cooldown. Kept to the last RECENT_WINDOW
   * ords across all tiers — a new cycle should not open with a word from the
   * session that just ended, whichever tier it came from.
   */
  noteDrawn(ord: number): void {
    this.memory.recent = [...this.memory.recent.filter((o) => o !== ord), ord].slice(-RECENT_WINDOW);
  }

  get theme(): Theme {
    return this.memory.settings.theme;
  }

  setTheme(theme: Theme): void {
    this.updateSettings({ theme });
    applyTheme(theme);
  }

  addSession(record: SessionRecord): void {
    this.memory.sessions = [...this.memory.sessions, record].slice(-3);
    this.save();
  }

  get sessions(): readonly SessionRecord[] {
    return this.memory.sessions;
  }

  /** True once a session has been completed — gates the install card (FR-10). */
  get hasCompletedSession(): boolean {
    return this.memory.sessions.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Theme
//
// Stored inside the one record, not in a key of its own. CLAUDE.md is absolute
// about this: one key, one shape, one migration path. A display preference is
// not word history, but a second key is a second thing to migrate — and the
// first one anybody forgets.
// ---------------------------------------------------------------------------

export function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export function isInstalled(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    return (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export interface BootResult {
  store: AppStore;
  manifest: CorpusManifest;
  /** Storage was wiped under an installed app — offer Memory Code recovery. */
  wiped: boolean;
  /** Nothing will persist past this session. The UI has to say so. */
  degraded: boolean;
}

export async function boot(): Promise<BootResult> {
  const manifest = await loadManifest();
  const mirror = new IndexedDbMirror(typeof indexedDB === 'undefined' ? null : indexedDB);
  const adapter = new LocalStorageAdapter(browserStore(), manifest.corpusVersion, {
    mirror,
    defer: (fn) => {
      // Mirror writes ride an idle callback so they never sit between a draw and
      // the paint that follows it.
      const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
        .requestIdleCallback;
      if (idle) idle(fn);
      else setTimeout(fn, 0);
    },
  });

  let memory = adapter.read();
  let restoredFromMirror = false;

  if (!memory) {
    const mirrored = await adapter.restoreFromMirror();
    if (mirrored) {
      memory = mirrored;
      restoredFromMirror = true;
    }
  }

  // TECHNICAL_SPEC §4.2. No record and no mirror is ambiguous: a first visit and
  // a WebKit eviction look identical from here. Being installed is what breaks
  // the tie — nobody installs an app they have never opened, so an installed app
  // with no history has lost it.
  //
  // The sessionStorage flag deliberately plays no part in that test. It is
  // cleared with the tab, so a genuine eviction arrives with no flag, exactly
  // like a first visit; gating on it would suppress the banner in precisely the
  // case it exists for. It marks the tab instead, so a reload mid-session does
  // not re-announce a recovery already offered.
  const wiped = !memory && !restoredFromMirror && isInstalled() && !readSessionFlag();
  writeSessionFlag();

  memory ??= createDeviceMemory(manifest.corpusVersion);

  if (memory.corpusVersion !== manifest.corpusVersion) {
    memory = reconcileAll(memory, manifest);
  }

  memory.heartbeat = Date.now();

  const store = new AppStore(adapter, memory);
  store.save();

  return { store, manifest, wiped, degraded: adapter.degraded };
}

/**
 * Re-anchors every tier after a corpus release. Silent by design: the bitmap is
 * keyed by ord and survives intact, so nothing the player has seen comes back.
 * A banner here would be alarming about a non-event.
 */
export function reconcileAll(memory: DeviceMemory, manifest: CorpusManifest): DeviceMemory {
  const tiers = {} as Record<DeckId, TierMemory>;
  for (const deck of DECKS) {
    tiers[deck] = reconcileWithMaxOrd(manifest.tiers[deck].maxOrd, memory.tiers[deck]);
  }
  return { ...memory, corpusVersion: manifest.corpusVersion, tiers };
}

function readSessionFlag(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) !== null;
  } catch {
    return false;
  }
}

function writeSessionFlag(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch {
    // Session storage is blocked. Wipe detection degrades to silent, which is
    // the safe direction — a spurious recovery banner is worse than none.
  }
}
