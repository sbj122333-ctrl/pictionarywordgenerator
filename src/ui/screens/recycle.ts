/**
 * Deck complete. DESIGN_SPEC §3.1, TECHNICAL_SPEC §3.4, FR-07.
 *
 * Reaching this screen is the good ending — somebody has played every word in a
 * tier — so it reads as a milestone rather than an error, and starting again is
 * an explicit choice. Recycling clears the tier's bitmap, which is the one place
 * in the app where history is deliberately discarded; doing that silently would
 * undermine every other guarantee.
 */
import type { Tier } from '../../engine/types';
import { TIER_LABELS } from '../../engine/types';
import { el } from '../dom';

export interface RecycleProps {
  tier: Tier;
  total: number;
  cycles: number;
  onRecycle: () => void;
  onBack: () => void;
}

export function recycleScreen(props: RecycleProps): HTMLElement {
  const labels = TIER_LABELS[props.tier];

  return el(
    'div',
    { class: 'screen', style: `--tier-ink: var(--t-${props.tier})` },
    el(
      'header',
      { class: 'screen__head' },
      el('p', { class: 'label', text: labels.name }),
      el('h1', { class: 'title', text: 'Deck complete' }),
      el('p', {
        class: 'subtitle',
        text: `You have played all ${props.total.toLocaleString('en-GB')} words in ${labels.name}${
          props.cycles > 0 ? `, ${props.cycles + 1} times over` : ''
        }.`,
      }),
    ),
    el(
      'div',
      { class: 'screen__body' },
      el(
        'div',
        { class: 'card' },
        el('p', { class: 'banner__title', text: 'Start the deck again?' }),
        el('p', {
          class: 'row__note',
          text: 'This clears what you have seen in this tier so every word can come back. The other three tiers keep their history. Words from your last session are held back to the second half, so it will not open on one you have just had.',
        }),
      ),
    ),
    el(
      'div',
      { class: 'screen__foot' },
      el(
        'button',
        { class: 'btn btn--primary', type: 'button', on: { click: props.onRecycle } },
        'Start again',
      ),
      el(
        'button',
        { class: 'btn btn--quiet', type: 'button', on: { click: props.onBack } },
        'Pick another tier',
      ),
    ),
  );
}
