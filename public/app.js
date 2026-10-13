import { batteryFill } from './battery.js';
import { createPager } from './pages.js';
import { createBrowser } from './browser.js';
import { createChooser } from './chooser.js';
import { createPlayer } from './player.js';

const $ = (id) => document.getElementById(id);

const STORAGE = { theme: 'ucweb.theme', remote: 'ucweb.remote', pages: 'ucweb.pages', view: 'ucweb.view' };
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 180;
const RECONNECT_MS = [1000, 2000, 5000, 10000];
const MAX_PIN_LENGTH = 12;

const POWER_MODES = { NORMAL: 'Awake', IDLE: 'Idle', LOW_POWER: 'Low power', SUSPEND: 'Asleep' };
const BATTERY_STATUS = { CHARGING: 'Charging', DISCHARGING: 'Discharging', NOT_CHARGING: 'Not charging', FULL: 'Full' };
const STATE_LABELS = { ON: 'On', OFF: 'Off', RUNNING: 'Working', ERROR: 'Error', UNKNOWN: 'Unknown', COMPLETED: 'Done' };
const ACTIVE_STATES = new Set(['ON', 'RUNNING']);
const KEYMAP = {
  ArrowUp: 'DPAD_UP',
  ArrowDown: 'DPAD_DOWN',
  ArrowLeft: 'DPAD_LEFT',
  ArrowRight: 'DPAD_RIGHT',
  Enter: 'DPAD_MIDDLE',
  Backspace: 'BACK',
  Escape: 'BACK',
  Home: 'HOME',
  '+': 'VOLUME_UP',
  '=': 'VOLUME_UP',
  '-': 'VOLUME_DOWN',
  m: 'MUTE',
  M: 'MUTE',
  ' ': 'PLAY',
  PageUp: 'CHANNEL_UP',
  PageDown: 'CHANNEL_DOWN',
};

const state = {
  themes: [],
  version: null,
  remotes: new Map(),
  order: [],
  remoteId: null,
  controlId: null,
  buttons: null,
  buttonsKey: null,
  pagesKey: null,
  pager: null,
  player: null,
  chooser: null,
  browser: null,
  view: 'pages',
  socket: null,
  socketAttempts: 0,
  reconnectTimer: null,
  inflight: new Set(),
  systemArmed: null,
  systemTimer: null,
  systemBusy: false,
};

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function rememberedPages() {
  try {
    const saved = JSON.parse(load(STORAGE.pages) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function rememberPage(pageId) {
  if (!state.pagesKey || !pageId) return;
  const saved = rememberedPages();
  saved[state.pagesKey] = pageId;
  save(STORAGE.pages, JSON.stringify(saved));
}

async function api(path, options = {}) {
  const headers = options.body === undefined ? {} : { 'content-type': 'application/json' };
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/api/session') {
    showLogin(true);
    throw new Error(data.error ?? 'Sign in with your PIN first.');
  }
  if (!response.ok) throw new Error(data.error ?? `The server answered HTTP ${response.status}.`);
  return data;
}

let toastTimer = null;
function toast(message, { ok = false } = {}) {
  const node = $('toast');
  const host = ['chooser', 'browser', 'player'].map($).find((dialog) => dialog.open) ?? document.body;
  if (node.parentElement !== host) host.append(node);
  node.classList.toggle('is-ok', ok);
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4500);
}

function flashLogo() {
  for (const logo of document.querySelectorAll('.logo')) {
    logo.classList.remove('is-sending');
    void logo.getBoundingClientRect();
    logo.classList.add('is-sending');
  }
}

function applyTheme(id) {
  const link = $('theme-css');
  document.documentElement.dataset.theme = id;
  $('theme-select').value = id;
  const updateThemeColor = () => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (background) document.querySelector('meta[name="theme-color"]').content = background;
  };
  const href = `/themes/${id}/theme.css`;
  if (link.getAttribute('href') === href) {
    updateThemeColor();
    return;
  }
  link.addEventListener('load', updateThemeColor, { once: true });
  link.href = href;
}

