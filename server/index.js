// Calendar server entry point: store, password bootstrap, the Express app (app.js), listen, refresher, shutdown.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { initStore, getConfig, events as storeEvents, paths, ROOT, StoreError } from './store.js';
import { ensurePassword } from './auth.js';
import { createApp } from './app.js';
import { syncDisplayKeys, onDisplayAccessConfig, revalidateStreams } from './displayAccess.js';
import { broadcast, closeAll, reresolveClients, setStreamValidator } from './sse.js';
import { startRefresher, stopRefresher, runRefresh } from './refresher.js';
import { resolveScreen } from './core/screens.js';
import { invalidateIcsParsing } from './calendars.js';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

try {
  initStore();
} catch (err) {
  if (!(err instanceof StoreError)) throw err;
  console.error(err.message);
  process.exit(1);
}
// Floating ICS times (no TZID) are interpreted in the process zone; align it with the configured zone (and keep
// it aligned when the zone is changed in the admin, see the 'config' listener below). A TZ set in
// the environment wins and is never changed.
const tzFromEnv = Boolean(process.env.TZ);
if (!tzFromEnv) process.env.TZ = getConfig().datetime.timezone;
await ensurePassword();

// Every display screen gets its private-link key (secrets.json; displayAccess.js).
syncDisplayKeys();
// Every heartbeat re-checks each open stream's credential (sessions expire, keys / devices change).
setStreamValidator(() => revalidateStreams());
const app = createApp({ version: pkg.version });

// Config saves refresh live calendar and display data.
storeEvents.on('config', (cfg) => {
  if (!tzFromEnv && cfg.datetime.timezone && cfg.datetime.timezone !== process.env.TZ) {
    process.env.TZ = cfg.datetime.timezone; // Node applies a runtime TZ change to new Date computations
    invalidateIcsParsing();
  }
  reresolveClients((key) => resolveScreen(cfg, key).screen.id);
  onDisplayAccessConfig(cfg);
  broadcast('config', { revision: cfg.revision });
  runRefresh().catch(() => {});
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, process.env.HOST || '0.0.0.0', (err) => {
  // Express 5 passes listen errors (EADDRINUSE, EACCES…) to this callback.
  if (err) {
    console.error(`[server] cannot listen on port ${PORT}: ${err.code || err.message}`);
    process.exit(1);
  }
  console.log(`[server] Calendar v${pkg.version} on http://localhost:${PORT} (data: ${paths.data})`);
  startRefresher();
});

function shutdown(sig) {
  console.log(`[server] ${sig}, shutting down`);
  stopRefresher();
  closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
// Photo uploads can be up to 100 MB (fallback when the browser cannot optimize them): allow slow uplinks.
server.requestTimeout = 30 * 60_000;
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection:', err));
