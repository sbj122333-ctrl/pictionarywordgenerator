/**
 * Memory Code. TECHNICAL_SPEC §4.3, FR-11.
 *
 * A portable string carrying all four seen-bitmaps and their cycle counts. It
 * solves two problems: recovery after a WebKit storage eviction, and transfer
 * between browsers on one device — because "device" in this product really
 * means "browser profile", and the PRD is explicit about that.
 *
 * Format: `DQ1-` + base64url(deflate-raw(JSON)).
 *
 * Compression is not optional at the target size: the four bitmaps span the
 * whole ord range and encode to roughly 500 raw base64 characters at the seed
 * corpus, over the 400-character budget. They are also mostly zeroes, so
 * deflate takes them well under it. Where CompressionStream is unavailable the
 * code falls back to an uncompressed `DQ1U-` form rather than failing — a long
 * code still restores a history; no code at all does not.
 */
import type { DeviceMemory, Tier, TierMemory } from './types';
import { TIERS } from './types';
import { base64UrlToBytes, bytesToBase64Url } from './base64';
import { decodeBitmap, encodeBitmap } from './bitmap';

const PREFIX = 'DQ1-';
const PREFIX_RAW = 'DQ1U-';

interface CodePayload {
  v: 1;
  cv: string;
  tiers: Record<Tier, { seen: string; cycles: number }>;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function exportMemoryCode(memory: DeviceMemory): Promise<string> {
  const tiers = {} as CodePayload['tiers'];
  for (const tier of TIERS) {
    const t = memory.tiers[tier];
    tiers[tier] = { seen: t.seen, cycles: t.cycles };
  }
  const json = JSON.stringify({ v: 1, cv: memory.corpusVersion, tiers } satisfies CodePayload);
  const raw = new TextEncoder().encode(json);
  const packed = await deflate(raw);
  return packed ? PREFIX + bytesToBase64Url(packed) : PREFIX_RAW + bytesToBase64Url(raw);
}

export type ImportResult =
  | { ok: true; payload: CodePayload }
  | { ok: false; error: string };

/**
 * Never throws. A code arrives by being typed or pasted from a chat message, so
 * every way it can be wrong is a normal Tuesday: truncated, wrapped, missing its
 * prefix, or from a future schema. Each one gets a sentence a person can act on.
 */
export async function importMemoryCode(code: string): Promise<ImportResult> {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed) return { ok: false, error: 'Paste a memory code first.' };

  const compressed = trimmed.startsWith(PREFIX);
  const uncompressed = trimmed.startsWith(PREFIX_RAW);
  if (!compressed && !uncompressed) {
    return { ok: false, error: 'That does not look like a memory code — they start with DQ1.' };
  }

  const body = trimmed.slice(compressed ? PREFIX.length : PREFIX_RAW.length);
  if (!body) return { ok: false, error: 'That code is incomplete — nothing after the prefix.' };

  let bytes: Uint8Array | null = base64UrlToBytes(body);
  if (compressed) bytes = await inflate(bytes);
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: 'That code is damaged and could not be unpacked. Check it copied in full.' };
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: 'That code is damaged and could not be read. Check it copied in full.' };
  }

  if (typeof json !== 'object' || json === null) {
    return { ok: false, error: 'That code is damaged and could not be read.' };
  }
  const record = json as Record<string, unknown>;
  if (record['v'] !== 1) {
    return { ok: false, error: 'That code was made by a newer version of the app.' };
  }
  const storedTiers = record['tiers'];
  if (typeof storedTiers !== 'object' || storedTiers === null) {
    return { ok: false, error: 'That code is missing its word history.' };
  }

  const tiers = {} as CodePayload['tiers'];
  for (const tier of TIERS) {
    const entry = (storedTiers as Record<string, unknown>)[tier];
    const obj = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    tiers[tier] = {
      seen: typeof obj['seen'] === 'string' ? obj['seen'] : '',
      cycles: typeof obj['cycles'] === 'number' && obj['cycles'] >= 0 ? Math.floor(obj['cycles']) : 0,
    };
  }

  return {
    ok: true,
    payload: { v: 1, cv: typeof record['cv'] === 'string' ? record['cv'] : '', tiers },
  };
}

export interface MergeReport {
  next: DeviceMemory;
  words: number;
  tiers: number;
}

/**
 * Union, never replacement. Importing on a device that has its own history must
 * not un-see words — an import is a recovery, and losing history to a recovery
 * would be the same bug the whole product exists to avoid.
 */
export function mergeMemoryCode(memory: DeviceMemory, payload: ImportResult): MergeReport {
  if (!payload.ok) return { next: memory, words: 0, tiers: 0 };

  const tiers = {} as Record<Tier, TierMemory>;
  let words = 0;
  let touched = 0;

  for (const tier of TIERS) {
    const mine = memory.tiers[tier];
    const theirs = payload.payload.tiers[tier];
    const before = decodeBitmap(mine.seen);
    const incoming = decodeBitmap(theirs.seen);
    let added = 0;
    for (const ord of incoming) if (!before.has(ord)) added += 1;

    if (added === 0 && theirs.cycles <= mine.cycles) {
      tiers[tier] = mine;
      continue;
    }

    touched += 1;
    words += added;
    const union = new Set(before);
    for (const ord of incoming) union.add(ord);
    let top = -1;
    for (const ord of union) if (ord > top) top = ord;
    tiers[tier] = {
      seed: mine.seed,
      cursor: 0,
      seen: encodeBitmap(union, top),
      cycles: Math.max(mine.cycles, theirs.cycles),
    };
  }

  return { next: { ...memory, tiers }, words, tiers: touched };
}
