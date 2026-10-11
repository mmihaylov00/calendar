import { useEffect, useRef, useState } from 'preact/hooks';
import type { AdminPhoto, BackupInfo, ImportNote, ImportPreview } from '../../shared/types';
import { api, ApiError, downloadJson } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Empty, PageHeader, Toggle } from '../components/ui';
import { fmtDateTime } from '../dates';
import { relTime, nScreens, t } from '../i18n';
import { has, isSelfHosted } from '../caps';
import { takeIntent } from '../intent';
import { sectionLabel } from '../activityText';
import { formatBytes } from '../util';
import { uniqueNames, zipParts, ZIP_MAX_BYTES } from '../zip';
import type { SectionProps } from './common';

/** What an import leaves out on this server (ImportPreview.notes, Marco Cloud), in words. */
export function importNoteText(n: ImportNote): string {
  const list = (n.items ?? []).join(', ');
  switch (n.code) {
    case 'secrets':
      return t('The file has secrets (password, tokens, private links, paired devices). They are not imported here: your screens keep their links and devices.');
    case 'homeassistant':
      return t('Home Assistant is not imported: Marco Cloud cannot reach your home network. The weather comes from Open-Meteo.');
    case 'signIn':
      return t('The admin password and Google sign-in are not imported: here you sign in with your Marco account.');
    case 'openDisplayAccess':
      return t('Open display access is not imported: here each screen uses its private link or a paired device.');
    case 'insecureTls':
      return t('Imported with certificate checks on: {list}.', { list });
    case 'google':
      return t('Google calendars of accounts not connected here are not imported: {list}. Connect the account in Calendars and add them again.', { list });
    case 'microsoft':
      return t('Microsoft calendars of accounts not connected here are not imported: {list}. Connect the account in Calendars and add them again.', { list });
    case 'blockedUrl':
      return t('Not imported because their address cannot be reached from the internet (local network or internal name): {list}.', { list });
    case 'refreshMin':
      return t('They will refresh every 30 minutes, the minimum here: {list}.', { list });
    case 'news':
      return t('News feeds are not imported: this server does not offer news.');
    case 'photos':
      return t('Gallery photos are not in the file: upload them in Photos.');
    default:
      return list;
  }
}

/** File name for a downloaded backup (self-hosted ids are file names already). */
function backupFileName(b: BackupInfo): string {
  if (b.id.endsWith('.json')) return b.id;
  const stamp = b.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `config-${stamp}-r${b.revision}-${b.reason}.json`;
}

const REASON: Record<string, string> = { save: 'On save', manual: 'Manual', restore: 'Before restore', import: 'Before import', migration: 'v1 migration' };

