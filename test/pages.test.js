import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Remote, toEntityView, toPages } from '../src/remote.js';
import { activity, HOSTNAME, KEY, startFakeRemote, waitFor } from './helpers/fake-remote.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const ui = {
  pages: [
    {
      page_id: 'main',
      name: 'DMP-A10',
      grid: { width: 4, height: 6 },
      items: [
        { type: 'media_player', media_player_id: 'media.dmp', location: { x: 0, y: 0 }, size: { width: 4, height: 4 } },
        { type: 'text', text: 'Info', command: { entity_id: 'remote.dmp', cmd_id: 'Info', params: {} }, location: { x: 0, y: 4 }, size: { width: 2, height: 1 } },
        { type: 'text', text: 'Mute', command: { entity_id: 'media.dmp', cmd_id: 'media_player.mute_toggle' }, location: { x: 2, y: 4 }, size: { width: 2, height: 1 } },
      ],
    },
    {
      page_id: 'sources',
      name: 'Sources',
      grid: { width: 3, height: 7 },
      items: [
        { type: 'text', text: 'Input Sources', location: { x: 0, y: 0 }, size: { width: 3, height: 1 } },
        { type: 'icon', icon: 'custom:usb.png', command: { entity_id: 'media.dmp', cmd_id: 'media_player.select_source', params: { source: 'USB-B In' } }, location: { x: 0, y: 1 } },
        { type: 'icon', icon: 'uc:angles-up', location: { x: 1, y: 1 } },
        { type: 'sensor', sensor: { sensor_id: 'sensor.volume', show_label: true, show_unit: false }, location: { x: 0, y: 2 }, size: { width: 2, height: 1 } },
        { type: 'select', select: { select_id: 'select.output' }, location: { x: 0, y: 3 }, size: { width: 3, height: 1 } },
      ],
    },
  ],
};

const entities = {
  'media.dmp': {
    entity_id: 'media.dmp',
    entity_type: 'media_player',
    name: { en: 'ES-DMP-A10' },
    attributes: { state: 'PLAYING', media_title: 'So What', media_artist: 'Miles Davis', media_album: 'Kind of Blue', media_duration: 545, media_position: 30, media_image_url: '' },
  },
  'sensor.volume': { entity_id: 'sensor.volume', entity_type: 'sensor', name: { en: 'DMP Volume' }, options: { custom_unit: '%' }, attributes: { state: 'ON', value: '42' } },
  'select.output': { entity_id: 'select.output', entity_type: 'select', name: { en: 'Output' }, attributes: { state: 'ON', current_option: 'XLR', options: ['XLR', 'RCA'] } },
};

let keysDir;
let fake;
let remote;

async function connect(options = {}) {
  fake = await startFakeRemote({ uis: { 'act.tv': structuredClone(ui) }, entities: structuredClone(entities), ...options });
  await writeFile(path.join(keysDir, `${HOSTNAME}.key`), KEY);
  remote = new Remote({ address: fake.address, keysDir, reconnectDelays: [20], heartbeatMs: 60000, powerPollMs: 60000 });
  remote.start();
  await waitFor(() => remote.snapshot().online, { message: 'online' });
}

beforeEach(async () => {
  keysDir = await mkdtemp(path.join(tmpdir(), 'ucweb-pages-'));
});

afterEach(async () => {
  remote?.stop();
  remote = null;
  await fake?.close();
  fake = null;
  await rm(keysDir, { recursive: true, force: true });
});

