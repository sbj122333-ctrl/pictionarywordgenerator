/**
 * BUILD_PLAN task 1: "the lint rules FAIL a deliberately-added Math.random() in
 * engine/ — verify the guard works before trusting it."
 *
 * The three rules in eslint.config.js are load-bearing, not style. They are the
 * only thing standing between the engine and a dependency on the DOM or on
 * unseeded randomness, either of which would make the property tests a lie
 * while they carried on passing. A guard nobody has watched fail is a guard
 * nobody should trust, so this runs ESLint in-process against code written to
 * break it.
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

async function lintAsEngine(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/engine/__guard_probe__.ts' });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('engine lint guard', () => {
  it('rejects Math.random()', async () => {
    const rules = await lintAsEngine('export const roll = (): number => Math.random();\n');
    expect(rules).toContain('no-restricted-properties');
  });

  it('rejects touching window', async () => {
    const rules = await lintAsEngine('export const w = (): unknown => window;\n');
    expect(rules).toContain('no-restricted-globals');
  });

  it('rejects touching document', async () => {
    const rules = await lintAsEngine('export const d = (): unknown => document.body;\n');
    expect(rules).toContain('no-restricted-globals');
  });

  it('rejects reaching for localStorage directly', async () => {
    const rules = await lintAsEngine('export const s = (): unknown => localStorage;\n');
    expect(rules).toContain('no-restricted-globals');
  });

  it('rejects an import from ui/', async () => {
    const rules = await lintAsEngine("import '../ui/tokens.css';\n");
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import from state/', async () => {
    const rules = await lintAsEngine("import { x } from '../state/adapters';\nexport const y = x;\n");
    expect(rules).toContain('no-restricted-imports');
  });

  it('accepts ordinary engine code, so the guard is not simply rejecting everything', async () => {
    const rules = await lintAsEngine(
      'export function double(n: number): number {\n  return n * 2;\n}\n',
    );
    expect(rules).toEqual([]);
  });
});
