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
  assert.deepEqual(snapshot.battery, { capacity: 80, status: 'DISCHARGING', powerSupply: false });
  assert.equal(snapshot.powerMode, 'NORMAL');
  assert.deepEqual(snapshot.activities, [{ id: 'act.tv', name: 'Watch TV', description: 'Watch TV description', state: 'OFF' }]);
  assert.equal(snapshot.problem, null);
});

test('a remote that cannot read its battery stays online with the battery unknown', async () => {
  await connect({ batteryError: true });
  const snapshot = await waitFor(() => remote.snapshot().online && remote.snapshot(), { message: 'online' });
  assert.equal(snapshot.battery, null);
  assert.equal(snapshot.powerMode, 'NORMAL');
  assert.equal(snapshot.activities.length, 1);
  assert.equal(snapshot.problem, null);
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
  assert.deepEqual(remote.snapshot().battery, { capacity: 42, status: 'CHARGING', powerSupply: true });
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
    { button: 'DPAD_UP', mapped: true },
    { button: 'VOLUME_UP', mapped: true },
    { button: 'BACK', mapped: false },
  ]);
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
