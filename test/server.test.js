import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { Auth, hashPin } from '../src/auth.js';
import { Remote } from '../src/remote.js';
import { assetVersion, createServer, discoverThemes } from '../src/server.js';
import { HOSTNAME, KEY, mapping, startFakeRemote, waitFor } from './helpers/fake-remote.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PIN = '4826';

let dir;
let fake;
let remote;
let server;
let base;
let cookie;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ucweb-server-'));
  await writeFile(path.join(dir, `${HOSTNAME}.key`), KEY);
  await writeFile(path.join(dir, 'pin.hash'), await hashPin(PIN));
  fake = await startFakeRemote({
    buttonMappings: { 'act.tv': mapping('media.tv') },
    uis: {
      'act.tv': {
        pages: [{
          page_id: 'main',
          name: 'Main',
          grid: { width: 4, height: 6 },
          items: [
            { type: 'text', text: 'Input', command: { entity_id: 'media.tv', cmd_id: 'media_player.select_source', params: { source: 'HDMI 1' } }, location: { x: 0, y: 0 }, size: { width: 2, height: 1 } },
            { type: 'sensor', sensor: { sensor_id: 'sensor.vol' }, location: { x: 2, y: 0 }, size: { width: 2, height: 1 } },
            { type: 'media_player', media_player_id: 'media.tv', location: { x: 0, y: 1 }, size: { width: 4, height: 3 } },
          ],
        }],
      },
    },
    entities: {
      'media.tv': { entity_id: 'media.tv', entity_type: 'media_player', name: { en: 'TV' }, features: ['play_pause', 'next'], attributes: { state: 'PLAYING' } },
      'sensor.vol': { entity_id: 'sensor.vol', entity_type: 'sensor', name: { en: 'Volume' }, attributes: { state: 'ON', value: '30', unit: 'dB' } },
      'light.desk': { entity_id: 'light.desk', entity_type: 'light', name: { en: 'Desk' }, features: ['dim'], attributes: { state: 'OFF' } },
      'remote.amp': {
        entity_id: 'remote.amp', entity_type: 'remote', name: { en: 'Amp' }, features: ['send_cmd'], attributes: { state: 'ON' },
        options: { button_mapping: [{ button: 'MUTE', short_press: { cmd_id: 'mute' } }] },
      },
    },
    profiles: [{ profile_id: 'p', name: 'Home' }],
    profilePages: { p: [{ page_id: 'lights', profile_id: 'p', name: 'Lights', items: [{ entity_id: 'light.desk', pos: 1 }] }] },
    drivers: [{ driver_id: 'hass', name: { en: 'Home Assistant' }, driver_type: 'LOCAL', version: '1', driver_state: 'ACTIVE' }],
    instances: [{ integration_id: 'hass.main', driver_id: 'hass', device_state: 'CONNECTED', setup_data: { token: 'ha-secret' } }],
  });
  remote = new Remote({ address: fake.address, keysDir: dir, reconnectDelays: [20] });
  remote.start();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  const auth = new Auth({ configDir: dir });
  await auth.init();
  server = createServer({ remotes: [remote], publicDir, themes: await discoverThemes(publicDir), defaultTheme: 'miyara', auth, version: await assetVersion(publicDir) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ pin: PIN }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  remote.stop();
  await new Promise((resolve) => server.close(resolve));
  await fake.close();
  await rm(dir, { recursive: true, force: true });
});

const authed = (pathname, options = {}) =>
  fetch(`${base}${pathname}`, { ...options, headers: { cookie, origin: base, 'content-type': 'application/json', ...options.headers } });

function openEvents(headers) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/events`, { headers });
    const messages = [];
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    socket.on('open', () => resolve({ socket, messages }));
    socket.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.on('error', reject);
  });
}

test('the session cookie is HttpOnly and SameSite=Strict', async () => {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  });
  assert.match(response.headers.get('set-cookie'), /^ucweb_session=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
});

test('the session endpoint reports whether this browser is signed in', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/session`)).json(), { authenticated: false, pinConfigured: true });
  assert.deepEqual(await (await authed('/api/session')).json(), { authenticated: true, pinConfigured: true });
});

