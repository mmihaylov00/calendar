import { useEffect, useRef, useState } from 'preact/hooks';
import type { DisplayInfo, DisplaysResponse, NightCommand } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { OpenModeCallout, openPairDialog, PairedDevicesCard } from '../components/DisplayAccess';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Empty, PageHeader, StatusDot } from '../components/ui';
import { fmtDateTime } from '../dates';
import { has } from '../caps';
import { screenHref, useDisplayLinks } from '../displayLinks';
import { formatDuration, relTime, nScreens, t } from '../i18n';
import { withPollNote } from '../liveNote';
import type { SectionProps } from './common';
import { PrivacyMenu, usePrivacy } from '../components/Privacy';

function NightMenu({ value, onPick, busy }: { value: NightCommand | null; onPick: (m: NightCommand) => void; busy?: boolean }) {
  const opts: { v: NightCommand; icon: 'moon' | 'sun' | 'clock'; label: string }[] = [
    { v: 'on', icon: 'moon', label: t('Night') },
    { v: 'off', icon: 'sun', label: t('Day') },
    { v: 'auto', icon: 'clock', label: t('Auto') },
  ];
  return (
    <div class={`seg seg--sm night-seg ${busy ? 'is-disabled' : ''}`} role="radiogroup" aria-label={t('Night mode')} style={{ '--seg-n': 3, '--seg-i': Math.max(0, opts.findIndex((o) => o.v === (value ?? 'auto'))) } as any}>
      <span class="seg__thumb" aria-hidden="true" />
      {opts.map((o) => (
        <button type="button" role="radio" aria-checked={(value ?? 'auto') === o.v} class={(value ?? 'auto') === o.v ? 'is-active' : ''} title={o.label} onClick={() => onPick(o.v)}>
          <Icon name={o.icon} size={14} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function DisplayCard({ d, serverVersion, onCmd, onForget, busy }: { d: DisplayInfo; serverVersion: string; onCmd: (action: 'reload' | 'identify' | 'night', mode?: NightCommand) => void; onForget: () => void; busy: string }) {
  const res = d.screenRes ? `${d.screenRes.w}×${d.screenRes.h}` : '–';
  const vp = d.viewport ? `${d.viewport.w}×${d.viewport.h}` : null;
  return (
    <section class={`disp ${d.connected ? 'is-on' : 'is-off'}`}>
      <header class="disp__head">
        <span class={`disp__state ${d.connected ? 'is-on' : ''}`}>
          <Icon name={d.connected ? 'wifi' : 'wifiOff'} size={16} />
        </span>
        <div class="disp__titles">
          <strong>{d.screenName || d.screenSlug || '–'}</strong>
          <span class="muted small">
            <span class="mono">{d.clientId.length > 14 ? `…${d.clientId.slice(-8)}` : d.clientId}</span> · {d.ip || '–'}
          </span>
        </div>
        <AccessBadge d={d} />
        <span class={`badge ${d.connected ? 'badge--ok' : 'badge--soft'}`}>{d.connected ? t('Online') : t('Offline')}</span>
      </header>
      <dl class="disp__facts">
        <div>
          <dt>{t('Browser')}</dt>
          <dd title={d.userAgent}>{d.uaShort || '–'}</dd>
        </div>
        <div>
          <dt>{t('Resolution')}</dt>
          <dd>
            {res}
            {d.dpr != null && <span class="muted"> @{Math.round(d.dpr * 100) / 100}x</span>}
            {vp && vp !== res && <span class="muted small"> · {t('window')} {vp}</span>}
          </dd>
        </div>
        <div>
          <dt>WebGL</dt>
          <dd>{d.webgl == null ? '–' : d.webgl ? <span class="ok-text">{t('Enabled')}</span> : <span class="muted">{d.lite ? t('Lite mode') : t('Disabled')}</span>}</dd>
        </div>
        <div>
          <dt>{t('Version')}</dt>
          <dd>
            {d.version ?? '–'}
            {d.outdated && (
              <span class="badge badge--warn" title={t('The server runs version {v}', { v: serverVersion })}>
                {t('outdated')}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{d.connected ? t('Connected since') : t('Last seen')}</dt>
          <dd title={d.connected ? d.connectedAt ?? '' : d.lastSeen}>{d.connected ? fmtDateTime(d.connectedAt) : relTime(d.lastSeen)}</dd>
        </div>
        <div>
          <dt>{t('Last heartbeat')}</dt>
          <dd title={d.lastSeen}>
            {relTime(d.lastSeen)}
            {d.uptimeSec != null && d.connected && <span class="muted small"> · {t('up {d}', { d: formatDuration(d.uptimeSec) })}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('Night mode')}</dt>
          <dd>
            {d.night == null ? '–' : d.night ? `🌙 ${t('Dimmed')}` : `☀️ ${t('Normal')}`}
            {d.nightOverride && d.nightOverride !== 'auto' && <span class="muted small"> · {t('manual')}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('First seen')}</dt>
          <dd>{fmtDateTime(d.firstSeen)}</dd>
        </div>
      </dl>
      {d.lastError && (
        <div class="test-result is-err disp__err" title={d.lastError}>
          <Icon name="alert" size={14} /> {d.lastError}
        </div>
      )}
      <footer class="disp__actions">
        {d.connected && has('displayCommands') ? (
          <>
            <Button size="sm" icon="refresh" loading={busy === 'reload'} onClick={() => onCmd('reload')}>
              {t('Reload')}
            </Button>
            <Button size="sm" icon="target" loading={busy === 'identify'} onClick={() => onCmd('identify')}>
              {t('Identify')}
            </Button>
            <span class="spacer" />
            <NightMenu value={d.nightOverride} busy={busy.startsWith('night')} onPick={(m) => onCmd('night', m)} />
          </>
        ) : d.connected ? null : (
          <>
            <span class="muted small">{t('Offline: commands will not arrive.')}</span>
            <span class="spacer" />
            <Button size="sm" variant="ghost" icon="trash" onClick={onForget}>
              {t('Forget')}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}

/** How the display got in: private link, paired device (its name), admin session or no key (open mode). */
function AccessBadge({ d }: { d: DisplayInfo }) {
  const a = d.access ?? 'open';
  if (a === 'key') return <span class="badge badge--access" title={t('Uses the screen’s private link')}>🔗 {t('Private link')}</span>;
  if (a === 'device') return <span class="badge badge--access" title={t('Paired device')}>🔑 {d.deviceName || t('Paired')}</span>;
  if (a === 'session') return <span class="badge badge--access">{t('Admin session')}</span>;
  return <span class="badge badge--access badge--warn-soft" title={t('No key (open mode)')}>{t('No key')}</span>;
}

/** "/?screen=x" → "https://host/?screen=x" (absolute URLs unchanged). */
const absUrl = (u: string | null) => (u ? new URL(u, location.origin).href : '');

export function DisplaysSection({ saved, go }: SectionProps) {
  const [data, setData] = useState<DisplaysResponse | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [showOffline, setShowOffline] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const links = useDisplayLinks(saved);

  const load = async () => {
    try {
      setData(await api.displays());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  useEffect(() => {
    load();
    timer.current = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => clearInterval(timer.current);
  }, []);

  const run = async (key: string, req: Parameters<typeof api.displayCommand>[0], label: string) => {
    setBusy((b) => ({ ...b, [key]: req.action === 'night' ? `night-${req.mode}` : req.action }));
    try {
      const r = await api.displayCommand(req);
      toast(r.delivered ? withPollNote(`${label} · ${nScreens(r.delivered)}`) : `${label} · ${nScreens(r.delivered)}`, r.delivered ? 'ok' : 'info');
      setTimeout(load, 1200);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy((b) => ({ ...b, [key]: '' }));
    }
  };
  const label = (action: string, mode?: NightCommand) =>
    action === 'reload' ? t('Reloading') : action === 'identify' ? t('Identifying') : mode === 'on' ? t('Night mode on') : mode === 'off' ? t('Night mode off') : t('Automatic night mode');

  const forget = async (d: DisplayInfo) => {
    const ok = await confirmDialog({ title: t('Forget this device?'), body: t('It will disappear from the list until it connects again.'), confirm: t('Forget') });
    if (!ok) return;
    try {
      await api.forgetDisplay(d.clientId);
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const list = (data?.displays ?? []).filter((d) => (!filter || d.screenId === filter) && (showOffline || d.connected));
  const online = data?.displays.filter((d) => d.connected) ?? [];
  const outdated = online.filter((d) => d.outdated);
  // Filter pills list SAVED screens only: commands resolve screen ids against the saved config.
  const target = filter && saved.screens.some((s) => s.id === filter) ? { screens: [filter] } : {};
  const onlineHere = online.filter((d) => !filter || d.screenId === filter);
  const privacy = usePrivacy();
  const privRows = (privacy ?? []).filter((r) => !target.screens || r.screenId === filter);
  const privRow = privRows.length ? { active: privRows.some((r) => r.active), until: privRows.find((r) => r.active)?.until ?? null } : undefined;

  return (
    <>
      <PageHeader title={t('Connected screens')} desc={t('Devices showing the calendar right now. Updates every 5 s.')}>
        <Button variant="primary" icon="link" onClick={() => openPairDialog()}>
          {t('Pair a screen')}
        </Button>
        {has('displayCommands') && (
          <>
            <Button icon="refresh" onClick={() => run('_all', { action: 'reload', ...target }, label('reload'))} loading={busy._all === 'reload'} disabled={!onlineHere.length}>
              {t('Reload all')}
            </Button>
            <Button icon="target" onClick={() => run('_all', { action: 'identify', ...target }, label('identify'))} loading={busy._all === 'identify'} disabled={!onlineHere.length}>
              {t('Identify all')}
            </Button>
          </>
        )}
      </PageHeader>

      {saved.security?.displayAccess === 'open' && <OpenModeCallout go={go} />}

      {outdated.length > 0 && (
        <Callout kind="warn">
          {t('{n} screens run an old version (server {v}). Reload them to update.', { n: outdated.length, v: data?.serverVersion ?? '' })}{' '}
          {has('displayCommands') && (
            <button type="button" class="link-btn" onClick={() => run('_all', { action: 'reload', clientIds: outdated.map((d) => d.clientId) }, label('reload'))}>
              {t('Reload now')}
            </button>
          )}
        </Callout>
      )}

      <div class="toolbar">
        <div class="target-pick">
          <button type="button" class={`pill ${!filter ? 'is-on' : ''}`} onClick={() => setFilter('')}>
            {t('All')} <span class="pill__n">{data?.displays.length ?? 0}</span>
          </button>
          {saved.screens.map((s) => {
            const n = data?.displays.filter((d) => d.screenId === s.id).length ?? 0;
            return (
              <button type="button" class={`pill ${filter === s.id ? 'is-on' : ''}`} onClick={() => setFilter(s.id)}>
                <span class="dot-color" style={{ background: s.screen.accent }} /> {s.name} <span class="pill__n">{n}</span>
              </button>
            );
          })}
        </div>
        <label class="mini-toggle">
          <input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.currentTarget.checked)} />
          <span>{t('Show offline')}</span>
        </label>
        <div class="toolbar__night">
          <span class="muted small">{filter ? t('Night on this screen') : t('Night on all')}</span>
          <NightMenu value={null} busy={busy._all?.startsWith('night')} onPick={(m) => run('_all', { action: 'night', mode: m, ...target }, label('night', m))} />
        </div>
        {has('privacy') && (
          <div class="toolbar__night">
            <span class="muted small">{target.screens ? t('Private on this screen') : t('Private on all')}</span>
            <PrivacyMenu screenId={target.screens ? filter : ''} row={privRow} tz={saved.datetime.timezone} />
          </div>
        )}
      </div>

      {err && !data ? (
        <Card>
          <Empty icon="alert" title={t('Could not get the list')}>
            {err}
          </Empty>
        </Card>
      ) : !data ? (
        <div class="disp-grid">
          <div class="skeleton skeleton--card" />
          <div class="skeleton skeleton--card" />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <Empty icon="monitor" title={t('No screen connected')}>
            {saved.security?.displayAccess === 'open' ? (
              <>
                {t('Open')} <code>{absUrl(screenHref(saved, filter || saved.defaultScreen, links))}</code> {t('on the device and it will appear here.')}
              </>
            ) : (
              t('Open the screen’s private link on the device (Screen → Settings) or pair it with a code and it will show up here.')
            )}
          </Empty>
        </Card>
      ) : (
        <div class="disp-grid">
          {list.map((d) => (
            <DisplayCard
              key={d.clientId}
              d={d}
              serverVersion={data.serverVersion}
              busy={busy[d.clientId] ?? ''}
              onForget={() => forget(d)}
              onCmd={(action, mode) => run(d.clientId, { action, mode, clientIds: [d.clientId] }, label(action, mode))}
            />
          ))}
        </div>
      )}
      <PairedDevicesCard saved={saved} onChanged={load} />
      <p class="muted small center">
        <StatusDot state={online.length ? 'ok' : 'idle'} /> {t('{n} online', { n: online.length })} · {t('server v{v}', { v: data?.serverVersion ?? '–' })}
      </p>
    </>
  );
}
