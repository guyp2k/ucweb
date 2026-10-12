import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './remote.js';

const scrypt = promisify(scryptCallback);

export const COOKIE_NAME = 'ucweb_session';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const PIN_PATTERN = /^\d{4,12}$/;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const FREE_FAILURES = 5;
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_MAX_FAILURES = 30;

export async function hashPin(pin) {
  if (!PIN_PATTERN.test(pin)) throw new Error('The PIN must be 4 to 12 digits.');
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function pinMatches(pin, stored) {
  const [kind, n, r, p, salt, expected] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !expected) throw new Error('The PIN file is not in the expected format.');
  const expectedBytes = Buffer.from(expected, 'base64');
  const actual = await scrypt(String(pin), Buffer.from(salt, 'base64'), expectedBytes.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expectedBytes);
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

export class Auth {
  #pinFile;
  #secretFile;
  #now;
  #pin = { mtimeMs: null, hash: null };
  #secret = null;
  #failures = new Map();
  #globalFailures = [];

  constructor({ configDir, now = () => Date.now() }) {
    this.#pinFile = path.join(configDir, 'pin.hash');
    this.#secretFile = path.join(configDir, 'session.secret');
    this.#now = now;
  }

  async init() {
    try {
      this.#secret = Buffer.from((await readFile(this.#secretFile, 'utf8')).trim(), 'base64');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#secret = randomBytes(32);
      await mkdir(path.dirname(this.#secretFile), { recursive: true });
      await writeFile(this.#secretFile, this.#secret.toString('base64'), { mode: 0o600 });
    }
    if (this.#secret.length < 32) throw new Error(`${this.#secretFile} is too short; delete it to generate a new one.`);
  }

  async pinConfigured() {
    return (await this.#pinHash()) !== null;
  }

  async #pinHash() {
    let info;
    try {
      info = await stat(this.#pinFile);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.#pin = { mtimeMs: null, hash: null };
        return null;
      }
      throw error;
    }
    if (info.mtimeMs !== this.#pin.mtimeMs) {
      const hash = (await readFile(this.#pinFile, 'utf8')).trim();
      this.#pin = { mtimeMs: info.mtimeMs, hash: hash || null };
    }
    return this.#pin.hash;
  }

  #signingKey(pinHash) {
    return createHash('sha256').update(this.#secret).update(pinHash).digest();
  }

  #signature(pinHash, expires) {
    return createHmac('sha256', this.#signingKey(pinHash)).update(String(expires)).digest('base64url');
  }

  async isAuthenticated(cookieHeader) {
    const token = parseCookies(cookieHeader)[COOKIE_NAME];
    if (!token) return false;
    const pinHash = await this.#pinHash();
    if (!pinHash) return false;
    const [expiresText, signature] = token.split('.');
    const expires = Number(expiresText);
    if (!Number.isInteger(expires) || expires * 1000 <= this.#now() || !signature) return false;
    const expected = Buffer.from(this.#signature(pinHash, expires));
    const actual = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  #retryAfter(client) {
    const now = this.#now();
    this.#globalFailures = this.#globalFailures.filter((time) => time > now - GLOBAL_WINDOW_MS);
    const waits = [];
    const lockedUntil = this.#failures.get(client)?.lockedUntil ?? 0;
    if (lockedUntil > now) waits.push(lockedUntil - now);
    if (this.#globalFailures.length >= GLOBAL_MAX_FAILURES) waits.push(this.#globalFailures[0] + GLOBAL_WINDOW_MS - now);
    return waits.length ? Math.ceil(Math.max(...waits) / 1000) : 0;
  }

  #recordFailure(client) {
    const now = this.#now();
    const record = this.#failures.get(client) ?? { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= FREE_FAILURES) {
      record.lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** (record.count - FREE_FAILURES), MAX_LOCK_MS);
    }
    this.#failures.set(client, record);
    this.#globalFailures.push(now);
  }

  async login(pin, client) {
    const pinHash = await this.#pinHash();
    if (!pinHash) throw new HttpError(503, 'No PIN is set yet. Run: docker exec -it ucweb npm run set-pin');
    const wait = this.#retryAfter(client);
    if (wait > 0) {
      const error = new HttpError(429, `Too many wrong PINs. Try again in ${wait} seconds.`);
      error.retryAfter = wait;
      throw error;
    }
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin) || !(await pinMatches(pin, pinHash))) {
      this.#recordFailure(client);
      throw new HttpError(401, 'That PIN is not right.');
    }
    this.#failures.delete(client);
    const expires = Math.floor(this.#now() / 1000) + SESSION_SECONDS;
    return `${expires}.${this.#signature(pinHash, expires)}`;
  }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearedSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
