import { ICONS, UC_NAMES } from './icons.js';

const SVG = 'http://www.w3.org/2000/svg';
const CLOSE_MS = 220;
const CLASS_ICONS = {
  album: 'disc', artist: 'mic', composer: 'music', playlist: 'library', radio: 'radio', genre: 'tag', track: 'music', music: 'music',
  directory: 'folder', podcast: 'mic', app: 'apps', channel: 'tv', movie: 'display', video: 'display', tv_show: 'tv', season: 'tv',
  episode: 'tv', image: 'display', url: 'cast', game: 'apps',
};
const ACTION_LABELS = { PLAY_NOW: 'Play now', PLAY_NEXT: 'Play next', ADD_TO_QUEUE: 'Add to queue' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function icon(key, className) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const d of ICONS[key] ?? ICONS.music) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function iconFor(item) {
  const name = item.icon?.startsWith('uc:') ? item.icon.slice(3).toLowerCase() : null;
  return (name && UC_NAMES[name]) ?? CLASS_ICONS[item.mediaClass] ?? (item.canBrowse ? 'folder' : 'music');
}

function clock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function createBrowser(dialog, { fetchPage, onPlay, thumbUrl, chooseAction }) {
  const back = el('button', 'browser-back');
  back.type = 'button';
  back.setAttribute('aria-label', 'Back');
  back.append(icon('angle-left'));
  const close = el('button', 'browser-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close the library');
  close.append(icon('close'));
  const heading = el('div', 'browser-heading');
  const title = el('h3', 'browser-title');
  const crumb = el('span', 'browser-crumb');
  heading.append(crumb, title);
  const bar = el('div', 'browser-bar');
  bar.append(back, heading, close);
  const body = el('div', 'browser-body');
  const sheet = el('div', 'browser-sheet');
  sheet.append(el('span', 'browser-grabber'), bar, body);
  dialog.replaceChildren(sheet);

  const view = { remoteId: null, entity: null, stack: [], token: 0, closing: null, observer: null };

  function finishClose() {
    clearTimeout(view.closing);
    view.closing = null;
    view.observer?.disconnect();
    dialog.classList.remove('is-closing');
    if (dialog.open) dialog.close();
  }

  function hide() {
    if (!dialog.open || view.closing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return;
    }
    dialog.classList.add('is-closing');
    view.closing = setTimeout(finishClose, CLOSE_MS);
  }

  function thumbnail(item) {
    const holder = el('span', 'browser-thumb');
    if (item.thumb) {
      const image = el('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = thumbUrl(view.remoteId, view.entity.id, item.thumb);
      image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
      image.addEventListener('error', () => image.replaceWith(icon(iconFor(item))), { once: true });
      holder.append(image);
    } else {
      holder.classList.add('is-icon');
      holder.append(icon(iconFor(item)));
    }
    return holder;
  }

  async function play(item, how) {
    const done = await onPlay(view.remoteId, view.entity.id, item, how);
    if (done && (how === undefined || how === 'PLAY_NOW')) hide();
  }

  async function moreActions(item) {
    const options = view.entity.playActions.filter((how) => ACTION_LABELS[how]).map((how) => ACTION_LABELS[how]);
    const chosen = await chooseAction({ heading: item.title, detail: view.entity.name, options });
    const how = Object.keys(ACTION_LABELS).find((key) => ACTION_LABELS[key] === chosen);
    if (how) play(item, how);
  }

  function row(item) {
    const node = el('div', 'browser-row');
    const main = el('button', 'browser-main');
    main.type = 'button';
    const text = el('span', 'browser-text');
    text.append(el('span', 'browser-item-title', item.title));
    const sub = [item.subtitle, item.duration ? clock(item.duration) : null].filter(Boolean).join(' · ');
    if (sub) text.append(el('span', 'browser-item-sub', sub));
    main.append(thumbnail(item), text);
    if (item.canBrowse) main.append(icon('angle-right', 'browser-chevron'));
    main.setAttribute('aria-label', item.canBrowse ? `Open ${item.title}` : `Play ${item.title}`);
    main.disabled = !item.canBrowse && !item.canPlay;
    main.addEventListener('click', () => {
      if (item.canBrowse) push(item);
      else if (item.canPlay) play(item);
    });
    node.append(main);
    if (item.canPlay && item.canBrowse) {
      const playButton = el('button', 'browser-play');
      playButton.type = 'button';
      playButton.setAttribute('aria-label', `Play ${item.title}`);
      playButton.title = 'Play';
      playButton.append(icon('play'));
      playButton.addEventListener('click', () => play(item));
      node.append(playButton);
    }
    if (item.canPlay && view.entity.playActions.length > 1) {
      const more = el('button', 'browser-more');
      more.type = 'button';
      more.setAttribute('aria-label', `More ways to play ${item.title}`);
      more.title = 'More';
      more.append(icon('more'));
      more.addEventListener('click', () => moreActions(item));
      node.append(more);
    }
    return node;
  }

  function skeleton() {
    const list = el('div', 'browser-list is-loading');
    for (let index = 0; index < 6; index += 1) {
      const node = el('div', 'browser-row browser-skeleton');
      node.append(el('span', 'browser-thumb'), el('span', 'browser-skeleton-line'));
      list.append(node);
    }
    return list;
  }

  function problem(message, retry) {
    const box = el('div', 'browser-problem');
    box.append(el('p', null, message));
    const again = el('button', 'browser-retry', 'Try again');
    again.type = 'button';
    again.addEventListener('click', retry);
    box.append(again);
    return box;
  }

  function paintBar() {
    const level = view.stack.at(-1);
    title.textContent = level?.data?.title ?? level?.item?.title ?? view.entity?.name ?? '';
    crumb.textContent = view.stack.length > 1 ? (view.stack.at(-2).data?.title ?? view.entity.name) : view.entity?.name ?? '';
    back.hidden = view.stack.length < 2;
  }

  function watchMore(list, level, token) {
    view.observer?.disconnect();
    if (!level.data.more) return;
    const sentinel = el('div', 'browser-sentinel');
    list.append(sentinel);
    view.observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || level.loading) return;
      level.loading = true;
      sentinel.classList.add('is-loading');
      try {
        const next = await fetchPage(view.remoteId, view.entity.id, { mediaId: level.mediaId, mediaType: level.mediaType, page: level.data.page + 1 });
        if (token !== view.token) return;
        level.data = { ...next, items: [...level.data.items, ...next.items] };
        sentinel.remove();
        list.append(...next.items.map(row));
        watchMore(list, level, token);
      } catch {
        sentinel.classList.remove('is-loading');
      } finally {
        level.loading = false;
      }
    }, { root: body, rootMargin: '200px' });
    view.observer.observe(sentinel);
  }

  async function load(direction) {
    const token = ++view.token;
    const level = view.stack.at(-1);
    paintBar();
    body.dataset.direction = direction;
    body.replaceChildren(skeleton());
    try {
      level.data = await fetchPage(view.remoteId, view.entity.id, { mediaId: level.mediaId, mediaType: level.mediaType, page: 1 });
    } catch (error) {
      if (token !== view.token) return;
      body.replaceChildren(problem(error.message, () => load(direction)));
      return;
    }
    if (token !== view.token) return;
    paintBar();
    const list = el('div', 'browser-list');
    if (level.data.items.length === 0) {
      const message = level.data.total > 0
        ? `${view.entity.name} reports ${level.data.total} items here but did not send any.`
        : 'Nothing here.';
      list.append(el('p', 'browser-empty', message));
    }
    list.append(...level.data.items.map(row));
    body.replaceChildren(list);
    body.scrollTop = level.scroll ?? 0;
    watchMore(list, level, token);
  }

  function push(item) {
    const current = view.stack.at(-1);
    if (current) current.scroll = body.scrollTop;
    view.stack.push({ item, mediaId: item.mediaId, mediaType: item.mediaType, data: null });
    load('forward');
  }

  function pop() {
    if (view.stack.length < 2) return;
    view.stack.pop();
    const level = view.stack.at(-1);
    if (!level.data) {
      load('back');
      return;
    }
    const token = ++view.token;
    paintBar();
    body.dataset.direction = 'back';
    const list = el('div', 'browser-list');
    list.append(...level.data.items.map(row));
    body.replaceChildren(list);
    body.scrollTop = level.scroll ?? 0;
    watchMore(list, level, token);
  }

  back.addEventListener('click', pop);
  close.addEventListener('click', hide);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (view.stack.length > 1) pop();
    else hide();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) hide();
  });
  dialog.addEventListener('close', () => {
    view.token += 1;
    view.observer?.disconnect();
  });

  return {
    open(remoteId, entity) {
      finishClose();
      view.remoteId = remoteId;
      view.entity = entity;
      view.stack = [{ item: null, mediaId: undefined, mediaType: undefined, data: null }];
      dialog.showModal();
      close.focus({ focusVisible: false });
      load('forward');
    },
    update(entity) {
      if (dialog.open && view.entity?.id === entity.id) {
        if (entity.missing) hide();
        else view.entity = entity;
      }
    },
    close: hide,
  };
}
