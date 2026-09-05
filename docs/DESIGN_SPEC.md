# Design Specification

Drawn & Quartered · v1.0

The design system is carried over from the PRD: cool blue-biased neutrals, four
marker-ink tier colours, Bricolage Grotesque over IBM Plex. The app is quieter
than a typical party game on purpose — the *word* is the loud element, and
everything around it gets out of its way.

**One hard constraint governs every screen below:** this is used on a phone
being passed around a room in poor light, by someone holding a drink, and on a
laptop propped on a coffee table across the room. Both are primary. Neither is a
scaled version of the other.

---

## 1. Responsive strategy

Two designs, not one design that stretches.

| | Phone (`< 768px`) | Laptop (`>= 768px`) |
|---|---|---|
| Role | The passed device. One drawer at a time. | The shared screen everyone watches. |
| Orientation | Portrait. Lock the game screens. | Landscape. |
| Layout | Single column, full-bleed, thumb-reachable controls | Centred column, max 720px, generous margins |
| Word size | `clamp(2.5rem, 11vw, 4rem)` | `clamp(4rem, 7vw, 7rem)` |
| Controls | Bottom-anchored, 56px min height | Centred under the word, 48px |
| Timer | Ring, top-right, 64px | Ring, above the word, 96px |
| Handover beat | "Next drawer" on the resolved screen | Same button; the room can see the screen anyway |

### Breakpoints

```css
/* Mobile first. Only two real breakpoints; resist adding more. */
--bp-lap: 768px;    /* phone -> laptop */
--bp-wide: 1200px;  /* laptop -> wide: wider gutters only, no new layout */
```

### Non-negotiables

- **Touch targets 48×48 CSS px minimum**, 56px for the three outcome buttons.
- **Thumb zone.** On phone, every control used mid-round sits in the bottom
  third. Nothing that matters lives in a top corner.
- **No hover-only affordances.** Every hover state has a focus and active twin.
- **Safe areas.** `padding-bottom: max(24px, env(safe-area-inset-bottom))` on
  bottom-anchored bars.
- **Wake lock** during an active timer (`navigator.wakeLock`, best-effort with a
  silent catch). A screen that sleeps mid-round is a bug report.
- **Landscape phone** is not designed for, but must not break: below 480px
  height, drop the timer ring to a bar and shrink the word one step.

---

## 2. Tokens

Defined once in `src/ui/tokens.css`. No colour literal appears anywhere else.

```css
:root {
  /* neutrals — cool, blue-biased. Chosen, not inherited. */
  --bg:         #F1F4F7;
  --surface:    #FFFFFF;
  --surface-2:  #E7ECF1;
  --ink:        #111820;
  --ink-2:      #3D4A57;
  --muted:      #697887;
  --line:       #D3DBE3;
  --line-soft:  #E3E9EF;

  /* tier inks — whiteboard markers */
  --t-easy:     #1F8A54;  --t-easy-soft:     #E2F2EA;
  --t-moderate: #1A6BB0;  --t-moderate-soft: #E4EFF8;
  --t-hard:     #C2521C;  --t-hard-soft:     #FAEBE1;
  --t-god:      #8E2A6B;  --t-god-soft:      #F7E6F1;

  /* film decks — Dumb Charades */
  --t-hindi:    #B03F2F;  --t-hindi-soft:    #F9E7E3;
  --t-english:  #0F6F78;  --t-english-soft:  #DFF0F1;
  --t-mixed:    #6A4BB5;  --t-mixed-soft:    #ECE6F8;

  /* game inks — aliases, so the game cards follow their decks into dark mode */
  --g-pictionary: var(--t-moderate);
  --g-charades:   var(--t-hindi);

  /* semantic — separate from tier colour, never reused as accent */
  --ok:   #1F8A54;
  --warn: #B4761A;
  --crit: #BE3B2E;

  /* type */
  --display: "Bricolage Grotesque", "IBM Plex Sans", system-ui, sans-serif;
  --sans:    "IBM Plex Sans", -apple-system, "Segoe UI", sans-serif;
  --mono:    "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;

  /* spacing — 4px base */
  --s1: 4px;  --s2: 8px;  --s3: 12px; --s4: 16px;
  --s5: 24px; --s6: 32px; --s7: 48px; --s8: 64px;

  --radius: 10px;
  --radius-lg: 16px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0D1117; --surface: #151C24; --surface-2: #1E2732;
    --ink: #E9EEF3; --ink-2: #BAC6D2; --muted: #8494A3;
    --line: #2A3540; --line-soft: #212B35;
    --t-easy: #4FC08A; --t-easy-soft: #13291F;
    --t-moderate: #5FA8E0; --t-moderate-soft: #13273A;
    --t-hard: #E8853F; --t-hard-soft: #2E1E14;
    --t-god: #D471AC; --t-god-soft: #2B1626;
    --ok: #4FC08A; --warn: #DBA24A; --crit: #E8695B;
  }
}
:root[data-theme="dark"] { /* same block again, so an explicit toggle wins */ }
```

