/**
 * The storage port and its pure implementation. TECHNICAL_SPEC §4.
 *
 * Only `MemoryAdapter` lives here. The browser-backed adapters are in
 * src/state/adapters.ts because the engine may not touch host globals — see
 * CLAUDE.md. They are still testable without a DOM: both take their backing
 * store by injection.
 *
 * There is exactly one persisted key (`dq.v1`) holding exactly one shape.
 * Anything else in localStorage is a bug.
 */
import type { DeviceMemory, SessionRecord, StorageAdapter, Tier, TierMemory } from './types';
import { TIERS, defaultSettings } from './types';
import { freshSeed } from './random';

export function createTierMemory(): TierMemory {
  return { seed: freshSeed(), cursor: 0, seen: '', cycles: 0 };
}

export function createDeviceMemory(corpusVersion: string): DeviceMemory {
  const tiers = {} as Record<Tier, TierMemory>;
  for (const tier of TIERS) tiers[tier] = createTierMemory();
  return {
    v: 1,
    corpusVersion,
    heartbeat: Date.now(),
    tiers,
    recent: [],
    sessions: [],
    settings: defaultSettings(),
  };
}

// ---------------------------------------------------------------------------
// Validation
//
// A malformed record must never throw into the caller. Storage can hold
// anything — an old schema, a truncated write, another app's key collision —
// and the app's answer to all of it is the same: fall back to a fresh record
// rather than crash on the landing screen.
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readTierMemory(v: unknown): TierMemory {
  if (!isObject(v)) return createTierMemory();
  return {
    seed: typeof v['seed'] === 'number' ? v['seed'] >>> 0 : freshSeed(),
    cursor: typeof v['cursor'] === 'number' && v['cursor'] >= 0 ? Math.floor(v['cursor']) : 0,
    seen: typeof v['seen'] === 'string' ? v['seen'] : '',
    cycles: typeof v['cycles'] === 'number' && v['cycles'] >= 0 ? Math.floor(v['cycles']) : 0,
  };
}

const TIER_SET = new Set<string>(TIERS);

/**
 * A stored session is only worth keeping if it is whole — the summary screen
 * reads every field, and a half-parsed row would render as "undefined words" in
 * front of a room of people.
 */
function readSessionRecord(v: unknown): SessionRecord | null {
  if (!isObject(v)) return null;
  const { at, tier, ords, hits, teams } = v;
  if (typeof at !== 'number') return null;
  if (typeof tier !== 'string' || !TIER_SET.has(tier)) return null;
  if (!Array.isArray(ords) || typeof hits !== 'number') return null;

  const record: SessionRecord = {
    at,
    tier: tier as Tier,
    ords: ords.filter((n): n is number => typeof n === 'number'),
    hits,
  };

  if (Array.isArray(teams)) {
    const parsed = teams
      .filter(isObject)
      .filter((t) => typeof t['name'] === 'string' && typeof t['score'] === 'number')
      .map((t) => ({ name: t['name'] as string, score: t['score'] as number }));
    if (parsed.length > 0) record.teams = parsed;
  }

  return record;
}

/**
 * Parses whatever is in storage into a usable record, or null if there is
 * nothing there. Never throws.
 */
export function parseDeviceMemory(raw: string | null, corpusVersion: string): DeviceMemory | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(json) || json['v'] !== 1) return null;

  const base = createDeviceMemory(corpusVersion);
  const tiers = {} as Record<Tier, TierMemory>;
  const storedTiers = isObject(json['tiers']) ? json['tiers'] : {};
  for (const tier of TIERS) tiers[tier] = readTierMemory(storedTiers[tier]);

  const storedSettings = isObject(json['settings']) ? json['settings'] : {};
  const timer = storedSettings['timerSeconds'];

  return {
    v: 1,
    corpusVersion: typeof json['corpusVersion'] === 'string' ? json['corpusVersion'] : corpusVersion,
    heartbeat: typeof json['heartbeat'] === 'number' ? json['heartbeat'] : Date.now(),
    tiers,
    recent: Array.isArray(json['recent'])
      ? json['recent'].filter((n): n is number => typeof n === 'number')
      : [],
    sessions: Array.isArray(json['sessions'])
      ? json['sessions']
          .map(readSessionRecord)
          .filter((r): r is SessionRecord => r !== null)
          .slice(-3)
      : [],
    settings: {
      timerSeconds:
        timer === 60 || timer === 90 || timer === 120 || timer === null
          ? timer
          : base.settings.timerSeconds,
      twists: typeof storedSettings['twists'] === 'boolean' ? storedSettings['twists'] : false,
      sound: typeof storedSettings['sound'] === 'boolean' ? storedSettings['sound'] : true,
      // Absent in records written before these fields existed. Defaulting rather
      // than failing is the whole migration — the schema version stays at 1
      // because nothing already stored changes meaning.
      theme:
        storedSettings['theme'] === 'light' || storedSettings['theme'] === 'dark'
          ? storedSettings['theme']
          : 'system',
      installDismissed: storedSettings['installDismissed'] === true,
    },
  };
}

/** In-process adapter. Used by tests and as the degraded fallback when a real
 *  store throws — private-mode Safari being the one that actually happens. */
export class MemoryAdapter implements StorageAdapter {
  private record: DeviceMemory | null = null;

  read(): DeviceMemory | null {
    return this.record ? (JSON.parse(JSON.stringify(this.record)) as DeviceMemory) : null;
  }

  write(m: DeviceMemory): void {
    this.record = JSON.parse(JSON.stringify(m)) as DeviceMemory;
  }

  clear(): void {
    this.record = null;
  }
}
