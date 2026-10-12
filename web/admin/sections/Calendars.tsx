import { useEffect, useState } from 'preact/hooks';
import type { CalendarSource, HaCalendarListItem, SourceKind, TestIcsResponse } from '../../shared/types';
import { api, ApiError, UNAUTHORIZED_EVENT } from '../api';
import { fetchErrorText } from '../apiErrors';
import { confirmDialog, toast } from '../components/feedback';
import { GoogleG, Icon, MicrosoftLogo } from '../components/icons';
import {
  Button,
  Callout,
  Card,
  ColorPicker,
  EmojiPicker,
  Empty,
  Field,
  NumberInput,
  PageHeader,
  ReorderButtons,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
  ToggleRow,
  useReorder,
} from '../components/ui';
import { atLimit, has } from '../caps';
import { LimitNote } from '../components/LimitNote';
import { t } from '../i18n';
import { allSourceOptions, guessKind, isHttpUrl, KIND_EMOJI, moveItem, SWATCHES, uid } from '../util';
import type { SectionProps } from './common';

/** `insecureTls` is an optional extension (self-signed HTTPS feeds on the LAN); see docs/ARCHITECTURE.md. */
type Source = CalendarSource & { insecureTls?: boolean };

function nextColor(sources: CalendarSource[]) {
  const used = new Set(sources.map((s) => s.color.toLowerCase()));
  return SWATCHES.find((c) => !used.has(c)) ?? SWATCHES[sources.length % SWATCHES.length];
}

/** Adds an iCal source to a config draft. */
function pushIcs(d: { calendar: { sources: CalendarSource[] } }, name = '', url = '', kind: SourceKind = 'generic') {
  if (atLimit('sources', d.calendar.sources.length)) return;
  d.calendar.sources.push({
    id: uid('c'),
    type: 'ics',
    name: name || t('Calendar {n}', { n: d.calendar.sources.length + 1 }),
    url,
    color: nextColor(d.calendar.sources),
    emoji: '',
    kind,
    enabled: true,
    refreshMin: kind === 'holidays' ? 720 : 5,
  });
}

