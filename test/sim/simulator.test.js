import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Auth, hashPin } from '../../src/auth.js';
import { Remote } from '../../src/remote.js';
import { assetVersion, createServer, discoverThemes } from '../../src/server.js';
import { run as createKeys } from '../../src/create-key.js';
import { waitFor } from '../helpers/fake-remote.js';

const SIM = process.env.UC_SIM ?? '127.0.0.1:8080';
const SIM_AUTH = `Basic ${Buffer.from(`${process.env.UC_SIM_USER ?? 'web-configurator'}:${process.env.UC_SIM_PASSWORD ?? '1234'}`).toString('base64')}`;
const READY_MS = Number(process.env.UC_SIM_READY_MS ?? 120000);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const PIN = '2468';
const RUN = `ucweb-sim-${Date.now()}`;
const KEY_NAME = 'ucweb-sim';

let dir;
let remote;
let server;
let base;
let cookie;
let watch;
let target;
let page;
let room;

async function sim(method, pathname, body) {
  const headers = { authorization: SIM_AUTH, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`http://${SIM}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`simulator ${method} ${pathname}: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function simReady() {
  const deadline = Date.now() + READY_MS;
  for (;;) {
    try {
      const response = await fetch(`http://${SIM}/api/pub/version`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return await response.json();
    } catch {
      if (Date.now() > deadline) throw new Error(`No core simulator answered at ${SIM} within ${READY_MS} ms. Set UC_SIM=host:port.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const simActivity = async (id) => sim('GET', `/api/activities/${encodeURIComponent(id)}`);

const ucweb = (pathname, options = {}) =>
  fetch(`${base}${pathname}`, { ...options, headers: { cookie, origin: base, 'content-type': 'application/json', ...options.headers } });

const ucwebActivity = (id) => remote.snapshot().activities.find((activity) => activity.id === id);

before(async () => {
  const version = await simReady();
  for (const old of await sim('GET', '/api/auth/api_keys')) {
    if (old.name === KEY_NAME) await sim('DELETE', `/api/auth/api_keys/${old.key_id}`);
  }
  const key = await sim('POST', '/api/auth/api_keys', { name: KEY_NAME, scopes: ['admin'] });
  dir = await mkdtemp(path.join(tmpdir(), 'ucweb-sim-'));
  await writeFile(path.join(dir, `${String(version.hostname).replace(/\.local$/, '')}.key`), key.api_key);
  await writeFile(path.join(dir, 'pin.hash'), await hashPin(PIN));

  target = (await sim('POST', '/api/activities', { name: { en: `${RUN} target` } })).entity_id;
  watch = (await sim('POST', '/api/activities', { name: { en: `${RUN} watch` }, description: { en: 'made by the ucweb simulator suite' } })).entity_id;
  await sim('PATCH', `/api/activities/${watch}`, { options: { entity_ids: [target] } });
  await sim('PATCH', `/api/activities/${watch}/buttons/VOLUME_UP`, { short_press: { entity_id: target, cmd_id: 'activity.start' } });
  await sim('PATCH', `/api/activities/${watch}/buttons/VOLUME_DOWN`, { long_press: { entity_id: target, cmd_id: 'activity.start' } });

  remote = new Remote({ address: SIM, keysDir: dir, reconnectDelays: [500, 1000, 2000] });
  remote.start();
  await waitFor(() => remote.snapshot().online, { timeoutMs: 15000, message: `ucweb online with ${SIM}: ${remote.snapshot().problem}` });

  const auth = new Auth({ configDir: dir });
  await auth.init();
  server = createServer({ remotes: [remote], publicDir, themes: await discoverThemes(publicDir), defaultTheme: 'miyara', auth, version: await assetVersion(publicDir) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ pin: PIN }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  remote?.stop();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (room) await sim('DELETE', `/api/activity_groups/${room}`).catch(() => {});
  for (const made of await sim('GET', '/api/auth/api_keys').catch(() => [])) {
    if (made.name === 'ucweb') await sim('DELETE', `/api/auth/api_keys/${made.key_id}`).catch(() => {});
  }
  for (const id of [watch, target]) {
    if (id) await sim('DELETE', `/api/activities/${id}`).catch(() => {});
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('the device, firmware, battery and power mode come from the simulator', async () => {
  const version = await simReady();
  const battery = await sim('GET', '/api/system/power/battery');
  const power = await sim('GET', '/api/system/power');
  const snapshot = remote.snapshot();
  assert.equal(snapshot.name, version.device_name);
  assert.equal(snapshot.model, version.model);
  assert.deepEqual(snapshot.firmware, { core: version.core, ui: version.ui ?? null, os: version.os });
  assert.deepEqual(snapshot.battery, { capacity: battery.capacity, status: battery.status });
  assert.equal(snapshot.batteryProblem, null);
  assert.equal(snapshot.powerSupply, power.power_supply);
  assert.equal(snapshot.powerMode, power.mode);
});

test('create-key makes a working ucweb key with the configurator PIN, skips it once it works, and --replace swaps it', async () => {
  const keysDir = path.join(dir, 'made-keys');
  const pin = process.env.UC_SIM_PASSWORD ?? '1234';
  const runKeys = async (argv) => {
    const out = [];
    const code = await createKeys({ argv: [SIM, ...argv], env: { UC_KEYS_DIR: keysDir }, askPin: async () => pin, log: (line) => out.push(line), warn: (line) => out.push(`! ${line}`) });
    return { code, out };
  };
  for (const made of await sim('GET', '/api/auth/api_keys')) {
    if (made.name === 'ucweb') await sim('DELETE', `/api/auth/api_keys/${made.key_id}`);
  }
  const first = await runKeys([]);
  assert.equal(first.code, 0, first.out.join('\n'));
  const file = path.join(keysDir, `${String((await simReady()).hostname).replace(/\.local$/, '')}.key`);
  const key = (await readFile(file, 'utf8')).trim();
  assert.equal((await fetch(`http://${SIM}/api/system`, { headers: { authorization: `Bearer ${key}` } })).status, 200);
  const ours = (await sim('GET', '/api/auth/api_keys')).filter((made) => made.name === 'ucweb');
  assert.equal(ours.length, 1);
  assert.deepEqual(ours[0].scopes, ['admin']);
  const again = await runKeys([]);
  assert.equal(again.code, 0);
  assert.match(again.out.join('\n'), /Nothing to do/);
  await rm(file);
  const duplicate = await runKeys([]);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.out.join('\n'), /already has a key named "ucweb"\. Run again with --replace/);
  const replaced = await runKeys(['--replace']);
  assert.equal(replaced.code, 0, replaced.out.join('\n'));
  assert.ok(replaced.out.includes(`Revoked the old ucweb key ${ours[0].key_id} on ${remote.snapshot().name}.`), replaced.out.join('\n'));
  const newKey = (await readFile(file, 'utf8')).trim();
  assert.notEqual(newKey, key);
  assert.equal((await fetch(`http://${SIM}/api/system`, { headers: { authorization: `Bearer ${key}` } })).status, 401);
  assert.equal((await fetch(`http://${SIM}/api/system`, { headers: { authorization: `Bearer ${newKey}` } })).status, 200);
  const wrong = await createKeys({ argv: [SIM, '--replace'], env: { UC_KEYS_DIR: keysDir }, askPin: async () => '0000', log: () => {}, warn: () => {} });
  assert.equal(wrong, 1);
  assert.equal((await readFile(file, 'utf8')).trim(), newKey);
});

test('the web configurator link opens the remote\'s configurator page', async () => {
  const url = remote.snapshot().configuratorUrl;
  assert.equal(url, `http://${SIM}/configurator/#/login`);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
});

test('activities made on the remote are listed with their names and states', async () => {
  const remotes = await (await ucweb('/api/remotes')).json();
  const names = Object.fromEntries(remotes[0].activities.map((activity) => [activity.id, activity]));
  assert.deepEqual(names[watch], { id: watch, name: `${RUN} watch`, description: 'made by the ucweb simulator suite', state: 'OFF' });
  assert.equal(names[target].name, `${RUN} target`);
});

test('the button list matches the mapping the remote stores', async () => {
  const buttons = new Map((await (await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/buttons`)).json()).map((button) => [button.button, button]));
  assert.deepEqual(buttons.get('VOLUME_UP'), { button: 'VOLUME_UP', mapped: true, fallback: false, long: false });
  assert.deepEqual(buttons.get('DPAD_UP'), { button: 'DPAD_UP', mapped: false, fallback: false, long: false });
});

test('starting an activity turns it on at the remote and the live event reaches ucweb', async () => {
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/power`, { method: 'POST', body: '{"on":true}' });
  assert.equal(response.status, 200);
  await waitFor(async () => (await simActivity(watch)).attributes.state === 'ON', { timeoutMs: 10000, message: 'simulator activity ON' });
  await waitFor(() => ucwebActivity(watch)?.state === 'ON', { timeoutMs: 10000, message: 'ucweb saw ON live' });
});

test('a mapped button runs its command on the remote', async () => {
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/buttons/VOLUME_UP`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  await waitFor(async () => (await simActivity(target)).attributes.state === 'ON', { timeoutMs: 10000, message: 'button started the target activity' });
  await waitFor(() => ucwebActivity(target)?.state === 'ON', { timeoutMs: 10000, message: 'ucweb saw the target ON live' });
});

test('activity pages made on the remote are served with their items and widget states', async () => {
  page = (await sim('POST', `/api/activities/${watch}/ui/pages`, {
    name: `${RUN} page`,
    items: [
      { type: 'text', text: 'Stop target', command: { entity_id: target, cmd_id: 'activity.off' }, location: { x: 0, y: 0 }, size: { width: 2, height: 1 } },
      { type: 'icon', icon: 'uc:gear', location: { x: 2, y: 0 } },
    ],
  })).page_id;
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/pages`);
  assert.equal(response.status, 200);
  const { pages, entities } = await response.json();
  const made = pages.find((candidate) => candidate.id === page);
  assert.equal(made.name, `${RUN} page`);
  assert.deepEqual(made.grid, (await sim('GET', `/api/activities/${watch}/ui/pages/${page}`)).grid);
  assert.deepEqual(made.items.map((item) => [item.index, item.type, item.text, item.icon, item.action]), [
    [0, 'text', 'Stop target', null, true],
    [1, 'icon', null, 'uc:gear', false],
  ]);
  assert.deepEqual(entities, {});
});

test('a page button runs the command the page stores on the remote', async () => {
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/pages/${page}/items/0`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  await waitFor(async () => (await simActivity(target)).attributes.state === 'OFF', { timeoutMs: 10000, message: 'the page button stopped the target' });
  assert.equal((await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/pages/${page}/items/1`, { method: 'POST', body: '{}' })).status, 409);
});

test('editing a page on the remote reaches ucweb live', async () => {
  const announced = [];
  const listener = (activityId) => announced.push(activityId);
  remote.on('pages', listener);
  try {
    await sim('PATCH', `/api/activities/${watch}/ui/pages/${page}`, { name: `${RUN} renamed page` });
    await waitFor(() => announced.includes(watch), { timeoutMs: 10000, message: 'ucweb heard the page edit' });
  } finally {
    remote.off('pages', listener);
  }
  const { pages } = await (await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/pages`)).json();
  assert.equal(pages.find((candidate) => candidate.id === page).name, `${RUN} renamed page`);
});

test('an activity group made on the remote becomes a room, and turning the room off stops what runs in it', async () => {
  assert.equal((await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/power`, { method: 'POST', body: '{"on":true}' })).status, 200);
  await waitFor(async () => (await simActivity(watch)).attributes.state === 'ON', { timeoutMs: 10000, message: 'watch ON at the simulator' });
  room = (await sim('POST', '/api/activity_groups', { name: { en: `${RUN} room` }, activity_ids: [watch, target] })).group_id;
  await sim('PATCH', `/api/activities/${watch}`, { description: { en: 'grouped by the ucweb simulator suite' } });
  const listed = await waitFor(() => remote.snapshot().groups?.find((group) => group.id === room), { timeoutMs: 10000, message: `ucweb read the group: ${JSON.stringify(remote.snapshot().groups)}` });
  assert.equal(listed.name, `${RUN} room`);
  assert.deepEqual([...listed.activityIds].sort(), [watch, target].sort());
  await waitFor(() => remote.snapshot().groups.find((group) => group.id === room).state === 'ACTIVE', { timeoutMs: 10000, message: 'room ACTIVE' });
  const running = [];
  for (const id of listed.activityIds) {
    const state = (await simActivity(id)).attributes.state;
    await waitFor(() => ucwebActivity(id)?.state === state, { timeoutMs: 10000, message: `ucweb agrees ${id} is ${state}` });
    if (['ON', 'RUNNING'].includes(state)) running.push(id);
  }
  assert.ok(running.length > 0, 'something in the room is on at the simulator');
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/groups/${room}/off`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).stopped, running.map((id) => ucwebActivity(id).name));
  for (const id of running) {
    await waitFor(async () => (await simActivity(id)).attributes.state === 'OFF', { timeoutMs: 10000, message: `the room off stopped ${id}` });
  }
  await waitFor(() => remote.snapshot().groups.find((group) => group.id === room).state === 'OFF', { timeoutMs: 10000, message: 'room OFF live' });
});

test('an unmapped button is refused before it reaches the remote', async () => {
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/buttons/DPAD_UP`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 409);
});

