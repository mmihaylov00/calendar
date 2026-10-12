// Private display links + paired devices: who may read the display API. See SECURITY.md, docs/API.md and
// docs/ARCHITECTURE.md ("Display access").
//
// config.security.displayAccess:
//   'private' (default for fresh installs): every display-facing endpoint needs one of:
//       - a screen's display key   (UUIDv4, the private link /d/<key>; secrets.displayKeys[screenId].key)
//       - a paired-device token    (md_ + 43 base64url chars; only sha256 stored in secrets.devices[])
//       - a valid admin session    (admin preview iframe, "View screen" links)
//   'open' (installs from before 0.3): legacy LAN mode: / and /?screen=<slug> work without a key. Keys and device
//       tokens still work (and still bind the screen); an invalid one is still refused.
//
// Credentials travel in the X-Marco-Key header (fetch) or ?k= (EventSource and <img>/WebGL photo URLs, where
// headers are impossible). A credential always decides the screen (?screen= is ignored), so a key for the kitchen
// never reads the living room. Comparisons are constant-time (sha256 digests + timingSafeEqual over every entry).
import crypto from 'node:crypto';
import { getConfig, getSecrets, flushSecrets } from './store.js';
import { sessionValid, isLanClient, authEvents, SESSION_MAX_AGE } from './auth.js';
import { listClients, dropClient } from './sse.js';
import { resolveScreen } from './core/screens.js';
import { homeAssistantUser } from './ingress.js';

export const KEY_HEADER = 'x-marco-key';
/** Display key: a random UUIDv4 (122 random bits), lower-case. Upper-case input is accepted. */
export const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Paired-device token: md_ + base64url(32 random bytes). */
export const DEVICE_TOKEN_RE = /^md_[A-Za-z0-9_-]{43}$/;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export const displayAccessMode = (cfg = getConfig()) => (cfg?.security?.displayAccess === 'open' ? 'open' : 'private');

function keys() {
  const s = getSecrets();
  if (!s.displayKeys || typeof s.displayKeys !== 'object' || Array.isArray(s.displayKeys)) s.displayKeys = {};
  return s.displayKeys;
}
function devices() {
  const s = getSecrets();
  if (!Array.isArray(s.devices)) s.devices = [];
  return s.devices;
}

const newKey = () => ({ key: crypto.randomUUID(), createdAt: new Date().toISOString() });

/**
 * Keep secrets in step with the screens: every screen has a key, keys of deleted screens are dropped (their links
 * stop working), devices of deleted screens move to the default screen. Returns true when secrets changed.
 */
export function syncDisplayKeys(cfg = getConfig()) {
  const ids = new Set(cfg.screens.map((s) => s.id));
  const k = keys();
  let changed = false;
  for (const id of ids) {
    if (!k[id] || typeof k[id].key !== 'string' || !KEY_RE.test(k[id].key)) { k[id] = newKey(); changed = true; }
  }
  for (const id of Object.keys(k)) if (!ids.has(id)) { delete k[id]; changed = true; }
  const fallback = cfg.screens.find((s) => s.id === cfg.defaultScreen)?.id || cfg.screens[0]?.id;
  for (const d of devices()) if (!ids.has(d.screenId)) { d.screenId = fallback; changed = true; }
  if (changed) flushSecrets();
  return changed;
}

/** The private-link key of a screen (created on demand). */
export function displayKeyFor(screenId) {
  const cfg = getConfig();
  if (!cfg.screens.some((s) => s.id === screenId)) return null;
  if (!keys()[screenId]) syncDisplayKeys(cfg);
  return keys()[screenId]?.key || null;
}

/** Screen id for a presented key, or null. Constant-time over every stored key. */
export function screenForKey(key) {
  const given = typeof key === 'string' ? key.trim().toLowerCase() : '';
  if (!KEY_RE.test(given)) return null;
  const h = sha(given);
  let hit = null;
  for (const [screenId, v] of Object.entries(keys())) {
    if (typeof v?.key === 'string' && crypto.timingSafeEqual(sha(v.key), h)) hit = screenId;
  }
  return hit;
}