async function initThemes() {
  const config = await api('/api/config');
  state.themes = config.themes;
  const select = $('theme-select');
  select.replaceChildren(...config.themes.map((theme) => {
    const option = el('option', null, theme.name);
    option.value = theme.id;
    return option;
  }));
  const saved = load(STORAGE.theme);
  applyTheme(config.themes.some((theme) => theme.id === saved) ? saved : config.defaultTheme);
  select.addEventListener('change', () => {
    save(STORAGE.theme, select.value);
    applyTheme(select.value);
  });
}

function setSignedIn(signedIn) {
  $('login').hidden = signedIn;
  $('app').hidden = !signedIn;
  $('remote-tabs').hidden = !signedIn;
  $('sign-out').hidden = !signedIn;
  if (!signedIn) $('banner').hidden = true;
}

function showLogin(pinConfigured) {
  disconnect();
  setSignedIn(false);
  $('login-lead').textContent = pinConfigured
    ? 'Enter your PIN'
    : 'No PIN is set yet. Run docker exec -it ucweb npm run set-pin, then reload this page.';
  $('keypad').hidden = !pinConfigured;
  $('pin').hidden = !pinConfigured;
  $('pin').value = '';
  $('login-error').textContent = '';
  if (pinConfigured) $('pin').focus();
}

function startApp() {
  setSignedIn(true);
  connect();
}

function initLogin() {
  const pin = $('pin');
  $('login-logo').append($('logo').cloneNode(true));
  $('login-logo').querySelector('svg').removeAttribute('id');
  $('keypad').addEventListener('click', (event) => {
    const button = event.target.closest('button[type="button"]');
    if (!button) return;
    if (button.dataset.digit && pin.value.length < MAX_PIN_LENGTH) pin.value += button.dataset.digit;
    if (button.dataset.key === 'clear') pin.value = pin.value.slice(0, -1);
    $('login-error').textContent = '';
  });
  pin.addEventListener('input', () => {
    pin.value = pin.value.replace(/\D/g, '').slice(0, MAX_PIN_LENGTH);
    $('login-error').textContent = '';
  });
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const card = $('login-form');
    try {
      await api('/api/session', { method: 'POST', body: JSON.stringify({ pin: pin.value }) });
      pin.value = '';
      startApp();
    } catch (error) {
      pin.value = '';
      $('login-error').textContent = error.message;
      card.classList.remove('is-wrong');
      void card.getBoundingClientRect();
      card.classList.add('is-wrong');
      pin.focus();
    }
  });
  $('sign-out').addEventListener('click', async () => {
    try {
      await api('/api/session', { method: 'DELETE' });
    } catch (error) {
      toast(error.message);
    }
    showLogin(true);
  });
}

function disconnect() {
  clearTimeout(state.reconnectTimer);
  const socket = state.socket;
  state.socket = null;
  socket?.close();
}

