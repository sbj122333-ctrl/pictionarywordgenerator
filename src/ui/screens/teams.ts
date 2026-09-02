/**
 * Team setup — skippable. DESIGN_SPEC §3.2.
 *
 * Most sessions never score, so Skip is as prominent as Start rather than a
 * greyed-out escape hatch. Reaching this screen at all is opt-in.
 */
import type { Team } from '../../state/session';
import { el } from '../dom';

const MIN_TEAMS = 2;
const MAX_TEAMS = 6;

export interface TeamSetupProps {
  onStart: (teams: Team[]) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function teamSetupScreen(props: TeamSetupProps): HTMLElement {
  const names: string[] = ['Team 1', 'Team 2'];
  const list = el('div', {});

  const render = (): void => {
    list.textContent = '';
    names.forEach((name, index) => {
      const input = el('input', {
        class: 'team-row__input',
        type: 'text',
        value: name,
        maxlength: '24',
        'aria-label': `Team ${index + 1} name`,
        on: {
          input: (event) => {
            names[index] = (event.target as HTMLInputElement).value;
          },
        },
      });

      const remove = el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `Remove ${name}`,
          disabled: names.length <= MIN_TEAMS,
          on: {
            click: () => {
              names.splice(index, 1);
              render();
            },
          },
        },
        '−',
      );

      list.appendChild(el('div', { class: 'team-row' }, input, remove));
    });

    add.disabled = names.length >= MAX_TEAMS;
  };

  const add = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      on: {
        click: () => {
          names.push(`Team ${names.length + 1}`);
          render();
        },
      },
    },
    '+ Add team',
  );

  const start = el(
    'button',
    {
      class: 'btn btn--primary',
      type: 'button',
      on: {
        click: () =>
          props.onStart(
            names.map((name, i) => ({ name: name.trim() || `Team ${i + 1}`, score: 0 })),
          ),
      },
    },
    'Start with teams',
  );

  const skip = el(
    'button',
    { class: 'btn', type: 'button', on: { click: props.onSkip } },
    'Skip — just play',
  );

  render();

  return el(
    'div',
    { class: 'screen' },
    el(
      'header',
      { class: 'screen__head' },
      el('h1', { class: 'title', text: 'Teams' }),
      el('p', { class: 'subtitle', text: 'Two to six. Or skip and keep score yourselves.' }),
    ),
    el('div', { class: 'screen__body' }, list, add),
    el('div', { class: 'screen__foot' }, start, skip),
    el(
      'div',
      { class: 'screen__foot' },
      el('button', { class: 'btn btn--quiet', type: 'button', on: { click: props.onBack } }, 'Back'),
    ),
  );
}
