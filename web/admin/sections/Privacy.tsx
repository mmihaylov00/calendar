// Screen settings → Privacy mode: photos, the lock, the schedule rules of this screen, and what each calendar shows
// while a screen is private (that part is global). Quick actions live on Home (components/Privacy.tsx).
import type { AppConfig, PrivacyMode, PrivacyRule, ScreenPrivacyConfig, SourceKind } from '../../shared/types';
import { Icon } from '../components/icons';
import { PrivacyActions, privacyUntilText, usePrivacy } from '../components/Privacy';
import { Button, Card, Field, Select, Toggle, ToggleRow, WeekdayPicker } from '../components/ui';
import { weekdayNames } from '../dates';
import { t } from '../i18n';
import type { Errors } from '../util';

export const DEFAULT_SCREEN_PRIVACY: ScreenPrivacyConfig = { hidePhotos: false, showLock: true, schedule: [] };

/** Same default as the server (server/core/privacy.js): holidays and birthdays stay, the rest shows as busy. */
export const defaultPrivacyOf = (kind: SourceKind): PrivacyMode => (kind === 'holidays' || kind === 'birthdays' ? 'keep' : 'busy');

export const privacyModeOptions = () => [
  { value: 'busy' as PrivacyMode, label: t('Show as Busy') },
  { value: 'hide' as PrivacyMode, label: t('Hide') },
  { value: 'keep' as PrivacyMode, label: t('Leave as is') },
];

/** "En modo privado" select of one calendar (Calendars, Local events, Birthdays). */
export function PrivacyModeField({ value, onChange }: { value: PrivacyMode; onChange: (v: PrivacyMode) => void }) {
  return (
    <Field label={t('In private mode')} hint={value === 'busy' ? t('Only the time and the calendar colour, titled “Busy”.') : undefined}>
      <Select value={value} options={privacyModeOptions()} onChange={onChange} />
    </Field>
  );
}

const newRule = (): PrivacyRule => ({ id: `p_${Math.random().toString(36).slice(2, 10)}`, enabled: true, days: [], from: '22:00', to: '07:00' });