test('turning activities off turns them off at the remote', async () => {
  for (const id of [watch, target]) {
    const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${id}/power`, { method: 'POST', body: '{"on":false}' });
    assert.equal(response.status, 200);
    await waitFor(async () => (await simActivity(id)).attributes.state === 'OFF', { timeoutMs: 10000, message: `${id} OFF at the simulator` });
    await waitFor(() => ucwebActivity(id)?.state === 'OFF', { timeoutMs: 10000, message: `ucweb saw ${id} OFF` });
  }
});

test('a button with only a long press is listed as such, and holding it runs the long press on the remote', async () => {
  const buttons = new Map((await (await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/buttons`)).json()).map((button) => [button.button, button]));
  assert.deepEqual(buttons.get('VOLUME_DOWN'), { button: 'VOLUME_DOWN', mapped: false, fallback: false, long: true });
  assert.equal(buttons.get('VOLUME_UP').long, false);
  const route = `/api/remotes/${encodeURIComponent(SIM)}/activities/${watch}/buttons/VOLUME_DOWN`;
  assert.equal((await ucweb(route, { method: 'POST', body: '{}' })).status, 409);
  assert.equal((await simActivity(target)).attributes.state, 'OFF');
  assert.equal((await ucweb(route, { method: 'POST', body: '{"long":true}' })).status, 200);
  await waitFor(async () => (await simActivity(target)).attributes.state === 'ON', { timeoutMs: 10000, message: 'the long press started the target' });
});