export function BackupsSection({ dirty, replaceConfig }: SectionProps) {
  const [secrets, setSecrets] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [listErr, setListErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [bundle, setBundle] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [impSecrets, setImpSecrets] = useState(false);
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);
  const secretsOn = has('includeSecrets');
  const backupsOn = has('backups');
  const transferOn = has('importExport');

  const load = async () => {
    try {
      setList(await api.backups());
      setListErr('');
    } catch (e) {
      setList([]);
      setListErr((e as ApiError).message);
    }
  };
  useEffect(() => {
    if (backupsOn) load();
    if (takeIntent('backups', 'export') && transferOn) setTimeout(() => doExport(), 200);
    if (takeIntent('backups', 'backup') && backupsOn) setTimeout(() => createNow(), 200);
  }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      const withSecrets = secretsOn && secrets;
      const b = await api.exportConfig(withSecrets);
      const day = new Date().toISOString().slice(0, 10);
      downloadJson(b, `marco-${day}${withSecrets ? '-secrets' : ''}.json`);
      toast(t('Backup downloaded'));
    } catch (e) {
      toast(`${t('Could not export')}: ${(e as ApiError).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const createNow = async () => {
    setCreating(true);
    try {
      await api.createBackup();
      toast(t('Backup created'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const readFile = async (f: File) => {
    setPreview(null);
    setBundle(null);
    setFileName(f.name);
    if (f.size > 5 * 1024 * 1024) return toast(t('The file is too large (max. 5 MB)'), 'error');
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast(t('The file is not valid JSON'), 'error');
    }
    setBundle(data);
    setBusy('preview');
    try {
      const p = await api.importPreview(data);
      setPreview(p);
      const over = new Set((p.overLimit ?? []).map((o) => o.section));
      setSections(p.sections.filter((s) => s.changed && !over.has(s.key)).map((s) => s.key));
      setImpSecrets(false);
    } catch (e) {
      toast(`${t('Could not analyse')}: ${(e as ApiError).message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    if (!preview || !bundle) return;
    const all = preview.sections.length === sections.length;
    const ok = await confirmDialog({
      title: t('Import these settings?'),
      body: (
        <>
          <p>{all ? t('All current settings will be replaced.') : t('Will replace: {list}.', { list: sections.map(sectionLabel).join(', ') })}</p>
          <p class="muted small">{t('An automatic backup of the current settings is made first.')}</p>
          {dirty && <p class="err-text">{t('You will lose unsaved changes.')}</p>}
          {secretsOn && impSecrets && <p class="err-text">{t('If the backup has another password, all sessions will be signed out.')}</p>}
        </>
      ),
      confirm: t('Import'),
      danger: true,
    });
    if (!ok) return;
    setBusy('apply');
    try {
      const r = await api.importApply({ bundle, includeSecrets: secretsOn && impSecrets, sections: all ? undefined : sections });
      if (r.loggedOut) {
        toast(t('Imported. The password changed: sign in again.'), 'info');
        setTimeout(() => location.reload(), 1500);
        return;
      }
      replaceConfig(r.config);
      setPreview(null);
      setBundle(null);
      setFileName('');
      toast(t('Settings imported'));
      load();
    } catch (e) {
      toast(`${t('Could not import')}: ${(e as ApiError).message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const restore = async (b: BackupInfo) => {
    const ok = await confirmDialog({
      title: t('Restore the backup from {date}?', { date: fmtDateTime(b.createdAt) }),
      body: (
        <>
          <p>{t('The current settings will be replaced (a backup is made first).')}</p>
          {dirty && <p class="err-text">{t('You will lose unsaved changes.')}</p>}
        </>
      ),
      confirm: t('Restore'),
      danger: true,
    });
    if (!ok) return;
    setBusy(`r-${b.id}`);
    try {
      const r = await api.restoreBackup(b.id);
      replaceConfig(r.config);
      if (r.repaired?.length) toast(t('Backup restored · {n} invalid values were fixed (see Activity)', { n: r.repaired.length }), 'info', 6000);
      else toast(t('Backup restored · screens update automatically'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };
  const remove = async (b: BackupInfo) => {
    if (!(await confirmDialog({ title: t('Delete this backup?'), confirm: t('Delete'), danger: true }))) return;
    try {
      await api.deleteBackup(b.id);
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const download = async (b: BackupInfo) => {
    setBusy(`d-${b.id}`);
    try {
      downloadJson(await api.backupFile(b.id), backupFileName(b));
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };

  // Every gallery photo in one .zip, built here in the browser (the photos are fetched one by one).
  const downloadPhotos = async () => {
    let list: AdminPhoto[];
    try {
      list = await api.photos();
    } catch (e) {
      return toast((e as ApiError).message, 'error');
    }
    if (!list.length) return toast(t('The gallery is empty'), 'info');
    const total = list.reduce((n, p) => n + (p.size || 0), 0);
    if (total > ZIP_MAX_BYTES) return toast(t('The gallery is too large for one .zip'), 'error');
    setZipping({ done: 0, total: list.length });
    const names = uniqueNames(list.map((p) => p.file));
    const entries = [];
    let failed = 0;
    try {
      for (const [i, p] of list.entries()) {
        try {
          const r = await fetch(p.url, { credentials: 'same-origin' });
          if (!r.ok) throw new Error(String(r.status));
          entries.push({ name: names[i], data: new Uint8Array(await r.arrayBuffer()), date: p.uploadedAt ? new Date(p.uploadedAt) : undefined });
        } catch {
          failed++;
        }
        setZipping({ done: i + 1, total: list.length });
      }
      const blob = new Blob(zipParts(entries) as BlobPart[], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `marco-photos-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      if (failed) toast(t('Photos downloaded · {n} could not be read', { n: failed }), 'info', 6000);
      else toast(t('Photos downloaded'));
    } catch (e) {
      toast(`${t('Could not download the photos')}: ${(e as Error).message}`, 'error');
    } finally {
      setZipping(null);
    }
  };

  const diffList = (label: string, d: { added: string[]; removed: string[]; changed: string[] }) =>
    d.added.length + d.removed.length + d.changed.length > 0 && (
      <div class="diff-block">
        <strong class="small">{label}</strong>
        <div class="diff-chips">
          {d.added.map((x) => (
            <span class="diff diff--add">+ {x}</span>
          ))}
          {d.removed.map((x) => (
            <span class="diff diff--del">− {x}</span>
          ))}
          {d.changed.map((x) => (
            <span class="diff diff--chg">~ {x}</span>
          ))}
        </div>
      </div>
    );

  return (
    <>
      <PageHeader title={t('Backups')} desc={t('Export all settings to a file, import them on another install or go back to an earlier version.')} />

      {transferOn && (
        <Card title={t('Export')} icon="download" id="bk-export" desc={t('Screens, calendars, birthdays, filters, scheduled alerts… in one JSON file.')}>
          {secretsOn && (
            <label class="mini-toggle">
              <Toggle checked={secrets} onChange={setSecrets} />
              <span>{t('Include secrets (hashed password, Home Assistant token, Google accounts, API tokens)')}</span>
            </label>
          )}
          {secretsOn && secrets && <Callout kind="warn">{t('With secrets, anyone holding the file could access your Google calendars and Home Assistant. Keep it somewhere safe.')}</Callout>}
          {!secretsOn && !isSelfHosted() && (
            <p class="muted small">
              {t('It also moves you to a Marco installed at home: import it in its admin. It has no private links, paired devices, API tokens or Google accounts, so afterwards pair the screens again and reconnect Google Calendar.')}{' '}
              {t('It has the addresses of your calendars: keep it somewhere safe.')}
            </p>
          )}
          <div>
            <Button variant="primary" icon="download" loading={exporting} onClick={doExport}>
              {t('Download backup')}
            </Button>
          </div>
        </Card>
      )}

      {transferOn && (
        <Card title={t('Import')} icon="upload" id="bk-import">
          <div
            class={`dropzone dropzone--sm ${drag ? 'is-drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) readFile(f);
            }}
          >
            <span class="dropzone__icon">{busy === 'preview' ? <span class="spinner" /> : <Icon name="upload" size={20} />}</span>
            <div>
              <strong>{fileName || t('Choose or drop a .json file')}</strong>
              <div class="muted small">{t('Backups exported from here or a config.json (old format too).')}</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) readFile(f);
                e.currentTarget.value = '';
              }}
            />
          </div>
          {preview && (
            <div class="import-prev">
              <div class="import-prev__head">
                {preview.ok ? (
                  <span class="ok-text">
                    <Icon name="check" size={15} /> {t('Valid file')}
                  </span>
                ) : (
                  <span class="err-text">
                    <Icon name="alert" size={15} /> {t('{n} validation errors', { n: preview.errors.length })}
                  </span>
                )}
                <span class="muted small">
                  {preview.fromVersion === 1 ? t('old format (v1), will be migrated') : 'v2'}
                  {preview.appVersion && ` · app ${preview.appVersion}`}
                  {preview.exportedAt && ` · ${t('exported {when}', { when: fmtDateTime(preview.exportedAt) })}`}
                </span>
              </div>
              {!preview.ok && (
                <ul class="import-prev__errs">
                  {preview.errors.slice(0, 8).map((e) => (
                    <li>
                      <code>{e.path}</code> {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {preview.ok && (
                <>
                  <div class="import-sections">
                    {preview.sections.map((s) => {
                      const on = sections.includes(s.key);
                      const over = (preview.overLimit ?? []).find((o) => o.section === s.key);
                      return (
                        <label class={`import-sec ${s.changed ? '' : 'is-same'} ${on ? 'is-on' : ''} ${over ? 'is-same' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!!over}
                            onChange={() => setSections(on ? sections.filter((x) => x !== s.key) : [...sections, s.key])}
                          />
                          <span class="check-box">
                            <Icon name="check" size={12} />
                          </span>
                          <span class="import-sec__name">{sectionLabel(s.key)}</span>
                          <span class={`import-sec__sum small ${over ? 'err-text' : 'muted'}`}>
                            {over ? t('Over your plan limit ({max}): cannot be imported', { max: over.max }) : s.summary}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {diffList(t('Screens'), preview.screens)}
                  {diffList(t('Calendars'), preview.sources)}
                  <div class="muted small">
                    {t('Contains')}: {t('{n} local events', { n: preview.counts.localEvents })} · {t('{n} birthdays', { n: preview.counts.birthdays })} · {t('{n} rules', { n: preview.counts.eventRules })} · {t('{n} countdowns', { n: preview.counts.countdowns })} · {t('{n} scheduled messages', { n: preview.counts.schedules })}
                  </div>
                  {preview.notes && preview.notes.length > 0 && (
                    <Callout kind="info">
                      <strong>{t('What is not imported here')}</strong>
                      <ul class="import-prev__notes">
                        {preview.notes.map((n) => (
                          <li>{importNoteText(n)}</li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                  {(() => {
                    const o = preview.orphanSchedules;
                    const list = sections.includes('screens') && !sections.includes('schedules') ? o?.screensOnly
                      : sections.includes('schedules') && !sections.includes('screens') ? o?.schedulesOnly : null;
                    return list?.length ? (
                      <p class="err-text small">
                        {t('These scheduled messages will be left without screens and disabled: {list}. Import “Screens” and “Scheduled messages” together to keep them.', { list: list.join(', ') })}
                      </p>
                    ) : null;
                  })()}
                  {secretsOn && preview.hasSecrets && (
                    <label class="mini-toggle">
                      <Toggle checked={impSecrets} onChange={setImpSecrets} />
                      <span>{t('Also import the secrets in the backup')}</span>
                    </label>
                  )}
                  {secretsOn && preview.hasSecrets && impSecrets && preview.secretsImpact && (preview.secretsImpact.linksChanged.length > 0 || preview.secretsImpact.devicesRemoved.length > 0) && (
                    <Callout kind="warn">
                      {preview.secretsImpact.linksChanged.length > 0 && (
                        <p>{t('The private link of {list} will change. Screens open with the current link are disconnected; the one in the file works again.', { list: preview.secretsImpact.linksChanged.join(', ') })}</p>
                      )}
                      {preview.secretsImpact.devicesRemoved.length > 0 && (
                        <p>{t('These paired devices will be removed (disconnected at once): {list}.', { list: preview.secretsImpact.devicesRemoved.join(', ') })}</p>
                      )}
                    </Callout>
                  )}
                  {preview.displayAccess && (
                    <p class="muted small">
                      {t('Display access ({mode}) does not change when importing or restoring: change it in Security.', {
                        mode: preview.displayAccess === 'open' ? t('Open (local network)') : t('Private'),
                      })}
                    </p>
                  )}
                  <div class="btn-row">
                    <Button variant="ghost" onClick={() => (setPreview(null), setBundle(null), setFileName(''))}>
                      {t('Cancel')}
                    </Button>
                    <Button variant="primary" icon="upload" loading={busy === 'apply'} disabled={!sections.length} onClick={apply}>
                      {t('Import {n} sections', { n: sections.length })}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {transferOn && has('gallery') && (
        <Card title={t('Photos')} icon="photos" id="bk-photos" desc={t('Gallery photos are not in the config file. Download them all in a .zip to keep them or upload them to another installation.')}>
          <div>
            <Button icon="download" loading={!!zipping} onClick={downloadPhotos}>
              {zipping ? t('Downloading {done} of {total}…', zipping) : t('Download photos (.zip)')}
            </Button>
          </div>
        </Card>
      )}

      {backupsOn && (
        <Card
          title={t('Automatic backups')}
          icon="archive"
          id="bk-auto"
          desc={t('A backup is made every time you save (the last 20 are kept).')}
          actions={
            <Button size="sm" icon="plus" loading={creating} onClick={createNow}>
              {t('Back up now')}
            </Button>
          }
        >
          {listErr && <Callout kind="error">{listErr}</Callout>}
          {list === null ? (
            <div class="skeleton-list">
              <div class="skeleton" />
              <div class="skeleton" />
            </div>
          ) : list.length === 0 ? (
            <Empty icon="archive" title={t('No backups yet')}>
              {t('They will appear here when you save changes.')}
            </Empty>
          ) : (
            <ul class="bk-list">
              {list.map((b, i) => (
                <li class="bk">
                  <span class={`bk__icon bk__icon--${b.reason}`}>
                    <Icon name={b.reason === 'manual' ? 'star' : b.reason === 'save' ? 'check' : b.reason === 'migration' ? 'wand' : 'history'} size={14} />
                  </span>
                  <div class="bk__main">
                    <strong>
                      {fmtDateTime(b.createdAt)} <span class="muted small">· {relTime(b.createdAt)}</span>
                      {i === 0 && <span class="badge badge--soft">{t('latest')}</span>}
                    </strong>
                    <span class="muted small">
                      {t(REASON[b.reason] ?? b.reason)} · {t('revision {n}', { n: b.revision })} · {nScreens(b.screens)} · {t('{n} calendars', { n: b.sources })} · {formatBytes(b.size)}
                    </span>
                  </div>
                  <div class="bk__actions">
                    <button type="button" class="icon-btn" title={t('Download')} disabled={busy === `d-${b.id}`} onClick={() => download(b)}>
                      <Icon name="download" size={15} />
                    </button>
                    <Button size="sm" variant="ghost" icon="history" loading={busy === `r-${b.id}`} onClick={() => restore(b)}>
                      {t('Restore')}
                    </Button>
                    {b.reason !== 'migration' && (
                      <button type="button" class="icon-btn icon-btn--danger" title={t('Delete')} onClick={() => remove(b)}>
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
