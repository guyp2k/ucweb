import { ICONS, UC_NAMES } from './icons.js';
import { readinessText } from './readiness.js';

const SVG = 'http://www.w3.org/2000/svg';
const TARGET_DELAY_MS = 600;

export const TYPE_LABELS = {
  activity: 'Activity', media_player: 'Media player', light: 'Light', switch: 'Switch', climate: 'Climate', cover: 'Cover',
  sensor: 'Sensor', select: 'Select', button: 'Button', macro: 'Macro', remote: 'Remote', voice_assistant: 'Voice assistant',
  ir_emitter: 'IR emitter',
};

export const TYPE_ICONS = {
  activity: 'apps', media_player: 'music', light: 'lightbulb', switch: 'plug', climate: 'thermometer', cover: 'blinds',
  sensor: 'gauge', select: 'list', button: 'button', macro: 'zap', remote: 'remote', voice_assistant: 'mic', ir_emitter: 'remote',
};

const CLASS_ICONS = {
  temperature: 'thermometer', humidity: 'droplet', tv: 'tv', speaker: 'speaker', receiver: 'speaker', streaming_box: 'streamer',
  set_top_box: 'streamer', outlet: 'plug', blind: 'blinds', curtain: 'blinds', shade: 'blinds', garage: 'blinds',
};

const STATE_LABELS = {
  ON: 'On', OFF: 'Off', UNAVAILABLE: 'Unavailable', UNKNOWN: 'Unknown', PLAYING: 'Playing', PAUSED: 'Paused', BUFFERING: 'Buffering',
  STANDBY: 'Standby', OPEN: 'Open', CLOSED: 'Closed', OPENING: 'Opening', CLOSING: 'Closing', HEAT: 'Heating', COOL: 'Cooling',
  HEAT_COOL: 'Heat and cool', FAN: 'Fan only', AUTO: 'Auto', AVAILABLE: 'Ready', RUNNING: 'Running', COMPLETED: 'Done', ERROR: 'Error',
};

const MODE_LABELS = { OFF: 'Off', HEAT: 'Heat', COOL: 'Cool', HEAT_COOL: 'Heat and cool', FAN: 'Fan only', AUTO: 'Auto' };
const MODE_ICONS = { OFF: 'power', HEAT: 'flame', COOL: 'snowflake', HEAT_COOL: 'thermometer', FAN: 'fan', AUTO: 'thermometer' };
const PASSIVE_TYPES = new Set(['sensor', 'select', 'button', 'macro', 'voice_assistant']);
const ACTIVE_STATES = new Set(['ON', 'PLAYING', 'PAUSED', 'BUFFERING', 'OPEN', 'OPENING', 'CLOSING', 'HEAT', 'COOL', 'HEAT_COOL', 'FAN', 'AUTO']);

export const stateLabel = (value) => STATE_LABELS[value] ?? (value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ') : 'Unknown');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function icon(key, className) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const d of ICONS[key] ?? ICONS.layers) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function iconFor(entity) {
  const named = entity.icon ? UC_NAMES[entity.icon.slice(3).toLowerCase()] : null;
  return CLASS_ICONS[entity.deviceClass] ?? named ?? TYPE_ICONS[entity.type] ?? 'layers';
}