function connect() {
  clearTimeout(state.reconnectTimer);
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/events`);
  state.socket = socket;
  socket.addEventListener('open', () => {
    state.socketAttempts = 0;
    $('banner').hidden = true;
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    let stalePages = false;
    if (message.type === 'snapshot') {
      stalePages = true;
      if (state.version && message.version !== state.version) {
        location.reload();
        return;
      }
      state.version = message.version;
      state.remotes = new Map(message.remotes.map((remote) => [remote.id, remote]));
      state.order = message.remotes.map((remote) => remote.id);
      const saved = load(STORAGE.remote);
      if (!state.remotes.has(state.remoteId)) state.remoteId = state.remotes.has(saved) ? saved : state.order[0] ?? null;
    } else if (message.type === 'remote') {
      const before = state.remotes.get(message.remote.id);
      stalePages = Boolean(before && !before.online && message.remote.online);
      state.remotes.set(message.remote.id, message.remote);
    } else if (message.type === 'entity') {
      if (state.pagesKey?.startsWith(`${message.remote}\n`)) {
        state.pager.updateEntity(message.entity);
        state.player.update(message.entity);
        state.browser.update(message.entity);
      }
      return;
    } else if (message.type === 'pages') {
      if (state.pagesKey === `${message.remote}\n${message.activity}`) refreshPages();
      return;
    }
    const shownPages = state.pagesKey;
    render();
    if (stalePages && shownPages && shownPages === state.pagesKey) refreshPages();
  });
  socket.addEventListener('close', async () => {
    if (state.socket !== socket) return;
    state.socket = null;
    const session = await api('/api/session').catch(() => null);
    if (session && !session.authenticated) {
      showLogin(session.pinConfigured);
      return;
    }
    const banner = $('banner');
    banner.textContent = 'Lost the connection to ucweb. Reconnecting...';
    banner.hidden = false;
    const delay = RECONNECT_MS[Math.min(state.socketAttempts, RECONNECT_MS.length - 1)];
    state.socketAttempts += 1;
    state.reconnectTimer = setTimeout(connect, delay);
  });
}

function currentRemote() {
  return state.remotes.get(state.remoteId) ?? null;
}

function controlledActivity(remote) {
  if (!remote) return null;
  const chosen = remote.activities.find((activity) => activity.id === state.controlId);
  if (chosen && chosen.state !== 'OFF') return chosen;
  return remote.activities.find((activity) => ACTIVE_STATES.has(activity.state)) ?? null;
}

function selectRemote(id) {
  state.remoteId = id;
  state.controlId = null;
  save(STORAGE.remote, id);
  render();
}

function batteryText(battery, problem) {
  if (!battery) return problem ? 'Not readable' : 'Unknown';
  const status = BATTERY_STATUS[battery.status] ?? battery.status;
  return status ? `${battery.capacity}% ${status.toLowerCase()}` : `${battery.capacity}%`;
}

function renderTabs() {
  const tabs = state.order.map((id) => {
    const remote = state.remotes.get(id);
    const tab = el('button', 'remote-tab');
    tab.type = 'button';
    tab.setAttribute('aria-pressed', String(id === state.remoteId));
    const dot = el('span', `dot ${remote.online ? 'is-online' : 'is-offline'}`);
    dot.setAttribute('aria-hidden', 'true');
    tab.append(dot, el('span', 'remote-tab-name', remote.name ?? remote.address));
    tab.append(el('span', 'remote-tab-battery', remote.battery ? `${remote.battery.capacity}%` : 'n/a'));
    const batteryNote = remote.battery ? '' : ', battery level not available right now';
    tab.title = `${remote.name ?? remote.address} is ${remote.online ? 'online' : 'offline'}${batteryNote}`;
    tab.addEventListener('click', () => selectRemote(id));
    return tab;
  });
  $('remote-tabs').replaceChildren(...tabs);
}

function statusChip(label, value, modifier) {
  const chip = el('div', `chip${modifier ? ` ${modifier}` : ''}`);
  chip.append(el('span', 'label', label), el('span', 'chip-value', value));
  return chip;
}

function renderStatus(remote) {
  const container = $('status');
  if (!remote) {
    container.replaceChildren(el('p', 'empty', 'No remotes are configured.'));
    return;
  }
  const connection = statusChip('Connection', remote.online ? 'Online' : 'Offline', remote.online ? 'is-ok' : 'is-warn');
  const battery = statusChip('Battery', batteryText(remote.battery, remote.batteryProblem), remote.battery?.capacity <= 15 || remote.batteryProblem ? 'is-warn' : '');
  if (remote.batteryProblem) battery.append(el('span', 'chip-note', 'The remote answers with an error when asked for its battery level.'));
  if (remote.batteryProblem) battery.title = remote.batteryProblem;
  if (remote.battery) {
    const meter = el('span', 'meter');
    const fill = el('span', 'meter-fill');
    fill.style.width = `${Math.max(0, Math.min(100, remote.battery.capacity))}%`;
    fill.style.background = batteryFill(remote.battery.capacity);
    meter.append(fill);
    battery.append(meter);
  }
  const powerSupply = statusChip('Power supply', remote.powerSupply === true ? 'Docked or plugged in' : remote.powerSupply === false ? 'Battery only' : 'Unknown');
  const mode = statusChip('Remote', POWER_MODES[remote.powerMode] ?? remote.powerMode ?? 'Unknown');
  const device = statusChip('Device', [remote.model, remote.firmware?.os && `OS ${remote.firmware.os}`].filter(Boolean).join(', ') || 'Unknown', 'chip-wide');
  if (remote.firmware) device.title = `Core ${remote.firmware.core}, UI ${remote.firmware.ui}, OS ${remote.firmware.os}`;
  const children = [connection, battery, powerSupply, mode, device];
  if (remote.problem && !remote.online) children.push(el('p', 'problem', remote.problem));
  container.replaceChildren(...children);
}

async function setPower(remote, activity, on) {
  if (on) state.controlId = activity.id;
  flashLogo();
  try {
    await api(`/api/remotes/${encodeURIComponent(remote.id)}/activities/${encodeURIComponent(activity.id)}/power`, {
      method: 'POST',
      body: JSON.stringify({ on }),
    });
  } catch (error) {
    toast(error.message);
  }
}

function focusControl(activity) {
  state.controlId = activity.id;
  render();
  if (matchMedia('(max-width: 899px)').matches) $('control').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderActivities(remote) {
  const grid = $('activity-grid');
  if (!remote) {
    grid.replaceChildren();
    return;
  }
  if (remote.activities.length === 0) {
    const text = remote.online ? 'This remote has no activities.' : `Waiting for ${remote.name ?? remote.address}...`;
    grid.replaceChildren(el('p', 'empty', text));
    return;
  }
  const controlled = controlledActivity(remote);
  grid.replaceChildren(...remote.activities.map((activity) => {
    const stateName = activity.state ?? 'UNKNOWN';
    const tile = el('article', 'tile');
    tile.dataset.state = stateName;
    if (controlled?.id === activity.id) tile.classList.add('is-controlled');
    const main = el('button', 'tile-main');
    main.type = 'button';
    main.disabled = !remote.online;
    main.append(el('span', 'tile-name', activity.name));
    if (activity.description) main.append(el('span', 'tile-description', activity.description));
    main.append(el('span', 'badge', STATE_LABELS[stateName] ?? stateName));
    const active = ACTIVE_STATES.has(stateName);
    main.setAttribute('aria-label', active ? `Control ${activity.name}` : `Start ${activity.name}`);
    main.addEventListener('click', () => (active ? focusControl(activity) : setPower(remote, activity, true)));
    tile.append(main);
    if (active) {
      const off = el('button', 'tile-off', 'Turn off');
      off.type = 'button';
      off.disabled = !remote.online;
      off.setAttribute('aria-label', `Turn off ${activity.name}`);
      off.addEventListener('click', () => setPower(remote, activity, false));
      tile.append(off);
    }
    if (stateName === 'ERROR') {
      tile.append(el('p', 'tile-error', 'The last run failed. Start it again, or check it in the web configurator.'));
    }
    return tile;
  }));
}

function applyButtons() {
  for (const key of document.querySelectorAll('#pad [data-button]')) {
    const button = state.buttons?.get(key.dataset.button);
    key.hidden = state.buttons !== null && button === undefined;
    key.disabled = button?.mapped !== true;
    if (button?.fallback) key.title = 'Not set in this activity: sent to the device the D-pad controls';
    else key.title = button?.mapped === false ? 'Not set up for this activity' : '';
  }
}

async function loadButtons(remote, activity) {
  const key = `${remote.id}\n${activity.id}`;
  if (state.buttonsKey === key) return;
  state.buttonsKey = key;
  state.buttons = null;
  applyButtons();
  try {
    const buttons = await api(`/api/remotes/${encodeURIComponent(remote.id)}/activities/${encodeURIComponent(activity.id)}/buttons`);
    if (state.buttonsKey !== key) return;
    state.buttons = new Map(buttons.map((button) => [button.button, button]));
  } catch (error) {
    if (state.buttonsKey !== key) return;
    state.buttonsKey = null;
    toast(error.message);
  }
  applyButtons();
}

function applyView({ animate = false } = {}) {
  const switcher = $('view-switch');
  const hasPages = state.pager.hasPages;
  const active = !$('pad').hidden || hasPages;
  const view = hasPages ? state.view : 'controls';
  switcher.hidden = !hasPages || $('pad').hidden;
  $('hint').hidden = !active;
  const panel = document.querySelector('.control-panel');
  if (animate && panel.dataset.view !== view) {
    panel.classList.remove('is-switching');
    void panel.offsetWidth;
    panel.classList.add('is-switching');
  }
  panel.dataset.view = view;
  for (const tab of switcher.querySelectorAll('[data-view]')) {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
}

function setView(view) {
  if (!state.pager.hasPages || view === state.view) return;
  state.view = view;
  save(STORAGE.view, view);
  applyView({ animate: true });
}

function initViewSwitch() {
  state.view = load(STORAGE.view) === 'controls' ? 'controls' : 'pages';
  const switcher = $('view-switch');
  switcher.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-view]');
    if (tab) setView(tab.dataset.view);
  });
  switcher.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    setView(state.view === 'pages' ? 'controls' : 'pages');
    switcher.querySelector(`[data-view="${state.view}"]`).focus();
  });
}

const visiblePages = (pages) => pages.filter((page) => page.items.length > 0);

async function loadPages(remote, activity, { force = false } = {}) {
  const key = `${remote.id}\n${activity.id}`;
  if (state.pagesKey === key && !force) return;
  const fresh = state.pagesKey !== key;
  state.pagesKey = key;
  if (fresh) {
    state.pager.clear();
    state.player.close();
    applyView();
  }
  try {
    const data = await api(`/api/remotes/${encodeURIComponent(remote.id)}/activities/${encodeURIComponent(activity.id)}/pages`);
    if (state.pagesKey !== key) return;
    const pages = visiblePages(data.pages);
    if (pages.length === 0) {
      state.pager.clear();
      applyView();
      return;
    }
    state.pager.show({ key, pages, entities: data.entities, pageId: rememberedPages()[key], remoteId: remote.id });
    state.pager.setEnabled(Boolean(currentRemote()?.online));
    applyView();
  } catch (error) {
    if (state.pagesKey !== key) return;
    state.pagesKey = null;
    state.pager.clear();
    applyView();
    toast(error.message);
  }
}

function refreshPages() {
  const remote = currentRemote();
  const activity = controlledActivity(remote);
  if (remote && activity && state.pagesKey === `${remote.id}\n${activity.id}`) loadPages(remote, activity, { force: true });
}

function openPlayer(entityId) {
  const remote = currentRemote();
  const media = state.pager.media(entityId);
  if (!remote?.online || !media) return;
  state.player.open(remote.id, media.entity, media.at);
}

async function chooseSource(remoteId, entityId) {
  const entity = state.pager.media(entityId)?.entity;
  if (!entity?.sources?.length) return;
  const chosen = await state.chooser.choose({ heading: 'Source', detail: entity.name, options: entity.sources, current: entity.source });
  if (chosen && chosen !== entity.source) await playerCommand(remoteId, entityId, 'select_source', chosen);
}

const PLAY_DONE = { PLAY_NEXT: 'Playing next.', ADD_TO_QUEUE: 'Added to the queue.' };

async function browsePage(remoteId, entityId, { mediaId, mediaType, page }) {
  const query = new URLSearchParams();
  if (typeof mediaId === 'string') query.set('media_id', mediaId);
  if (typeof mediaType === 'string') query.set('media_type', mediaType);
  query.set('page', String(page));
  return api(`/api/remotes/${encodeURIComponent(remoteId)}/entities/${encodeURIComponent(entityId)}/browse?${query}`);
}

async function playMedia(remoteId, entityId, item, how) {
  flashLogo();
  try {
    const value = { mediaId: item.mediaId, mediaType: item.mediaType };
    if (how) value.action = how;
    await api(`/api/remotes/${encodeURIComponent(remoteId)}/entities/${encodeURIComponent(entityId)}/player`, {
      method: 'POST',
      body: JSON.stringify({ action: 'play_media', value }),
    });
    if (PLAY_DONE[how]) toast(`${item.title}: ${PLAY_DONE[how].toLowerCase()}`, { ok: true });
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

async function playerCommand(remoteId, entityId, action, value) {
  if (action === 'select_source' && value === undefined) {
    await chooseSource(remoteId, entityId);
    return;
  }
  if (action === 'browse_media') {
    const entity = state.pager.media(entityId)?.entity;
    if (entity) state.browser.open(remoteId, entity);
    return;
  }
  flashLogo();
  try {
    await api(`/api/remotes/${encodeURIComponent(remoteId)}/entities/${encodeURIComponent(entityId)}/player`, {
      method: 'POST',
      body: JSON.stringify(value === undefined ? { action } : { action, value }),
    });
  } catch (error) {
    toast(error.message);
  }
}

async function pressItem(pageId, index) {
  const remote = currentRemote();
  const activity = controlledActivity(remote);
  if (!remote || !activity) return;
  flashLogo();
  try {
    await api(
      `/api/remotes/${encodeURIComponent(remote.id)}/activities/${encodeURIComponent(activity.id)}/pages/${encodeURIComponent(pageId)}/items/${index}`,
      { method: 'POST', body: '{}' },
    );
  } catch (error) {
    toast(error.message);
  }
}

function renderControl(remote) {
  const activity = controlledActivity(remote);
  const head = $('control-head');
  const pad = $('pad');
  $('control').classList.toggle('is-active', Boolean(activity));
  document.querySelector('.layout').classList.toggle('has-active', Boolean(activity));
  if (!activity || !remote?.online) {
    pad.hidden = true;
    state.buttonsKey = null;
    state.pagesKey = null;
    state.pager.clear();
    state.player.close();
    state.chooser.close();
    state.browser.close();
    applyView();
    const message = !remote?.online && remote
      ? `${remote.name ?? remote.address} is offline.`
      : 'Nothing is running. Start an activity to use the controls.';
    head.replaceChildren(el('p', 'empty', message));
    return;
  }
  const title = el('div', 'control-title');
  title.append(el('h3', 'control-name', activity.name), el('span', 'badge', STATE_LABELS[activity.state] ?? activity.state));
  title.dataset.state = activity.state;
  head.replaceChildren(title);
  pad.hidden = false;
  loadButtons(remote, activity);
  loadPages(remote, activity);
  state.pager.setEnabled(remote.online);
  applyView();
}

function renderSectionMeta(remote) {
  const count = remote?.activities.length ?? 0;
  $('activities-meta').textContent = remote ? `${count} ${count === 1 ? 'activity' : 'activities'}` : '';
  $('status-meta').textContent = remote ? remote.name ?? remote.address : '';
  $('control-meta').textContent = remote ? remote.name ?? remote.address : '';
  $('system-meta').textContent = remote ? remote.name ?? remote.address : '';
}

const SYSTEM_ACTIONS = {
  REBOOT: { label: 'Reboot', confirm: 'Tap to confirm', done: 'is rebooting.' },
  POWER_OFF: { label: 'Power off', confirm: 'Tap to confirm', done: 'is powering off. Turn it back on at the remote.' },
};
const CONFIRM_MS = 4000;

function disarmSystem() {
  clearTimeout(state.systemTimer);
  state.systemArmed = null;
  for (const button of document.querySelectorAll('.system-button[data-command]')) {
    button.classList.remove('is-armed');
    button.querySelector('.system-button-text').textContent = SYSTEM_ACTIONS[button.dataset.command].label;
  }
}

function renderSystem(remote) {
  const configurator = $('system-configurator');
  configurator.hidden = !remote;
  if (remote) {
    configurator.href = remote.configuratorUrl;
    configurator.setAttribute('aria-label', `Open the web configurator for ${remote.name ?? remote.address}`);
  }
  if (state.systemArmed && state.systemArmed.remoteId !== remote?.id) disarmSystem();
  for (const button of document.querySelectorAll('.system-button[data-command]')) {
    button.disabled = !remote?.online || state.systemBusy;
  }
}

async function systemCommand(button) {
  const remote = currentRemote();
  if (!remote?.online || state.systemBusy) return;
  const command = button.dataset.command;
  if (state.systemArmed?.command !== command || state.systemArmed.remoteId !== remote.id) {
    disarmSystem();
    state.systemArmed = { command, remoteId: remote.id };
    button.classList.add('is-armed');
    button.querySelector('.system-button-text').textContent = SYSTEM_ACTIONS[command].confirm;
    state.systemTimer = setTimeout(disarmSystem, CONFIRM_MS);
    return;
  }
  disarmSystem();
  state.systemBusy = true;
  renderSystem(remote);
  try {
    await api(`/api/remotes/${encodeURIComponent(remote.id)}/system`, { method: 'POST', body: JSON.stringify({ command }) });
    toast(`${remote.name ?? remote.address} ${SYSTEM_ACTIONS[command].done}`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.systemBusy = false;
    renderSystem(currentRemote());
  }
}

function initSystem() {
  for (const button of document.querySelectorAll('.system-button[data-command]')) {
    button.addEventListener('click', () => systemCommand(button));
  }
}

function render() {
  const remote = currentRemote();
  renderSectionMeta(remote);
  renderTabs();
  renderStatus(remote);
  renderActivities(remote);
  renderControl(remote);
  renderSystem(remote);
}

async function press(button) {
  const remote = currentRemote();
  const activity = controlledActivity(remote);
  if (!remote || !activity || state.inflight.has(button)) return;
  state.inflight.add(button);
  flashLogo();
  try {
    await api(
      `/api/remotes/${encodeURIComponent(remote.id)}/activities/${encodeURIComponent(activity.id)}/buttons/${encodeURIComponent(button)}`,
      { method: 'POST', body: '{}' },
    );
  } catch (error) {
    toast(error.message);
  } finally {
    state.inflight.delete(button);
  }
}

function initPad() {
  const pad = $('pad');
  let delayTimer = null;
  let repeatTimer = null;
  const stopRepeat = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    delayTimer = null;
    repeatTimer = null;
  };
  pad.addEventListener('pointerdown', (event) => {
    const key = event.target.closest('[data-repeat]');
    if (!key || key.disabled) return;
    event.preventDefault();
    press(key.dataset.button);
    stopRepeat();
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => press(key.dataset.button), REPEAT_EVERY_MS);
    }, REPEAT_DELAY_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) pad.addEventListener(type, stopRepeat);
  window.addEventListener('blur', stopRepeat);
  pad.addEventListener('click', (event) => {
    const key = event.target.closest('[data-button]');
    if (!key || key.disabled) return;
    if (key.hasAttribute('data-repeat') && event.detail !== 0) return;
    press(key.dataset.button);
  });
  pad.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('keydown', (event) => {
    if (!$('login').hidden || $('pad').hidden || ['player', 'chooser', 'browser'].some((id) => $(id).open)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('input, select, textarea')) return;
    if ((event.key === 't' || event.key === 'T') && state.pager.hasPages) {
      event.preventDefault();
      setView(state.view === 'pages' ? 'controls' : 'pages');
      return;
    }
    if (event.key === '0' && state.pager.hasPages && state.view === 'pages') {
      event.preventDefault();
      state.pager.home();
      return;
    }
    if ((event.key === '[' || event.key === ']') && state.pager.hasPages && state.view === 'pages') {
      event.preventDefault();
      state.pager.step(event.key === '[' ? -1 : 1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('button')) return;
    const button = KEYMAP[event.key];
    if (!button) return;
    const key = document.querySelector(`#pad [data-button="${button}"]`);
    if (!key || key.hidden || key.disabled) return;
    if (event.repeat && !key.hasAttribute('data-repeat')) return;
    event.preventDefault();
    press(button);
  });
}

