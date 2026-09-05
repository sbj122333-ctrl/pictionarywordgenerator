/**
 * Settings and Memory Code. DESIGN_SPEC §3.6.
 *
 * The history section says out loud that history is per-browser and that
 * clearing site data destroys it. That is not a disclaimer bolted on for
 * safety — a product whose whole claim is "it remembers" has to be exact about
 * where the memory lives, or the first time it is lost the claim looks like
 * marketing.
 */
import type { DeckId, Settings, Theme } from '../../engine/types';
import { DECKS } from '../../engine/types';
import { el } from '../dom';

export interface SettingsProps {
  settings: Settings;
  theme: Theme;
  degraded: boolean;
  memoryCode: string;
  deckStatus: Readonly<Record<DeckId, { remaining: number; total: number; cycles: number }>>;
  onSettings: (patch: Partial<Settings>) => void;
  onTheme: (theme: Theme) => void;
  onImport: (code: string) => Promise<string | null>;
  onBack: () => void;
}

export function settingsScreen(props: SettingsProps): HTMLElement {
  const timerRow = segmented<number | null>(
    'Round timer',
    [
      ['60s', 60],
      ['90s', 90],
      ['120s', 120],
      ['Off', null],
    ],
    props.settings.timerSeconds,
    (value) => props.onSettings({ timerSeconds: value as Settings['timerSeconds'] }),
  );

  const twistsRow = toggle(
    'Twists',
    'Occasional constraints — “non-dominant hand” drawing, “stay seated” acting. Off by default.',
    props.settings.twists,
    (on) => props.onSettings({ twists: on }),
  );

  const soundRow = toggle('Sound', null, props.settings.sound, (on) =>
    props.onSettings({ sound: on }),
  );

  const themeRow = segmented<Theme>(
    'Theme',
    [
      ['System', 'system'],
      ['Light', 'light'],
      ['Dark', 'dark'],
    ],
    props.theme,
    props.onTheme,
  );

  return el(
    'div',
    { class: 'screen' },
    el('header', { class: 'screen__head' }, el('h1', { class: 'title', text: 'Settings' })),
    el(
      'div',
      { class: 'screen__body' },
      props.degraded
        ? el(
            'div',
            { class: 'banner' },
            el('p', { class: 'banner__title', text: 'Memory is session-only' }),
            el('p', {
              text: 'This browser is refusing to store data — private browsing usually does. Anything played now will come back next time.',
            }),
          )
        : null,
      timerRow,
      twistsRow,
      soundRow,
      themeRow,
      historySection(props),
    ),
    el(
      'div',
      { class: 'screen__foot' },
      el('button', { class: 'btn', type: 'button', on: { click: props.onBack } }, 'Done'),
    ),
  );
}

function historySection(props: SettingsProps): HTMLElement {
  const played = DECKS.reduce(
    (total, deck) => total + (props.deckStatus[deck].total - props.deckStatus[deck].remaining),
    0,
  );

  const field = el('textarea', {
    class: 'code',
    readonly: true,
    rows: '3',
    'aria-label': 'Your memory code',
    on: { focus: (event) => (event.target as HTMLTextAreaElement).select() },
  });
  field.value = props.memoryCode;

  const status = el('p', { class: 'note' });

  const copy = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      on: {
        click: () => {
          navigator.clipboard
            ?.writeText(props.memoryCode)
            .then(() => {
              status.className = 'note';
              status.textContent = 'Copied.';
            })
            .catch(() => {
              // Clipboard access can be refused outright. Selecting the text is
              // something the user can still act on; a silent failure is not.
              field.select();
              status.className = 'note';
              status.textContent = 'Could not copy automatically — the code is selected, copy it.';
            });
        },
      },
    },
    'Copy',
  );

  const importField = el('textarea', {
    class: 'code',
    rows: '3',
    placeholder: 'Paste a memory code',
    'aria-label': 'Paste a memory code to restore',
  });

  const restore = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      on: {
        click: () => {
          void props.onImport(importField.value).then((error) => {
            if (error) {
              status.className = 'error';
              status.textContent = error;
            } else {
              importField.value = '';
              status.className = 'note';
            }
          });
        },
      },
    },
    'Restore from code',
  );

  return el(
    'section',
    { style: 'margin-top: var(--s6)' },
    el('p', { class: 'label', text: 'History' }),
    el('p', {
      class: 'row__note',
      text: 'Your history lives in this browser only. Another browser on this device keeps its own. If you clear your browsing data, it goes. Copy this code to move or restore it.',
    }),
    el('p', {
      class: 'note',
      style: 'margin-top: var(--s3)',
      text: historySummary(played, touchedDecks(props)),
    }),
    field,
    el('div', { class: 'btn-row', style: 'margin-top: var(--s2)' }, copy),
    el('p', { class: 'label', style: 'margin-top: var(--s5)', text: 'Restore' }),
    importField,
    el('div', { class: 'btn-row', style: 'margin-top: var(--s2)' }, restore),
    status,
  );
}

function touchedDecks(props: SettingsProps): number {
  return DECKS.filter((d) => props.deckStatus[d].total > props.deckStatus[d].remaining).length;
}

/** Exported for the unit test — "1 decks" is the kind of thing nobody re-reads. */
export function historySummary(words: number, decks: number): string {
  if (words === 0) return 'Nothing played yet on this browser.';
  const w = `${words.toLocaleString('en-GB')} ${words === 1 ? 'entry' : 'entries'}`;
  const d = `${decks} ${decks === 1 ? 'deck' : 'decks'}`;
  return `${w} played across ${d}.`;
}

function segmented<T>(
  label: string,
  options: Array<[string, T]>,
  active: T,
  onPick: (value: T) => void,
): HTMLElement {
  const group = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  const buttons = options.map(([text, value]) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(value === active),
        on: {
          click: () => {
            for (const button of buttons) button.setAttribute('aria-pressed', 'false');
            const self = buttons[options.findIndex(([, v]) => v === value)];
            self?.setAttribute('aria-pressed', 'true');
            onPick(value);
          },
        },
      },
      text,
    ),
  );
  for (const button of buttons) group.appendChild(button);

  return el('div', { class: 'row' }, el('div', {}, el('div', { class: 'row__label', text: label })), group);
}

function toggle(
  label: string,
  note: string | null,
  active: boolean,
  onChange: (on: boolean) => void,
): HTMLElement {
  const button = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      role: 'switch',
      'aria-checked': String(active),
      on: {
        click: () => {
          const next = button.getAttribute('aria-checked') !== 'true';
          button.setAttribute('aria-checked', String(next));
          button.textContent = next ? 'On' : 'Off';
          onChange(next);
        },
      },
    },
    active ? 'On' : 'Off',
  );

  return el(
    'div',
    { class: 'row' },
    el(
      'div',
      {},
      el('div', { class: 'row__label', text: label }),
      note ? el('p', { class: 'row__note', text: note }) : null,
    ),
    button,
  );
}