/** Stored device for a presented device token, or null. Constant-time over every stored hash. */
export function deviceForToken(token) {
  if (typeof token !== 'string' || !DEVICE_TOKEN_RE.test(token)) return null;
  const h = sha(token);
  let hit = null;
  for (const d of devices()) {
    const stored = /^[a-f0-9]{64}$/.test(d.hash || '') ? Buffer.from(d.hash, 'hex') : null;
    if (stored && crypto.timingSafeEqual(stored, h)) hit = d;
  }
  return hit;
}

/** The credential a request carries: X-Marco-Key header, or ?k= when `allowQuery` (SSE, media). */
export function credentialOf(req, { allowQuery = false } = {}) {
  const h = req.get?.(KEY_HEADER) ?? req.headers?.[KEY_HEADER];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (allowQuery && typeof req.query?.k === 'string' && req.query.k.trim()) return req.query.k.trim();
  return '';
}

/**
 * Who is this display? Returns
 *   { ok: true, via: 'key', screenId } | { ok: true, via: 'device', screenId, device }
 *   { ok: true, via: 'session' } | { ok: true, via: 'open' }
 *   { ok: false, status: 401, code: 'key_required' } | { ok: false, status: 403, code: 'invalid_key' }
 * A presented credential is always checked first: a wrong/revoked one is refused even in open mode or with a
 * session, so a display opened with a revoked link shows "link no longer valid" instead of silently falling back.
 */
export function resolveDisplayAccess(req, { allowQuery = false } = {}) {
  // Ingress has already verified the HA role. Stale standalone keys must not override its login.
  if (homeAssistantUser(req)) return { ok: true, via: 'session' };
  const cred = credentialOf(req, { allowQuery });
  if (cred) {
    if (cred.startsWith('md_')) {
      const d = deviceForToken(cred);
      if (d) {
        return { ok: true, via: 'device', screenId: d.screenId, device: d, credHash: d.hash };
      }
    } else {
      const screenId = screenForKey(cred);
      if (screenId) return { ok: true, via: 'key', screenId, credHash: sha(cred.trim().toLowerCase()).toString('hex') };
    }
    return { ok: false, status: 403, code: 'invalid_key' };
  }
  if (sessionValid(req)) return { ok: true, via: 'session' };
  if (displayAccessMode() === 'open') return { ok: true, via: 'open' };
  return { ok: false, status: 401, code: 'key_required' };
}

const ERRORS = {
  key_required: 'authentication required: open Calendar through Home Assistant',
  invalid_key: 'this display link or device is no longer valid',
};

/**
 * The screen a display request is for: the one bound to its key / device token, else ?screen= (admin session,
 * open mode). Same shape as resolveScreen(): { screen, fallback }.
 */
export function requestScreen(cfg, req) {
  const id = req.displayAccess?.screenId;
  const bound = id && cfg.screens.find((s) => s.id === id);
  if (bound) return { screen: bound, fallback: false };
  return resolveScreen(cfg, req.query?.screen);
}

/** Express middleware for the display JSON API: sets req.displayAccess or answers 401/403 (no data). */
export function displayAuth({ allowQuery = false } = {}) {
  return (req, res, next) => {
    const a = resolveDisplayAccess(req, { allowQuery });
    // Keyed responses are per-display data: never stored by shared caches, never cached on disk.
    res.set('cache-control', 'private, no-store');
    if (!a.ok) return res.status(a.status).json({ error: ERRORS[a.code], code: a.code });
    req.displayAccess = a;
    next();
  };
}

/**
 * /media/* (family photos, thumbnails). Private mode: key, device token (?k=) or admin session. Open mode: as
 * before (LAN clients or an admin session; Internet clients get 404) plus valid keys / device tokens.
 */
