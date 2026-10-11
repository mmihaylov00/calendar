// Update banner and "What's new" logic for the admin. Plain TypeScript (no JSX, no DOM at import time) so the server
// tests can load it. The components live in components/Updates.tsx.
//
// Self-hosted (features.updates): a banner when a newer release is out, with its notes and either the update button
// (install.sh release installs) or the commands for this kind of install. Marco Cloud (runtime 'workers') never shows
// the banner; after a new version it shows the CHANGELOG section of that version once ("What's new").
import type { UpdateInfo, UpdateInstall } from '../shared/types';
import type { Caps } from './caps';
import { hasFeature } from './caps';

// ---------------------------------------------------------------- versions (same rules as server/updates.js)

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]*)?$/;

/** Semantic Versioning precedence: -1, 0 or 1. Something that is not a version sorts first. */
export function compareVersions(a: string, b: string): number {
  const x = SEMVER.exec(String(a ?? '').trim());
  const y = SEMVER.exec(String(b ?? '').trim());
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] < +y[i] ? -1 : 1;
  const px = x[4] ? x[4].split('.') : [];
  const py = y[4] ? y[4].split('.') : [];
  if (!px.length || !py.length) return px.length === py.length ? 0 : px.length ? -1 : 1;
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    if (i >= px.length) return -1;
    if (i >= py.length) return 1;
    const p = px[i];
    const q = py[i];
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p < +q ? -1 : 1;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------- the banner

export type BannerState =
  /** a newer version is out */
  | { kind: 'available'; version: string }
  /** an update is requested or running */
  | { kind: 'updating'; version: string }
  /** the server now runs a newer version than this page: reload */
  | { kind: 'updated'; version: string }
  /** the last update failed */
  | { kind: 'failed'; version: string };

/**
 * What the admin's top banner shows, or null for nothing.
 * @param pageVersion  version of the server when this page loaded (caps.version)
 * @param dismissed    version whose "available" banner was closed in this browser
 */
export function bannerFor(info: UpdateInfo | null, caps: Caps, pageVersion: string, dismissed: string | null): BannerState | null {
  if (!info || caps.runtime === 'workers' || caps.edition !== 'self-hosted' || !hasFeature(caps, 'updates')) return null;
  const st = info.status;
  if (pageVersion && info.current && compareVersions(info.current, pageVersion) > 0) return { kind: 'updated', version: info.current };
  if (st && (st.state === 'requested' || st.state === 'running') && !st.stalled) return { kind: 'updating', version: st.target || info.latest?.version || '' };
  if (st && st.state === 'failed' && st.target && info.latest?.version === st.target && dismissed !== `failed:${st.target}`) {
    return { kind: 'failed', version: st.target };
  }
  if (info.checks === 'on' && info.available && info.latest && dismissed !== info.latest.version) return { kind: 'available', version: info.latest.version };
  return null;
}

// ---------------------------------------------------------------- how to update each kind of install

export interface UpdateHowTo {
  /** commands to run, in order (one per line) */
  commands: string[];
  /** where to run them (English label) */
  where: string;
}

/** The commands for an install that the admin cannot update itself. */
export function howToUpdate(install: UpdateInstall): UpdateHowTo {
  switch (install.kind) {
    case 'release':
      return { commands: ['marco update'], where: 'On the server (over SSH or in its terminal):' };
    case 'checkout':
      return install.cli
        ? { commands: ['marco update'], where: 'On the server (over SSH or in its terminal):' }
        : { commands: ['git pull', 'npm ci', 'npm run build'], where: 'In the Calendar folder, then restart the server:' };
    case 'docker':
      return { commands: ['git pull', 'docker compose up -d --build'], where: 'In the Calendar folder, where docker-compose.yml is:' };
    default:
      return { commands: ['curl -fsSL https://marcohome.app/install | bash'], where: 'On the server, or download the release from GitHub:' };
  }
}

// ---------------------------------------------------------------- progress of an update started here

export type Phase = 'idle' | 'requested' | 'running' | 'restarting' | 'done' | 'current' | 'failed' | 'stalled';

/**
 * Where an update started from this page is.
 * @param info         the last answer of GET /api/admin/update (null when the server did not answer)
 * @param unreachable  the last request failed (the server is restarting)
 */
export function phaseOf(info: UpdateInfo | null, unreachable: boolean): Phase {
  if (unreachable) return 'restarting';
  const st = info?.status;
  if (!st) return 'idle';
  if (st.state === 'requested') return st.stalled ? 'stalled' : 'requested';
  return st.state;
}

// ---------------------------------------------------------------- release notes (a small Markdown subset)

export type NoteBlock = { type: 'h'; text: string } | { type: 'li'; text: string } | { type: 'p'; text: string };

/** Headings, list items and paragraphs from a CHANGELOG section. Inline marks (**, `, links) become plain text. */
export function noteBlocks(md: string, max = 400): NoteBlock[] {
  const out: NoteBlock[] = [];
  const inline = (s: string) =>
    s
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  let para: string[] = [];
  let item: string[] | null = null;
  const flush = () => {
    if (item) out.push({ type: 'li', text: inline(item.join(' ')) });
    else if (para.length) out.push({ type: 'p', text: inline(para.join(' ')) });
    item = null;
    para = [];
  };
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ type: 'h', text: inline(h[1]) });
    } else if (li && !/^\s{4,}/.test(line)) {
      flush();
      item = [li[1]];
    } else if (!line.trim()) {
      flush();
    } else if (item) item.push(line.trim());
    else para.push(line.trim());
    if (out.length >= max) break;
  }
  flush();
  return out.slice(0, max);
}

// ---------------------------------------------------------------- Marco Cloud: "What's new" once per version

/**
 * Whether to show the notes of `version` now. `seen` is the version this browser last ran (null on a first visit,
 * which only records it). Self-hosted servers use the banner instead.
 */
export function shouldShowWhatsNew(caps: Caps, version: string, seen: string | null, notes: string): boolean {
  if (caps.runtime !== 'workers' && caps.edition !== 'cloud') return false;
  if (!version || !notes.trim() || !seen) return false;
  return compareVersions(version, seen) > 0;
}
