import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { deviceInterface, Remote, toEntityView, toIntegrations, toProfilePages } from '../src/remote.js';
import { activity, HOSTNAME, KEY, startFakeRemote, waitFor } from './helpers/fake-remote.js';

let keysDir;
let fake;
let remote;

const entity = (id, type, extra = {}) => ({ entity_id: id, entity_type: type, name: { en: id }, features: [], attributes: { state: 'OFF' }, ...extra });

const ENTITIES = {
  'light.lamp': entity('light.lamp', 'light', { features: ['toggle', 'dim'], attributes: { state: 'ON', brightness: 128 } }),
  'light.plain': entity('light.plain', 'light', { features: [] }),
  'switch.fan': entity('switch.fan', 'switch', { features: ['toggle'] }),
  'climate.hall': entity('climate.hall', 'climate', {
    features: ['on_off', 'heat', 'cool', 'target_temperature', 'current_temperature'],
    attributes: { state: 'COOL', current_temperature: 69.2, target_temperature: 69 },
    options: { min_temperature: 44.6, max_temperature: 95, target_temperature_step: 0.5 },
  }),
  'cover.blind': entity('cover.blind', 'cover', { features: ['open', 'close', 'position'], attributes: { state: 'OPEN', position: 40 } }),
  'button.bass': entity('button.bass', 'button', { attributes: { state: 'AVAILABLE' } }),
  'macro.night': entity('macro.night', 'macro', { features: ['run'] }),
  'select.input': entity('select.input', 'select', { attributes: { state: 'ON', current_option: 'USB', options: ['USB', 'Optical'] } }),
  'sensor.temp': entity('sensor.temp', 'sensor', { device_class: 'temperature', icon: 'uc:sensor', attributes: { state: 'ON', value: '68.4', unit: '°F' } }),
  'media.tv': entity('media.tv', 'media_player', { device_class: 'tv', icon: 'custom:android.jpg', features: ['on_off', 'play_pause'] }),
  'remote.avr': entity('remote.avr', 'remote', {
    features: ['on_off', 'send_cmd', 'toggle'],
    options: {
      user_interface: { pages: [{ page_id: 'main', name: 'Main', grid: { width: 4, height: 6 }, items: [
        { type: 'text', text: 'Pure', command: { cmd_id: 'PURE_DIRECT' }, location: { x: 0, y: 0 }, size: { width: 2, height: 1 } },
        { type: 'text', text: 'Power', command: { cmd_id: 'remote.toggle' }, location: { x: 2, y: 0 }, size: { width: 2, height: 1 } },
        { type: 'text', text: 'Label', location: { x: 0, y: 1 }, size: { width: 4, height: 1 } },
      ] }] },
      button_mapping: [
        { button: 'VOLUME_UP', short_press: { cmd_id: 'volume_up' } },
        { button: 'BACK' },
        { button: 'PLAY', short_press: { cmd_id: 'CONSUMER_PLAY_PAUSE' }, long_press: { cmd_id: 'CONSUMER_STOP' } },
      ],
    },
  }),
  'remote.ir': entity('remote.ir', 'remote', {
    features: ['send'],
    options: { user_interface: { pages: [{ page_id: 'p', grid: { width: 4, height: 6 }, items: [
      { type: 'text', text: 'Mute', command: { cmd_id: 'Mute', params: { repeat: 2 } }, location: { x: 0, y: 0 } },
    ] }] } },
  }),
  'remote.bare': entity('remote.bare', 'remote', { features: ['send_cmd'], options: {} }),
};

const PROFILE = { profile_id: 'p1', name: 'Pat' };

