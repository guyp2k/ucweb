import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { HttpError } from './remote.js';
import { clearedSessionCookie, sessionCookie } from './auth.js';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

const MAX_BODY_BYTES = 4096;

export async function assetVersion(publicDir) {
  const hash = createHash('sha256');
  const walk = async (dir) => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        hash.update(path.relative(publicDir, full)).update('\0').update(await readFile(full)).update('\0');
      }
    }
  };
  await walk(publicDir);
  return hash.digest('hex').slice(0, 16);
}

export async function discoverThemes(publicDir) {
  const themesDir = path.join(publicDir, 'themes');
  const themes = [];
  for (const entry of await readdir(themesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(await readFile(path.join(themesDir, entry.name, 'theme.json'), 'utf8'));
    themes.push({ id: entry.name, name: manifest.name, colorScheme: manifest.colorScheme });
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name));
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': CONTENT_TYPES['.json'],
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Send the request body as application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

async function serveStatic(publicDir, pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(publicDir, relative);
  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return false;
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const ext = path.extname(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(await readFile(file));
  return true;
}

export function createServer({ remotes, publicDir, themes, defaultTheme, auth, version }) {
  const root = path.resolve(publicDir);
  const byId = new Map(remotes.map((remote) => [remote.id, remote]));

  const findRemote = (id) => {
    const remote = byId.get(id);
    if (!remote) throw new HttpError(404, `There is no remote ${id}.`);
    return remote;
  };

  async function handleSession(req, res) {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        authenticated: await auth.isAuthenticated(req.headers.cookie),
        pinConfigured: await auth.pinConfigured(),
      });
    }
    if (!sameOrigin(req)) throw new HttpError(403, 'Cross-site requests are not allowed.');
    if (req.method === 'POST') {
      const { pin } = await readJsonBody(req);
      const token = await auth.login(pin, req.socket.remoteAddress);
      return sendJson(res, 200, { authenticated: true }, { 'set-cookie': sessionCookie(token) });
    }
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { authenticated: false }, { 'set-cookie': clearedSessionCookie() });
    }
    throw new HttpError(405, `${req.method} is not allowed here.`);
  }

  async function handleApi(req, res, parts) {
    const method = req.method;
    if (parts.length === 1 && parts[0] === 'config' && method === 'GET') {
      return sendJson(res, 200, { themes, defaultTheme });
    }
    if (parts.length === 1 && parts[0] === 'session') return handleSession(req, res);
    if (!(await auth.isAuthenticated(req.headers.cookie))) throw new HttpError(401, 'Sign in with your PIN first.');
    if (parts.length === 1 && parts[0] === 'remotes' && method === 'GET') {
      return sendJson(res, 200, remotes.map((remote) => remote.snapshot()));
    }
    if (parts[0] === 'remotes' && parts[2] === 'activities' && parts.length >= 5) {
      const remote = findRemote(parts[1]);
      const activityId = parts[3];
      if (parts.length === 5 && parts[4] === 'buttons' && method === 'GET') {
        return sendJson(res, 200, await remote.buttons(activityId));
      }
      if (method !== 'POST') throw new HttpError(405, `${method} is not allowed here.`);
      if (!sameOrigin(req)) throw new HttpError(403, 'Cross-site requests are not allowed.');
      const body = await readJsonBody(req);
      if (parts.length === 5 && parts[4] === 'power') {
        if (typeof body.on !== 'boolean') throw new HttpError(400, 'Send {"on": true} or {"on": false}.');
        await remote.setActivityPower(activityId, body.on);
        return sendJson(res, 200, { ok: true });
      }
      if (parts.length === 6 && parts[4] === 'buttons') {
        await remote.press(activityId, parts[5]);
        return sendJson(res, 200, { ok: true });
      }
    }
    throw new HttpError(404, 'Unknown API route.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) {
        let parts;
        try {
          parts = url.pathname.slice(5).split('/').map(decodeURIComponent);
        } catch {
          throw new HttpError(400, 'The address is not valid.');
        }
        return await handleApi(req, res, parts);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(root, url.pathname, res))) return;
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) console.error(error);
      if (!res.headersSent) {
        sendJson(
          res,
          status,
          { error: error instanceof HttpError ? error.message : 'Internal error.' },
          error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {},
        );
      }
    }
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', async (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    let allowed = false;
    try {
      allowed = pathname === '/events' && sameOrigin(req) && (await auth.isAuthenticated(req.headers.cookie));
    } catch (error) {
      console.error(error);
    }
    if (!allowed) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, (client) => sockets.emit('connection', client, req));
  });

  const broadcast = (snapshot) => {
    const message = JSON.stringify({ type: 'remote', remote: snapshot });
    for (const client of sockets.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  };
  for (const remote of remotes) remote.on('change', broadcast);

  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);
  sockets.on('connection', (client) => {
    client.isAlive = true;
    client.on('pong', () => {
      client.isAlive = true;
    });
    client.send(JSON.stringify({ type: 'snapshot', version, remotes: remotes.map((remote) => remote.snapshot()) }));
  });
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const remote of remotes) remote.off('change', broadcast);
    for (const client of sockets.clients) client.terminate();
  });

  return server;
}
