import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { localizedText, Remote } from '../src/remote.js';
import { activity, HOSTNAME, KEY, mapping, startFakeRemote, waitFor } from './helpers/fake-remote.js';

let keysDir;
let fake;
let remote;

async function connect(options = {}, { writeKey = true } = {}) {
  fake = await startFakeRemote(options);
  if (writeKey) await writeFile(path.join(keysDir, `${HOSTNAME}.key`), `${KEY}\n`);
  remote = new Remote({ address: fake.address, keysDir, reconnectDelays: [20], heartbeatMs: 60000, powerPollMs: 60000 });
  remote.start();
  return remote;
}

beforeEach(async () => {
  keysDir = await mkdtemp(path.join(tmpdir(), 'ucweb-keys-'));
});

afterEach(async () => {
  remote?.stop();
  remote = null;
  await fake?.close();
  fake = null;
  await rm(keysDir, { recursive: true, force: true });
});

test('localized names prefer English and fall back to any language', () => {
  assert.equal(localizedText({ en: 'Watch TV', de: 'Fernsehen' }), 'Watch TV');
  assert.equal(localizedText({ de: 'Fernsehen' }), 'Fernsehen');
  assert.equal(localizedText('Plain'), 'Plain');
  assert.equal(localizedText(null), null);
});

test('connecting loads the device, battery, power mode and activities', async () => {
  await connect();
  const snapshot = await waitFor(() => remote.snapshot().online && remote.snapshot(), { message: 'online' });
  assert.equal(snapshot.name, 'Test Den');
  assert.equal(snapshot.model, 'UCR3');
  assert.deepEqual(snapshot.firmware, { core: '1.0', ui: '1.1', os: '2.0' });
  assert.deepEqual(snapshot.battery, { capacity: 80, status: 'DISCHARGING' });
  assert.equal(snapshot.powerSupply, false);
  assert.equal(snapshot.batteryProblem, null);
  assert.equal(snapshot.powerMode, 'NORMAL');
  assert.deepEqual(snapshot.activities, [{ id: 'act.tv', name: 'Watch TV', description: 'Watch TV description', state: 'OFF' }]);
  assert.equal(snapshot.problem, null);
});

test('a remote that cannot read its battery stays online with the battery unknown and the reason kept', async () => {
  await connect({ batteryError: true });
  const snapshot = await waitFor(() => remote.snapshot().online && remote.snapshot(), { message: 'online' });
  assert.equal(snapshot.battery, null);
  assert.equal(snapshot.batteryProblem, 'Test Den answered HTTP 400 to GET /api/system/power/battery: Invalid argument (os error 22)');
  assert.equal(snapshot.powerMode, 'NORMAL');
  assert.equal(snapshot.activities.length, 1);
  assert.equal(snapshot.problem, null);
});

test('the power supply is reported even when the battery cannot be read', async () => {
  fake = await startFakeRemote({ batteryError: true });
  fake.state.powerSupply = true;
  await writeFile(path.join(keysDir, `${HOSTNAME}.key`), KEY);
  remote = new Remote({ address: fake.address, keysDir, reconnectDelays: [20] });
  remote.start();
  const snapshot = await waitFor(() => remote.snapshot().online && remote.snapshot(), { message: 'online' });
  assert.equal(snapshot.battery, null);
  assert.equal(snapshot.powerSupply, true);
});

test('a battery reading that arrives later clears the battery problem', async () => {
  await connect({ batteryError: true });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  fake.emit('battery_status', { capacity: 55, status: 'CHARGING', power_supply: true });
  await waitFor(() => remote.snapshot().battery?.capacity === 55, { message: 'battery' });
  assert.equal(remote.snapshot().batteryProblem, null);
  assert.equal(remote.snapshot().powerSupply, true);
});

test('every activity is loaded across pages of 100', async () => {
  const many = Array.from({ length: 150 }, (_, i) => activity(`act.${String(i).padStart(3, '0')}`, `Activity ${String(i).padStart(3, '0')}`));
  await connect({ activities: many });
  const snapshot = await waitFor(() => remote.snapshot().online && remote.snapshot(), { message: 'online' });
  assert.equal(snapshot.activities.length, 150);
  assert.deepEqual(fake.state.pageRequests, [{ page: 1, limit: 100 }, { page: 2, limit: 100 }]);
});

test('disabled activities are not listed', async () => {
  await connect({ activities: [activity('act.a', 'Shown'), activity('act.b', 'Hidden', 'OFF', { enabled: false })] });
  const snapshot = await waitFor(() => remote.snapshot().online && remote.snapshot(), { message: 'online' });
  assert.deepEqual(snapshot.activities.map((item) => item.name), ['Shown']);
});

test('a missing API key keeps the remote offline and names the expected file', async () => {
  await connect({}, { writeKey: false });
  const snapshot = await waitFor(() => remote.snapshot().problem && remote.snapshot(), { message: 'problem' });
  assert.equal(snapshot.online, false);
  assert.match(snapshot.problem, new RegExp(`No API key for Test Den: expected .*${HOSTNAME}\\.key`));
});

