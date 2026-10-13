import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';

const PAGE_SIZE = 100;
const CHANNELS = [
  'entity_activity', 'entity_media_player', 'entity_sensor', 'entity_select', 'entity_light', 'entity_switch', 'entity_climate',
  'entity_cover', 'entity_button', 'entity_macro', 'entity_remote', 'battery_status', 'profiles', 'integrations',
];
const WIDGET_ENTITY_TYPES = new Set(['media_player', 'sensor', 'select']);
const PROFILE_EVENTS = new Set(['profile_change', 'active_profile_change']);
const INTEGRATION_EVENTS = new Set(['integration_change', 'integration_driver_change']);
const POWER_TYPES = new Set(['light', 'switch']);
const CLIMATE_MODES = [['on_off', 'OFF'], ['heat', 'HEAT'], ['cool', 'COOL'], ['target_temperature_range', 'HEAT_COOL'], ['fan', 'FAN']];
const DEVICE_FEATURES = {
  light: ['on_off', 'toggle', 'dim'],
  switch: ['on_off', 'toggle'],
  climate: ['on_off', 'heat', 'cool', 'current_temperature', 'target_temperature'],
  cover: ['open', 'close', 'stop', 'position'],
  remote: ['on_off', 'toggle'],
};
const TEMPERATURE_UNITS = { CELSIUS: '°C', FAHRENHEIT: '°F' };
const SYSTEM_COMMANDS = new Set(['REBOOT', 'POWER_OFF']);
const ITEM_TYPES = new Set(['text', 'icon', 'media_player', 'sensor', 'select']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REPEAT_MODES = new Set(['OFF', 'ALL', 'ONE']);
const PLAYER_ACTIONS = {
  play_pause: { feature: 'play_pause' },
  stop: { feature: 'stop' },
  previous: { feature: 'previous' },
  next: { feature: 'next' },
  volume_up: { feature: 'volume_up_down' },
  volume_down: { feature: 'volume_up_down' },
  mute_toggle: { feature: 'mute_toggle' },
  seek: { feature: 'seek', param: 'media_position' },
  volume: { feature: 'volume', param: 'volume' },
  shuffle: { feature: 'shuffle', param: 'shuffle' },
  repeat: { feature: 'repeat', param: 'repeat' },
  select_source: { feature: 'select_source', param: 'source' },
  play_media: { feature: 'play_media', param: 'media_id' },
  on: { feature: 'on_off' },
  off: { feature: 'on_off' },
  toggle: { feature: 'toggle' },
};
const PLAYER_FEATURES = [...new Set(Object.values(PLAYER_ACTIONS).map((action) => action.feature)), 'browse_media'];
const BROWSE_PAGE = 30;
const MAX_MEDIA_ID = 255;
const MAX_REMEMBERED = 2000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const mediaKey = (mediaId, mediaType) => `${mediaId}\u0000${mediaType ?? '\u0001'}`;

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function localizedText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return value.en ?? value.en_US ?? Object.values(value).find((text) => typeof text === 'string') ?? null;
}

export function toActivity(entity) {
  return {
    id: entity.entity_id,
    name: localizedText(entity.name) ?? entity.entity_id,
    description: localizedText(entity.description),
    state: entity.attributes?.state ?? null,
  };
}

export function toBattery(data) {
  if (!data || typeof data.capacity !== 'number') return null;
  return { capacity: data.capacity, status: data.status ?? null };
}

const FALLBACKS = {
  BACK: { cmdId: 'media_player.back', features: ['home', 'menu', 'guide', 'info'] },
  HOME: { cmdId: 'media_player.home', features: ['home'] },
  MENU: { cmdId: 'media_player.menu', features: ['menu'] },
  STOP: { cmdId: 'media_player.stop', features: ['stop'] },
  RECORD: { cmdId: 'media_player.record', features: ['record'] },
};

function isMapped(entry) {
  return Boolean(entry.short_press?.entity_id && entry.short_press?.cmd_id);
}

export function resolveButtons(buttonMapping, dpadDevice) {
  const features = new Set(dpadDevice?.entity_type === 'media_player' ? dpadDevice.features ?? [] : []);
  return buttonMapping.map((entry) => {
    if (isMapped(entry)) {
      const { entity_id: entityId, cmd_id: cmdId, params } = entry.short_press;
      return { button: entry.button, command: { entityId, cmdId, params }, fallback: false };
    }
    const fallback = FALLBACKS[entry.button];
    if (fallback && fallback.features.some((feature) => features.has(feature))) {
      return { button: entry.button, command: { entityId: dpadDevice.entity_id, cmdId: fallback.cmdId }, fallback: true };
    }
    return { button: entry.button, command: null, fallback: false };
  });
}

const whole = (value, min) => (Number.isInteger(value) && value >= min ? value : null);

function iconHint(command) {
  const source = command?.params?.source ?? command?.params?.command;
  if (typeof source === 'string') return source.trim() || null;
  return typeof command?.cmd_id === 'string' && command.cmd_id ? command.cmd_id : null;
}

function toItem(item, index) {
  if (!item || !ITEM_TYPES.has(item.type)) return null;
  const x = whole(item.location?.x, 0);
  const y = whole(item.location?.y, 0);
  if (x === null || y === null) return null;
  const entityId = item.media_player_id ?? item.sensor?.sensor_id ?? item.select?.select_id ?? null;
  if (WIDGET_ENTITY_TYPES.has(item.type) && !entityId) return null;
  const text = typeof item.text === 'string' && item.text ? item.text : null;
  const icon = typeof item.icon === 'string' && item.icon ? item.icon : null;
  if (item.type === 'text' && !text) return null;
  if (item.type === 'icon' && !icon) return null;
  const view = {
    index,
    type: item.type,
    x,
    y,
    width: whole(item.size?.width, 1) ?? 1,
    height: whole(item.size?.height, 1) ?? 1,
    text,
    icon: item.type === 'icon' ? icon : null,
    hint: item.type === 'icon' ? iconHint(item.command) : null,
    action: (item.type === 'text' || item.type === 'icon') && Boolean(item.command?.entity_id && item.command?.cmd_id),
    entityId: WIDGET_ENTITY_TYPES.has(item.type) ? entityId : null,
  };
  if (item.type === 'sensor') {
    view.showLabel = item.sensor.show_label === true;
    view.showUnit = item.sensor.show_unit !== false;
  }
  if (item.type === 'select') view.showLabel = item.select.show_name === true;
  return view;
}

