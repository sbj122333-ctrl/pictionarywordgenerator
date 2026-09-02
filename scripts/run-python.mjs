#!/usr/bin/env node
/**
 * Runs a Python script with whichever interpreter this machine actually has.
 *
 * The corpus pipeline is Python and the npm scripts have to work on both a
 * developer's laptop and CI. There is no single command name that covers both:
 * Linux and macOS have `python3`, a Windows install from python.org puts
 * `python` on PATH, and the Microsoft Store build is reachable as `py`. Hard-
 * coding any one of them means the corpus gates silently stop being run by
 * whoever guessed wrong — which, for a gate, is the same as deleting it.
 */
import { spawnSync } from 'node:child_process';

const CANDIDATES = ['python3', 'python', 'py'];
const args = process.argv.slice(2);

for (const exe of CANDIDATES) {
  // A probe rather than a try/catch around the real run: a missing interpreter
  // and a script that exits non-zero both look like failure otherwise, and
  // falling through on the second would hide a genuine corpus gate failure.
  const probe = spawnSync(exe, ['--version'], { stdio: 'ignore', shell: true });
  if (probe.status !== 0) continue;

  const run = spawnSync(exe, args, { stdio: 'inherit', shell: true });
  process.exit(run.status ?? 1);
}

console.error(
  `\n  FAIL: no Python interpreter found (tried ${CANDIDATES.join(', ')}).\n` +
    '  The corpus pipeline needs Python 3. The app itself does not —\n' +
    '  public/corpus/*.json is committed so the build works without it.\n',
);
process.exit(1);
