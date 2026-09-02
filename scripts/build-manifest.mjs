#!/usr/bin/env node
/**
 * Emits public/corpus/manifest.json from the tier bundles.
 *
 * The tier-select screen shows words-remaining for all four tiers on first
 * load, but bundles are fetched lazily — one tier, only when a game starts.
 * Both hold because `remaining` needs only the seen-bitmap and a total, and the
 * totals fit in a couple of hundred bytes.
 *
 * Derived entirely from the generated bundles, so it cannot drift from them.
 * Regenerate whenever the corpus is rebuilt; `npm run corpus` and `npm run
 * build` both do.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TIERS = ['easy', 'moderate', 'hard', 'god'];
const DIR = join('public', 'corpus');
const CHECK = process.argv.includes('--check');

const tiers = {};
let corpusVersion = null;

for (const tier of TIERS) {
  const path = join(DIR, `${tier}.json`);
  const bundle = JSON.parse(readFileSync(path, 'utf8'));

  if (corpusVersion === null) corpusVersion = bundle.corpusVersion;
  if (bundle.corpusVersion !== corpusVersion) {
    console.error(
      `  FAIL: ${tier}.json is corpus ${bundle.corpusVersion}, expected ${corpusVersion}.\n` +
        '  Mixed corpus versions would reconcile some tiers and not others.\n',
    );
    process.exit(1);
  }
  if (bundle.count !== bundle.words.length) {
    console.error(`  FAIL: ${tier}.json says count ${bundle.count} but holds ${bundle.words.length}.\n`);
    process.exit(1);
  }

  tiers[tier] = { count: bundle.count, maxOrd: bundle.maxOrd, points: bundle.points };
}

const manifest = { corpusVersion, tiers };
writeFileSync(join(DIR, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

const total = TIERS.reduce((n, t) => n + tiers[t].count, 0);
console.log(`\n  corpus ${corpusVersion} — ${total} words`);
for (const tier of TIERS) {
  console.log(`    ${tier.padEnd(9)} ${String(tiers[tier].count).padStart(5)}`);
}
console.log('');
