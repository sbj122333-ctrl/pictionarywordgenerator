/**
 * Tier select — the landing screen. DESIGN_SPEC §3.1.
 *
 * The whole product in one view. No splash, no onboarding, no cookie banner.
 *
 * Words-remaining is on every card from the first second because that number is
 * the differentiator; a product whose claim is "it remembers" should not make
 * you go looking for the evidence.
 */
import type { Tier } from '../../engine/types';
import { DEPLETION_WARNING, TIERS, TIER_LABELS } from '../../engine/types';
import { el, icon, ICONS } from '../dom';

const DESCRIPTIONS: Readonly<Record<Tier, string>> = {
  easy: 'One object, one shape. Everybody scores.',
  moderate: 'A scene, or a thing with parts.',
  hard: 'Abstract, but everyday language.',
  god: 'Named ideas from somebody else’s field.',
};

export interface TierStatus {
  remaining: number;
  total: number;
  cycles: number;
}

export interface TierSelectProps {
  status: Readonly<Record<Tier, TierStatus>>;
  banner?: HTMLElement | null;
  onPick: (tier: Tier) => void;
  onRecycle: (tier: Tier) => void;
  onSettings: () => void;
}

export function tierSelectScreen(props: TierSelectProps): HTMLElement {
  const cards = TIERS.map((tier) => tierCard(tier, props));

  return el(
    'div',
    { class: 'screen' },
    el(
      'header',
      { class: 'screen__head' },
      el('h1', { class: 'title', text: 'Drawn & Quartered' }),
      el('p', { class: 'subtitle', text: 'Pick a difficulty' }),
    ),
    props.banner ?? null,
    el('div', { class: 'screen__body' }, el('div', { class: 'tiers' }, ...cards)),
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

function tierCard(tier: Tier, props: TierSelectProps): HTMLElement {
  const { remaining, total, cycles } = props.status[tier];
  const labels = TIER_LABELS[tier];
  const depleted = total === 0 ? 0 : (total - remaining) / total;
  const exhausted = total > 0 && remaining === 0;
  const low = !exhausted && depleted >= DEPLETION_WARNING;

  const countText = exhausted
    ? 'Deck complete'
    : total === 0
      ? 'Loading…'
      : `${remaining.toLocaleString('en-GB')} words left`;

  const count = el('span', {
    class: `tier-card__left${low ? ' tier-card__left--warn' : ''}${
      exhausted ? ' tier-card__left--done' : ''
    }`,
    text: cycles > 0 && !exhausted ? `${countText} · round ${cycles + 1}` : countText,
  });

  // Tier is never conveyed by colour alone (NFR-04): the name and the
  // difficulty label both carry it, and the rule is decoration.
  return el(
    'button',
    {
      class: `tier-card${exhausted ? ' tier-card--done' : ''}`,
      type: 'button',
      style: `--tier-ink: var(--t-${tier})`,
      on: {
        click: () => (exhausted ? props.onRecycle(tier) : props.onPick(tier)),
      },
    },
    el(
      'span',
      { class: 'tier-card__top' },
      el('span', { class: 'tier-card__name', text: labels.name }),
      el('span', { class: 'label', text: labels.difficulty }),
    ),
    el('span', { class: 'tier-card__desc', text: DESCRIPTIONS[tier] }),
    el('span', { class: 'tier-card__top' }, count, icon(ICONS.chevron)),
  );
}
