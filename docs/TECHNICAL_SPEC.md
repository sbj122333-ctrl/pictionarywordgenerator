# Technical Specification

Drawn & Quartered · v1.0 · companion to `docs/PRD.html`

The PRD says what and why. This says how. Where they disagree, this document is
wrong and should be fixed — the PRD is the product decision of record.

---

## 1. Architecture

Static site, no backend. Three layers with a strict dependency direction:

```
  ui/  ──────►  state/  ──────►  engine/
                                    │
                                    ▼
                              StorageAdapter (port)
                                    │
                        ┌───────────┴───────────┐
                    localStorage            IndexedDB
                     (primary)               (mirror)
```

`engine/` is pure TypeScript: no DOM, no `window`, no imports from `ui/` or
`state/`. It receives a `StorageAdapter` by injection. This is not stylistic —
it is what lets the property tests run tens of thousands of draws in-process
without a browser, and it is enforced in CI by a lint rule.

### Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | The engine's correctness is the product |
| Build | Vite 5 | Fast, first-class PWA plugin, tiny output |
| Framework | None | Six screens; complexity is in the engine, not the view |
| Tests | Vitest | Same transform pipeline as the build, no extra config |
| PWA | `vite-plugin-pwa` (Workbox) | Precaching + install prompt, which is a P0 (see §7) |
| Styles | Plain CSS, custom properties | No runtime cost, no build step to reason about |

No runtime dependencies. `package.json` `dependencies` stays empty.

---

## 2. Data model

### 2.1 Word record — authoring (`data/words.seed.json`)

Source of truth, committed, never shipped to the browser.

```ts
interface WordRecord {
  id: string;            // "g-00417" — tier initial + zero-padded ordinal
  ord: number;           // FROZEN. See invariant 1.
  text: string;
  tier: Tier;
  words: number;         // 1-7
  category: string;
  axes: { C: number; F: number; D: number; R: number; T: number };  // each 1-5
  score: number;         // 20 - (C+F+D+R)
  computedTier: Tier;    // must equal `tier` or the build fails
  override: null;        // always null; the field exists to stay explicit about it
  meaning: string | null;  // required for god, null elsewhere
  locale: string[];      // ["global"] at V1.0
  volatility: "evergreen" | "topical";
  addedIn: string;       // corpus version
}
```

### 2.2 Word record — runtime (`public/corpus/<tier>.json`)

Authoring fields stripped (NFR-02b). Keys are single characters because this is
the only file whose size scales with the corpus.

```ts
interface RuntimeBundle {
  corpusVersion: string;
  tier: Tier;
  points: number;        // 1 | 2 | 3 | 4, tier-weighted scoring
  count: number;
  maxOrd: number;
  words: Array<{
    o: number;           // ord
    t: string;           // text
    w: number;           // word count
    c: string;           // category
    m?: string;          // meaning — god tier only, printed under the word
  }>;
}
```

Bundles are fetched lazily: starting a game downloads that tier only. Current
sizes: easy 2.6 KB, moderate 4.2 KB, hard 2.3 KB, god 7.7 KB gzipped.

### 2.3 Device memory — the only thing persisted

One `localStorage` key: `dq.v1`. One shape. Any other key is a bug.

```ts
interface DeviceMemory {
  v: 1;                          // schema version; bump only with a migration
  corpusVersion: string;         // last corpus seen; a change triggers reconcile()
  heartbeat: number;             // epoch ms, written every load — wipe detection
  tiers: Record<Tier, TierMemory>;
  recent: number[];              // last 50 ords drawn, any tier — recycle cooldown
  sessions: SessionRecord[];     // last 3, for the summary screen
  settings: Settings;
}

interface TierMemory {
  seed: number;                  // uint32, from crypto.getRandomValues
  cursor: number;                // index into the materialised deck
  seen: string;                  // base64 bitmap, indexed by ord
  cycles: number;                // completed exhaustions, for the badge
}

interface SessionRecord {
  at: number;
  tier: Tier;
  ords: number[];
  hits: number;
  teams?: Array<{ name: string; score: number }>;
}

interface Settings {
  timerSeconds: 60 | 90 | 120 | null;   // null = timer off
  twists: boolean;                      // default false
  sound: boolean;                       // default true
  theme: "system" | "light" | "dark";   // default "system"
  installDismissed: boolean;            // default false; FR-10, remembered forever
}
```

