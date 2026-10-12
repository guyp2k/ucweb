import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('UC_REMOTES must list at least one remote', () => {
  assert.throws(() => loadConfig({}), /UC_REMOTES must list at least one remote/);
  assert.throws(() => loadConfig({ UC_REMOTES: ' , ' }), /UC_REMOTES must list at least one remote/);
});

test('remote addresses are trimmed and keep an optional port', () => {
  const config = loadConfig({ UC_REMOTES: ' 192.168.1.20 , remote.local:8080 ' });
  assert.deepEqual(config.remotes, ['192.168.1.20', 'remote.local:8080']);
});

test('a remote address with a scheme or path is rejected', () => {
  assert.throws(() => loadConfig({ UC_REMOTES: 'http://192.168.1.20' }), /not a host name or IP address/);
  assert.throws(() => loadConfig({ UC_REMOTES: '192.168.1.20/api' }), /not a host name or IP address/);
});

test('the same remote cannot be listed twice', () => {
  assert.throws(() => loadConfig({ UC_REMOTES: '10.0.0.1,10.0.0.1' }), /same remote more than once/);
});

test('PORT must be a whole number from 1 to 65535', () => {
  assert.equal(loadConfig({ UC_REMOTES: 'a', PORT: '3000' }).port, 3000);
  assert.equal(loadConfig({ UC_REMOTES: 'a' }).port, 8080);
  for (const bad of ['0', '70000', '8080.5', 'abc']) {
    assert.throws(() => loadConfig({ UC_REMOTES: 'a', PORT: bad }), /PORT must be a whole number/);
  }
});

test('the keys folder defaults to keys inside the config folder', () => {
  assert.equal(loadConfig({ UC_REMOTES: 'a' }).keysDir, '/config/keys');
  assert.equal(loadConfig({ UC_REMOTES: 'a', UCWEB_CONFIG_DIR: '/data' }).keysDir, '/data/keys');
  assert.equal(loadConfig({ UC_REMOTES: 'a', UC_KEYS_DIR: '/secrets' }).keysDir, '/secrets');
});

test('the default theme is miyara unless UCWEB_THEME names another', () => {
  assert.equal(loadConfig({ UC_REMOTES: 'a' }).defaultTheme, 'miyara');
  assert.equal(loadConfig({ UC_REMOTES: 'a', UCWEB_THEME: 'brookwood' }).defaultTheme, 'brookwood');
});