test('a rejected API key keeps the remote offline with a fix', async () => {
  fake = await startFakeRemote();
  await writeFile(path.join(keysDir, `${HOSTNAME}.key`), 'wrong-key');
  remote = new Remote({ address: fake.address, keysDir, reconnectDelays: [1000] });
  remote.start();
  const snapshot = await waitFor(() => remote.snapshot().problem && remote.snapshot(), { message: 'problem' });
  assert.equal(snapshot.online, false);
  assert.match(snapshot.problem, /refused the live connection: HTTP 401\. The API key was rejected/);
});

test('a live state change updates that activity', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.tv', event_type: 'CHANGE', new_state: { attributes: { state: 'RUNNING', step: { index: 1 } } } });
  await waitFor(() => remote.snapshot().activities[0].state === 'RUNNING', { message: 'RUNNING' });
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.tv', event_type: 'CHANGE', new_state: { attributes: { state: 'ON' } } });
  await waitFor(() => remote.snapshot().activities[0].state === 'ON', { message: 'ON' });
});

test('live activity add, rename and delete events are applied', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.new', event_type: 'NEW', new_state: activity('act.new', 'Added') });
  await waitFor(() => remote.snapshot().activities.some((item) => item.name === 'Added'), { message: 'added' });
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.tv', event_type: 'CHANGE', new_state: activity('act.tv', 'Renamed', 'ON') });
  await waitFor(() => remote.snapshot().activities.some((item) => item.name === 'Renamed' && item.state === 'ON'), { message: 'renamed' });
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.new', event_type: 'DELETE' });
  await waitFor(() => !remote.snapshot().activities.some((item) => item.id === 'act.new'), { message: 'deleted' });
});

test('a change event without an entity reloads every activity', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  fake.state.activities = [activity('act.x', 'Fresh')];
  fake.emit('entity_change', { entity_type: 'activity', event_type: 'CHANGE' });
  await waitFor(() => remote.snapshot().activities.map((item) => item.name).join() === 'Fresh', { message: 'reload' });
});

test('battery and power mode events update the status', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  fake.emit('battery_status', { capacity: 42, status: 'CHARGING', power_supply: true });
  await waitFor(() => remote.snapshot().battery?.capacity === 42, { message: 'battery' });
  assert.deepEqual(remote.snapshot().battery, { capacity: 42, status: 'CHARGING' });
  assert.equal(remote.snapshot().powerSupply, true);
  fake.emit('power_mode_change', { mode: 'LOW_POWER' });
  await waitFor(() => remote.snapshot().powerMode === 'LOW_POWER', { message: 'power mode' });
});

test('start and stop send activity.on and activity.off to the activity', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  await remote.setActivityPower('act.tv', true);
  await remote.setActivityPower('act.tv', false);
  assert.deepEqual(fake.state.commands, [
    { entityId: 'act.tv', body: { cmd_id: 'activity.on' } },
    { entityId: 'act.tv', body: { cmd_id: 'activity.off' } },
  ]);
  await assert.rejects(remote.setActivityPower('act.missing', true), { status: 404 });
});

