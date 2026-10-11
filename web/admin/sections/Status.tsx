import { useEffect, useState } from 'preact/hooks';
import type { AdminStatus } from '../../shared/types';
import { api, ApiError } from '../api';
import { Icon } from '../components/icons';
import { Button, Card, Empty, PageHeader, StatusDot } from '../components/ui';
import { has, runtime } from '../caps';
import { formatDuration, relTime, t } from '../i18n';
import type { SectionProps } from './common';
import { fetchErrorText } from '../apiErrors';
import { UpdatesCard } from '../components/Updates';

export function StatusSection({ cfg }: SectionProps) {
  const newsOn = has('news');
  const showUptime = runtime() !== 'workers';
  const [st, setSt] = useState<AdminStatus | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [, tick] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      setSt(await api.status());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const a = setInterval(load, 15000);
    const b = setInterval(() => tick((n) => n + 1), 5000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const srcMeta = (id: string) => cfg.calendar.sources.find((s) => s.id === id);
  const okCount = st?.sources.filter((s) => s.ok).length ?? 0;

  return (
    <>
      <PageHeader title={t('Status')} desc={t('Health of sources and connected screens. Updates every 15 s.')}>
        <Button icon="refresh" loading={loading} onClick={load}>
          {t('Refresh')}
        </Button>
      </PageHeader>
      {err && !st ? (
        <Card>
          <Empty icon="alert" title={t('Could not get status')}>
            {err}
          </Empty>
        </Card>
      ) : (
        <>
          <div class="stats">
            <div class="stat">
              <span class="stat__icon">
                <Icon name="monitor" size={18} />
              </span>
              <div>
                <div class="stat__value">{st ? st.displays : '–'}</div>
                <div class="stat__label">{t('Connected screens')}</div>
              </div>
            </div>
            <div class="stat">
              <span class="stat__icon">
                <Icon name="calendar" size={18} />
              </span>
              <div>
                <div class="stat__value">
                  {st ? `${okCount}/${st.sources.length}` : '–'}
                </div>
                <div class="stat__label">{t('Calendars OK')}</div>
              </div>
            </div>
            <div class="stat">
              <span class="stat__icon">
                <Icon name="cloud" size={18} />
              </span>
              <div>
                <div class="stat__value stat__value--text">
                  {st ? <StatusDot state={st.weather.ok ? 'ok' : 'error'} /> : null} {st ? relTime(st.weather.updatedAt) : '–'}
                </div>
                <div class="stat__label">{t('Weather')}</div>
              </div>
            </div>
            {newsOn && (
              <div class="stat">
                <span class="stat__icon">
                  <Icon name="news" size={18} />
                </span>
                <div>
                  <div class="stat__value stat__value--text">
                    {st ? <StatusDot state={st.news.ok ? 'ok' : 'error'} /> : null} {st ? relTime(st.news.updatedAt) : '–'}
                  </div>
                  <div class="stat__label">
                    {t('News')}
                    {st?.news.count != null && ` · ${st.news.count}`}
                  </div>
                </div>
              </div>
            )}
            {showUptime && (
              <div class="stat">
                <span class="stat__icon">
                  <Icon name="activity" size={18} />
                </span>
                <div>
                  <div class="stat__value">{st && st.uptime != null ? formatDuration(st.uptime) : '–'}</div>
                  <div class="stat__label">{t('Server uptime')}</div>
                </div>
              </div>
            )}
          </div>
          {newsOn && st?.news.error && (
            <div class="test-result is-err">
              <Icon name="alert" size={14} /> {t('News')}: {fetchErrorText(st.news.error)}
            </div>
          )}
          <Card title={t('Calendar sources')} icon="calendar">
            {!st ? (
              <div class="skeleton-list">
                <div class="skeleton" />
                <div class="skeleton" />
              </div>
            ) : st.sources.length === 0 ? (
              <Empty icon="calendar" title={t('No calendars configured')} />
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>{t('Calendar')}</th>
                      <th>{t('Status')}</th>
                      <th class="num">{t('Events')}</th>
                      <th>{t('Last fetch')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.sources.map((s) => {
                      const m = srcMeta(s.id);
                      return (
                        <tr>
                          <td>
                            <span class="dot-color" style={{ background: m?.color ?? '#888' }} /> {m?.emoji} <strong>{s.name}</strong>
                          </td>
                          <td>
                            {s.ok ? (
                              <span class="ok-text">
                                <StatusDot state="ok" /> OK
                              </span>
                            ) : (
                              <span class="err-text" title={s.error ?? ''}>
                                <StatusDot state={s.lastFetch ? 'error' : 'idle'} /> {fetchErrorText(s.error) || t('Pending')}
                              </span>
                            )}
                          </td>
                          <td class="num">{s.count}</td>
                          <td class="muted" title={s.lastFetch ?? ''}>
                            {relTime(s.lastFetch)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      <UpdatesCard />
    </>
  );
}
