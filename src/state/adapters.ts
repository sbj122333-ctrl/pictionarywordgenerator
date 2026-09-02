/**
 * Browser-backed storage. TECHNICAL_SPEC §4.
 *
 * These live outside src/engine/ because the engine may not touch host globals
 * (CLAUDE.md). They still carry no hard dependency on a browser: both the
 * key-value store and the IndexedDB factory arrive by injection, so the throw
 * path — private-mode Safari, the one that actually happens — is testable in
 * Node without pretending to be a browser.
 *
 * localStorage is primary and synchronous, because a word is burned before it
 * paints and the burn cannot be a promise. IndexedDB is a mirror, written on
 * idle, and exists only so a cleared localStorage does not take the history
 * with it.
 */
import type { DeviceMemory, StorageAdapter } from '../engine/types';
import { STORAGE_KEY } from '../engine/types';
import { MemoryAdapter, parseDeviceMemory } from '../engine/storage';

/** The slice of the Storage interface this actually uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Accessing localStorage itself throws when site data is blocked outright.
    return null;
  }
}

const DB_NAME = 'dq';
const DB_STORE = 'memory';
const DB_KEY = 'current';

/**
 * Best-effort IndexedDB mirror. Every method resolves rather than rejects: a
 * mirror that fails is a smaller problem than an app that will not start, and
 * localStorage is still the primary.
 */
export class IndexedDbMirror {
  constructor(private readonly factory: IDBFactory | null) {}

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const request = this.factory!.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async read(corpusVersion: string): Promise<DeviceMemory | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
        request.onsuccess = () => {
          const value: unknown = request.result;
          resolve(typeof value === 'string' ? parseDeviceMemory(value, corpusVersion) : null);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async write(memory: DeviceMemory): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(JSON.stringify(memory), DB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(DB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export interface LocalStorageAdapterOptions {
  /** Called the first time a write fails, so the UI can say memory is session-only. */
  onDegraded?: () => void;
  /** Mirror writes are deferred through this. Defaults to a microtask in tests. */
  defer?: (fn: () => void) => void;
  mirror?: IndexedDbMirror;
}

/**
 * The adapter the app actually runs on.
 *
 * Writes go to an in-process copy first and always succeed there, so a quota
 * error or a blocked store costs the session's durability but never the session
 * itself. `degraded` is what the settings screen reads to tell the truth about
 * it — silently forgetting is the one thing this product must not do.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly session = new MemoryAdapter();
  private readonly mirror: IndexedDbMirror | null;
  private readonly defer: (fn: () => void) => void;
  private readonly onDegraded: (() => void) | null;
  private failed = false;

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly corpusVersion: string,
    options: LocalStorageAdapterOptions = {},
  ) {
    this.mirror = options.mirror ?? null;
    this.defer = options.defer ?? ((fn) => void Promise.resolve().then(fn));
    this.onDegraded = options.onDegraded ?? null;
    if (!store) this.markDegraded();
  }

  /** True once anything has failed to persist. The UI must surface this. */
  get degraded(): boolean {
    return this.failed;
  }

  private markDegraded(): void {
    if (this.failed) return;
    this.failed = true;
    this.onDegraded?.();
  }

  read(): DeviceMemory | null {
    if (this.store) {
      try {
        const parsed = parseDeviceMemory(this.store.getItem(STORAGE_KEY), this.corpusVersion);
        if (parsed) return parsed;
      } catch {
        this.markDegraded();
      }
    }
    return this.session.read();
  }

  write(memory: DeviceMemory): void {
    // In-process first, and unconditionally. Whatever happens below, the rest of
    // this session behaves correctly.
    this.session.write(memory);

    if (this.store) {
      try {
        this.store.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch {
        this.markDegraded();
      }
    }

    if (this.mirror) {
      const snapshot = memory;
      this.defer(() => void this.mirror?.write(snapshot));
    }
  }

  clear(): void {
    this.session.clear();
    try {
      this.store?.removeItem(STORAGE_KEY);
    } catch {
      this.markDegraded();
    }
    if (this.mirror) this.defer(() => void this.mirror?.clear());
  }

  /**
   * Restores from the mirror when localStorage came back empty. TECHNICAL_SPEC
   * §4.2: an empty primary with a populated mirror is an eviction, not a first
   * visit, and the difference decides whether the recovery banner appears.
   */
  async restoreFromMirror(): Promise<DeviceMemory | null> {
    if (!this.mirror) return null;
    const mirrored = await this.mirror.read(this.corpusVersion);
    if (mirrored) this.write(mirrored);
    return mirrored;
  }
}
