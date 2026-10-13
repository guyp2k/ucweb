import { ICONS } from './icons.js';

const SVG = 'http://www.w3.org/2000/svg';
const CLOSE_MS = 220;
const REPEAT_NEXT = { OFF: 'ALL', ALL: 'ONE', ONE: 'OFF' };
const STATES = { PLAYING: 'Playing', PAUSED: 'Paused', BUFFERING: 'Buffering', ON: 'On', OFF: 'Off', STANDBY: 'Standby', UNAVAILABLE: 'Unavailable', UNKNOWN: 'Unknown' };

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

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function control(action, label, key, className = 'player-control') {
  const button = el('button', className);
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(key));
  return button;
}

export function createPlayer(dialog, { onCommand, imageUrl }) {
  const backdrop = el('div', 'player-backdrop');
  const close = control('close', 'Close player', 'close', 'player-close');
  const grabber = el('span', 'player-grabber');
  const art = el('div', 'player-art');
  const source = el('span', 'player-source');
  const title = el('h3', 'player-title');
  const artist = el('span', 'player-artist');
  const album = el('span', 'player-album');
  const meta = el('div', 'player-meta');
  meta.append(source, title, artist, album);

  const seek = el('input', 'player-seek-input');
  seek.type = 'range';
  seek.min = '0';
  seek.step = '1';
  seek.setAttribute('aria-label', 'Position');
  const bar = el('div', 'player-bar');
  const fill = el('span', 'player-bar-fill');
  bar.append(fill);
  const elapsed = el('span', 'player-elapsed');
  const remaining = el('span', 'player-remaining');
  const times = el('div', 'player-times');
  times.append(elapsed, remaining);
  const progress = el('div', 'player-progress');
  progress.append(seek, bar, times);

  const shuffle = control('shuffle', 'Shuffle', 'shuffle', 'player-control player-mode');
  const previous = control('previous', 'Previous', 'previous');
  const playPause = control('play_pause', 'Play or pause', 'play', 'player-control player-main');
  const next = control('next', 'Next', 'next');
  const stop = control('stop', 'Stop', 'stop');
  const repeat = control('repeat', 'Repeat', 'repeat', 'player-control player-mode');
  const repeatOne = el('span', 'player-repeat-one', '1');
  repeat.append(repeatOne);
  const transport = el('div', 'player-transport');
  transport.append(shuffle, previous, playPause, next, stop, repeat);

  const mute = control('mute_toggle', 'Mute', 'mute', 'player-control player-small');
  const down = control('volume_down', 'Volume down', 'volume-down', 'player-control player-small');
  const up = control('volume_up', 'Volume up', 'volume-up', 'player-control player-small');
  const level = el('input', 'player-volume-input');
  level.type = 'range';
  level.min = '0';
  level.max = '100';
  level.step = '1';
  level.setAttribute('aria-label', 'Volume');
  const levelText = el('span', 'player-volume-text');
  const volume = el('div', 'player-volume');
  volume.append(mute, down, level, up, levelText);

  const state = el('span', 'player-state');
  const sheet = el('div', 'player-sheet');
  sheet.append(backdrop, grabber, close, art, state, meta, progress, transport, volume);
  dialog.replaceChildren(sheet);

  const current = { remoteId: null, entity: null, at: 0, imageKey: null, seeking: false, ticker: null, closing: null };

  const supports = (feature) => current.entity?.features?.includes(feature) ?? false;

  function position() {
    const { entity, at } = current;
    if (!entity || entity.position === null) return null;
    if (entity.state !== 'PLAYING') return entity.position;
    const moved = entity.position + (performance.now() - at) / 1000;
    return entity.duration ? Math.min(moved, entity.duration) : moved;
  }

  function paintProgress() {
    const { entity } = current;
    const at = position();
    const show = Boolean(entity?.duration) && at !== null;
    progress.hidden = !show;
    if (!show) return;
    const canSeek = supports('seek');
    seek.hidden = !canSeek;
    bar.hidden = canSeek;
    seek.max = String(Math.round(entity.duration));
    if (!current.seeking) {
      seek.value = String(Math.round(at));
      fill.style.transform = `scaleX(${Math.min(1, at / entity.duration)})`;
      seek.style.setProperty('--fill', `${Math.min(100, (at / entity.duration) * 100)}%`);
    }
    const shown = current.seeking ? Number(seek.value) : at;
    elapsed.textContent = clock(shown);
    remaining.textContent = `-${clock(entity.duration - shown)}`;
  }

  function paintArt() {
    const { entity } = current;
    const hasArt = entity.image && entity.state !== 'OFF' && entity.state !== 'UNAVAILABLE';
    const key = hasArt ? entity.image : null;
    if (key === current.imageKey && art.childElementCount > 0) return;
    current.imageKey = key;
    if (!hasArt) {
      art.replaceChildren(icon('music'));
      backdrop.replaceChildren();
      return;
    }
    const src = imageUrl(current.remoteId, entity.id, entity.image);
    const image = el('img', 'player-art-image');
    image.alt = '';
    image.src = src;
    image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
    image.addEventListener('error', () => {
      art.replaceChildren(icon('music'));
      backdrop.replaceChildren();
    }, { once: true });
    art.replaceChildren(image);
    const blurred = el('img', 'player-backdrop-image');
    blurred.alt = '';
    blurred.src = src;
    backdrop.replaceChildren(blurred);
  }

  function paint() {
    const { entity } = current;
    if (!entity) return;
    paintArt();
    source.textContent = entity.name;
    title.textContent = entity.title ?? entity.name;
    artist.textContent = entity.artist ?? '';
    album.textContent = entity.album ?? '';
    artist.hidden = !entity.artist;
    album.hidden = !entity.album;
    state.textContent = STATES[entity.state] ?? entity.state ?? '';
    state.dataset.state = entity.state ?? 'UNKNOWN';
    const playing = entity.state === 'PLAYING';
    playPause.replaceChildren(icon(playing ? 'pause' : 'play'));
    playPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playPause.title = playing ? 'Pause' : 'Play';
    for (const [button, feature] of [[shuffle, 'shuffle'], [previous, 'previous'], [playPause, 'play_pause'], [next, 'next'], [stop, 'stop'], [repeat, 'repeat']]) {
      button.hidden = !supports(feature);
    }
    shuffle.classList.toggle('is-on', entity.shuffle === true);
    shuffle.setAttribute('aria-pressed', String(entity.shuffle === true));
    repeat.classList.toggle('is-on', entity.repeat === 'ALL' || entity.repeat === 'ONE');
    repeat.setAttribute('aria-pressed', String(entity.repeat === 'ALL' || entity.repeat === 'ONE'));
    repeatOne.hidden = entity.repeat !== 'ONE';
    transport.hidden = ![shuffle, previous, playPause, next, stop, repeat].some((button) => !button.hidden);
    mute.hidden = !supports('mute_toggle');
    mute.classList.toggle('is-on', entity.muted === true);
    mute.setAttribute('aria-pressed', String(entity.muted === true));
    down.hidden = !supports('volume_up_down');
    up.hidden = !supports('volume_up_down');
    level.hidden = !supports('volume') || entity.volume === null;
    if (!level.hidden && document.activeElement !== level) {
      level.value = String(Math.round(entity.volume));
      level.style.setProperty('--fill', `${Math.round(entity.volume)}%`);
    }
    levelText.textContent = entity.volume === null ? '' : `${Math.round(entity.volume)}`;
    levelText.hidden = entity.volume === null;
    volume.hidden = mute.hidden && down.hidden && level.hidden;
    paintProgress();
    clearInterval(current.ticker);
    current.ticker = playing ? setInterval(paintProgress, 1000) : null;
  }

  async function send(action, value) {
    if (!current.entity) return;
    const button = sheet.querySelector(`[data-action="${action}"]`);
    button?.classList.remove('is-sent');
    void button?.offsetWidth;
    button?.classList.add('is-sent');
    await onCommand(current.remoteId, current.entity.id, action, value);
  }

  function finishClose() {
    clearTimeout(current.closing);
    current.closing = null;
    dialog.classList.remove('is-closing');
    if (dialog.open) dialog.close();
  }

  function hide() {
    if (!dialog.open || current.closing) return;
    clearInterval(current.ticker);
    current.ticker = null;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return;
    }
    dialog.classList.add('is-closing');
    current.closing = setTimeout(finishClose, CLOSE_MS);
  }

  dialog.addEventListener('close', () => {
    clearInterval(current.ticker);
    current.ticker = null;
    current.entity = null;
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    hide();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) hide();
  });
  close.addEventListener('click', hide);
  transport.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !current.entity) return;
    const { action } = button.dataset;
    if (action === 'shuffle') send(action, current.entity.shuffle !== true);
    else if (action === 'repeat') send(action, REPEAT_NEXT[current.entity.repeat ?? 'OFF']);
    else send(action);
  });
  volume.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) send(button.dataset.action);
  });
  level.addEventListener('input', () => {
    level.style.setProperty('--fill', `${level.value}%`);
    levelText.textContent = level.value;
  });
  level.addEventListener('change', () => send('volume', Number(level.value)));
  seek.addEventListener('input', () => {
    current.seeking = true;
    seek.style.setProperty('--fill', `${(Number(seek.value) / Number(seek.max)) * 100}%`);
    paintProgress();
  });
  seek.addEventListener('change', async () => {
    const target = Number(seek.value);
    current.seeking = false;
    if (current.entity) {
      current.entity = { ...current.entity, position: target };
      current.at = performance.now();
    }
    paintProgress();
    await send('seek', target);
  });

  return {
    open(remoteId, entity, at = performance.now()) {
      finishClose();
      current.remoteId = remoteId;
      current.entity = entity;
      current.at = at;
      current.imageKey = null;
      art.replaceChildren();
      paint();
      dialog.showModal();
      close.focus({ focusVisible: false });
    },
    update(entity) {
      if (!dialog.open || current.entity?.id !== entity.id) return;
      if (entity.missing) {
        hide();
        return;
      }
      current.entity = entity;
      current.at = performance.now();
      paint();
    },
    close: hide,
    get entityId() {
      return dialog.open ? current.entity?.id ?? null : null;
    },
  };
}