test('a wrong PIN gets 401 and sets no cookie', async () => {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '0000' }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('remote data and commands need a session', async () => {
  assert.equal((await fetch(`${base}/api/remotes`)).status, 401);
  const press = await fetch(`${base}/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/buttons/VOLUME_UP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(press.status, 401);
  assert.equal(fake.state.commands.length, 0);
});

test('the live event stream refuses a browser without a session', async () => {
  await assert.rejects(openEvents({ origin: base }), /HTTP 401/);
});

test('the live event stream sends a snapshot and then every change', async (t) => {
  const { socket, messages } = await openEvents({ cookie, origin: base });
  t.after(() => socket.terminate());
  await waitFor(() => messages.length >= 1, { message: 'snapshot' });
  assert.equal(messages[0].type, 'snapshot');
  assert.equal(messages[0].version, await assetVersion(publicDir));
  assert.equal(messages[0].remotes[0].name, 'Test Den');
  fake.emit('battery_status', { capacity: 12, status: 'DISCHARGING', power_supply: false });
  await waitFor(() => messages.some((message) => message.type === 'remote' && message.remote.battery?.capacity === 12), { message: 'battery update' });
  socket.close();
});

test('the live event stream refuses another site', async () => {
  await assert.rejects(openEvents({ cookie, origin: 'http://evil.example' }), /HTTP 401/);
});

test('a signed-in browser lists the remotes', async () => {
  const remotes = await (await authed('/api/remotes')).json();
  assert.equal(remotes.length, 1);
  assert.equal(remotes[0].id, fake.address);
  assert.equal(remotes[0].activities[0].name, 'Watch TV');
});

test('a button press is forwarded to the mapped entity', async () => {
  fake.state.commands.length = 0;
  const response = await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/buttons/VOLUME_UP`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  assert.deepEqual(fake.state.commands, [{ entityId: 'media.tv', body: { cmd_id: 'media_player.volume_up' } }]);
});

test('a signed-in browser gets an activity\'s pages with the state of their widgets', async () => {
  const response = await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages`);
  assert.equal(response.status, 200);
  const { pages, entities } = await response.json();
  assert.deepEqual(pages.map((page) => [page.id, page.name, page.items.length]), [['main', 'Main', 3]]);
  assert.equal(pages[0].items[0].action, true);
  assert.equal(JSON.stringify(pages).includes('select_source'), false);
  assert.deepEqual(entities['sensor.vol'], { id: 'sensor.vol', type: 'sensor', name: 'Volume', state: 'ON', deviceClass: null, icon: null, value: '30', unit: 'dB' });
});

test('a page item press runs the command the page stores', async () => {
  fake.state.commands.length = 0;
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages/main/items`;
  assert.equal((await authed(`${route}/0`, { method: 'POST', body: '{}' })).status, 200);
  assert.deepEqual(fake.state.commands, [{ entityId: 'media.tv', body: { cmd_id: 'media_player.select_source', params: { source: 'HDMI 1' } } }]);
});

test('page item presses are refused without a session, from another site, or for items that do nothing', async () => {
  fake.state.commands.length = 0;
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages/main/items`;
  assert.equal((await fetch(`${base}${route}/0`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await authed(`${route}/0`, { method: 'POST', body: '{}', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await authed(`${route}/1`, { method: 'POST', body: '{}' })).status, 409);
  assert.equal((await authed(`${route}/-1`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await authed(`${route}/1e3`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages/other/items/0`, { method: 'POST', body: '{}' })).status, 404);
  assert.deepEqual(fake.state.commands, []);
});

test('a signed-in browser can drive a player on an open page within what it supports', async () => {
  await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages`);
  fake.state.commands.length = 0;
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/entities/media.tv/player`;
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"play_pause"}' })).status, 200);
  assert.deepEqual(fake.state.commands, [{ entityId: 'media.tv', body: { cmd_id: 'media_player.play_pause' } }]);
  fake.state.commands.length = 0;
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"seek","value":10}' })).status, 409);
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"explode"}' })).status, 400);
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"next"}', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"next"}' })).status, 401);
  assert.equal((await authed(route)).status, 405);
  assert.deepEqual(fake.state.commands, []);
});