export function mediaAuth(req, res, next) {
  const a = resolveDisplayAccess(req, { allowQuery: true });
  if (a.ok && (a.via !== 'open' || isLanClient(req))) return next();
  if (a.ok) return res.status(404).type('text/plain').send('not found');
  res.set('cache-control', 'private, no-store');
  res.status(a.status).type('text/plain').send(ERRORS[a.code]);
}

// ---------------------------------------------------------------------------------------------------------------
/** Revoke matching live responses immediately. */
export function kickClients(filter, code) {
  let n = 0;
  for (const c of listClients()) {
    if (!filter(c)) continue;
    // Removed from the registry before ending, so a broadcast in the same tick never writes to an ended stream.
    dropClient(c, { event: 'revoked', data: { code } });
    n++;
  }
  return n;
}

const sameHash = (hex, buf) => /^[a-f0-9]{64}$/.test(hex || '') && buf.length === 32 && crypto.timingSafeEqual(Buffer.from(hex, 'hex'), buf);

/**
 * Re-check the credential of every open stream against the current config + secrets, and close the ones that no
 * longer resolve to the same screen. Called after config saves, imports, session revocation and every heartbeat,
 * so changed credentials cannot leave a stream reading:
 *   key:     the screen's current key must still be the one the stream opened with ('invalid_key')
 *   device:  the device must still exist ('invalid_key'); moved to another screen → 'reload' + close
 *   session: the admin session must still be valid (epoch, login method) ('key_required')
 *   open:    only while display access is 'open' ('key_required')
 * Returns how many streams were closed.
 */
export function revalidateStreams(cfg = getConfig()) {
  const ids = new Set(cfg.screens.map((s) => s.id));
  const k = keys();
  const devs = new Map(devices().map((d) => [d.id, d]));
  const mode = displayAccessMode(cfg);
  /** null (still valid), 'reload' (device moved to another screen) or the `revoked` code. */
  const check = (a, since) => {
    if (a.via === 'key') {
      const cur = k[a.screenId]?.key;
      if (!ids.has(a.screenId) || typeof cur !== 'string' || !sameHash(a.credHash, sha(cur))) return 'invalid_key';
    } else if (a.via === 'device') {
      const d = devs.get(a.deviceId);
      if (!d || !sameHash(a.credHash, Buffer.from(String(d.hash || ''), 'hex'))) return 'invalid_key';
      if (d.screenId !== a.screenId) return 'reload';
    } else if (a.via === 'session') {
      let ok = false;
      // The cookie expires after SESSION_MAX_AGE: a stream opened with it does not outlive it either.
      try { ok = Boolean(a.authReq) && sessionValid(a.authReq) && Date.now() - since < SESSION_MAX_AGE; } catch { ok = false; }
      if (!ok) return 'key_required';
    } else if (a.via === 'open') {
      if (mode !== 'open') return 'key_required';
    }
    return null;
  };
  let n = 0;
  for (const c of listClients()) {
    if (!c.access) continue;
    const code = check(c.access, c.since);
    if (code === 'reload') { dropClient(c, { event: 'reload', data: {} }); n++; }
    else if (code) { dropClient(c, { event: 'revoked', data: { code } }); n++; }
  }
  return n;
}

// Logging out everywhere / changing the password closes admin-session streams at once; a plain logout closes the
// streams opened by that browser login.
authEvents.on('revoked', () => { try { revalidateStreams(); } catch (err) { console.warn('[access] revalidate:', err.message); } });
authEvents.on('logout', (sid) => {
  kickClients((c) => c.access?.via === 'session' && c.access.sid && c.access.sid === sid, 'key_required');
});

/**
 * Config saved: keep keys in step with the screens, then re-check every stream: switching to private disconnects
 * responses that were reading without a key; deleted screens drop their links'
 * streams; a disabled login method closes its admin-session streams.
 */
export function onDisplayAccessConfig(cfg) {
  try {
    syncDisplayKeys(cfg);
    revalidateStreams(cfg);
  } catch (err) {
    console.warn('[access] access sync failed:', err.message);
  }
}
