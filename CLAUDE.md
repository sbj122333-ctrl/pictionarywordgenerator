# Drawn & Quartered

Two party games that remember what they have already shown you.

**Pictionary** — four curated difficulty tiers of words and short phrases.
**Dumb Charades** — Hindi and English film titles, plus a Mixed deck that deals
from both.

A word or film seen once does not come back until its deck is exhausted.

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

## Vocabulary

Get these right; the type names depend on them.

- **Game** — `pictionary` or `charades`. What you pick on the landing screen.
- **Tier** — the four Pictionary decks: `easy`, `moderate`, `hard`, `god`.
- **DeckId** — anything with a corpus bundle and a seen-bitmap of its own: the
  four tiers plus `hindi` and `english`.
- **PlayableDeck** — anything you can start a session with: every `DeckId`, plus
  `mixed`.

`mixed` has no corpus. It is a `Deck` wrapping the Bollywood and Hollywood decks
that delegates each draw to one of them, so a film played in Mixed is burned in
that deck's bitmap and never comes back in either place. Iterate `DECKS` for
storage and `GAME_DECKS[game]` for a screen — `TIERS` means the four Pictionary
tiers and nothing else.

---

## The five invariants

These are the product. Everything else is negotiable; these are not.

**1. Ordinals are permanent.**
`data/ordinals.lock.json` maps each entry to an integer that is assigned once and
never changes. Every device's seen-history is a bitmap indexed by ordinal.
Renumbering silently resurrects entries people have already played, on every
device, with no way to detect it. Retired entries keep their ordinal as a
tombstone. Never regenerate this file from scratch. It is committed to git.
Charades keys are namespaced `film:<norm>` and Pictionary keys are bare, because
"Titanic" is legitimately both a Pictionary word and a film and they need
different ordinals. Do not touch the bare-key format.

**2. A word burns on reveal, not on outcome.**
The moment an entry is shown it is spent — whether the team got it, passed, or
the timer ran out. Persist the burn *before* it paints. A force-quit mid-round
must lose the entry, not leak it back into the pool.

**3. The seen-bitmap is the source of truth; the deck is a view of it.**
Never treat the cursor as authoritative. On corpus change, recompute the unseen
set from the bitmap and reshuffle only that. This is what makes the no-repeat
guarantee survive content releases — and it is why Mixed shares its sources'
bitmaps rather than owning a corpus.

**4. A word is drawn at the moment it is painted, and never earlier.**
The cover interstitial was removed in Sep 2026 at Sabuj's request, and this
invariant is what survived that. `reveal()` is the only thing that draws; the
caller builds the word screen from what it returns. Never pre-fetch the next
word, never hold one in a variable "ready", never render one hidden or at
`opacity: 0` — a word that exists before someone asked for it can be glimpsed,
and a word drawn but not shown is a word silently burned.

**5. Tier is computed, never hand-assigned.**
`assign_tier(score, category)` in `scripts/build_corpus.py` is the only thing
that decides which tier a Pictionary word is in. There is no override field. If a
word feels wrong in its tier, fix its axis scores or its category — do not
special-case it. Charades has no rubric to compute against: a film is acted, not
drawn, so it is authored straight into its language's file and gated on word
count, uniqueness and the ban list only.

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
corpus-src/          authored tuples, one file per deck              <- edit entries HERE
  tier_*.py            Pictionary: (text, category, C, F, D, R, T[, meaning])
  charades_*.py        Charades:   (title, category)
scripts/             build_corpus.py: expands, validates, assigns ordinals
data/                words.seed.json (full records), ordinals.lock.json (COMMITTED)
public/corpus/       stripped runtime bundles, lazy-loaded per deck
src/
  engine/            deck, mixed, bitmap, PRNG, storage. Zero DOM imports.
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
- Vanilla DOM. No framework — the app is eight screens and the complexity is in the engine.
- CSS custom properties only, defined in `src/ui/tokens.css`. No hard-coded colours
  anywhere else. See `docs/DESIGN_SPEC.md`.