test('browsing needs a session and a player on an open page that can browse; picture keys are checked', async () => {
  await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages`);
  const base2 = `/api/remotes/${encodeURIComponent(fake.address)}/entities/media.tv`;
  assert.equal((await fetch(`${base}${base2}/browse`)).status, 401);
  assert.equal((await authed(`${base2}/browse`)).status, 409);
  assert.equal((await authed(`${base2}/browse?page=0`)).status, 409);
  assert.equal((await authed(`${base2}/thumbs/not-a-key`)).status, 400);
  assert.equal((await authed(`${base2}/thumbs/${'a'.repeat(20)}`)).status, 404);
  assert.equal((await authed(`/api/remotes/${encodeURIComponent(fake.address)}/entities/media.tv/player`, { method: 'POST', body: '{"action":"play_media","value":{"mediaId":"x","mediaType":null}}' })).status, 409);
});

test('artwork is only served for a player on an open page', async () => {
  assert.equal((await authed(`/api/remotes/${encodeURIComponent(fake.address)}/entities/media.tv/image`)).status, 404);
});

test('live widget changes and page edits reach the browser', async (t) => {
  await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/pages`);
  const { socket, messages } = await openEvents({ cookie, origin: base });
  t.after(() => socket.terminate());
  fake.emit('entity_change', { entity_type: 'sensor', entity_id: 'sensor.vol', event_type: 'CHANGE', new_state: { attributes: { value: '35' } } });
  const entity = await waitFor(() => messages.find((message) => message.type === 'entity'), { message: 'entity message' });
  assert.deepEqual(entity, { type: 'entity', remote: fake.address, entity: { id: 'sensor.vol', type: 'sensor', name: 'Volume', state: 'ON', deviceClass: null, icon: null, value: '35', unit: 'dB' } });
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.tv', event_type: 'CHANGE', new_state: { name: { en: 'Watch TV' }, attributes: { state: 'OFF' } } });
  const pages = await waitFor(() => messages.find((message) => message.type === 'pages'), { message: 'pages message' });
  assert.deepEqual(pages, { type: 'pages', remote: fake.address, activity: 'act.tv' });
});

test('turning an activity on needs a boolean', async () => {
  fake.state.commands.length = 0;
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/power`;
  assert.equal((await authed(route, { method: 'POST', body: '{"on":"yes"}' })).status, 400);
  assert.equal((await authed(route, { method: 'POST', body: '{"on":true}' })).status, 200);
  assert.deepEqual(fake.state.commands, [{ entityId: 'act.tv', body: { cmd_id: 'activity.on' } }]);
});

test('commands from another site are refused', async () => {
  fake.state.commands.length = 0;
  const response = await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/power`, {
    method: 'POST',
    body: '{"on":true}',
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(response.status, 403);
  assert.equal(fake.state.commands.length, 0);
});

test('a signed-in browser can reboot or power off a remote', async () => {
  fake.state.systemCommands.length = 0;
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/system`;
  assert.equal((await authed(route, { method: 'POST', body: '{"command":"REBOOT"}' })).status, 200);
  assert.equal((await authed(route, { method: 'POST', body: '{"command":"POWER_OFF"}' })).status, 200);
  assert.deepEqual(fake.state.systemCommands, ['REBOOT', 'POWER_OFF']);
});

test('system commands are refused without a session, from another site, or when not reboot or power off', async () => {
  fake.state.systemCommands.length = 0;
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/system`;
  const anonymous = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"command":"REBOOT"}' });
  assert.equal(anonymous.status, 401);
  assert.equal((await authed(route, { method: 'POST', body: '{"command":"REBOOT"}', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await authed(route, { method: 'POST', body: '{"command":"RESTART"}' })).status, 400);
  assert.equal((await authed(route, { method: 'GET' })).status, 405);
  assert.equal((await authed('/api/remotes/nope/system', { method: 'POST', body: '{"command":"REBOOT"}' })).status, 404);
  assert.deepEqual(fake.state.systemCommands, []);
});

test('commands must be sent as JSON', async () => {
  const response = await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/power`, {
    method: 'POST',
    body: 'on=true',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(response.status, 415);
});

test('an unknown remote, activity or button is a 404 with a reason', async () => {
  const unknownRemote = await authed('/api/remotes/nope/activities/act.tv/buttons');
  assert.equal(unknownRemote.status, 404);
  assert.deepEqual(await unknownRemote.json(), { error: 'There is no remote nope.' });
  assert.equal((await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.zz/buttons`)).status, 404);
  assert.equal((await authed(`/api/remotes/${encodeURIComponent(fake.address)}/activities/act.tv/buttons/RECORD`, { method: 'POST', body: '{}' })).status, 404);
});

test('the page is served with security headers', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>ucweb<\/title>/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'; script-src 'self'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('files outside the public folder cannot be read', async () => {
  for (const attempt of ['/..%2fpackage.json', '/%2e%2e/src/auth.js', '/themes/..%2f..%2fpackage.json']) {
    assert.equal((await fetch(`${base}${attempt}`)).status, 404, attempt);
  }
});

