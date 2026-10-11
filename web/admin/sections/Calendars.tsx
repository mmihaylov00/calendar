import { useEffect, useState } from 'preact/hooks';
import type { CalendarSource, GoogleCalendarListItem, HaCalendarListItem, MicrosoftCalendarListItem, SourceKind, TestIcsResponse } from '../../shared/types';
import { appUrl } from '../../shared/path';
import { api, ApiError, UNAUTHORIZED_EVENT } from '../api';
import { fetchErrorText } from '../apiErrors';
import { choiceDialog, confirmDialog, toast } from '../components/feedback';
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
import { atLimit, has, offers } from '../caps';
import { defaultPrivacyOf, privacyModeOptions } from './Privacy';
import { LimitNote } from '../components/LimitNote';
import { t } from '../i18n';
import { allSourceOptions, guessKind, HOLIDAY_PRESETS, isHttpUrl, KIND_EMOJI, moveItem, SWATCHES, uid } from '../util';
import type { SectionProps } from './common';
import { ICloudGuide, icloudUrl } from './ICloudGuide';

/** `insecureTls` is an optional extension (self-signed HTTPS feeds on the LAN); see docs/ARCHITECTURE.md. */
type Source = CalendarSource & { insecureTls?: boolean };

const KINDS: { value: SourceKind; label: string }[] = [
  { value: 'generic', label: 'General' },
  { value: 'airbnb', label: 'Vacation rental (Airbnb, Booking…)' },
  { value: 'birthdays', label: 'Birthdays' },
  { value: 'holidays', label: 'Holidays' },
];


function nextColor(sources: CalendarSource[]) {
  const used = new Set(sources.map((s) => s.color.toLowerCase()));
  return SWATCHES.find((c) => !used.has(c)) ?? SWATCHES[sources.length % SWATCHES.length];
}

/** Adds an iCal source to a config draft ("Añadir URL iCal", the quick-add pills and the iCloud guide). */
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
          <label class="mini-field">
            <span>{t('Type')}</span>
            <div class="src__kind">
              <Select value={src.kind} options={KINDS.map((k) => ({ ...k, label: `${KIND_EMOJI[k.value] || '📅'} ${t(k.label)}` }))} onChange={(v) => update((s) => void (s.kind = v))} />
            </div>
          </label>
          {has('privacy') && (
            <label class="mini-field" title={t('What screens in private mode show of this calendar')}>
              <span>{t('In private mode')}</span>
              <div class="src__kind">
                <Select value={src.privacy ?? defaultPrivacyOf(src.kind)} options={privacyModeOptions()} onChange={(v) => update((s) => void (s.privacy = v))} />
              </div>
            </label>
          )}
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

/** A linked account and one of its calendars, the same for every provider. */
interface LinkedAccount {
  email: string;
  name?: string;
  picture?: string;
}
interface LinkedCalendar {
  id: string;
  name: string;
  color?: string;
  primary?: boolean;
  /** owner address of a calendar someone else shared with the account */
  owner?: string;
}

type ProviderId = 'google' | 'microsoft';

/** What differs between Google and Microsoft in the linked accounts card. Strings are English. */
interface Provider {
  id: ProviderId;
  label: string;
  /** the server can link accounts of this provider for this user (me.googleConfigured / me.microsoftConfigured) */
  configured: boolean;
  leaveBody: string;
  disconnectBody: string;
  connectPath: string;
  accounts: () => Promise<LinkedAccount[]>;
  calendars: (email: string) => Promise<LinkedCalendar[]>;
  remove: (email: string) => Promise<unknown>;
  accountOf: (s: CalendarSource) => string | undefined;
  calendarOf: (s: CalendarSource) => string | undefined;
  newSource: (email: string, c: LinkedCalendar) => Partial<CalendarSource>;
}

function googleProvider(me: SectionProps['me']): Provider {
  return {
    id: 'google',
    label: 'Google',
    configured: offers('googleCalendar') && !!me.googleConfigured,
    leaveBody: 'You are going to Google to link the account. Save pending changes first?',
    disconnectBody: 'Its calendars will no longer be shown on the screen.',
    connectPath: '/auth/google/connect',
    accounts: () => api.googleAccounts(),
    calendars: async (email) =>
      (await api.googleCalendars(email)).map((c: GoogleCalendarListItem) => ({ id: c.id, name: c.summary, color: c.backgroundColor, primary: c.primary })),
    remove: (email) => api.removeGoogleAccount(email),
    accountOf: (s) => (s.type === 'google' ? s.googleAccount : undefined),
    calendarOf: (s) => (s.type === 'google' ? s.googleCalendarId : undefined),
    newSource: (email, c) => ({ type: 'google', googleAccount: email, googleCalendarId: c.id }),
  };
}

