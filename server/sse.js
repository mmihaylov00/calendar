// Live responses are transient connections, with bounded counts and periodic credential validation.
const clients = new Set();
let heartbeat = null;
let validator = null;
export const MAX_STREAMS_PER_IP = 24;

export function sseHandler({ init, hello }) {
  return (req, res) => {
    const ip = req.ip || '';
    if ([...clients].filter(client => client.ip === ip).length >= MAX_STREAMS_PER_IP) {
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30' });
      return res.end('too many streams');
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const client = { res, ip, since: Date.now(), ...init(req) };
    clients.add(client);
    res.on('error', () => clients.delete(client));
    req.on('close', () => clients.delete(client));
    send(client, 'hello', hello(client));
    startHeartbeat();
  };
}

export function send(client, event, data) {
  if (!client.res || client.res.writableEnded || client.res.destroyed) {
    clients.delete(client);
    return false;
  }
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
    return true;
  } catch {
    clients.delete(client);
    return false;
  }
}

export function dropClient(client, last) {
  if (last) send(client, last.event, last.data);
  clients.delete(client);
  try { client.res.end(); } catch { /* already disconnected */ }
}

export function broadcast(event, data) {
  let sent = 0;
  for (const client of [...clients]) if (send(client, event, data)) sent++;
  return sent;
}

export const clientCount = () => clients.size;
export const listClients = () => [...clients];

export function reresolveClients(resolve) {
  for (const client of clients) client.screenId = resolve(client.screenKey) || client.screenId;
}

export function setStreamValidator(fn) { validator = fn; }

function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    try { validator?.(); } catch (err) { console.warn('[sse] validator:', err.message); }
    for (const client of [...clients]) send(client, 'ping', { t: Date.now() });
  }, 25_000);
  heartbeat.unref();
}

export function closeAll() {
  for (const client of [...clients]) dropClient(client);
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}
