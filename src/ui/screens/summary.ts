/**
 * Summary. DESIGN_SPEC §3.5.
 *
 * The full word list is here so the room can relitigate the round that was
 * robbed. That is the actual use, and it is why every word carries its outcome
 * as text as well as a dot — colour alone would put the argument out of reach of
 * anyone who cannot see the difference between the green one and the red one.
 */
import type { Outcome, Round, Team } from '../../state/session';
import { TIER_LABELS } from '../../engine/types';
import type { Tier } from '../../engine/types';
import { el } from '../dom';

const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = {
  got: 'Got it',
  pass: 'Passed',
  timeout: 'Timed out',
};

export interface SummaryProps {
  tier: Tier;
  rounds: readonly Round[];
  teams: readonly Team[];
  winner: Team | null;
  drawn: boolean;
  installCard: HTMLElement | null;
  onPlayAgain: () => void;
  onChangeTier: () => void;
}

export function summaryScreen(props: SummaryProps): HTMLElement {
  const played = props.rounds.length;
  const hits = props.rounds.filter((r) => r.outcome === 'got').length;
  const rate = played === 0 ? 0 : Math.round((hits / played) * 100);

  const stats = el(
    'div',
    {},
    el('p', { class: 'label', text: `${TIER_LABELS[props.tier].name} · session` }),
    el('p', { class: 'stat', text: `${hits}/${played}` }),
    el('p', {
      class: 'subtitle',
      text: played === 0 ? 'No words played.' : `${rate}% guessed`,
    }),
    props.teams.length > 0 ? scoreboard(props) : null,
    props.installCard,
  );

  const list = el(
    'div',
    {},
    el('p', { class: 'label', text: 'Words' }),
    played === 0
      ? el('p', { class: 'note', text: 'Nothing drawn this session.' })
      : el(
          'ul',
          { class: 'words' },
          ...props.rounds.map((round) =>
            el(
              'li',
              {},
              el('span', { class: 'words__text', text: round.text }),
              el(
                'span',
                { class: 'words__outcome' },
                el('span', { class: `dot dot--${round.outcome}`, 'aria-hidden': 'true' }),
                OUTCOME_LABEL[round.outcome],
              ),
            ),
          ),
        ),
  );

  return el(
    'div',
    { class: 'screen' },
    el('header', { class: 'screen__head' }, el('h1', { class: 'title', text: 'Session over' })),
    el('div', { class: 'screen__body summary--wide' }, stats, list),
    el(
      'div',
      { class: 'screen__foot' },
      el(
        'button',
        { class: 'btn btn--primary', type: 'button', on: { click: props.onPlayAgain } },
        'Play again',
      ),
      el(
        'button',
        { class: 'btn', type: 'button', on: { click: props.onChangeTier } },
        'Change tier',
      ),
    ),
  );
}

function scoreboard(props: SummaryProps): HTMLElement {
  const ranked = [...props.teams].sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;

  return el(
    'div',
    {},
    el('p', {
      class: 'subtitle',
      text: props.drawn
        ? 'Drawn — nobody wins.'
        : props.winner
          ? `${props.winner.name} wins`
          : '',
    }),
    el(
      'ul',
      { class: 'scores' },
      ...ranked.map((team) =>
        el(
          'li',
          { class: !props.drawn && team.score === top ? 'scores__winner' : '' },
          el('span', { text: team.name }),
          el('span', { text: `${team.score}` }),
        ),
      ),
    ),
  );
}

/**
 * FR-10. Shown after the FIRST COMPLETED SESSION, never before, and framed as
 * what it actually does.
 *
 * WebKit deletes all script-writable storage after seven days without a visit,
 * and a home-screen install is the only exemption. So this card is not a growth
 * tactic dressed as a feature — installing genuinely is the cross-session memory
 * guarantee, and saying anything else would be a lie the app then fails to keep.
 */
export function installCard(options: {
  ios: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}): HTMLElement {
  const body = options.ios
    ? el('p', {
        class: 'row__note',
        text: 'Tap Share, then “Add to Home Screen”. Otherwise iOS clears your history after a week without a visit.',
      })
    : el('p', {
        class: 'row__note',
        text: 'Browsers clear site data after a week or two of not visiting. Installing is what keeps your word history.',
      });

  const actions = el(
    'div',
    { class: 'btn-row', style: 'margin-top: var(--s3)' },
    options.ios
      ? null
      : el(
          'button',
          { class: 'btn btn--primary', type: 'button', on: { click: options.onInstall } },
          'Add to home screen',
        ),
    el(
      'button',
      { class: 'btn btn--quiet', type: 'button', on: { click: options.onDismiss } },
      'Not now',
    ),
  );

  return el(
    'div',
    { class: 'card', style: 'margin-top: var(--s5)' },
    el('p', { class: 'banner__title', text: 'Keep your word history' }),
    body,
    actions,
  );
}