export function toPages(ui) {
  const pages = [];
  const commands = new Map();
  const entityIds = new Set();
  for (const page of Array.isArray(ui?.pages) ? ui.pages : []) {
    const width = whole(page?.grid?.width, 1);
    const height = whole(page?.grid?.height, 1);
    if (typeof page?.page_id !== 'string' || !page.page_id || width === null || height === null) continue;
    const items = [];
    (Array.isArray(page.items) ? page.items : []).forEach((raw, index) => {
      const item = toItem(raw, index);
      if (!item) return;
      items.push(item);
      if (item.action) {
        const { entity_id: entityId, cmd_id: cmdId, params } = raw.command;
        commands.set(`${page.page_id}\n${index}`, { entityId, cmdId, params });
      }
      if (item.entityId) entityIds.add(item.entityId);
    });
    pages.push({ id: page.page_id, name: typeof page.name === 'string' && page.name ? page.name : null, grid: { width, height }, items });
  }
  return { pages, commands, entityIds: [...entityIds] };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function deviceCommand(entity, command) {
  if (!command || typeof command.cmd_id !== 'string' || !command.cmd_id || command.entity_id) return command;
  if (/^remote\.[a-z_]+$/.test(command.cmd_id)) return { entity_id: entity.entity_id, cmd_id: command.cmd_id, params: command.params };
  const features = Array.isArray(entity.features) ? entity.features : [];
  const send = features.includes('send') && !features.includes('send_cmd') ? 'remote.send' : 'remote.send_cmd';
  return { entity_id: entity.entity_id, cmd_id: send, params: { ...command.params, command: command.cmd_id } };
}

export function deviceInterface(entity) {
  const pages = Array.isArray(entity?.options?.user_interface?.pages) ? entity.options.user_interface.pages : [];
  return {
    pages: pages.map((page) => ({
      ...page,
      items: (Array.isArray(page?.items) ? page.items : []).map((item) => (item?.command ? { ...item, command: deviceCommand(entity, item.command) } : item)),
    })),
  };
}

export function deviceMapping(entity) {
  const mapping = Array.isArray(entity?.options?.button_mapping) ? entity.options.button_mapping : [];
  return mapping
    .filter((entry) => typeof entry?.button === 'string')
    .map((entry) => (entry.short_press ? { ...entry, short_press: deviceCommand(entity, entry.short_press) } : entry));
}

const text = (value) => (typeof value === 'string' && value ? value : null);

export function toProfilePages(rawPages, rawGroups = []) {
  const groups = new Map((Array.isArray(rawGroups) ? rawGroups : [])
    .filter((group) => typeof group?.group_id === 'string')
    .map((group) => [group.group_id, group]));
  const byPos = (a, b) => (whole(a?.pos, 0) ?? 0) - (whole(b?.pos, 0) ?? 0);
  return (Array.isArray(rawPages) ? rawPages : [])
    .filter((page) => typeof page?.page_id === 'string' && page.page_id)
    .sort(byPos)
    .map((page) => ({
      id: page.page_id,
      name: localizedText(page.name) ?? 'Page',
      items: (Array.isArray(page.items) ? [...page.items] : []).sort(byPos).flatMap((item) => {
        if (typeof item?.entity_id === 'string' && item.entity_id) return [{ entityId: item.entity_id }];
        const group = typeof item?.group_id === 'string' ? groups.get(item.group_id) : null;
        if (!group) return [];
        const entityIds = (Array.isArray(group.entities) ? group.entities : []).filter((id) => typeof id === 'string' && id);
        return [{ group: { id: group.group_id, name: localizedText(group.name) ?? 'Group', entityIds } }];
      }),
    }));
}

const DRIVER_KINDS = { LOCAL: 'Built in', CUSTOM: 'Custom', EXTERNAL: 'External' };
const DEVICE_STATES = new Set(['UNKNOWN', 'CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR']);
const DRIVER_STATES = new Set(['NOT_CONFIGURED', 'IDLE', 'CONNECTING', 'ACTIVE', 'RECONNECTING', 'ERROR']);

function driverFacts(driver) {
  return {
    name: localizedText(driver?.name),
    version: text(driver?.version),
    developer: text(driver?.developer_name),
    kind: DRIVER_KINDS[driver?.driver_type] ?? null,
  };
}

export function toIntegrations(drivers, instances) {
  const driverList = (Array.isArray(drivers) ? drivers : []).filter((driver) => typeof driver?.driver_id === 'string');
  const instanceList = (Array.isArray(instances) ? instances : []).filter((instance) => typeof instance?.integration_id === 'string');
  const byDriver = new Map(driverList.map((driver) => [driver.driver_id, driver]));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const integrations = instanceList.map((instance) => {
    const facts = driverFacts(byDriver.get(instance.driver_id));
    return {
      id: instance.integration_id,
      ...facts,
      name: facts.name ?? localizedText(instance.name) ?? instance.integration_id,
      state: DEVICE_STATES.has(instance.device_state) ? instance.device_state : null,
      enabled: typeof instance.enabled === 'boolean' ? instance.enabled : null,
    };
  }).sort(byName);
  const used = new Set(instanceList.map((instance) => instance.driver_id));
  const idle = driverList.filter((driver) => !used.has(driver.driver_id)).map((driver) => {
    const facts = driverFacts(driver);
    return {
      id: driver.driver_id,
      ...facts,
      name: facts.name ?? driver.driver_id,
      state: DRIVER_STATES.has(driver.driver_state) ? driver.driver_state : null,
      enabled: typeof driver.enabled === 'boolean' ? driver.enabled : null,
    };
  }).sort(byName);
  return { integrations, drivers: idle };
}

const DEVICE_ACTIONS = {
  light: { on: {}, off: {}, toggle: {}, brightness: { features: ['dim'] } },
  switch: { on: {}, off: {}, toggle: {} },
  climate: { on: { features: ['on_off'] }, off: { features: ['on_off'] }, mode: {}, target: { features: ['target_temperature'] } },
  cover: { open: { features: ['open'] }, close: { features: ['close'] }, stop: { features: ['stop'] }, position: { features: ['position'] } },
  button: { push: {} },
  macro: { run: {} },
  remote: { on: { features: ['on_off'] }, off: { features: ['on_off'] }, toggle: { features: ['toggle', 'on_off'] } },
  select: { select_option: {} },
};

function mediaPosition(watched, now) {
  const attributes = watched.attributes;
  const position = finite(attributes.media_position);
  if (position === null) return null;
  if (attributes.state !== 'PLAYING' || watched.positionAt === null) return position;
  const moved = position + (now - watched.positionAt) / 1000;
  const duration = finite(attributes.media_duration);
  return duration !== null && duration > 0 ? Math.min(moved, duration) : moved;
}

const normalText = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export function loadableArt(url) {
  return typeof url === 'string' && /^(https?:\/\/|data:image\/)/i.test(url.trim()) ? url.trim() : null;
}

export function artFor(watched, players) {
  const attributes = watched.attributes ?? {};
  const own = loadableArt(attributes.media_image_url);
  if (own) return own;
  const title = normalText(attributes.media_title);
  if (!title) return null;
  const artist = normalText(attributes.media_artist);
  for (const other of players) {
    if (other === watched || other.entity_type !== 'media_player') continue;
    const theirs = other.attributes ?? {};
    if (normalText(theirs.media_title) !== title || normalText(theirs.media_artist) !== artist) continue;
    const borrowed = loadableArt(theirs.media_image_url);
    if (borrowed) return borrowed;
  }
  return null;
}

export function toEntityView(watched, now = Date.now(), art = loadableArt(watched.attributes?.media_image_url)) {
  const attributes = watched.attributes ?? {};
  const view = {
    id: watched.entity_id,
    type: watched.entity_type,
    name: localizedText(watched.name) ?? watched.entity_id,
    state: attributes.state ?? null,
    deviceClass: watched.device_class ?? null,
    icon: watched.icon?.startsWith('uc:') ? watched.icon : null,
  };
  if (watched.entity_type === 'media_player') {
    const duration = finite(attributes.media_duration);
    Object.assign(view, {
      title: attributes.media_title || null,
      artist: attributes.media_artist || null,
      album: attributes.media_album || null,
      duration: duration !== null && duration > 0 ? duration : null,
      position: mediaPosition(watched, now),
      image: art ? createHash('sha256').update(art).digest('hex').slice(0, 16) : null,
      features: PLAYER_FEATURES.filter((feature) => (watched.features ?? []).includes(feature)),
      volume: finite(attributes.volume),
      muted: typeof attributes.muted === 'boolean' ? attributes.muted : null,
      shuffle: typeof attributes.shuffle === 'boolean' ? attributes.shuffle : null,
      repeat: REPEAT_MODES.has(attributes.repeat) ? attributes.repeat : null,
      source: typeof attributes.source === 'string' && attributes.source ? attributes.source : null,
      sources: (watched.features ?? []).includes('select_source') ? sourceList(attributes) : [],
      playActions: (watched.features ?? []).includes('play_media_action') && Array.isArray(attributes.play_media_action)
        ? attributes.play_media_action.filter((how) => typeof how === 'string')
        : [],
    });
  } else if (watched.entity_type === 'sensor') {
    const unit = attributes.unit ?? watched.options?.custom_unit;
    view.value = attributes.value === undefined || attributes.value === null ? null : String(attributes.value);
    view.unit = typeof unit === 'string' && unit ? unit : null;
  } else if (watched.entity_type === 'select') {
    view.option = typeof attributes.current_option === 'string' && attributes.current_option ? attributes.current_option : null;
    view.options = selectOptions(attributes);
  } else if (Object.hasOwn(DEVICE_FEATURES, watched.entity_type)) {
    Object.assign(view, deviceView(watched, attributes));
  }
  return view;
}

function selectOptions(attributes) {
  return Array.isArray(attributes.options) ? attributes.options.filter((option) => typeof option === 'string' && option) : [];
}

function climateModes(features) {
  return CLIMATE_MODES.filter(([feature]) => features.includes(feature)).map(([, mode]) => mode);
}

function deviceView(watched, attributes) {
  const type = watched.entity_type;
  const features = DEVICE_FEATURES[type].filter((feature) => watched.features.includes(feature));
  if (POWER_TYPES.has(type)) {
    const brightness = finite(attributes.brightness);
    return {
      features: [...new Set(['on_off', 'toggle', ...features])],
      brightness: type === 'light' && brightness !== null ? Math.round((Math.min(255, Math.max(0, brightness)) / 255) * 100) : null,
    };
  }
  if (type === 'climate') {
    const options = watched.options ?? {};
    return {
      features,
      current: finite(attributes.current_temperature),
      target: finite(attributes.target_temperature),
      min: finite(options.min_temperature),
      max: finite(options.max_temperature),
      step: finite(options.target_temperature_step) > 0 ? options.target_temperature_step : null,
      unit: TEMPERATURE_UNITS[options.temperature_unit] ?? null,
      modes: climateModes(watched.features),
    };
  }
  if (type === 'cover') {
    const position = finite(attributes.position);
    return { features, position: position === null ? null : Math.min(100, Math.max(0, Math.round(position))) };
  }
  const ui = watched.options?.user_interface;
  return {
    features,
    controllable: (Array.isArray(ui?.pages) && ui.pages.length > 0) || (Array.isArray(watched.options?.button_mapping) && watched.options.button_mapping.length > 0),
  };
}

function sourceList(attributes) {
  return Array.isArray(attributes.source_list) ? attributes.source_list.filter((source) => typeof source === 'string' && source) : [];
}

function toWatched(entity, now) {
  return {
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    device_class: typeof entity.device_class === 'string' ? entity.device_class : null,
    icon: typeof entity.icon === 'string' ? entity.icon : null,
    name: entity.name,
    options: entity.options ?? null,
    features: Array.isArray(entity.features) ? entity.features.filter((feature) => typeof feature === 'string') : [],
    attributes: { ...entity.attributes },
    positionAt: finite(entity.attributes?.media_position) === null ? null : now,
  };
}

function imageType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return IMAGE_TYPES.has(type) ? type : null;
}

