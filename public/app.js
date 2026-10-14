import { batteryAge, batteryFill, batteryReading } from './battery.js';
import { canVibrate, tap } from './haptics.js';
import { createHold } from './hold.js';
import { createPager } from './pages.js';
import { createBrowser } from './browser.js';
import { createChooser } from './chooser.js';
import { createPlayer } from './player.js';
import { createDeviceTiles, icon, iconFor, renderIntegrations, stateLabel, TYPE_ICONS, TYPE_LABELS } from './devices.js';

const $ = (id) => document.getElementById(id);

const STORAGE = { theme: 'ucweb.theme', remote: 'ucweb.remote', pages: 'ucweb.pages', view: 'ucweb.view', screen: 'ucweb.screen', haptics: 'ucweb.haptics' };
const PINNED_NAV = '(min-width: 1200px)';
const ALL_ACTIVITIES = { id: '', name: 'Activities', items: null };
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 180;
const RECONNECT_MS = [1000, 2000, 5000, 10000];
const MAX_PIN_LENGTH = 12;
const AGE_TICK_MS = 30000;

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
  control: null,
  profiles: new Map(),
  store: new Map(),
  listed: new Map(),
  integrations: new Map(),
  filter: 'all',
  query: '',
  tiles: null,
  sheetsFromPager: false,
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
  haptics: true,
  roomsBusy: new Set(),
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

