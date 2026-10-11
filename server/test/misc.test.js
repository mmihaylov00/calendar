import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wmoDescription, windDirLabel } from '../core/lib/i18n.js';
import { isoWithOffset, zonedMidnight, localDate, addDays } from '../core/lib/tz.js';
import { mapOpenMeteo } from '../core/weather.js';
import { sanitizeFilename, isGalleryFile } from '../photos.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { displayConfig } from '../core/screens.js';
import { defaultConfig } from '../core/defaults.js';

test('weather i18n', () => {
  assert.equal(wmoDescription(0, 'es'), 'Clear sky');
  assert.equal(wmoDescription(63, 'pt'), 'Rain');
  assert.equal(wmoDescription(95, 'en'), 'Thunderstorm');
  assert.equal(windDirLabel(225, 'es'), 'SW');
  assert.equal(windDirLabel(225, 'en'), 'SW');
  assert.equal(windDirLabel(359, 'es'), 'N');
});

test('tz helpers', () => {
  assert.equal(isoWithOffset(new Date('2026-07-01T12:00:00Z'), 'Europe/Lisbon'), '2026-07-01T13:00:00+01:00');
  assert.equal(isoWithOffset(new Date('2026-12-01T12:00:00Z'), 'Europe/Lisbon'), '2026-12-01T12:00:00+00:00');
  assert.equal(zonedMidnight('2026-10-25', 'Europe/Lisbon').toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(zonedMidnight('2026-10-26', 'Europe/Lisbon').toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(localDate(new Date('2026-10-08T23:30:00Z'), 'Europe/Lisbon'), '2026-10-09');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('open-meteo mapping', () => {
  const j = {
    utc_offset_seconds: 3600,
    current: { temperature_2m: 21.44, relative_humidity_2m: 60, apparent_temperature: 20.9, is_day: 1, weather_code: 2, wind_speed_10m: 13.6, wind_direction_10m: 315, pressure_msl: 1017.2, uv_index: 4.21 },
    daily: { time: ['2026-10-09', '2026-10-10'], weather_code: [2, 61], temperature_2m_max: [24, 20], temperature_2m_min: [14, 13], precipitation_probability_max: [5, 70], wind_speed_10m_max: [20, 30], sunrise: ['2026-10-09T07:36', '2026-10-10T07:37'], sunset: ['2026-10-09T19:05', '2026-10-10T19:03'] },
    hourly: { time: Array.from({ length: 24 }, (_, i) => `2026-10-09T${String(i).padStart(2, '0')}:00`), temperature_2m: Array(24).fill(20), weather_code: Array(24).fill(1), precipitation_probability: Array(24).fill(0), is_day: Array(24).fill(1) },
  };
  const w = mapOpenMeteo(j, { lang: 'es', locationName: 'Lisbon', forecastDays: 5, now: new Date('2026-10-09T10:30:00+01:00') });
  assert.equal(w.current.temp, 21.4);
  assert.equal(w.current.windKmh, 14);
  assert.equal(w.current.windDirLabel, 'NW');
  assert.equal(w.current.description, 'Partly cloudy');
  assert.equal(w.today.sunrise, '2026-10-09T07:36:00+01:00');
  assert.equal(w.today.max, 24);
  assert.equal(w.daily.length, 2);
  assert.equal(w.hourly.length, 8);
  assert.equal(w.hourly[0].time, '2026-10-09T10:00:00+01:00');
  assert.equal(w.indoor, null);
});

test('upload filename sanitisation', () => {
  assert.equal(sanitizeFilename('../../etc/Fotó Família 2024!.JPEG'), 'foto-familia-2024.jpg');
  assert.equal(sanitizeFilename('.hidden.png'), 'hidden.png');
  assert.equal(isGalleryFile('../x.jpg'), false);
  assert.equal(isGalleryFile('a.webp'), true);
  assert.equal(isGalleryFile('a.svg'), false);
});

test('scrypt password hashing', async () => {
  const h = await hashPassword('s3cret!');
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword('s3cret!', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('display config never leaks urls, accounts or HA entities', () => {
  const c = defaultConfig();
  c.calendar.sources.push({ id: 'g', type: 'google', name: 'G', googleAccount: 'a@b.c', googleCalendarId: 'x', color: '#000', emoji: '', kind: 'generic', enabled: true, refreshMin: 5 });
  c.weather.haIndoorTempEntity = 'sensor.salon';
  const d = displayConfig(c, c.screens[0]);
  const s = JSON.stringify(d);
  assert.ok(!s.includes('calendar.google.com'));
  assert.ok(!s.includes('a@b.c'));
  assert.ok(!s.includes('sensor.salon'));
  assert.equal(d.homeassistant, undefined);
  assert.equal(d.auth, undefined);
  assert.deepEqual(Object.keys(d.calendar.sources[0]).sort(), ['color', 'emoji', 'id', 'kind', 'name']);
  assert.deepEqual(d.news, { enabled: true, rotateSec: 15 });
});

test('multipart latin1 filename recovery', async () => {
  const { fixLatin1 } = await import('../photos.js');
  assert.equal(fixLatin1(Buffer.from('Fotó Playa.jpg', 'utf8').toString('latin1')), 'Fotó Playa.jpg');
  assert.equal(fixLatin1('plain.jpg'), 'plain.jpg');
});

test('insecureTls requests have an overall deadline (slow-drip server cannot hang them)', async () => {
  const { request } = await import('../lib/http.js');
  const https = await import('node:https');
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'),
      '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  } catch {
    return; // openssl unavailable: skip
  }
  const srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    const iv = setInterval(() => res.write('X'), 200);
    res.on('close', () => clearInterval(iv));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  const t0 = Date.now();
  await assert.rejects(request(`https://127.0.0.1:${port}/x.ics`, { insecureTls: true, timeout: 1000 }), /Timeout/);
  assert.ok(Date.now() - t0 < 3000);
  srv.closeAllConnections?.();
  await new Promise((r) => srv.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});
