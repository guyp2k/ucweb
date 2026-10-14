import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'http://ucweb.test';
const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'), 'utf8');

function worker(network) {
  const stores = new Map();
  const keyOf = (request, ignoreSearch) => {
    const url = new URL(typeof request === 'string' ? request : request.url, ORIGIN);
    return ignoreSearch ? url.origin + url.pathname : url.href;
  };
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      entries,
      async put(request, response) {
        entries.set(keyOf(request), await response.text());
      },
      async add(request) {
        entries.set(keyOf(request), await (await network(new Request(new URL(request, ORIGIN)))).text());
      },
      async match(request, options = {}) {
        if (options.ignoreSearch) {
          const wanted = keyOf(request, true);
          for (const [key, body] of entries) if (keyOf(key, true) === wanted) return new Response(body);
          return undefined;
        }
        return entries.has(keyOf(request)) ? new Response(entries.get(keyOf(request))) : undefined;
      },
    };
  };
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    open: async (name) => store(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  vm.runInNewContext(source, { self, caches, fetch: (request) => network(request), URL, Request, Response, Promise, console });
  return {
    stores,
    store,
    async dispatch(type, init = {}) {
      let answer = null;
      const waits = [];
      listeners[type]({ ...init, respondWith: (promise) => { answer = promise; }, waitUntil: (promise) => waits.push(promise) });
      await Promise.all(waits);
      return answer;
    },
    async fetch(url, init = {}) {
      const request = new Request(new URL(url, ORIGIN), init);
      if (init.navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
      const waits = [];
      let answer = null;
      listeners.fetch({ request, respondWith: (promise) => { answer = promise; }, waitUntil: (promise) => waits.push(promise) });
      const response = answer && (await answer);
      await Promise.all(waits);
      return { answered: answer !== null, response };
    },
  };
}

const offline = async () => {
  throw new TypeError('Failed to fetch');
};

test('API calls, the live event stream, health checks, other sites and non-GET requests are never touched', async () => {
  const sw = worker(async () => new Response('live'));
  for (const url of ['/api/remotes', '/api/remotes/x/entities/y/image?v=1', '/events', '/healthz', 'https://example.com/app.js']) {
    assert.equal((await sw.fetch(url)).answered, false, url);
  }
  assert.equal((await sw.fetch('/api/session', { method: 'POST', body: '{}' })).answered, false);
  assert.equal((await sw.fetch('/app.js', { method: 'POST', body: '{}' })).answered, false);
});

test('installing keeps the app page for offline use', async () => {
  const sw = worker(async (request) => new Response(`page ${new URL(request.url).pathname}`));
  await sw.dispatch('install');
  const [cache] = sw.stores.values();
  assert.deepEqual([...cache], [[`${ORIGIN}/`, 'page /']]);
});

test('a page file comes from the network first and a copy is kept', async () => {
  const sw = worker(async () => new Response('fresh app'));
  const { answered, response } = await sw.fetch('/app.js');
  assert.equal(answered, true);
  assert.equal(await response.text(), 'fresh app');
  const [cache] = sw.stores.values();
  assert.equal(cache.get(`${ORIGIN}/app.js`), 'fresh app');
});

test('online, the network answer wins over an older cached copy', async () => {
  let body = 'old app';
  const sw = worker(async () => new Response(body));
  await sw.fetch('/app.js');
  body = 'new app';
  assert.equal(await (await sw.fetch('/app.js')).response.text(), 'new app');
});

test('offline, a page file comes from the cache', async () => {
  let network = async () => new Response('saved app');
  const sw = worker((request) => network(request));
  await sw.fetch('/app.js');
  network = offline;
  assert.equal(await (await sw.fetch('/app.js')).response.text(), 'saved app');
});

test('opening the app offline shows the saved page, whatever address it was opened at', async () => {
  let network = async () => new Response('the app page');
  const sw = worker((request) => network(request));
  await sw.dispatch('install');
  network = offline;
  assert.equal(await (await sw.fetch('/?from=homescreen', { navigate: true })).response.text(), 'the app page');
  assert.equal(await (await sw.fetch('/index.html', { navigate: true })).response.text(), 'the app page');
});

test('an error answer is passed on but never saved over the good copy', async () => {
  let network = async () => new Response('good app');
  const sw = worker((request) => network(request));
  await sw.fetch('/app.js');
  network = async () => new Response('broken', { status: 500 });
  assert.equal((await sw.fetch('/app.js')).response.status, 500);
  const [cache] = sw.stores.values();
  assert.equal(cache.get(`${ORIGIN}/app.js`), 'good app');
});

test('offline with nothing saved, the network error is passed on', async () => {
  const sw = worker(offline);
  await assert.rejects(sw.fetch('/styles.css'), /Failed to fetch/);
});

test('activating a new version deletes the caches of older versions', async () => {
  const sw = worker(async () => new Response('x'));
  await sw.store('ucweb-shell-v0').put(`${ORIGIN}/old.js`, new Response('old'));
  await sw.fetch('/app.js');
  await sw.dispatch('activate');
  assert.equal(sw.stores.size, 1);
  assert.ok(!sw.stores.has('ucweb-shell-v0'));
});
