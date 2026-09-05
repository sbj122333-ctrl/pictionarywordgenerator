/**
 * Deck complete. DESIGN_SPEC §3.1, TECHNICAL_SPEC §3.4, FR-07.
 *
 * Reaching this screen is the good ending — somebody has played every entry in a
 * deck — so it reads as a milestone rather than an error, and starting again is
 * an explicit choice. Recycling clears the deck's bitmap, which is the one place
 * in the app where history is deliberately discarded; doing that silently would
 * undermine every other guarantee.
 *
 * Mixed gets its own sentence. It has no bitmap of its own, so finishing it and
 * starting again is the same act as starting both film decks again, and a player
 * who is told "this clears this deck" and then finds Bollywood reset has been
 * misled by us, not surprised by the app.
 */
import type { PlayableDeck } from '../../engine/types';
import { DECK_LABELS, plural } from '../../engine/types';
import { el } from '../dom';

export interface RecycleProps {
  deck: PlayableDeck;
  total: number;
  cycles: number;
  onRecycle: () => void;
  onBack: () => void;
}

const SHARED_MEMORY =
  'Mixed has no memory of its own — it deals from Bollywood and Hollywood and ' +
  'writes to theirs. Starting it again clears both film decks. Your Pictionary ' +
  'tiers keep their history.';

const OWN_MEMORY =
  'This clears what you have seen in this deck so every entry can come back. ' +
  'The other decks keep their history. Entries from your last session are held ' +
  'back to the second half, so it will not open on one you have just had.';

export function recycleScreen(props: RecycleProps): HTMLElement {
  const labels = DECK_LABELS[props.deck];

  return el(
    'div',
    { class: 'screen', style: `--tier-ink: var(--t-${props.deck})` },
    el(
      'header',
      { class: 'screen__head' },
      el('p', { class: 'label', text: labels.name }),
      el('h1', { class: 'title', text: 'Deck complete' }),
      el('p', {
        class: 'subtitle',
        text: `You have played all ${plural(props.total, labels.unit)} in ${labels.name}${
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
          text: props.deck === 'mixed' ? SHARED_MEMORY : OWN_MEMORY,
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
        'Pick another deck',
      ),
    ),
  );
}
