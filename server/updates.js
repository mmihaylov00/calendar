// Update checks for a self-hosted server (docs/ARCHITECTURE.md "Updates").
//
// Once a day the server asks GitHub which release is the latest (one GET to the public API, with If-None-Match so an
// unchanged answer costs nothing; no other data is sent) and the admin shows a banner when it is newer than the one
// running. MARCO_UPDATE_CHECK=0 turns the check off, as does the admin's own switch.
//
// Installs made with install.sh (release layout) can also be updated from the admin. The server never runs the update
// itself (it runs as an unprivileged user): it writes <data>/update/request, a systemd path unit installed by the
// installer (marco-update.path) sees it and starts marco-update.service, which runs `marco update --requested` as
// root. That command reads nothing from the request but its presence, writes its progress to
// <data>/update/status.json and the installer's output to <data>/update/update.log (both as the service user), and the
// installer swaps the release, restarts this server and rolls back when the new version does not start.
//
// Files in <data>/update/ (all small JSON or text):
//   settings.json  { check, auto, from, to }            admin settings (auto updates are off by default)
//   check.json     { etag, checkedAt, latest, error }    the last answer from GitHub
//   request        present while an update is requested (removed by the root service when it starts)
//   status.json    { state, from, to, by, at, ... }      the last update: requested | running | done | current | failed
//   update.log     the installer's output of the last update
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './store.js';
import { zonedParts } from './core/lib/tz.js';

export const DEFAULT_REPO = 'mr-reb00t/marco';
export const DEFAULT_LATEST_URL = `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`;
export const DAY_MS = 24 * 3600_000;
/** A failed check is tried again after this long (GitHub down, no network). */
export const RETRY_MS = 6 * 3600_000;
/** How often the timer looks at the schedule (the network is only used once a day). */
export const TICK_MS = 15 * 60_000;
/** A request that no root service picked up within this time is reported as stalled. */
export const STALL_MS = 2 * 60_000;
/** A manual "check now" is refused when the last check is more recent than this. */
export const MANUAL_CHECK_GAP_MS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_NOTES = 20_000;
const LOG_LINES = 60;

export const DEFAULT_SETTINGS = Object.freeze({ check: true, auto: false, from: '03:00', to: '05:00' });

// ---------------------------------------------------------------- versions

const SEMVER = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{0,64})?$/;

/** "v1.2.3-rc.1" → { major, minor, patch, pre: ['rc', '1'] }; null when it is not a version. */
export function parseVersion(v) {
  const m = SEMVER.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** Semantic Versioning precedence: -1, 0 or 1. Something that is not a version sorts before any version. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  // A pre-release sorts before its release (1.0.0-rc.1 < 1.0.0).
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const p = x.pre[i];
    const q = y.pre[i];
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p < +q ? -1 : 1;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** True when `latest` is a newer version than `current`. */
export const isNewer = (latest, current) => Boolean(parseVersion(latest)) && compareVersions(latest, current) > 0;

// ---------------------------------------------------------------- settings and the update window

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Settings with defaults; anything invalid falls back to the default. */
export function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    check: typeof o.check === 'boolean' ? o.check : DEFAULT_SETTINGS.check,
    auto: typeof o.auto === 'boolean' ? o.auto : DEFAULT_SETTINGS.auto,
    from: typeof o.from === 'string' && HHMM.test(o.from) ? o.from : DEFAULT_SETTINGS.from,
    to: typeof o.to === 'string' && HHMM.test(o.to) ? o.to : DEFAULT_SETTINGS.to,
  };
}

