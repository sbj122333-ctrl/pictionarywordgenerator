#!/usr/bin/env node
/**
 * Asserts the gzipped payload budget from NFR-02.
 *
 * The budget exists because the corpus is meant to grow to ~23,700 words. It is
 * generous today (the seed build is well under it) and it is the thing that stops
 * a dependency creeping in later and quietly breaking offline-first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 300;
const DIST = 'dist';
const COUNTED = new Set(['.js', '.css', '.html', '.json', '.woff2']);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let total = 0;
const rows = [];
for (const file of walk(DIST)) {
  if (!COUNTED.has(extname(file))) continue;
  const gz = gzipSync(readFileSync(file), { level: 9 }).length;
  total += gz;
  rows.push([file.replace(`${DIST}/`, ''), gz]);
}

rows.sort((a, b) => b[1] - a[1]);
console.log('\n  gzipped payload\n');
for (const [name, gz] of rows.slice(0, 15)) {
  console.log(`    ${(gz / 1024).toFixed(1).padStart(7)} KB  ${name}`);
}
if (rows.length > 15) console.log(`    ${'...'.padStart(10)}  and ${rows.length - 15} more`);

const kb = total / 1024;
const pct = (kb / BUDGET_KB) * 100;
console.log(`\n    ${kb.toFixed(1)} KB of ${BUDGET_KB} KB budget (${pct.toFixed(0)}%)\n`);

if (kb > BUDGET_KB) {
  console.error(`  FAIL: over budget by ${(kb - BUDGET_KB).toFixed(1)} KB\n`);
  process.exit(1);
}
