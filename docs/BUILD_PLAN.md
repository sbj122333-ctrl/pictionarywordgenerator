# Build Plan

Drawn & Quartered · v1.0

Fourteen tasks in dependency order. Each has a done-condition you can actually
run. **Do not start a task whose dependencies are open**, and do not move on
while a task's verification fails.

The ordering is deliberate: the engine and its property tests come before any
UI. The no-repeat guarantee is the product, and it is far cheaper to prove it
against synthetic data in milliseconds than to discover a leak through
gameplay three weeks later.

---

## Phase 1 — Engine (tasks 1–5)

No DOM in this phase. Everything is testable with `npm test`.

### Task 1 · Scaffold and tooling
**Deps:** none

Vite + TypeScript strict, Vitest, the npm scripts in `CLAUDE.md`, ESLint with
two custom rules: no imports from `src/ui/` inside `src/engine/`, and no
`Math.random()` / `window` / `document` inside `src/engine/`.

- [x] `npm run build` succeeds on an empty entry point
- [x] `npm test` runs and reports zero tests without erroring
- [x] The lint rules **fail** a deliberately-added `Math.random()` in `engine/`
      (verify the guard works before trusting it)

### Task 2 · PRNG and bitmap codec
**Deps:** 1 · Spec: TECHNICAL_SPEC §3.6, §3.7

`src/engine/random.ts` (mulberry32) and `src/engine/bitmap.ts`.

- [x] `mulberry32(n)` returns an identical sequence across repeated construction
- [x] Two different seeds diverge within the first 10 values
- [x] `decode(encode(s)) === s` for 1,000 randomly generated ord sets
- [x] A saturated 23,700-ord bitmap encodes to ≤ 4,000 base64 chars

### Task 3 · Storage adapters
**Deps:** 1 · Spec: TECHNICAL_SPEC §4

`StorageAdapter` port, `MemoryAdapter`, `LocalStorageAdapter`, `IndexedDbMirror`.

- [x] Round-trips a full `DeviceMemory` through each adapter
- [x] A localStorage write that throws (simulate private-mode Safari) degrades to
      in-session memory without throwing to the caller
- [x] Empty localStorage + populated mirror restores from the mirror on load
- [x] Nothing writes any key other than `dq.v1`

### Task 4 · The deck — the core of the product
**Deps:** 2, 3 · Spec: TECHNICAL_SPEC §3.1–3.4

`createDeck`, `draw`, `remaining`, `depletion`, `recycle`, `reconcile`, cooldown.

- [x] 10,000 draws from a 10,000-word synthetic tier → **zero repeats**
- [x] 10 × 50 draws, adapter destroyed and rebuilt between each → **zero repeats**
- [x] 500 draws, then +200/−50 corpus change, then 150 draws → **zero repeats
      across the boundary**
- [x] Draw, discard the adapter with no outcome recorded, rebuild → that ord is
      never served again (burn-on-reveal)
- [x] `persist` has completed before `draw()` returns — assert on call ordering
- [x] After `recycle()`, none of the previous 50 ords sit in the first half
- [x] Same seed → identical deck order

**This task is the gate for the whole project.** If these do not pass, nothing
downstream matters.

### Task 5 · Anti-clustering
**Deps:** 4 · Spec: TECHNICAL_SPEC §3.5

- [x] `sorted(before) === sorted(after)` — reordering never changes membership
- [x] No category twice in a row, on synthetic **and** on all four shipping tiers
- [x] Over 20-draw windows, no category exceeds its own share of the deck
- [x] A tier with only one category still terminates (best-effort, never blocks)
- [x] Task 4's no-repeat assertions still pass with clustering enabled

> The original "no category more than 3 times per 20 draws" was **dropped**.
> 3-in-20 caps a category at 15% of a deck, and three of the four shipping tiers
> exceed that, so it was unsatisfiable — and enforcing it pushed the surplus into
> one unbroken run at the end of the deck. Replaced by proportional scheduling.
> See TECHNICAL_SPEC §3.5.

---

## Phase 2 — Playable (tasks 6–9)

### Task 6 · Corpus loading and tokens
**Deps:** 4 · Spec: TECHNICAL_SPEC §2.2, DESIGN_SPEC §2

Lazy per-tier bundle fetch, `RuntimeBundle` typing, `src/ui/tokens.css`.

