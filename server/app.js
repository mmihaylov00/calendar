// Express application: display API + admin API + static frontend (dist/) + SSE. Built by createApp() so the
// tests run the very same middleware stack as production (server/index.js adds initStore, listen and shutdown).
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { paths, ROOT } from './store.js';
import { sessionMiddleware, csrfGuard, loginHandler, logoutHandler, logoutAllHandler, meHandler,
  googleLoginHandler, googleConnectHandler, googleCallbackHandler, microsoftConnectHandler, microsoftCallbackHandler } from './auth.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { screensAdminRouter, displayPublicRouter } from './routes/screens.js';
import { hooksRouter } from './routes/hooks.js';
import { announceRouter } from './routes/announce.js';
import { systemRouter } from './routes/system.js';
import { updatesRouter } from './routes/updates.js';
import { eventsAdminRouter, eventsPublicRouter } from './routes/localEvents.js';
import { accessAdminRouter, pairPublicRouter } from './routes/access.js';
import { doorbellAdminRouter, doorbellPublicRouter } from './routes/doorbell.js';
import { setupRouter } from './setup.js';
import { geocodeRouter } from './geocode.js';
import { hostGuard } from './lib/net.js';
import { redactSecrets } from './core/activityCore.js';
import { displayAuth, mediaAuth } from './displayAccess.js';
import { homeAssistantMode, ingressMiddleware, pageHtml } from './ingress.js';

/** Display-facing JSON endpoints: private mode requires a display key, a device token or an admin session. */
export const DISPLAY_API_PATHS = ['/api/display', '/api/events', '/api/weather', '/api/news', '/api/photos', '/api/countdowns'];

/**
 * @param {{ version: string, dist?: string, updater?: object, ingressAuthorize?: (userId: string) => Promise<boolean> }} opts  dist = built frontend directory (default
 *   <repo>/dist); updater = update checker (server/updates.js; default: the server's own, created on first use)
 */
