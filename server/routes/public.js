// Calendar, weather and photo delivery. app.js applies authentication to every data endpoint.
import { Router } from 'express';
import { getConfig } from '../store.js';
import { getEvents } from '../calendars.js';
import { getWeather } from '../weather.js';
import { getPhotos } from '../photos.js';
import { sseHandler } from '../sse.js';
import { resolveScreen, displayConfig as projectDisplayConfig } from '../core/screens.js';
import { requestScreen } from '../displayAccess.js';
import { addDays, localDate, isDateStr, daysBetween } from '../core/lib/tz.js';
import { healthBody } from '../capabilities.js';

export function displayConfig(cfg, screenKey) {
  const { screen, fallback } = resolveScreen(cfg, screenKey);
  return projectDisplayConfig(cfg, screen, { fallback });
}

export async function displayEvents(cfg, screen, window) {
  return getEvents({ ...window, screen, refresh: true });
}

function streamInit(req) {
  const cfg = getConfig();
  const { screen } = requestScreen(cfg, req);
  const access = { ...req.displayAccess, deviceId: req.displayAccess?.device?.id };
  delete access.device;
  if (access.via === 'session') {
    access.authReq = req;
    access.sid = req.session?.sid;
  }
  return { screenKey: req.displayAccess?.screenId || req.query?.screen || '', screenId: screen.id, access };
}

export function publicRouter({ version }) {
  const r = Router();
  r.use((req, res, next) => { res.set('cache-control', 'private, no-store'); next(); });
  r.get('/health', (req, res) => res.json(healthBody({ version })));
  r.get('/display/config', (req, res) => {
    const cfg = getConfig();
    const { screen, fallback } = requestScreen(cfg, req);
    res.json(projectDisplayConfig(cfg, screen, { fallback }));
  });
  r.get('/events', async (req, res, next) => {
    try {
      const cfg = getConfig();
      const today = localDate(new Date(), cfg.datetime.timezone);
      let from = isDateStr(req.query.from) ? req.query.from : addDays(today, -7);
      let to = isDateStr(req.query.to) ? req.query.to : addDays(today, 42);
      if (to < from) return res.status(400).json({ error: '`to` must be >= `from`' });
      const minDate = addDays(today, -366);
      const maxDate = addDays(today, 731);
      if (from < minDate) from = minDate;
      if (to > maxDate) to = maxDate;
      if (from > maxDate) from = maxDate;
      if (to < from) to = from;
      if (daysBetween(from, to) > 400) to = addDays(from, 400);
      res.json(await displayEvents(cfg, requestScreen(cfg, req).screen, { from, to }));
    } catch (err) { next(err); }
  });
  r.get('/weather', async (req, res) => {
    try { res.json(await getWeather({ lang: requestScreen(getConfig(), req).screen.screen.language })); }
    catch (err) { res.status(502).json({ error: err.message }); }
  });
  r.get('/photos', async (req, res, next) => {
    try {
      const cfg = getConfig();
      const { screen } = requestScreen(cfg, req);
      const after = typeof req.query.after === 'string' ? req.query.after : '';
      res.json({ photos: await getPhotos(Number(req.query.count) || 20, screen.background, { key: screen.id, after }) });
    } catch (err) { next(err); }
  });
  r.get('/stream', sseHandler({
    init: streamInit,
    hello: client => ({ revision: getConfig().revision, screenId: client.screenId, serverVersion: version, now: new Date().toISOString() }),
  }));
  return r;
}
