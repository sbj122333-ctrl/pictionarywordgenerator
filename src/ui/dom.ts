/**
 * A very small DOM helper. No framework — the app is six screens and the
 * complexity is in the engine, not the view.
 *
 * Everything here sets text through `textContent`. Nothing in this app ever
 * assigns `innerHTML` with a word in it: the corpus is trusted, but the habit is
 * not worth having in a file that also renders the reveal.
 */

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  /** Event listeners, keyed by type. */
  on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
  /** Anything else is set as an attribute; false and null remove it. */
  [attr: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'on') {
      for (const [type, handler] of Object.entries(value as Record<string, EventListener>)) {
        node.addEventListener(type, handler);
      }
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 24x24, currentColor, stroke 1.5 — DESIGN_SPEC §6. No icon library. */
export function icon(path: string, label?: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    const title = document.createElementNS(NS, 'title');
    title.textContent = label;
    svg.appendChild(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const node = document.createElementNS(NS, 'path');
  node.setAttribute('d', path);
  svg.appendChild(node);
  return svg;
}

export const ICONS = {
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.4-2.6.03-.9-.03-.9 1.8-1.4-1.9-3.3-2.2.7a7.8 7.8 0 0 0-1.55-.9L16.2 4h-3.8l-.35 2.2c-.55.23-1.07.53-1.55.9l-2.2-.7-1.9 3.3 1.8 1.4a7.6 7.6 0 0 0 0 1.8l-1.8 1.4 1.9 3.3 2.2-.7c.48.37 1 .67 1.55.9l.35 2.2h3.8l.35-2.2c.55-.23 1.07-.53 1.55-.9l2.2.7 1.9-3.3-1.8-1.4Z',
  chevron: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
  copy: 'M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15M5.5 9h8A1.5 1.5 0 0 1 15 10.5v8A1.5 1.5 0 0 1 13.5 20h-8A1.5 1.5 0 0 1 4 18.5v-8A1.5 1.5 0 0 1 5.5 9Z',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11v3.5l2.5 1.5M9 3h6',
} as const;
