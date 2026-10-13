import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';

const PAGE_SIZE = 100;
const CHANNELS = ['entity_activity', 'entity_media_player', 'entity_sensor', 'entity_select', 'battery_status'];
const WIDGET_ENTITY_TYPES = new Set(['media_player', 'sensor', 'select']);
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
};
const PLAYER_FEATURES = [...new Set(Object.values(PLAYER_ACTIONS).map((action) => action.feature))];

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
  const source = command?.params?.source;
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

function mediaPosition(watched, now) {
  const attributes = watched.attributes;
  const position = finite(attributes.media_position);
  if (position === null) return null;
  if (attributes.state !== 'PLAYING' || watched.positionAt === null) return position;
  const moved = position + (now - watched.positionAt) / 1000;
  const duration = finite(attributes.media_duration);
  return duration !== null && duration > 0 ? Math.min(moved, duration) : moved;
}

export function toEntityView(watched, now = Date.now()) {
  const attributes = watched.attributes ?? {};
  const view = {
    id: watched.entity_id,
    type: watched.entity_type,
    name: localizedText(watched.name) ?? watched.entity_id,
    state: attributes.state ?? null,
  };
  if (watched.entity_type === 'media_player') {
    const duration = finite(attributes.media_duration);
    const image = typeof attributes.media_image_url === 'string' && attributes.media_image_url ? attributes.media_image_url : null;
    Object.assign(view, {
      title: attributes.media_title || null,
      artist: attributes.media_artist || null,
      album: attributes.media_album || null,
      duration: duration !== null && duration > 0 ? duration : null,
      position: mediaPosition(watched, now),
      image: image ? createHash('sha256').update(image).digest('hex').slice(0, 16) : null,
      features: PLAYER_FEATURES.filter((feature) => (watched.features ?? []).includes(feature)),
      volume: finite(attributes.volume),
      muted: typeof attributes.muted === 'boolean' ? attributes.muted : null,
      shuffle: typeof attributes.shuffle === 'boolean' ? attributes.shuffle : null,
      repeat: REPEAT_MODES.has(attributes.repeat) ? attributes.repeat : null,
    });
  } else if (watched.entity_type === 'sensor') {
    const unit = attributes.unit ?? watched.options?.custom_unit;
    view.value = attributes.value === undefined || attributes.value === null ? null : String(attributes.value);
    view.unit = typeof unit === 'string' && unit ? unit : null;
  } else if (watched.entity_type === 'select') {
    view.option = typeof attributes.current_option === 'string' && attributes.current_option ? attributes.current_option : null;
  }
  return view;
}