test('the theme list is discovered from the themes folder', async () => {
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.defaultTheme, 'miyara');
  assert.deepEqual(config.themes.map((theme) => theme.id).sort(), [
    'brookwood', 'brookwood-light', 'copper', 'dark-orange', 'graphite-brass', 'miyara', 'original', 'pats-blue', 'roon', 'roon-light',
  ]);
  assert.equal(config.themes.find((theme) => theme.id === 'copper').name, 'Obsidian & Copper');
  assert.equal(config.themes.find((theme) => theme.id === 'pats-blue').name, "Pat's Blue");
});

test('the build version changes when any page file changes', async () => {
  const pageDir = await mkdtemp(path.join(tmpdir(), 'ucweb-page-'));
  await writeFile(path.join(pageDir, 'app.js'), 'one');
  const before = await assetVersion(pageDir);
  assert.match(before, /^[0-9a-f]{16}$/);
  assert.equal(await assetVersion(pageDir), before);
  await writeFile(path.join(pageDir, 'app.js'), 'two');
  assert.notEqual(await assetVersion(pageDir), before);
  await rm(pageDir, { recursive: true, force: true });
});

test('signing out clears the cookie', async () => {
  const response = await authed('/api/session', { method: 'DELETE' });
  assert.match(response.headers.get('set-cookie'), /^ucweb_session=; .*Max-Age=0$/);
});

test('a signed-in browser reads the remote\'s pages, entities and integrations, and never an integration\'s setup data', async () => {
  const at = `/api/remotes/${encodeURIComponent(fake.address)}`;
  const profile = await (await authed(`${at}/profile`)).json();
  assert.deepEqual(profile.pages, [{ id: 'lights', name: 'Lights', items: [{ entityId: 'light.desk', type: 'light' }] }]);
  assert.equal(profile.entities['light.desk'].name, 'Desk');
  const { entities } = await (await authed(`${at}/entities`)).json();
  assert.deepEqual(entities.map((entity) => entity.id), ['remote.amp', 'light.desk', 'media.tv', 'sensor.vol']);
  const integrations = await authed(`${at}/integrations`);
  const body = await integrations.text();
  assert.equal(integrations.status, 200);
  assert.ok(!body.includes('ha-secret') && !body.includes('setup_data'), body);
  assert.equal(JSON.parse(body).integrations[0].name, 'Home Assistant');
  for (const part of ['profile', 'entities', 'integrations']) {
    assert.equal((await fetch(`${base}${at}/${part}`)).status, 401, part);
  }
});

test('device controls need a session and a same-site POST, and send only what the device supports', async () => {
  const route = `/api/remotes/${encodeURIComponent(fake.address)}/entities/light.desk/control`;
  fake.state.commands.length = 0;
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"brightness","value":20}' })).status, 200);
  assert.deepEqual(fake.state.commands, [{ entityId: 'light.desk', body: { cmd_id: 'light.on', params: { brightness: 51 } } }]);
  fake.state.commands.length = 0;
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"brightness","value":200}' })).status, 400);
  assert.equal((await authed(route, { method: 'POST', body: '{"action":"on"}', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"on"}' })).status, 401);
  assert.equal((await authed(route)).status, 405);
  assert.deepEqual(fake.state.commands, []);
});

test('a remote device opens like an activity: its buttons press through the device route, and it has no power route', async () => {
  const at = `/api/remotes/${encodeURIComponent(fake.address)}/devices/remote.amp`;
  fake.state.commands.length = 0;
  assert.deepEqual(await (await authed(`${at}/buttons`)).json(), [{ button: 'MUTE', mapped: true, fallback: false }]);
  assert.equal((await authed(`${at}/buttons/MUTE`, { method: 'POST', body: '{}' })).status, 200);
  assert.deepEqual(fake.state.commands, [{ entityId: 'remote.amp', body: { cmd_id: 'remote.send_cmd', params: { command: 'mute' } } }]);
  assert.equal((await authed(`${at}/power`, { method: 'POST', body: '{"on":true}' })).status, 404);
  assert.equal((await authed(`/api/remotes/${encodeURIComponent(fake.address)}/devices/act.tv/buttons`)).status, 404);
});

test('profile and integration changes reach the browser so it can reload them', async () => {
  const { socket, messages } = await openEvents({ cookie, origin: base });
  await waitFor(() => messages.length > 0, { message: 'snapshot' });
  fake.emit('profile_change', { event_type: 'CHANGE' });
  fake.emit('integration_change', { event_type: 'CHANGE' });
  await waitFor(() => messages.some((message) => message.type === 'integrations'), { message: 'integrations event' });
  assert.deepEqual(messages.filter((message) => message.type === 'profile' || message.type === 'integrations'), [
    { type: 'profile', remote: fake.address },
    { type: 'integrations', remote: fake.address },
  ]);
  socket.close();
});
