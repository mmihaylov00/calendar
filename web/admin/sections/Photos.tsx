import { appUrl } from '../../shared/path';
import { useEffect, useRef, useState } from 'preact/hooks';
import { coverPosition, freeBand, hasFocus, type PhotoFrame } from '../../shared/focus';
import type { AdminPhoto, AppConfig, DisplayInfo, PhotoConflictPolicy } from '../../shared/types';
import { api, ApiError, uploadPhotos, uploadThumb } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { ConflictDialog, FocusEditor, type ConflictItem } from '../components/PhotoDialogs';
import { Button, Callout, Card, Empty, PageHeader, Segmented } from '../components/ui';
import { limit, runtime } from '../caps';
import { locale, t } from '../i18n';
import { isJpegName, jpgName, looksLikeImage, MAX_UPLOAD_BYTES, optimizePhoto, PhotoError, TARGET_SIDE } from '../photoTools';
import { formatBytes } from '../util';
import type { SectionProps } from './common';

const SERVER_TYPES = /\.(jpe?g|png|webp)$/i;
/** Heavier than this (even at ≤ 2560 px) → offered for optimization. */
const HEAVY = 1.6 * 1024 * 1024;

type Status = 'waiting' | 'heic' | 'optimizing' | 'uploading' | 'done' | 'skipped' | 'error';
interface QueueItem {
  id: number;
  name: string;
  status: Status;
  pct: number;
  before?: number;
  after?: number;
  note?: string;
  error?: string;
  thumb?: string;
}
interface Queue {
  kind: 'upload' | 'existing';
  items: QueueItem[];
  running: boolean;
}

/** What an existing gallery photo still needs: thumbnail, focal point, or a lighter / upright JPEG. */
export function needsWork(p: AdminPhoto): boolean {
  const processed = p.hasThumb && hasFocus(p) && isJpegName(p.file) && !!p.w && Math.max(p.w, p.h || 0) <= TARGET_SIDE;
  // A processed photo that re-encoding couldn't make lighter (detailed 2560 px JPEGs) is done; don't offer it again.
  return !processed || (p.size > HEAVY && !(p.hasThumb && hasFocus(p)));
}

/** Servers that run on Workers (Marco Cloud) store photos with a plan: one photo per request, always optimized. */
const onWorkers = () => runtime() === 'workers';

function errorText(e: unknown): string {
  if (e instanceof PhotoError) {
    if (e.code === 'too-big') return t('Exceeds the 100 MB limit');
    if (e.code === 'not-image') return t('Not an image');
    if (e.code === 'heic') return t('Could not convert the HEIC photo. Export it as JPG and try again.');
    return t('The browser cannot read this image. Save it as JPG and try again.');
  }
  if (e instanceof ApiError) {
    if (e.code === 'photo_quota') {
      const b = (e.body ?? {}) as { reason?: string; limit?: number; maxPhotos?: number };
      if (b.reason === 'count') return t('You have reached the maximum of {n} photos. Delete some to upload more.', { n: b.maxPhotos ?? limit('photos') ?? '' });
      return t('The gallery is full ({max}). Delete a photo to upload more.', { max: formatBytes(b.limit ?? limit('totalPhotoBytes') ?? 0) });
    }
    if (e.status === 413) {
      const each = limit('photoBytes');
      return each != null ? t('It takes more than {size} even after optimizing.', { size: formatBytes(each) }) : t('Exceeds the 100 MB limit');
    }
    if (e.status === 429 && onWorkers()) return t('Too many uploads in a row. Wait a minute and try again.');
    if (e.status === 415) return t('Unsupported format (use JPG, PNG or WebP)');
    if (e.status === 0) return t('No connection to the server');
    return e.message;
  }
  return (e as Error)?.message || String(e);
}

let seq = 0;

/**
 * Photo panel framing for the editor preview: what a display of this screen measured (aspect + the bands the
 * clock and the weather card cover), else an estimate from the layout.
 */