test('pages keep the remote\'s order, names, grid sizes and item positions', () => {
  const { pages } = toPages(ui);
  assert.deepEqual(pages.map((page) => [page.id, page.name, page.grid]), [
    ['main', 'DMP-A10', { width: 4, height: 6 }],
    ['sources', 'Sources', { width: 3, height: 7 }],
  ]);
  assert.deepEqual(pages[0].items[1], { index: 1, type: 'text', x: 0, y: 4, width: 2, height: 1, text: 'Info', icon: null, hint: null, action: true, entityId: null });
  assert.deepEqual(pages[1].items[1], { index: 1, type: 'icon', x: 0, y: 1, width: 1, height: 1, text: null, icon: 'custom:usb.png', hint: 'USB-B In', action: true, entityId: null });
  assert.deepEqual(pages[1].items[3], { index: 3, type: 'sensor', x: 0, y: 2, width: 2, height: 1, text: null, icon: null, hint: null, action: false, entityId: 'sensor.volume', showLabel: true, showUnit: false });
  assert.equal(pages[1].items[2].action, false);
  assert.equal(pages[1].items[2].hint, null);
});

test('an icon\'s hint is the source it selects, or else the command it runs, and a blank source gives no hint', () => {
  const icon = (command) => toPages({ pages: [{ page_id: 'p', grid: { width: 4, height: 6 }, items: [{ type: 'icon', icon: 'custom:x.png', command, location: { x: 0, y: 0 } }] }] }).pages[0].items[0].hint;
  assert.equal(icon({ entity_id: 'm', cmd_id: 'media_player.select_source', params: { source: ' Netflix ' } }), 'Netflix');
  assert.equal(icon({ entity_id: 'm', cmd_id: 'media_player.select_source', params: { source: '' } }), null);
  assert.equal(icon({ entity_id: 'r', cmd_id: 'INPUT_HDMI1', params: {} }), 'INPUT_HDMI1');
  assert.equal(icon(undefined), null);
});

test('a page without a name has a null name, not a made-up one', () => {
  const { pages } = toPages({ pages: [{ page_id: 'p', grid: { width: 4, height: 6 }, items: [] }] });
  assert.equal(pages[0].name, null);
});

test('items the page cannot place or show are left out, and pages without a grid are dropped', () => {
  const { pages, entityIds } = toPages({
    pages: [
      {
        page_id: 'p',
        grid: { width: 4, height: 6 },
        items: [
          { type: 'numpad', location: { x: 0, y: 0 } },
          { type: 'text', text: '', location: { x: 0, y: 1 } },
          { type: 'text', text: 'No place' },
          { type: 'icon', location: { x: 0, y: 2 } },
          { type: 'sensor', location: { x: 0, y: 3 } },
          { type: 'text', text: 'Kept', location: { x: 1, y: 4 } },
        ],
      },
      { page_id: 'no-grid', items: [] },
    ],
  });
  assert.deepEqual(pages.map((page) => page.id), ['p']);
  assert.deepEqual(pages[0].items.map((item) => [item.index, item.text]), [[5, 'Kept']]);
  assert.deepEqual(entityIds, []);
});

test('a command is only kept for text and icon items', () => {
  const { pages, commands } = toPages({
    pages: [{
      page_id: 'p',
      grid: { width: 4, height: 6 },
      items: [{ type: 'media_player', media_player_id: 'media.x', command: { entity_id: 'media.x', cmd_id: 'media_player.off' }, location: { x: 0, y: 0 } }],
    }],
  });
  assert.equal(pages[0].items[0].action, false);
  assert.equal(commands.size, 0);
});

test('opening the pages loads the layout and the state of every widget on them', async () => {
  await connect();
  const { pages, entities: states } = await remote.pages('act.tv');
  assert.equal(pages.length, 2);
  assert.deepEqual(Object.keys(states).sort(), ['media.dmp', 'select.output', 'sensor.volume']);
  assert.deepEqual(states['sensor.volume'], { id: 'sensor.volume', type: 'sensor', name: 'DMP Volume', state: 'ON', value: '42', unit: '%' });
  assert.deepEqual(states['select.output'], { id: 'select.output', type: 'select', name: 'Output', state: 'ON', option: 'XLR' });
  const player = states['media.dmp'];
  assert.equal(player.title, 'So What');
  assert.equal(player.artist, 'Miles Davis');
  assert.equal(player.album, 'Kind of Blue');
  assert.equal(player.duration, 545);
  assert.equal(player.image, null);
  assert.ok(player.position >= 30 && player.position < 31, String(player.position));
});

