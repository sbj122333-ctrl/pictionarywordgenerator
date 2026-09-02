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
| Privacy cover | Essential — the phone changes hands | Still shown; the room can see the screen |

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

Six screens. Each is specified at both sizes.

### 3.1 Tier select — the landing screen

The whole product in one view. No splash, no onboarding, no cookie banner.

**Content per tier card:** tier name (Doodle / Sketch / Cryptic / God Mode),
plain-English difficulty label, one-line character description, and **words
remaining** — the remaining count is the product's differentiator, so it is on
the surface from the first second, not buried in a settings screen.

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
  3-wide row with an orphan.
- `▌` is a 4px left rule in the tier ink. Tier is never conveyed by colour alone;
  the name and the label carry it (NFR-04).
- At ≥90% depletion the count turns `--warn` and reads "42 left".
- Exhausted tier: card dims, count reads "Deck complete", tapping opens the
  recycle screen rather than a game.

### 3.2 Team setup — skippable

Reached only if the host taps "Add teams". Default path skips it entirely.

- 2–6 teams, inline-editable names, defaults "Team 1"…
- Phone: full-width rows, `+ Add team` at the bottom, `Start` pinned bottom.
- Laptop: same list, 480px centred.
- **Skip is as prominent as Start.** Most sessions never score.

### 3.3 Cover — the privacy guard

The most important screen in the app. FR-08.

```
┌───────────────────────────────────┐
│                                   │
│              ▲                    │   Full bleed, tier ink at 8% over --bg
│         Drawer only               │   Display face, centred
│                                   │
│   Tap when you're holding         │
│   the phone                       │
│                                   │
│         Team 2 · Round 7          │   mono, --muted
└───────────────────────────────────┘
```

- The entire viewport is the tap target. Not a button — the whole screen.
- **The word is not in the DOM.** It is fetched and rendered on tap. Do not
  pre-render it hidden, at `opacity: 0`, or behind `[hidden]`.
- Identical on both sizes; on laptop it is the "everyone look away" beat.
- No animation on entry — a transition here reads as a reveal and makes people
  glance up.

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
- **God Mode only:** a `Show hint (½ points)` text button under the word.
  Revealing swaps it for the hint text in `--muted` italic and halves the round's
  score. Once revealed it cannot be re-hidden.
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
| Cover → word | **0ms** | none — instant, see §3.3 |
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
- The cover screen is a `<button>` spanning the viewport with a real accessible
  name, not a click-handled `<div>`.
- Respect `prefers-contrast: more` by dropping the soft tier tints for solid
  borders.

---

## 6. Icons and assets

No icon library. The handful needed (settings gear, timer, chevron, copy) are
inline SVG in `src/ui/icons.ts`, `currentColor`, 24×24, `stroke-width: 1.5`.

PWA icons: 192 and 512 maskable, plus an Apple touch icon. The mark is a pencil
nib quartered into the four tier inks — one glyph that carries the name and the
four-tier structure, and stays legible at 48px.