function degrees(value, unit) {
  if (value === null || value === undefined) return 'n/a';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit ?? '°'}`;
}

function button(className, label, key, text) {
  const node = el('button', className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  if (key) node.append(icon(key));
  if (text) node.append(el('span', null, text));
  return node;
}

function powerSwitch(entity, enabled, onCommand) {
  const on = entity.state === 'ON';
  const node = el('button', 'dev-switch');
  node.type = 'button';
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-checked', String(on));
  node.setAttribute('aria-label', `${entity.name} ${on ? 'on' : 'off'}`);
  node.disabled = !enabled || entity.state === 'UNAVAILABLE';
  node.append(el('span', 'dev-switch-thumb'));
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    const action = entity.features?.includes('toggle') ? 'toggle' : on ? 'off' : 'on';
    node.setAttribute('aria-checked', String(!on));
    onCommand(entity.id, action);
  });
  return node;
}

function subline(entity) {
  if (entity.type === 'sensor') return entity.deviceClass ? stateLabel(entity.deviceClass.toUpperCase()) : TYPE_LABELS.sensor;
  if (entity.type === 'light' && entity.state === 'ON' && entity.brightness !== null) return `On, ${entity.brightness}%`;
  if (entity.type === 'cover' && entity.position !== null && entity.position !== undefined && entity.state !== 'CLOSED') {
    return entity.state === 'OPEN' ? `${entity.position}% open` : `${stateLabel(entity.state)}, ${entity.position}%`;
  }
  if (entity.type === 'select') return entity.option ?? stateLabel(entity.state);
  if (entity.type === 'media_player' && entity.title) return [entity.title, entity.artist].filter(Boolean).join(' · ');
  if (entity.type === 'button' || entity.type === 'macro') return TYPE_LABELS[entity.type];
  return stateLabel(entity.state);
}

export function createDeviceTiles({ onCommand, onPlayer, onOpenPlayer, onOpenDevice, imageUrl, choose, readiness }) {
  const pendingTargets = new Map();

  function slider(entity, { label, value, enabled, onCommit }) {
    const wrap = el('label', 'dev-range');
    const input = el('input', 'dev-range-input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(value ?? 0);
    input.disabled = !enabled;
    input.setAttribute('aria-label', `${label}, ${entity.name}`);
    const readout = el('span', 'dev-range-value', `${value ?? 0}%`);
    const paint = () => {
      input.style.setProperty('--fill', `${input.value}%`);
      readout.textContent = `${input.value}%`;
    };
    paint();
    input.addEventListener('input', paint);
    input.addEventListener('pointerdown', () => wrap.closest('.dev-tile')?.classList.add('is-busy'));
    input.addEventListener('change', () => {
      wrap.closest('.dev-tile')?.classList.remove('is-busy');
      onCommit(Number(input.value));
    });
    input.addEventListener('click', (event) => event.stopPropagation());
    wrap.append(icon(label === 'Brightness' ? 'sun' : 'blinds', 'dev-range-icon'), input, readout);
    return wrap;
  }

  function climateBody(entity, enabled) {
    const body = el('div', 'dev-climate');
    const now = el('div', 'dev-reading');
    now.append(el('span', 'dev-reading-value', degrees(entity.current, entity.unit)), el('span', 'dev-reading-label', 'Now'));
    body.append(now);
    if (entity.features.includes('target_temperature')) {
      const step = entity.step ?? (entity.unit === '°C' ? 0.5 : 1);
      const stepper = el('div', 'dev-stepper');
      const target = () => pendingTargets.get(entity.id)?.value ?? entity.target;
      const value = el('span', 'dev-stepper-value', degrees(target(), entity.unit));
      const nudge = (direction) => {
        const base = target() ?? entity.current ?? entity.min ?? 0;
        let next = Math.round((base + direction * step) * 10) / 10;
        if (entity.min !== null) next = Math.max(entity.min, next);
        if (entity.max !== null) next = Math.min(entity.max, next);
        const pending = pendingTargets.get(entity.id);
        clearTimeout(pending?.timer);
        const timer = setTimeout(() => {
          pendingTargets.delete(entity.id);
          onCommand(entity.id, 'target', next);
        }, TARGET_DELAY_MS);
        pendingTargets.set(entity.id, { value: next, timer });
        value.textContent = degrees(next, entity.unit);
      };
      const down = button('dev-step', `Lower the target, ${entity.name}`, 'minus');
      const up = button('dev-step', `Raise the target, ${entity.name}`, 'plus');
      down.disabled = !enabled;
      up.disabled = !enabled;
      down.addEventListener('click', () => nudge(-1));
      up.addEventListener('click', () => nudge(1));
      const wrap = el('div', 'dev-target');
      stepper.append(down, value, up);
      wrap.append(stepper, el('span', 'dev-reading-label', 'Target'));
      body.append(wrap);
    }
    if (entity.modes.length > 0) {
      const mode = button('dev-mode', `Mode: ${MODE_LABELS[entity.state] ?? stateLabel(entity.state)}`, MODE_ICONS[entity.state] ?? 'thermometer', MODE_LABELS[entity.state] ?? stateLabel(entity.state));
      mode.disabled = !enabled;
      mode.addEventListener('click', async () => {
        const labels = entity.modes.map((option) => MODE_LABELS[option] ?? option);
        const chosen = await choose({ heading: 'Mode', detail: entity.name, options: labels, current: MODE_LABELS[entity.state] ?? null });
        const picked = entity.modes[labels.indexOf(chosen)];
        if (picked && picked !== entity.state) onCommand(entity.id, 'mode', picked);
      });
      body.append(mode);
    }
    return body;
  }

  function mediaHead(entity, live) {
    const enabled = live && entity.state !== 'UNAVAILABLE';
    const art = el('span', 'dev-art');
    const showArt = entity.image && entity.state !== 'OFF' && entity.state !== 'UNAVAILABLE';
    if (showArt) {
      const image = el('img');
      image.alt = '';
      image.decoding = 'async';
      image.src = imageUrl(entity.id, entity.image);
      image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
      image.addEventListener('error', () => image.replaceWith(icon(iconFor(entity))), { once: true });
      art.append(image);
    } else {
      art.append(icon(iconFor(entity)));
    }
    const actions = el('div', 'dev-actions');
    if (entity.features.includes('on_off')) {
      const on = entity.state !== 'OFF' && entity.state !== 'STANDBY' && entity.state !== 'UNAVAILABLE';
      const power = button(`dev-round is-power${on ? ' is-on' : ''}`, `Turn ${entity.name} ${on ? 'off' : 'on'}`, 'power');
      power.disabled = !enabled;
      power.addEventListener('click', (event) => {
        event.stopPropagation();
        onPlayer(entity.id, on ? 'off' : 'on');
      });
      actions.append(power);
    }
    if (entity.features.includes('previous') && entity.state !== 'OFF') {
      const previous = button('dev-round', `Previous on ${entity.name}`, 'previous');
      previous.disabled = !enabled;
      previous.addEventListener('click', (event) => {
        event.stopPropagation();
        onPlayer(entity.id, 'previous');
      });
      actions.append(previous);
    }
    if (entity.features.includes('play_pause') && entity.state !== 'OFF') {
      const playing = entity.state === 'PLAYING';
      const play = button('dev-round is-primary', playing ? `Pause ${entity.name}` : `Play ${entity.name}`, playing ? 'pause' : 'play');
      play.disabled = !enabled;
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        onPlayer(entity.id, 'play_pause');
      });
      actions.append(play);
    }
    if (entity.features.includes('next') && entity.state !== 'OFF') {
      const next = button('dev-round', `Next on ${entity.name}`, 'next');
      next.disabled = !enabled;
      next.addEventListener('click', (event) => {
        event.stopPropagation();
        onPlayer(entity.id, 'next');
      });
      actions.append(next);
    }
    return { art, actions };
  }

  function coverButtons(entity, enabled) {
    const body = el('div', 'dev-actions');
    for (const [action, label, key] of [['open', 'Open', 'angle-up'], ['stop', 'Stop', 'stop'], ['close', 'Close', 'angle-down']]) {
      if (!entity.features.includes(action)) continue;
      const node = button('dev-round', `${label} ${entity.name}`, key);
      node.disabled = !enabled;
      node.addEventListener('click', () => onCommand(entity.id, action));
      body.append(node);
    }
    return body;
  }

  function tile(entity, { enabled, controlled = false } = {}) {
    const node = el('article', 'tile dev-tile');
    node.dataset.entity = entity.id;
    node.dataset.type = entity.type;
    node.dataset.deviceState = entity.state ?? 'UNKNOWN';
    node.classList.toggle('is-active', !PASSIVE_TYPES.has(entity.type) && ACTIVE_STATES.has(entity.state));
    node.classList.toggle('is-controlled', controlled);
    node.classList.toggle('is-unavailable', entity.state === 'UNAVAILABLE');
    const head = el('div', 'dev-head');
    const text = el('div', 'dev-text');
    const sub = el('span', 'dev-sub', subline(entity));
    const check = entity.type === 'macro' ? readiness(entity.id) : null;
    if (check) {
      const said = readinessText(check);
      sub.textContent = said.text;
      sub.classList.toggle('is-warn', said.warn);
      if (said.title) sub.title = said.title;
    }
    text.append(el('span', 'tile-name', entity.name), sub);
    let lead = el('span', 'dev-icon');
    lead.append(icon(iconFor(entity)));
    let trailing = null;
    const body = [];

    if (entity.type === 'light' || entity.type === 'switch') {
      trailing = powerSwitch(entity, enabled, onCommand);
      if (entity.type === 'light' && entity.features.includes('dim')) {
        body.push(slider(entity, {
          label: 'Brightness',
          value: entity.state === 'ON' ? entity.brightness ?? 100 : 0,
          enabled: enabled && entity.state !== 'UNAVAILABLE',
          onCommit: (value) => onCommand(entity.id, value === 0 ? 'off' : 'brightness', value === 0 ? undefined : value),
        }));
      }
    } else if (entity.type === 'remote') {
      if (entity.features.includes('on_off')) trailing = powerSwitch(entity, enabled, onCommand);
      if (entity.controllable) {
        const open = button('dev-chip is-wide', `Open the controls for ${entity.name}`, 'remote', controlled ? 'Controlling' : 'Open controls');
        open.disabled = !enabled;
        open.setAttribute('aria-pressed', String(controlled));
        open.addEventListener('click', () => onOpenDevice(entity.id));
        body.push(open);
      }
    } else if (entity.type === 'climate') {
      body.push(climateBody(entity, enabled));
    } else if (entity.type === 'cover') {
      const row = coverButtons(entity, enabled);
      row.classList.add('dev-cover');
      if (entity.features.includes('position')) {
        row.append(slider(entity, { label: 'Position', value: entity.position ?? 0, enabled, onCommit: (value) => onCommand(entity.id, 'position', value) }));
      }
      if (row.childElementCount > 0) body.push(row);
    } else if (entity.type === 'button' || entity.type === 'macro') {
      const action = entity.type === 'button' ? 'push' : 'run';
      trailing = button('dev-chip', `${entity.type === 'button' ? 'Press' : 'Run'} ${entity.name}`, entity.type === 'button' ? 'button' : 'play', entity.type === 'button' ? 'Press' : 'Run');
      trailing.disabled = !enabled;
      trailing.addEventListener('click', () => {
        trailing.classList.remove('is-sent');
        void trailing.offsetWidth;
        trailing.classList.add('is-sent');
        onCommand(entity.id, action);
      });
    } else if (entity.type === 'sensor') {
      const reading = el('span', 'dev-value');
      reading.append(el('span', 'dev-value-number', entity.state === 'UNAVAILABLE' ? 'n/a' : entity.value ?? 'n/a'));
      if (entity.unit && entity.state !== 'UNAVAILABLE') reading.append(el('span', 'dev-value-unit', entity.unit));
      trailing = reading;
    } else if (entity.type === 'select' && entity.options?.length > 0) {
      trailing = button('dev-chip', `Choose ${entity.name}`, 'angle-down', 'Choose');
      trailing.disabled = !enabled;
      trailing.addEventListener('click', async () => {
        const chosen = await choose({ heading: entity.name, detail: null, options: entity.options, current: entity.option });
        if (chosen && chosen !== entity.option) onCommand(entity.id, 'select_option', chosen);
      });
    } else if (entity.type === 'media_player') {
      const media = mediaHead(entity, enabled);
      lead = media.art;
      if (media.actions.childElementCount > 0) body.push(media.actions);
      node.classList.add('is-openable');
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Open the player for ${entity.name}`);
      const open = (event) => {
        if (event.target.closest('button')) return;
        if (enabled) onOpenPlayer(entity.id);
      };
      node.addEventListener('click', open);
      node.addEventListener('keydown', (event) => {
        if (event.target === node && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          open(event);
        }
      });
    }

    head.append(lead, text);
    if (trailing) head.append(trailing);
    node.append(head, ...body);
    return node;
  }

  function missing(entityId) {
    const node = el('article', 'tile dev-tile is-missing');
    node.dataset.entity = entityId;
    const head = el('div', 'dev-head');
    const lead = el('span', 'dev-icon');
    lead.append(icon('close'));
    const text = el('div', 'dev-text');
    text.append(el('span', 'tile-name', 'Not available'), el('span', 'dev-sub', 'This item is no longer on the remote.'));
    head.append(lead, text);
    node.append(head);
    return node;
  }

  function activity(item, { enabled, controlled, onStart, onStop, onControl }) {
    const active = item.state === 'ON' || item.state === 'RUNNING';
    const node = el('article', 'tile dev-tile');
    node.dataset.entity = item.id;
    node.dataset.type = 'activity';
    node.dataset.deviceState = item.state ?? 'UNKNOWN';
    node.classList.toggle('is-active', active);
    node.classList.toggle('is-controlled', controlled);
    const head = el('div', 'dev-head');
    const lead = el('span', 'dev-icon');
    lead.append(icon('apps'));
    const text = el('div', 'dev-text');
    text.append(el('span', 'tile-name', item.name), el('span', 'dev-sub', stateLabel(item.state)));
    const main = button('dev-chip', active ? `Control ${item.name}` : `Start ${item.name}`, active ? 'remote' : 'play', active ? 'Control' : 'Start');
    main.disabled = !enabled;
    main.addEventListener('click', () => (active ? onControl() : onStart()));
    head.append(lead, text, main);
    node.append(head);
    if (active) {
      const off = button('dev-chip is-wide', `Turn off ${item.name}`, 'power', 'Turn off');
      off.disabled = !enabled;
      off.addEventListener('click', onStop);
      node.append(off);
    }
    return node;
  }

  return { tile, missing, activity };
}