function toWatched(entity, now) {
  return {
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
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

  async buttons(activityId) {
    const mapping = await this.#mapping(activityId);
    return mapping.map((entry) => ({ button: entry.button, mapped: entry.command !== null, fallback: entry.fallback }));
  }

  async press(activityId, button) {
    const activity = this.#requireActivity(activityId);
    const entry = (await this.#mapping(activityId)).find((candidate) => candidate.button === button);
    if (!entry) throw new HttpError(404, `${activity.name} has no ${button} button.`);
    if (!entry.command) throw new HttpError(409, `${button} does nothing in ${activity.name}.`);
    await this.#command(entry.command);
  }

  async pages(activityId) {
    const ui = await this.#ui(activityId);
    const now = Date.now();
    const entities = {};
    await Promise.all(ui.entityIds.map(async (entityId) => {
      const entity = await this.#entity(entityId);
      if (entity && WIDGET_ENTITY_TYPES.has(entity.entity_type)) {
        this.#watched.set(entityId, toWatched(entity, now));
        entities[entityId] = toEntityView(this.#watched.get(entityId), now);
      } else {
        this.#watched.delete(entityId);
      }
    }));
    return { pages: ui.pages, entities };
  }

  async pressItem(activityId, pageId, index) {
    const activity = this.#requireActivity(activityId);
    const ui = await this.#ui(activityId);
    const page = ui.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new HttpError(404, `${activity.name} has no page ${pageId}.`);
    const command = ui.commands.get(`${pageId}\n${index}`);
    if (!command) throw new HttpError(409, `That item on ${page.name ?? 'this page'} does nothing.`);
    await this.#command(command);
  }

  async mediaImage(entityId) {
    const watched = this.#watched.get(entityId);
    if (!watched || watched.entity_type !== 'media_player') throw new HttpError(404, 'That player is not on a page that is open.');
    const url = watched.attributes.media_image_url;
    if (typeof url !== 'string' || !url) throw new HttpError(404, 'Nothing is showing on that player.');
    const cached = this.#images.get(entityId);
    if (cached?.url === url) return cached;
    let image;
    const inline = url.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (inline) {
      const type = imageType(inline[1]);
      if (!type) throw new HttpError(502, 'The player\'s artwork is in a format ucweb does not show.');
      image = { url, type, body: Buffer.from(inline[2], 'base64') };
    } else {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new HttpError(502, 'The player\'s artwork address is not valid.');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new HttpError(502, 'The player\'s artwork address is not a web address.');
      const response = await this.#fetchArtwork(parsed.href);
      if (!response.ok) throw new HttpError(502, `The player's artwork answered HTTP ${response.status}.`);
      const type = imageType(response.headers.get('content-type'));
      if (!type) throw new HttpError(502, 'The player\'s artwork is in a format ucweb does not show.');
      image = { url, type, body: await readCapped(response, MAX_IMAGE_BYTES) };
    }
    if (image.body.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'The image is too large.');
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
    }
    await this.#command({ entityId, cmdId: `media_player.${action}`, params });
  }

  async #command({ entityId, cmdId, params }) {
    const body = params && Object.keys(params).length > 0 ? { cmd_id: cmdId, params } : { cmd_id: cmdId };
    await this.#request('PUT', `/api/entities/${encodeURIComponent(entityId)}/command`, body);
  }

  async #ui(activityId) {
    this.#requireActivity(activityId);
    if (!this.#uis.has(activityId)) {
      const { data } = await this.#request('GET', `/api/activities/${encodeURIComponent(activityId)}/ui`);
      this.#uis.set(activityId, toPages(data));
    }
    return this.#uis.get(activityId);
  }

  #forgetActivity(activityId) {
    this.#mappings.delete(activityId);
    this.#uis.delete(activityId);
    this.emit('pages', activityId);
  }

  get #label() {
    return this.#state.name ?? this.#address;
  }

  #requireActivity(activityId) {
    const activity = this.#state.activities.get(activityId);
    if (!activity) throw new HttpError(404, `${this.#label} has no activity ${activityId}.`);
    return activity;
  }

  async #mapping(activityId) {
    this.#requireActivity(activityId);
    if (!this.#mappings.has(activityId)) {
      const { data } = await this.#request('GET', `/api/activities/${encodeURIComponent(activityId)}`);
      const buttonMapping = data?.options?.button_mapping ?? [];
      const dpadEntityId = buttonMapping.find((entry) => entry.button.startsWith('DPAD_') && isMapped(entry))?.short_press.entity_id;
      const needsDevice = buttonMapping.some((entry) => !isMapped(entry) && FALLBACKS[entry.button]);
      const dpadDevice = dpadEntityId && needsDevice ? await this.#entity(dpadEntityId) : null;
      this.#mappings.set(activityId, resolveButtons(buttonMapping, dpadDevice));
    }
    return this.#mappings.get(activityId);
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
    } else if (message.msg === 'entity_change' && data.entity_id && WIDGET_ENTITY_TYPES.has(data.entity_type)) {
      this.#applyWidgetChange(data);
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

  #applyWidgetChange({ event_type: eventType, entity_id: entityId, new_state: newState }) {
    const watched = this.#watched.get(entityId);
    if (!watched) return;
    if (eventType === 'DELETE') {
      this.#watched.delete(entityId);
      this.#images.delete(entityId);
      this.emit('entity', { id: entityId, type: watched.entity_type, missing: true });
      return;
    }
    const now = Date.now();
    const attributes = newState?.attributes ?? {};
    const before = mediaPosition(watched, now);
    if (newState?.name !== undefined) watched.name = newState.name;
    if (newState?.options !== undefined) watched.options = newState.options;
    Object.assign(watched.attributes, attributes);
    if (finite(attributes.media_position) !== null) watched.positionAt = now;
    else if (attributes.state !== undefined && before !== null) {
      watched.attributes.media_position = before;
      watched.positionAt = now;
    }
    this.emit('entity', toEntityView(watched, now));
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
