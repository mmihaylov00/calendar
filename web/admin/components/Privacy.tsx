// Privacy mode in the admin: shared state (GET /api/admin/privacy, polled while the panel is open), the banner
// shown on every page while a screen is private, and the quick actions (1 h, 3 h, until tomorrow, until turned
// off, off) used on Home. The display side and the rules are in server/core/privacy.js.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PrivacyRequest, PrivacyScreenState } from '../../shared/types';
import { api, ApiError } from '../api';
import { has } from '../caps';
import { locale, t } from '../i18n';
import { toast } from './feedback';
import { Icon } from './icons';
import { Button } from './ui';

const POLL_MS = 30_000;
let rows: PrivacyScreenState[] | null = null;
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const fn of subs) fn();
}

/** Ask the server again (after an action, or on the poll). */
export function refreshPrivacy(): Promise<void> {
  if (!has('privacy')) return Promise.resolve();
  if (inflight) return inflight;
  inflight = api
    .privacy()
    .then((r) => {
      rows = r.screens;
      emit();
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Privacy state of every screen (null until the first answer). Polls while a component uses it. */
export function usePrivacy(): PrivacyScreenState[] | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    subs.add(fn);
    if (!rows) void refreshPrivacy();
    const id = setInterval(() => void refreshPrivacy(), POLL_MS);
    return () => {
      subs.delete(fn);
      clearInterval(id);
    };
  }, []);
  return rows;
}

/** "14:30", or "mañana 06:00" / "vie 14:30" when it is not today (time zone of Date & time). */
export function privacyTime(iso: string, tz: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d);
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(x);
  const today = day(new Date());
  const tomorrow = day(new Date(Date.now() + 86_400_000));
  if (day(d) === today) return time;
  if (day(d) === tomorrow) return t('tomorrow at {time}', { time });
  const wd = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', timeZone: tz }).format(d);
  return t('{day} at {time}', { day: wd, time });
}

/** "hasta las 14:30" / "hasta que lo quites". */
export function privacyUntilText(r: Pick<PrivacyScreenState, 'until'>, tz: string): string {
  if (!r.until) return t('until you turn it off');
  const when = privacyTime(r.until, tz);
  return /^\d/.test(when) ? t('until {time}', { time: when }) : t('until {when}', { when });
}

const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${t('and')} ${names[names.length - 1]}`);

/** Banner on every page while at least one screen is private. */
export function PrivacyBanner({ tz, go }: { tz: string; go: (route: string) => void }) {
  const list = usePrivacy();
  const [busy, setBusy] = useState(false);
  if (!has('privacy') || !list) return null;
  const on = list.filter((r) => r.active);
  if (!on.length) return null;
  // one line per end time: "Modo privado en Salón y Cocina hasta las 14:30"
  const groups = new Map<string, PrivacyScreenState[]>();
  for (const r of on) groups.set(r.until ?? '', [...(groups.get(r.until ?? '') ?? []), r]);
  const all = on.length === list.length && list.length > 1;
  const off = async () => {
    setBusy(true);
    try {
      await api.setPrivacy({ mode: 'off', screens: on.map((r) => r.screenId) });
      await refreshPrivacy();
      toast(t('Private mode off'));
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="update-banner privacy-banner" role="status">
      <Icon name="lock" size={16} />
      <span class="update-banner__text">
        {[...groups.values()].map((g) => (
          <span class="privacy-banner__line">
            {t('Private mode on {screen} {until}', {
              screen: all && groups.size === 1 ? t('all screens') : joinNames(g.map((r) => r.name)),
              until: privacyUntilText(g[0], tz),
            })}
            {g.every((r) => r.by === 'schedule') && <span class="muted small"> · {t('scheduled')}</span>}
          </span>
        ))}
      </span>
      <span class="update-banner__actions">
        <Button size="sm" variant="ghost" onClick={() => go('screen')}>
          {t('Settings')}
        </Button>
        <Button size="sm" icon="x" loading={busy} onClick={off}>
          {t('Turn off')}
        </Button>
      </span>
    </div>
  );
}

type Choice = 'h1' | 'h3' | 'morning' | 'open' | 'off';

const choiceBody = (c: Choice): Omit<PrivacyRequest, 'screens'> =>
  c === 'h1' ? { mode: 'on', hours: 1 } : c === 'h3' ? { mode: 'on', hours: 3 } : c === 'morning' ? { mode: 'on', untilTime: '06:00' } : c === 'open' ? { mode: 'on' } : { mode: 'off' };

/**
 * The quick actions for some screens ([] = all). `active` tells whether "Quitar" applies.
 */
export function PrivacyActions({ screenIds = [], active, onDone, size }: { screenIds?: string[]; active: boolean; onDone?: () => void; size?: 'sm' }) {
  const [busy, setBusy] = useState<Choice | null>(null);
  const run = async (c: Choice) => {
    setBusy(c);
    try {
      await api.setPrivacy({ ...choiceBody(c), ...(screenIds.length ? { screens: screenIds } : {}) });
      await refreshPrivacy();
      toast(c === 'off' ? t('Private mode off') : t('Private mode on'));
      onDone?.();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const opts: [Choice, string, string][] = [
    ['h1', t('1 h'), t('Private mode for 1 hour')],
    ['h3', t('3 h'), t('Private mode for 3 hours')],
    ['morning', t('Until tomorrow'), t('Until 06:00 tomorrow')],
    ['open', t('Until I turn it off'), t('No end time')],
  ];
  return (
    <div class="privacy-actions">
      <div class="btn-group" role="group" aria-label={t('Private mode')}>
        {opts.map(([c, label, title]) => (
          <Button size={size} icon={c === 'h1' ? 'lock' : undefined} loading={busy === c} onClick={() => run(c)} title={title}>
            {label}
          </Button>
        ))}
      </div>
      {active && (
        <Button size={size} variant="ghost" icon="x" loading={busy === 'off'} onClick={() => run('off')}>
          {t('Turn off')}
        </Button>
      )}
    </div>
  );
}

/** Lock button with a small menu of the quick actions for one screen ('' = every screen). Home → Screens, Displays. */
export function PrivacyMenu({ screenId, row, tz }: { screenId: string; row: Pick<PrivacyScreenState, 'active' | 'until'> | undefined; tz: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!has('privacy')) return null;
  const active = !!row?.active;
  return (
    <div class="privacy-menu" ref={ref}>
      <button
        type="button"
        class={`icon-btn ${active ? 'is-private' : ''}`}
        aria-expanded={open}
        title={active ? `${t('Private mode')} · ${privacyUntilText(row!, tz)}` : t('Private mode')}
        onClick={() => setOpen(!open)}
      >
        <Icon name="lock" size={15} />
      </button>
      {open && (
        <div class="privacy-menu__pop" role="dialog" aria-label={t('Private mode')}>
          <strong>{t('Private mode')}</strong>
          <p class="muted small">
            {active ? t('On {until}', { until: privacyUntilText(row!, tz) }) : screenId ? t('Events show as “Busy” on this screen.') : t('Events show as “Busy” on every screen.')}
          </p>
          <PrivacyActions size="sm" screenIds={screenId ? [screenId] : []} active={active} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