function SourceRow({
  src,
  index,
  count,
  errors,
  update,
  remove,
  move,
  reorder,
}: {
  src: Source;
  index: number;
  count: number;
  errors: Record<string, string>;
  update: (fn: (s: Source) => void) => void;
  remove: () => void;
  move: (from: number, to: number) => void;
  reorder: ReturnType<typeof useReorder>;
}) {
  const [test, setTest] = useState<{ loading: boolean; res?: TestIcsResponse }>({ loading: false });
  const p = `source.${src.id}`;
  const urlValid = src.type === 'ics' && !!src.url && isHttpUrl(src.url, true);
  /** The server kept the stored URL back (no recent sign-in): the field stays empty unless a new URL is typed. */
  const hidden = src.type === 'ics' && !!src.urlHidden && !src.url;
  const runTest = async () => {
    if (!src.url) return;
    setTest({ loading: true });
    try {
      const res = await api.testIcs(src.url.trim(), src.insecureTls);
      setTest({ loading: false, res });
    } catch (e) {
      setTest({ loading: false, res: { ok: false, error: (e as ApiError).message } });
    }
  };
  return (
    <div class={`src ${src.enabled ? '' : 'is-off'}`} {...(reorder.rowProps(index) as any)} style={{ '--src-color': src.color } as any}>
      <div class="src__head">
        <span class="grip" title={t('Drag to reorder')} {...reorder.handleProps(index)}>
          <Icon name="grip" size={16} />
        </span>
        <EmojiPicker value={src.emoji ?? ''} allowNone onChange={(v) => update((s) => void (s.emoji = v))} />
        <ColorPicker compact value={src.color} error={!!errors[`${p}.color`]} onChange={(v) => update((s) => void (s.color = v ?? s.color))} />
        <TextInput
          class="src__name"
          value={src.name}
          error={!!errors[`${p}.name`]}
          placeholder={t('Name')}
          onValue={(v) => update((s) => void (s.name = v))}
        />
        <span class={`badge ${src.type !== 'ics' ? 'badge--google' : ''}`}>
          {src.type === 'google' ? <GoogleG size={12} /> : src.type === 'microsoft' ? <MicrosoftLogo size={12} /> : src.type === 'homeassistant' ? 'HA' : 'ICS'}
        </span>
        <Toggle checked={src.enabled} onChange={(v) => update((s) => void (s.enabled = v))} label={t('Enabled')} />
        <ReorderButtons index={index} count={count} onMove={move} />
        <button type="button" class="icon-btn icon-btn--danger" onClick={remove} aria-label={t('Delete')} title={t('Delete')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      <div class="src__body">
        {src.type === 'ics' ? (
          <Field
            error={errors[`${p}.url`]}
            class="src__url"
            hint={
              hidden ? (
                <>
                  {t('For security, the address is only shown if you signed in recently.')}{' '}
                  <button type="button" class="link-btn" onClick={() => window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))}>
                    {t('Sign in again')}
                  </button>
                </>
              ) : undefined
            }
          >
            <TextInput
              mono
              value={src.url ?? ''}
              placeholder={hidden ? t('Saved address (hidden)') : 'https://…/calendar.ics'}
              error={!!errors[`${p}.url`]}
              onValue={(v) => {
                update((s) => {
                  s.url = v;
                  if (s.kind === 'generic' && /airbnb|booking|reservations/i.test(v)) s.kind = 'airbnb';
                });
                setTest({ loading: false });
              }}
              prefix={<Icon name="link" size={14} />}
              suffix={
                src.url ? (
                  <span class={urlValid ? 'ok-text' : 'err-text'} title={urlValid ? t('Valid URL') : t('Invalid URL')}>
                    <Icon name={urlValid ? 'check' : 'x'} size={14} />
                  </span>
                ) : undefined
              }
            />
          </Field>
        ) : src.type === 'homeassistant' ? (
          <div class="src__google">
            <Icon name="calendar" size={14} />
            <span class="mono small muted">{src.entityId}</span>
            {errors[`${p}.entityId`] && <span class="err-text">{errors[`${p}.entityId`]}</span>}
          </div>
        ) : src.type === 'microsoft' ? (
          <div class="src__google">
            <MicrosoftLogo size={14} />
            <span class="muted">{src.microsoftAccount}</span>
          </div>
        ) : (
          <div class="src__google">
            <GoogleG size={14} />
            <span class="muted">{src.googleAccount}</span>
            <span class="mono small muted">{src.googleCalendarId}</span>
          </div>
        )}
        <div class="src__opts">
          <label class="mini-field" title={t('How often (minutes) it is downloaded again')}>
            <span>{t('Refresh every')}</span>
            <NumberInput value={src.refreshMin} min={1} max={1440} suffix="min" error={!!errors[`${p}.refreshMin`]} onValue={(v) => update((s) => void (s.refreshMin = v))} />
          </label>
          {src.type === 'ics' && (has('insecureTls') || !!src.insecureTls) && (
            <label class="mini-toggle" title={t('Accept self-signed HTTPS certificates (local network only)')}>
              <Toggle size="sm" checked={!!src.insecureTls} onChange={(v) => update((s) => void (s.insecureTls = v))} />
              <span>{t('Self-signed certificate')}</span>
            </label>
          )}
          {src.type === 'ics' && (
            <Button size="sm" icon="play" loading={test.loading} disabled={!urlValid} onClick={runTest}>
              {t('Test')}
            </Button>
          )}
        </div>
        {test.res && (
          <div class={`test-result ${test.res.ok ? 'is-ok' : 'is-err'}`}>
            {test.res.ok ? (
              <>
                <strong>
                  <Icon name="check" size={14} /> {t('{n} events found', { n: test.res.count ?? 0 })}
                </strong>
                {!!test.res.sample?.length && (
                  <ul>
                    {test.res.sample.slice(0, 5).map((s) => (
                      <li>{s}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <span>
                <Icon name="alert" size={14} /> {fetchErrorText(test.res.error) || t('Could not read the calendar')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HomeAssistantCalendars({ cfg, set }: SectionProps) {
  const [calendars, setCalendars] = useState<HaCalendarListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try { setCalendars(await api.haCalendars()); } catch (err) { setError((err as ApiError).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const selected = (entityId: string) => cfg.calendar.sources.some((s) => s.type === 'homeassistant' && s.entityId === entityId);
  const toggle = (calendar: HaCalendarListItem, on: boolean) => set((d) => {
    if (!on) {
      d.calendar.sources = d.calendar.sources.filter((s) => s.type !== 'homeassistant' || s.entityId !== calendar.entity_id);
    } else if (!selected(calendar.entity_id) && !atLimit('sources', d.calendar.sources.length)) {
      d.calendar.sources.push({
        id: uid('c'), type: 'homeassistant', entityId: calendar.entity_id, name: calendar.name,
        color: nextColor(d.calendar.sources), emoji: '', kind: guessKind(calendar.name), enabled: true, refreshMin: 5,
      });
    }
  });
  return (
    <Card title={t('Home Assistant calendars')} id="cal-homeassistant" icon="calendar"
      desc={t('Choose calendars already connected in Home Assistant, including Google Calendar.')}
      actions={<Button size="sm" loading={loading} onClick={() => void load()}>{t('Refresh')}</Button>}>
      {error ? <Callout kind="error">{error}</Callout> : calendars === null ? <div class="skeleton" /> : calendars.length === 0 ? (
        <Empty icon="calendar" title={t('No Home Assistant calendars yet')}>
          {t('Set up Google Calendar in Home Assistant, then refresh this list.')}{' '}
          <a href="https://www.home-assistant.io/integrations/google/" target="_blank" rel="noopener noreferrer">{t('Set up Google Calendar')}</a>
        </Empty>
      ) : (
        <ul class="gcal-list">
          {calendars.map((calendar) => {
            const on = selected(calendar.entity_id);
            return <li key={calendar.entity_id}>
              <label class={`gcal ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} disabled={!on && atLimit('sources', cfg.calendar.sources.length)} onChange={(e) => toggle(calendar, e.currentTarget.checked)} />
                <span class="check-box"><Icon name="check" size={12} /></span>
                <span class="gcal__name">{calendar.name}</span>
                <span class="mono small muted">{calendar.entity_id}</span>
              </label>
            </li>;
          })}
        </ul>
      )}
    </Card>
  );
}

/** Visible calendars (`calendar.sourceIds`: null includes all calendars added later). */
function VisibleCalendarsCard({ cfg, set, full }: SectionProps) {
  const ids = cfg.calendar.sourceIds ?? null;
  const opts = allSourceOptions(full, { includeDisabled: true });
  const disabled = new Set(full.calendar.sources.filter((s) => !s.enabled).map((s) => s.id));
  const all = ids === null;
  const toggle = (id: string, on: boolean) =>
    set((d) => {
      const cur = d.calendar.sourceIds ?? opts.map((o) => o.id);
      d.calendar.sourceIds = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    });
  return (
    <Card
      id="cal-screen-sources"
      title={t('Visible calendars')}
      icon="eye"
      desc={t('Choose which calendars are shown.')}
    >
      <Segmented
        full
        value={all ? 'all' : 'some'}
        options={[
          { value: 'all', label: t('All calendars') },
          { value: 'some', label: t('Only some') },
        ]}
        onChange={(v) => set((d) => void (d.calendar.sourceIds = v === 'all' ? null : opts.filter((o) => !disabled.has(o.id)).map((o) => o.id)))}
      />
      {all ? (
        <p class="muted small">{t('All active calendars are shown, including ones you add later.')}</p>
      ) : (
        <ul class="gcal-list screen-src-list">
          {opts.map((o) => {
            const on = (ids ?? []).includes(o.id);
            return (
              <li>
                <label class={`gcal ${on ? 'is-on' : ''} ${disabled.has(o.id) ? 'is-dim' : ''}`}>
                  <input type="checkbox" checked={on} onChange={(e) => toggle(o.id, e.currentTarget.checked)} />
                  <span class="check-box">
                    <Icon name="check" size={12} />
                  </span>
                  <span class="dot-color" style={{ background: o.color }} />
                  <span class="gcal__name">
                    {o.emoji ? `${o.emoji} ` : ''}
                    {o.name}
                  </span>
                  {disabled.has(o.id) && <span class="badge badge--soft">{t('Disabled')}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!all && (ids ?? []).length === 0 && <Callout kind="warn">{t('No calendars selected. No events will be shown.')}</Callout>}
    </Card>
  );
}

export function CalendarsSection(props: SectionProps) {
  const { cfg, set, errors } = props;
  const c = cfg.calendar;
  const sources = c.sources as Source[];
  const move = (from: number, to: number) => set((d) => void (d.calendar.sources = moveItem(d.calendar.sources, from, to)));
  const reorder = useReorder(move);

  const atMax = atLimit('sources', sources.length);
  const addIcs = (name = '', url = '', kind: SourceKind = 'generic') => set((d) => pushIcs(d, name, url, kind));

  const removeSource = async (s: Source) => {
    const ok = await confirmDialog({ title: t('Delete “{name}”', { name: s.name || 'calendar' }), body: t('Its events will no longer be shown.'), confirm: t('Delete'), danger: true });
    if (ok) set((d) => void (d.calendar.sources = d.calendar.sources.filter((x) => x.id !== s.id)));
  };

  return (
    <>
      <PageHeader
        title={t('Calendars')}
        desc={t('Choose Google calendars connected in Home Assistant, or add a private iCal link.')}
      />

      {(props.me.homeAssistant || props.full.homeassistant.enabled) && <HomeAssistantCalendars {...props} />}

      <Card
        title={t('Connected calendars')}
        id="cal-sources"
        icon="link"
        desc={t('Each calendar has its own colour and emoji. The order defines the legend priority.')}
        actions={
          <Button icon="plus" variant="primary" size="sm" disabled={atMax} onClick={() => addIcs()}>
            {t('Add iCal URL')}
          </Button>
        }
      >
        {sources.length === 0 ? (
          <Empty icon="calendar" title={t('No calendars yet')}>
            {t('Choose a Home Assistant calendar above, or paste a private iCal link.')}
          </Empty>
        ) : (
          <div class="src-list">
            {sources.map((s, i) => (
              <SourceRow
                key={s.id}
                src={s}
                index={i}
                count={sources.length}
                errors={errors}
                reorder={reorder}
                move={move}
                remove={() => removeSource(s)}
                update={(fn) =>
                  set((d) => {
                    const target = d.calendar.sources.find((x) => x.id === s.id);
                    if (target) fn(target as Source);
                  })
                }
              />
            ))}
          </div>
        )}
        <LimitNote name="sources" count={sources.length} />
      </Card>


      <VisibleCalendarsCard {...props} />

      <Card id="cal-view" title={t('Calendar view')} icon="calendar">
        <ToggleRow label={t('Show calendar')} checked={c.enabled} onChange={(v) => set((d) => void (d.calendar.enabled = v))} />
        <div class={`stack ${c.enabled ? '' : 'is-disabled'}`}>
          <div class="grid grid--2">
            <Field label={t('View type')}>
              <Segmented
                full
                value={c.view}
                options={[
                  { value: 'month', label: t('Monthly') },
                  { value: 'week', label: t('Weekly') },
                  { value: 'agenda', label: t('Agenda') },
                ]}
                onChange={(v) => set((d) => void (d.calendar.view = v))}
              />
            </Field>
            <Field label={t('Week starts on')}>
              <Segmented
                full
                value={c.weekStart}
                options={[
                  { value: 1, label: t('Monday') },
                  { value: 0, label: t('Sunday') },
                ]}
                onChange={(v) => set((d) => void (d.calendar.weekStart = v))}
              />
            </Field>
            <Field label={t('Weeks to show')} error={errors['calendar.weeks']}>
              <Segmented full value={c.weeks} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => set((d) => void (d.calendar.weeks = v))} />
            </Field>
            <Field label={t('Max. visible events per day')} error={errors['calendar.maxEventsPerDay']}>
              <Slider value={c.maxEventsPerDay} min={1} max={8} step={1} onChange={(v) => set((d) => void (d.calendar.maxEventsPerDay = v))} />
            </Field>
          </div>
          <div class="toggle-grid">
            <ToggleRow icon="📍" label={t('Event location')} checked={c.showLocation} onChange={(v) => set((d) => void (d.calendar.showLocation = v))} />
            <ToggleRow icon="⏱️" label={t('End time')} checked={c.showEndTime} onChange={(v) => set((d) => void (d.calendar.showEndTime = v))} />
            <ToggleRow icon="🔢" label={t('“Day X of Y” on long events')} checked={c.showDayXofY} onChange={(v) => set((d) => void (d.calendar.showDayXofY = v))} />
            <ToggleRow icon="🏷️" label={t('Calendar legend')} checked={c.showLegend} onChange={(v) => set((d) => void (d.calendar.showLegend = v))} />
            <ToggleRow icon="⏭️" label={t('Current & future events only')} checked={c.hidePast} onChange={(v) => set((d) => void (d.calendar.hidePast = v))} />
            <ToggleRow
              icon="↔️"
              label={t('Slide long titles')}
              hint={t('Titles that do not fit slide slowly so you can read them in full: in the calendar and next to the clock. Titles on several lines move up one line at a time.')}
              checked={c.marquee !== false}
              onChange={(v) => set((d) => void (d.calendar.marquee = v))}
            />
            <ToggleRow
              icon="🔁"
              label={t('Rotate busy days')}
              hint={t('When a day has more events than fit, they take turns.')}
              checked={c.rotateBusyDays !== false}
              onChange={(v) => set((d) => void (d.calendar.rotateBusyDays = v))}
            />
            <ToggleRow
              icon="🗜️"
              label={t('Compact busy days')}
              hint={t('When a day cannot fit its events, they show as small one-line entries, and weeks with more events get more height. What still does not fit takes turns or shows “+N”.')}
              checked={c.compactBusyDays === true}
              onChange={(v) => set((d) => void (d.calendar.compactBusyDays = v))}
            />
          </div>
        </div>
      </Card>
    </>
  );
}