async function readCapped(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(502, 'The image is too large.');
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new HttpError(502, 'The image is too large.');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(504, `The image stopped arriving (${error.cause?.code ?? error.name}).`);
  }
  return Buffer.concat(chunks);
}

export class Remote extends EventEmitter {
  #address;
  #keysDir;
  #timeoutMs;
  #heartbeatMs;
  #powerPollMs;
  #reconnectDelays;
  #attempt = 0;
  #stopped = false;
  #timers = new Set();
  #socket = null;
  #key = null;
  #requestId = 0;
  #mappings = new Map();
  #uis = new Map();
  #watched = new Map();
  #images = new Map();
  #browseMemory = new Map();
  #artKeys = new Map();
  #entityLoad = null;
  #state;

  constructor({
    address,
    keysDir,
    requestTimeoutMs = 8000,
    heartbeatMs = 20000,
    powerPollMs = 60000,
    reconnectDelays = [1000, 2000, 5000, 10000, 30000],
  }) {
    super();
    this.#address = address;
    this.#keysDir = keysDir;
    this.#timeoutMs = requestTimeoutMs;
    this.#heartbeatMs = heartbeatMs;
    this.#powerPollMs = powerPollMs;
    this.#reconnectDelays = reconnectDelays;
    this.#state = {
      id: address,
      address,
      configuratorUrl: `http://${address}/configurator/#/login`,
      name: null,
      model: null,
      firmware: null,
      online: false,
      problem: null,
      battery: null,
      batteryProblem: null,
      powerSupply: null,
      powerMode: null,
      activities: new Map(),
    };
  }

  get id() {
    return this.#state.id;
  }

  snapshot() {
    const { activities, ...rest } = this.#state;
    return {
      ...rest,
      activities: [...activities.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  start() {
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#socket?.terminate();
    this.#socket = null;
  }

  async setActivityPower(activityId, on) {
    this.#requireActivity(activityId);
    await this.#request('PUT', `/api/entities/${encodeURIComponent(activityId)}/command`, {
      cmd_id: on ? 'activity.on' : 'activity.off',
    });
  }

  async systemCommand(cmd) {
    if (!SYSTEM_COMMANDS.has(cmd)) throw new HttpError(400, `Send one of ${[...SYSTEM_COMMANDS].join(', ')}.`);
    await this.#request('POST', `/api/system?cmd=${cmd}`);
  }

  async buttons(targetId, kind = 'activity') {
    const mapping = await this.#mapping(targetId, kind);
    return mapping.map((entry) => ({ button: entry.button, mapped: entry.command !== null, fallback: entry.fallback }));
  }

  async press(targetId, button, kind = 'activity') {
    const target = await this.#target(targetId, kind);
    const entry = (await this.#mapping(targetId, kind)).find((candidate) => candidate.button === button);
    if (!entry) throw new HttpError(404, `${target.name} has no ${button} button.`);
    if (!entry.command) throw new HttpError(409, `${button} does nothing in ${target.name}.`);
    await this.#command(entry.command);
  }

  async pages(targetId, kind = 'activity') {
    const ui = await this.#ui(targetId, kind);
    const now = Date.now();
    const entities = {};
    await Promise.all(ui.entityIds.map(async (entityId) => {
      const entity = await this.#entity(entityId);
      if (entity && WIDGET_ENTITY_TYPES.has(entity.entity_type)) this.#watched.set(entityId, toWatched(entity, now));
      else this.#watched.delete(entityId);
    }));
    for (const entityId of ui.entityIds) {
      const watched = this.#watched.get(entityId);
      if (watched) entities[entityId] = this.#view(watched, now);
    }
    return { pages: ui.pages, entities };
  }

  async pressItem(targetId, pageId, index, kind = 'activity') {
    const target = await this.#target(targetId, kind);
    const ui = await this.#ui(targetId, kind);
    const page = ui.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new HttpError(404, `${target.name} has no page ${pageId}.`);
    const command = ui.commands.get(`${pageId}\n${index}`);
    if (!command) throw new HttpError(409, `That item on ${page.name ?? 'this page'} does nothing.`);
    await this.#command(command);
  }

  async mediaImage(entityId) {
    const watched = this.#watched.get(entityId);
    if (!watched || watched.entity_type !== 'media_player') throw new HttpError(404, 'That player is not on a page that is open.');
    const url = artFor(watched, [...this.#watched.values()]);
    if (!url) throw new HttpError(404, 'Nothing is showing on that player.');
    const cached = this.#images.get(entityId);
    if (cached?.url === url) return cached;
    const image = { url, ...(await this.#loadImage(url)) };
    this.#images.set(entityId, image);
    return image;
  }

  async playerCommand(entityId, action, value) {
    const watched = this.#watched.get(entityId);
    if (!watched || watched.entity_type !== 'media_player') throw new HttpError(404, 'That player is not on a page that is open.');
    const rule = Object.hasOwn(PLAYER_ACTIONS, action) ? PLAYER_ACTIONS[action] : null;
    if (!rule) throw new HttpError(400, `Send one of ${Object.keys(PLAYER_ACTIONS).join(', ')}.`);
    const name = localizedText(watched.name) ?? entityId;
    if (!watched.features.includes(rule.feature)) throw new HttpError(409, `${name} cannot ${action.replace('_', ' ')}.`);
    let params;
    if (action === 'seek') {
      const duration = finite(watched.attributes.media_duration);
      if (finite(value) === null || value < 0 || (duration !== null && duration > 0 && value > duration)) {
        throw new HttpError(400, 'Send a position in seconds within the track.');
      }
      params = { media_position: Math.round(value) };
    } else if (action === 'volume') {
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new HttpError(400, 'Send a volume from 0 to 100.');
      params = { volume: value };
    } else if (action === 'shuffle') {
      if (typeof value !== 'boolean') throw new HttpError(400, 'Send shuffle as true or false.');
      params = { shuffle: value };
    } else if (action === 'repeat') {
      if (!REPEAT_MODES.has(value)) throw new HttpError(400, 'Send repeat as OFF, ALL or ONE.');
      params = { repeat: value };
    } else if (action === 'play_media') {
      const { mediaId, mediaType, action: how } = value ?? {};
      const known = typeof mediaId === 'string' && (mediaType === null || typeof mediaType === 'string')
        && this.#browseMemory.get(entityId)?.playable.has(mediaKey(mediaId, mediaType));
      if (!known) throw new HttpError(400, 'Play something from the player\'s own library list.');
      const actions = Array.isArray(watched.attributes.play_media_action) ? watched.attributes.play_media_action : [];
      if (how !== undefined && !(watched.features.includes('play_media_action') && actions.includes(how))) {
        throw new HttpError(400, `${name} cannot ${String(how).toLowerCase().replace(/_/g, ' ')}.`);
      }
      params = { media_id: mediaId };
      if (mediaType !== null) params.media_type = mediaType;
      if (how !== undefined) params.action = how;
    } else if (action === 'select_source') {
      if (typeof value !== 'string' || !sourceList(watched.attributes).includes(value)) {
        throw new HttpError(400, `${name} has no source called ${JSON.stringify(value)}.`);
      }
      params = { source: value };
    }
    await this.#command({ entityId, cmdId: `media_player.${action}`, params });
  }

  async #loadImage(url) {
    const inline = url.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (inline) {
      const type = imageType(inline[1]);
      if (!type) throw new HttpError(502, 'The artwork is in a format ucweb does not show.');
      const body = Buffer.from(inline[2], 'base64');
      if (body.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'The image is too large.');
      return { type, body };
    }
    if (/^[A-Za-z0-9+/=\s]{64,}$/.test(url)) {
      const body = Buffer.from(url, 'base64');
      const type = body.subarray(0, 4).equals(PNG_MAGIC) ? 'image/png' : body.subarray(0, 3).equals(JPEG_MAGIC) ? 'image/jpeg' : null;
      if (!type) throw new HttpError(502, 'The artwork is in a format ucweb does not show.');
      if (body.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'The image is too large.');
      return { type, body };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(502, 'The artwork address is not valid.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new HttpError(502, 'The artwork address is not a web address.');
    const response = await this.#fetchArtwork(parsed.href);
    if (!response.ok) throw new HttpError(502, `The artwork answered HTTP ${response.status}.`);
    const type = imageType(response.headers.get('content-type'));
    if (!type) throw new HttpError(502, 'The artwork is in a format ucweb does not show.');
    return { type, body: await readCapped(response, MAX_IMAGE_BYTES) };
  }

  async browse(entityId, { mediaId, mediaType, page = 1 } = {}) {
    const watched = this.#browsable(entityId);
    for (const value of [mediaId, mediaType]) {
      if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > MAX_MEDIA_ID)) throw new HttpError(400, 'That is not a media location.');
    }
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new HttpError(400, 'Send a page from 1 to 1000.');
    const query = new URLSearchParams();
    if (typeof mediaId === 'string') query.set('media_id', mediaId);
    if (typeof mediaType === 'string') query.set('media_type', mediaType);
    query.set('page', String(page));
    query.set('limit', String(BROWSE_PAGE));
    const { data, headers } = await this.#request('GET', `/api/entities/${encodeURIComponent(entityId)}/media/browse?${query}`);
    const memory = this.#memory(entityId);
    const media = data?.media ?? {};
    const items = (Array.isArray(media.items) ? media.items : []).map((item) => this.#toBrowseItem(item, memory)).filter(Boolean);
    const total = Number(headers.get('pagination-count'));
    return {
      ...this.#toBrowseItem({ ...media, items: undefined }, memory),
      player: localizedText(watched.name) ?? entityId,
      items,
      page,
      total: Number.isFinite(total) && total >= 0 ? total : null,
      more: items.length > 0 && (Number.isFinite(total) ? page * BROWSE_PAGE < total : items.length === BROWSE_PAGE),
    };
  }

  async thumbnail(entityId, key) {
    const url = this.#browseMemory.get(entityId)?.thumbs.get(key);
    if (!url) throw new HttpError(404, 'That picture is not from a list that is open.');
    return this.#loadImage(url);
  }

  async profilePages() {
    const { data: profiles } = await this.#request('GET', '/api/profiles');
    const list = (Array.isArray(profiles) ? profiles : []).filter((profile) => typeof profile?.profile_id === 'string' && profile.profile_id);
    if (list.length === 0) return { profile: null, pages: [], entities: {} };
    let active = null;
    try {
      active = (await this.#request('GET', '/api/profiles/active')).data;
    } catch (error) {
      if (error.status !== 502) throw error;
    }
    const profile = list.find((candidate) => candidate.profile_id === active?.profile_id) ?? list[0];
    const base = `/api/profiles/${encodeURIComponent(profile.profile_id)}`;
    const { data: rawPages } = await this.#request('GET', `${base}/pages`);
    const grouped = (Array.isArray(rawPages) ? rawPages : []).some((page) => Array.isArray(page?.items) && page.items.some((item) => item?.group_id));
    const groups = grouped ? (await this.#request('GET', `${base}/groups`)).data : [];
    const pages = toProfilePages(rawPages, groups);
    await this.#loadEntities();
    const now = Date.now();
    const entities = {};
    const typed = (entityId) => {
      const watched = this.#watched.get(entityId);
      const type = this.#state.activities.has(entityId) ? 'activity' : watched?.entity_type ?? null;
      if (watched && type !== 'activity') entities[entityId] = this.#view(watched, now);
      return { entityId, type };
    };
    for (const page of pages) {
      page.items = page.items.map((item) => (item.group
        ? { group: { id: item.group.id, name: item.group.name, items: item.group.entityIds.map(typed) } }
        : typed(item.entityId)));
    }
    return { profile: localizedText(profile.name), pages, entities };
  }

  async entities() {
    await this.#loadEntities();
    const now = Date.now();
    const entities = [...this.#watched.values()]
      .filter((watched) => watched.entity_type !== 'activity')
      .map((watched) => this.#view(watched, now))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { entities };
  }

  async integrations() {
    const [drivers, instances] = await Promise.all([this.#pagedList('/api/intg/drivers'), this.#pagedList('/api/intg/instances')]);
    return toIntegrations(drivers, instances);
  }

  async deviceCommand(entityId, action, value) {
    await this.#loadEntities();
    const watched = this.#watched.get(entityId);
    const type = watched?.entity_type;
    if (!watched || type === 'activity' || type === 'media_player') throw new HttpError(404, `${this.#label} has no device ${entityId}.`);
    const name = localizedText(watched.name) ?? entityId;
    const actions = DEVICE_ACTIONS[type];
    if (!actions) throw new HttpError(409, `${name} has nothing to control.`);
    const rule = Object.hasOwn(actions, action) ? actions[action] : null;
    if (!rule) throw new HttpError(400, `Send one of ${Object.keys(actions).join(', ')}.`);
    if (rule.features && !rule.features.some((feature) => watched.features.includes(feature))) {
      throw new HttpError(409, `${name} cannot ${action.replace('_', ' ')}.`);
    }
    let command = { entityId, cmdId: `${type}.${action}` };
    if (action === 'brightness') {
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new HttpError(400, 'Send a brightness from 0 to 100.');
      command = { entityId, cmdId: 'light.on', params: { brightness: Math.round((value / 100) * 255) } };
    } else if (action === 'mode') {
      const modes = climateModes(watched.features);
      if (!modes.includes(value)) throw new HttpError(400, `${name} can be set to ${modes.join(', ') || 'no mode'}.`);
      command = value === 'OFF' ? { entityId, cmdId: 'climate.off' } : { entityId, cmdId: 'climate.hvac_mode', params: { hvac_mode: value } };
    } else if (action === 'target') {
      const view = toEntityView(watched);
      const low = view.min ?? -Infinity;
      const high = view.max ?? Infinity;
      if (finite(value) === null || value < low || value > high) throw new HttpError(400, `Send a temperature from ${view.min ?? 'any'} to ${view.max ?? 'any'}.`);
      command = { entityId, cmdId: 'climate.target_temperature', params: { temperature: value } };
    } else if (action === 'position') {
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new HttpError(400, 'Send a position from 0 to 100.');
      command.params = { position: value };
    } else if (action === 'select_option') {
      if (typeof value !== 'string' || !selectOptions(watched.attributes).includes(value)) {
        throw new HttpError(400, `${name} has no option called ${JSON.stringify(value)}.`);
      }
      command.params = { option: value };
    }
    await this.#command(command);
  }

  #loadEntities() {
    this.#entityLoad ??= (async () => {
      const list = await this.#pagedList('/api/entities');
      const now = Date.now();
      for (const entity of list) {
        if (typeof entity?.entity_id === 'string' && typeof entity.entity_type === 'string') this.#watched.set(entity.entity_id, toWatched(entity, now));
      }
    })().catch((error) => {
      this.#entityLoad = null;
      throw error;
    });
    return this.#entityLoad;
  }

  async #pagedList(pathname) {
    const all = [];
    for (let page = 1; ; page += 1) {
      const { data, headers } = await this.#request('GET', `${pathname}?page=${page}&limit=${PAGE_SIZE}`);
      const batch = Array.isArray(data) ? data : [];
      all.push(...batch);
      const total = Number(headers.get('pagination-count'));
      if (batch.length < PAGE_SIZE || (Number.isFinite(total) && total > 0 && all.length >= total)) return all;
    }
  }

  #browsable(entityId) {
    const watched = this.#watched.get(entityId);
    if (!watched || watched.entity_type !== 'media_player') throw new HttpError(404, 'That player is not on a page that is open.');
    if (!watched.features.includes('browse_media')) throw new HttpError(409, `${localizedText(watched.name) ?? entityId} cannot browse its media.`);
    return watched;
  }

  #memory(entityId) {
    if (!this.#browseMemory.has(entityId)) this.#browseMemory.set(entityId, { playable: new Map(), thumbs: new Map() });
    return this.#browseMemory.get(entityId);
  }

  #toBrowseItem(item, memory) {
    if (!item || typeof item !== 'object') return null;
    const text = (value) => (typeof value === 'string' && value ? value : null);
    const mediaId = typeof item.media_id === 'string' ? item.media_id : null;
    const mediaType = typeof item.media_type === 'string' ? item.media_type : null;
    const canPlay = item.can_play === true && mediaId !== null;
    if (canPlay) remember(memory.playable, mediaKey(mediaId, mediaType), true);
    const thumbnail = text(item.thumbnail);
    let thumb = null;
    let icon = null;
    if (thumbnail?.startsWith('icon://')) {
      icon = thumbnail.slice('icon://'.length);
    } else if (thumbnail) {
      thumb = createHash('sha256').update(thumbnail).digest('hex').slice(0, 20);
      remember(memory.thumbs, thumb, thumbnail);
    }
    return {
      title: text(item.title) ?? mediaId ?? 'Untitled',
      subtitle: text(item.subtitle) ?? ([text(item.artist), text(item.album)].filter(Boolean).join(' · ') || null),
      mediaId,
      mediaType,
      mediaClass: text(item.media_class),
      canBrowse: item.can_browse === true,
      canPlay,
      duration: Number.isInteger(item.duration) && item.duration > 0 ? item.duration : null,
      thumb,
      icon,
    };
  }

  #view(watched, now) {
    const view = toEntityView(watched, now, watched.entity_type === 'media_player' ? artFor(watched, [...this.#watched.values()]) : null);
    if (watched.entity_type === 'media_player') this.#artKeys.set(watched.entity_id, view.image);
    return view;
  }

  async #command({ entityId, cmdId, params }) {
    const body = params && Object.keys(params).length > 0 ? { cmd_id: cmdId, params } : { cmd_id: cmdId };
    await this.#request('PUT', `/api/entities/${encodeURIComponent(entityId)}/command`, body);
  }

  async #ui(targetId, kind) {
    const target = await this.#target(targetId, kind);
    if (!this.#uis.has(targetId)) {
      const data = target.entity
        ? deviceInterface(target.entity)
        : (await this.#request('GET', `/api/activities/${encodeURIComponent(targetId)}/ui`)).data;
      this.#uis.set(targetId, toPages(data));
    }
    return this.#uis.get(targetId);
  }

  async #target(targetId, kind) {
    if (kind !== 'device') return this.#requireActivity(targetId);
    let watched = this.#watched.get(targetId);
    if (!watched) {
      const entity = await this.#entity(targetId);
      if (entity?.entity_type === 'remote') {
        watched = toWatched(entity, Date.now());
        this.#watched.set(targetId, watched);
      }
    }
    if (watched?.entity_type !== 'remote' || !toEntityView(watched).controllable) {
      throw new HttpError(404, `${this.#label} has no device ${targetId} with buttons or pages.`);
    }
    return { name: localizedText(watched.name) ?? targetId, entity: watched };
  }

  #forgetActivity(activityId) {
    this.#mappings.delete(activityId);
    this.#uis.delete(activityId);
    this.emit('pages', activityId);
  }

  #forgetDevice(entityId) {
    if (!this.#uis.has(entityId) && !this.#mappings.has(entityId)) return;
    this.#uis.delete(entityId);
    this.#mappings.delete(entityId);
    this.emit('pages', entityId);
  }

  get #label() {
    return this.#state.name ?? this.#address;
  }

  #requireActivity(activityId) {
    const activity = this.#state.activities.get(activityId);
    if (!activity) throw new HttpError(404, `${this.#label} has no activity ${activityId}.`);
    return activity;
  }

  async #mapping(targetId, kind) {
    const target = await this.#target(targetId, kind);
    if (this.#mappings.has(targetId)) return this.#mappings.get(targetId);
    if (target.entity) {
      this.#mappings.set(targetId, resolveButtons(deviceMapping(target.entity), null));
    } else {
      const { data } = await this.#request('GET', `/api/activities/${encodeURIComponent(targetId)}`);
      const buttonMapping = data?.options?.button_mapping ?? [];
      const dpadEntityId = buttonMapping.find((entry) => entry.button.startsWith('DPAD_') && isMapped(entry))?.short_press.entity_id;
      const needsDevice = buttonMapping.some((entry) => !isMapped(entry) && FALLBACKS[entry.button]);
      const dpadDevice = dpadEntityId && needsDevice ? await this.#entity(dpadEntityId) : null;
      this.#mappings.set(targetId, resolveButtons(buttonMapping, dpadDevice));
    }
    return this.#mappings.get(targetId);
  }

  async #entity(entityId) {
    try {
      return (await this.#request('GET', `/api/entities/${encodeURIComponent(entityId)}`)).data;
    } catch (error) {
      if (error.status !== 502) throw error;
      this.emit('warning', error.message);
      return null;
    }
  }

  #emitChange() {
    this.emit('change', this.snapshot());
  }

  #setOffline(problem) {
    this.#state.online = false;
    this.#state.problem = problem;
    this.#emitChange();
  }

  #later(fn, ms) {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      fn();
    }, ms);
    this.#timers.add(timer);
    return timer;
  }

  #scheduleReconnect() {
    if (this.#stopped) return;
    const delay = this.#reconnectDelays[Math.min(this.#attempt, this.#reconnectDelays.length - 1)];
    this.#attempt += 1;
    this.#later(() => this.#connect(), delay);
  }

  async #connect() {
    if (this.#stopped) return;
    try {
      const { data: version } = await this.#request('GET', '/api/pub/version', undefined, false);
      const hostname = String(version.hostname ?? '').replace(/\.local$/, '');
      if (!hostname) throw new HttpError(502, `${this.#address} did not report a host name.`);
      this.#state.name = version.device_name ?? hostname;
      this.#state.model = version.model ?? null;
      this.#state.firmware = { core: version.core ?? null, ui: version.ui ?? null, os: version.os ?? null };
      this.#key = await this.#readKey(hostname);
      await this.#openSocket();
      await this.#loadAll();
      this.#attempt = 0;
      this.#state.online = true;
      this.#state.problem = null;
      this.#emitChange();
    } catch (error) {
      this.#socket?.terminate();
      this.#socket = null;
      if (this.#stopped) return;
      this.#setOffline(error.message);
      this.#scheduleReconnect();
    }
  }

  async #readKey(hostname) {
    const file = path.join(this.#keysDir, `${hostname}.key`);
    let key;
    try {
      key = (await readFile(file, 'utf8')).trim();
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new HttpError(503, `No API key for ${this.#label}: expected ${file}. Create one with scripts/create-api-key.sh.`);
      }
      throw new HttpError(503, `Cannot read the API key ${file}: ${error.code ?? error.message}.`);
    }
    if (!key) throw new HttpError(503, `The API key file ${file} is empty.`);
    return key;
  }

  async #loadAll() {
    const activities = new Map();
    for (let page = 1; ; page += 1) {
      const { data, headers } = await this.#request('GET', `/api/activities?page=${page}&limit=${PAGE_SIZE}`);
      const batch = Array.isArray(data) ? data : [];
      for (const entity of batch) {
        if (entity.enabled !== false) activities.set(entity.entity_id, toActivity(entity));
      }
      const total = Number(headers.get('pagination-count'));
      const seen = (page - 1) * PAGE_SIZE + batch.length;
      if (batch.length < PAGE_SIZE || (Number.isFinite(total) && total > 0 && seen >= total)) break;
    }
    const [battery, power] = await Promise.all([
      this.#optional('/api/system/power/battery'),
      this.#optional('/api/system/power'),
    ]);
    this.#state.activities = activities;
    this.#mappings.clear();
    this.#uis.clear();
    this.#entityLoad = null;
    this.#state.battery = toBattery(battery.data);
    this.#state.batteryProblem = battery.problem;
    this.#state.powerSupply = power.data?.power_supply ?? battery.data?.power_supply ?? null;
    this.#state.powerMode = power.data?.mode ?? null;
  }

  async #optional(pathname) {
    try {
      return { data: (await this.#request('GET', pathname)).data, problem: null };
    } catch (error) {
      if (error.status !== 502) throw error;
      this.emit('warning', error.message);
      return { data: null, problem: error.message };
    }
  }

  #applyBattery(data) {
    const battery = toBattery(data);
    if (battery) {
      this.#state.battery = battery;
      this.#state.batteryProblem = null;
    }
    if (typeof data?.power_supply === 'boolean') this.#state.powerSupply = data.power_supply;
  }

  #openSocket() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${this.#address}/ws`, {
        headers: { 'API-KEY': this.#key },
        handshakeTimeout: this.#timeoutMs,
      });
      this.#socket = socket;
      let authenticated = false;
      let alive = true;
      let heartbeat = null;
      let powerPoll = null;

      const fail = (message) => {
        if (!authenticated) reject(new HttpError(502, message));
      };

      socket.on('unexpected-response', (_request, response) => {
        const hint = response.statusCode === 401 ? ' The API key was rejected; create a new one with scripts/create-api-key.sh --replace.' : '';
        fail(`${this.#label} refused the live connection: HTTP ${response.statusCode}.${hint}`);
        socket.terminate();
      });
      socket.on('error', (error) => fail(`${this.#label} live connection failed: ${error.code ?? error.message}.`));
      socket.on('pong', () => {
        alive = true;
      });
      socket.on('close', () => {
        clearInterval(heartbeat);
        clearInterval(powerPoll);
        fail(`${this.#label} closed the live connection before it was ready.`);
        if (authenticated && this.#socket === socket && !this.#stopped) {
          this.#socket = null;
          this.#setOffline(`Lost the live connection to ${this.#label}.`);
          this.#scheduleReconnect();
        }
      });
      socket.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!authenticated && message.kind === 'resp' && message.msg === 'authentication') {
          if (message.code !== 200) {
            fail(`${this.#label} rejected the API key (code ${message.code}). Create a new one with scripts/create-api-key.sh --replace.`);
            socket.terminate();
            return;
          }
          authenticated = true;
          this.#send(socket, 'subscribe_events', { channels: CHANNELS });
          this.#send(socket, 'get_power_mode');
          heartbeat = setInterval(() => {
            if (!alive) {
              socket.terminate();
              return;
            }
            alive = false;
            socket.ping();
          }, this.#heartbeatMs);
          powerPoll = setInterval(() => this.#send(socket, 'get_power_mode'), this.#powerPollMs);
          resolve();
          return;
        }
        this.#handleMessage(message);
      });
    });
  }

  #send(socket, msg, msgData) {
    if (socket.readyState !== WebSocket.OPEN) return;
    this.#requestId += 1;
    const message = { kind: 'req', id: this.#requestId, msg };
    if (msgData !== undefined) message.msg_data = msgData;
    socket.send(JSON.stringify(message));
  }

  #handleMessage(message) {
    const data = message.msg_data ?? {};
    if (message.msg === 'entity_change' && data.entity_type === 'activity') {
      this.#applyActivityChange(data);
    } else if (message.msg === 'entity_change' && data.entity_id && data.entity_type) {
      this.#applyWidgetChange(data);
    } else if (PROFILE_EVENTS.has(message.msg)) {
      this.emit('profile');
    } else if (INTEGRATION_EVENTS.has(message.msg)) {
      this.emit('integrations');
    } else if (message.msg === 'entity_change' && !data.entity_id && !data.entity_type) {
      this.#reload();
    } else if (message.msg === 'battery_status') {
      this.#applyBattery(data);
      this.#emitChange();
    } else if (message.msg === 'power_mode' || message.msg === 'power_mode_change') {
      this.#state.powerMode = data.mode ?? this.#state.powerMode;
      if (typeof data.power_supply === 'boolean') this.#state.powerSupply = data.power_supply;
      if (data.battery) this.#applyBattery(data.battery);
      this.#emitChange();
      if (data.wakeup) this.#reload();
    }
  }

  #applyActivityChange({ event_type: eventType, entity_id: entityId, new_state: newState }) {
    const { activities } = this.#state;
    if (!entityId) {
      this.#reload();
      return;
    }
    if (eventType === 'DELETE') {
      activities.delete(entityId);
      this.#forgetActivity(entityId);
    } else if (newState?.name !== undefined) {
      if (newState.enabled === false) activities.delete(entityId);
      else activities.set(entityId, toActivity({ entity_id: entityId, ...newState }));
      this.#forgetActivity(entityId);
    } else if (activities.has(entityId) && newState?.attributes?.state !== undefined) {
      activities.get(entityId).state = newState.attributes.state;
    } else {
      return;
    }
    this.#emitChange();
  }

  async #addListed(entityId) {
    const entity = await this.#entity(entityId).catch(() => null);
    if (!entity?.entity_type || entity.entity_type === 'activity' || this.#watched.has(entityId)) return;
    const watched = toWatched(entity, Date.now());
    this.#watched.set(entityId, watched);
    this.emit('entity', this.#view(watched, Date.now()));
  }

  #applyWidgetChange({ event_type: eventType, entity_id: entityId, new_state: newState }) {
    const watched = this.#watched.get(entityId);
    if (!watched) {
      if (eventType !== 'DELETE' && this.#entityLoad) this.#entityLoad.then(() => this.#addListed(entityId), () => {});
      return;
    }
    if (eventType === 'DELETE') {
      this.#watched.delete(entityId);
      this.#images.delete(entityId);
      this.#forgetDevice(entityId);
      this.emit('entity', { id: entityId, type: watched.entity_type, missing: true });
      return;
    }
    const now = Date.now();
    const attributes = newState?.attributes ?? {};
    const before = mediaPosition(watched, now);
    if (newState?.name !== undefined) watched.name = newState.name;
    if (Array.isArray(newState?.features)) watched.features = newState.features.filter((feature) => typeof feature === 'string');
    if (newState?.options !== undefined) {
      watched.options = newState.options;
      this.#forgetDevice(entityId);
    }
    Object.assign(watched.attributes, attributes);
    if (finite(attributes.media_position) !== null) watched.positionAt = now;
    else if (attributes.state !== undefined && before !== null) {
      watched.attributes.media_position = before;
      watched.positionAt = now;
    }
    this.emit('entity', this.#view(watched, now));
    if (watched.entity_type !== 'media_player') return;
    for (const other of this.#watched.values()) {
      if (other === watched || other.entity_type !== 'media_player' || loadableArt(other.attributes.media_image_url)) continue;
      const previous = this.#artKeys.get(other.entity_id);
      const view = this.#view(other, now);
      if (view.image !== previous) this.emit('entity', view);
    }
  }

  async #reload() {
    try {
      await this.#loadAll();
      this.#emitChange();
    } catch (error) {
      this.#socket?.terminate();
      this.emit('warning', `Reloading ${this.#label} failed: ${error.message}`);
    }
  }

  async #fetchArtwork(url) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (error) {
      throw new HttpError(504, `The artwork server did not answer (${error.cause?.code ?? error.name}).`);
    }
  }

  async #request(method, pathname, body, authenticated = true) {
    const headers = { accept: 'application/json' };
    if (authenticated) {
      if (!this.#key) throw new HttpError(503, `${this.#label} is not connected yet.`);
      headers.authorization = `Bearer ${this.#key}`;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetch(`http://${this.#address}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new HttpError(504, `${this.#label} did not answer (${error.cause?.code ?? error.name}).`);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const detail = data?.message ? `: ${data.message}` : '';
      throw new HttpError(502, `${this.#label} answered HTTP ${response.status} to ${method} ${pathname.split('?')[0]}${detail}`);
    }
    return { data, headers: response.headers };
  }
}