async function connect(options = {}) {
  fake = await startFakeRemote({
    activities: [activity('act.tv', 'Watch TV'), activity('act.cams', 'Cameras')],
    entities: structuredClone(ENTITIES),
    profiles: [PROFILE],
    profilePages: {
      p1: [
        { page_id: 'lights', profile_id: 'p1', name: 'Lights', pos: 3, items: [{ entity_id: 'switch.fan', pos: 2 }, { entity_id: 'light.lamp', pos: 1 }] },
        { page_id: 'acts', profile_id: 'p1', name: 'Activities', pos: 1, items: [{ entity_id: 'act.tv', pos: 1 }, { entity_id: 'gone.entity', pos: 2 }] },
        { page_id: 'mixed', profile_id: 'p1', name: 'Mixed', pos: 2, items: [{ group_id: 'g1', pos: 1 }, { group_id: 'missing', pos: 2 }, { entity_id: 'climate.hall', pos: 3 }] },
      ],
    },
    groups: { p1: [{ group_id: 'g1', profile_id: 'p1', name: { en: 'Downstairs' }, entities: ['light.plain', 'cover.blind'] }] },
    ...options,
  });
  await writeFile(path.join(keysDir, `${HOSTNAME}.key`), KEY);
  remote = new Remote({ address: fake.address, keysDir, reconnectDelays: [20], heartbeatMs: 60000, powerPollMs: 60000 });
  remote.start();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  return remote;
}

beforeEach(async () => {
  keysDir = await mkdtemp(path.join(tmpdir(), 'ucweb-devices-'));
});

afterEach(async () => {
  remote?.stop();
  remote = null;
  await fake?.close();
  fake = null;
  await rm(keysDir, { recursive: true, force: true });
});

test('profile pages keep the remote\'s page and item order and expand each group into its entities', async () => {
  await connect();
  const { profile, pages, entities } = await remote.profilePages();
  assert.equal(profile, 'Pat');
  assert.deepEqual(pages.map((page) => page.name), ['Activities', 'Mixed', 'Lights']);
  assert.deepEqual(pages[0].items, [{ entityId: 'act.tv', type: 'activity' }, { entityId: 'gone.entity', type: null }]);
  assert.deepEqual(pages[1].items, [
    { group: { id: 'g1', name: 'Downstairs', items: [{ entityId: 'light.plain', type: 'light' }, { entityId: 'cover.blind', type: 'cover' }] } },
    { entityId: 'climate.hall', type: 'climate' },
  ]);
  assert.deepEqual(pages[2].items.map((item) => item.entityId), ['light.lamp', 'switch.fan']);
  assert.deepEqual(Object.keys(entities).sort(), ['climate.hall', 'cover.blind', 'light.lamp', 'light.plain', 'switch.fan']);
  assert.equal(entities['light.lamp'].brightness, 50);
});

test('the active profile is used when the remote names one, otherwise the first profile', async () => {
  const other = { profile_id: 'p2', name: 'Guest' };
  await connect({ profiles: [PROFILE, other], activeProfile: other, profilePages: { p1: [], p2: [{ page_id: 'g', profile_id: 'p2', name: 'Guest page', items: [] }] } });
  const guest = await remote.profilePages();
  assert.equal(guest.profile, 'Guest');
  assert.deepEqual(guest.pages.map((page) => page.name), ['Guest page']);
  fake.state.activeProfile = null;
  assert.equal((await remote.profilePages()).profile, 'Pat');
});

test('a remote without profiles reports no pages instead of failing', async () => {
  await connect({ profiles: [] });
  assert.deepEqual(await remote.profilePages(), { profile: null, pages: [], entities: {} });
});

test('the entity list pages through every entity and leaves activities to the activity list', async () => {
  const many = Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`sensor.s${index}`, entity(`sensor.s${index}`, 'sensor')]));
  await connect({ entities: { ...structuredClone(ENTITIES), ...many } });
  const { entities } = await remote.entities();
  assert.equal(entities.length, Object.keys(ENTITIES).length + 130);
  assert.ok(entities.every((view) => view.type !== 'activity'));
  assert.deepEqual(fake.state.listRequests.filter((request) => request.path === '/api/entities').map((request) => request.page), [1, 2]);
  const sensor = entities.find((view) => view.id === 'sensor.temp');
  assert.deepEqual([sensor.deviceClass, sensor.icon, sensor.value, sensor.unit], ['temperature', 'uc:sensor', '68.4', '°F']);
  assert.equal(entities.find((view) => view.id === 'media.tv').icon, null);
});

