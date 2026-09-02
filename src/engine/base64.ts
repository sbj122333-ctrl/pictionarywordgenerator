/**
 * Base64 / base64url over raw bytes.
 *
 * Written out rather than reaching for btoa or Buffer so the codec behaves
 * identically in Node and every browser, and so the engine stays free of host
 * globals. Both the seen-bitmap and the Memory Code depend on this being
 * byte-exact across platforms — a Memory Code is meant to move between
 * browsers.
 */

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function inverse(alphabet: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i += 1) map[alphabet[i] as string] = i;
  return map;
}

const STD_INV = /* @__PURE__ */ inverse(STD);
const URL_INV = /* @__PURE__ */ inverse(URL);

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const triple = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    if (i + 1 < bytes.length) out += alphabet[(triple >> 6) & 63];
    else if (pad) out += '=';
    if (i + 2 < bytes.length) out += alphabet[triple & 63];
    else if (pad) out += '=';
  }
  return out;
}

function decode(text: string, inv: Record<string, number>, allowed: RegExp): Uint8Array {
  const clean = text.replace(allowed, '');
  const full = Math.floor(clean.length / 4);
  const rest = clean.length % 4;
  const size = full * 3 + (rest === 2 ? 1 : rest === 3 ? 2 : 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const triple =
      ((inv[clean[i] as string] ?? 0) << 18) |
      ((inv[clean[i + 1] as string] ?? 0) << 12) |
      ((inv[clean[i + 2] as string] ?? 0) << 6) |
      (inv[clean[i + 3] as string] ?? 0);
    if (at < size) bytes[at++] = (triple >> 16) & 0xff;
    if (at < size) bytes[at++] = (triple >> 8) & 0xff;
    if (at < size) bytes[at++] = triple & 0xff;
  }
  return bytes;
}

export const bytesToBase64 = (bytes: Uint8Array): string => encode(bytes, STD, true);
export const base64ToBytes = (text: string): Uint8Array => decode(text, STD_INV, /[^A-Za-z0-9+/]/g);
export const bytesToBase64Url = (bytes: Uint8Array): string => encode(bytes, URL, false);
export const base64UrlToBytes = (text: string): Uint8Array => decode(text, URL_INV, /[^A-Za-z0-9\-_]/g);
