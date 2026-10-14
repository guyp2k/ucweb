import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { parseArgs, run } from '../src/create-key.js';
import { HOSTNAME, KEY, startFakeRemote } from './helpers/fake-remote.js';

let dir;
let fake;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ucweb-create-key-'));
});

afterEach(async () => {
  await fake?.close();
  fake = null;
  await rm(dir, { recursive: true, force: true });
});

async function runWith(argv, pins = ['1234'], env = {}) {
  const out = [];
  const asked = [];
  const code = await run({
    argv,
    env: { UCWEB_CONFIG_DIR: dir, ...env },
    askPin: async (question) => {
      asked.push(question);
      return pins.shift();
    },
    log: (line) => out.push(line),
    warn: (line) => out.push(`! ${line}`),
  });
  return { code, out, asked };
}

const keyPath = () => path.join(dir, 'keys', `${HOSTNAME}.key`);

test('with no address it works through every remote in UC_REMOTES, and the options are checked', () => {
  assert.deepEqual(parseArgs([], { UC_REMOTES: '10.0.0.1, 10.0.0.2', UCWEB_CONFIG_DIR: '/c' }), { addresses: ['10.0.0.1', '10.0.0.2'], mode: 'create', keysDir: '/c/keys' });
  assert.deepEqual(parseArgs(['10.0.0.9', '--replace'], { UC_REMOTES: '10.0.0.1', UC_KEYS_DIR: '/k' }), { addresses: ['10.0.0.9'], mode: 'replace', keysDir: '/k' });
  assert.equal(parseArgs(['--check'], { UC_REMOTES: '10.0.0.1' }).mode, 'check');
  assert.throws(() => parseArgs(['--force'], { UC_REMOTES: '10.0.0.1' }), /Unknown option --force/);
  assert.throws(() => parseArgs(['--replace', '--check'], { UC_REMOTES: '10.0.0.1' }), /not both/);
  assert.throws(() => parseArgs([], {}), /Name a remote, or set UC_REMOTES/);
});

test('a new key is created with the PIN, named ucweb with admin scope, and stored as <hostname>.key readable only by its owner', async () => {
  fake = await startFakeRemote({ deviceName: 'Living Room' });
  const { code, out, asked } = await runWith([fake.address]);
  assert.equal(code, 0);
  assert.deepEqual(asked, [`Web-configurator PIN for Living Room (${fake.address}): `]);
  assert.deepEqual(fake.state.keyBody, { name: 'ucweb', scopes: ['admin'], description: 'ucweb web remote' });
  assert.equal(await readFile(keyPath(), 'utf8'), KEY);
  assert.equal((await stat(keyPath())).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(keyPath()))).mode & 0o777, 0o700);
  assert.deepEqual(out, [
    `Created the ucweb key for Living Room and stored it in ${keyPath()}.`,
    `The key in ${keyPath()} works on Living Room (${fake.address}).`,
    'ucweb picks the keys up on its own within 30 seconds; no restart needed.',
  ]);
});

test('a wrong PIN creates nothing and writes no file', async () => {
  fake = await startFakeRemote({ deviceName: 'Living Room' });
  const { code, out } = await runWith([fake.address], ['9999']);
  assert.equal(code, 1);
  assert.deepEqual(out, ['! Living Room did not accept that PIN. Nothing was created.']);
  assert.deepEqual(fake.state.apiKeys, []);
  await assert.rejects(stat(keyPath()), { code: 'ENOENT' });
});

test('a remote whose stored key works is left alone, without asking for a PIN', async () => {
  fake = await startFakeRemote({ deviceName: 'Living Room' });
  await mkdir(path.dirname(keyPath()), { recursive: true });
  await writeFile(keyPath(), KEY);
  const { code, out, asked } = await runWith([fake.address]);
  assert.equal(code, 0);
  assert.deepEqual(asked, []);
  assert.deepEqual(fake.state.keyRequests, []);
  assert.match(out[0], /works on Living Room/);
  assert.match(out[1], /Nothing to do\. Use --replace/);
});

test('a remote that already has a ucweb key says to use --replace, and --replace revokes it and stores a new one', async () => {
  fake = await startFakeRemote({ deviceName: 'Living Room', apiKeys: [{ key_id: 'old-1', name: 'ucweb' }, { key_id: 'other', name: 'homeassistant' }] });
  const first = await runWith([fake.address]);
  assert.equal(first.code, 1);
  assert.deepEqual(first.out, ['! Living Room already has a key named "ucweb". Run again with --replace to revoke it and issue a new one.']);
  await assert.rejects(stat(keyPath()), { code: 'ENOENT' });
  const second = await runWith([fake.address, '--replace']);
  assert.equal(second.code, 0);
  assert.ok(second.out.includes('Revoked the old ucweb key old-1 on Living Room.'));
  assert.deepEqual(fake.state.apiKeys.map((entry) => entry.name).sort(), ['homeassistant', 'ucweb']);
  assert.ok(!fake.state.apiKeys.some((entry) => entry.key_id === 'old-1'));
  assert.equal(await readFile(keyPath(), 'utf8'), KEY);
});

test('a stored key the remote rejects is reported, and a new key replaces the file', async () => {
  fake = await startFakeRemote({ deviceName: 'Living Room' });
  await mkdir(path.dirname(keyPath()), { recursive: true });
  await writeFile(keyPath(), 'stale-key');
  const { code, out } = await runWith([fake.address]);
  assert.equal(code, 0);
  assert.equal(out[0], `Living Room (${fake.address}) rejects the key in ${keyPath()}.`);
  assert.equal(await readFile(keyPath(), 'utf8'), KEY);
});

test('--check reports each key without asking for a PIN or changing anything, and fails when one is missing', async () => {
  fake = await startFakeRemote({ deviceName: 'Living Room' });
  const missing = await runWith([fake.address, '--check']);
  assert.equal(missing.code, 1);
  assert.deepEqual(missing.asked, []);
  assert.deepEqual(missing.out, [`Living Room (${fake.address}) has no key yet: expected ${keyPath()}.`]);
  await mkdir(path.dirname(keyPath()), { recursive: true });
  await writeFile(keyPath(), KEY);
  const works = await runWith([fake.address, '--check']);
  assert.equal(works.code, 0);
  assert.deepEqual(works.out, [`The key in ${keyPath()} works on Living Room (${fake.address}).`]);
  assert.deepEqual(fake.state.keyRequests, []);
});

test('a remote that does not answer is reported and the next remote is still done', async () => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const gone = `127.0.0.1:${closed.address().port}`;
  await new Promise((resolve) => closed.close(resolve));
  fake = await startFakeRemote({ deviceName: 'Living Room' });
  const { code, out } = await runWith([], ['1234'], { UC_REMOTES: `${gone},${fake.address}` });
  assert.equal(code, 1);
  assert.equal(out[0], `! No Unfolded Circle remote answered at ${gone} (ECONNREFUSED).`);
  assert.match(out[1], /Created the ucweb key for Living Room/);
  assert.equal(await readFile(keyPath(), 'utf8'), KEY);
});

test('every place that tells you how to make a key names the create-key command, and the old script is gone', async () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['create-key'], 'node src/create-key.js');
  await assert.rejects(stat(path.join(root, 'scripts', 'create-api-key.sh')), { code: 'ENOENT' });
  for (const file of ['README.md', 'src/remote.js', 'unraid/ucweb.xml']) {
    const text = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /create-api-key/, file);
    assert.match(text, /docker exec -it ucweb npm run create-key/, file);
  }
});