async function boot() {
  const imageUrl = (remoteId, entityId, version) => `/api/remotes/${encodeURIComponent(remoteId)}/entities/${encodeURIComponent(entityId)}/image?v=${encodeURIComponent(version)}`;
  state.pager = createPager($('pages'), {
    onPress: pressItem,
    onIndex: rememberPage,
    imageUrl,
    onOpenPlayer: openPlayer,
    onPlayer: (entityId, action, value) => {
      const remote = currentRemote();
      if (remote?.online) playerCommand(remote.id, entityId, action, value);
    },
  });
  state.chooser = createChooser($('chooser'));
  state.browser = createBrowser($('browser'), {
    fetchPage: browsePage,
    onPlay: playMedia,
    thumbUrl: (remoteId, entityId, key) => `/api/remotes/${encodeURIComponent(remoteId)}/entities/${encodeURIComponent(entityId)}/thumbs/${key}`,
    chooseAction: (options) => state.chooser.choose({ ...options, current: null }),
  });
  state.player = createPlayer($('player'), { onCommand: playerCommand, imageUrl });
  initLogin();
  initViewSwitch();
  initPad();
  initSystem();
  try {
    await initThemes();
    const session = await api('/api/session');
    if (session.authenticated) startApp();
    else showLogin(session.pinConfigured);
  } catch (error) {
    toast(`ucweb could not start: ${error.message}`);
  }
}

boot();
