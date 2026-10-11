import { appUrl } from '../../shared/path';
// Display access UI: per-screen private link card, "Pair a screen" dialog (opened from anywhere through
// openPairDialog(), e.g. the QR on a waiting display → /admin/#pair=<code>), paired devices list and the
// open-mode recommendation. Server side: server/displayAccess.js, server/pairing.js; docs/API.md "Display access".
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DisplayAccessMode, DisplayLinksResponse, PairConfirm, PairedDevice, ScreenProfile, StoredConfig } from '../../shared/types';
import { caps, pairCodeLength } from '../caps';
import { claimErrorCode, cleanCode, confirmWhere, formatCode } from '../pairCode';
import { displayOriginOf, refreshDisplayLinks, useDisplayLinks, usesPrivateLinks } from '../displayLinks';
import { api, ApiError } from '../api';
import { fmtDateTime } from '../dates';
import { relTime, t } from '../i18n';
import { confirmDialog, toast } from './feedback';
import { Icon } from './icons';
import { CopyField, Qr } from './share';
import { Button, Callout, Card, Empty, Field, Modal, Select, TextInput } from './ui';

export { CODE_ALPHABET, cleanCode, formatCode, claimErrorCode, confirmWhere } from '../pairCode';
/** Longest code any server uses (caps.ts accepts 4 to 12). */
const MAX_CODE_LENGTH = 12;

export const isLocalhost = () => /^(localhost|127\.|\[::1\])/.test(location.hostname);

/**
 * Origin other devices can reach this server at. Opened on the server itself (http://localhost) the admin uses
 * PUBLIC_URL or this machine's LAN address (same as the setup wizard); '' when neither is known (Docker without
 * LAN_ADDRESS): then the QR code is hidden instead of pointing devices at "localhost".
 */
export function shareOrigin(data: Pick<DisplayLinksResponse, 'lanAddresses' | 'publicUrl' | 'displayOrigin'> | null): string {
  // Marco Cloud serves the display pages from their own origin.
  const display = displayOriginOf(data as DisplayLinksResponse | null);
  if (display) return display;
  if (!isLocalhost()) return location.origin;
  if (data?.publicUrl) return data.publicUrl;
  const ip = data?.lanAddresses?.[0];
  return ip ? `${location.protocol}//${ip}${location.port ? `:${location.port}` : ''}` : '';
}

/* ------------------------------------------------------------------ private link card (per screen) */

