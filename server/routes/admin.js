// Admin API (session required).
import { Router } from 'express';
import { getConfig, saveConfig, updateSecrets } from '../store.js';
import { requireAuth } from '../auth.js';
import * as google from '../google.js';
import * as microsoft from '../microsoft.js';
import * as ha from '../homeassistant.js';
import * as haCalendars from '../haCalendars.js';
import { testIcs } from '../calendars.js';
import { weatherKey, checkWeatherKey } from '../weather.js';
import { WEATHER_KEY_RE, weatherKeyStatus } from '../core/weather.js';
import {
  listGallery, uploadMiddleware, thumbMiddleware, deletePhoto, finalizeUpload, readMeta, writeMeta, setFocus, setHidden, getPhoto, checkNames,
  cleanupTempUploads, isUnit, isGalleryFile, isThumbField, storeThumb, validThumb, CONFLICT_POLICIES,
} from '../photos.js';
import fs from 'node:fs';
import { broadcast } from '../sse.js';
import { isHttpUrl } from '../core/validate.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function adminRouter({ onConfigSaved } = {}) {
  const r = Router();
  r.use(requireAuth);
  r.use((req, res, next) => { res.set('cache-control', 'no-store'); next(); });

  r.get('/config', (req, res) => res.json(getConfig()));

  r.put('/config', (req, res) => {
    // Body = full StoredConfig (v1 bodies from an old admin build are migrated by validateConfig), plus an
    // optional `baseRevision`: the revision the admin loaded. A stale one gets 409 conflict; without it the last
    // write wins, as with admin builds from before 0.5.
    let body = req.body;
    let baseRevision = null;
    if (body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'baseRevision')) {
      ({ baseRevision = null, ...body } = body);
      if (baseRevision !== null && !(Number.isSafeInteger(baseRevision) && baseRevision >= 0)) {
        return res.status(400).json({ error: 'invalid config', details: [{ path: 'baseRevision', message: 'expected a revision number' }] });
      }
    }
    const result = saveConfig(body, { reason: 'admin', req, baseRevision, checks: { weatherKeySet: Boolean(weatherKey()) } });
    if (result.conflict) return res.status(409).json({ error: 'conflict', revision: result.config.revision });
    if (!result.ok) return res.status(400).json({ error: 'invalid config', details: result.errors });
    onConfigSaved?.(result.config);
    res.json(result.config);
  });

  // --- Google accounts / calendars ---
  r.get('/google/accounts', (req, res) => res.json(google.listAccounts()));
  r.delete('/google/accounts/:email', wrap(async (req, res) => {
    const email = String(req.params.email).toLowerCase();
    const ok = await google.removeAccount(email);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  }));
  r.get('/google/calendars', wrap(async (req, res) => {
    const account = String(req.query.account || '').toLowerCase();
    if (!account) return res.status(400).json({ error: 'account required' });
    try {
      res.json(await google.listCalendars(account));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }));

  // --- Microsoft accounts / calendars (only with MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET) ---
  const msOn = (req, res, next) => (microsoft.microsoftConfigured() ? next() : res.status(404).json({ error: 'feature_unavailable' }));
  r.get('/microsoft/accounts', msOn, (req, res) => res.json(microsoft.listAccounts()));
  r.delete('/microsoft/accounts/:email', msOn, (req, res) => {
    const email = String(req.params.email).toLowerCase();
    if (!microsoft.removeAccount(email)) return res.status(404).json({ error: 'not found' });
    // Its calendars leave the config when the admin saves (it drops them from its draft), as for Google accounts.
    res.json({ ok: true, manageAccess: microsoft.MANAGE_ACCESS_URLS });
  });
  r.get('/microsoft/calendars', msOn, wrap(async (req, res) => {
    const account = String(req.query.account || '').toLowerCase();
    if (!account) return res.status(400).json({ error: 'account required' });
    if (!microsoft.listAccounts().some((a) => a.email === account)) return res.status(404).json({ error: 'not found' });
    try {
      res.json(await microsoft.listCalendars(account));
    } catch (err) {
      if (err.code === 'auth_failed') return res.status(409).json({ error: 'microsoft_reconnect' });
      res.status(502).json({ error: 'microsoft_unavailable' });
    }
  }));

  // --- connectivity tests ---
  r.post('/test/ics', wrap(async (req, res) => {
    const { url, insecureTls } = req.body || {};
    if (!isHttpUrl(url, ['http:', 'https:', 'webcal:', 'webcals:'])) return res.json({ ok: false, count: 0, sample: [], error: 'invalid URL' });
    res.json(await testIcs(url, insecureTls === true));
  }));
  r.get('/homeassistant/entities', wrap(async (req, res) => {
    const domain = /^[a-z_]+$/.test(req.query.domain || '') ? req.query.domain : '';
    try {
      res.json(await ha.listEntities(domain));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }));
  r.get('/homeassistant/calendars', wrap(async (req, res) => {
    try {
      res.json(await haCalendars.listCalendars());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }));
  // --- weather API key (Pirate Weather): kept in secrets.json, never sent back, only whether one is set ---
  r.get('/weather/key', (req, res) => res.json(weatherKeyStatus(weatherKey())));
  r.put('/weather/key', wrap(async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || key.length > 200) return res.status(400).json({ error: 'key must be a string' });
    const k = key.trim();
    if (k && !WEATHER_KEY_RE.test(k)) return res.status(400).json({ error: 'key_invalid' });
    // A new key is tried once against the provider: a key it refuses is not stored.
    const checked = k ? await checkWeatherKey(k) : null;
    if (checked === false) return res.status(400).json({ error: 'key_invalid' });
    updateSecrets((s) => { s.weather = { ...(s.weather || {}), apiKey: k }; });
    res.json({ ...weatherKeyStatus(k), checked: checked === true });
  }));

  // --- gallery ---
  r.get('/photos', (req, res) => res.json(listGallery()));
  // Which of these names already exist? Uses the exact server-side sanitization (so the admin can ask first).
  r.post('/photos/check', (req, res) => {
    const names = req.body?.names;
    if (!Array.isArray(names) || names.length > 500 || !names.every((n) => typeof n === 'string' && n.length > 0 && n.length <= 300)) {
      return res.status(400).json({ error: 'names must be an array of up to 500 file names' });
    }
    res.json({ results: checkNames(names) });
  });
  // ?onConflict=replace|rename|skip (default rename: never overwrite silently). Optional form field "meta":
  // JSON array aligned with the photos ([{ focusX, focusY }] or null); optional "thumbs[]" JPEGs, same order.
  r.post('/photos', (req, res, next) => {
    const p = req.query.onConflict;
    if (p !== undefined && p !== '' && !CONFLICT_POLICIES.includes(p)) {
      return res.status(400).json({ error: 'onConflict must be one of: replace, rename, skip' });
    }
    req.conflictPolicy = p || 'rename';
    cleanupTempUploads();
    next();
  }, uploadMiddleware(), (req, res) => {
    const policy = req.conflictPolicy;
    let metaIn = [];
    try {
      const j = JSON.parse(req.body?.meta || '[]');
      if (Array.isArray(j)) metaIn = j;
    } catch { /* ignore malformed meta: photos still get stored, just without a focal point */ }
    const all = req.files || [];
    const thumbs = new Map(all.filter((f) => isThumbField(f.fieldname)).map((f) => [f.seq, f.path]));
    const photos = all.filter((f) => !isThumbField(f.fieldname));
    const meta = readMeta();
    const files = [];
    const skipped = (req.skippedPhotos || []).map((s) => s.file);
    for (const s of req.skippedPhotos || []) {
      const t = thumbs.get(s.seq);
      if (t) fs.rmSync(t, { force: true });
    }
    for (const f of photos) {
      const r = finalizeUpload(f.path, f.targetName, policy, metaIn[f.seq] || null, meta, thumbs.get(f.seq) || null);
      if (r.status === 'skipped') skipped.push(r.file);
      else files.push(r);
    }
    for (const [seq, p] of thumbs) if (!photos.some((f) => f.seq === seq)) fs.rmSync(p, { force: true }); // unpaired
    writeMeta(meta);
    if (files.length) broadcast('photos', {});
    res.json({ ok: true, files, skipped });
  });
  // Body: { focusX, focusY } (focal point) and/or { hidden } (excluded from the rotation).
  r.patch('/photos/:file', (req, res) => {
    const body = req.body || {};
    const { focusX, focusY, hidden } = body;
    if (!isGalleryFile(req.params.file)) return res.status(404).json({ error: 'not found' });
    const hasFocus = 'focusX' in body || 'focusY' in body;
    const hasHidden = 'hidden' in body;
    if (!hasFocus && !hasHidden) return res.status(400).json({ error: 'expected focusX/focusY and/or hidden' });
    if (hasFocus && (!isUnit(focusX) || !isUnit(focusY))) return res.status(400).json({ error: 'focusX and focusY must be numbers between 0 and 1' });
    if (hasHidden && typeof hidden !== 'boolean') return res.status(400).json({ error: 'hidden must be a boolean' });
    if (!getPhoto(req.params.file)) return res.status(404).json({ error: 'not found' });
    let photo = hasFocus ? setFocus(req.params.file, focusX, focusY) : null;
    if (hasHidden) {
      setHidden([req.params.file], hidden);
      photo = getPhoto(req.params.file);
    }
    if (!photo) return res.status(404).json({ error: 'not found' });
    broadcast('photos', hasHidden && hidden ? { hidden: [photo.file] } : {});
    res.json(photo);
  });
  // Bulk show / hide: { files: string[], hidden: boolean }.
  r.post('/photos/visibility', (req, res) => {
    const { files, hidden } = req.body || {};
    if (!Array.isArray(files) || !files.length || files.length > 2000 || !files.every((f) => typeof f === 'string' && f.length <= 300 && isGalleryFile(f))) {
      return res.status(400).json({ error: 'files must be a non-empty array of up to 2000 gallery file names' });
    }
    if (typeof hidden !== 'boolean') return res.status(400).json({ error: 'hidden must be a boolean' });
    const { updated, missing } = setHidden(files, hidden);
    if (updated.length) broadcast('photos', hidden ? { hidden: updated } : {});
    const all = listGallery();
    res.json({ ok: true, updated, missing, total: all.length, inRotation: all.filter((p) => !p.hidden).length });
  });
  // Thumbnail for an existing photo (multipart field "thumb", JPEG ≤ 2 MB), used by "optimize existing".
  r.put('/photos/:file/thumb', (req, res, next) => {
    if (!isGalleryFile(req.params.file) || !getPhoto(req.params.file)) return res.status(404).json({ error: 'not found' });
    next();
  }, thumbMiddleware(), (req, res) => {
    if (!req.file || !validThumb(req.file.buffer)) return res.status(400).json({ error: 'thumb must be a JPEG of up to 2 MB' });
    storeThumb(req.params.file, req.file.buffer);
    res.json(getPhoto(req.params.file));
  });
  r.delete('/photos/:file', (req, res) => {
    if (!deletePhoto(req.params.file)) return res.status(404).json({ error: 'not found' });
    broadcast('photos', {});
    res.json({ ok: true });
  });

  return r;
}
