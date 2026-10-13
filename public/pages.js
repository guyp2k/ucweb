import { ICONS, resolveIcon } from './icons.js';

const SVG = 'http://www.w3.org/2000/svg';
const SWIPE_DISTANCE = 0.18;
const SWIPE_SPEED = 0.45;
const EDGE_RESISTANCE = 0.32;
const WHEEL_THRESHOLD = 60;
const WHEEL_LOCK_MS = 480;
const WIDGET_CLASSES = { media_player: 'page-media', sensor: 'page-sensor', select: 'page-select' };
const MEDIA_STATES = { PLAYING: 'Playing', PAUSED: 'Paused', BUFFERING: 'Buffering', ON: 'On', OFF: 'Off', STANDBY: 'Standby', UNAVAILABLE: 'Unavailable', UNKNOWN: 'Unknown' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function icon(key, className = 'page-icon') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of ICONS[key]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const REPEAT_NEXT = { OFF: 'ALL', ALL: 'ONE', ONE: 'OFF' };

export function createPager(root, { onPress, onIndex, imageUrl, onOpenPlayer, onPlayer }) {
  const title = el('div', 'pages-title');
  const name = el('h4', 'pages-name');
  const count = el('span', 'pages-count');
  title.append(name, count);
  const prev = el('button', 'pages-step');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous page');
  prev.append(icon('angle-left', 'pages-step-icon'));
  const next = el('button', 'pages-step');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next page');
  next.append(icon('angle-right', 'pages-step-icon'));
  const bar = el('div', 'pages-bar');
  bar.append(prev, title, next);
  const viewport = el('div', 'pages-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-roledescription', 'carousel');
  viewport.setAttribute('aria-label', 'Activity pages');
  const track = el('div', 'pages-track');
  viewport.append(track);
  const dots = el('div', 'pages-dots');
  root.replaceChildren(bar, viewport, dots);

  const view = { key: null, pages: [], index: 0, remoteId: null, enabled: true, media: new Map(), items: new Map() };
  let ticker = null;

  const pageEls = () => [...track.children];

  function fitHeight() {
    const current = pageEls()[view.index];
    if (current) viewport.style.height = `${current.offsetHeight}px`;
  }

  const resize = new ResizeObserver(() => fitHeight());

  function place(offset = 0, animate = true) {
    track.classList.toggle('is-instant', !animate);
    track.style.transform = `translate3d(calc(${-100 * view.index}% + ${offset}px), 0, 0)`;
  }

  function renderChrome(direction) {
    const page = view.pages[view.index];
    const total = view.pages.length;
    name.textContent = page?.name ?? `Page ${view.index + 1}`;
    count.textContent = total > 1 ? `${view.index + 1} / ${total}` : '';
    if (direction && !reducedMotion()) {
      title.classList.remove('is-from-left', 'is-from-right');
      void title.offsetWidth;
      title.classList.add(direction > 0 ? 'is-from-right' : 'is-from-left');
    }
    prev.disabled = view.index === 0;
    next.disabled = view.index >= total - 1;
    bar.classList.toggle('is-single', total < 2);
    dots.hidden = total < 2;
    pageEls().forEach((pageEl, index) => {
      const current = index === view.index;
      pageEl.classList.toggle('is-current', current);
      pageEl.inert = !current;
      pageEl.setAttribute('aria-hidden', String(!current));
    });
    [...dots.children].forEach((dot, index) => {
      dot.classList.toggle('is-current', index === view.index);
      if (index === view.index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }

  function go(index, { animate = true } = {}) {
    const target = Math.max(0, Math.min(view.pages.length - 1, index));
    const direction = Math.sign(target - view.index);
    view.index = target;
    place(0, animate);
    renderChrome(animate ? direction : 0);
    fitHeight();
    onIndex?.(view.pages[target]?.id ?? null);
  }

  function step(delta) {
    if (view.pages.length < 2) return false;
    const target = view.index + delta;
    if (target < 0 || target >= view.pages.length) {
      place(delta * -18, true);
      setTimeout(() => place(0, true), 140);
      return true;
    }
    go(target);
    return true;
  }

  function mediaPosition(entry) {
    const { entity, at } = entry;
    if (entity.position === null) return null;
    if (entity.state !== 'PLAYING') return entity.position;
    const moved = entity.position + (performance.now() - at) / 1000;
    return entity.duration ? Math.min(moved, entity.duration) : moved;
  }

  function paintProgress(node, entry) {
    const progress = node.querySelector('.media-progress');
    if (!progress) return;
    const position = mediaPosition(entry);
    const duration = entry.entity.duration;
    const show = position !== null && duration !== null;
    progress.hidden = !show;
    if (!show) return;
    progress.querySelector('.media-fill').style.transform = `scaleX(${Math.min(1, position / duration)})`;
    progress.querySelector('.media-elapsed').textContent = clock(position);
    progress.querySelector('.media-remaining').textContent = `-${clock(duration - position)}`;
  }

  function tick() {
    let playing = false;
    for (const [id, entry] of view.media) {
      if (entry.entity.state !== 'PLAYING') continue;
      playing = true;
      for (const node of track.querySelectorAll(`.page-media[data-entity="${CSS.escape(id)}"]`)) paintProgress(node, entry);
    }
    if (!playing) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function startTicker() {
    if (ticker === null && [...view.media.values()].some((entry) => entry.entity.state === 'PLAYING')) ticker = setInterval(tick, 1000);
  }

  function mediaControl(entity, action, label, key, extra = '') {
    const button = el('button', `media-control${extra}`);
    button.type = 'button';
    button.dataset.action = action;
    button.disabled = !view.enabled;
    button.setAttribute('aria-label', `${label}, ${entity.name}`);
    button.title = label;
    button.append(icon(key, 'media-control-icon'));
    return button;
  }

  function mediaControls(entity) {
    const supports = (feature) => entity.features?.includes(feature);
    const playing = entity.state === 'PLAYING';
    const transport = el('div', 'media-transport');
    if (supports('previous')) transport.append(mediaControl(entity, 'previous', 'Previous', 'previous'));
    if (supports('play_pause')) transport.append(mediaControl(entity, 'play_pause', playing ? 'Pause' : 'Play', playing ? 'pause' : 'play', ' media-main'));
    if (supports('next')) transport.append(mediaControl(entity, 'next', 'Next', 'next'));
    const extras = el('div', 'media-extras');
    if (supports('shuffle')) {
      const shuffle = mediaControl(entity, 'shuffle', 'Shuffle', 'shuffle', ' media-mode');
      shuffle.classList.toggle('is-on', entity.shuffle === true);
      shuffle.setAttribute('aria-pressed', String(entity.shuffle === true));
      extras.append(shuffle);
    }
    if (supports('repeat')) {
      const repeat = mediaControl(entity, 'repeat', 'Repeat', 'repeat', ' media-mode');
      const on = entity.repeat === 'ALL' || entity.repeat === 'ONE';
      repeat.classList.toggle('is-on', on);
      repeat.setAttribute('aria-pressed', String(on));
      if (entity.repeat === 'ONE') repeat.append(el('span', 'media-repeat-one', '1'));
      extras.append(repeat);
    }
    if (supports('browse_media')) extras.append(mediaControl(entity, 'browse_media', 'Browse the library', 'library', ' media-mode'));
    if (supports('select_source') && entity.sources?.length > 0) {
      const source = mediaControl(entity, 'select_source', entity.source ? `Source: ${entity.source}` : 'Choose a source', 'devices', ' media-mode');
      extras.append(source);
    }
    const controls = el('div', 'media-controls');
    if (transport.childElementCount > 0) controls.append(transport);
    if (extras.childElementCount > 0) controls.append(extras);
    if (controls.childElementCount === 0) return null;
    controls.addEventListener('click', (event) => {
      event.stopPropagation();
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      const current = view.media.get(entity.id)?.entity ?? entity;
      button.classList.remove('is-sent');
      void button.offsetWidth;
      button.classList.add('is-sent');
      const { action } = button.dataset;
      if (action === 'shuffle') onPlayer?.(entity.id, action, current.shuffle !== true);
      else if (action === 'repeat') onPlayer?.(entity.id, action, REPEAT_NEXT[current.repeat ?? 'OFF']);
      else onPlayer?.(entity.id, action);
    });
    return controls;
  }

  function fillMedia(node, entity) {
    node.classList.toggle('is-openable', Boolean(entity));
    const art = el(entity ? 'button' : 'div', 'media-art');
    if (entity) {
      art.type = 'button';
      art.setAttribute('aria-label', `Open the player for ${entity.name}`);
      art.title = 'Open the player';
    }
    const backdrop = el('div', 'media-backdrop');
    node.classList.toggle('is-unavailable', !entity || entity.state === 'UNAVAILABLE');
    if (!entity) {
      art.append(icon('music', 'media-art-icon'));
      const meta = el('div', 'media-meta');
      meta.append(el('span', 'media-title', 'Player not available'), el('span', 'media-sub', 'The remote no longer has this player.'));
      const body = el('div', 'media-body');
      body.append(art, meta);
      node.replaceChildren(backdrop, body);
      return;
    }
    const hasArt = entity.image && entity.state !== 'OFF' && entity.state !== 'UNAVAILABLE';
    if (hasArt) {
      const src = imageUrl(view.remoteId, entity.id, entity.image);
      const image = el('img', 'media-art-image');
      image.alt = '';
      image.decoding = 'async';
      image.src = src;
      image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
      image.addEventListener('error', () => {
        image.remove();
        backdrop.replaceChildren();
        art.append(icon('music', 'media-art-icon'));
      }, { once: true });
      art.append(image);
      const blurred = el('img', 'media-backdrop-image');
      blurred.alt = '';
      blurred.src = src;
      backdrop.append(blurred);
    } else {
      art.append(icon('music', 'media-art-icon'));
    }
    const playing = Boolean(entity.title);
    const meta = el('div', 'media-meta');
    meta.append(
      el('span', 'media-title', playing ? entity.title : entity.name),
      el('span', 'media-sub', playing ? [entity.artist, entity.album].filter(Boolean).join(' · ') || entity.name : MEDIA_STATES[entity.state] ?? entity.state ?? ''),
    );
    const stateName = entity.state ?? 'UNKNOWN';
    const badge = el('span', 'media-state', MEDIA_STATES[stateName] ?? stateName);
    badge.dataset.state = stateName;
    const progress = el('div', 'media-progress');
    const barEl = el('div', 'media-bar');
    barEl.append(el('span', 'media-fill'));
    const times = el('div', 'media-times');
    times.append(el('span', 'media-elapsed'), el('span', 'media-remaining'));
    progress.append(barEl, times);
    const body = el('div', 'media-body');
    body.append(art, meta, progress);
    const controls = mediaControls(entity);
    if (controls) body.append(controls);
    node.classList.toggle('has-controls', Boolean(controls));
    node.replaceChildren(backdrop, body);
    if (playing) node.append(badge);
    node.classList.toggle('has-art', Boolean(hasArt));
    node.dataset.state = stateName;
    paintProgress(node, view.media.get(entity.id));
  }

  function widgetLabel(item, entity) {
    if (item.showLabel) return entity?.name ?? null;
    return item.text;
  }

  function fillSensor(node, item, entity) {
    const unavailable = !entity || entity.state === 'UNAVAILABLE';
    node.classList.toggle('is-unavailable', unavailable);
    const value = el('span', 'sensor-value');
    const number = el('span', 'sensor-number', entity?.value ?? 'n/a');
    if (!/^[-+]?\d+([.,]\d+)?$/.test(String(entity?.value ?? '').trim())) number.classList.add('is-text-value');
    value.append(number);
    if (item.showUnit && entity?.unit) value.append(el('span', 'sensor-unit', entity.unit));
    const children = [value];
    const label = unavailable ? 'Unavailable' : widgetLabel(item, entity);
    if (label) children.push(el('span', 'sensor-label', label));
    node.replaceChildren(...children);
    node.title = entity ? `${entity.name}${unavailable ? ' is unavailable' : ''}` : 'This sensor is no longer on the remote.';
  }

  function fillSelect(node, item, entity) {
    const unavailable = !entity || entity.state === 'UNAVAILABLE';
    node.classList.toggle('is-unavailable', unavailable);
    const children = [];
    const label = widgetLabel(item, entity);
    if (label) children.push(el('span', 'sensor-label', label));
    children.push(el('span', 'select-value', unavailable ? 'Unavailable' : entity.option ?? 'n/a'));
    node.replaceChildren(...children);
  }

  function fillWidget(node, item) {
    const entity = view.media.get(item.entityId)?.entity ?? view.items.get(item.entityId) ?? null;
    if (item.type === 'media_player') fillMedia(node, entity);
    else if (item.type === 'sensor') fillSensor(node, item, entity);
    else fillSelect(node, item, entity);
  }

  function buildItem(page, item, order) {
    const { width: cols, height: rows } = page.grid;
    if (item.x >= cols || item.y >= rows) return null;
    const width = Math.min(item.width, cols - item.x);
    const height = Math.min(item.height, rows - item.y);
    let node;
    if (item.type === 'text' || item.type === 'icon') {
      node = el(item.action ? 'button' : 'div', `page-item ${item.action ? 'page-key' : 'page-static'}`);
      if (item.action) {
        node.type = 'button';
        node.disabled = !view.enabled;
        node.addEventListener('click', () => {
          if (node.disabled) return;
          node.classList.remove('is-sent');
          void node.offsetWidth;
          node.classList.add('is-sent');
          onPress(page.id, item.index);
        });
      }
      if (item.type === 'text') {
        node.classList.add('is-text');
        node.append(el('span', 'page-key-text', item.text));
      } else {
        const shown = resolveIcon(item);
        if (shown.key) {
          node.classList.add('is-icon');
          node.append(icon(shown.key));
          if (shown.caption) node.append(el('span', 'page-caption', shown.caption));
        } else if (shown.glyph) {
          node.classList.add('is-glyph');
          node.append(el('span', 'page-glyph', shown.glyph));
        } else {
          node.classList.add(shown.app ? 'is-app' : 'is-text');
          node.append(el('span', shown.app ? 'page-app-name' : 'page-key-text', shown.caption));
        }
        const label = shown.caption ?? shown.glyph ?? (shown.key ? shown.key.replace(/-/g, ' ') : null);
        if (label) node.setAttribute('aria-label', label);
        if (label && item.action) node.title = label;
      }
      if (width === 1 && height === 1) node.classList.add('is-compact');
    } else {
      node = el('div', `page-item ${WIDGET_CLASSES[item.type]}`);
      node.dataset.entity = item.entityId;
      if (item.type === 'media_player') {
        node.addEventListener('click', (event) => {
          if (event.target.closest('.media-controls')) return;
          if (view.media.has(item.entityId)) onOpenPlayer?.(item.entityId);
        });
      }
      fillWidget(node, item);
    }
    node.style.gridColumn = `${item.x + 1} / span ${width}`;
    node.style.gridRow = `${item.y + 1} / span ${height}`;
    node.style.setProperty('--order', String(Math.min(order, 24)));
    if (height >= 3 || (height >= 2 && width <= 2)) node.classList.add('is-tall');
    if (width >= 3) node.classList.add('is-wide');
    return node;
  }

  function buildPage(page, index, total, widest) {
    const section = el('section', 'pages-slide');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-roledescription', 'page');
    section.setAttribute('aria-label', `${page.name ?? `Page ${index + 1}`}, ${index + 1} of ${total}`);
    const grid = el('div', 'page-grid');
    grid.style.setProperty('--cols', String(page.grid.width));
    grid.style.setProperty('--rows', String(page.grid.height));
    grid.style.setProperty('--span', String(page.grid.width / widest));
    page.items.forEach((item, order) => {
      const node = buildItem(page, item, order);
      if (node) grid.append(node);
    });
    section.append(grid);
    return section;
  }

  function show({ key, pages, entities, pageId, remoteId }) {
    const fresh = key !== view.key;
    view.key = key;
    view.remoteId = remoteId;
    view.pages = pages;
    view.media.clear();
    view.items.clear();
    const now = performance.now();
    for (const entity of Object.values(entities)) {
      if (entity.type === 'media_player') view.media.set(entity.id, { entity, at: now });
      else view.items.set(entity.id, entity);
    }
    const remembered = pages.findIndex((page) => page.id === pageId);
    const current = fresh ? Math.max(0, remembered) : Math.min(view.index, Math.max(0, pages.length - 1));
    const widest = Math.max(...pages.map((page) => page.grid.width));
    resize.disconnect();
    track.replaceChildren(...pages.map((page, index) => buildPage(page, index, pages.length, widest)));
    for (const pageEl of pageEls()) resize.observe(pageEl);
    dots.replaceChildren(...pages.map((page, index) => {
      const dot = el('button', 'pages-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show ${page.name ?? `page ${index + 1}`}`);
      dot.addEventListener('click', () => go(index));
      return dot;
    }));
    root.hidden = pages.length === 0;
    root.classList.toggle('is-entering', fresh && !reducedMotion());
    view.index = current;
    place(0, false);
    renderChrome(0);
    requestAnimationFrame(fitHeight);
    clearInterval(ticker);
    ticker = null;
    startTicker();
    if (fresh) setTimeout(() => root.classList.remove('is-entering'), 900);
  }

  function updateEntity(entity) {
    if (entity.type === 'media_player') {
      if (entity.missing) view.media.delete(entity.id);
      else view.media.set(entity.id, { entity, at: performance.now() });
    } else if (entity.missing) {
      view.items.delete(entity.id);
    } else {
      view.items.set(entity.id, entity);
    }
    for (const page of view.pages) {
      for (const item of page.items) {
        if (item.entityId !== entity.id) continue;
        const pageIndex = view.pages.indexOf(page);
        const node = pageEls()[pageIndex]?.querySelector(`[data-entity="${CSS.escape(entity.id)}"]`);
        if (node) fillWidget(node, item);
      }
    }
    startTicker();
  }

  function setEnabled(enabled) {
    view.enabled = enabled;
    for (const key of track.querySelectorAll('.page-key, .media-control')) key.disabled = !enabled;
  }

  function clear() {
    view.key = null;
    view.pages = [];
    view.media.clear();
    view.items.clear();
    clearInterval(ticker);
    ticker = null;
    resize.disconnect();
    track.replaceChildren();
    dots.replaceChildren();
    root.hidden = true;
  }

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  viewport.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target !== viewport) return;
    event.preventDefault();
    event.stopPropagation();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  });

  let wheel = 0;
  let wheelLocked = false;
  viewport.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || view.pages.length < 2) return;
    event.preventDefault();
    if (wheelLocked) return;
    wheel += event.deltaX;
    if (Math.abs(wheel) < WHEEL_THRESHOLD) return;
    step(wheel > 0 ? 1 : -1);
    wheel = 0;
    wheelLocked = true;
    setTimeout(() => {
      wheelLocked = false;
    }, WHEEL_LOCK_MS);
  }, { passive: false });

  let drag = null;
  let swallowClick = false;
  viewport.addEventListener('pointerdown', (event) => {
    if (view.pages.length < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now(), dx: 0, active: false };
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
        if (Math.abs(dy) > 12) drag = null;
        return;
      }
      drag.active = true;
      drag.x = event.clientX;
      drag.t = performance.now();
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
      return;
    }
    const atEdge = (dx > 0 && view.index === 0) || (dx < 0 && view.index === view.pages.length - 1);
    drag.dx = atEdge ? dx * EDGE_RESISTANCE : dx;
    place(drag.dx, false);
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { active, dx, t } = drag;
    drag = null;
    viewport.classList.remove('is-dragging');
    if (!active) return;
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t);
    const far = Math.abs(dx) > viewport.clientWidth * SWIPE_DISTANCE;
    const target = (far || speed > SWIPE_SPEED) && dx !== 0 ? view.index - Math.sign(dx) : view.index;
    if (target !== view.index && target >= 0 && target < view.pages.length) go(target);
    else place(0, true);
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('click', (event) => {
    if (!swallowClick) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  return {
    show,
    updateEntity,
    setEnabled,
    clear,
    step,
    media: (entityId) => view.media.get(entityId) ?? null,
    get key() { return view.key; },
    get hasPages() { return view.pages.length > 0; },
  };
}