test('a widget whose entity is gone from the remote is left out of the states', async () => {
  const some = structuredClone(entities);
  delete some['sensor.volume'];
  await connect({ entities: some });
  const { entities: states } = await remote.pages('act.tv');
  assert.equal(states['sensor.volume'], undefined);
  assert.ok(states['media.dmp']);
});

test('a page button sends exactly the command the page stores', async () => {
  await connect();
  await remote.pressItem('act.tv', 'sources', 1);
  await remote.pressItem('act.tv', 'main', 1);
  await remote.pressItem('act.tv', 'main', 2);
  assert.deepEqual(fake.state.commands, [
    { entityId: 'media.dmp', body: { cmd_id: 'media_player.select_source', params: { source: 'USB-B In' } } },
    { entityId: 'remote.dmp', body: { cmd_id: 'Info' } },
    { entityId: 'media.dmp', body: { cmd_id: 'media_player.mute_toggle' } },
  ]);
  assert.equal(fake.state.uiRequests, 1);
});

test('an item without a command is refused, and an unknown page or activity is not found', async () => {
  await connect();
  await assert.rejects(remote.pressItem('act.tv', 'sources', 0), { status: 409 });
  await assert.rejects(remote.pressItem('act.tv', 'main', 0), { status: 409 });
  await assert.rejects(remote.pressItem('act.tv', 'main', 99), { status: 409 });
  await assert.rejects(remote.pressItem('act.tv', 'nope', 1), { status: 404 });
  await assert.rejects(remote.pressItem('act.zz', 'main', 1), { status: 404 });
  assert.deepEqual(fake.state.commands, []);
});

test('editing an activity reloads its pages and tells the browsers', async () => {
  await connect();
  const announced = [];
  remote.on('pages', (activityId) => announced.push(activityId));
  await remote.pressItem('act.tv', 'main', 1);
  fake.state.uis['act.tv'].pages[0].items[1].command = { entity_id: 'remote.amp', cmd_id: 'Info' };
  fake.emit('entity_change', { entity_type: 'activity', entity_id: 'act.tv', event_type: 'CHANGE', new_state: activity('act.tv', 'Watch TV') });
  await waitFor(() => announced.length === 1, { message: 'pages announced' });
  assert.deepEqual(announced, ['act.tv']);
  await remote.pressItem('act.tv', 'main', 1);
  assert.equal(fake.state.commands.at(-1).entityId, 'remote.amp');
  assert.equal(fake.state.uiRequests, 2);
});

