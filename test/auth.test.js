import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Auth, COOKIE_NAME, hashPin, parseCookies, pinMatches, SESSION_SECONDS } from '../src/auth.js';

let dir;
let clock;

async function makeAuth(pin = '2468') {
  if (pin !== null) await writeFile(path.join(dir, 'pin.hash'), `${await hashPin(pin)}\n`);
  const auth = new Auth({ configDir: dir, now: () => clock });
  await auth.init();
  return auth;
}

const cookieFor = (token) => `other=1; ${COOKIE_NAME}=${token}`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ucweb-auth-'));
  clock = Date.UTC(2026, 9, 12, 12, 0, 0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a stored PIN hash matches only the PIN it was made from', async () => {
  const stored = await hashPin('1357');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await pinMatches('1357', stored), true);
  assert.equal(await pinMatches('1358', stored), false);
  assert.equal(stored.includes('1357'), false);
});

test('a PIN must be 4 to 12 digits', async () => {
  await assert.rejects(hashPin('123'), /4 to 12 digits/);
  await assert.rejects(hashPin('12a4'), /4 to 12 digits/);
  await assert.rejects(hashPin('1234567890123'), /4 to 12 digits/);
});

test('the right PIN returns a session that authenticates', async () => {
  const auth = await makeAuth();
  const token = await auth.login('2468', '10.0.0.5');
  assert.equal(await auth.isAuthenticated(cookieFor(token)), true);
  assert.equal(parseCookies(cookieFor(token))[COOKIE_NAME], token);
});

test('a wrong PIN is refused with 401', async () => {
  const auth = await makeAuth();
  await assert.rejects(auth.login('1111', '10.0.0.5'), { status: 401 });
  await assert.rejects(auth.login(1234, '10.0.0.5'), { status: 401 });
});

test('no cookie, a tampered token or a forged signature does not authenticate', async () => {
  const auth = await makeAuth();
  const token = await auth.login('2468', '10.0.0.5');
  const [expires, signature] = token.split('.');
  assert.equal(await auth.isAuthenticated(undefined), false);
  assert.equal(await auth.isAuthenticated(cookieFor(`${Number(expires) + 999}.${signature}`)), false);
  assert.equal(await auth.isAuthenticated(cookieFor(`${expires}.${signature.slice(0, -2)}AA`)), false);
  assert.equal(await auth.isAuthenticated(cookieFor(expires)), false);
});

test('a session expires after 30 days', async () => {
  const auth = await makeAuth();
  const token = await auth.login('2468', '10.0.0.5');
  clock += (SESSION_SECONDS - 1) * 1000;
  assert.equal(await auth.isAuthenticated(cookieFor(token)), true);
  clock += 2000;
  assert.equal(await auth.isAuthenticated(cookieFor(token)), false);
});

test('changing the PIN signs every browser out', async () => {
  const auth = await makeAuth('2468');
  const token = await auth.login('2468', '10.0.0.5');
  const file = path.join(dir, 'pin.hash');
  await writeFile(file, `${await hashPin('9753')}\n`);
  const later = new Date(Date.now() + 5000);
  await utimes(file, later, later);
  assert.equal(await auth.isAuthenticated(cookieFor(token)), false);
  await assert.rejects(auth.login('2468', '10.0.0.5'), { status: 401 });
  assert.ok(await auth.login('9753', '10.0.0.5'));
});

test('five wrong PINs lock that client out but not another client', async () => {
  const auth = await makeAuth();
  for (let i = 0; i < 5; i += 1) await assert.rejects(auth.login('0000', '10.0.0.5'), { status: 401 });
  await assert.rejects(auth.login('2468', '10.0.0.5'), (error) => error.status === 429 && error.retryAfter === 30);
  assert.ok(await auth.login('2468', '10.0.0.6'));
});

test('the lockout ends after the wait and doubles on the next failure', async () => {
  const auth = await makeAuth();
  for (let i = 0; i < 5; i += 1) await assert.rejects(auth.login('0000', '10.0.0.5'), { status: 401 });
  clock += 30 * 1000;
  await assert.rejects(auth.login('0000', '10.0.0.5'), { status: 401 });
  await assert.rejects(auth.login('2468', '10.0.0.5'), (error) => error.status === 429 && error.retryAfter === 60);
  clock += 60 * 1000;
  assert.ok(await auth.login('2468', '10.0.0.5'));
});

test('thirty wrong PINs from many clients lock everyone out for the window', async () => {
  const auth = await makeAuth();
  for (let i = 0; i < 30; i += 1) {
    await assert.rejects(auth.login('0000', `10.0.1.${i}`), { status: 401 });
  }
  await assert.rejects(auth.login('2468', '10.0.2.1'), { status: 429 });
  clock += 15 * 60 * 1000 + 1000;
  assert.ok(await auth.login('2468', '10.0.2.1'));
});

test('without a PIN file nobody can sign in and nothing authenticates', async () => {
  const auth = await makeAuth(null);
  assert.equal(await auth.pinConfigured(), false);
  await assert.rejects(auth.login('2468', '10.0.0.5'), { status: 503 });
  assert.equal(await auth.isAuthenticated(cookieFor('9999999999.abc')), false);
});

test('the session secret is created once and reused', async () => {
  await makeAuth();
  const first = await readFile(path.join(dir, 'session.secret'), 'utf8');
  const auth = await makeAuth();
  const token = await auth.login('2468', '10.0.0.5');
  assert.equal(await readFile(path.join(dir, 'session.secret'), 'utf8'), first);
  const again = new Auth({ configDir: dir, now: () => clock });
  await again.init();
  assert.equal(await again.isAuthenticated(cookieFor(token)), true);
});
