/**
 * Seeded PRNG. TECHNICAL_SPEC §3.6.
 *
 * INVARIANT: `Math.random()` must not appear anywhere in src/engine/. A session
 * has to be reproducible from {seed, cursor} alone, so a bug report is
 * actionable. ESLint enforces this; the enforcement is verified in
 * tests/unit/lint-guard.test.ts rather than trusted.
 */

/** 32-bit, deterministic across platforms. Identical sequence for a given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates over a copy. Never mutates the input, and the output is a strict
 * permutation of it — the no-repeat guarantee depends on membership being
 * preserved, so this is asserted in tests/property.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const hi = out[i] as T;
    const lo = out[j] as T;
    out[i] = lo;
    out[j] = hi;
  }
  return out;
}

/**
 * A fresh deck seed. The one place in the engine that is deliberately
 * non-deterministic — it runs at cycle boundaries, and the seed it returns is
 * then persisted, so everything downstream stays reproducible.
 */
export function freshSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 1) >>> 0;
}
