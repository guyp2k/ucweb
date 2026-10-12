import http from 'node:http';
import { WebSocketServer } from 'ws';

export const KEY = 'test-api-key';
export const HOSTNAME = 'Remote3-test';

export function activity(id, name, state = 'OFF', extra = {}) {
  return {
    entity_id: id,
    entity_type: 'activity',
    name: { en: name },
    description: { en: `${name} description` },
    attributes: { state },
    enabled: true,
    ...extra,
  };
}

export function mapping(entityId) {
  return [
    { button: 'DPAD_UP', short_press: { entity_id: entityId, cmd_id: 'remote.send', params: { command: 'CURSOR_UP' } } },
    { button: 'VOLUME_UP', short_press: { entity_id: entityId, cmd_id: 'media_player.volume_up', params: {} } },
    { button: 'BACK' },
  ];
}

export async function startFakeRemote({ activities = [activity('act.tv', 'Watch TV')], buttonMappings = {}, batteryError = false } = {}) {
  const state = {
    activities,
    buttonMappings,
    battery: { capacity: 80, status: 'DISCHARGING', power_supply: false },
    batteryError,
    powerMode: 'NORMAL',
    commands: [],
    activityDetailRequests: 0,
    pageRequests: [],
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    if (url.pathname === '/api/pub/version') {
      return send(res, 200, { model: 'UCR3', device_name: 'Test Den', hostname: `${HOSTNAME}.local`, core: '1.0', ui: '1.1', os: '2.0' });
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { code: 'UNAUTHORIZED', message: 'bad key' });
    if (url.pathname === '/api/activities' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const limit = Number(url.searchParams.get('limit') ?? 10);
      state.pageRequests.push({ page, limit });
      const items = state.activities.slice((page - 1) * limit, page * limit);
      return send(res, 200, items, { 'pagination-count': String(state.activities.length) });
    }
    const detail = url.pathname.match(/^\/api\/activities\/([^/]+)$/);
    if (detail && req.method === 'GET') {
      const id = decodeURIComponent(detail[1]);
      const found = state.activities.find((candidate) => candidate.entity_id === id);
      if (!found) return send(res, 404, { message: 'no such activity' });
      state.activityDetailRequests += 1;
      return send(res, 200, { ...found, options: { button_mapping: state.buttonMappings[id] ?? [] } });
    }
    if (url.pathname === '/api/system/power/battery') {
      if (state.batteryError) return send(res, 400, { code: 'BAD_REQUEST', message: 'Invalid argument (os error 22)' });
      return send(res, 200, state.battery);
    }
    if (url.pathname === '/api/system/power') return send(res, 200, { mode: state.powerMode, power_supply: false });
    const command = url.pathname.match(/^\/api\/entities\/([^/]+)\/command$/);
    if (command && req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      state.commands.push({ entityId: decodeURIComponent(command[1]), body: JSON.parse(body) });
      return send(res, 200, { code: 200, message: 'OK' });
    }
    return send(res, 404, { message: 'not found' });
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers['api-key'] !== KEY) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, (client) => {
      client.send(JSON.stringify({ kind: 'resp', req_id: 0, msg: 'authentication', code: 200, msg_data: {} }));
      client.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message.msg === 'subscribe_events') {
          client.send(JSON.stringify({ kind: 'resp', req_id: message.id, msg: 'event_subscriptions', code: 200, msg_data: message.msg_data }));
        } else if (message.msg === 'get_power_mode') {
          const battery = state.batteryError ? undefined : state.battery;
          client.send(JSON.stringify({
            kind: 'resp',
            req_id: message.id,
            msg: 'power_mode',
            code: 200,
            msg_data: { mode: state.powerMode, battery, power_supply: false },
          }));
        }
      });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `127.0.0.1:${server.address().port}`;

  return {
    address,
    state,
    emit(msg, msgData) {
      const text = JSON.stringify({ kind: 'event', msg, cat: 'TEST', msg_data: msgData });
      for (const client of sockets.clients) client.send(text);
    },
    dropConnections() {
      for (const client of sockets.clients) client.terminate();
    },
    connectionCount() {
      return sockets.clients.size;
    },
    async close() {
      for (const client of sockets.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function waitFor(check, { timeoutMs = 3000, message = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}.`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