const DEVICE_STATES = {
  CONNECTED: ['Connected', 'is-ok'], CONNECTING: ['Connecting', 'is-busy'], DISCONNECTED: ['Disconnected', 'is-warn'], ERROR: ['Error', 'is-warn'],
  UNKNOWN: ['Unknown', ''], ACTIVE: ['Active', 'is-ok'], IDLE: ['Idle', ''], RECONNECTING: ['Reconnecting', 'is-busy'], NOT_CONFIGURED: ['Not set up', ''],
};

function integrationRow(item) {
  const row = el('article', 'intg-row');
  const lead = el('span', 'dev-icon');
  lead.append(icon('puzzle'));
  const text = el('div', 'dev-text');
  text.append(el('span', 'tile-name', item.name));
  const facts = [item.version ? `v${item.version}` : null, item.developer, item.kind].filter(Boolean).join(' · ');
  text.append(el('span', 'dev-sub', facts || 'No details reported'));
  const [label, tone] = item.enabled === false ? ['Disabled', ''] : DEVICE_STATES[item.state] ?? ['Unknown', ''];
  const pill = el('span', `intg-state ${tone}`.trim(), label);
  row.append(lead, text, pill);
  return row;
}

export function renderIntegrations(container, data) {
  const list = el('div', 'intg-list');
  if (data.integrations.length === 0) list.append(el('p', 'empty', 'No integrations are set up on this remote.'));
  list.append(...data.integrations.map(integrationRow));
  const children = [list];
  if (data.drivers.length > 0) {
    const head = el('h3', 'intg-subhead', 'Installed, no device set up');
    const idle = el('div', 'intg-list is-idle');
    idle.append(...data.drivers.map(integrationRow));
    children.push(head, idle);
  }
  container.replaceChildren(...children);
}