Saturated at the 23,700-word ceiling this record is **2.9 KB** against a 5 MB
quota. Do not economise on it.

`theme` and `installDismissed` are in here rather than in keys of their own
because the one-key rule is absolute — a second key is a second thing to
migrate, and a second thing to forget to migrate. Adding optional fields needed
no schema bump: a record written without them parses to the documented defaults,
and nothing already stored changes meaning. That is the only kind of change `v`
does not have to move for.

---

## 3. The memory engine

### 3.1 Contract

```ts
// src/engine/deck.ts
export interface Deck {
  /** Next unseen word. Burns it. Returns null when the tier is exhausted. */
  draw(): RuntimeWord | null;
  /** Unseen words left in this cycle. */
  remaining(): number;
  /** 0-1. UI warns at >= 0.9. */
  depletion(): number;
  /** Start a fresh cycle: new seed, cleared bitmap, cooldown applied. */
  recycle(): void;
}

export function createDeck(
  bundle: RuntimeBundle,
  memory: TierMemory,
  recent: number[],
  persist: (next: TierMemory) => void,
): Deck;
```

### 3.2 The algorithm

```
createDeck(bundle, memory, recent, persist):
    seen   = decodeBitmap(memory.seen)
    unseen = [w.o for w in bundle.words if not seen.has(w.o)]
    deck   = seededShuffle(unseen, memory.seed)     # Fisher-Yates, mulberry32
    deck   = applyCooldown(deck, recent)            # §3.4
    deck   = applyAntiClustering(deck, bundle)      # §3.5
    cursor = memory.cursor  if  deck length unchanged since last run  else  0

draw():
    if cursor >= deck.length: return null
    ord = deck[cursor]
    cursor += 1
    seen.add(ord)
    persist({ ...memory, cursor, seen: encodeBitmap(seen) })   # SYNCHRONOUS, before return
    return bundle.byOrd(ord)
```

`persist` completes before `draw` returns. This is invariant 2: the caller
paints the word only after the burn is durable.

### 3.3 Reconciliation on corpus change

Triggered when `memory.corpusVersion !== bundle.corpusVersion`.

```
reconcile(bundle, memory):
    seen   = decodeBitmap(memory.seen)          # keyed by ord, so it stays valid
    unseen = [w.o for w in bundle.words if not seen.has(w.o)]
    return { ...memory, seed: freshSeed(), cursor: 0, seen: encodeBitmap(seen) }
```

New words appear (their ords are not in `seen`); retired words vanish from
`bundle` and their ords sit harmlessly in the bitmap as tombstones. **No word
already seen is ever served again.** This is why the bitmap, not the cursor, is
the source of truth.

### 3.4 Exhaustion and recycling

- `depletion() >= 0.9` → the tier card and in-game header show "N words left" (FR-06).
- `remaining() === 0` → completion screen, `cycles += 1`, offer `recycle()` (FR-07).
- `recycle()` clears the bitmap, draws a fresh seed, and applies the cooldown:
  the ords in `recent` (last 50 drawn) are moved into the back half of the new
  deck, so a new cycle never opens with a word from last session.

```ts
function applyCooldown(deck: number[], recent: number[]): number[] {
  const cold = new Set(recent);
  const head = deck.filter(o => !cold.has(o));
  const tail = deck.filter(o =>  cold.has(o));
  const mid  = Math.floor(head.length / 2);
  return [...head.slice(0, mid), ...tail, ...head.slice(mid)];
}
```

### 3.5 Category anti-clustering (FR-16)

**Rule: the same category never appears twice in a row.** That is the whole
constraint. It holds absolutely wherever the deck allows it — verified across
all four shipping tiers in `tests/property/corpus.test.ts`.

There is deliberately **no fixed per-window quota**. V1.0 specified "no more
than 3 in any 20 consecutive draws", and that was removed, because 3-in-20 is
not a clustering rule — it is a rate limit that caps any category at 15% of a
deck. On the shipping corpus:

| Tier | Largest category | Share | 3-in-20 allows |
|---|---|---|---|
| Doodle | `household` 36 | 11.8% | ✅ satisfiable |
| Sketch | `idioms` 62 | 16.7% | ❌ impossible |
| Cryptic | `states` 38 | 19.0% | ❌ impossible |
| God Mode | `philosophy` 34 | 15.3% | ❌ impossible |

Enforcing an impossible quota does not remove the surplus, it relocates it:
refusing a category while it is over quota drains everything else first, so
Cryptic finishes on roughly forty unbroken `states`. That is far more noticeable
than the clustering the rule was written to prevent.

Instead the deck is **scheduled proportionally**. At each position, among the
candidates in reach, take the category furthest *below* its fair share of the
trailing window, where fair share is that category's portion of the words still
unplaced:

```
deficit(c) = WINDOW * unplaced[c] / totalRemaining  -  timesInLastWindow[c]
```

A category holding a fifth of what remains is entitled to a fifth of the window
and is spread evenly at that rate; one holding a twentieth is held to a
twentieth. Nothing accumulates, so nothing has to be dumped at the end.

Ranking by deficit rather than by raw remaining count is load-bearing. A plain
most-remaining-first greedy, with `states` at 38 and `social` at 30, alternates
those two for sixteen straight draws — "always take the biggest that is not the
last one" is a ping-pong machine. Once `states` reaches its share its deficit
goes negative and something else wins.

Implemented as a sliding pool of the next `POOL = 48` words. A word can move at
most `POOL - 1` positions earlier, which is the bound the recycle cooldown in
§3.4 depends on. It only ever reorders — it never adds, removes or duplicates —
so the permutation, and therefore the no-repeat guarantee, is untouched. Assert
that in a test: `sorted(deckBefore) === sorted(deckAfter)`.

Measured over 40 shuffles per tier on the shipping corpus: **zero adjacent
repeats on every tier**, and no category ever exceeds `ceil(fair share)` of a
20-draw window.

### 3.6 PRNG

`mulberry32`. Seeded, 32-bit, deterministic across platforms. Ships in
`src/engine/random.ts`. **`Math.random()` must not appear anywhere in `engine/`** —
a session must be reproducible from `{seed, cursor}` alone so a bug report is
actionable.

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### 3.7 Bitmap codec

Dense bitmap indexed by ord, `Uint8Array`, base64 for storage. At 23,700 ords
that is 2.9 KB encoded. Ords are append-only, so the array only ever grows at
the tail and existing bit positions never shift.

```ts
export function encodeBitmap(seen: Set<number>, maxOrd: number): string;
export function decodeBitmap(b64: string): Set<number>;
```

Round-trip is property-tested: `decode(encode(s)) === s` for arbitrary sets.

---

## 4. Storage

### 4.1 The adapter port

```ts
export interface StorageAdapter {
  read(): DeviceMemory | null;
  write(m: DeviceMemory): void;      // synchronous
  clear(): void;
}
```

Implementations: `LocalStorageAdapter` (primary, synchronous), `IndexedDbMirror`
(async, best-effort), `MemoryAdapter` (tests). Production uses localStorage as
primary with an IndexedDB mirror written on idle; on load, if localStorage is
empty but the mirror has data, restore from the mirror.

Every read and write is wrapped in `try/catch`. Private-mode Safari throws on
write; the app must degrade to in-session-only memory and say so, not crash.

### 4.2 Wipe detection (FR-12)

`heartbeat` is written on every load. On load, if there is no record at all but
the mirror is also empty, the app cannot distinguish "first visit" from "storage
wiped". So also write a `dq.seen` flag to `sessionStorage` **and** register the
install state. Practically:

- No record, no mirror, no install → first visit. Silent.
- No record, no mirror, **but the app is installed** → wiped. Show the recovery
  banner offering Memory Code import.
- Record present but `corpusVersion` differs → reconcile (§3.3), silent.

Never silently reset. A user who has played 200 words and sees a fresh counter
with no explanation will assume the guarantee is fake.

### 4.3 Memory Code (FR-11)

Portable string encoding all four bitmaps plus cycle counts. Solves two
problems: recovery after a WebKit eviction, and transfer between browsers on one
device (which the PRD is explicit about — "device" really means "browser profile").