test('live changes are sent for widgets on opened pages and ignored for anything else', async () => {
  await connect();
  const seen = [];
  remote.on('entity', (view) => seen.push(view));
  fake.emit('entity_change', { entity_type: 'sensor', entity_id: 'sensor.volume', event_type: 'CHANGE', new_state: { attributes: { value: '50' } } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seen.length, 0);
  await remote.pages('act.tv');
  fake.emit('entity_change', { entity_type: 'sensor', entity_id: 'sensor.other', event_type: 'CHANGE', new_state: { attributes: { value: '1' } } });
  fake.emit('entity_change', { entity_type: 'sensor', entity_id: 'sensor.volume', event_type: 'CHANGE', new_state: { attributes: { value: '51' } } });
  fake.emit('entity_change', { entity_type: 'media_player', entity_id: 'media.dmp', event_type: 'CHANGE', new_state: { attributes: { media_title: 'Blue in Green' } } });
  await waitFor(() => seen.length === 2, { message: 'two changes' });
  assert.deepEqual(seen[0], { id: 'sensor.volume', type: 'sensor', name: 'DMP Volume', state: 'ON', value: '51', unit: '%' });
  assert.equal(seen[1].title, 'Blue in Green');
  assert.equal(seen[1].artist, 'Miles Davis');
  fake.emit('entity_change', { entity_type: 'select', entity_id: 'select.output', event_type: 'DELETE' });
  await waitFor(() => seen.length === 3, { message: 'deleted' });
  assert.deepEqual(seen[2], { id: 'select.output', type: 'select', missing: true });
});

test('a playing position keeps counting between updates and holds still while paused', () => {
  const watched = { entity_id: 'm', entity_type: 'media_player', name: { en: 'M' }, attributes: { state: 'PLAYING', media_position: 10, media_duration: 100 }, positionAt: 1000 };
  assert.equal(toEntityView(watched, 1000).position, 10);
  assert.equal(toEntityView(watched, 6000).position, 15);
  assert.equal(toEntityView(watched, 999000).position, 100);
  watched.attributes.state = 'PAUSED';
  assert.equal(toEntityView(watched, 6000).position, 10);
});

test('pausing keeps the position reached while playing', async () => {
  await connect();
  await remote.pages('act.tv');
  const seen = [];
  remote.on('entity', (view) => seen.push(view));
  await new Promise((resolve) => setTimeout(resolve, 300));
  fake.emit('entity_change', { entity_type: 'media_player', entity_id: 'media.dmp', event_type: 'CHANGE', new_state: { attributes: { state: 'PAUSED' } } });
  await waitFor(() => seen.length === 1, { message: 'paused' });
  assert.ok(seen[0].position >= 30.25 && seen[0].position < 31, String(seen[0].position));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const { entities: states } = await remote.pages('act.tv');
  assert.equal(states['media.dmp'].position, 30);
});

test('artwork addresses are reported as a short key, never the address itself', () => {
  const view = toEntityView({ entity_id: 'm', entity_type: 'media_player', attributes: { media_image_url: 'http://192.168.60.10:9330/api/image/abc' }, positionAt: null });
  assert.match(view.image, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(view).includes('9330'));
});

test('artwork is fetched from the player\'s own address without the API key', async () => {
  await connect({ art: { 'cover.png': { type: 'image/png', body: PNG } } });
  const players = structuredClone(entities);
  players['media.dmp'].attributes.media_image_url = `http://${fake.address}/art/cover.png`;
  fake.state.entities = players;
  await remote.pages('act.tv');
  const image = await remote.mediaImage('media.dmp');
  assert.equal(image.type, 'image/png');
  assert.deepEqual(image.body, PNG);
  assert.equal(fake.state.artAuthorization, undefined);
  await remote.mediaImage('media.dmp');
  assert.equal(fake.state.artRequests, 1);
});

test('artwork in a data address is decoded without a request', async () => {
  const players = structuredClone(entities);
  players['media.dmp'].attributes.media_image_url = `data:image/png;base64,${PNG.toString('base64')}`;
  await connect({ entities: players });
  await remote.pages('act.tv');
  assert.deepEqual((await remote.mediaImage('media.dmp')).body, PNG);
});

test('artwork is refused for players not on an open page, empty players and non-images', async () => {
  await connect({ art: { 'page.html': { type: 'text/html', body: Buffer.from('<html>') } } });
  await assert.rejects(remote.mediaImage('media.dmp'), { status: 404 });
  await remote.pages('act.tv');
  await assert.rejects(remote.mediaImage('media.dmp'), { status: 404 });
  await assert.rejects(remote.mediaImage('sensor.volume'), { status: 404 });
  fake.emit('entity_change', { entity_type: 'media_player', entity_id: 'media.dmp', event_type: 'CHANGE', new_state: { attributes: { media_image_url: `http://${fake.address}/art/page.html` } } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(remote.mediaImage('media.dmp'), { status: 502 });
  fake.emit('entity_change', { entity_type: 'media_player', entity_id: 'media.dmp', event_type: 'CHANGE', new_state: { attributes: { media_image_url: 'file:///etc/passwd' } } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(remote.mediaImage('media.dmp'), { status: 502 });
});
