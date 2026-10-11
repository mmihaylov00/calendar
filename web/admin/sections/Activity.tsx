import { useEffect, useRef, useState } from 'preact/hooks';
import type { ActivityEntry } from '../../shared/types';
import { ACTIVITY_GROUPS, actorLabel, describeActivity } from '../activityText';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Card, Empty, PageHeader, SearchInput, Segmented } from '../components/ui';
import { fmtDay, todayIn } from '../dates';
import { locale, t } from '../i18n';
import type { SectionProps } from './common';

const PAGE = 50;

export function ActivitySection(_: SectionProps) {
  const [type, setType] = useState('');
  const [level, setLevel] = useState<'' | 'warn' | 'error'>('');
  const [q, setQ] = useState('');
  const [qDeb, setQDeb] = useState('');
  const [items, setItems] = useState<ActivityEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const h = setTimeout(() => setQDeb(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const load = async (more = false) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const before = more && items?.length ? items[items.length - 1].id : undefined;
      const r = await api.activity({ type: type || undefined, level: level || undefined, q: qDeb || undefined, before, limit: PAGE });
      if (my !== seq.current) return;
      setItems(more && items ? [...items, ...r.items] : r.items);
      setHasMore(r.hasMore);
      setErr('');
    } catch (e) {
      if (my === seq.current) setErr((e as ApiError).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    load(false);
  }, [type, level, qDeb]);

  const clear = async () => {
    if (!(await confirmDialog({ title: t('Clear the activity log?'), body: t('All entries will be deleted. This cannot be undone.'), confirm: t('Clear'), danger: true }))) return;
    try {
      await api.clearActivity();
      toast(t('Log cleared'));
      load(false);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const today = todayIn();
  const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dayOf = (ts: string) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <>
      <PageHeader title={t('Activity')} desc={t('Who did what and when: sign-ins, setting changes, alerts, API usage and calendar errors.')}>
        <Button icon="refresh" loading={loading && !!items} onClick={() => load(false)}>
          {t('Refresh')}
        </Button>
        <Button variant="ghost" icon="trash" onClick={clear}>
          {t('Clear')}
        </Button>
      </PageHeader>

      <div class="toolbar toolbar--wrap">
        <div class="target-pick">
          {ACTIVITY_GROUPS.map((g) => (
            <button type="button" class={`pill ${type === g.value ? 'is-on' : ''}`} onClick={() => setType(g.value)}>
              <Icon name={g.icon} size={13} /> {t(g.label)}
            </button>
          ))}
        </div>
        <Segmented
          size="sm"
          value={level}
          options={[
            { value: '', label: t('All') },
            { value: 'warn', label: t('Alerts') },
            { value: 'error', label: t('Errors') },
          ]}
          onChange={setLevel}
        />
        <SearchInput value={q} onValue={setQ} placeholder={t('Search (email, IP, calendar…)')} />
      </div>

      <Card>
        {err && !items ? (
          <Empty icon="alert" title={t('Could not load activity')}>
            {err}
          </Empty>
        ) : !items ? (
          <div class="skeleton-list">
            <div class="skeleton" />
            <div class="skeleton" />
            <div class="skeleton" />
          </div>
        ) : items.length === 0 ? (
          <Empty icon="history" title={type || level || qDeb ? t('Nothing matches the filter') : t('No activity recorded.')} />
        ) : (
          <ul class={`act-list ${loading ? 'is-loading' : ''}`}>
            {items.map((a, i) => {
              const day = dayOf(a.ts);
              const head = i === 0 || dayOf(items[i - 1].ts) !== day;
              const x = describeActivity(a);
              const isOpen = open === a.id;
              const hasData = a.data && Object.keys(a.data).length > 0;
              return (
                <>
                  {head && <li class="act-day">{day === today ? t('Today') : fmtDay(day, { year: 'auto' })}</li>}
                  <li class={`act act--${a.level} ${isOpen ? 'is-open' : ''}`}>
                    <button type="button" class="act__row" onClick={() => hasData && setOpen(isOpen ? null : a.id)} aria-expanded={hasData ? isOpen : undefined}>
                      <span class="act__time mono small">{timeFmt.format(new Date(a.ts))}</span>
                      <span class="act__icon">
                        <Icon name={x.icon} size={14} />
                      </span>
                      <span class="act__text">{x.text}</span>
                      <span class="act__who muted small">
                        {actorLabel(a.actor)}
                        {a.ip && <span class="hide-xs"> · {a.ip}</span>}
                      </span>
                      {hasData && <Icon name="down" size={12} class={`act__chev ${isOpen ? 'rot-180' : ''}`} />}
                    </button>
                    {isOpen && hasData && (
                      <pre class="act__data">
                        <code>{JSON.stringify(a.data, null, 2)}</code>
                      </pre>
                    )}
                  </li>
                </>
              );
            })}
          </ul>
        )}
        {hasMore && (
          <div class="center">
            <Button variant="ghost" loading={loading} onClick={() => load(true)}>
              {t('Load more')}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