Format: `DQ1-` + base64url( deflate( `{v,cv,tiers:{[t]:{seen,cycles}}}` ) ).
Target under 400 characters at the seed corpus size. Validate the prefix and
version on import; reject anything else with a readable error rather than
throwing.

---

## 5. Session state machine

```
  idle ──pick tier──► ready ──reveal──► playing
                        ▲                  │
                        │         ┌────────┴────────┐
                        │      got it / pass / timeout
                        │                  │
                        └── next drawer ◄─ resolved
                                 │
                            end session
                                 ▼
                              summary
```

`reveal()` is the only edge that draws, and `nextRound()` is a team rotation
followed by a `reveal()`. The burn is persisted inside `deck.draw()` before it
returns, so it is durable before the caller has anything to paint — which is
what makes it crash-safe.

`playing → summary` exists for the exhausted draw: `reveal()` has already
entered `playing` when the deck answers null, and the only thing left to do with
a dry tier is end the session.

The `cover` phase was removed in Sep 2026 along with the screen it drove. The
guarantee it carried — that no word exists before someone asked for it — now
lives in `reveal()` itself.

### 5.1 History and the back button

Every view except tier select gets a `history.pushState`, and the view it
represents is carried **in that entry's state** rather than in a shadow stack.
Back therefore means "the view the previous entry describes", forward works for
free, and at tier select there is no entry of ours left to pop, so the browser
leaves the app — which is the only place it should.

`go(view, push=false)` replaces the current entry instead of adding one. That is
right where a screen stands in for the one already there (loading → game,
game → summary, recycle → game, "play again") and wrong everywhere else.
In-app Back buttons call `history.back()` rather than navigating themselves, so
the two never drift apart.

The bug this replaced: entries were pushed only when the *current* view was
`tiers`, and `startGame()` switches to `loading` before it navigates — so the
game screen was entered with no entry at all and Android's back button closed
the app mid-round.

---

## 6. Corpus pipeline

`corpus-src/tier_*.py` holds authored tuples. `scripts/build_corpus.py` expands,
validates and emits. Words are edited **only** in `corpus-src/`; everything under
`data/` and `public/corpus/` is generated.

`norm()` is the key ordinals are assigned against. **Never change it.** Altering
it renumbers the corpus, which resurrects every word every device has already
played, silently and everywhere at once. When you need a different normalisation
for some other purpose, add a function — that is why `word_count()` exists.

### 6.1 Gates — all fail the build

| Gate | Rule |
|---|---|
| Axis range | C, F, D, R, T each 1–5 |
| Tier agreement | `assign_tier(score, category)` must equal the file the word is in |
| Easy gate | C ≥ 4 **and** R = 5 |
| Fun gate | Moderate and above: T ≥ 2 |
| Meanings | Every god-tier word has a meaning, 8–120 chars |
| Word count | 1–7; Easy 1–3. Counted by `word_count()`, NOT `norm()` — apostrophes and hyphens are inside words |
| Uniqueness | Normalised text globally unique across all tiers |
| Near-duplicate | Stem-key collisions reported as warnings for human review |
| Ban list | Expand `BANNED` before production — the current list is illustrative |

### 6.2 Rubric calibration

Two corrections came out of building the seed corpus. Both are in the code with
comments; recording them here so they are not "fixed" back.

**Easy is 0–1, not the 0–2 in the PRD.** A word scoring 2 has two axes below
perfect, which in practice means a composed drawing rather than one canonical
shape. "Vending machine" (5,4,4,5 = 2) is a fair-looking Easy score and is
plainly harder to draw than "cat" (5,5,5,5 = 0).

**The four axes cannot separate Hard from God Mode.** Both tiers are abstract,
so both land at 8–16 and the boundary was arbitrary: "peer pressure" and "the
bystander effect" both score 11. What actually separates them is *register* —
God Mode words are named terms of art from a specialist domain and need their
meaning printed under them;
Hard words are abstract but everyday language. So:

```python
def assign_tier(score, category):
    if score <= 1: return "easy"
    if score <= 7: return "moderate"
    return "god" if category in SPECIALIST else "hard"

SPECIALIST = {"biases","philosophy","science","biology",
              "economics","internet","maths","literature"}
```

