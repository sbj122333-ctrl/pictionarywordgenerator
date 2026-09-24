import { describe, it, expect, vi } from 'vitest';
import type { DeviceMemory } from '../../src/engine/types';
import { STORAGE_KEY } from '../../src/engine/types';
import { MemoryAdapter, createDeviceMemory, parseDeviceMemory } from '../../src/engine/storage';
import type { KeyValueStore } from '../../src/state/adapters';
import { LocalStorageAdapter } from '../../src/state/adapters';

class FakeStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  throwOnWrite = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    // Private-mode Safari raises QuotaExceededError on every write.
    if (this.throwOnWrite) throw new DOMException('QuotaExceededError');
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function populated(): DeviceMemory {
  const memory = createDeviceMemory('2026.09.1');
  memory.tiers.easy = { seed: 42, cursor: 7, seen: 'AQID', cycles: 1 };
  memory.recent = [1, 2, 3];
  memory.sessions = [{ at: 1_700_000_000_000, tier: 'hard', ords: [4, 5], hits: 1 }];
  memory.settings = {
    timerSeconds: 120,
    twists: true,
    sound: false,
    theme: 'dark',
    installDismissed: true,
  };
  return memory;
}

describe('MemoryAdapter', () => {
  it('round-trips a full DeviceMemory', () => {
    const adapter = new MemoryAdapter();
    const memory = populated();
    adapter.write(memory);
    expect(adapter.read()).toEqual(memory);
  });

  it('hands back a copy, not a live reference', () => {
    const adapter = new MemoryAdapter();
    adapter.write(populated());
    const first = adapter.read();
    first!.tiers.easy.cursor = 999;
    expect(adapter.read()!.tiers.easy.cursor).toBe(7);
  });

  it('clears', () => {
    const adapter = new MemoryAdapter();
    adapter.write(populated());
    adapter.clear();
    expect(adapter.read()).toBeNull();
  });
});

describe('LocalStorageAdapter', () => {
  it('round-trips a full DeviceMemory', () => {
    const store = new FakeStore();
    const adapter = new LocalStorageAdapter(store, '2026.09.1');
    const memory = populated();
    adapter.write(memory);
    expect(adapter.read()).toEqual(memory);
  });

  it('writes no key other than dq.v1', () => {
    const store = new FakeStore();
    const adapter = new LocalStorageAdapter(store, '2026.09.1');
    adapter.write(populated());
    adapter.read();
    expect([...store.data.keys()]).toEqual([STORAGE_KEY]);
  });

  it('degrades to in-session memory when a write throws', () => {
    const store = new FakeStore();
    store.throwOnWrite = true;
    const onDegraded = vi.fn();
    const adapter = new LocalStorageAdapter(store, '2026.09.1', { onDegraded });

    const memory = populated();
    expect(() => adapter.write(memory)).not.toThrow();

    expect(adapter.degraded).toBe(true);
    expect(onDegraded).toHaveBeenCalledTimes(1);
    // Nothing reached the store, but the session still remembers.
    expect(store.data.size).toBe(0);
    expect(adapter.read()).toEqual(memory);

    adapter.write(memory);
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });

  it('degrades immediately when there is no store at all', () => {
    const adapter = new LocalStorageAdapter(null, '2026.09.1');
    expect(adapter.degraded).toBe(true);
    const memory = populated();
    adapter.write(memory);
    expect(adapter.read()).toEqual(memory);
  });

  it('restores from the mirror when the primary is empty', async () => {
    const stored = populated();
    const mirror = {
      read: async () => stored,
      write: async () => {},
      clear: async () => {},
    };
    const store = new FakeStore();
    const adapter = new LocalStorageAdapter(store, '2026.09.1', {
      mirror: mirror as never,
      defer: (fn) => fn(),
    });

    expect(adapter.read()).toBeNull();
    const restored = await adapter.restoreFromMirror();
    expect(restored).toEqual(stored);
    expect(adapter.read()).toEqual(stored);
  });
});

describe('parseDeviceMemory', () => {
  it('returns null for absent or unreadable input', () => {
    expect(parseDeviceMemory(null, 'x')).toBeNull();
    expect(parseDeviceMemory('', 'x')).toBeNull();
    expect(parseDeviceMemory('not json', 'x')).toBeNull();
    expect(parseDeviceMemory('[1,2,3]', 'x')).toBeNull();
    expect(parseDeviceMemory('{"v":2}', 'x')).toBeNull();
  });

  it('fills in a record that is missing everything but its version', () => {
    const parsed = parseDeviceMemory('{"v":1}', '2026.09.1');
    expect(parsed).not.toBeNull();
    expect(parsed!.corpusVersion).toBe('2026.09.1');
    expect(Object.keys(parsed!.tiers).sort()).toEqual([
      'easy',
      'english',
      'expert',
      'god',
      'hard',
      'hindi',
      'moderate',
    ]);
    expect(parsed!.settings.timerSeconds).toBe(90);
    expect(parsed!.recent).toEqual([]);
  });

  it('rejects junk inside otherwise valid fields rather than trusting it', () => {
    const raw = JSON.stringify({
      v: 1,
      corpusVersion: 'x',
      recent: [1, 'two', 3, null],
      sessions: [{ nope: true }, { at: 1, tier: 'easy', ords: [1], hits: 0 }],
      settings: { timerSeconds: 45, twists: 'yes', sound: 1 },
      tiers: { easy: { seed: 'no', cursor: -5, seen: 12, cycles: 2.9 } },
    });
    const parsed = parseDeviceMemory(raw, 'fallback')!;

    expect(parsed.recent).toEqual([1, 3]);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.settings.timerSeconds).toBe(90);
    expect(parsed.settings.twists).toBe(false);
    expect(parsed.settings.sound).toBe(true);
    expect(parsed.settings.theme).toBe('system');
    expect(parsed.settings.installDismissed).toBe(false);
    expect(parsed.tiers.easy.cursor).toBe(0);
    expect(parsed.tiers.easy.seen).toBe('');
    expect(parsed.tiers.easy.cycles).toBe(2);
    expect(typeof parsed.tiers.easy.seed).toBe('number');
  });

  it('reads settings that older records did not carry', () => {
    const raw = JSON.stringify({ v: 1, settings: { theme: 'dark', installDismissed: true } });
    const parsed = parseDeviceMemory(raw, 'x')!;
    expect(parsed.settings.theme).toBe('dark');
    expect(parsed.settings.installDismissed).toBe(true);
  });

  it('accepts a timer that is legitimately off', () => {
    const raw = JSON.stringify({ v: 1, settings: { timerSeconds: null } });
    expect(parseDeviceMemory(raw, 'x')!.settings.timerSeconds).toBeNull();
  });

  it('keeps only the last three sessions', () => {
    const sessions = Array.from({ length: 6 }, (_, i) => ({
      at: i,
      tier: 'easy',
      ords: [i],
      hits: 0,
    }));
    const parsed = parseDeviceMemory(JSON.stringify({ v: 1, sessions }), 'x')!;
    expect(parsed.sessions.map((s) => s.at)).toEqual([3, 4, 5]);
  });
});