export function PrivateLinkCard({ screenId, saved, mode, go }: { screenId: string; saved: StoredConfig; mode: DisplayAccessMode; go: (r: string) => void }) {
  const [data, setData] = useState<DisplayLinksResponse | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isSaved = saved.screens.some((s) => s.id === screenId);
  const load = () =>
    api
      .displayLinks()
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr((e as ApiError).message));
  useEffect(() => {
    load();
  }, [saved.revision]);
  const link = data?.links.find((l) => l.screenId === screenId);
  const origin = shareOrigin(data);
  // What other devices open / scan ("Open" below stays on this browser's own origin, or the
  // display origin when the server has one).
  const url = link ? `${origin || location.origin}${appUrl(link.path)}` : '';

  const regenerate = async () => {
    if (!link) return;
    const ok = await confirmDialog({
      title: t('Regenerate the private link?'),
      body: t('The current link stops working at once and screens using it will show “link no longer valid”. Then open the new link on them (or pair them with a code).'),
      confirm: t('Regenerate link'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.regenerateLink(screenId);
      await Promise.all([load(), refreshDisplayLinks()]);
      toast(t('Link regenerated · the old one no longer works'));
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      id="scr-link"
      scope="screen"
      title={t('Private link')}
      icon="link"
      desc={t('Open this link on the device that shows this screen (Raspberry Pi, tablet, TV). Whoever has the link sees this screen: only share it with your own devices.')}
    >
      {!isSaved ? (
        <Callout>{t('Save the screen to get its private link.')}</Callout>
      ) : err && !data ? (
        <Callout kind="error">{err}</Callout>
      ) : !link ? (
        <div class="skeleton skeleton--card" />
      ) : (
        <>
          {mode === 'open' && (
            <Callout kind="warn">
              {t('Screens are in open mode: this link works, but so does the address without a key.')}{' '}
              <button type="button" class="link-btn" onClick={() => go('security/sec-display')}>
                {t('Switch to private links')}
              </button>
            </Callout>
          )}
          <div class="plink">
            {origin && (
              <div class="plink__qr">
                <Qr text={url} label={t('QR code of the private link')} />
                <span class="muted small">{t('Scan it on the screen’s tablet or phone')}</span>
              </div>
            )}
            <div class="plink__main">
              <Field label={t('Screen link')}>
                <CopyField value={url} />
              </Field>
              {isLocalhost() && origin && <p class="muted small">{t('You are on “localhost”: the link uses this computer’s network address ({host}) so it works on other devices.', { host: new URL(origin).host })}</p>}
              {isLocalhost() && !origin && (
                <Callout kind="warn">{t('You are on “localhost” and this server’s network address is unknown: open the admin with its IP or name (or set LAN_ADDRESS) to get the QR code.')}</Callout>
              )}
              <div class="plink__actions">
                <a class="btn btn--default btn--sm" href={`${displayOriginOf(data) ?? ''}${appUrl(link.path)}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={15} />
                  <span>{t('Open')}</span>
                </a>
                <Button size="sm" variant="ghost" icon="refresh" loading={busy} onClick={regenerate}>
                  {t('Regenerate link')}
                </Button>
                <span class="muted small">{t('Created {when}', { when: relTime(link.createdAt) })}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ open-mode recommendation */

export function OpenModeCallout({ go }: { go: (r: string) => void }) {
  return (
    <Callout kind="warn">
      {t('Screens are in open mode: anyone who can reach this server can see the calendar without a key. Recommended: private links and pairing.')}{' '}
      <button type="button" class="link-btn" onClick={() => go('security/sec-display')}>
        {t('Go to Security')}
      </button>
    </Callout>
  );
}

/* ------------------------------------------------------------------ pair dialog (global host) */

let pairReq: { code: string } | null = null;
const pairListeners = new Set<() => void>();
/** Open the "Pair a screen" dialog (optionally prefilled, e.g. from /admin/#pair=<code>). */
export function openPairDialog(code = '') {
  pairReq = { code: cleanCode(code, MAX_CODE_LENGTH) };
  pairListeners.forEach((l) => l());
}

export function PairDialogHost({ saved, defaultScreenId, onPaired }: { saved: StoredConfig; defaultScreenId: string; onPaired?: (d: PairedDevice) => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    pairListeners.add(l);
    return () => void pairListeners.delete(l);
  }, []);
  if (!pairReq) return null;
  const close = () => {
    pairReq = null;
    force((n) => n + 1);
  };
  return <PairDialog key={pairReq.code} initialCode={pairReq.code} saved={saved} defaultScreenId={defaultScreenId} onClose={close} onPaired={onPaired} />;
}

/** "Or open the private link": the selected screen's private link with a QR code, folded under the pairing form. */
function PrivateLinkAlt({ saved, screenId }: { saved: StoredConfig; screenId: string }) {
  const links = useDisplayLinks(saved);
  const link = links.data?.links.find((l) => l.screenId === screenId);
  if (!usesPrivateLinks(saved) || !link) return null;
  const origin = shareOrigin(links.data);
  const url = `${origin || location.origin}${appUrl(link.path)}`;
  return (
    <details class="pair-alt">
      <summary>{t('Or open the screen’s private link')}</summary>
      <p class="muted small">{t('Open it in the browser of the TV or tablet, or scan the QR code. Anyone with the link can see this screen, so only share it with your own devices.')}</p>
      <div class="pair-alt__body">
        {origin && <Qr text={url} label={t('QR code of the private link')} />}
        <CopyField value={url} />
      </div>
    </details>
  );
}

function PairDialog({ initialCode, saved, defaultScreenId, onClose, onPaired }: { initialCode: string; saved: StoredConfig; defaultScreenId: string; onClose: () => void; onPaired?: (d: PairedDevice) => void }) {
  const screens = saved.screens;
  const len = pairCodeLength();
  // Marco Cloud serves the pairing page from its display origin: name the exact address to open on the TV.
  const displayOrigin = caps().displayOrigin;
  const pairAddress = displayOrigin ? `${displayOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '')}/pair` : '';
  const [code, setCode] = useState(() => cleanCode(initialCode, len));
  const [screenId, setScreenId] = useState(screens.some((s) => s.id === defaultScreenId) ? defaultScreenId : screens[0]?.id ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Second step: the server found the waiting display; the owner confirms it is the one in front of them.
  const [ask, setAsk] = useState<PairConfirm | null>(null);
  const [done, setDone] = useState<PairedDevice | null>(null);
  const complete = code.length === len;
  const screenName = screens.find((s) => s.id === screenId)?.name ?? '';

  const paired = (device: PairedDevice) => {
    setDone(device);
    onPaired?.(device);
    toast(t('Screen paired: {name}', { name: device.name }));
  };

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!complete || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.claimPairing({ code, screenId, name: name.trim() || undefined, ...(ask ? { confirm: true } : {}) });
      if (r.device) paired(r.device);
      else if (r.confirm) setAsk({ ...r.confirm, where: confirmWhere(r.confirm), screenName: r.confirm.screenName || screenName });
      else setErr(t('Unexpected answer from the server. Try again.'));
    } catch (e2) {
      const ae = e2 as ApiError;
      const c = claimErrorCode(ae.body);
      setAsk(null);
      setErr(
        ae.status === 429 || c === 'rate_limited'
          ? t('Too many wrong codes. Wait a few minutes.')
          : c === 'invalid_code'
            ? t('Code not found or expired. Check the code on the screen (it must still be showing the pairing page).')
            : c === 'device_limit'
              ? t('You have reached the maximum number of paired devices. Revoke one you no longer use.')
              : ae.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Pair a screen')}
      icon="link"
      size="sm"
      onClose={onClose}
      dirty={!done && code !== initialCode && code.length > 0}
      footer={
        done ? (
          <Button variant="primary" icon="check" onClick={onClose}>
            {t('Done')}
          </Button>
        ) : ask ? (
          <>
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>
              {t('Back')}
            </Button>
            <Button variant="primary" icon="link" loading={busy} onClick={() => submit()}>
              {t('Yes, pair it')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!complete || !screenId} onClick={() => submit()}>
              {t('Continue')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div class="pair-done">
          <span class="pair-done__ico">
            <Icon name="check" size={26} />
          </span>
          <strong>{t('Done! “{name}” now shows {screen}.', { name: done.name, screen: done.screenName || ask?.screenName || screenName })}</strong>
          <p class="muted small">{t('The screen starts by itself in a few seconds. You can rename or revoke it in Connected screens.')}</p>
        </div>
      ) : ask ? (
        <form class="stack pair-confirm" onSubmit={submit}>
          <div class="pair-confirm__code mono">{formatCode(code, len)}</div>
          <p>
            {ask.where
              ? t('A screen at {where} is waiting with this code. It will show “{screen}”.', { where: ask.where, screen: ask.screenName })
              : t('A screen is waiting with this code. It will show “{screen}”.', { screen: ask.screenName })}
          </p>
          <Callout kind="warn">{t('Only pair a screen that is in front of you. If the code came in a link or a message from someone else, cancel.')}</Callout>
          <button type="submit" hidden />
        </form>
      ) : (
        <form class="stack" onSubmit={submit}>
          <p class="muted small">
            {pairAddress
              ? t('On the TV, open {url}. It shows a code with {n} characters. Type it here.', { url: pairAddress, n: len })
              : t('Open Marco on the new screen (or the /pair address): it shows a code of {n} characters. Type it here.', { n: len })}
          </p>
          <Field label={t('Screen code')} error={err || undefined}>
            <input
              class={`input pair-code ${err ? 'is-invalid' : ''}`}
              value={formatCode(code, len)}
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellcheck={false}
              placeholder={formatCode('ABCDEFGH23456789'.slice(0, Math.ceil(len / 2)) + '23456789'.slice(0, len - Math.ceil(len / 2)), len)}
              aria-label={t('Screen code')}
              maxLength={len + 1}
              data-autofocus
              onInput={(e) => {
                setCode(cleanCode(e.currentTarget.value, len));
                setErr('');
              }}
            />
          </Field>
          <Field label={t('Screen to show')}>
            <Select value={screenId} options={screens.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => setScreenId(v)} />
          </Field>
          <Field label={t('Device name (optional)')} hint={t('For example “Kitchen tablet”. Default: {name}.', { name: screenName })}>
            <TextInput value={name} maxLength={60} placeholder={screenName} onValue={setName} />
          </Field>
          <button type="submit" hidden />
          <PrivateLinkAlt saved={saved} screenId={screenId} />
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ paired devices */

export function PairedDevicesCard({ saved, onChanged }: { saved: StoredConfig; onChanged?: () => void }) {
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<PairedDevice | null>(null);
  const load = () =>
    api
      .devices()
      .then((r) => {
        setDevices(r.devices);
        setErr('');
      })
      .catch((e) => setErr((e as ApiError).message));
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 10000);
    const onPaired = () => load();
    window.addEventListener('marco:paired', onPaired);
    return () => {
      clearInterval(id);
      window.removeEventListener('marco:paired', onPaired);
    };
  }, []);

  const revoke = async (d: PairedDevice) => {
    const ok = await confirmDialog({
      title: t('Revoke “{name}”?', { name: d.name }),
      body: t('The device stops seeing the calendar at once and shows “link no longer valid”. To use it again you will have to pair it again.'),
      confirm: t('Revoke'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeDevice(d.id);
      toast(t('Device revoked'));
      load();
      onChanged?.();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <Card
      id="disp-paired"
      title={t('Paired devices')}
      icon="key"
      desc={t('Screens that joined with a pairing code. Each has its own key: revoke it if you lose or give away the device.')}
      actions={
        <Button size="sm" icon="plus" onClick={() => openPairDialog()}>
          {t('Pair a screen')}
        </Button>
      }
    >
      {err && !devices ? (
        <Callout kind="error">{err}</Callout>
      ) : !devices ? (
        <div class="skeleton skeleton--card" />
      ) : devices.length === 0 ? (
        <Empty icon="link" title={t('No paired devices')}>
          {t('Open Marco on a tablet or TV without a private link: it shows a code. Press “Pair a screen” and type it.')}
        </Empty>
      ) : (
        <ul class="dev-list">
          {devices.map((d) => (
            <li class="dev">
              <span class={`dev__state ${d.connected ? 'is-on' : ''}`} title={d.connected ? t('Online') : t('Offline')}>
                <Icon name={d.connected ? 'wifi' : 'wifiOff'} size={15} />
              </span>
              <div class="dev__main">
                <strong>{d.name}</strong>
                <span class="muted small">
                  <Icon name="monitor" size={12} /> {d.screenName || '–'} · {d.connected ? t('Online') : d.lastSeenAt ? t('seen {when}', { when: relTime(d.lastSeenAt) }) : t('not connected yet')}
                </span>
                <span class="muted small dev__meta">
                  {t('Paired {date}', { date: fmtDateTime(d.createdAt) })}
                  {d.lastIp ? ` · ${d.lastIp}` : ''} · <span class="mono">{d.prefix}…</span>
                </span>
              </div>
              <div class="dev__actions">
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(d)}>
                  {t('Edit')}
                </Button>
                <Button size="sm" variant="ghost" icon="trash" class="btn--danger-text" onClick={() => revoke(d)}>
                  {t('Revoke')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EditDeviceDialog
          device={editing}
          screens={saved.screens}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}

function EditDeviceDialog({ device, screens, onClose, onSaved }: { device: PairedDevice; screens: ScreenProfile[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(device.name);
  const [screenId, setScreenId] = useState(device.screenId);
  const [busy, setBusy] = useState(false);
  const dirty = name !== device.name || screenId !== device.screenId;
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.updateDevice(device.id, { name: name.trim(), screenId });
      toast(t('Changes saved'));
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const options = useMemo(() => screens.map((s) => ({ value: s.id, label: s.name })), [screens]);
  return (
    <Modal
      title={t('Edit device')}
      icon="edit"
      size="sm"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={!dirty || !name.trim()} onClick={save}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <Field label={t('Name')}>
          <TextInput value={name} maxLength={60} onValue={setName} />
        </Field>
        <Field label={t('Screen to show')} hint={t('The device switches screen right away.')}>
          <Select value={screenId} options={options} onChange={(v) => setScreenId(v)} />
        </Field>
      </div>
    </Modal>
  );
}