function microsoftProvider(me: SectionProps['me']): Provider {
  return {
    id: 'microsoft',
    label: 'Microsoft',
    configured: has('microsoftCalendar') && !!me.microsoftConfigured,
    leaveBody: 'You are about to go to Microsoft to link the account. Save your pending changes first?',
    disconnectBody:
      'Its calendars will no longer show on the screen and Calendar will delete its access. To remove the permission at Microsoft too, go to account.live.com/consent/Manage (personal account) or myapps.microsoft.com (work or school account).',
    connectPath: '/auth/microsoft/connect',
    accounts: () => api.microsoftAccounts(),
    calendars: async (email) =>
      (await api.microsoftCalendars(email)).map((c: MicrosoftCalendarListItem) => ({ id: c.id, name: c.name, color: c.color, primary: c.isDefault, owner: c.owner })),
    remove: (email) => api.removeMicrosoftAccount(email),
    accountOf: (s) => (s.type === 'microsoft' ? s.microsoftAccount : undefined),
    calendarOf: (s) => (s.type === 'microsoft' ? s.microsoftCalendarId : undefined),
    newSource: (email, c) => ({ type: 'microsoft', microsoftAccount: email, microsoftCalendarId: c.id }),
  };
}

/** One linked account of any provider, as listed in the card. */
interface Linked extends LinkedAccount {
  provider: ProviderId;
}
const linkKey = (a: { provider: ProviderId; email: string }) => `${a.provider}:${a.email}`;

/**
 * Linked accounts (Google and Microsoft) in one card: "Link account" asks which provider, and every linked account is
 * listed one below the other with its calendars to pick from. Apple iCloud is always in the chooser: it opens a guide
 * to add the calendar's public link as an iCal source (no account to link, no server credentials).
 */
