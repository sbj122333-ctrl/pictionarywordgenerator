# Drawn & Quartered

A Pictionary word generator that remembers what it has already shown you. Four
curated difficulty tiers, single words and short phrases, and a word seen once
does not come back until its tier is exhausted.

Static site. No backend, no accounts, no network calls after first load.

---

## Read these before writing code

| Doc | What it settles | Read it when |
|---|---|---|
| `docs/PRD.html` | Why the product exists, market, scope boundary, risks | Once, at the start |
| `docs/TECHNICAL_SPEC.md` | Architecture, module contracts, the deck algorithm, storage, tests | Before any `src/` work |
| `docs/DESIGN_SPEC.md` | Tokens, breakpoints, every screen at phone and laptop | Before any UI work |
| `docs/BUILD_PLAN.md` | Sequenced tasks with per-task acceptance criteria | To pick up the next task |

`docs/BUILD_PLAN.md` is the running order. Work tasks in sequence; each states
its own done-condition. Do not start a task whose dependencies are unfinished.

---

## The five invariants

These are the product. Everything else is negotiable; these are not.

**1. Ordinals are permanent.**
`data/ordinals.lock.json` maps each word to an integer that is assigned once and
never changes. Every device's seen-history is a bitmap indexed by ordinal.
Renumbering silently resurrects words people have already played, on every
device, with no way to detect it. Retired words keep their ordinal as a
tombstone. Never regenerate this file from scratch. It is committed to git.

**2. A word burns on reveal, not on outcome.**
The moment a word is shown to a drawer it is spent — whether the team got it,
passed, or the timer ran out. Persist the burn *before* the word paints. A
force-quit mid-round must lose the word, not leak it back into the pool.

**3. The seen-bitmap is the source of truth; the deck is a view of it.**
Never treat the cursor as authoritative. On corpus change, recompute the unseen
set from the bitmap and reshuffle only that. This is what makes the no-repeat
guarantee survive content releases.

**4. The word never enters the DOM before the drawer asks for it.**
The cover screen exists because a word glimpsed while the phone is being handed
over ruins the round. Do not pre-render, do not `hidden`, do not render at
`opacity: 0`. It is not in the document until the reveal.

**5. Tier is computed, never hand-assigned.**
`assign_tier(score, category)` in `scripts/build_corpus.py` is the only thing
that decides which tier a word is in. There is no override field. If a word
feels wrong in its tier, fix its axis scores or its category — do not special-case it.

---

## Commands

```bash
npm install
npm run dev              # vite dev server
npm run build            # typecheck + build to dist/
npm run preview          # serve dist/ (needed to test the service worker)

npm test                 # vitest, once
npm run test:watch
npm run test:property    # 10,000-draw no-repeat assertion (NFR-07) - the important one

npm run corpus           # rebuild + validate the corpus from corpus-src/
npm run corpus:check     # validate only; exits 1 on any gate failure
```

`npm run corpus` must be re-run after any edit to `corpus-src/*.py`, and its
output (`public/corpus/*.json`, `data/*.json`) committed alongside the source.

---

## Layout

```
corpus-src/          authored word tuples, one file per tier   <- edit words HERE
scripts/             build_corpus.py: expands, validates, assigns ordinals
data/                words.seed.json (full records), ordinals.lock.json (COMMITTED)
public/corpus/       stripped runtime bundles, lazy-loaded per tier
src/
  engine/            deck, bitmap, PRNG, storage. Zero DOM imports.
  ui/                screens and components. No game logic.
  state/             session state machine
  main.ts
docs/                the four docs above
tests/               unit + property tests
```

**`src/engine/` must not import from `src/ui/`, and must not touch `window` or
`document`.** The engine is pure and testable in isolation; that is what lets the
property tests run 10,000 draws in milliseconds. Storage access goes through the
injected `StorageAdapter` port, never directly.

---

## Conventions

- TypeScript strict. No `any`. Prefer discriminated unions over optional-field soup.
- No runtime dependencies beyond what `package.json` already lists. This ships offline
  and every kilobyte is budgeted; do not add a library without a note in the PR.
- Vanilla DOM. No framework — the app is six screens and the complexity is in the engine.
- CSS custom properties only, defined in `src/ui/tokens.css`. No hard-coded colours
  anywhere else. See `docs/DESIGN_SPEC.md`.
- Every exported engine function gets a unit test. Every invariant above gets a
  property test.
- British English in UI copy ("colour", "organise"). The corpus is `global` locale.

## Do not

- Add analytics, telemetry, or any outbound request. NFR-03 is a product claim, not a default.
- Add a drawing canvas. Explicitly out of scope — see PRD §11.
- Use `Math.random()` anywhere in the engine. Decks come from the seeded PRNG so
  a session is reproducible from `{seed, cursor}` in a bug report.
- Store anything in `localStorage` outside the single versioned record in
  `docs/TECHNICAL_SPEC.md` §Storage. One key, one shape, one migration path.
- Write to `data/ordinals.lock.json` by hand.

---

## Current state

Seed corpus: **1,100 words** (306 easy / 372 moderate / 200 hard / 222 god),
16.6 KB gzipped, all gates passing. This is 23% of the V1.0 launch target of
4,800 and is deliberately short — it exists so the engine can be built and
played against real data. Growing it is editorial work, not a code task; the
pipeline is in `docs/TECHNICAL_SPEC.md`.

**The app is built and playable.** Tasks 1–13 of `docs/BUILD_PLAN.md` are done:
engine, storage, deck, anti-clustering, all six screens, timer, teams, scoring,
PWA, Memory Code. 123 tests green, 39 KB of the 300 KB budget.

Task 14 (release) is the open one: the WCAG 2.2 AA audit and the real-device
pass across iOS Safari, Android Chrome and desktop have not been run, and
neither has the "three real groups play a full session" gate that cannot be
automated.

Two corrections were made to the specs while building, both recorded in place:

- **The 3-per-20 anti-clustering quota was removed.** It caps a category at 15%
  of a deck, and three of the four tiers exceed that, so it was unsatisfiable —
  and enforcing it pushed the surplus into one unbroken run at the end of the
  deck. Replaced by proportional scheduling. TECHNICAL_SPEC §3.5.
- **`theme` and `installDismissed` moved into `Settings`** rather than getting
  keys of their own, to keep the one-key rule absolute. No schema bump: absent
  fields parse to defaults. TECHNICAL_SPEC §2.3.