function pickFrame(cfg: AppConfig, displays: DisplayInfo[]): { frame: PhotoFrame; note: string } {
  const withFrame = displays
    .filter((d) => d.photoFrame)
    .sort((a, b) => Number(b.screenId === cfg.screenId) - Number(a.screenId === cfg.screenId) || Number(b.connected) - Number(a.connected) || b.lastSeen.localeCompare(a.lastSeen));
  const d = withFrame[0];
  if (d?.photoFrame) {
    const res = d.viewport ? ` · ${d.viewport.w}×${d.viewport.h}` : '';
    return { frame: d.photoFrame, note: t('measured on “{name}”', { name: d.screenName || d.screenSlug || d.clientId }) + res };
  }
  const preset = cfg.layout?.preset;
  const side = preset === 'bigCalendar' || preset === 'agenda' || preset === 'leftRight';
  const aspect = side ? ((cfg.layout?.sideWidth || 0.36) * 16) / 9 : 16 / 9;
  const blocks: [number, number][] = side ? [[0.03, 0.25]] : [[0.04, 0.2]];
  if (cfg.weather?.enabled !== false) blocks.push(side ? [0.45, 0.97] : [0.72, 0.95]);
  const band = freeBand(blocks);
  return { frame: { aspect, targetY: band.target, freeTop: band.top, freeBottom: band.bottom, blocks }, note: t('approximate: open the screen to measure it') };
}

