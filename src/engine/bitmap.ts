/**
 * Dense seen-bitmap codec. TECHNICAL_SPEC §3.7.
 *
 * The bitmap is indexed by ord and is the source of truth for what a device has
 * played (invariant 3). Ords are append-only, so the array only ever grows at
 * the tail and existing bit positions never shift — which is what lets a corpus
 * release add words without disturbing anyone's history.
 *
 * At the 23,700-ord ceiling a saturated bitmap is 2,963 bytes, encoding to
 * 3,952 base64 characters. Asserted in tests/unit/bitmap.test.ts.
 */
import { base64ToBytes, bytesToBase64 } from './base64';

/**
 * `maxOrd` sizes the array so the encoding stays stable as a corpus grows. An
 * ord in the set beyond it still encodes — dropping a bit here would resurrect a
 * word the device has already played, which is the one failure this product
 * cannot have.
 */
export function encodeBitmap(seen: ReadonlySet<number>, maxOrd: number): string {
  let top = maxOrd;
  for (const ord of seen) if (ord > top) top = ord;
  if (top < 0) return '';
  const bytes = new Uint8Array((top >> 3) + 1);
  for (const ord of seen) {
    if (ord < 0) continue;
    const i = ord >> 3;
    bytes[i] = (bytes[i] ?? 0) | (1 << (ord & 7));
  }
  return bytesToBase64(bytes);
}

export function decodeBitmap(b64: string): Set<number> {
  const seen = new Set<number>();
  if (!b64) return seen;
  const bytes = base64ToBytes(b64);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    if (byte === 0) continue;
    for (let bit = 0; bit < 8; bit += 1) {
      if (byte & (1 << bit)) seen.add((i << 3) + bit);
    }
  }
  return seen;
}