- Every exported engine function gets a unit test. Every invariant above gets a
  property test.
- British English in UI copy ("colour", "organise"). The corpus is `global` locale.
- Film titles are romanised and carry no punctuation inside a word: `word_count()`
  splits on non-alphanumerics, so "Munna Bhai M.B.B.S." would signal six words
  instead of three and the pips would lie to the people guessing.

## Do not

- Add analytics, telemetry, or any outbound request. NFR-03 is a product claim, not a default.
- Add a drawing canvas. Explicitly out of scope — see PRD §11.
- Give `mixed` a corpus of its own. Films duplicated across decks could be served
  twice, and films unique to Mixed would be unreachable to anyone who never picks it.
- Use `Math.random()` anywhere in the engine. Decks come from the seeded PRNG so
  a session is reproducible from `{seed, cursor}` in a bug report.
- Store anything in `localStorage` outside the single versioned record in
  `docs/TECHNICAL_SPEC.md` §Storage. One key, one shape, one migration path.
- Write to `data/ordinals.lock.json` by hand.

---

## Current state

Corpus **2026.09.3** — **4,834 entries**, 66.6 KB gzipped, all gates passing.

| Game | Deck | Entries |
|---|---|---|
| Pictionary | easy / moderate / hard / god | 974 / 1,469 / 824 / 710 |
| Charades | hindi / english | 427 / 430 |

Pictionary is at 83% of the V1.0 launch target of 4,800. Charades launched at 857
films — 17 heavy sessions per language deck and 34 for Mixed, against a
10-session bar. Ordinals 0–1,099 are the seed release, 1,100–3,976 the 2026.09.2
expansion, and 3,977–4,833 the film decks; nothing was renumbered, so every
device keeps its history and simply finds more unseen.

God Mode is 710 words against a V1.0 target of 600 and a ceiling of ~1,500. It is
deliberately the smallest Pictionary tier and the one to stop growing first — past
the ceiling you are admitting terms that fail the Recognition axis.

**The app is built and playable.** Tasks 1–13 of `docs/BUILD_PLAN.md` are done:
engine, storage, deck, anti-clustering, the screens, timer, teams, scoring, PWA,
Memory Code.

Task 14 (release) is the open one: the WCAG 2.2 AA audit and the real-device pass
across iOS Safari, Android Chrome and desktop have not been run, and neither has
the "three real groups play a full session" gate that cannot be automated.

Two corrections were made to the specs while building, both recorded in place:

- **The 3-per-20 anti-clustering quota was removed.** It caps a category at 15%
  of a deck, and three of the four tiers exceed that, so it was unsatisfiable —
  and enforcing it pushed the surplus into one unbroken run at the end of the
  deck. Replaced by proportional scheduling. TECHNICAL_SPEC §3.5.
- **`theme` and `installDismissed` moved into `Settings`** rather than getting
  keys of their own, to keep the one-key rule absolute. No schema bump: absent
  fields parse to defaults. TECHNICAL_SPEC §2.3.

Four product changes landed in Sep 2026, all requested by Sabuj:

- **The cover screen is gone.** No "Drawer only / Tap when you're holding the
  phone" interstitial; the word is drawn and painted in one step, and the
  handover moment is the "Next player" button on the resolved screen. Invariant
  4 was rewritten rather than deleted — see above.
- **Hints became meanings.** The `hint` field is now `meaning` (packed key `h`
  became `m`), it is printed under every God Mode word unconditionally, and it
  costs nothing. The ½-points award, the reveal button and `Round.hintUsed` are
  all removed. A God Mode term the room cannot define is a dead round, not a
  hard one.
- **Back navigates instead of exiting.** Every screen but the game picker owns a
  history entry carrying its own view, so back means "the previous screen" and
  only leaves the app from there.
- **Dumb Charades was added**, with a game picker in front of the deck list.
  Three decks: Bollywood, Hollywood, and a Mixed deck that deals alternately
  from both and shares their memory rather than holding a corpus. Films are flat
  at one point each — the two film decks hold every era in no order, so there is
  no difficulty gradient to weight.