export function PhotosSection({ cfg, set }: SectionProps) {
  const [photos, setPhotos] = useState<AdminPhoto[] | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [conflicts, setConflicts] = useState<{ items: ConflictItem[]; resolve: (c: Record<string, PhotoConflictPolicy> | null) => void } | null>(null);
  const [editing, setEditing] = useState<AdminPhoto | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [filter, setFilter] = useState<'all' | 'shown' | 'hidden'>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const busy = !!queue?.running;
  const cloud = onWorkers();
  const maxTotal = limit('totalPhotoBytes');
  const maxCount = limit('photos');
  const maxEach = limit('photoBytes');

  const load = async () => {
    try {
      const list = await api.photos();
      list.sort((a, b) => +new Date(b.mtime) - +new Date(a.mtime));
      setPhotos(list);
      setErr('');
      return list;
    } catch (e) {
      setErr((e as ApiError).message);
      setPhotos([]);
      return [];
    }
  };
  useEffect(() => {
    load();
    api.displays().then((r) => setDisplays(r.displays), () => {});
    return () => urls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const clearQueue = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setQueue(null);
  };
  const patch = (id: number, p: Partial<QueueItem>) =>
    setQueue((q) => q && { ...q, items: q.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const thumbUrl = (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.push(u);
    return u;
  };

  /* ---------------------------------------------------------------- upload new files */

  // Synchronous guard: a second selection while names are being checked must not start a parallel batch.
  const lock = useRef(false);
  const withLock = (fn: () => Promise<void>) => async () => {
    if (lock.current) return;
    lock.current = true;
    try {
      await fn();
    } finally {
      lock.current = false;
    }
  };

  const handleFiles = (list: FileList | File[]) => withLock(() => uploadFiles(Array.from(list)))();
  const uploadFiles = async (list: File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    // A plan with a storage limit: say so before optimizing anything when the gallery is already full.
    const usedNow = (photos ?? []).reduce((s, p) => s + (p.size || 0), 0);
    if (maxTotal != null && usedNow >= maxTotal) {
      toast(t('The gallery is full ({max}). Delete a photo to upload more.', { max: formatBytes(maxTotal) }), 'error', 9000);
      return;
    }
    if (maxCount != null && (photos?.length ?? 0) >= maxCount) {
      toast(t('You have reached the maximum of {n} photos. Delete some to upload more.', { n: maxCount }), 'error', 9000);
      return;
    }
    clearQueue();
    const items: (QueueItem & { file: File; target: string })[] = files.map((f) => ({
      id: ++seq, name: f.name, file: f, target: jpgName(f.name), status: 'waiting', pct: 0, before: f.size,
    }));
    // Rejected up front: say which and why.
    const rejected: string[] = [];
    for (const it of items) {
      if (it.file.size > MAX_UPLOAD_BYTES) Object.assign(it, { status: 'error', error: t('Exceeds the 100 MB limit') });
      else if (!looksLikeImage(it.file)) Object.assign(it, { status: 'error', error: t('Not an image') });
      if (it.status === 'error') rejected.push(`${it.name} (${it.error})`);
    }
    if (rejected.length) {
      toast(
        t('{n} files rejected: {list}', { n: rejected.length, list: rejected.slice(0, 3).join(', ') + (rejected.length > 3 ? '…' : '') }),
        'error',
        9000
      );
    }
    const ok = items.filter((i) => i.status !== 'error');
    if (!ok.length) {
      setQueue({ kind: 'upload', items, running: false });
      return;
    }

    // Duplicate names: ask before uploading (the server's own sanitization decides what "same name" means).
    const policies: Record<number, PhotoConflictPolicy> = {};
    try {
      const { results } = await api.checkPhotoNames(ok.map((i) => i.target));
      results.forEach((r, k) => (ok[k].target = r.sanitized));
      const clash = results.map((r, k) => ({ r, it: ok[k] })).filter((x) => x.r.exists);
      if (clash.length) {
        const byName = new Map((photos ?? []).map((p) => [p.file, p]));
        const choice = await new Promise<Record<string, PhotoConflictPolicy> | null>((resolve) =>
          setConflicts({
            items: clash.map(({ r, it }) => ({
              key: String(it.id), original: it.name, size: it.file.size, target: r.sanitized, renamed: r.renamed, existing: byName.get(r.sanitized),
            })),
            resolve,
          })
        );
        setConflicts(null);
        if (!choice) return;
        for (const [k, v] of Object.entries(choice)) policies[Number(k)] = v;
      }
    } catch (e) {
      toast(`${t('Could not check whether the photos already exist')}: ${errorText(e)}`, 'error');
      return;
    }

    setQueue({ kind: 'upload', items, running: true });
    let uploaded = 0, failed = 0, before = 0, after = 0, noRoom = 0;
    // Room left in the plan (the server checks it again, atomically).
    let room = maxTotal != null ? maxTotal - usedNow : Infinity;
    for (const it of ok) {
      const policy = policies[it.id] ?? 'rename';
      if (policy === 'skip') {
        patch(it.id, { status: 'skipped', note: t('Skipped: already exists') });
        continue;
      }
      try {
        let up: { blob: Blob; name: string; thumb?: Blob; focusX?: number; focusY?: number };
        let note = '';
        try {
          const o = await optimizePhoto(it.file, { strip: cloud, onStage: (s) => patch(it.id, { status: s, pct: s === 'heic' ? 0.1 : 0.2 }) });
          up = o;
          patch(it.id, { thumb: thumbUrl(o.thumb), after: o.after });
        } catch (e) {
          // A JPG/PNG/WebP this browser can't decode still goes up as it is (the server accepts it).
          // On Workers every photo is optimized (metadata such as the location must not be stored).
          if (!cloud && e instanceof PhotoError && e.code === 'decode' && SERVER_TYPES.test(it.file.name) && /^image\/(jpeg|png|webp)$/.test(it.file.type)) {
            up = { blob: it.file, name: it.file.name };
            note = t('uploaded without optimizing');
          } else throw e;
        }
        if (maxEach != null && up.blob.size > maxEach) {
          failed++;
          patch(it.id, { status: 'error', error: t('It takes more than {size} even after optimizing.', { size: formatBytes(maxEach) }) });
          continue;
        }
        if (policy !== 'replace' && up.blob.size > room) {
          noRoom++;
          patch(it.id, { status: 'error', error: t('It does not fit: {free} left in the gallery.', { free: formatBytes(Math.max(0, room)) }) });
          continue;
        }
        patch(it.id, { status: 'uploading', pct: 0.4 });
        const res = await uploadPhotos([up], up.name === jpgName(it.file.name) ? policy : 'rename', (fr) => patch(it.id, { pct: 0.4 + fr * 0.6 }));
        const f = res.files[0];
        if (!f) {
          patch(it.id, { status: 'skipped', note: t('Skipped: already exists') });
          continue;
        }
        uploaded++;
        if (f.status !== 'replaced') room -= f.size;
        before += it.file.size;
        after += up.blob.size;
        const extra = f.status === 'replaced' ? t('replaced') : f.status === 'renamed' ? t('saved as {name}', { name: f.file }) : '';
        patch(it.id, { status: 'done', pct: 1, after: up.blob.size, note: [note, extra].filter(Boolean).join(' · ') });
      } catch (e) {
        failed++;
        patch(it.id, { status: 'error', error: errorText(e) });
      }
    }
    setQueue((q) => q && { ...q, running: false });
    if (uploaded) toast(t('{n} photos uploaded · {before} → {after}', { n: uploaded, before: formatBytes(before), after: formatBytes(after) }));
    if (failed) toast(t('{n} files could not be uploaded', { n: failed }), 'error');
    if (noRoom) toast(t('{n} photos do not fit in the gallery', { n: noRoom }), 'error', 9000);
    load();
  };

  /* ---------------------------------------------------------------- optimize what's already there */

  // The progress card sits at the top of the page; bring it into view when a batch starts (the buttons that
  // start one are further down, next to the photos).
  const queueRef = useRef<HTMLDivElement>(null);
  const queueKey = queue ? `${queue.kind}:${queue.items[0]?.id ?? 0}` : '';
  useEffect(() => {
    if (queueKey) requestAnimationFrame(() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [queueKey]);

  const optimizeExisting = withLock(async () => {
    const todo = (photos ?? []).filter(needsWork);
    if (!todo.length) return;
    const ok = await confirmDialog({
      title: t('Optimize and frame existing photos'),
      body: t(
        '{n} photos will be processed in this browser, one at a time: scaled down to 2560 px at most, given a thumbnail and a focal point (framing you already chose is kept). It may take a couple of minutes; keep this page open.',
        { n: todo.length }
      ),
      confirm: t('Optimize {n} photos', { n: todo.length }),
    });
    if (!ok) return;
    clearQueue();
    const items: QueueItem[] = todo.map((p) => ({ id: ++seq, name: p.file, status: 'waiting', pct: 0, before: p.size }));
    setQueue({ kind: 'existing', items, running: true });
    let done = 0, failed = 0, before = 0, after = 0;
    for (let k = 0; k < todo.length; k++) {
      const p = todo[k];
      const id = items[k].id;
      try {
        patch(id, { status: 'optimizing', pct: 0.05 });
        const res = await fetch(appUrl(p.url), { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], p.file, { type: blob.type || 'image/jpeg' });
        const keepFocus = hasFocus(p) ? { focusX: p.focusX!, focusY: p.focusY! } : undefined;
        const o = await optimizePhoto(file, { keepFocus, strip: cloud, onStage: (s) => patch(id, { status: s, pct: 0.2 }) });
        patch(id, { thumb: thumbUrl(o.thumb), status: 'uploading', pct: 0.5 });
        let note = '';
        if (o.kept && jpgName(p.file) === p.file) {
          // Already a light JPEG: only the thumbnail and the focal point are missing.
          await uploadThumb(p.file, o.thumb);
          if (!hasFocus(p)) await api.setPhotoFocus(p.file, o.focusX, o.focusY);
          note = t('already optimized · thumbnail and framing ready');
        } else if (jpgName(p.file) === p.file) {
          await uploadPhotos([o], 'replace', (fr) => patch(id, { pct: 0.5 + fr * 0.5 }));
        } else {
          // PNG / WebP → new .jpg next to it, then the old file goes.
          const r = await uploadPhotos([o], 'rename', (fr) => patch(id, { pct: 0.5 + fr * 0.45 }));
          if (r.files[0] && p.hidden) await api.setPhotoHidden(r.files[0].file, true);
          if (r.files[0]) await api.deletePhoto(p.file);
          note = t('converted to {name}', { name: r.files[0]?.file ?? o.name });
        }
        done++;
        before += p.size;
        after += o.kept ? p.size : o.after;
        patch(id, { status: 'done', pct: 1, after: o.kept ? p.size : o.after, note });
      } catch (e) {
        failed++;
        patch(id, { status: 'error', error: errorText(e) });
      }
    }
    setQueue((q) => q && { ...q, running: false });
    if (done) toast(t('{n} photos optimized · {before} → {after}', { n: done, before: formatBytes(before), after: formatBytes(after) }));
    if (failed) toast(t('{n} photos could not be optimized', { n: failed }), 'error');
    load();
  });

  const remove = async (p: AdminPhoto) => {
    const ok = await confirmDialog({ title: t('Delete photo'), body: p.file, confirm: t('Delete'), danger: true });
    if (!ok) return;
    try {
      await api.deletePhoto(p.file);
      setPhotos((l) => l?.filter((x) => x.file !== p.file) ?? null);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  /* ---------------------------------------------------------------- rotation (shown / hidden) */

  const markHidden = (files: string[], hidden: boolean) => {
    const set = new Set(files);
    setPhotos((l) => l?.map((x) => (set.has(x.file) ? { ...x, hidden } : x)) ?? null);
  };
  const toggleHidden = async (p: AdminPhoto) => {
    const hidden = !p.hidden;
    markHidden([p.file], hidden); // optimistic
    try {
      await api.setPhotoHidden(p.file, hidden);
      toast(hidden ? t('Hidden: it won\'t be shown on screen') : t('In rotation: it will be shown on screen again'));
    } catch (e) {
      markHidden([p.file], !hidden);
      toast((e as ApiError).message, 'error');
    }
  };
  const bulkHidden = async (hidden: boolean) => {
    const files = [...selected].filter((f) => photos?.some((p) => p.file === f && !!p.hidden !== hidden));
    if (!files.length) {
      toast(hidden ? t('The selected photos are already hidden') : t('The selected photos are already in rotation'));
      return;
    }
    setBulkBusy(true);
    try {
      const r = await api.setPhotosHidden(files, hidden);
      markHidden(r.updated, hidden);
      toast(hidden ? t('{n} photos hidden', { n: r.updated.length }) : t('{n} photos back in rotation', { n: r.updated.length }));
      setSelected(new Set());
      setSelecting(false);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };
  const toggleSelect = (file: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(file)) n.delete(file);
      else n.add(file);
      return n;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const total = photos?.reduce((s, p) => s + (p.size || 0), 0) ?? 0;
  const hiddenCount = (photos ?? []).filter((p) => p.hidden).length;
  const shownCount = (photos?.length ?? 0) - hiddenCount;
  const visible = (photos ?? []).filter((p) => (filter === 'all' ? true : filter === 'hidden' ? !!p.hidden : !p.hidden));
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.file));
  const pending = (photos ?? []).filter(needsWork).length;
  const tileAspect = 16 / 10;

  return (
    <>
      <PageHeader
        title={t('Gallery')}
        desc={cloud ? t('Your photos for the screen background. They are stored in your Calendar account.') : t('Your photos for the screen background. Stored on the server itself.')}
      />
      {cfg.background.source === 'stock' && (
        <Callout>
          {t('The background currently uses stock photos.')}{' '}
          <button type="button" class="link-btn" onClick={() => set((d) => void (d.background.source = 'gallery'))}>
            {t('Use my gallery')}
          </button>{' '}
          ·{' '}
          <button type="button" class="link-btn" onClick={() => set((d) => void (d.background.source = 'mixed'))}>
            {t('Mix both')}
          </button>
        </Callout>
      )}
      <div
        class={`dropzone ${drag ? 'is-drag' : ''} ${busy ? 'is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer?.files?.length && !busy) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && (e.preventDefault(), input.current?.click())}
        role="button"
        tabIndex={0}
        aria-disabled={busy}
      >
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files;
            if (f?.length) handleFiles(f);
            e.currentTarget.value = '';
          }}
        />
        <span class="dropzone__icon">{busy ? <span class="spinner" /> : <Icon name="upload" size={26} />}</span>
        <strong>{busy ? t('Processing photos…') : t('Drag photos here or click to choose')}</strong>
        <span class="muted small">
          {cloud
            ? t('JPG, HEIC, PNG, WebP… · your browser shrinks and converts them and removes location data before uploading')
            : t('JPG, HEIC, PNG, WebP… · up to 100 MB each · optimized in your browser before uploading')}
        </span>
      </div>
      {maxTotal != null && photos !== null && <QuotaBar used={total} max={maxTotal} count={photos.length} maxCount={maxCount} />}

      {queue && <div ref={queueRef}><UploadQueue queue={queue} onClose={clearQueue} /></div>}

      <Card
        title={t('Photos')}
        icon="photos"
        desc={photos ? t('{n} photos · {size}', { n: photos.length, size: formatBytes(total) }) : undefined}
        actions={
          <Button size="sm" variant="ghost" icon="refresh" onClick={load}>
            {t('Reload')}
          </Button>
        }
      >
        {photos && photos.length > 0 && shownCount === 0 && (
          <Callout kind="warn">
            <strong>{t('All photos are hidden.')}</strong>{' '}
            {cfg.background.source === 'stock'
              ? t('No gallery photo is in rotation.')
              : t('The screen will use stock photos until you show some again.')}
          </Callout>
        )}
        {pending > 0 && !busy && (
          <div class="photo-todo">
            <span class="photo-todo__icon">
              <Icon name="wand" size={18} />
            </span>
            <div class="photo-todo__text">
              <strong>{t('{n} photos not yet optimized or framed', { n: pending })}</strong>
              <span class="muted small">{t('Shrinking and framing them makes the gallery load fast and keeps faces on screen.')}</span>
            </div>
            <Button size="sm" variant="primary" icon="wand" onClick={optimizeExisting}>
              {t('Optimize and frame existing photos')}
            </Button>
          </div>
        )}
        {photos === null ? (
          <div class="photo-grid">
            {Array.from({ length: 8 }, () => (
              <div class="photo skeleton" />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <Empty icon="photos" title={err ? t('Could not load the gallery') : t('The gallery is empty')}>
            {err || t('Random stock photos are used in the meantime.')}
          </Empty>
        ) : (
          <>
            <div class="photo-bar">
              <div class="photo-bar__count" aria-live="polite">
                <span class={`photo-bar__dot ${shownCount === 0 ? 'is-off' : ''}`} />
                <span>
                  <strong>{t('{shown} of {total} in rotation', { shown: shownCount, total: photos.length })}</strong>
                  {hiddenCount > 0 && <span class="muted"> · {t('{n} hidden', { n: hiddenCount })}</span>}
                </span>
              </div>
              <div class="photo-bar__tools">
                <Segmented
                  size="sm"
                  value={filter}
                  options={[
                    { value: 'all', label: `${t('All')} ${photos.length}` },
                    { value: 'shown', label: `${t('In rotation')} ${shownCount}` },
                    { value: 'hidden', label: `${t('Hidden')} ${hiddenCount}` },
                  ]}
                  onChange={(v) => setFilter(v)}
                />
                {!selecting && (
                  <Button size="sm" icon="checklist" onClick={() => setSelecting(true)}>
                    {t('Select')}
                  </Button>
                )}
              </div>
            </div>
            {selecting && (
              <div class="photo-select" role="toolbar" aria-label={t('Selection')}>
                <span class="photo-select__n">{t('{n} selected', { n: selected.size })}</span>
                <span class="photo-select__links">
                  <button type="button" class="link-btn" disabled={allVisibleSelected} onClick={() => setSelected(new Set([...selected, ...visible.map((p) => p.file)]))}>
                    {t('Select all')}
                  </button>
                  <span class="muted">/</span>
                  <button type="button" class="link-btn" disabled={!selected.size} onClick={() => setSelected(new Set())}>
                    {t('none')}
                  </button>
                </span>
                <span class="photo-select__spacer" />
                <Button size="sm" variant="primary" icon="eye" disabled={!selected.size} loading={bulkBusy} onClick={() => bulkHidden(false)}>
                  {t('Show on screen')}
                </Button>
                <Button size="sm" icon="eyeOff" disabled={!selected.size || bulkBusy} onClick={() => bulkHidden(true)}>
                  {t('Don’t show')}
                </Button>
                <Button size="sm" variant="ghost" icon="x" onClick={stopSelecting}>
                  {t('Done')}
                </Button>
              </div>
            )}
            {visible.length === 0 ? (
              <p class="photo-none muted">{filter === 'hidden' ? t('No hidden photos.') : t('No photos in rotation.')}</p>
            ) : (
              <div class={`photo-grid ${selecting ? 'is-selecting' : ''}`}>
                {visible.map((p) => {
                  const w = p.w || 1600, h = p.h || 1000;
                  const s = Math.min(1, 480 / Math.max(w, h));
                  const sel = selected.has(p.file);
                  return (
                    <figure class={`photo ${p.hidden ? 'is-hidden' : ''} ${sel ? 'is-selected' : ''}`} key={p.file}>
                      <button
                        type="button"
                        class="photo__open"
                        onClick={() => (selecting ? toggleSelect(p.file) : setEditing(p))}
                        title={selecting ? p.file : t('Frame')}
                        aria-label={selecting ? p.file : `${t('Frame')}: ${p.file}`}
                        aria-pressed={selecting ? sel : undefined}
                      >
                        <img
                          src={appUrl(p.thumbUrl || p.url)}
                          alt={p.file}
                          width={Math.round(w * s)}
                          height={Math.round(h * s)}
                          loading="lazy"
                          decoding="async"
                          style={{ objectPosition: coverPosition(w, h, tileAspect, 1, p.focusX, p.focusY) }}
                        />
                      </button>
                      {selecting ? (
                        <span class={`photo__check ${sel ? 'is-on' : ''}`} aria-hidden="true">
                          {sel && <Icon name="check" size={14} />}
                        </span>
                      ) : (
                        hasFocus(p) && !p.hidden && (
                          <span class="photo__badge" title={t('Framing saved')}>
                            <Icon name="target" size={12} />
                          </span>
                        )
                      )}
                      {p.hidden && (
                        <span class="photo__hidden-tag">
                          <Icon name="eyeOff" size={12} />
                          {t('Hidden')}
                        </span>
                      )}
                      <figcaption>
                        <span class="photo__name" title={p.file}>
                          {p.file}
                        </span>
                        <span>
                          {p.w && p.h ? `${p.w}×${p.h} · ` : ''}
                          {formatBytes(p.size)} · {new Date(p.mtime).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}
                        </span>
                      </figcaption>
                      {!selecting && (
                        <div class="photo__actions">
                          <button
                            type="button"
                            class={`photo__act photo__eye ${p.hidden ? 'is-off' : ''}`}
                            aria-pressed={!p.hidden}
                            aria-label={`${p.hidden ? t('Show on screen') : t('Don’t show')}: ${p.file}`}
                            title={p.hidden ? t('Hidden · click to show it on screen') : t('In rotation · click to hide it')}
                            onClick={() => toggleHidden(p)}
                          >
                            <Icon name={p.hidden ? 'eyeOff' : 'eye'} size={15} />
                          </button>
                          <button type="button" class="photo__act photo__del" aria-label={t('Delete')} title={t('Delete')} onClick={() => remove(p)}>
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      )}
                    </figure>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
      {conflicts && <ConflictDialog items={conflicts.items} onDone={conflicts.resolve} />}
      {editing && (
        <FocusEditor
          photo={editing}
          {...(() => {
            const f = pickFrame(cfg, displays);
            return { frame: f.frame, panelNote: f.note };
          })()}
          panelLabel={t('Photo panel of the screen')}
          onClose={() => setEditing(null)}
          onSaved={(np) => {
            setEditing(null);
            setPhotos((l) => l?.map((x) => (x.file === np.file ? np : x)) ?? null);
          }}
        />
      )}
    </>
  );
}

/** Storage used against the plan: "X MB de 200 MB · N fotos". */
function QuotaBar({ used, max, count, maxCount }: { used: number; max: number; count: number; maxCount: number | null }) {
  const frac = max > 0 ? Math.min(1, used / max) : 1;
  const full = used >= max || (maxCount != null && count >= maxCount);
  const low = !full && frac >= 0.9;
  return (
    <div class={`photo-quota ${full ? 'is-full' : low ? 'is-low' : ''}`}>
      <div class="photo-quota__head">
        <strong>{t('Gallery storage')}</strong>
        <span class="muted small">
          {t('{used} of {max} · {n} photos', { used: formatBytes(used), max: formatBytes(max), n: count })}
          {!full && ` · ${t('{free} free', { free: formatBytes(max - used) })}`}
        </span>
      </div>
      <div class="progress photo-quota__bar" role="progressbar" aria-label={t('Gallery storage')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <span style={{ transform: `scaleX(${frac})` }} />
      </div>
      {full ? (
        <p class="photo-quota__note small">
          {maxCount != null && count >= maxCount
            ? t('You have reached the maximum of {n} photos. Delete some to upload more.', { n: maxCount })
            : t('The gallery is full ({max}). Delete a photo to upload more.', { max: formatBytes(max) })}
        </p>
      ) : (
        low && <p class="photo-quota__note small">{t('Space is running low. Delete photos you no longer use to upload more.')}</p>
      )}
    </div>
  );
}

function statusText(i: QueueItem): string {
  switch (i.status) {
    case 'waiting':
      return t('Queued');
    case 'heic':
      return t('Converting HEIC…');
    case 'optimizing':
      return t('Optimizing…');
    case 'uploading':
      return t('Uploading… {pct}%', { pct: Math.round(((i.pct - 0.4) / 0.6) * 100) });
    case 'skipped':
      return i.note || t('Skipped');
    case 'error':
      return i.error || t('Error');
    case 'done': {
      const sizes = i.before && i.after ? `${formatBytes(i.before)} → ${formatBytes(i.after)}` : t('Done');
      return i.note ? `${sizes} · ${i.note}` : sizes;
    }
  }
}

function UploadQueue({ queue, onClose }: { queue: Queue; onClose: () => void }) {
  const n = queue.items.length;
  const finished = queue.items.filter((i) => i.status === 'done' || i.status === 'skipped' || i.status === 'error').length;
  const progress = queue.items.reduce((s, i) => s + (i.status === 'done' || i.status === 'skipped' || i.status === 'error' ? 1 : i.pct), 0) / Math.max(1, n);
  const ok = queue.items.filter((i) => i.status === 'done');
  const before = ok.reduce((s, i) => s + (i.before || 0), 0);
  const after = ok.reduce((s, i) => s + (i.after || 0), 0);
  const errors = queue.items.filter((i) => i.status === 'error').length;
  const title = queue.kind === 'existing' ? t('Optimizing existing photos') : t('Photo upload');
  return (
    <Card
      class="upload-queue"
      title={title}
      icon={queue.kind === 'existing' ? 'wand' : 'upload'}
      desc={
        queue.running
          ? t('{done} of {total} · keep this page open', { done: finished, total: n })
          : [
              t('{done} of {total} done', { done: ok.length, total: n }),
              ok.length && before > after ? t('{size} saved', { size: formatBytes(before - after) }) : '',
              errors ? t('{n} with errors', { n: errors }) : '',
            ]
              .filter(Boolean)
              .join(' · ')
      }
      actions={
        !queue.running && (
          <Button size="sm" variant="ghost" icon="x" onClick={onClose}>
            {t('Close')}
          </Button>
        )
      }
    >
      <div class="progress upload-queue__bar">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <ul class="upload-queue__list">
        {queue.items.map((i) => (
          <li class={`uq uq--${i.status}`} key={i.id}>
            <span class="uq__thumb">
              {i.thumb ? (
                <img src={i.thumb} alt="" />
              ) : (
                <Icon name={i.status === 'error' ? 'alert' : i.status === 'skipped' ? 'x' : 'image'} size={16} />
              )}
            </span>
            <span class="uq__body">
              <span class="uq__name" title={i.name}>
                {i.name}
              </span>
              <span class="uq__status">
                {(i.status === 'optimizing' || i.status === 'heic' || i.status === 'uploading') && <span class="spinner spinner--xs" />}
                {i.status === 'done' && <Icon name="check" size={13} />}
                {statusText(i)}
              </span>
              {(i.status === 'optimizing' || i.status === 'heic' || i.status === 'uploading') && (
                <span class="progress progress--thin">
                  <span style={{ transform: `scaleX(${i.pct})` }} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