Every token is declared in the bare `:root` first. A colour whose only definition
sits inside a media query renders one theme's text on the other theme's ground.

### Type scale

| Role | Phone | Laptop | Face | Notes |
|---|---|---|---|---|
| The word | `clamp(2.5rem,11vw,4rem)` | `clamp(4rem,7vw,7rem)` | display 600 | `text-wrap: balance`, max 3 lines |
| Screen title | 1.5rem | 2rem | display 600 | |
| Body | 1rem | 1.0625rem | sans 400 | 1.55 line-height |
| Label / meta | 0.75rem | 0.8125rem | mono 400 | `.08em` tracking, uppercase |
| Button | 1rem | 1rem | sans 600 | |
| Timer digits | 1.25rem | 1.5rem | mono 500 | `tabular-nums` |

---

## 3. Screens

Eight screens. Each is specified at both sizes.

### 3.0 Game select — the landing screen

Two cards. No splash, no onboarding, no cookie banner.

**Content per game card:** game name, the verb (Draw it / Act it out), a
one-line description, and the entries remaining across that game's decks — the
same evidence-on-the-surface rule as the deck cards below.

```
PHONE (<768px)                    LAPTOP (>=768px)
┌─────────────────────┐           ┌───────────────────────────────────┐
│ Drawn & Quartered   │           │        Drawn & Quartered          │
│ Pick a game         │           │           Pick a game             │
│                     │           │                                   │
│ ┌─────────────────┐ │           │  ┌─────────────┐ ┌─────────────┐  │
│ │▌Pictionary      │ │           │  │▌Pictionary  │ │▌Dumb        │  │
│ │        Draw it  │ │           │  │    Draw it  │ │  Charades   │  │
│ │ Four tiers...   │ │           │  │ Four tiers  │ │ Act it out  │  │
│ │ 3,977 words left│ │           │  │ 3,977 left  │ │ 857 left    │  │
│ └─────────────────┘ │           │  └─────────────┘ └─────────────┘  │
│ ┌─────────────────┐ │           │                                   │
│ │▌Dumb Charades   │ │           │            ⚙ Settings             │
│ └─────────────────┘ │           └───────────────────────────────────┘
│ ⚙ Settings          │
└─────────────────────┘
```

This screen costs one tap on the way to a Pictionary game that used to start
from the front door. A segmented control at the top of the deck list would have
saved the tap and left the app unable to say what it now is: two games that
share a memory.

### 3.1 Deck select

The whole of one game in one view, serving both — four difficulty tiers for
Pictionary, three film decks for Dumb Charades. The card is the same object
either way, because the thing it shows is the same thing: a deck, how much of it
is left, and whether you have finished it.

**Content per card:** deck name (Doodle / Sketch / Cryptic / God Mode, or
Bollywood / Hollywood / Mixed Bag), a plain-English detail label, a one-line
description, and **entries remaining** — the remaining count is the product's
differentiator, so it is on the surface from the first second, not buried in a
settings screen. The unit follows the game: Pictionary counts words, charades
counts films.

