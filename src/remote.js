import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';

const PAGE_SIZE = 100;
const CHANNELS = ['entity_activity', 'battery_status'];

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
  return { capacity: data.capacity, status: data.status ?? null, powerSupply: data.power_supply ?? null };
}

function isMapped(entry) {
  return Boolean(entry.short_press?.entity_id && entry.short_press?.cmd_id);
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
      name: null,
      model: null,
      firmware: null,
      online: false,
      problem: null,
      battery: null,
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

  async buttons(activityId) {
    const mapping = await this.#mapping(activityId);
    return mapping.map((entry) => ({ button: entry.button, mapped: isMapped(entry) }));
  }

  async press(activityId, button) {
    const activity = this.#requireActivity(activityId);
    const entry = (await this.#mapping(activityId)).find((candidate) => candidate.button === button);
    if (!entry) throw new HttpError(404, `${activity.name} has no ${button} button.`);
    if (!isMapped(entry)) throw new HttpError(409, `${button} does nothing in ${activity.name}.`);
    const { entity_id: entityId, cmd_id: cmdId, params } = entry.short_press;
    const body = params && Object.keys(params).length > 0 ? { cmd_id: cmdId, params } : { cmd_id: cmdId };
    await this.#request('PUT', `/api/entities/${encodeURIComponent(entityId)}/command`, body);
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
      this.#mappings.set(activityId, data?.options?.button_mapping ?? []);
    }
    return this.#mappings.get(activityId);
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
    this.#state.battery = toBattery(battery);
    this.#state.powerMode = power?.mode ?? null;
  }

  async #optional(pathname) {
    try {
      return (await this.#request('GET', pathname)).data;
    } catch (error) {
      if (error.status !== 502) throw error;
      this.emit('warning', error.message);
      return null;
    }
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
    } else if (message.msg === 'entity_change' && !data.entity_id && !data.entity_type) {
      this.#reload();
    } else if (message.msg === 'battery_status') {
      this.#state.battery = toBattery(data);
      this.#emitChange();
    } else if (message.msg === 'power_mode' || message.msg === 'power_mode_change') {
      this.#state.powerMode = data.mode ?? this.#state.powerMode;
      if (data.battery) this.#state.battery = toBattery(data.battery);
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
      this.#mappings.delete(entityId);
    } else if (newState?.name !== undefined) {
      if (newState.enabled === false) activities.delete(entityId);
      else activities.set(entityId, toActivity({ entity_id: entityId, ...newState }));
      this.#mappings.delete(entityId);
    } else if (activities.has(entityId) && newState?.attributes?.state !== undefined) {
      activities.get(entityId).state = newState.attributes.state;
    } else {
      return;
    }
    this.#emitChange();
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