test('renaming an activity on the remote shows up in ucweb live', async () => {
  await sim('PATCH', `/api/activities/${watch}`, { name: { en: `${RUN} renamed` } });
  await waitFor(() => ucwebActivity(watch)?.name === `${RUN} renamed`, { timeoutMs: 10000, message: 'ucweb saw the new name' });
});

test('deleting an activity on the remote removes it from ucweb live', async () => {
  await sim('DELETE', `/api/activities/${target}`);
  await waitFor(() => ucwebActivity(target) === undefined, { timeoutMs: 10000, message: 'ucweb dropped the deleted activity' });
  target = null;
});

test('a system command other than reboot or power off never reaches the remote', async () => {
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/system`, { method: 'POST', body: '{"command":"RESTART"}' });
  assert.equal(response.status, 400);
  assert.ok(remote.snapshot().online);
});

test('reboot is accepted by the remote and ucweb shows it offline', async () => {
  await sim('DELETE', `/api/activities/${watch}`);
  watch = null;
  const response = await ucweb(`/api/remotes/${encodeURIComponent(SIM)}/system`, { method: 'POST', body: '{"command":"REBOOT"}' });
  assert.equal(response.status, 200);
  await waitFor(() => !remote.snapshot().online, { timeoutMs: 20000, message: 'ucweb offline after reboot' });
});