```
PHONE (<768px)                    LAPTOP (>=768px)
┌─────────────────────┐           ┌───────────────────────────────────┐
│ Drawn & Quartered   │           │        Drawn & Quartered          │
│ Pick a difficulty   │           │        Pick a difficulty          │
│                     │           │                                   │
│ ┌─────────────────┐ │           │  ┌─────────────┐ ┌─────────────┐  │
│ │▌Doodle    Easy  │ │           │  │▌Doodle      │ │▌Sketch      │  │
│ │ One object.     │ │           │  │ One object. │ │ A scene.    │  │
│ │ 306 words left  │ │           │  │ 306 left    │ │ 372 left    │  │
│ └─────────────────┘ │           │  └─────────────┘ └─────────────┘  │
│ ┌─────────────────┐ │           │  ┌─────────────┐ ┌─────────────┐  │
│ │▌Sketch  Moderate│ │           │  │▌Cryptic     │ │▌God Mode    │  │
│ └─────────────────┘ │           │  └─────────────┘ └─────────────┘  │
│  ... 2 more         │           │                                   │
│                     │           │     Settings · Memory Code        │
│ ⚙ Settings          │           └───────────────────────────────────┘
└─────────────────────┘
```

- Phone: single column, cards stack, full width, 12px gap.
- Laptop: 2×2 grid, max 720px, centred. **Four items means 2×2** — never a
  3-wide row with an orphan. The three charades decks go 1×3 for the same
  reason (`.tiers--3`), never 2 + an orphan.
- `▌` is a 4px left rule in the tier ink. Tier is never conveyed by colour alone;
  the name and the label carry it (NFR-04).
- At ≥90% depletion the count turns `--warn` and reads "42 left".
- Footer carries Teams, Settings and "All games"; back from here reaches §3.0.
- Exhausted tier: card dims, count reads "Deck complete", tapping opens the
  recycle screen rather than a game.

### 3.2 Team setup — skippable

Reached only if the host taps "Add teams". Default path skips it entirely.

- 2–6 teams, inline-editable names, defaults "Team 1"…
- Phone: full-width rows, `+ Add team` at the bottom, `Start` pinned bottom.
- Laptop: same list, 480px centred.
- **Skip is as prominent as Start.** Most sessions never score.

### 3.3 Cover — REMOVED (Sep 2026)

The cover screen was a full-bleed "Drawer only / Tap when you're holding the
phone" interstitial in front of every word. It was removed at Sabuj's request.

What replaces it: nothing. Picking a tier goes straight to the first word, and
"Next drawer" on the resolved screen goes straight to the next one. That button
IS the handover beat — the person who taps it is the person holding the phone —
and it was always doing that job while the cover screen took the credit.

What did not change: the word is still drawn at the instant it is painted, never
before. See invariant 4 in `CLAUDE.md`. Do not reintroduce a pre-fetched "next
word" as an optimisation; there is nothing to optimise and it is the one bug in
this app with no visible symptom.

### 3.4 Playing — the word

```
PHONE                              LAPTOP
┌─────────────────────┐            ┌───────────────────────────────────┐
│ Cryptic      ⏱ 0:47 │            │  Cryptic                   ⏱ 0:47 │
│                     │            │                                   │
│                     │            │            ● ●                    │
│      ● ●            │            │                                   │
│                     │            │      writer's block               │
│   writer's          │            │                                   │
│   block             │            │        3 points                   │
│                     │            │                                   │
│   3 points          │            │  ┌────────┐ ┌──────┐ ┌─────────┐  │
│                     │            │  │ Got it │ │ Pass │ │ Time up │  │
│ ┌─────────────────┐ │            │  └────────┘ └──────┘ └─────────┘  │
│ │     Got it      │ │            └───────────────────────────────────┘
│ ├────────┬────────┤ │
│ │  Pass  │Time up │ │
│ └────────┴────────┘ │
└─────────────────────┘
```

- **Word-count pips** (`● ●`) above the word — the drawer signals the count, which
  is standard play. Pips for 1–4 words; **5+ shows a numeric badge** ("5 words")
  because seven dots is unreadable.
