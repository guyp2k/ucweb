import { ICONS } from './icons.js';

const SVG = 'http://www.w3.org/2000/svg';
const CLOSE_MS = 200;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function icon(key) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[key]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function createChooser(dialog) {
  const title = el('h3', 'chooser-title');
  const subtitle = el('p', 'chooser-subtitle');
  const list = el('div', 'chooser-list');
  list.setAttribute('role', 'listbox');
  const cancel = el('button', 'chooser-cancel', 'Cancel');
  cancel.type = 'button';
  const sheet = el('div', 'chooser-sheet');
  sheet.append(el('span', 'chooser-grabber'), title, subtitle, list, cancel);
  dialog.replaceChildren(sheet);
  let settle = null;
  let closing = null;

  function finish(value) {
    const resolve = settle;
    settle = null;
    clearTimeout(closing);
    closing = null;
    dialog.classList.remove('is-closing');
    if (dialog.open) dialog.close();
    resolve?.(value);
  }

  function dismiss(value) {
    if (!dialog.open || closing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish(value);
      return;
    }
    dialog.classList.add('is-closing');
    closing = setTimeout(() => finish(value), CLOSE_MS);
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss(null);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss(null);
  });
  cancel.addEventListener('click', () => dismiss(null));
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...list.children];
    const at = options.indexOf(document.activeElement);
    options[(at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  });

  return {
    choose({ heading, detail, options, current }) {
      if (settle) finish(null);
      title.textContent = heading;
      subtitle.textContent = detail ?? '';
      subtitle.hidden = !detail;
      list.replaceChildren(...options.map((option) => {
        const selected = option === current;
        const button = el('button', `chooser-option${selected ? ' is-current' : ''}`);
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(selected));
        button.append(el('span', 'chooser-option-text', option));
        if (selected) button.append(icon('check'));
        button.addEventListener('click', () => dismiss(option));
        return button;
      }));
      dialog.showModal();
      (list.querySelector('.is-current') ?? list.firstElementChild ?? cancel).focus({ focusVisible: false });
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
    close: () => dismiss(null),
  };
}