function flashLogo({ repeat = false } = {}) {
  if (!repeat) tap(navigator, state.haptics, touchScreen());
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

async function loadThemes() {
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
}

function initThemePicker() {
  const select = $('theme-select');
  select.addEventListener('change', () => {
    save(STORAGE.theme, select.value);
    applyTheme(select.value);
  });
}

function setSignedIn(signedIn) {
  $('login').hidden = signedIn;
  $('shell').hidden = !signedIn;
  $('menu-button').hidden = !signedIn;
  if (!signedIn) closeNav();
  $('remote-tabs').hidden = !signedIn;
  $('sign-out').hidden = !signedIn;
  $('haptics-group').hidden = !signedIn || !canVibrate(navigator, touchScreen());
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
      state.profiles.clear();
      state.listed.clear();
      state.integrations.clear();
      state.store.clear();
      state.remotes = new Map(message.remotes.map((remote) => [remote.id, remote]));
      state.order = message.remotes.map((remote) => remote.id);
      const saved = load(STORAGE.remote);
      if (!state.remotes.has(state.remoteId)) state.remoteId = state.remotes.has(saved) ? saved : state.order[0] ?? null;
    } else if (message.type === 'remote') {
      const before = state.remotes.get(message.remote.id);
      stalePages = Boolean(before && !before.online && message.remote.online);
      if (stalePages) {
        state.profiles.delete(message.remote.id);
        state.listed.delete(message.remote.id);
        state.integrations.delete(message.remote.id);
      }
      state.remotes.set(message.remote.id, message.remote);
    } else if (message.type === 'entity') {
      applyEntity(message.remote, message.entity);
      return;
    } else if (message.type === 'pages') {
      if (state.pagesKey === `${message.remote}\n${message.activity}`) refreshPages();
      return;
    } else if (message.type === 'profile') {
      const remote = state.remotes.get(message.remote);
      if (remote) loadProfile(remote);
      return;
    } else if (message.type === 'integrations') {
      const remote = state.remotes.get(message.remote);
      if (remote && state.integrations.has(remote.id)) loadIntegrations(remote);
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
  const chosen = state.control?.kind === 'activity' ? remote.activities.find((activity) => activity.id === state.control.id) : null;
  if (chosen && chosen.state !== 'OFF') return chosen;
  return remote.activities.find((activity) => ACTIVE_STATES.has(activity.state)) ?? null;
}

function controlledTarget(remote) {
  if (!remote) return null;
  if (state.control?.kind === 'device') {
    const device = entityOf(remote.id, state.control.id);
    if (device?.type === 'remote' && device.controllable) return { kind: 'device', id: device.id, name: device.name, state: device.state ?? 'UNKNOWN' };
  }
  const activity = controlledActivity(remote);
  return activity ? { kind: 'activity', id: activity.id, name: activity.name, state: activity.state } : null;
}

const targetPath = (remote, target) =>
  `/api/remotes/${encodeURIComponent(remote.id)}/${target.kind === 'device' ? 'devices' : 'activities'}/${encodeURIComponent(target.id)}`;

function storeOf(remoteId) {
  if (!state.store.has(remoteId)) state.store.set(remoteId, new Map());
  return state.store.get(remoteId);
}

function entityOf(remoteId, entityId) {
  return state.store.get(remoteId)?.get(entityId)?.entity ?? null;
}

function rememberEntity(remoteId, entity) {
  if (entity.missing) storeOf(remoteId).delete(entity.id);
  else storeOf(remoteId).set(entity.id, { entity, at: performance.now() });
}

function mediaEntry(entityId) {
  const paged = state.pager.media(entityId);
  if (paged) return paged;
  const stored = state.store.get(state.remoteId)?.get(entityId);
  return stored?.entity.type === 'media_player' ? stored : null;
}

function selectRemote(id) {
  state.remoteId = id;
  state.control = null;
  save(STORAGE.remote, id);
  render();
}

function batteryText(reading, problem) {
  if (!reading) return problem ? 'Not readable' : 'Unknown';
  if (reading.stale) return `${reading.capacity}%`;
  const status = BATTERY_STATUS[reading.status] ?? reading.status;
  return status ? `${reading.capacity}% ${status.toLowerCase()}` : `${reading.capacity}%`;
}

function ageNode(className, at) {
  const node = el('span', className);
  node.dataset.batteryAt = String(at);
  node.textContent = `Last read ${batteryAge(Date.now() - at)}`;
  return node;
}

function tickAges() {
  for (const node of document.querySelectorAll('[data-battery-at]')) {
    node.textContent = `Last read ${batteryAge(Date.now() - Number(node.dataset.batteryAt))}`;
  }
  for (const tab of document.querySelectorAll('.remote-tab[data-battery-at]')) {
    tab.title = `${tab.dataset.label}, battery last read ${batteryAge(Date.now() - Number(tab.dataset.batteryAt))}`;
  }
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
    const reading = batteryReading(remote);
    tab.append(el('span', `remote-tab-battery${reading?.stale ? ' is-stale' : ''}`, reading ? `${reading.capacity}%` : 'n/a'));
    const label = `${remote.name ?? remote.address} is ${remote.online ? 'online' : 'offline'}`;
    if (reading?.stale) {
      tab.dataset.label = label;
      tab.dataset.batteryAt = String(reading.at);
      tab.title = `${label}, battery last read ${batteryAge(Date.now() - reading.at)}`;
    } else {
      tab.title = reading ? label : `${label}, battery level not available right now`;
    }
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
  const reading = batteryReading(remote);
  const battery = statusChip('Battery', batteryText(reading, remote.batteryProblem), reading?.capacity <= 15 || remote.batteryProblem ? 'is-warn' : '');
  if (reading?.stale) battery.append(ageNode('chip-note', reading.at));
  if (remote.batteryProblem) battery.append(el('span', 'chip-note', 'The remote answers with an error when asked for its battery level.'));
  if (remote.batteryProblem) battery.title = remote.batteryProblem;
  if (reading) {
    const meter = el('span', `meter${reading.stale ? ' is-stale' : ''}`);
    const fill = el('span', 'meter-fill');
    fill.style.width = `${Math.max(0, Math.min(100, reading.capacity))}%`;
    fill.style.background = batteryFill(reading.capacity);
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

const ROOM_STATES = { ACTIVE: 'ON', RUNNING: 'RUNNING', ERROR: 'ERROR', OFF: 'OFF' };

function roomsOf(remote) {
  const groups = remote?.groups;
  if (!groups || !groups.some((group) => group.id !== 'default')) return [];
  return groups;
}

async function roomOff(remote, group) {
  const key = `${remote.id}\n${group.id}`;
  if (state.roomsBusy.has(key)) return;
  state.roomsBusy.add(key);
  renderRooms(remote);
  flashLogo();
  try {
    await api(`/api/remotes/${encodeURIComponent(remote.id)}/groups/${encodeURIComponent(group.id)}/off`, { method: 'POST', body: '{}' });
  } catch (error) {
    toast(error.message);
  } finally {
    state.roomsBusy.delete(key);
    renderRooms(currentRemote());
  }
}

function roomCard(remote, group) {
  const shown = ROOM_STATES[group.state] ?? 'OFF';
  const card = el('div', 'room');
  card.dataset.state = shown;
  const running = group.activityIds
    .map((id) => remote.activities.find((activity) => activity.id === id))
    .filter((activity) => activity && ACTIVE_STATES.has(activity.state))
    .map((activity) => activity.name);
  const text = el('div', 'room-text');
  const idle = shown === 'ERROR' ? 'The last run failed' : STATE_LABELS[shown];
  text.append(el('span', 'label', group.name), el('span', 'room-value', running.length ? running.join(', ') : idle));
  card.append(text);
  if (shown !== 'OFF') card.append(el('span', 'badge', STATE_LABELS[shown]));
  if (shown === 'ON' || shown === 'RUNNING') {
    const off = el('button', 'room-off', 'Turn off');
    off.type = 'button';
    off.disabled = !remote.online || state.roomsBusy.has(`${remote.id}\n${group.id}`);
    off.setAttribute('aria-label', `Turn off everything in ${group.name}`);
    off.addEventListener('click', () => roomOff(remote, group));
    card.append(off);
  }
  return card;
}

function renderRooms(remote) {
  const container = $('rooms');
  const rooms = roomsOf(remote);
  container.hidden = rooms.length === 0;
  container.replaceChildren(...rooms.map((group) => roomCard(remote, group)));
}

async function setPower(remote, activity, on) {
  if (on) state.control = { kind: 'activity', id: activity.id };
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

function focusControl(target) {
  state.control = target;
  render();
  if (matchMedia('(max-width: 899px)').matches) $('control').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function activityTile(remote, activity, target) {
  const stateName = activity.state ?? 'UNKNOWN';
  const tile = el('article', 'tile');
  tile.dataset.state = stateName;
  tile.dataset.entity = activity.id;
  if (target?.kind === 'activity' && target.id === activity.id) tile.classList.add('is-controlled');
  const main = el('button', 'tile-main');
  main.type = 'button';
  main.disabled = !remote.online;
  main.append(el('span', 'tile-name', activity.name));
  if (activity.description) main.append(el('span', 'tile-description', activity.description));
  main.append(el('span', 'badge', STATE_LABELS[stateName] ?? stateName));
  const active = ACTIVE_STATES.has(stateName);
  main.setAttribute('aria-label', active ? `Control ${activity.name}` : `Start ${activity.name}`);
  main.addEventListener('click', () => (active ? focusControl({ kind: 'activity', id: activity.id }) : setPower(remote, activity, true)));
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
}

function itemTile(remote, entityId, target) {
  const activity = remote.activities.find((candidate) => candidate.id === entityId);
  if (activity) return activityTile(remote, activity, target);
  const entity = entityOf(remote.id, entityId);
  if (!entity) return state.tiles.missing(entityId);
  return state.tiles.tile(entity, { enabled: remote.online, controlled: target?.kind === 'device' && target.id === entityId });
}

function keepBusy(container, nodes) {
  const busy = new Map([...container.querySelectorAll('.dev-tile.is-busy')].map((node) => [node.dataset.entity, node]));
  return nodes.map((node) => busy.get(node.dataset?.entity) ?? node);
}

function pagesOf(remote) {
  const pages = state.profiles.get(remote.id)?.pages;
  return pages?.length ? pages : [ALL_ACTIVITIES];
}

function savedScreens() {
  try {
    const saved = JSON.parse(load(STORAGE.screen) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function screenOf(remote) {
  const saved = savedScreens()[remote.id];
  if (saved === 'entities' || saved === 'integrations') return { kind: saved };
  const pages = pagesOf(remote);
  const page = pages.find((candidate) => candidate.id === saved);
  if (page) return { kind: 'page', page };
  const loading = typeof saved === 'string' && saved !== '' && state.profiles.get(remote.id)?.status === 'loading';
  return { kind: 'page', page: loading ? null : pages[0] };
}

function setScreen(id) {
  const remote = currentRemote();
  if (!remote) return;
  const saved = savedScreens();
  saved[remote.id] = id;
  save(STORAGE.screen, JSON.stringify(saved));
  closeNav();
  render();
  const section = navPinned() ? null : document.querySelector(id === 'entities' || id === 'integrations' ? '#browse' : '.activities');
  const top = section ? section.getBoundingClientRect().top + window.scrollY - document.querySelector('.topbar').offsetHeight - 12 : 0;
  window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function pageIcon(remote, page) {
  const first = page.items?.[0];
  const entry = first?.group ? first.group.items[0] : first;
  if (!entry) return page.items === null ? 'apps' : 'folder';
  if (entry.type === 'activity') return 'apps';
  const entity = entityOf(remote.id, entry.entityId);
  return entity ? iconFor(entity) : TYPE_ICONS[entry.type] ?? 'folder';
}

const itemCount = (page) => (page.items ?? []).reduce((total, item) => total + (item.group ? item.group.items.length : 1), 0);

function renderNav(remote) {
  $('nav-remote').textContent = remote ? remote.name ?? remote.address : '';
  const list = $('nav-pages');
  if (!remote) {
    list.replaceChildren();
    return;
  }
  const screen = screenOf(remote);
  const profile = state.profiles.get(remote.id);
  list.replaceChildren(...pagesOf(remote).map((page) => {
    const item = el('li');
    const link = el('button', 'nav-item');
    link.type = 'button';
    link.dataset.screen = page.id;
    if (screen.kind === 'page' && screen.page?.id === page.id) link.setAttribute('aria-current', 'page');
    link.append(icon(pageIcon(remote, page)), el('span', 'nav-text', page.name));
    const count = page.items === null ? remote.activities.length : itemCount(page);
    link.append(el('span', 'nav-count', String(count)));
    item.append(link);
    return item;
  }));
  if (profile?.status === 'error') list.append(el('li', 'nav-note', 'Could not read the remote\'s pages.'));
  for (const link of document.querySelectorAll('.nav-list [data-screen="entities"], .nav-list [data-screen="integrations"]')) {
    if (screen.kind === link.dataset.screen) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const listed = state.listed.get(remote.id);
  $('nav-entities-count').textContent = listed === 'ready' ? String(storeOf(remote.id).size + remote.activities.length) : '';
  const integrations = state.integrations.get(remote.id);
  $('nav-integrations-count').textContent = integrations?.data ? String(integrations.data.integrations.length) : '';
}

function skeletonTiles(count) {
  return Array.from({ length: count }, () => {
    const tile = el('div', 'tile dev-skeleton');
    tile.setAttribute('aria-hidden', 'true');
    return tile;
  });
}

function renderPage(remote, page, target) {
  const grid = $('activity-grid');
  document.querySelector('.layout').classList.remove('shows-devices');
  $('activities-title').textContent = page?.name ?? 'Pages';
  if (!remote.online && remote.activities.length === 0) {
    grid.className = 'activity-grid';
    grid.replaceChildren(el('p', 'empty', `Waiting for ${remote.name ?? remote.address}...`));
    $('activities-meta').textContent = '';
    return;
  }
  if (!page) {
    grid.className = 'activity-grid is-devices';
    grid.replaceChildren(...skeletonTiles(4));
    $('activities-meta').textContent = 'Loading';
    return;
  }
  if (page.items === null) {
    const count = remote.activities.length;
    $('activities-meta').textContent = `${count} ${count === 1 ? 'activity' : 'activities'}`;
    grid.className = 'activity-grid';
    grid.replaceChildren(...(count === 0
      ? [el('p', 'empty', 'This remote has no activities.')]
      : remote.activities.map((activity) => activityTile(remote, activity, target))));
    return;
  }
  const count = itemCount(page);
  const onlyActivities = page.items.every((item) => item.type === 'activity');
  document.querySelector('.layout').classList.toggle('shows-devices', !onlyActivities);
  const noun = onlyActivities ? ['activity', 'activities'] : ['item', 'items'];
  $('activities-meta').textContent = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  grid.className = onlyActivities ? 'activity-grid' : 'activity-grid is-devices';
  const nodes = page.items.map((item) => {
    if (!item.group) return itemTile(remote, item.entityId, target);
    const group = el('section', 'dev-group');
    const head = el('h3', 'dev-group-name', item.group.name);
    const tiles = el('div', 'activity-grid is-devices');
    tiles.append(...item.group.items.map((member) => itemTile(remote, member.entityId, target)));
    group.append(head, tiles);
    return group;
  });
  grid.replaceChildren(...(nodes.length === 0 ? [el('p', 'empty', 'This page is empty on the remote.')] : keepBusy(grid, nodes)));
}

function renderBrowse(remote, screen) {
  const body = $('browse-body');
  const tools = $('browse-tools');
  if (screen.kind === 'integrations') {
    $('browse-title').textContent = 'Integrations';
    tools.hidden = true;
    const entry = state.integrations.get(remote.id);
    if (!entry) loadIntegrations(remote);
    if (!entry?.data) {
      $('browse-meta').textContent = entry?.status === 'error' ? '' : 'Loading';
      body.replaceChildren(entry?.status === 'error' ? problemNote(entry.error, () => loadIntegrations(remote)) : el('div', 'intg-list', null));
      if (entry?.status !== 'error') body.firstChild.append(...skeletonTiles(4));
      return;
    }
    const count = entry.data.integrations.length;
    $('browse-meta').textContent = `${count} ${count === 1 ? 'integration' : 'integrations'}`;
    renderIntegrations(body, entry.data);
    return;
  }
  $('browse-title').textContent = 'Entities';
  const listed = state.listed.get(remote.id);
  if (listed === undefined) loadEntityList(remote);
  if (listed !== 'ready') {
    tools.hidden = true;
    $('browse-meta').textContent = listed?.error ? '' : 'Loading';
    body.replaceChildren(listed?.error ? problemNote(listed.error, () => loadEntityList(remote)) : el('div', 'activity-grid is-devices'));
    if (!listed?.error) body.firstChild.append(...skeletonTiles(6));
    return;
  }
  tools.hidden = false;
  const target = controlledTarget(remote);
  const entries = [
    ...remote.activities.map((activity) => ({ id: activity.id, type: 'activity', name: activity.name })),
    ...[...storeOf(remote.id).values()].map(({ entity }) => entity),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const counts = new Map();
  for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  if (state.filter !== 'all' && !counts.has(state.filter)) state.filter = 'all';
  const chip = (type, label, count) => {
    const node = el('button', 'browse-chip');
    node.type = 'button';
    node.dataset.filter = type;
    node.setAttribute('aria-pressed', String(state.filter === type));
    node.append(el('span', null, label), el('span', 'browse-chip-count', String(count)));
    return node;
  };
  const types = [...counts.keys()].sort((a, b) => (TYPE_LABELS[a] ?? a).localeCompare(TYPE_LABELS[b] ?? b));
  $('browse-filters').replaceChildren(chip('all', 'All', entries.length), ...types.map((type) => chip(type, TYPE_LABELS[type] ?? stateLabel(type.toUpperCase()), counts.get(type))));
  const query = state.query.trim().toLowerCase();
  const shown = entries.filter((entry) => (state.filter === 'all' || entry.type === state.filter)
    && (!query || entry.name.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query)));
  $('browse-meta').textContent = shown.length === entries.length ? `${entries.length} entities` : `${shown.length} of ${entries.length}`;
  const grid = el('div', 'activity-grid is-devices');
  if (shown.length === 0) grid.append(el('p', 'empty', 'Nothing matches.'));
  grid.append(...keepBusy(body, shown.map((entry) => {
    if (entry.type !== 'activity') return itemTile(remote, entry.id, target);
    const activity = remote.activities.find((candidate) => candidate.id === entry.id);
    return state.tiles.activity(activity, {
      enabled: remote.online,
      controlled: target?.kind === 'activity' && target.id === activity.id,
      onStart: () => setPower(remote, activity, true),
      onStop: () => setPower(remote, activity, false),
      onControl: () => {
        state.control = { kind: 'activity', id: activity.id };
        setScreen(pagesOf(remote)[0].id);
      },
    });
  })));
  body.replaceChildren(grid);
}

function problemNote(message, retry) {
  const box = el('div', 'browse-problem');
  box.append(el('p', null, message));
  const again = el('button', 'text-button', 'Try again');
  again.type = 'button';
  again.addEventListener('click', retry);
  box.append(again);
  return box;
}

function renderMain(remote) {
  const browse = $('browse');
  const pageViews = [document.querySelector('.status-section'), document.querySelector('.layout'), document.querySelector('.system')];
  if (!remote) {
    browse.hidden = true;
    for (const node of pageViews) node.hidden = false;
    $('activity-grid').replaceChildren();
    return;
  }
  if (remote.online && !state.profiles.has(remote.id)) loadProfile(remote);
  const screen = screenOf(remote);
  const browsing = screen.kind !== 'page';
  browse.hidden = !browsing;
  for (const node of pageViews) node.hidden = browsing;
  if (browsing) {
    if (remote.online) renderBrowse(remote, screen);
    else {
      $('browse-tools').hidden = true;
      $('browse-meta').textContent = '';
      $('browse-body').replaceChildren(el('p', 'empty', `${remote.name ?? remote.address} is offline.`));
    }
    return;
  }
  renderPage(remote, screen.page, controlledTarget(remote));
}

async function loadProfile(remote) {
  const before = state.profiles.get(remote.id);
  if (before?.status === 'loading') return;
  state.profiles.set(remote.id, { ...before, status: 'loading' });
  try {
    const data = await api(`/api/remotes/${encodeURIComponent(remote.id)}/profile`);
    for (const entity of Object.values(data.entities)) rememberEntity(remote.id, entity);
    state.profiles.set(remote.id, { status: 'ready', name: data.profile, pages: data.pages });
  } catch (error) {
    state.profiles.set(remote.id, { status: 'error', error: error.message, pages: before?.pages ?? null });
  }
  if (remote.id === state.remoteId) render();
}

async function loadEntityList(remote) {
  if (state.listed.get(remote.id) === 'loading') return;
  state.listed.set(remote.id, 'loading');
  try {
    const { entities } = await api(`/api/remotes/${encodeURIComponent(remote.id)}/entities`);
    for (const entity of entities) rememberEntity(remote.id, entity);
    state.listed.set(remote.id, 'ready');
  } catch (error) {
    state.listed.set(remote.id, { error: error.message });
  }
  if (remote.id === state.remoteId) render();
}

async function loadIntegrations(remote) {
  const before = state.integrations.get(remote.id);
  if (before?.status === 'loading') return;
  state.integrations.set(remote.id, { ...before, status: 'loading' });
  try {
    const data = await api(`/api/remotes/${encodeURIComponent(remote.id)}/integrations`);
    state.integrations.set(remote.id, { status: 'ready', data });
  } catch (error) {
    state.integrations.set(remote.id, { status: 'error', error: error.message, data: before?.data ?? null });
  }
  if (remote.id === state.remoteId) render();
}

function applyEntity(remoteId, entity) {
  const known = state.store.get(remoteId)?.has(entity.id) ?? false;
  const listed = state.listed.get(remoteId) === 'ready';
  if (known || listed) rememberEntity(remoteId, entity);
  if (state.pagesKey?.startsWith(`${remoteId}\n`)) state.pager.updateEntity(entity);
  if (remoteId !== state.remoteId) return;
  state.player.update(entity);
  state.browser.update(entity);
  if (!known && !listed) return;
  const remote = currentRemote();
  const target = controlledTarget(remote);
  if (!known || entity.missing || (state.control?.kind === 'device' && state.control.id === entity.id)) {
    render();
    return;
  }
  for (const node of document.querySelectorAll(`#activity-grid [data-entity="${CSS.escape(entity.id)}"], #browse-body [data-entity="${CSS.escape(entity.id)}"]`)) {
    if (node.classList.contains('is-busy')) continue;
    node.replaceWith(itemTile(remote, entity.id, target));
  }
}

function applyButtons() {
  for (const key of document.querySelectorAll('#pad [data-button]')) {
    const button = state.buttons?.get(key.dataset.button);
    key.hidden = state.buttons !== null && button === undefined;
    key.disabled = button?.mapped !== true && button?.long !== true;
    key.classList.toggle('has-long', button?.long === true);
    if (button?.fallback) key.title = 'Not set in this activity: sent to the device the D-pad controls';
    else key.title = button?.mapped === false && !button?.long ? 'Not set up for this activity' : '';
    if (button?.long) key.title = `${key.title ? `${key.title}. ` : ''}Hold for its long press`;
  }
}

async function loadButtons(remote, target) {
  const key = `${remote.id}\n${target.id}`;
  if (state.buttonsKey === key) return;
  state.buttonsKey = key;
  state.buttons = null;
  applyButtons();
  try {
    const buttons = await api(`${targetPath(remote, target)}/buttons`);
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

async function loadPages(remote, target, { force = false } = {}) {
  const key = `${remote.id}\n${target.id}`;
  if (state.pagesKey === key && !force) return;
  const fresh = state.pagesKey !== key;
  state.pagesKey = key;
  if (fresh) {
    state.pager.clear();
    closePagerSheets();
    applyView();
  }
  try {
    const data = await api(`${targetPath(remote, target)}/pages`);
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
  const target = controlledTarget(remote);
  if (remote && target && state.pagesKey === `${remote.id}\n${target.id}`) {
    state.buttonsKey = null;
    loadButtons(remote, target);
    loadPages(remote, target, { force: true });
  }
}

function closePagerSheets() {
  if (!state.sheetsFromPager) return;
  state.sheetsFromPager = false;
  state.player.close();
  state.chooser.close();
  state.browser.close();
}

function openPlayer(entityId) {
  const remote = currentRemote();
  const media = mediaEntry(entityId);
  if (!remote?.online || !media) return;
  state.sheetsFromPager = Boolean(state.pager.media(entityId));
  state.player.open(remote.id, media.entity, media.at);
}

async function chooseSource(remoteId, entityId) {
  const entity = mediaEntry(entityId)?.entity;
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
    const entity = mediaEntry(entityId)?.entity;
    if (!entity) return;
    if (state.player.entityId === null) state.sheetsFromPager = Boolean(state.pager.media(entityId));
    state.browser.open(remoteId, entity);
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

async function deviceCommand(entityId, action, value) {
  const remote = currentRemote();
  if (!remote?.online) return;
  flashLogo();
  try {
    await api(`/api/remotes/${encodeURIComponent(remote.id)}/entities/${encodeURIComponent(entityId)}/control`, {
      method: 'POST',
      body: JSON.stringify(value === undefined ? { action } : { action, value }),
    });
  } catch (error) {
    toast(error.message);
    const entity = entityOf(remote.id, entityId);
    if (entity) applyEntity(remote.id, entity);
  }
}

async function pressItem(pageId, index) {
  const remote = currentRemote();
  const target = controlledTarget(remote);
  if (!remote || !target) return;
  flashLogo();
  try {
    await api(`${targetPath(remote, target)}/pages/${encodeURIComponent(pageId)}/items/${index}`, { method: 'POST', body: '{}' });
  } catch (error) {
    toast(error.message);
  }
}

function renderControl(remote) {
  const target = controlledTarget(remote);
  const head = $('control-head');
  const pad = $('pad');
  $('control').classList.toggle('is-active', Boolean(target));
  document.querySelector('.layout').classList.toggle('has-active', Boolean(target));
  if (!target || !remote?.online) {
    pad.hidden = true;
    state.buttonsKey = null;
    state.pagesKey = null;
    state.pager.clear();
    closePagerSheets();
    applyView();
    const message = !remote?.online && remote
      ? `${remote.name ?? remote.address} is offline.`
      : 'Nothing is running. Start an activity to use the controls.';
    head.replaceChildren(el('p', 'empty', message));
    return;
  }
  const title = el('div', 'control-title');
  const badge = target.kind === 'device' ? stateLabel(target.state) : STATE_LABELS[target.state] ?? target.state;
  title.append(el('h3', 'control-name', target.name), el('span', 'badge', badge));
  title.dataset.state = target.state;
  if (target.kind === 'device') {
    const release = el('button', 'control-release');
    release.type = 'button';
    release.setAttribute('aria-label', `Stop controlling ${target.name}`);
    release.title = 'Done';
    release.append(icon('close'));
    release.addEventListener('click', () => {
      state.control = null;
      render();
    });
    title.append(release);
  }
  head.replaceChildren(title);
  pad.hidden = false;
  loadButtons(remote, target);
  loadPages(remote, target);
  state.pager.setEnabled(remote.online);
  applyView();
}

function renderSectionMeta(remote) {
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
  renderRooms(remote);
  renderNav(remote);
  renderMain(remote);
  renderControl(remote);
  renderSystem(remote);
}

async function press(button, { repeat = false, long = false } = {}) {
  const remote = currentRemote();
  const target = controlledTarget(remote);
  if (!remote || !target || state.inflight.has(button)) return;
  state.inflight.add(button);
  flashLogo({ repeat });
  try {
    await api(`${targetPath(remote, target)}/buttons/${encodeURIComponent(button)}`, { method: 'POST', body: long ? '{"long":true}' : '{}' });
  } catch (error) {
    toast(error.message);
  } finally {
    state.inflight.delete(button);
  }
}

function holdFor(button) {
  return createHold({
    onShort: () => (state.buttons?.get(button)?.mapped ? press(button) : toast('Hold this button for its long press.')),
    onLong: () => press(button, { long: true }),
  });
}

const hasLong = (button) => state.buttons?.get(button)?.long === true;

function initPad() {
  const pad = $('pad');
  let delayTimer = null;
  let repeatTimer = null;
  let held = null;
  let keyHeld = null;
  const stopRepeat = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    delayTimer = null;
    repeatTimer = null;
  };
  const cancelHolds = () => {
    held?.cancel();
    keyHeld?.control.cancel();
    held = null;
    keyHeld = null;
  };
  pad.addEventListener('pointerdown', (event) => {
    const pressed = event.target.closest('[data-button]');
    if (!pressed || pressed.disabled) return;
    if (hasLong(pressed.dataset.button)) {
      event.preventDefault();
      stopRepeat();
      held?.cancel();
      held = holdFor(pressed.dataset.button);
      held.down();
      return;
    }
    const key = pressed.hasAttribute('data-repeat') ? pressed : null;
    if (!key) return;
    event.preventDefault();
    press(key.dataset.button);
    stopRepeat();
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => press(key.dataset.button, { repeat: true }), REPEAT_EVERY_MS);
    }, REPEAT_DELAY_MS);
  });
  pad.addEventListener('pointerup', () => {
    stopRepeat();
    held?.up();
    held = null;
  });
  for (const type of ['pointerleave', 'pointercancel']) {
    pad.addEventListener(type, () => {
      stopRepeat();
      held?.cancel();
      held = null;
    });
  }
  window.addEventListener('blur', () => {
    stopRepeat();
    cancelHolds();
  });
  pad.addEventListener('click', (event) => {
    const key = event.target.closest('[data-button]');
    if (!key || key.disabled) return;
    if ((key.hasAttribute('data-repeat') || hasLong(key.dataset.button)) && event.detail !== 0) return;
    if (!state.buttons?.get(key.dataset.button)?.mapped) return;
    press(key.dataset.button);
  });
  document.addEventListener('keyup', (event) => {
    if (keyHeld?.key !== event.key) return;
    keyHeld.control.up();
    keyHeld = null;
  });
  pad.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('keydown', (event) => {
    if (!$('login').hidden || $('pad').hidden || ['player', 'chooser', 'browser'].some((id) => $(id).open)) return;
    if ($('nav').classList.contains('is-open') || !$('browse').hidden) return;
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
    if (hasLong(button)) {
      event.preventDefault();
      if (event.repeat || keyHeld) return;
      keyHeld = { key: event.key, control: holdFor(button) };
      keyHeld.control.down();
      return;
    }
    if (event.repeat && !key.hasAttribute('data-repeat')) return;
    event.preventDefault();
    press(button, { repeat: event.repeat });
  });
}

function initHaptics() {
  const toggle = $('haptics');
  const show = () => {
    toggle.setAttribute('aria-pressed', String(state.haptics));
    $('haptics-state').textContent = state.haptics ? 'On' : 'Off';
  };
  state.haptics = load(STORAGE.haptics) !== 'off';
  show();
  toggle.addEventListener('click', () => {
    state.haptics = !state.haptics;
    save(STORAGE.haptics, state.haptics ? 'on' : 'off');
    show();
    tap(navigator, state.haptics, touchScreen());
  });
}

const navPinned = () => matchMedia(PINNED_NAV).matches;
const touchScreen = () => matchMedia('(any-pointer: coarse)').matches;

function syncNav() {
  const nav = $('nav');
  const pinned = navPinned();
  const open = nav.classList.contains('is-open');
  nav.inert = !pinned && !open;
  $('nav-scrim').hidden = pinned || !open;
  $('menu-button').setAttribute('aria-expanded', String(!pinned && open));
  document.body.classList.toggle('has-nav-open', !pinned && open);
}

function openNav() {
  if (navPinned()) return;
  $('nav').classList.add('is-open');
  syncNav();
  ($('nav').querySelector('[aria-current="page"]') ?? $('nav-close')).focus({ focusVisible: false });
}

function closeNav() {
  const nav = $('nav');
  if (!nav.classList.contains('is-open')) return;
  const hadFocus = nav.contains(document.activeElement);
  nav.classList.remove('is-open');
  syncNav();
  if (hadFocus && !navPinned()) $('menu-button').focus({ focusVisible: false });
}

function initNav() {
  $('menu-button').addEventListener('click', () => ($('nav').classList.contains('is-open') ? closeNav() : openNav()));
  $('nav-close').addEventListener('click', closeNav);
  $('nav-scrim').addEventListener('click', closeNav);
  $('nav').addEventListener('click', (event) => {
    const item = event.target.closest('[data-screen]');
    if (item) setScreen(item.dataset.screen);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('nav').classList.contains('is-open')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeNav();
    }
  });
  matchMedia(PINNED_NAV).addEventListener('change', () => {
    $('nav').classList.remove('is-open');
    syncNav();
  });
  syncNav();
}

function initBrowse() {
  const search = $('browse-search');
  search.addEventListener('input', () => {
    state.query = search.value;
    const remote = currentRemote();
    if (remote) renderBrowse(remote, screenOf(remote));
  });
  $('browse-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    const remote = currentRemote();
    if (remote) renderBrowse(remote, screenOf(remote));
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
  state.tiles = createDeviceTiles({
    onCommand: deviceCommand,
    onPlayer: (entityId, action, value) => {
      const remote = currentRemote();
      if (remote?.online) playerCommand(remote.id, entityId, action, value);
    },
    onOpenPlayer: openPlayer,
    onOpenDevice: (entityId) => focusControl({ kind: 'device', id: entityId }),
    imageUrl: (entityId, version) => imageUrl(state.remoteId, entityId, version),
    choose: (options) => state.chooser.choose(options),
  });
  initLogin();
  initNav();
  initBrowse();
  initViewSwitch();
  initPad();
  initSystem();
  initHaptics();
  initThemePicker();
  setInterval(tickAges, AGE_TICK_MS);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn(`ucweb works without offline start: ${error.message}`));
  }
  await start();
}

async function start(attempt = 0) {
  const banner = $('banner');
  try {
    await loadThemes();
    const session = await api('/api/session');
    banner.hidden = true;
    if (session.authenticated) startApp();
    else showLogin(session.pinConfigured);
  } catch (error) {
    banner.textContent = `Can't reach ucweb (${error.message}). Trying again...`;
    banner.hidden = false;
    setTimeout(() => start(attempt + 1), RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]);
  }
}

boot();