This also correctly demotes drawable science — "black hole" (score 6),
"solar eclipse" (5), "photosynthesis" (7) are Moderate, not God Mode. That is
right: everyone can draw a black hole.

There is no override mechanism. Tier is a pure function of score and domain.

### 6.3 Growing the corpus

The seed is 1,100 words, 23% of the 4,800 V1.0 target. Growth is editorial work,
not a code task. Pipeline, in order: overgenerate 3–5× per category against
quotas → mechanical filters (dedupe, ban list, word-count, frequency check
against a reference corpus as an objective proxy for the R axis) → assisted
scoring calibrated on a ~200-word golden set, halting the batch if calibration
drifts → human review of survivors only → playtest gate for God Mode.

---

## 7. PWA and the WebKit constraint

This is the highest-severity risk in the PRD and it drives a P0 requirement.

WebKit deletes **all** script-writable storage — localStorage, IndexedDB, service
worker registrations, Cache API — after 7 days without user interaction with the
site. A party game played monthly trips this every single time. The only
exemption is web apps added to the home screen.

Therefore:

- `vite-plugin-pwa` with `registerType: 'autoUpdate'`, a complete manifest, and
  maskable icons at 192/512.
- Precache the app shell and all four corpus bundles (16.6 KB gzipped total —
  precaching them costs nothing and guarantees offline play).
- Capture `beforeinstallprompt`; show the install card **after the first
  completed session**, framed as "keep your word history" — because that is
  literally its function, not a growth tactic. Remember dismissal.
- iOS gives no `beforeinstallprompt`. Detect iOS Safari and show the manual
  "Share → Add to Home Screen" instruction instead.

Reference: <https://webkit.org/tracking-prevention/>

---

## 8. Tests

### 8.1 Property tests — these are the product (NFR-07)

Run against synthetic ordinals, not the seed corpus, so they can exercise
launch-scale volumes.

| Test | Assertion |
|---|---|
| `no-repeat/single-tier` | 10,000 draws from a 10,000-word synthetic tier → zero repeats |
| `no-repeat/across-sessions` | 10 × 50 draws, adapter torn down and rebuilt between each → zero repeats |
| `no-repeat/corpus-update` | 500 draws, then +200/−50 corpus change, then 150 draws → zero repeats across the boundary |
| `burn-on-reveal` | draw, discard the adapter without recording an outcome, rebuild → that ord is not served again |
| `anti-clustering/permutation` | `sorted(before) === sorted(after)` — reordering never changes membership |
| `anti-clustering/adjacency` | the same category never twice consecutively, on synthetic and shipping corpora |
| `anti-clustering/proportional` | over 20-draw windows, no category beyond its own share of the deck |
| `bitmap/round-trip` | `decode(encode(s)) === s` for arbitrary ord sets |
| `prng/determinism` | same seed → identical deck, on repeated construction |
| `recycle/cooldown` | after `recycle()`, none of the last 50 ords appear in the first half |
| `memory-code/round-trip` | export → import on a fresh adapter → identical seen-sets |

### 8.2 Unit tests

Every exported function in `src/engine/`. Every branch of the storage adapter
including the throw path (private-mode Safari).

### 8.3 Integration

`tests/integration/word-screen.test.ts` asserts that a session has nothing to
paint until `reveal()` is called, that `reveal()` burns the word, and that the
God Mode meaning renders under the word on god tier and on no other tier.

`tests/integration/navigation.test.ts` drives the real `App` against a stubbed
fetch and asserts that the game screen owns a history entry, that back returns
to tier select rather than leaving, and that an unfinished game is abandoned on
the way out with its drawn words still burned. That last one is the regression
test for the back-button bug in §5.1.

### 8.4 CI

```
npm run corpus:check    # every corpus gate
npm run build           # typecheck + bundle
npm test                # unit + integration
npm run test:property   # the 10,000-draw assertions
```

Plus a bundle-size assertion: total gzipped payload under 300 KB. And a lint
rule failing any import from `src/engine/` into `src/ui/`, or any use of
`Math.random()`, `window` or `document` inside `src/engine/`.