test('integrations never pass on setup data, and drivers without a device are listed apart', () => {
  const drivers = [
    { driver_id: 'hass', name: { en: 'Home Assistant' }, driver_type: 'LOCAL', version: '0.17.0', developer_name: 'Unfolded Circle ApS', driver_state: 'ACTIVE', enabled: true, token: 'driver-secret' },
    { driver_id: 'eversolo', name: { en: 'Eversolo' }, driver_type: 'CUSTOM', version: '2.0.2', developer_name: 'Meir Miyara', driver_state: 'ACTIVE', enabled: true },
    { driver_id: 'odd', name: { en: 'Odd' }, driver_type: 'WHATEVER', driver_state: 'SLEEPY' },
  ];
  const instances = [
    { integration_id: 'hass.main', driver_id: 'hass', name: { en: 'Home Assistant (I)' }, enabled: true, device_state: 'CONNECTED', setup_data: { token: 'ha-long-lived-token', url: 'ws://ha:8123' } },
    { integration_id: 'lost.main', driver_id: 'lost', name: { en: 'Lost' }, device_state: 'WEIRD' },
  ];
  const result = toIntegrations(drivers, instances);
  const text = JSON.stringify(result);
  for (const secret of ['ha-long-lived-token', 'ws://ha:8123', 'driver-secret', 'setup_data', 'token']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(result.integrations, [
    { id: 'hass.main', name: 'Home Assistant', version: '0.17.0', developer: 'Unfolded Circle ApS', kind: 'Built in', state: 'CONNECTED', enabled: true },
    { id: 'lost.main', name: 'Lost', version: null, developer: null, kind: null, state: null, enabled: null },
  ]);
  assert.deepEqual(result.drivers.map((driver) => [driver.name, driver.kind, driver.state]), [['Eversolo', 'Custom', 'ACTIVE'], ['Odd', null, null]]);
});

test('the integrations route reads every page of drivers and instances', async () => {
  const drivers = Array.from({ length: 101 }, (_, index) => ({ driver_id: `d${index}`, name: { en: `Driver ${String(index).padStart(3, '0')}` } }));
  await connect({ drivers, instances: [{ integration_id: 'd5.main', driver_id: 'd5', device_state: 'CONNECTED', setup_data: { password: 'hunter2' } }] });
  const result = await remote.integrations();
  assert.equal(result.integrations.length, 1);
  assert.equal(result.drivers.length, 100);
  assert.ok(!JSON.stringify(result).includes('hunter2'));
});

test('device views carry what their controls need and nothing a driver did not report', () => {
  const view = (id) => toEntityView({ ...structuredClone(ENTITIES[id]), positionAt: null });
  assert.deepEqual(view('light.plain').features, ['on_off', 'toggle']);
  assert.equal(view('light.plain').brightness, null);
  assert.deepEqual(view('light.lamp').features, ['on_off', 'toggle', 'dim']);
  const climate = view('climate.hall');
  assert.deepEqual([climate.current, climate.target, climate.min, climate.max, climate.step, climate.unit], [69.2, 69, 44.6, 95, 0.5, null]);
  assert.deepEqual(climate.modes, ['OFF', 'HEAT', 'COOL']);
  assert.equal(view('cover.blind').position, 40);
  assert.deepEqual(view('select.input').options, ['USB', 'Optical']);
  assert.equal(view('remote.avr').controllable, true);
  assert.equal(view('remote.bare').controllable, false);
});

test('device controls send the command each entity type takes, scaled where the remote expects it', async () => {
  await connect();
  const send = (id, action, value) => remote.deviceCommand(id, action, value);
  await send('light.lamp', 'toggle');
  await send('light.plain', 'on');
  await send('light.lamp', 'brightness', 100);
  await send('light.lamp', 'brightness', 50);
  await send('switch.fan', 'off');
  await send('climate.hall', 'mode', 'OFF');
  await send('climate.hall', 'mode', 'HEAT');
  await send('climate.hall', 'target', 70.5);
  await send('cover.blind', 'position', 25);
  await send('button.bass', 'push');
  await send('macro.night', 'run');
  await send('select.input', 'select_option', 'Optical');
  await send('remote.avr', 'toggle');
  assert.deepEqual(fake.state.commands.map((command) => [command.entityId, command.body]), [
    ['light.lamp', { cmd_id: 'light.toggle' }],
    ['light.plain', { cmd_id: 'light.on' }],
    ['light.lamp', { cmd_id: 'light.on', params: { brightness: 255 } }],
    ['light.lamp', { cmd_id: 'light.on', params: { brightness: 128 } }],
    ['switch.fan', { cmd_id: 'switch.off' }],
    ['climate.hall', { cmd_id: 'climate.off' }],
    ['climate.hall', { cmd_id: 'climate.hvac_mode', params: { hvac_mode: 'HEAT' } }],
    ['climate.hall', { cmd_id: 'climate.target_temperature_c', params: { temperature: 70.5 } }],
    ['cover.blind', { cmd_id: 'cover.position', params: { position: 25 } }],
    ['button.bass', { cmd_id: 'button.push' }],
    ['macro.night', { cmd_id: 'macro.run' }],
    ['select.input', { cmd_id: 'select.select_option', params: { option: 'Optical' } }],
    ['remote.avr', { cmd_id: 'remote.toggle' }],
  ]);
});

test('device controls refuse what the entity does not support or a value out of range, and send nothing', async () => {
  await connect();
  const refused = [
    ['light.plain', 'brightness', 50, 409],
    ['light.lamp', 'brightness', 101, 400],
    ['light.lamp', 'brightness', 12.5, 400],
    ['climate.hall', 'mode', 'FAN', 400],
    ['climate.hall', 'target', 96, 400],
    ['climate.hall', 'target', '70', 400],
    ['cover.blind', 'stop', undefined, 409],
    ['cover.blind', 'position', -1, 400],
    ['select.input', 'select_option', 'HDMI', 400],
    ['remote.bare', 'on', undefined, 409],
    ['sensor.temp', 'on', undefined, 409],
    ['media.tv', 'on', undefined, 404],
    ['act.tv', 'on', undefined, 404],
    ['nothing.here', 'on', undefined, 404],
    ['light.lamp', 'explode', undefined, 400],
    ['light.lamp', '__proto__', undefined, 400],
    ['light.lamp', 'constructor', undefined, 400],
  ];
  for (const [id, action, value, status] of refused) {
    await assert.rejects(remote.deviceCommand(id, action, value), { status }, `${id} ${action} ${value}`);
  }
  assert.deepEqual(fake.state.commands, []);
});

test('a player on a page can be switched on and off only when it reports on and off', async () => {
  await connect();
  await remote.entities();
  await remote.playerCommand('media.tv', 'off');
  assert.deepEqual(fake.state.commands, [{ entityId: 'media.tv', body: { cmd_id: 'media_player.off' } }]);
  await assert.rejects(remote.playerCommand('media.tv', 'toggle'), { status: 409 });
});

test('a remote device\'s own pages send simple commands through the command its driver takes', async () => {
  await connect();
  const { pages } = await remote.pages('remote.avr', 'device');
  assert.deepEqual(pages[0].items.map((item) => [item.text, item.action]), [['Pure', true], ['Power', true], ['Label', false]]);
  await remote.pressItem('remote.avr', 'main', 0, 'device');
  await remote.pressItem('remote.avr', 'main', 1, 'device');
  await remote.pressItem('remote.ir', 'p', 0, 'device');
  assert.deepEqual(fake.state.commands.map((command) => [command.entityId, command.body]), [
    ['remote.avr', { cmd_id: 'remote.send_cmd', params: { command: 'PURE_DIRECT' } }],
    ['remote.avr', { cmd_id: 'remote.toggle' }],
    ['remote.ir', { cmd_id: 'remote.send', params: { repeat: 2, command: 'Mute' } }],
  ]);
});

test('a remote device\'s buttons follow its own button mapping', async () => {
  await connect();
  assert.deepEqual(await remote.buttons('remote.avr', 'device'), [
    { button: 'VOLUME_UP', mapped: true, fallback: false, long: false },
    { button: 'BACK', mapped: false, fallback: false, long: false },
    { button: 'PLAY', mapped: true, fallback: false, long: true },
  ]);
  await remote.press('remote.avr', 'VOLUME_UP', 'device');
  await assert.rejects(remote.press('remote.avr', 'BACK', 'device'), { status: 409 });
  assert.deepEqual(fake.state.commands, [{ entityId: 'remote.avr', body: { cmd_id: 'remote.send_cmd', params: { command: 'volume_up' } } }]);
});

test('a remote device\'s long press sends its own command the same way as its short press', async () => {
  await connect();
  await remote.press('remote.avr', 'PLAY', 'device');
  await remote.press('remote.avr', 'PLAY', 'device', { long: true });
  assert.deepEqual(fake.state.commands, [
    { entityId: 'remote.avr', body: { cmd_id: 'remote.send_cmd', params: { command: 'CONSUMER_PLAY_PAUSE' } } },
    { entityId: 'remote.avr', body: { cmd_id: 'remote.send_cmd', params: { command: 'CONSUMER_STOP' } } },
  ]);
});

test('only a remote device with pages or buttons can be opened as a device, and an activity id is not one', async () => {
  await connect();
  for (const id of ['remote.bare', 'light.lamp', 'act.tv', 'nothing.here']) {
    await assert.rejects(remote.pages(id, 'device'), { status: 404 }, id);
    await assert.rejects(remote.buttons(id, 'device'), { status: 404 }, id);
  }
  await assert.rejects(remote.pages('remote.avr'), { status: 404 });
});

test('device commands from the interface keep an entity a command already names', () => {
  const ui = deviceInterface({ entity_id: 'remote.x', features: ['send_cmd'], options: { user_interface: { pages: [{ page_id: 'p', items: [
    { type: 'text', text: 'Lamp', command: { entity_id: 'light.lamp', cmd_id: 'light.toggle' } },
  ] }] } } });
  assert.deepEqual(ui.pages[0].items[0].command, { entity_id: 'light.lamp', cmd_id: 'light.toggle' });
});

test('profile pages read groups only when a page has one', () => {
  const pages = toProfilePages([{ page_id: 'a', name: { en: 'A' }, items: [{ group_id: 'g' }] }], [{ group_id: 'g', name: 'G', entities: ['x', 7, ''] }]);
  assert.deepEqual(pages, [{ id: 'a', name: 'A', items: [{ group: { id: 'g', name: 'G', entityIds: ['x'] } }] }]);
});

test('live changes reach listed devices, new entities join the list, and a changed device drops its cached pages', async () => {
  await connect();
  await remote.entities();
  await remote.pages('remote.avr', 'device');
  const seen = [];
  const pages = [];
  remote.on('entity', (view) => seen.push(view));
  remote.on('pages', (id) => pages.push(id));
  fake.emit('entity_change', { entity_id: 'light.lamp', entity_type: 'light', event_type: 'CHANGE', new_state: { attributes: { state: 'OFF' } } });
  await waitFor(() => seen.length === 1, { message: 'light change' });
  assert.equal(seen[0].state, 'OFF');
  assert.equal(seen[0].brightness, 50);
  fake.state.entities['switch.new'] = entity('switch.new', 'switch');
  fake.emit('entity_change', { entity_id: 'switch.new', entity_type: 'switch', event_type: 'NEW', new_state: { attributes: { state: 'OFF' } } });
  await waitFor(() => seen.some((view) => view.id === 'switch.new'), { message: 'new switch' });
  assert.ok((await remote.entities()).entities.some((view) => view.id === 'switch.new'));
  fake.emit('entity_change', { entity_id: 'remote.avr', entity_type: 'remote', event_type: 'CHANGE', new_state: { options: { button_mapping: [] } } });
  await waitFor(() => pages.includes('remote.avr'), { message: 'device pages dropped' });
  await assert.rejects(remote.pages('remote.avr', 'device'), { status: 404 });
});

test('profile and integration changes on the remote are announced', async () => {
  await connect();
  const heard = [];
  remote.on('profile', () => heard.push('profile'));
  remote.on('integrations', () => heard.push('integrations'));
  fake.emit('profile_change', { event_type: 'CHANGE' });
  fake.emit('integration_change', { event_type: 'CHANGE' });
  fake.emit('integration_driver_change', { event_type: 'CHANGE' });
  await waitFor(() => heard.length === 3, { message: 'announcements' });
  assert.deepEqual(heard, ['profile', 'integrations', 'integrations']);
});

test('the remote subscribes to every entity type ucweb shows plus profile and integration changes', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/remote.js', import.meta.url), 'utf8');
  const channels = source.match(/const CHANNELS = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((name) => name.slice(1, -1));
  for (const channel of ['entity_light', 'entity_switch', 'entity_climate', 'entity_cover', 'entity_button', 'entity_macro', 'entity_remote', 'profiles', 'integrations']) {
    assert.ok(channels.includes(channel), channel);
  }
});

test('a thermostat target goes out as the remote\'s Celsius or Fahrenheit command: the entity\'s own unit first, else the remote\'s setting', async () => {
  const withUnit = structuredClone(ENTITIES);
  withUnit['climate.study'] = { ...structuredClone(ENTITIES['climate.hall']), entity_id: 'climate.study', options: { min_temperature: 10, max_temperature: 30, temperature_unit: 'CELSIUS' } };
  await connect({ entities: withUnit, localization: { measurement_unit: 'US' } });
  await remote.deviceCommand('climate.hall', 'target', 70);
  await remote.deviceCommand('climate.study', 'target', 21);
  assert.deepEqual(fake.state.commands.map((command) => command.body.cmd_id), ['climate.target_temperature_f', 'climate.target_temperature_c']);
  const { entities } = await remote.entities();
  assert.deepEqual(entities.filter((view) => view.type === 'climate').map((view) => [view.id, view.unit]), [['climate.hall', '°F'], ['climate.study', '°C']]);
});

test('a thermostat target is refused, not guessed, when neither the entity nor the remote names a unit', async () => {
  await connect({ localization: null });
  await assert.rejects(remote.deviceCommand('climate.hall', 'target', 70), { status: 409 });
  assert.deepEqual(fake.state.commands, []);
  assert.equal((await remote.entities()).entities.find((view) => view.id === 'climate.hall').unit, null);
});

test('every command ucweb can send is one the remote lists in its entity command metadata', async () => {
  const { readFile } = await import('node:fs/promises');
  const known = new Set(JSON.parse(await readFile(new URL('./fixtures/entity-command-ids.json', import.meta.url), 'utf8')));
  const entities = structuredClone(ENTITIES);
  entities['media.full'] = entity('media.full', 'media_player', {
    features: ['on_off', 'toggle', 'play_pause', 'stop', 'previous', 'next', 'volume_up_down', 'mute_toggle', 'seek', 'volume', 'shuffle', 'repeat', 'select_source'],
    attributes: { state: 'PLAYING', media_duration: 100, source_list: ['A'] },
  });
  entities['cover.blind'].features.push('stop');
  await connect({ entities, localization: { measurement_unit: 'US' } });
  await remote.entities();
  const devices = [
    ['light.lamp', ['on', 'off', 'toggle', ['brightness', 40]]],
    ['switch.fan', ['on', 'off', 'toggle']],
    ['climate.hall', ['on', 'off', ['mode', 'HEAT'], ['mode', 'OFF'], ['target', 70]]],
    ['cover.blind', ['open', 'close', 'stop', ['position', 10]]],
    ['button.bass', ['push']],
    ['macro.night', ['run']],
    ['select.input', [['select_option', 'USB']]],
    ['remote.avr', ['on', 'off', 'toggle']],
  ];
  for (const [id, actions] of devices) {
    for (const action of actions) {
      const [name, value] = Array.isArray(action) ? action : [action];
      await remote.deviceCommand(id, name, value);
    }
  }
  for (const [action, value] of [['on'], ['off'], ['toggle'], ['play_pause'], ['stop'], ['previous'], ['next'], ['volume_up'], ['volume_down'], ['mute_toggle'], ['seek', 5], ['volume', 5], ['shuffle', true], ['repeat', 'ALL'], ['select_source', 'A']]) {
    await remote.playerCommand('media.full', action, value);
  }
  await remote.pressItem('remote.avr', 'main', 0, 'device');
  await remote.pressItem('remote.ir', 'p', 0, 'device');
  await remote.setActivityPower('act.tv', true);
  await remote.setActivityPower('act.tv', false);
  const sent = [...new Set(fake.state.commands.map((command) => command.body.cmd_id))];
  assert.ok(sent.length >= 30, `sent ${sent.length} kinds of command`);
  assert.deepEqual(sent.filter((cmdId) => !known.has(cmdId)), []);
});