- [x] Starting a tier fetches only that tier's bundle (assert on network calls)
- [x] Every token from DESIGN_SPEC §2 is declared in the bare `:root`
- [x] No colour literal exists outside `tokens.css`

### Task 7 · State machine and routing
**Deps:** 6 · Spec: TECHNICAL_SPEC §5

- [x] Every transition in the diagram is reachable; no others are
- [x] Only `cover → playing` draws a word
- [x] `resolved → cover` does not draw
- [x] Browser back from a game returns to tier select without corrupting state

### Task 8 · Cover and word screens
**Deps:** 7 · Spec: DESIGN_SPEC §3.3, §3.4

- [x] **Before reveal, the word string is absent from `document.body.innerHTML`**
      (FR-08 — the one bug that silently ruins gameplay)
- [x] Pips render for 1–4 words; 5+ shows a numeric badge
- [x] Cover screen is a `<button>` with an accessible name, spanning the viewport
- [x] Renders correctly at 360×640 and 1440×900
- [x] God Mode shows the hint control; revealing halves the round score and is
      irreversible

### Task 9 · Timer, outcomes, wake lock
**Deps:** 8 · Spec: DESIGN_SPEC §3.4, §4

- [x] 60/90/120/off all work; off hides the ring entirely
- [x] All three outcomes burn the word; only "Got it" scores
- [x] `--crit` and a single pulse at 10s; no pulse under `prefers-reduced-motion`
- [x] Wake lock held during an active timer, released on resolve, silent catch
      where unsupported
- [x] Timer announced at 30s / 10s / 0s via `aria-live`

---

## Phase 3 — Complete (tasks 10–14)

### Task 10 · Tier select, depletion, recycle
**Deps:** 9 · Spec: DESIGN_SPEC §3.1, TECHNICAL_SPEC §3.4

- [x] Remaining count is visible on every tier card from first load
- [x] ≥90% depleted → count turns `--warn`
- [x] Exhausted → card dims, "Deck complete", opens recycle not a game
- [x] Laptop renders 2×2 — never 3-wide with an orphan cell

### Task 11 · Teams, scoring, summary
**Deps:** 10 · Spec: DESIGN_SPEC §3.2, §3.5

- [x] Skip is as prominent as Start; skipping runs the game with no scoring
- [x] Tier-weighted points (1/2/3/4), halved on a revealed hint
- [x] Summary lists every word with its outcome, dot **and** text label
- [x] Last 3 sessions retrievable

### Task 12 · PWA and install prompt
**Deps:** 11 · Spec: TECHNICAL_SPEC §7

- [x] Full offline reload after first visit, all four bundles precached
- [x] Install card appears after the **first completed session**, not before
- [x] Dismissal is remembered permanently
- [x] iOS Safari gets the manual Share → Add to Home Screen instructions
- [x] Lighthouse PWA category passes

### Task 13 · Memory Code and wipe detection
**Deps:** 12 · Spec: TECHNICAL_SPEC §4.2, §4.3

- [x] Export → import on a fresh adapter reproduces the exact seen-set
- [x] Code is under 400 characters at seed-corpus size
- [x] A malformed code gives a readable error, never an exception
- [x] Wiped-storage-while-installed shows the recovery banner
- [x] Corpus-version change reconciles silently — no banner, no reset

### Task 14 · Accessibility and release
**Deps:** 13 · Spec: DESIGN_SPEC §5, TECHNICAL_SPEC §8.4

- [ ] WCAG 2.2 AA audit clean; every tier ink ≥7:1 in **both** themes
- [ ] Full keyboard path from landing to summary
- [ ] Total gzipped payload under 300 KB, asserted in CI
- [ ] All property tests green
- [ ] Real-device pass: iOS Safari, Android Chrome, laptop Chrome and Firefox

---

## Definition of done for V1.0

Every Must-priority FR in the PRD passes, all property tests are green, the
WCAG audit is clean, and — the one that cannot be automated — **three real
groups play a full session without reporting a repeat**.

## What is not in this plan

Corpus growth from 1,100 to 4,800 words. It is the critical path to launch and
it is editorial work, not engineering. Run it in parallel with Phases 2–3, using
the pipeline in TECHNICAL_SPEC §6.3. The app ships when both tracks finish, and
the corpus track is the longer one.
