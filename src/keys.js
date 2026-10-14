import { chown, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const KEY_NAME = 'ucweb';
const TIMEOUT_MS = 8000;

export class KeyError extends Error {}

async function call(address, pathname, { method = 'GET', auth, body } = {}) {
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = auth;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(`http://${address}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error.cause?.code ?? error.cause?.errors?.[0]?.code ?? (error.name === 'TimeoutError' ? 'timed out' : error.cause?.message ?? error.name);
    throw new KeyError(`No Unfolded Circle remote answered at ${address} (${reason}).`);
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

export async function identify(address) {
  const { status, data } = await call(address, '/api/pub/version');
  const hostname = typeof data?.hostname === 'string' ? data.hostname.replace(/\.local$/, '') : '';
  if (status !== 200 || !hostname) throw new KeyError(`${address} did not answer like an Unfolded Circle remote (HTTP ${status}).`);
  return { address, hostname, name: typeof data.device_name === 'string' && data.device_name ? data.device_name : hostname };
}

export const keyFile = (keysDir, remote) => path.join(keysDir, `${remote.hostname}.key`);

export async function checkKey(remote, keysDir) {
  const file = keyFile(keysDir, remote);
  let key;
  try {
    key = (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing', file };
    throw new KeyError(`Cannot read ${file}: ${error.code ?? error.message}.`);
  }
  if (!key) return { state: 'missing', file };
  const { status } = await call(remote.address, '/api/system', { auth: `Bearer ${key}` });
  if (status === 200) return { state: 'works', file };
  if (status === 401 || status === 403) return { state: 'rejected', file };
  throw new KeyError(`${remote.name} answered HTTP ${status} when the key in ${file} was tested.`);
}

async function writeKey(file, key) {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(`${file}.tmp`, key, { mode: 0o600 });
  if (process.getuid?.() === 0) {
    const owner = await stat(path.dirname(dir));
    await chown(dir, owner.uid, owner.gid);
    await chown(`${file}.tmp`, owner.uid, owner.gid);
  }
  await rename(`${file}.tmp`, file);
}

export async function createKey(remote, keysDir, pin, { replace = false } = {}) {
  const auth = `Basic ${Buffer.from(`web-configurator:${pin}`).toString('base64')}`;
  const signIn = await call(remote.address, '/api/system', { auth });
  if (signIn.status === 401 || signIn.status === 403) throw new KeyError(`${remote.name} did not accept that PIN. Nothing was created.`);
  if (signIn.status !== 200) throw new KeyError(`${remote.name} answered HTTP ${signIn.status} to the PIN check. Nothing was created.`);
  const revoked = [];
  if (replace) {
    const listed = await call(remote.address, '/api/auth/api_keys', { auth });
    if (listed.status !== 200 || !Array.isArray(listed.data)) throw new KeyError(`${remote.name} did not list its API keys (HTTP ${listed.status}). Nothing was changed.`);
    for (const old of listed.data.filter((entry) => entry?.name === KEY_NAME && typeof entry.key_id === 'string')) {
      const removed = await call(remote.address, `/api/auth/api_keys/${encodeURIComponent(old.key_id)}`, { method: 'DELETE', auth });
      if (removed.status !== 200 && removed.status !== 204) throw new KeyError(`${remote.name} refused to revoke the old ${KEY_NAME} key ${old.key_id} (HTTP ${removed.status}).`);
      revoked.push(old.key_id);
    }
  }
  const created = await call(remote.address, '/api/auth/api_keys', {
    method: 'POST',
    auth,
    body: { name: KEY_NAME, scopes: ['admin'], description: 'ucweb web remote' },
  });
  if (created.status === 422) throw new KeyError(`${remote.name} already has a key named "${KEY_NAME}". Run again with --replace to revoke it and issue a new one.`);
  if (created.status !== 201 && created.status !== 200) throw new KeyError(`${remote.name} refused to create the key (HTTP ${created.status}${created.data?.message ? `: ${created.data.message}` : ''}).`);
  const key = created.data?.api_key;
  if (typeof key !== 'string' || !key) throw new KeyError(`${remote.name} created the key but sent none back.`);
  const file = keyFile(keysDir, remote);
  await writeKey(file, key);
  return { file, revoked };
}
