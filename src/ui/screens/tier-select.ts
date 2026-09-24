/**
 * Deck select. DESIGN_SPEC §3.1.
 *
 * One screen serving both games: four difficulty tiers for Pictionary, three
 * film decks for Dumb Charades. The card is the same object either way, because
 * the thing it is showing is the same thing — a deck, how much of it is left,
 * and whether you have finished it.
 *
 * Entries-remaining is on every card from the first second because that number
 * is the differentiator; a product whose claim is "it remembers" should not make
 * you go looking for the evidence.
 */
import type { Game, PlayableDeck } from '../../engine/types';
import {
  DECK_LABELS,
  DEPLETION_WARNING,
  GAME_DECKS,
  GAME_LABELS,
  plural,
} from '../../engine/types';
import { el, icon, ICONS } from '../dom';

const DESCRIPTIONS: Readonly<Record<PlayableDeck, string>> = {
  easy: 'One object, one shape. Everybody scores.',
  moderate: 'A scene, or a thing with parts.',
  hard: 'Abstract, but everyday language.',
  expert: 'Myths, legends and famous references.',
  god: 'Named ideas from somebody else’s field.',
  hindi: 'Bollywood — the classics through to last month.',
  english: 'Hollywood — the canon and the blockbusters.',
  mixed: 'Both decks, dealt alternately. Shares their memory.',
};

const SUBTITLES: Readonly<Record<Game, string>> = {
  pictionary: 'Pick a difficulty',
  charades: 'Pick a deck',
};

export interface DeckStatus {
  remaining: number;
  total: number;
  cycles: number;
}

/** Kept as the old name so nothing downstream has to care that it widened. */
export type TierStatus = DeckStatus;

export interface DeckSelectProps {
  game: Game;
  status: Readonly<Record<PlayableDeck, DeckStatus>>;
  banner?: HTMLElement | null;
  onPick: (deck: PlayableDeck) => void;
  onRecycle: (deck: PlayableDeck) => void;
  onTeams: () => void;
  onSettings: () => void;
  onBack: () => void;
  /** Footer label for the teams button — it changes once teams exist. */
  teamsLabel: string;
}

export function deckSelectScreen(props: DeckSelectProps): HTMLElement {
  const decks = GAME_DECKS[props.game];

  return el(
    'div',
    { class: 'screen' },
    el(
      'header',
      { class: 'screen__head' },
      el('h1', { class: 'title', text: GAME_LABELS[props.game].name }),
      el('p', { class: 'subtitle', text: SUBTITLES[props.game] }),
    ),
    props.banner ?? null,
    el(
      'div',
      { class: 'screen__body' },
      el(
        'div',
        { class: `tiers tiers--${decks.length}` },
        ...decks.map((deck) => deckCard(deck, props)),
      ),
    ),
    el(
      'div',
      { class: 'screen__foot' },
      // Team setup is opt-in and lives beside Settings, because the default path
      // is meant to be tap-a-deck-and-play. DESIGN_SPEC §3.2.
      el(
        'button',
        { class: 'btn btn--quiet', type: 'button', on: { click: props.onTeams } },
        props.teamsLabel,
      ),
      el(
        'button',
        { class: 'btn btn--quiet', type: 'button', on: { click: props.onSettings } },
        icon(ICONS.gear),
        'Settings',
      ),
      el(
        'button',
        { class: 'btn btn--quiet', type: 'button', on: { click: props.onBack } },
        icon(ICONS.back),
        'All games',
      ),
    ),
  );
}

function deckCard(deck: PlayableDeck, props: DeckSelectProps): HTMLElement {
  const { remaining, total, cycles } = props.status[deck];
  const labels = DECK_LABELS[deck];
  const depleted = total === 0 ? 0 : (total - remaining) / total;
  const exhausted = total > 0 && remaining === 0;
  const low = !exhausted && depleted >= DEPLETION_WARNING;

  const countText = exhausted
    ? 'Deck complete'
    : total === 0
      ? 'Loading…'
      : `${plural(remaining, labels.unit)} left`;

  const count = el('span', {
    class: `tier-card__left${low ? ' tier-card__left--warn' : ''}${
      exhausted ? ' tier-card__left--done' : ''
    }`,
    text: cycles > 0 && !exhausted ? `${countText} · round ${cycles + 1}` : countText,
  });

  // Deck is never conveyed by colour alone (NFR-04): the name and the detail
  // label both carry it, and the rule is decoration.
  return el(
    'button',
    {
      class: `tier-card${exhausted ? ' tier-card--done' : ''}`,
      type: 'button',
      style: `--tier-ink: var(--t-${deck})`,
      on: {
        click: () => (exhausted ? props.onRecycle(deck) : props.onPick(deck)),
      },
    },
    el(
      'span',
      { class: 'tier-card__top' },
      el('span', { class: 'tier-card__name', text: labels.name }),
      el('span', { class: 'label', text: labels.detail }),
    ),
    el('span', { class: 'tier-card__desc', text: DESCRIPTIONS[deck] }),
    el('span', { class: 'tier-card__top' }, count, icon(ICONS.chevron)),
  );
}
