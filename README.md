# Drawn & Quartered

A Pictionary word generator that remembers what it has already shown you.

Four curated difficulty tiers — Doodle, Sketch, Cryptic, God Mode — covering
single words and short phrases. A word you have seen once does not come back
until its entire tier is exhausted, and that memory survives closing the
browser, rebooting the phone, and content updates.

Static site, no backend, no accounts. The word games make no network calls after
first load.

A third game, **Hexhaven**, lives at `/hexhaven/` — a hex trading game for 3–6
players on separate devices. One player hosts, the others join with a five-letter
code and their browsers connect directly to each other. It is the one part of the
site that needs a connection, so it is deliberately kept out of the offline
precache and shares no code with the word games.

---

## Quick start

```bash
npm install
npm run dev
```

Python is only needed to rebuild the word corpus — `public/corpus/*.json` is
committed, so the app builds and runs without it.

```bash
npm run ci         # everything: corpus gates, lint, typecheck, build, tests, size budget
npm test           # unit + integration
npm run test:property   # the 10,000-draw no-repeat assertions — the important ones
npm run corpus     # rebuild + validate the corpus from corpus-src/ (needs Python 3)
```

## State

The app is built and playable: engine, storage, deck, all six screens, timer,
teams, scoring, PWA and Memory Code. **123 tests green, 39 KB of the 300 KB
budget.** Tasks 1–13 of `docs/BUILD_PLAN.md` are done.

Open: task 14 — the WCAG 2.2 AA audit, the real-device pass, and the gate that
cannot be automated, which is three real groups playing a full session without
reporting a repeat. And the corpus, which is at 23% of the launch target.

## Where to start

Read **`CLAUDE.md`** first — it carries the five invariants that must not be
broken, and points at the other three docs.

| Doc | Contents |
|---|---|
| `CLAUDE.md` | Invariants, commands, conventions. Read first. |
| `docs/PRD.html` | Why the product exists, market, scope, risks |
| `docs/TECHNICAL_SPEC.md` | Architecture, algorithms, data model, tests |
| `docs/DESIGN_SPEC.md` | Tokens, breakpoints, every screen at phone and laptop |
| `docs/BUILD_PLAN.md` | 14 sequenced tasks with acceptance criteria |

## The interesting problem

The obvious implementation of "no repeats across 10 sessions" is a rolling
window: store the last 10 sessions' word lists, check against them, evict the
oldest. It needs session-boundary detection, timestamps and eviction logic — and
it still permits a repeat at session eleven.

Dealing each tier as one seeded shuffle and walking a cursor through it needs two
numbers and a bitmap, and permits no repeat at all until the tier is exhausted.
The stronger guarantee is the cheaper one to build. See `docs/TECHNICAL_SPEC.md` §3.

The genuinely hard part is that WebKit deletes all local storage after seven days
without a visit — precisely the cadence of a party game. That is why the install
prompt is a P0 requirement rather than polish.

The other one only showed up against real data. "No category more than 3 times
in any 20 draws" reads like a clustering rule, but it is a rate limit: 3-in-20
caps a category at 15% of a deck, and three of the four tiers hold a category
above that. Enforcing it did not remove the surplus, it relocated it — Cryptic
finished on forty unbroken `states`. The quota is gone; the deck is scheduled
proportionally instead, and the one rule that survives is that a category never
appears twice in a row. See `docs/TECHNICAL_SPEC.md` §3.5.

## Corpus

Words are authored in `corpus-src/*.py` as scored tuples and expanded by
`scripts/build_corpus.py`, which enforces every quality gate and assigns frozen
ordinals. **Never edit `data/` or `public/corpus/` by hand** — they are generated,
and `data/ordinals.lock.json` is load-bearing.

Current seed: 1,100 words, all gates passing, 16.6 KB gzipped. That is 23% of the
4,800-word V1.0 target; growing it is editorial work and the critical path to
launch.