export function createApp({ version, dist = path.join(ROOT, 'dist'), updater = null, ingressAuthorize }) {
  const app = express();
  app.disable('x-powered-by');
  // TRUST_PROXY: Express "trust proxy" value (default loopback). Set it to the address the reverse proxy connects
  // from whenever that is not loopback: a proxy on another host (TRUST_PROXY=192.168.1.10), or any proxy in front
  // of the Docker container (it connects from the bridge gateway: TRUST_PROXY=172.16.0.0/12), so
  // X-Forwarded-Proto/For are honoured (secure cookies, real client IP, LAN checks). See lib/net.js isLanClient.
  const trustProxy = homeAssistantMode() ? '172.30.32.2' : process.env.TRUST_PROXY?.trim();
  app.set('trust proxy', !trustProxy ? 'loopback' : trustProxy === 'true' ? true : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy.split(',').map((x) => x.trim()));

  // Browser hardening on every response. Private display links live in the URL (/d/<key>): never leak them
  // through the Referer header. No MIME sniffing. Only this same origin may frame a page (the admin's live
  // preview iframes the display; nothing else can, so no clickjacking of the admin).
  app.use((req, res, next) => {
    res.set('referrer-policy', 'no-referrer');
    res.set('x-content-type-options', 'nosniff');
    res.set('x-frame-options', 'SAMEORIGIN');
    res.set('content-security-policy', "frame-ancestors 'self'");
    next();
  });
  // DNS-rebinding guard: only LAN host names, IP literals, PUBLIC_URL and ALLOWED_HOSTS (lib/net.js).
  app.use(ingressMiddleware({ authorize: ingressAuthorize }));
  if (!homeAssistantMode()) app.use(hostGuard());
  app.use(sessionMiddleware());
  app.use((req, res, next) => {
    if (homeAssistantMode() && (req.path.startsWith('/auth/') || /^\/api\/auth\/(login|logout|logout-all)$/.test(req.path) || req.path === '/api/admin/password')) {
      return res.status(409).json({ error: 'Home Assistant manages login and connected calendar accounts.' });
    }
    next();
  });
  // Route-specific body limits must come before the global parser (body-parser skips already-parsed bodies).
  app.use(['/api/admin/import/preview', '/api/admin/import/apply'], express.json({ limit: '5mb' }));
  app.use('/api/display/heartbeat', express.json({ limit: '4kb' }));
  app.use('/api/pair', express.json({ limit: '2kb' }));
  app.use('/api/hooks', express.json({ limit: '16kb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api/admin', '/api/auth', '/api/setup'], csrfGuard({ multipartPaths: ['/photos', /^\/photos\/[^/]+\/thumb$/] }));

  // --- auth ---
  app.get('/api/auth/me', meHandler);
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.post('/api/auth/logout', logoutHandler);
  app.post('/api/auth/logout-all', logoutAllHandler);
  app.get('/auth/google/login', googleLoginHandler);
  app.get('/auth/google/connect', googleConnectHandler);
  app.get('/auth/google/callback', (req, res, next) => googleCallbackHandler(req, res).catch(next));
  app.get('/auth/microsoft/connect', microsoftConnectHandler);
  app.get('/auth/microsoft/callback', (req, res, next) => microsoftCallbackHandler(req, res).catch(next));

  // --- APIs ---
  // First-run setup wizard (open only while no admin password exists; server/setup.js).
  app.use('/api/setup', setupRouter({ version }));
  // Webhooks (bearer API tokens, no cookies → outside the CSRF guard) (docs/ARCHITECTURE.md).
  app.use('/api/hooks', hooksRouter());
  // Place search: an admin session, or the setup wizard before the first password exists (server/geocode.js).
  app.use('/api/admin', geocodeRouter());
  // Admin routers: each one applies requireAuth; unmatched paths fall through to the next one.
  app.use('/api/admin', adminRouter());
  app.use('/api/admin', updatesRouter({ version, updater }));
  app.use('/api/admin', screensAdminRouter(), announceRouter(), systemRouter({ version }), eventsAdminRouter(), accessAdminRouter(), doorbellAdminRouter());
  // Display access (private links / paired devices / admin session; open mode = legacy LAN). displayAccess.js
  app.use(DISPLAY_API_PATHS, displayAuth());
  app.use('/api/stream', displayAuth({ allowQuery: true }));
  // Pairing (unauthenticated, rate-limited) and the public (display) routers.
  app.use('/api', pairPublicRouter());
  app.use('/api', displayPublicRouter(), eventsPublicRouter(), doorbellPublicRouter());
  app.use('/api', publicRouter({ version }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // --- media ---
  // Family photos: private mode → display key / device token (?k=) or admin session; open mode → LAN clients or
  // an admin session (and valid keys). displayAccess.js mediaAuth
  app.use('/media', mediaAuth);
  // Gallery URLs carry ?v=<mtime> (replaced photos get a new URL), so they can be cached for long, privately.
  app.use('/media/photos', express.static(paths.photos, {
    maxAge: '30d', dotfiles: 'deny', index: false, fallthrough: false,
    setHeaders: (res) => res.set('cache-control', 'private, max-age=2592000'),
  }));
  // Browser-made thumbnails (always JPEG, whatever the photo's extension) for the admin gallery grid.
  app.use('/media/thumbs', express.static(path.join(paths.photos, '.thumbs'), {
    maxAge: '365d', immutable: true, dotfiles: 'deny', index: false, fallthrough: false,
    setHeaders: (res) => { res.type('image/jpeg'); res.set('cache-control', 'private, max-age=31536000, immutable'); },
  }));

  // --- frontend (production build) ---
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, redirect: false, maxAge: '1h', setHeaders: (res, p) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.set('cache-control', 'public, max-age=31536000, immutable');
      // The display and admin pages (also as /index.html, /admin/index.html) are never cached: a new build or a
      // revoked link takes effect on the next load.
      else if (p.endsWith('.html')) res.set('cache-control', 'no-store');
    } }));
    const sendHtml = (file, cache = 'no-store') => (req, res) => {
      res.set('cache-control', cache);
      res.type('html').send(pageHtml(fs.readFileSync(path.join(dist, file), 'utf8'), file, req));
    };
    app.get(['/admin', '/admin/', '/admin/*splat'], (req, res, next) =>
      fs.existsSync(path.join(dist, 'admin', 'index.html')) ? sendHtml('admin/index.html')(req, res) : next());
    app.get(['/', '/index.html', '/pair'], sendHtml('index.html'));
    // Private display link: the same display page; the key is read from the path by the page itself.
    app.get('/d/:key', (req, res) => {
      res.set('x-robots-tag', 'noindex, nofollow');
      sendHtml('index.html', 'private, no-store')(req, res);
    });
  } else {
    app.get('/', (req, res) => res.type('text/plain').send(
      'Calendar API running. Frontend not built: run `npm run build` (production) or `npm run dev` (vite on :5173).'));
  }

  // --- errors ---
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' ? 400 : 500);
    if (status >= 500) console.error('[server]', req.method, redactSecrets(req.originalUrl), err);
    const message = err.type === 'entity.parse.failed' ? 'invalid JSON' : status >= 500 ? 'internal error' : err.message;
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/auth')) return res.status(status).json({ error: message });
    res.status(status).type('text/plain').send(message);
  });
  return app;
}
