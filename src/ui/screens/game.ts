/**
 * The word screen. DESIGN_SPEC §3.4.
 *
 * The word is drawn and painted in one step — there is no cover interstitial in
 * front of it any more. Whoever taps "Next drawer" is the person holding the
 * phone, so the handover happens on the resolved screen instead.
 *
 * On God Mode the word carries a one-line meaning, printed under it and always
 * visible. God Mode terms are named things from a specialist domain; a room that
 * cannot define "apoptosis" is not having a hard round, it is having a dead one.
 * The meaning is for the drawer, who has to draw the idea, not the word.
 */
import type { RuntimeWord, Tier } from '../../engine/types';
import { DEPLETION_WARNING, TIER_LABELS } from '../../engine/types';
import type { Outcome } from '../../state/session';
import { el } from '../dom';

export interface ScreenHandle {
  node: HTMLElement;
  destroy?: () => void;
  onKey?: (event: KeyboardEvent) => void;
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

const CIRCUMFERENCE = 2 * Math.PI * 45;
const CRIT_AT = 10;

export interface PlayProps {
  word: RuntimeWord;
  tier: Tier;
  remaining: number;
  depletion: number;
  timerSeconds: number | null;
  twist: string | null;
  onResolve: (outcome: Outcome) => void;
  onQuit: () => void;
}

export function playScreen(props: PlayProps): ScreenHandle {
  const { word } = props;

  // One live region for everything spoken during a round: the word once, then
  // the timer at 30s, 10s and 0s. DESIGN_SPEC §5.
  const live = el('div', {
    class: 'visually-hidden',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  const timer = buildTimer(props, live);

  const header = el(
    'header',
    { class: 'play__head' },
    el(
      'div',
      {},
      el('div', { class: 'play__tier', text: TIER_LABELS[props.tier].name }),
      props.depletion >= DEPLETION_WARNING
        ? el('div', {
            class: 'tier-card__left tier-card__left--warn',
            text: `${props.remaining} words left`,
          })
        : null,
    ),
    timer.node,
  );

  const stage = el(
    'div',
    { class: 'play__stage' },
    props.twist ? el('span', { class: 'twist', text: props.twist }) : null,
    pips(word.words),
    el('h1', {
      class: `word${word.text.length > 18 ? ' word--long' : ''}`,
      text: word.text,
    }),
    // God Mode only, and always on: no button, no points penalty. Set as the
    // element's text rather than interpolated as markup — corpus copy contains
    // apostrophes and quotation marks.
    word.meaning ? el('p', { class: 'meaning', text: word.meaning }) : null,
    el('p', {
      class: 'play__points',
      text: `${word.points} ${word.points === 1 ? 'point' : 'points'}`,
    }),
  );

  const outcome = (label: string, kind: Outcome, primary = false): HTMLElement =>
    el(
      'button',
      {
        class: `btn${primary ? ' btn--primary' : ''}`,
        type: 'button',
        on: {
          click: () => {
            timer.stop();
            props.onResolve(kind);
          },
        },
      },
      label,
    );

  const controls = el(
    'div',
    { class: 'outcomes' },
    outcome('Got it', 'got', true),
    el('div', { class: 'outcomes__split' }, outcome('Pass', 'pass'), outcome('Time up', 'timeout')),
  );

  const node = el(
    'div',
    { class: 'play', style: `--tier-ink: var(--t-${props.tier})` },
    live,
    header,
    stage,
    controls,
    el(
      'div',
      { class: 'keys' },
      el('span', {}, el('kbd', { text: 'G' }), ' got it'),
      el('span', {}, el('kbd', { text: 'P' }), ' pass'),
      el('span', {}, el('kbd', { text: 'T' }), ' time up'),
      el('span', {}, el('kbd', { text: 'Esc' }), ' leave'),
    ),
  );

  // Announced after the node exists so the region change is what triggers it.
  live.textContent = word.text;
  timer.start();

  return {
    node,
    destroy: () => timer.stop(),
    onKey: (event) => {
      const key = event.key.toLowerCase();
      if (key === 'g' || key === 'p' || key === 't') {
        event.preventDefault();
        timer.stop();
        props.onResolve(key === 'g' ? 'got' : key === 'p' ? 'pass' : 'timeout');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        timer.stop();
        props.onQuit();
      }
    },
  };
}

function pips(count: number): HTMLElement {
  // Pips for 1-4. Five dots and up is unreadable at a glance, so it becomes a
  // number. DESIGN_SPEC §3.4.
  if (count >= 5) {
    return el('div', { class: 'pips' }, el('span', { class: 'pips__count', text: `${count} words` }));
  }
  const dots = Array.from({ length: Math.max(1, count) }, () =>
    el('span', { class: 'pips__dot' }),
  );
  return el(
    'div',
    { class: 'pips', role: 'img', 'aria-label': `${count} ${count === 1 ? 'word' : 'words'}` },
    ...dots,
  );
}

interface TimerHandle {
  node: HTMLElement;
  start: () => void;
  stop: () => void;
}

function buildTimer(props: PlayProps, live: HTMLElement): TimerHandle {
  const total = props.timerSeconds;

  // Timer off hides the ring entirely rather than showing an empty one.
  if (total === null) {
    return { node: el('div', {}), start: () => {}, stop: () => {} };
  }

  const NS = 'http://www.w3.org/2000/svg';
  const ring = document.createElementNS(NS, 'svg');
  ring.setAttribute('class', 'timer__ring');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.setAttribute('aria-hidden', 'true');

  const circle = (className: string): SVGCircleElement => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', className);
    c.setAttribute('cx', '50');
    c.setAttribute('cy', '50');
    c.setAttribute('r', '45');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', '6');
    c.setAttribute('stroke-linecap', 'round');
    return c;
  };

  const value = circle('timer__value');
  value.setAttribute('stroke-dasharray', String(CIRCUMFERENCE));
  value.setAttribute('stroke-dashoffset', '0');
  ring.appendChild(circle('timer__track'));
  ring.appendChild(value);

  const digits = el('span', { class: 'timer__digits', text: format(total) });
  const node = el('div', { class: 'timer' }, ring, digits);

  let handle: number | null = null;
  let endsAt = 0;
  let pulsed = false;
  let announced = new Set<number>();
  let wakeLock: { release: () => Promise<void> } | null = null;

  const paint = (left: number): void => {
    digits.textContent = format(left);
    value.setAttribute(
      'stroke-dashoffset',
      String(CIRCUMFERENCE * (1 - Math.max(0, left) / total)),
    );

    if (left <= CRIT_AT) {
      node.classList.add('timer--crit');
      // One pulse at 10s, not a loop. Suppressed under reduced motion, and the
      // timer stays legible without it. DESIGN_SPEC §4.
      if (!pulsed) {
        pulsed = true;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          node.classList.add('timer--pulse');
          setTimeout(() => node.classList.remove('timer--pulse'), 220);
        }
      }
    }

    for (const mark of [30, 10, 0]) {
      if (left <= mark && !announced.has(mark) && (mark !== 30 || total > 30)) {
        announced.add(mark);
        live.textContent = mark === 0 ? 'Time up' : `${mark} seconds left`;
      }
    }
  };

  const tick = (): void => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    paint(left);
    if (left <= 0) {
      stop();
      props.onResolve('timeout');
    }
  };

  const stop = (): void => {
    if (handle !== null) {
      clearInterval(handle);
      handle = null;
    }
    void wakeLock?.release().catch(() => {});
    wakeLock = null;
  };

  const start = (): void => {
    endsAt = Date.now() + total * 1000;
    announced = new Set();
    pulsed = false;
    // Driven off wall-clock rather than a tick count, so a backgrounded tab
    // resumes at the right number instead of finishing late.
    handle = window.setInterval(tick, 250);

    // A screen that sleeps mid-round is a bug report. Best-effort, silent where
    // unsupported. DESIGN_SPEC §1.
    const lock = (navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    }).wakeLock;
    lock
      ?.request('screen')
      .then((sentinel) => {
        if (handle === null) void sentinel.release().catch(() => {});
        else wakeLock = sentinel;
      })
      .catch(() => {});
  };

  return { node, start, stop };
}

function format(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
