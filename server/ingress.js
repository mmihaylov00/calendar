// Only Supervisor ingress may supply a Home Assistant identity; roles are checked by the HA integration.
import { requestJson } from './lib/http.js';

export const homeAssistantMode = () => process.env.MARCO_HOME_ASSISTANT === '1';
const INGRESS_PEER = '172.30.32.2';
const INGRESS_PATH = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]{1,512}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const homeAssistantUser = (req) => req.homeAssistant?.user || null;

async function authorizeUser(userId) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) throw new Error('Supervisor token is unavailable');
  const result = await requestJson(`http://supervisor/core/api/marco/access?user_id=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 5000,
  });
  return result?.allowed === true;
}

export function ingressMiddleware({ authorize = authorizeUser, streamCheckMs = 25_000 } = {}) {
  return async (req, res, next) => {
    if (!homeAssistantMode()) return next();
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (req.method === 'GET' && req.path === '/api/health' && ['127.0.0.1', '::1'].includes(peer)) return next();
    if (peer !== INGRESS_PEER) return res.status(403).json({ error: 'Open Calendar through Home Assistant.' });
    const basePath = req.get('x-ingress-path');
    const userId = req.get('x-remote-user-id');
    if (!INGRESS_PATH.test(basePath || '') || !USER_ID.test(userId || '')) {
      return res.status(403).json({ error: 'Home Assistant ingress identity is required.' });
    }
    try {
      const allowed = await authorize(userId);
      if (req.aborted || res.destroyed || res.writableEnded) return;
      if (!allowed) return res.status(403).json({ error: 'A Home Assistant administrator is required.' });
    } catch (err) {
      if (req.aborted || res.destroyed || res.writableEnded) return;
      console.warn('[ingress] Home Assistant authorization unavailable:', err.message);
      return res.status(503).json({ error: 'Load the Calendar integration in Home Assistant before opening this app.' });
    }
    req.homeAssistant = {
      basePath,
      user: { email: `ha:${userId}`, name: String(req.get('x-remote-user-display-name') || req.get('x-remote-user-name') || 'Home Assistant').slice(0, 100), picture: '', method: 'homeassistant' },
    };
    // Streams do not outlive a removed/disabled administrator or an unavailable authorization service.
    if (req.path === '/api/stream') {
      let checking = false;
      const timer = setInterval(async () => {
        if (res.destroyed || res.writableEnded) return clearInterval(timer);
        if (checking) return;
        checking = true;
        let allowed = false;
        try { allowed = await authorize(userId); }
        catch (err) { console.warn('[ingress] Stream authorization unavailable:', err.message); }
        finally { checking = false; }
        if (res.destroyed || res.writableEnded || allowed) return;
        req.homeAssistant.user = null;
        res.write('event: revoked\ndata: {"code":"key_required"}\n\n');
        res.end();
      }, streamCheckMs);
      timer.unref();
      res.once('close', () => clearInterval(timer));
    }
    next();
  };
}

/** Built assets are relative, so both screen links and the admin resolve them under the ingress prefix. */
export function pageHtml(html, file, req) {
  const base = `${req.homeAssistant?.basePath || ''}${file.startsWith('admin/') ? '/admin/' : '/'}`;
  return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n<base href="${base}">`);
}