export function PrivacyCard({ cfg, set, errors, go }: { cfg: AppConfig; set: (fn: (d: AppConfig) => void) => void; errors: Errors; go: (r: string) => void }) {
  const p = cfg.privacy ?? DEFAULT_SCREEN_PRIVACY;
  const rows = usePrivacy();
  const row = rows?.find((r) => r.screenId === cfg.screenId);
  const wd = weekdayNames('short');
  const tz = cfg.datetime.timezone;
  const upd = (fn: (x: ScreenPrivacyConfig) => void) =>
    set((d) => {
      d.privacy = d.privacy ?? structuredClone(DEFAULT_SCREEN_PRIVACY);
      fn(d.privacy);
    });
  const updRule = (id: string, fn: (r: PrivacyRule) => void) => upd((x) => void fn(x.schedule.find((r) => r.id === id)!));
  const sources: { id: string; name: string; color: string; mode: PrivacyMode; set: (v: PrivacyMode) => void }[] = [
    ...cfg.calendar.sources.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      mode: s.privacy ?? defaultPrivacyOf(s.kind),
      set: (v: PrivacyMode) => set((d) => void (d.calendar.sources.find((x) => x.id === s.id)!.privacy = v)),
    })),
    { id: 'local', name: cfg.localEvents.name, color: cfg.localEvents.color, mode: cfg.localEvents.privacy ?? 'busy', set: (v: PrivacyMode) => set((d) => void (d.localEvents.privacy = v)) },
    { id: 'birthdays', name: cfg.birthdays.name, color: cfg.birthdays.color, mode: cfg.birthdays.privacy ?? 'keep', set: (v: PrivacyMode) => set((d) => void (d.birthdays.privacy = v)) },
  ];
  return (
    <Card
      id="scr-privacy"
      scope="screen"
      title={t('Private mode')}
      icon="lock"
      desc={t('For when you have guests: events show as “Busy”, without titles, places or notes. The server does the filtering, so the screen never receives the real data.')}
    >
      <div class="privacy-now">
        <span class={`privacy-now__state ${row?.active ? 'is-on' : ''}`}>
          <Icon name="lock" size={14} />
          {row?.active ? t('On {until}', { until: privacyUntilText(row, tz) }) : t('Off right now')}
          {row?.active && row.by === 'schedule' && <span class="muted small"> · {t('scheduled')}</span>}
        </span>
        <PrivacyActions size="sm" screenIds={[cfg.screenId]} active={!!row?.active} />
      </div>

      <ToggleRow
        label={t('Hide photos')}
        hint={t('While it is on, the background and the photo frame use stock photos instead of your gallery.')}
        checked={p.hidePhotos}
        onChange={(v) => upd((x) => void (x.hidePhotos = v))}
      />
      <ToggleRow label={t('Show a lock on the screen')} hint={t('A small lock in the corner shows that private mode is on.')} checked={p.showLock} onChange={(v) => upd((x) => void (x.showLock = v))} />

      <div>
        <h4 class="privacy-sub">{t('Schedule')}</h4>
        <p class="muted small privacy-note">
          {t('It turns on by itself during these times. If you turn it off by hand during one, it comes back with the next. If you turn it on by hand, it lasts as long as you chose, even when the time slot ends earlier.')}
        </p>
      </div>
      {p.schedule.map((r) => {
        const crosses = r.to < r.from;
        const err = errors[`privacy.${r.id}.to`];
        return (
          <div class={`privacy-rule ${r.enabled ? '' : 'is-disabled'}`}>
            <div class="privacy-rule__head">
              <label class="mini-toggle">
                <Toggle checked={r.enabled} onChange={(v) => updRule(r.id, (x) => void (x.enabled = v))} />
                <span>{r.enabled ? t('Enabled') : t('Paused')}</span>
              </label>
              <button type="button" class="icon-btn" title={t('Delete')} onClick={() => upd((x) => void (x.schedule = x.schedule.filter((y) => y.id !== r.id)))}>
                <Icon name="trash" size={15} />
              </button>
            </div>
            <Field label={t('Days')} hint={r.days.length ? undefined : t('None ticked: every day')}>
              <WeekdayPicker labels={wd} value={r.days} onChange={(v) => updRule(r.id, (x) => void (x.days = v))} />
            </Field>
            <div class="grid grid--2">
              <Field label={t('From')}>
                <input class="input" type="time" value={r.from} onInput={(ev) => updRule(r.id, (x) => void (x.from = ev.currentTarget.value))} />
              </Field>
              <Field label={t('To')} error={err ? t(err) : undefined} hint={crosses ? t('Ends the next day') : undefined}>
                <input class={`input ${err ? 'is-invalid' : ''}`} type="time" value={r.to} onInput={(ev) => updRule(r.id, (x) => void (x.to = ev.currentTarget.value))} />
              </Field>
            </div>
          </div>
        );
      })}
      {p.schedule.length < 10 && (
        <Button size="sm" icon="plus" onClick={() => upd((x) => void x.schedule.push(newRule()))}>
          {t('Add a time slot')}
        </Button>
      )}

      <div>
        <h4 class="privacy-sub">{t('What each calendar shows')}</h4>
        <p class="muted small privacy-note">{t('This applies to every screen. Weather, alerts and messages do not change.')}</p>
      </div>
      <ul class="privacy-sources">
        {sources.map((s) => (
          <li>
            <span class="dot-color" style={{ background: s.color }} />
            <span class="privacy-sources__name">{s.name}</span>
            <Select value={s.mode} options={privacyModeOptions()} onChange={s.set} />
          </li>
        ))}
      </ul>
      <p class="muted small">
        {t('To let Home Assistant turn it on, use the /api/hooks/privacy webhook.')}{' '}
        <a href="#api" onClick={(e) => (e.preventDefault(), go('api'))}>
          {t('API & webhooks')}
        </a>
      </p>
    </Card>
  );
}