function LinkedAccounts({ cfg, set, dirty, save, me }: SectionProps) {
  const all = [googleProvider(me), microsoftProvider(me)];
  const providers = all.filter((p) => p.configured);
  const byId = (id: ProviderId) => all.find((p) => p.id === id)!;
  const configuredKey = providers.map((p) => p.id).join(',');
  const [accounts, setAccounts] = useState<Linked[] | null>(null);
  const [cals, setCals] = useState<Record<string, LinkedCalendar[] | 'error' | undefined>>({});
  const [err, setErr] = useState('');
  const [icloud, setIcloud] = useState(false);

  const load = async () => {
    const lists = await Promise.allSettled(providers.map(async (p) => (await p.accounts()).map((a) => ({ ...a, provider: p.id }) as Linked)));
    const list = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const failed = lists.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    setAccounts(list);
    setErr(failed ? (failed.reason as ApiError).message : '');
    for (const a of list) {
      byId(a.provider)
        .calendars(a.email)
        .then((c) => setCals((m) => ({ ...m, [linkKey(a)]: c })))
        .catch(() => setCals((m) => ({ ...m, [linkKey(a)]: 'error' })));
    }
  };
  useEffect(() => {
    if (providers.length) load();
    else setAccounts([]);
  }, [configuredKey]);

  const go = async (p: Provider) => {
    if (dirty) {
      const ok = await confirmDialog({
        title: t('Save changes before continuing'),
        body: t(p.leaveBody),
        confirm: t('Save and continue'),
      });
      if (!ok) return;
      if (!(await save())) return;
    }
    window.location.href = appUrl(p.connectPath);
  };

  /** Ask which provider (Apple iCloud is always there); with no account provider set up, straight to the iCloud guide. */
  const connect = async () => {
    if (!providers.length) return setIcloud(true);
    const choice = await choiceDialog<ProviderId | 'apple'>({
      title: t('Link account'),
      body: t('Which account do you want to link?'),
      choices: [
        ...providers.map((p) => ({ value: p.id, label: p.label, kind: 'default' as const, icon: p.id })),
        { value: 'apple' as const, label: 'Apple iCloud', kind: 'default' as const, icon: 'apple' as const },
      ],
      closeX: true,
    });
    if (choice === 'apple') setIcloud(true);
    else if (choice) await go(byId(choice));
  };

  const ofAccount = (s: CalendarSource, a: Linked) => byId(a.provider).accountOf(s) === a.email;
  const isOn = (a: Linked, id: string) => cfg.calendar.sources.some((s) => ofAccount(s, a) && byId(a.provider).calendarOf(s) === id);

  const disconnect = async (a: Linked) => {
    const p = byId(a.provider);
    const ok = await confirmDialog({
      title: t('Unlink {email}', { email: a.email }),
      body: t(p.disconnectBody),
      confirm: t('Unlink'),
      danger: true,
    });
    if (!ok) return;
    try {
      await p.remove(a.email);
      set((d) => {
        d.calendar.sources = d.calendar.sources.filter((s) => !ofAccount(s, a));
      });
      toast(t('Account unlinked. Save to apply the calendar changes.'), 'info');
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const toggleCal = (a: Linked, c: LinkedCalendar, on: boolean) =>
    set((d) => {
      const p = byId(a.provider);
      if (on) {
        if (isOn(a, c.id) || atLimit('sources', d.calendar.sources.length)) return;
        d.calendar.sources.push({
          id: uid('c'),
          type: p.id,
          name: c.name,
          color: c.color && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : nextColor(d.calendar.sources),
          emoji: '',
          kind: guessKind(`${c.name} ${c.id}`),
          enabled: true,
          refreshMin: 5,
          ...p.newSource(a.email, c),
        } as CalendarSource);
      } else {
        d.calendar.sources = d.calendar.sources.filter((s) => !(ofAccount(s, a) && p.calendarOf(s) === c.id));
      }
    });

  const desc =
    providers.length > 1
      ? t('Link Google or Microsoft accounts (Outlook.com, Hotmail, Microsoft 365) and choose which calendars to show.')
      : providers[0]?.id === 'microsoft'
        ? t('Link an Outlook.com, Hotmail or Microsoft 365 account and choose which calendars to show.')
        : providers[0]?.id === 'google'
          ? t('Link a Google account and choose which calendars to show.')
          : t('Add an Apple iCloud calendar with its public link.');
  const hasMicrosoft = !!accounts?.some((a) => a.provider === 'microsoft');

  return (
    <Card
      title={t('Linked accounts')}
      id="cal-accounts"
      scope="global"
      icon="link"
      desc={desc}
      actions={
        <Button icon="plus" variant="primary" size="sm" onClick={connect}>
          {providers.length ? t('Link account') : t('Add iCloud')}
        </Button>
      }
    >
      {icloud && (
        <ICloudGuide
          onClose={() => setIcloud(false)}
          onAdd={(name, url) => set((d) => pushIcs(d, name, url, 'generic'))}
          exists={(url) => cfg.calendar.sources.some((s) => s.type === 'ics' && !!s.url && icloudUrl(s.url) === url)}
          disabled={atLimit('sources', cfg.calendar.sources.length)}
          note={<LimitNote name="sources" count={cfg.calendar.sources.length} />}
        />
      )}
      {providers.length === 0 ? (
        (offers('googleCalendar') || offers('microsoftCalendar')) && (
          <Callout kind="warn">
            {t('To link accounts, add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google) or MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET (Microsoft) to the .env file and restart. Meanwhile you can use your calendar’s secret iCal URL.')}
          </Callout>
        )
      ) : accounts === null ? (
        <div class="skeleton-list">
          <div class="skeleton" />
          <div class="skeleton" />
        </div>
      ) : accounts.length === 0 ? (
        <Empty icon="calendar" title={err ? t('Could not load accounts') : t('No linked accounts')}>
          {err ||
            (providers.length > 1
              ? t('Press “Link account” to give read-only access to your Google or Outlook calendar.')
              : providers[0].id === 'microsoft'
                ? t('Press “Link account” to give read-only access to your Outlook calendar.')
                : t('Press “Link account” to grant read-only access to your Google Calendar.'))}
        </Empty>
      ) : (
        <div class="gaccounts">
          {accounts.map((a) => {
            const list = cals[linkKey(a)];
            return (
              <div class="gaccount">
                <div class="gaccount__head">
                  {a.picture ? <img class="avatar" src={a.picture} alt="" referrerpolicy="no-referrer" /> : <span class="avatar avatar--letter">{(a.name || a.email)[0].toUpperCase()}</span>}
                  <div class="gaccount__who">
                    <strong>{a.name || a.email}</strong>
                    <span class="muted small">
                      {a.provider === 'microsoft' ? <MicrosoftLogo size={12} /> : <GoogleG size={12} />} {byId(a.provider).label}
                      {a.name && a.name !== a.email ? ` · ${a.email}` : ''}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" icon="x" onClick={() => disconnect(a)}>
                    {t('Unlink')}
                  </Button>
                </div>
                {list === undefined ? (
                  <div class="skeleton" />
                ) : list === 'error' ? (
                  <Callout kind="error">{t('Could not read the calendar list. Link the account again.')}</Callout>
                ) : (
                  <ul class="gcal-list">
                    {list.map((c) => {
                      const on = isOn(a, c.id);
                      return (
                        <li>
                          <label class={`gcal ${on ? 'is-on' : ''}`}>
                            <input type="checkbox" checked={on} disabled={!on && atLimit('sources', cfg.calendar.sources.length)} onChange={(e) => toggleCal(a, c, e.currentTarget.checked)} />
                            <span class="check-box">
                              <Icon name="check" size={12} />
                            </span>
                            <span class="dot-color" style={{ background: c.color || '#888' }} />
                            <span class="gcal__name">{c.name}</span>
                            {c.owner && <span class="muted small">{c.owner}</span>}
                            {c.primary && <span class="badge badge--soft">{t('Primary')}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {hasMicrosoft && (
        <p class="muted small">
          {t('Calendar only reads your calendars. To remove the permission at Microsoft too:')}{' '}
          <a href="https://account.live.com/consent/Manage" target="_blank" rel="noopener noreferrer">
            {t('personal account')}
          </a>
          {' · '}
          <a href="https://myapps.microsoft.com" target="_blank" rel="noopener noreferrer">
            {t('work or school account')}
          </a>
        </p>
      )}
    </Card>
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
    <Card title={t('Home Assistant calendars')} id="cal-homeassistant" icon="calendar" scope="global"
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

/** Per-screen: which sources this screen shows (`calendar.sourceIds`: null = all, incl. new ones). */
function ScreenSourcesCard({ cfg, set, full }: SectionProps) {
  const ids = cfg.calendar.sourceIds ?? null;
  const opts = allSourceOptions(full, { includeDisabled: true });
  const disabled = new Set(full.calendar.sources.filter((s) => !s.enabled).map((s) => s.id));
  if (!full.localEvents.enabled) disabled.add('local');
  if (!full.birthdays.enabled) disabled.add('birthdays');
  const all = ids === null;
  const toggle = (id: string, on: boolean) =>
    set((d) => {
      const cur = d.calendar.sourceIds ?? opts.map((o) => o.id);
      d.calendar.sourceIds = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    });
  return (
    <Card
      id="cal-screen-sources"
      scope="screen"
      title={t('Calendars on this screen')}
      icon="eye"
      desc={full.screens.length > 1 ? t('For example: the kitchen only with family and birthdays; the hall with bookings.') : t('Choose which calendars are shown.')}
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
                  {(o.id === 'local' || o.id === 'birthdays') && <span class="badge badge--soft">{o.id === 'local' ? t('Local events') : t('Birthdays')}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!all && (ids ?? []).length === 0 && <Callout kind="warn">{t('No calendar ticked: this screen will show no events.')}</Callout>}
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
    const ok = await confirmDialog({ title: t('Delete “{name}”', { name: s.name || 'calendario' }), body: t('Its events will no longer be shown.'), confirm: t('Delete'), danger: true });
    if (ok) set((d) => void (d.calendar.sources = d.calendar.sources.filter((x) => x.id !== s.id)));
  };

  return (
    <>
      <PageHeader
        title={t('Calendars')}
        desc={
          offers('microsoftCalendar')
            ? offers('googleCalendar')
              ? t('Connect iCal, Google and Microsoft calendars, and decide how they look.')
              : t('Connect iCal and Microsoft calendars, and decide how they look.')
            : offers('googleCalendar')
              ? t('Connect iCal and Google calendars and decide how they are shown.')
              : t('Connect iCal calendars and decide how they are shown.')
        }
      />

      {(props.me.homeAssistant || props.full.homeassistant.enabled) && <HomeAssistantCalendars {...props} />}

      <Card
        title={t('Connected calendars')}
        id="cal-sources"
        scope="global"
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
            {offers('googleCalendar') && offers('microsoftCalendar')
              ? t('Paste your calendar’s .ics URL (Airbnb, Booking, Google, iCloud, Outlook…) or link a Google or Microsoft account.')
              : offers('googleCalendar')
                ? t('Paste your calendar’s .ics URL (Airbnb, Booking, Google, iCloud, Outlook…) or link a Google account.')
                : offers('microsoftCalendar')
                  ? t('Paste your calendar’s .ics URL (Airbnb, Booking, Google, iCloud, Outlook…) or link a Microsoft account.')
                  : t('Paste your calendar’s .ics URL (Airbnb, Booking, Google, iCloud, Outlook…).')}
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
        <div class="quick-add">
          <span class="muted small">{t('Quick add:')}</span>
          {HOLIDAY_PRESETS.filter((p) => !sources.some((s) => s.url === p.url)).map((p) => (
            <button type="button" class="pill" disabled={atMax} onClick={() => addIcs(t(p.name), p.url, 'holidays')}>
              🎉 {t(p.name)}
            </button>
          ))}
          <button type="button" class="pill" disabled={atMax} onClick={() => addIcs('Airbnb', '', 'airbnb')}>
            🏠 {t('Airbnb bookings')}
          </button>
        </div>
      </Card>

      <LinkedAccounts {...props} />

      <ScreenSourcesCard {...props} />

      <Card id="cal-view" scope="screen" title={t('Calendar view')} icon="calendar">
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
              hint={t('Titles that do not fit slide slowly so you can read them in full: in the calendar, next to the clock, in countdowns and in the news. Titles on several lines move up one line at a time.')}
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