- Word in the tier ink, display face, `text-wrap: balance`, max 3 lines before
  the size steps down.
- Phone: `Got it` full-width on top (the common case, biggest target), `Pass` and
  `Time up` split below. Bottom-anchored with safe-area padding.
- Laptop: three equal buttons in a row, centred.
- Timer ring: `--muted` track, tier ink progress; switches to `--crit` at 10s
  with a single 200ms pulse — one pulse, not a loop.
- **God Mode only:** the word's meaning, printed under it in `--ink-2` at
  1.0625rem, `max-width: 34ch`, `text-wrap: balance`. Always visible: no button,
  no tap, no points penalty. It is there because a God Mode term is a named
  thing from someone else's field, and the drawer has to draw the idea — which
  they cannot do if they cannot define it.

  REMOVED (Sep 2026): the `Show hint (½ points)` button and the halved award
  that went with it. There is no longer anything on this screen to buy.
- **Twist**, when active: a chip above the pips in `--warn-soft` — "Non-dominant
  hand". Appears ~20% of rounds when enabled, off by default.

### 3.5 Summary

Words played, hit rate, winning team, and the full word list for the session —
so the room can relitigate the round that was robbed.

- Phone: stacked. Headline stat, then the list, then `Play again` / `Change tier`.
- Laptop: two columns — stats left, word list right.
- The word list shows outcome per word (got it / passed / timed out) as a small
  coloured dot, with a text label, never colour alone.
- **First completed session triggers the install card** (FR-10) below the stats:
  "Add to your home screen to keep your word history." One dismissal is
  remembered forever. On iOS, show the manual Share → Add to Home Screen steps.

### 3.6 Settings & Memory Code

One screen, plain rows. Timer (60/90/120/off), twists, sound, theme.

Memory Code sits at the bottom under a `Word history` heading with an honest
explanation of why it exists:

> Your history lives in this browser only. Another browser on this device keeps
> its own. If you clear your browsing data, it goes. Copy this code to move or
> restore it.

A read-only code field, `Copy`, and `Restore from code`. Import validates and
reports what changed ("Restored 418 words across 4 tiers") rather than silently
succeeding.

---

## 4. Motion

Restrained. This is a utility used under time pressure, not a showpiece.

| Transition | Duration | Easing |
|---|---|---|
| Screen change | 180ms | `cubic-bezier(.2,0,0,1)` |
| Button press | 90ms scale to .97 | `ease-out` |
| Timer final 10s | one 200ms pulse | `ease-in-out` |

`@media (prefers-reduced-motion: reduce)` removes all of it, including the timer
pulse. The timer stays legible without motion.

---

## 5. Accessibility (NFR-04, WCAG 2.2 AA)

- The word renders at ≥32px with contrast ≥7:1 against its ground. Verify each
  tier ink in both themes — `--t-hard` on dark needs checking specifically.
- Full keyboard operation: `Space`/`Enter` reveals, `G`/`P`/`T` resolve the round,
  `Esc` leaves the game. Show the shortcuts on laptop, hide on touch.
- Visible focus ring on every interactive element: `2px solid var(--ink)`,
  3px offset. Never `outline: none` without a replacement.
- Tier and outcome are never colour-only — always paired with text.
- Live region (`aria-live="polite"`) announces the timer at 30s, 10s and 0s, and
  announces the revealed word once.
- Every control that acts is a real `<button>` with an accessible name, never a
  click-handled `<div>`.
- The God Mode meaning is ordinary body text under the word, so a screen reader
  reaches it in reading order without any extra announcement.
- Respect `prefers-contrast: more` by dropping the soft tier tints for solid
  borders.

---

## 6. Icons and assets

No icon library. The handful needed (settings gear, timer, chevron, copy) are
inline SVG in `src/ui/icons.ts`, `currentColor`, 24×24, `stroke-width: 1.5`.

PWA icons: 192 and 512 maskable, plus an Apple touch icon. The mark is a pencil
nib quartered into the four tier inks — one glyph that carries the name and the
four-tier structure, and stays legible at 48px.
