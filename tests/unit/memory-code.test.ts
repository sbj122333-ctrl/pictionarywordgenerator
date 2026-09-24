import { describe, it, expect } from 'vitest';
import { TIERS } from '../../src/engine/types';
import { createDeviceMemory } from '../../src/engine/storage';
import { encodeBitmap, decodeBitmap } from '../../src/engine/bitmap';
import {
  exportMemoryCode,
  importMemoryCode,
  mergeMemoryCode,
} from '../../src/engine/memory-code';

function memoryWith(counts: Record<string, number>) {
  const memory = createDeviceMemory('2026.09.1');
  for (const tier of TIERS) {
    const n = counts[tier] ?? 0;
    const seen = new Set<number>();
    for (let i = 0; i < n; i += 1) seen.add(i * 3);
    memory.tiers[tier] = {
      seed: 1,
      cursor: 0,
      seen: encodeBitmap(seen, n === 0 ? -1 : (n - 1) * 3),
      cycles: 1,
    };
  }
  return memory;
}

describe('memory code / round trip', () => {
  it('reproduces the exact seen-set on a fresh device', async () => {
    const source = memoryWith({ easy: 306, moderate: 372, hard: 200, expert: 150, god: 222 });
    const code = await exportMemoryCode(source);
    const parsed = await importMemoryCode(code);
    expect(parsed.ok).toBe(true);

    const fresh = createDeviceMemory('2026.09.1');
    const merged = mergeMemoryCode(fresh, parsed);

    for (const tier of TIERS) {
      expect([...decodeBitmap(merged.next.tiers[tier].seen)].sort((a, b) => a - b)).toEqual(
        [...decodeBitmap(source.tiers[tier].seen)].sort((a, b) => a - b),
      );
      expect(merged.next.tiers[tier].cycles).toBe(source.tiers[tier].cycles);
    }
    expect(merged.words).toBe(306 + 372 + 200 + 150 + 222);
    expect(merged.tiers).toBe(5);
  });

  it('stays under 400 characters at seed-corpus size', async () => {
    const source = memoryWith({ easy: 306, moderate: 372, hard: 200, expert: 150, god: 222 });
    const code = await exportMemoryCode(source);
    expect(code.length).toBeLessThan(400);
  });

  it('starts with a recognisable prefix', async () => {
    const code = await exportMemoryCode(memoryWith({ easy: 10 }));
    expect(code.startsWith('DQ1')).toBe(true);
  });
});

describe('memory code / bad input', () => {
  const cases: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace', '   \n '],
    ['no prefix', 'hello there'],
    ['prefix only', 'DQ1-'],
    ['garbage body', 'DQ1-!!!!!!!!'],
    ['truncated', 'DQ1-abcdefgh'],
  ];

  for (const [name, input] of cases) {
    it(`gives a readable error and never throws: ${name}`, async () => {
      const result = await importMemoryCode(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.length).toBeGreaterThan(10);
        expect(result.error).toMatch(/\.$/);
      }
    });
  }

  it('rejects a code from a newer schema', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ v: 2, cv: 'x', tiers: {} }));
    let encoded = '';
    for (const byte of body) encoded += String.fromCharCode(byte);
    const url = btoa(encoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = await importMemoryCode(`DQ1U-${url}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });

  it('tolerates whitespace introduced by copy and paste', async () => {
    const code = await exportMemoryCode(memoryWith({ easy: 50 }));
    const mangled = `${code.slice(0, 20)}\n  ${code.slice(20)}  `;
    expect((await importMemoryCode(mangled)).ok).toBe(true);
  });
});

describe('memory code / merge', () => {
  it('unions rather than replaces, so an import never un-sees a word', async () => {
    const mine = createDeviceMemory('2026.09.1');
    mine.tiers.easy = { seed: 1, cursor: 0, seen: encodeBitmap(new Set([1, 2, 3]), 3), cycles: 0 };

    const theirs = createDeviceMemory('2026.09.1');
    theirs.tiers.easy = { seed: 2, cursor: 0, seen: encodeBitmap(new Set([3, 4, 5]), 5), cycles: 2 };

    const merged = mergeMemoryCode(mine, await importMemoryCode(await exportMemoryCode(theirs)));

    expect([...decodeBitmap(merged.next.tiers.easy.seen)].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(merged.next.tiers.easy.cycles).toBe(2);
    expect(merged.words).toBe(2);
    expect(merged.tiers).toBe(1);
  });

  it('reports nothing changed when the code adds nothing', async () => {
    const mine = memoryWith({ easy: 100 });
    const merged = mergeMemoryCode(mine, await importMemoryCode(await exportMemoryCode(mine)));
    expect(merged.words).toBe(0);
    expect(merged.tiers).toBe(0);
    expect(merged.next.tiers.easy.seen).toBe(mine.tiers.easy.seen);
  });

  it('is a no-op on a failed import', async () => {
    const mine = memoryWith({ easy: 100 });
    const merged = mergeMemoryCode(mine, await importMemoryCode('rubbish'));
    expect(merged.next).toBe(mine);
    expect(merged.words).toBe(0);
  });
});
