/**
 * Game select — the landing screen. DESIGN_SPEC §3.0.
 *
 * Three cards, no splash, no onboarding. The cost of this screen is one tap on
 * the way to a Pictionary game that used to start from the front door, and it is
 * worth it: a segmented control at the top of the deck list would have saved the
 * tap and left the app unable to say what it now is, which is games that happen
 * to share a memory.
 *
 * Each card carries its own remaining count for the same reason the deck cards
 * do — the claim is that the app remembers, and the evidence should not need
 * looking for.
 */
import type { Game } from '../../engine/types';
import { GAMES, GAME_LABELS } from '../../engine/types';
import { el, icon, ICONS } from '../dom';

/**
 * Hexhaven is deliberately NOT a member of `Game`.
 *
 * Every `Game` in the engine owns decks, frozen ordinals and a seen-bitmap —
 * `GAME_DECKS`, `DECK_POINTS` and the stored `tiers` record are all
 * `Record<Game, …>`. Hexhaven has no corpus and nothing to remember between
 * sessions, so adding it to `GAMES` would mean widening those records with
 * members that can only ever hold dead values, and every exhaustive switch in
 * the engine would grow a branch that cannot happen.
 *
 * It is a separate page instead, reached by a real link. A link and not a
 * button because it navigates away rather than acting (DESIGN_SPEC §5) — that
 * also gets middle-click and "open in new tab" for free, which a click-handled
 * button would swallow.
 */
const HEXHAVEN = {
  href: '/hexhaven/',
  name: 'Hexhaven',
  verb: 'Trade',
  blurb: 'Settle the island, trade for what you are short of, race to ten points.',
  note: '3–6 players · a device each',
} as const;

export interface HomeProps {
  /** One line per game: "3,977 words left", or "Loading…" before the manifest. */
  status: Readonly<Record<Game, string>>;
  banner?: HTMLElement | null;
  onPick: (game: Game) => void;
  onSettings: () => void;
}

export function homeScreen(props: HomeProps): HTMLElement {
  return el(
    'div',
    { class: 'screen' },
    el(
      'header',
      { class: 'screen__head' },
      el('h1', { class: 'title', text: 'Drawn & Quartered' }),
      el('p', { class: 'subtitle', text: 'Pick a game' }),
    ),
    props.banner ?? null,
    el(
      'div',
      { class: 'screen__body' },
      el(
        'div',
        { class: 'games' },
        ...GAMES.map((game) => gameCard(game, props)),
        hexhavenCard(),
      ),
    ),
    el(
      'div',
      { class: 'screen__foot' },
      el(
        'button',
        { class: 'btn btn--quiet', type: 'button', on: { click: props.onSettings } },
        icon(ICONS.gear),
        'Settings',
      ),
    ),
  );
}

function gameCard(game: Game, props: HomeProps): HTMLElement {
  const labels = GAME_LABELS[game];

  // The game is never conveyed by colour alone (NFR-04): the name and the verb
  // both carry it, and the rule down the side is decoration.
  return el(
    'button',
    {
      class: 'game-card',
      type: 'button',
      style: `--tier-ink: var(--g-${game})`,
      on: { click: () => props.onPick(game) },
    },
    el(
      'span',
      { class: 'tier-card__top' },
      el('span', { class: 'game-card__name', text: labels.name }),
      el('span', { class: 'label', text: labels.verb }),
    ),
    el('span', { class: 'tier-card__desc', text: labels.blurb }),
    el(
      'span',
      { class: 'tier-card__top' },
      el('span', { class: 'tier-card__left', text: props.status[game] }),
      icon(ICONS.chevron),
    ),
  );
}

function hexhavenCard(): HTMLElement {
  return el(
    'a',
    {
      class: 'game-card game-card--away',
      href: HEXHAVEN.href,
      style: '--tier-ink: var(--g-hexhaven)',
    },
    el(
      'span',
      { class: 'tier-card__top' },
      el('span', { class: 'game-card__name', text: HEXHAVEN.name }),
      el('span', { class: 'label', text: HEXHAVEN.verb }),
    ),
    el('span', { class: 'tier-card__desc', text: HEXHAVEN.blurb }),
    el(
      'span',
      { class: 'tier-card__top' },
      el('span', { class: 'tier-card__left', text: HEXHAVEN.note }),
      icon(ICONS.chevron),
    ),
  );
}