/** Validation errors of a settings patch from the admin ([] when it is fine). */
export function settingsErrors(patch) {
  const e = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['body must be an object'];
  for (const k of ['check', 'auto']) if (k in patch && typeof patch[k] !== 'boolean') e.push(`${k} must be a boolean`);
  for (const k of ['from', 'to']) if (k in patch && !(typeof patch[k] === 'string' && HHMM.test(patch[k]))) e.push(`${k} must be HH:MM`);
  if ('from' in patch && 'to' in patch && patch.from === patch.to) e.push('from and to must differ');
  return e;
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `date` falls in the window [from, to) in time zone `tz`; a window may cross midnight (23:00 → 02:00). */
export function inWindow(date, tz, from, to) {
  let p;
  try {
    p = zonedParts(date, tz);
  } catch {
    p = zonedParts(date, 'UTC');
  }
  const m = (p.h % 24) * 60 + p.mi;
  const a = minutes(from);
  const b = minutes(to);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

// ---------------------------------------------------------------- how this server was installed

/** Reads KEY=value lines of /etc/marco.conf (the installer's record). Values may be shell-quoted with printf %q. */
export function parseMarcoConf(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^(MARCO_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (/^'.*'$/.test(v) || /^".*"$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v.replace(/\\(.)/g, '$1');
  }
  return out;
}

const realpath = (p, fsx) => {
  try {
    return fsx.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * How this server was installed, which decides what the admin offers:
 *   release   install.sh, prebuilt release (<dir>/releases/<v>): `marco update`, and the button when the
 *             marco-update.path unit is installed (canApply)
 *   checkout  a git checkout: `marco update` when install.sh manages it (cli), else git pull and a rebuild
 *   docker    a container: git pull and docker compose up -d --build
 *   manual    anything else (a tarball run by hand): download the release
 * @param {{ root: string, dataDir: string, env?: Record<string, string|undefined>, fsx?: typeof fs }} o
 */
export function detectInstall({ root, dataDir, env = process.env, fsx = fs }) {
  const exists = (p) => {
    try {
      return fsx.existsSync(p);
    } catch {
      return false;
    }
  };
  // The Docker image sets MARCO_INSTALL=docker. A container with systemd where install.sh ran (LXC, a test box)
  // is a release install: /etc/marco.conf decides before /.dockerenv does.
  if (String(env.MARCO_INSTALL || '').trim().toLowerCase() === 'docker') return { kind: 'docker', canApply: false, cli: false };
  let conf = {};
  try {
    conf = parseMarcoConf(fsx.readFileSync(env.MARCO_CONF || '/etc/marco.conf', 'utf8'));
  } catch {
    /* not installed with install.sh */
  }
  const appDir = realpath(root, fsx);
  if (conf.MARCO_DIR && conf.MARCO_MODE !== 'kiosk') {
    const dir = realpath(conf.MARCO_DIR, fsx);
    if ((conf.MARCO_LAYOUT || 'release') === 'release' && appDir.startsWith(path.join(dir, 'releases') + path.sep)) {
      const unit = exists(env.MARCO_UPDATE_UNIT || '/etc/systemd/system/marco-update.path');
      const sameData = realpath(dataDir, fsx) === realpath(path.join(conf.MARCO_DIR, 'data'), fsx);
      return { kind: 'release', canApply: unit && sameData, cli: true };
    }
    if (conf.MARCO_LAYOUT === 'checkout' && appDir === dir) return { kind: 'checkout', canApply: false, cli: true };
  }
  if (exists('/.dockerenv') || exists('/run/.containerenv')) return { kind: 'docker', canApply: false, cli: false };
  if (exists(path.join(root, '.git'))) return { kind: 'checkout', canApply: false, cli: false };
  return { kind: 'manual', canApply: false, cli: false };
}

// ---------------------------------------------------------------- the release answer

/** Release notes without the install instructions every release carries (scripts/release-notes.js). */
export function trimNotes(body) {
  let s = String(body || '').replace(/\r\n/g, '\n');
  const cut = s.search(/^#{2,3} Install or update\s*$/m);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.trim();
  return s.length > MAX_NOTES ? `${s.slice(0, MAX_NOTES).replace(/\n[^\n]*$/, '')}\n…` : s;
}

/** The fields Marco keeps from GitHub's "latest release" answer; null when it is not usable. */
export function releaseFrom(json) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const version = String(json.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version)) return null;
  const url = typeof json.html_url === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(json.html_url) ? json.html_url : null;
  const publishedAt = typeof json.published_at === 'string' && !Number.isNaN(Date.parse(json.published_at)) ? json.published_at : null;
  return { version, name: typeof json.name === 'string' ? json.name.slice(0, 120) : '', notes: trimNotes(json.body), url, publishedAt };
}

// ---------------------------------------------------------------- the updater

const STATES = new Set(['requested', 'running', 'done', 'current', 'failed']);
const VERSIONISH = /^[0-9A-Za-z.+-]{0,64}$/;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * @param {{
 *   version: string, dataDir: string, root?: string, env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch, now?: () => number, timezone?: () => string, install?: ReturnType<typeof detectInstall>,
 *   log?: (type: string, o: object) => void,
 * }} o
 */
export function createUpdater(o) {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const fetchImpl = o.fetchImpl ?? ((...a) => fetch(...a));
  const timezone = o.timezone ?? (() => 'UTC');
  const log = o.log ?? (() => {});
  const dir = path.join(o.dataDir, 'update');
  const file = (n) => path.join(dir, n);
  const latestUrl = String(env.MARCO_UPDATE_URL || '').trim() || DEFAULT_LATEST_URL;
  const envOff = /^(0|false|no|off)$/i.test(String(env.MARCO_UPDATE_CHECK ?? '').trim());
  let install = o.install ?? null;
  let inflight = null;
  let timer = null;
  let firstTimer = null;

  const getInstall = () => (install ??= detectInstall({ root: o.root ?? process.cwd(), dataDir: o.dataDir, env }));

  const readJson = (n) => {
    try {
      const v = JSON.parse(fs.readFileSync(file(n), 'utf8'));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const writeJson = (n, v) => {
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(file(n), `${JSON.stringify(v, null, 2)}\n`);
  };

  const settings = () => normalizeSettings(readJson('settings.json'));
  const checking = () => !envOff && settings().check;
  const cache = () => readJson('check.json') ?? {};

  /** The last update (status.json), with `stalled` for a request no root service has picked up. */
  function status() {
    const s = readJson('status.json');
    if (!s || !STATES.has(s.state)) return null;
    const clean = (v) => (typeof v === 'string' && VERSIONISH.test(v) ? v : '');
    const at = typeof s.at === 'string' && !Number.isNaN(Date.parse(s.at)) ? s.at : null;
    const out = {
      state: s.state,
      from: clean(s.from),
      to: clean(s.to),
      target: clean(s.target),
      by: s.by === 'auto' ? 'auto' : 'admin',
      at,
      rolledBack: s.rolledBack === true,
      stalled: false,
    };
    if (s.state === 'requested' && at && now() - Date.parse(at) > STALL_MS && fs.existsSync(file('request'))) out.stalled = true;
    return out;
  }

  /** Last lines of the installer's output (no colour codes). */
  function logTail(lines = LOG_LINES) {
    let text = '';
    try {
      const fd = fs.openSync(file('update.log'), 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, 16_384);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }
    return text.replace(ANSI, '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).slice(-lines).map((l) => l.slice(0, 300));
  }

  const busy = (s = status()) => Boolean(s && (s.state === 'running' || (s.state === 'requested' && !s.stalled)));

  /** What GET /api/admin/update answers. */
  function info() {
    // The root service writes the outcome after this server has restarted: record it on the first look.
    recordFinished();
    const c = cache();
    const latest = c.latest && parseVersion(c.latest.version) ? c.latest : null;
    const st = status();
    return {
      current: o.version,
      latest,
      available: Boolean(latest && isNewer(latest.version, o.version)),
      checkedAt: typeof c.checkedAt === 'string' ? c.checkedAt : null,
      error: typeof c.error === 'string' ? c.error : null,
      checks: envOff ? 'env-off' : settings().check ? 'on' : 'off',
      install: getInstall(),
      settings: settings(),
      status: st,
      log: st ? logTail() : [],
    };
  }

  /** One GET to GitHub (If-None-Match with the stored ETag). Never throws; the result lands in check.json. */
  async function check({ force = false } = {}) {
    if (envOff) return info();
    if (inflight) return inflight;
    inflight = (async () => {
      const prev = cache();
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Calendar' };
      // A 304 answer only means "unchanged" while the stored release is still there.
      if (prev.etag && prev.latest && !force) headers['If-None-Match'] = prev.etag;
      const next = { ...prev, checkedAt: new Date(now()).toISOString() };
      try {
        const res = await fetchImpl(latestUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (res.status === 304) {
          next.error = null;
        } else if (res.status === 404) {
          // No release published yet.
          Object.assign(next, { latest: null, etag: null, error: null });
        } else if (res.status === 403 || res.status === 429) {
          next.error = 'rate_limited';
        } else if (!res.ok) {
          next.error = 'http';
        } else {
          const rel = releaseFrom(await res.json().catch(() => null));
          if (rel) Object.assign(next, { latest: rel, etag: res.headers.get('etag') || null, error: null });
          else next.error = 'bad_response';
        }
      } catch {
        next.error = 'network';
      }
      try {
        writeJson('check.json', next);
      } catch (err) {
        console.warn('[updates] cannot write check.json:', err.message);
      }
      const latest = next.latest?.version;
      if (!next.error && latest && isNewer(latest, o.version) && prev.latest?.version !== latest) {
        console.log(`[updates] Calendar ${latest} is available (running ${o.version})`);
      }
      return info();
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** True when the daily check is due (or a failed one should be tried again). */
  function due() {
    if (!checking()) return false;
    const c = cache();
    const at = Date.parse(c.checkedAt || '');
    if (Number.isNaN(at)) return true;
    return now() - at >= (c.error ? RETRY_MS : DAY_MS) || now() < at;
  }

  function saveSettings(patch) {
    const next = normalizeSettings({ ...settings(), ...patch });
    writeJson('settings.json', next);
    return next;
  }

  /**
   * Ask the root service for an update (writes the request file). Errors: 'not_supported' (no marco-update unit),
   * 'busy' (an update is running), 'up_to_date' (nothing newer is known).
   */
  function request({ by = 'admin' } = {}) {
    const inst = getInstall();
    if (!inst.canApply) return { ok: false, error: 'not_supported' };
    if (busy()) return { ok: false, error: 'busy' };
    const c = cache();
    const target = c.latest?.version;
    if (!target || !isNewer(target, o.version)) return { ok: false, error: 'up_to_date' };
    const at = new Date(now()).toISOString();
    fs.mkdirSync(dir, { recursive: true });
    // The root service only looks at whether this file exists; the content is for people reading the folder.
    writeFileAtomic(file('request'), `${JSON.stringify({ target, by, at })}\n`);
    writeJson('status.json', { state: 'requested', from: o.version, to: '', target, by, at });
    try {
      fs.rmSync(file('update.log'), { force: true });
    } catch {
      /* ignore */
    }
    if (by === 'auto') log('update.requested', { by, from: o.version, to: target });
    return { ok: true, from: o.version, to: target };
  }

  /** Automatic update: on, a newer version known, inside the window, not already tried for that version. */
  function autoDue(date = new Date(now())) {
    const s = settings();
    if (!s.auto || !checking()) return false;
    const inst = getInstall();
    const c = cache();
    const target = c.latest?.version;
    if (!inst.canApply || !target || !isNewer(target, o.version)) return false;
    if (!inWindow(date, timezone(), s.from, s.to)) return false;
    const st = status();
    if (busy(st)) return false;
    // A version that failed (and was rolled back) is not tried again automatically.
    if (st && st.state === 'failed' && (st.target === target || st.to === target)) return false;
    return true;
  }

  async function tick() {
    try {
      recordFinished();
      if (due()) await check();
      if (autoDue()) {
        const r = request({ by: 'auto' });
        if (r.ok) console.log(`[updates] automatic update to ${cache().latest?.version} requested`);
      }
    } catch (err) {
      console.warn('[updates]', err.message);
    }
  }

  /** Records (activity log) the outcome of an update that finished while this server was being replaced, once. */
  function recordFinished() {
    const s = readJson('status.json');
    if (!s || s.logged || !['done', 'current', 'failed'].includes(s.state)) return;
    const st = status();
    log(st.state === 'failed' ? 'update.failed' : 'update.finished', { by: st.by, from: st.from, to: st.to || o.version, target: st.target, rolledBack: st.rolledBack, state: st.state });
    try {
      writeJson('status.json', { ...s, logged: true });
    } catch {
      /* ignore */
    }
  }

  function start({ firstDelayMs = 60_000 + Math.floor(Math.random() * 120_000) } = {}) {
    stop();
    recordFinished();
    firstTimer = setTimeout(tick, firstDelayMs);
    firstTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    clearTimeout(firstTimer);
    clearInterval(timer);
    firstTimer = timer = null;
  }

  return { info, check, due, settings, saveSettings, status, logTail, request, autoDue, tick, start, stop, recordFinished, dir, envOff };
}

// ---------------------------------------------------------------- the server's instance

let instance = null;

/** The server's updater (created on first use with the data folder of the store). */
export function getUpdater(opts) {
  if (!instance) instance = createUpdater(opts());
  return instance;
}

/** Tests: drop the instance. */
export function resetUpdater() {
  instance?.stop();
  instance = null;
}
