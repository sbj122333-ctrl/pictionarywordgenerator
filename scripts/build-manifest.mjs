#!/usr/bin/env node
/**
 * Emits public/corpus/manifest.json from the deck bundles.
 *
 * The deck-select screen shows how much is left in every deck on first load,
 * but bundles are fetched lazily — one deck, only when a game starts. Both hold
 * because `remaining` needs only the seen-bitmap and a total, and the totals fit
 * in a couple of hundred bytes.
 *
 * Six decks now: four Pictionary tiers and two Dumb Charades film decks. Mixed
 * is deliberately absent — it is not a deck, it deals alternately from the two
 * film decks and shares their bitmaps, so it has no corpus and no total of its
 * own. Giving it one would be the first step towards a film that can be served
 * twice.
 *
 * Derived entirely from the generated bundles, so it cannot drift from them.
 * Regenerate whenever the corpus is rebuilt; `npm run corpus` and `npm run
 * build` both do.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DECKS = ['easy', 'moderate', 'hard', 'expert', 'god', 'hindi', 'english'];
const DIR = join('public', 'corpus');

const tiers = {};
let corpusVersion = null;

for (const deck of DECKS) {
  const path = join(DIR, `${deck}.json`);
  const bundle = JSON.parse(readFileSync(path, 'utf8'));

  if (corpusVersion === null) corpusVersion = bundle.corpusVersion;
  if (bundle.corpusVersion !== corpusVersion) {
    console.error(
      `  FAIL: ${deck}.json is corpus ${bundle.corpusVersion}, expected ${corpusVersion}.\n` +
        '  Mixed corpus versions would reconcile some decks and not others.\n',
    );
    process.exit(1);
  }
  if (bundle.count !== bundle.words.length) {
    console.error(`  FAIL: ${deck}.json says count ${bundle.count} but holds ${bundle.words.length}.\n`);
    process.exit(1);
  }

  tiers[deck] = { count: bundle.count, maxOrd: bundle.maxOrd, points: bundle.points };
}

const manifest = { corpusVersion, tiers };
writeFileSync(join(DIR, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

const total = DECKS.reduce((n, d) => n + tiers[d].count, 0);
console.log(`\n  corpus ${corpusVersion} — ${total} entries`);
for (const deck of DECKS) {
  console.log(`    ${deck.padEnd(9)} ${String(tiers[deck].count).padStart(5)}`);
}
console.log('');