test('a mapped button sends its command to the mapped entity', async () => {
  await connect({ buttonMappings: { 'act.tv': mapping('media.tv') } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  await remote.press('act.tv', 'DPAD_UP');
  await remote.press('act.tv', 'VOLUME_UP');
  assert.deepEqual(fake.state.commands, [
    { entityId: 'media.tv', body: { cmd_id: 'remote.send', params: { command: 'CURSOR_UP' } } },
    { entityId: 'media.tv', body: { cmd_id: 'media_player.volume_up' } },
  ]);
  assert.equal(fake.state.activityDetailRequests, 1);
});

test('an unmapped button is refused and an absent one is not found', async () => {
  await connect({ buttonMappings: { 'act.tv': mapping('media.tv') } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  await assert.rejects(remote.press('act.tv', 'BACK'), { status: 409, message: 'BACK does nothing in Watch TV.' });
  await assert.rejects(remote.press('act.tv', 'RECORD'), { status: 404 });
  assert.deepEqual(fake.state.commands, []);
});

test('the button list reports which buttons are mapped', async () => {
  await connect({ buttonMappings: { 'act.tv': mapping('media.tv') } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  assert.deepEqual(await remote.buttons('act.tv'), [
    { button: 'DPAD_UP', mapped: true, fallback: false },
    { button: 'VOLUME_UP', mapped: true, fallback: false },
    { button: 'BACK', mapped: false, fallback: false },
  ]);
});

const player = (features) => ({ entity_id: 'media.tv', entity_type: 'media_player', features });
const dpadOnly = [
  { button: 'DPAD_UP', short_press: { entity_id: 'media.tv', cmd_id: 'media_player.cursor_up' } },
  { button: 'BACK' },
  { button: 'HOME' },
  { button: 'MENU' },
  { button: 'STOP' },
  { button: 'RECORD' },
];

test('unmapped buttons go to the device the D-pad drives when it reports the feature', async () => {
  await connect({ buttonMappings: { 'act.tv': dpadOnly }, entities: { 'media.tv': player(['dpad', 'home', 'menu', 'stop', 'record']) } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  assert.deepEqual(await remote.buttons('act.tv'), [
    { button: 'DPAD_UP', mapped: true, fallback: false },
    { button: 'BACK', mapped: true, fallback: true },
    { button: 'HOME', mapped: true, fallback: true },
    { button: 'MENU', mapped: true, fallback: true },
    { button: 'STOP', mapped: true, fallback: true },
    { button: 'RECORD', mapped: true, fallback: true },
  ]);
  for (const button of ['BACK', 'HOME', 'MENU', 'STOP', 'RECORD']) await remote.press('act.tv', button);
  assert.deepEqual(fake.state.commands.map((command) => [command.entityId, command.body.cmd_id]), [
    ['media.tv', 'media_player.back'],
    ['media.tv', 'media_player.home'],
    ['media.tv', 'media_player.menu'],
    ['media.tv', 'media_player.stop'],
    ['media.tv', 'media_player.record'],
  ]);
});

test('a fallback needs the device to report the matching feature', async () => {
  await connect({ buttonMappings: { 'act.tv': dpadOnly }, entities: { 'media.tv': player(['dpad', 'stop']) } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  const mapped = Object.fromEntries((await remote.buttons('act.tv')).map((entry) => [entry.button, entry.mapped]));
  assert.deepEqual(mapped, { DPAD_UP: true, BACK: false, HOME: false, MENU: false, STOP: true, RECORD: false });
  await assert.rejects(remote.press('act.tv', 'HOME'), { status: 409 });
});

test('back falls back when the device reports any menu it can leave', async () => {
  for (const feature of ['home', 'menu', 'guide', 'info']) {
    await connect({ buttonMappings: { 'act.tv': dpadOnly }, entities: { 'media.tv': player(['dpad', feature]) } });
    await waitFor(() => remote.snapshot().online, { message: 'online' });
    const back = (await remote.buttons('act.tv')).find((entry) => entry.button === 'BACK');
    assert.equal(back.mapped, true, feature);
    remote.stop();
    await fake.close();
  }
  fake = null;
});

test('no fallback when the D-pad drives something other than a media player', async () => {
  await connect({ buttonMappings: { 'act.tv': dpadOnly }, entities: { 'media.tv': { entity_id: 'media.tv', entity_type: 'remote', features: ['send', 'home', 'menu'] } } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  assert.equal((await remote.buttons('act.tv')).filter((entry) => entry.mapped).length, 1);
});

test('no fallback when the D-pad device is missing on the remote', async () => {
  await connect({ buttonMappings: { 'act.tv': dpadOnly }, entities: {} });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  assert.equal((await remote.buttons('act.tv')).filter((entry) => entry.mapped).length, 1);
});

test('a button the activity maps is never replaced by a fallback', async () => {
  const mapping = [...dpadOnly.filter((entry) => entry.button !== 'HOME'), { button: 'HOME', short_press: { entity_id: 'media.amp', cmd_id: 'media_player.home' } }];
  await connect({ buttonMappings: { 'act.tv': mapping }, entities: { 'media.tv': player(['dpad', 'home']) } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  await remote.press('act.tv', 'HOME');
  assert.deepEqual(fake.state.commands, [{ entityId: 'media.amp', body: { cmd_id: 'media_player.home' } }]);
  assert.equal((await remote.buttons('act.tv')).find((entry) => entry.button === 'HOME').fallback, false);
});

test('editing an activity refreshes its button mapping', async () => {
  await connect({ buttonMappings: { 'act.tv': mapping('media.tv') } });
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  await remote.press('act.tv', 'VOLUME_UP');
  fake.state.buttonMappings['act.tv'] = [{ button: 'VOLUME_UP', short_press: { entity_id: 'media.amp', cmd_id: 'media_player.volume_up' } }];
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.tv', event_type: 'CHANGE', new_state: activity('act.tv', 'Watch TV 2') });
  await waitFor(() => remote.snapshot().activities[0].name === 'Watch TV 2', { message: 'renamed' });
  await remote.press('act.tv', 'VOLUME_UP');
  assert.equal(fake.state.commands.at(-1).entityId, 'media.amp');
  assert.equal(fake.state.activityDetailRequests, 2);
});

test('a dropped connection goes offline and reconnects', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  const seen = [];
  remote.on('change', (snapshot) => seen.push(snapshot.online));
  fake.dropConnections();
  await waitFor(() => seen.includes(false), { message: 'offline' });
  await waitFor(() => remote.snapshot().online && fake.connectionCount() === 1, { message: 'reconnected' });
});

test('stop closes the live connection and does not reconnect', async () => {
  await connect();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
  remote.stop();
  await waitFor(() => fake.connectionCount() === 0, { message: 'closed' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fake.connectionCount(), 0);
});
