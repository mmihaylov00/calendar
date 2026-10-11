import { appUrl } from '../shared/path';
// First-run setup wizard (shown instead of the login while the server has no admin password).
// Steps: welcome → admin password → location → calendars → look → done (display URL + QR).
// Server side: server/setup.js (POST /api/setup/complete creates the password + settings and logs in).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { passwordProblem, passwordScore, MIN_PASSWORD } from '../shared/password';
import { BrandMark } from './components/BrandMark';
import { CopyField, Qr } from './components/share';
import { REPO_URL } from '../shared/project';
import type { GeocodeResult, LayoutPreset, SetupRequest, SetupStatus, TestIcsResponse } from '../shared/types';
import { api, ApiError } from './api';
import { Icon, type IconName } from './components/icons';
import { Button, Callout, Field, Segmented, TextInput } from './components/ui';
import { t } from './i18n';
import { PRESETS, Schematic } from './sections/Layout';
import { HOLIDAY_PRESETS, isHttpUrl, SWATCHES } from './util';

const TOKEN_KEY = 'calendar-admin.setupToken';
/** README section with the Google OAuth guide (REPO_URL: web/shared/project.ts). */
export const GOOGLE_GUIDE_URL = `${REPO_URL}#connecting-google-calendar`;

/** `?setup=<token>` from the startup log: keep it for this tab only and drop it from the address bar. */
export function takeSetupToken(): string {
  let tok = '';
  try {
    const qs = new URLSearchParams(location.search);
    const fromUrl = qs.get('setup');
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      qs.delete('setup');
      const rest = qs.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
    tok = sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    /* storage blocked */
  }
  return tok;
}
const forgetToken = () => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

interface Place {
  name: string;
  lat: number;
  lon: number;
  timezone: string;
  cc: string;
}
interface Cal {
  name: string;
  url: string;
  kind: 'holidays' | 'generic';
}

const STEPS: { id: string; label: string; icon: IconName }[] = [
  { id: 'welcome', label: 'Welcome', icon: 'sparkles' },
  { id: 'password', label: 'Password', icon: 'key' },
  { id: 'location', label: 'Location', icon: 'globe' },
  { id: 'calendars', label: 'Calendars', icon: 'calendar' },
  { id: 'look', label: 'Look', icon: 'palette' },
  { id: 'done', label: 'Done', icon: 'check' },
];

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
const validTz = (tz: string) => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const browser12h = () => {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
  } catch {
    return false;
  }
};
const browserRegion = () => {
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const m = /-([A-Z]{2})\b/i.exec(l);
      if (m) return m[1].toUpperCase();
    }
  } catch {
    /* ignore */
  }
  return '';
};

/** Black or white text on the accent colour (WCAG relative luminance). */
function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? '#111' : '#fff';
}

/** Country names in English. */
function regionName(cc: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? '';
  } catch {
    return '';
  }
}

function StrengthMeter({ pw }: { pw: string }) {
  const score = passwordScore(pw);
  const labels = ['', t('Weak'), t('Fair'), t('Good'), t('Strong')];
  return (
    <div class={`strength strength--${score}`} aria-live="polite">
      <div class="strength__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span class={i <= score ? 'is-on' : ''} />
        ))}
      </div>
      <span class="strength__label">{pw ? labels[score] : t('Type a password')}</span>
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: ComponentChildren }) {
  return (
    <li class={ok ? 'is-ok' : ''}>
      <Icon name={ok ? 'check' : 'x'} size={13} /> {children}
    </li>
  );
}

export function SetupWizard({ status: initial, onDone }: { status: SetupStatus; onDone: () => void }) {
  const [status, setStatus] = useState(initial);
  const [step, setStep] = useState(0);
  const [token, setToken] = useState(() => takeSetupToken());
  const [tokenErr, setTokenErr] = useState('');
  const [checking, setChecking] = useState(false);
  // password
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwTried, setPwTried] = useState(false);
  // location
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [tz, setTz] = useState(browserTz());
  const [units, setUnits] = useState<'metric' | 'imperial'>(() => (['US', 'LR', 'MM'].includes(browserRegion()) ? 'imperial' : 'metric'));
  const [h24, setH24] = useState(() => !browser12h());
  const [locTried, setLocTried] = useState(false);
  // No geocoding (offline LAN, blocked Open-Meteo): coordinates typed by hand, or no location at all.
  const [manualLoc, setManualLoc] = useState(false);
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [skipLoc, setSkipLoc] = useState(false);
  // calendars
  const [cals, setCals] = useState<Cal[]>([]);
  const [holidaysTouched, setHolidaysTouched] = useState(false);
  const [icsName, setIcsName] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsTest, setIcsTest] = useState<(TestIcsResponse & { url: string }) | null>(null);
  const [testing, setTesting] = useState(false);
  const [icsErr, setIcsErr] = useState('');
  // look
  const [screenName, setScreenName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [preset, setPreset] = useState<LayoutPreset>('bigCalendar');
  const [accent, setAccent] = useState('#ff5a4e');
  const [photos, setPhotos] = useState<'stock' | 'gallery' | 'mixed'>('stock');
  const [ambient, setAmbient] = useState<'aurora' | 'particles' | 'none'>('aurora');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  // submit
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [done, setDone] = useState<{ slug: string; name: string; displayPath?: string | null } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const needToken = !!status.tokenRequired && status.tokenValid !== true;
  const defaultName = t('Living room');
  const effectiveName = nameTouched ? screenName : screenName || defaultName;

  // Focus the first field (or the step title) whenever the step changes, for keyboard and screen-reader users.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>('h2');
    el?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  // A valid token in the URL lets the wizard skip the "setup code" question.
  useEffect(() => {
    if (status.tokenRequired && token && status.tokenValid == null) {
      api.setupStatus(token).then((s) => setStatus(s)).catch(() => {});
    }
  }, []);

  /* ------------------------------------------------------------ validation per step */
  const pwProblem = passwordProblem(pw);
  const pwMismatch = !!pw2 && pw2 !== pw;
  const pwOk = !pwProblem && pw === pw2;
  const tzOk = validTz(tz);
  const manualLat = latText.trim() === '' ? NaN : Number(latText.replace(',', '.'));
  const manualLon = lonText.trim() === '' ? NaN : Number(lonText.replace(',', '.'));
  const manualOk = Number.isFinite(manualLat) && manualLat >= -90 && manualLat <= 90 && Number.isFinite(manualLon) && manualLon >= -180 && manualLon <= 180;

  const goto = (n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n)));

  const next = async (e?: Event) => {
    e?.preventDefault();
    if (busy || checking) return;
    if (step === 0) {
      if (needToken) {
        if (!token.trim()) return setTokenErr(t('Enter the setup code'));
        setChecking(true);
        try {
          const s = await api.setupStatus(token.trim());
          setStatus(s);
          if (!s.needsSetup) return location.reload();
          if (s.tokenValid !== true) return setTokenErr(t('Wrong setup code'));
          try {
            sessionStorage.setItem(TOKEN_KEY, token.trim());
          } catch {
            /* ignore */
          }
          setTokenErr('');
        } catch (err) {
          return setTokenErr((err as ApiError).message === 'network' ? t('Cannot reach the server') : (err as ApiError).message);
        } finally {
          setChecking(false);
        }
      }
      return goto(1);
    }
    if (step === 1) {
      setPwTried(true);
      if (!pwOk) return;
      return goto(2);
    }
    if (step === 2) {
      setLocTried(true);
      if (!tzOk) return;
      if (manualLoc && !skipLoc) {
        if (!manualOk) return;
        setPlace({ name: `${manualLat.toFixed(3)}, ${manualLon.toFixed(3)}`, lat: manualLat, lon: manualLon, timezone: tz, cc: '' });
      } else if (!place && !skipLoc) return;
      return goto(3);
    }
    if (step === 3) {
      if (icsUrl.trim()) {
        // a typed but not added feed: add it instead of silently dropping it
        if (!addIcs()) return;
      }
      return goto(4);
    }
    if (step === 4) {
      if (!effectiveName.trim()) return;
      return submit();
    }
  };
  const back = () => goto(step - 1);

  /* ------------------------------------------------------------ location */
  const search = async (e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!q.trim()) return;
    setSearching(true);
    setSearchErr('');
    try {
      // Through this server (GET /api/admin/geocode): the wizard has no session yet, so it sends its setup token.
      const j = await api.geocode(q.trim(), 'en', token.trim() || undefined);
      setResults(j.results ?? []);
    } catch (e) {
      setResults(null);
      setSearchErr((e as ApiError).status === 429 ? t('Too many searches in a row. Wait a few minutes.') : t('Search failed (no Internet connection?). Try again.'));
    } finally {
      setSearching(false);
    }
  };
  const pick = (r: GeocodeResult) => {
    const name = [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : '', r.country].filter(Boolean).join(', ');
    const p: Place = { name, lat: r.lat, lon: r.lon, timezone: r.timezone || browserTz(), cc: (r.countryCode || '').toUpperCase() };
    setPlace(p);
    setManualLoc(false);
    setSkipLoc(false);
    setTz(p.timezone);
    setResults(null);
    setQ('');
    if (p.cc === 'US' || p.cc === 'LR' || p.cc === 'MM') setUnits('imperial');
    else if (p.cc) setUnits('metric');
    if (!holidaysTouched) {
      const hp = HOLIDAY_PRESETS.find((h) => h.cc === p.cc);
      setCals((cs) => [...cs.filter((c) => c.kind !== 'holidays'), ...(hp ? [{ name: t(hp.name), url: hp.url, kind: 'holidays' as const }] : [])]);
    }
  };

  /* ------------------------------------------------------------ calendars */
  const toggleHoliday = (url: string, name: string) => {
    setHolidaysTouched(true);
    setCals((cs) => (cs.some((c) => c.url === url) ? cs.filter((c) => c.url !== url) : [...cs, { name, url, kind: 'holidays' }]));
  };
  const addIcs = (): boolean => {
    const url = icsUrl.trim();
    if (!isHttpUrl(url, true)) {
      setIcsErr(t('Invalid URL: it must start with https://, http:// or webcal://'));
      return false;
    }
    if (cals.some((c) => c.url === url)) {
      setIcsErr(t('This calendar is already in the list'));
      return false;
    }
    if (cals.length >= 20) return false;
    const fallback = (() => {
      try {
        return new URL(url.replace(/^webcals?:/, 'https:')).hostname.replace(/^www\./, '');
      } catch {
        return t('Calendar');
      }
    })();
    setCals((cs) => [...cs, { name: icsName.trim() || fallback, url, kind: 'generic' }]);
    setIcsName('');
    setIcsUrl('');
    setIcsErr('');
    return true;
  };
  const testIcs = async () => {
    const url = icsUrl.trim();
    if (!isHttpUrl(url, true)) {
      setIcsErr(t('Invalid URL: it must start with https://, http:// or webcal://'));
      return;
    }
    setTesting(true);
    setIcsErr('');
    try {
      const r = await api.setupTestIcs(url, token || undefined);
      setIcsTest({ ...r, url });
    } catch (err) {
      setIcsTest({ ok: false, error: (err as ApiError).message, url });
    } finally {
      setTesting(false);
    }
  };

  /* ------------------------------------------------------------ submit */
  const submit = async () => {
    setBusy(true);
    setSubmitErr('');
    const body: SetupRequest = {
      token: token.trim() || undefined,
      password: pw,
      passwordConfirm: pw2,
      language: 'en',
      screenName: effectiveName.trim(),
      location: place && !skipLoc ? { name: place.name, lat: place.lat, lon: place.lon, timezone: tz } : undefined,
      timezone: tzOk ? tz : undefined,
      units,
      format24: h24,
      calendars: cals.map((c) => ({ name: c.name, url: c.url, kind: c.kind })),
      photos: { source: photos },
      layout: { preset },
      accent,
      ambient,
      theme,
    };
    try {
      const r = await api.setupComplete(body);
      forgetToken();
      setDone(r.screen);
      setPw('');
      setPw2('');
      setStep(5);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.status === 409) {
        setSubmitErr(t('This installation is already set up. Reload the page to sign in.'));
      } else if (ae.status === 403 || ae.status === 429) {
        setStatus((s) => ({ ...s, tokenRequired: true, tokenValid: false }));
        setTokenErr(ae.status === 429 ? t('Too many attempts. Please wait a moment.') : t('Wrong setup code'));
        setStep(0);
      } else if (ae.status === 400) {
        const details = ((ae.body as any)?.details ?? []) as { path: string; message: string }[];
        const first = details[0]?.path ?? '';
        setSubmitErr(`${t('Check this step')}: ${details.map((d) => d.message).join('; ') || ae.message}`);
        if (first.startsWith('password')) setStep(1);
        else if (first.startsWith('location')) setStep(2);
        else if (first.startsWith('calendars')) setStep(3);
      } else {
        setSubmitErr(ae.message === 'network' ? t('Cannot reach the server') : ae.message);
      }
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ render helpers */
  // Opened on the server itself (localhost): phones and other devices need this machine's LAN address instead.
  const isLocalhost = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const lanIp = isLocalhost ? status.lanAddresses?.[0] : undefined;
  const portPart = location.port ? `:${location.port}` : '';
  const origin = lanIp ? `${location.protocol}//${lanIp}${portPart}` : location.origin;
  // Private display access (fresh installs): the Done step shows the screen's private link instead of the bare URL.
  const displayUrl = `${origin}${appUrl(done?.displayPath || '/')}`;
  const privateLink = !!done?.displayPath;
  const adminUrl = `${origin}${appUrl('/admin/')}`;
  const now = new Date();
  const timePreview = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric', minute: '2-digit', hour12: !h24, timeZone: tzOk ? tz : undefined,
      }).format(now);
    } catch {
      return '';
    }
  })();
  const cur = STEPS[step];
  const rootStyle = { '--accent': accent, '--on-accent': onAccent(accent) } as any;

  const progress = (
    <ol class="wz-progress" aria-label={t('Progress')}>
      {STEPS.map((s, i) => (
        <li class={`${i < step ? 'is-done' : ''} ${i === step ? 'is-current' : ''}`} aria-current={i === step ? 'step' : undefined}>
          <span class="wz-progress__dot">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
          <span class="wz-progress__label">{t(s.label)}</span>
        </li>
      ))}
    </ol>
  );

  let content: ComponentChildren = null;
  let title = '';
  let lead = '';

  if (step === 0) {
    title = t('Welcome to Calendar');
    lead = t('A family wall calendar inspired by DAKboard that runs on your own server: your calendars, photos and settings stay at home.');
    content = (
      <>
        <ul class="wz-features">
          <li>
            <span class="wz-features__ico">
              <Icon name="calendar" size={18} />
            </span>
            <div>
              <strong>{t('Calendars')}</strong>
              <span>{t('Google, iCal, holidays, birthdays and bookings at a glance.')}</span>
            </div>
          </li>
          <li>
            <span class="wz-features__ico">
              <Icon name="cloud" size={18} />
            </span>
            <div>
              <strong>{t('Weather & photos')}</strong>
              <span>{t('Forecast without an API key and your photos as background.')}</span>
            </div>
          </li>
          <li>
            <span class="wz-features__ico">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>{t('Private')}</strong>
              <span>{t('No accounts, no cloud: just your home network.')}</span>
            </div>
          </li>
        </ul>
        {needToken && (
          <Field
            label={t('Setup code')}
            error={tokenErr || undefined}
            hint={t('This server asks for a code before it can be set up. Find it in the server log, on the line “Open …/admin/?setup=…” (or in SETUP_TOKEN).')}
          >
            <TextInput value={token} onValue={(v) => setToken(v)} error={!!tokenErr} mono autocomplete="off" prefix={<Icon name="key" size={14} />} data-autofocus />
          </Field>
        )}
      </>
    );
  } else if (step === 1) {
    title = t('Create the admin password');
    lead = t('It protects the settings. The display needs no password; this panel does.');
    const showErr = pwTried || pw.length >= MIN_PASSWORD;
    content = (
      <>
        <input type="text" name="username" autocomplete="username" value="admin" hidden readOnly />
        <Field label={t('Password')} error={showErr && pwProblem ? (pwProblem === 'too_common' ? t('Too common or too simple') : pwProblem === 'too_long' ? t('At most 200 characters') : t('At least {n} characters', { n: MIN_PASSWORD })) : undefined}>
          <div class={`input-group input-group--lg ${showErr && pwProblem ? 'is-invalid' : ''}`}>
            <span class="input-group__addon">
              <Icon name="key" size={16} />
            </span>
            <input
              class="input"
              type={(showPw ? 'text' : 'password') as 'password'}
              autocomplete="new-password"
              value={pw}
              data-autofocus
              aria-describedby="wz-strength"
              onInput={(e) => setPw(e.currentTarget.value)}
            />
            <button type="button" class="input-group__btn" onClick={() => setShowPw(!showPw)} aria-label={showPw ? t('Hide') : t('Show')} aria-pressed={showPw}>
              <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
            </button>
          </div>
        </Field>
        <div id="wz-strength">
          <StrengthMeter pw={pw} />
        </div>
        <Field label={t('Repeat the password')} error={(pwTried || pw2.length >= pw.length) && pwMismatch ? t('Passwords do not match') : pwTried && !pw2 ? t('Repeat the password') : undefined}>
          <div class={`input-group input-group--lg ${pwMismatch ? 'is-invalid' : ''}`}>
            <span class="input-group__addon">
              <Icon name="check" size={16} />
            </span>
            <input class="input" type={(showPw ? 'text' : 'password') as 'password'} autocomplete="new-password" value={pw2} onInput={(e) => setPw2(e.currentTarget.value)} />
          </div>
        </Field>
        <ul class="wz-rules">
          <Rule ok={[...pw].length >= MIN_PASSWORD}>{t('At least {n} characters', { n: MIN_PASSWORD })}</Rule>
          <Rule ok={!!pw && pwProblem !== 'too_common' && pwProblem !== 'too_short'}>{t('Nothing obvious (password, 1234567890, qwerty…)')}</Rule>
          <Rule ok={!!pw2 && pw === pw2}>{t('Both match')}</Rule>
        </ul>
        <p class="muted small">{t('Tip: three or four random words are easy to remember and hard to guess.')}</p>
      </>
    );
  } else if (step === 2) {
    title = t('Where is the display?');
    lead = t('For the weather, the time zone and your country’s public holidays.');
    content = (
      <>
        <Field label={t('City')} error={locTried && !place && !manualLoc && !skipLoc ? t('Search for and pick your city') : undefined} hint={searchErr ? undefined : t('Search by Open-Meteo (free, no key).')}>
          <div class="search-row">
            <TextInput
              value={q}
              onValue={setQ}
              placeholder={t('Search city…')}
              prefix={<Icon name="search" size={14} />}
              data-autofocus
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
            />
            <Button onClick={() => search()} loading={searching}>
              {t('Search')}
            </Button>
          </div>
          {searchErr && <div class="field__error">{searchErr}</div>}
          {results && (
            <div class="geo-results" role="listbox" aria-label={t('Results')}>
              {results.length === 0 && <div class="muted small">{t('No results')}</div>}
              {results.map((r) => (
                <button type="button" class="geo-result" onClick={() => pick(r)}>
                  <Icon name="pin" size={14} />
                  <span>
                    <strong>{r.name}</strong>
                    <span class="muted">{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
                  </span>
                  <span class="muted small mono">{r.timezone}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        {!place && (
          <div class="wz-localt">
            <button type="button" class="link-btn" aria-expanded={manualLoc} onClick={() => { setManualLoc(!manualLoc); setSkipLoc(false); }}>
              {t('Enter coordinates')}
            </button>
            <span class="muted" aria-hidden="true">·</span>
            <button type="button" class="link-btn" aria-pressed={skipLoc} onClick={() => { setSkipLoc(!skipLoc); setManualLoc(false); }}>
              {skipLoc ? t('Choose a location') : t('Skip (set it later)')}
            </button>
          </div>
        )}
        {skipLoc && !place && <Callout kind="info">{t('Without a location there is no weather forecast; add it any time in Weather. The time zone below is saved anyway.')}</Callout>}
        {manualLoc && !place && (
          <div class="grid grid--2">
            <Field label={t('Latitude')} error={locTried && !manualOk ? t('Between -90 and 90') : undefined}>
              <TextInput value={latText} onValue={setLatText} mono placeholder="38.7223" inputMode="decimal" />
            </Field>
            <Field label={t('Longitude')} error={locTried && !manualOk ? t('Between -180 and 180') : undefined}>
              <TextInput value={lonText} onValue={setLonText} mono placeholder="-9.1393" inputMode="decimal" />
            </Field>
          </div>
        )}
        {place && (
          <div class="wz-place">
            <span class="wz-place__pin">
              <Icon name="pin" size={18} />
            </span>
            <div>
              <strong>{place.name}</strong>
              <div class="muted small mono">
                {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
              </div>
            </div>
          </div>
        )}
        <div class="grid grid--2">
          <Field label={t('Time zone')} error={!tzOk ? t('Invalid time zone') : undefined} hint={t('Detected automatically; change it if needed.')}>
            <TextInput value={tz} onValue={setTz} mono prefix={<span>🌍</span>} error={!tzOk} />
          </Field>
          <Field label={t('Time on the display')}>
            <div class="wz-timeprev">{timePreview}</div>
          </Field>
        </div>
        <div class="grid grid--2">
          <Field label={t('Temperature')}>
            <Segmented
              full
              value={units}
              options={[
                { value: 'metric', label: '°C · km/h' },
                { value: 'imperial', label: '°F · mph' },
              ]}
              onChange={setUnits}
            />
          </Field>
          <Field label={t('Time format')}>
            <Segmented
              full
              value={h24 ? '24' : '12'}
              options={[
                { value: '24', label: '24 h' },
                { value: '12', label: '12 h (AM/PM)' },
              ]}
              onChange={(v) => setH24(v === '24')}
            />
          </Field>
        </div>
      </>
    );
  } else if (step === 3) {
    title = t('Your calendars');
    lead = t('Start with public holidays and the calendars you already have. You can add more any time.');
    const holidayUrls = new Set(cals.filter((c) => c.kind === 'holidays').map((c) => c.url));
    const others = cals.filter((c) => !HOLIDAY_PRESETS.some((h) => h.url === c.url));
    content = (
      <>
        <Field label={t('Holidays')} hint={t('Google’s public calendars, by country.')}>
          <div class="wz-chips">
            {HOLIDAY_PRESETS.map((h, i) => (
              <button
                type="button"
                class={`wz-chip ${holidayUrls.has(h.url) ? 'is-active' : ''}`}
                aria-pressed={holidayUrls.has(h.url)}
                onClick={() => toggleHoliday(h.url, t(h.name))}
                {...(i === 0 ? { 'data-autofocus': true } : {})}
              >
                <span aria-hidden="true">{h.flag}</span> {regionName(h.cc) || t(h.name)}
                {holidayUrls.has(h.url) && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('Add an iCal calendar (.ics)')} error={icsErr || undefined} hint={icsErr ? undefined : t('Secret address from Google Calendar, Outlook, iCloud, school, Airbnb…')}>
          <div class="wz-ics">
            <TextInput value={icsName} onValue={setIcsName} placeholder={t('Name (optional)')} maxLength={80} />
            <TextInput
              value={icsUrl}
              onValue={(v) => {
                setIcsUrl(v);
                setIcsErr('');
              }}
              placeholder="https://…/basic.ics"
              mono
              error={!!icsErr}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addIcs();
                }
              }}
            />
            <div class="wz-ics__btns">
              <Button icon="zap" onClick={testIcs} loading={testing} disabled={!icsUrl.trim()}>
                {t('Test')}
              </Button>
              <Button icon="plus" variant="primary" onClick={() => addIcs()} disabled={!icsUrl.trim()}>
                {t('Add')}
              </Button>
            </div>
          </div>
          {icsTest && icsTest.url === icsUrl.trim() && (
            <div class={`wz-test ${icsTest.ok ? 'is-ok' : 'is-err'}`} role="status">
              <Icon name={icsTest.ok ? 'check' : 'alert'} size={14} />
              {icsTest.ok ? (
                <span>
                  {t('Works: {n} events in the coming months', { n: icsTest.count ?? 0 })}
                  {icsTest.sample?.length ? <span class="muted"> · {icsTest.sample.slice(0, 3).join(' · ')}</span> : null}
                </span>
              ) : (
                <span>
                  {t('Could not read it')}: {icsTest.error}
                </span>
              )}
            </div>
          )}
        </Field>
        {cals.length > 0 && (
          <ul class="wz-cal-list">
            {cals.map((c) => (
              <li>
                <span>{c.kind === 'holidays' ? '🎉' : '📅'}</span>
                <div>
                  <strong>{c.name}</strong>
                  <span class="muted small mono">{c.url}</span>
                </div>
                <button
                  type="button"
                  class="btn btn--ghost btn--icon btn--sm"
                  aria-label={t('Remove {name}', { name: c.name })}
                  onClick={() => {
                    if (c.kind === 'holidays') setHolidaysTouched(true);
                    setCals((cs) => cs.filter((x) => x.url !== c.url));
                  }}
                >
                  <Icon name="x" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {others.length === 0 && cals.length === 0 && <p class="muted small">{t('No calendars for now: you can also add them later.')}</p>}
        <div class="wz-google">
          <Icon name="google" size={18} />
          {status.googleConfigured ? (
            <div>
              <strong>{t('Google Calendar')}</strong>
              <p>{t('Google is configured on this server: link your account after setup, in Calendars → Google, and pick which calendars to show.')}</p>
            </div>
          ) : (
            <div>
              <strong>{t('Google Calendar')}</strong>
              <p>{t('Quickest: in Google Calendar open Settings → your calendar → “Secret address in iCal format” and paste it above.')}</p>
              <p>
                {t('Linking the account (and signing in with Google) needs your own OAuth client: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.')}{' '}
                <a href={GOOGLE_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                  {t('Step-by-step guide')} <Icon name="external" size={12} />
                </a>
              </p>
            </div>
          )}
        </div>
      </>
    );
  } else if (step === 4) {
    title = t('Make it yours');
    lead = t('Everything can be changed later in the panel.');
    content = (
      <>
        <Field label={t('Screen name')} hint={t('For example: Living room, Kitchen, Hallway.')} error={nameTouched && !screenName.trim() ? t('Enter a name') : undefined}>
          <TextInput
            value={nameTouched ? screenName : screenName || defaultName}
            onValue={(v) => {
              setNameTouched(true);
              setScreenName(v);
            }}
            maxLength={40}
            prefix={<Icon name="monitor" size={14} />}
            data-autofocus
          />
        </Field>
        <Field label={t('Layout')}>
          <div class="wz-presets" role="radiogroup" aria-label={t('Layout')}>
            {PRESETS.filter((p) => p.wizard).map((p) => (
              <button type="button" role="radio" aria-checked={preset === p.id} class={`preset ${preset === p.id ? 'is-active' : ''}`} onClick={() => setPreset(p.id)} title={t(p.desc)}>
                <Schematic id={p.id} side="left" />
                <div class="preset__text">
                  <div class="preset__name">
                    <span class="radio-dot" />
                    {t(p.name)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Field>
        <div class="grid grid--2">
          <Field label={t('Accent colour')}>
            <div class="wz-swatches" role="radiogroup" aria-label={t('Accent colour')}>
              {SWATCHES.slice(0, 10).map((c) => (
                <button type="button" role="radio" aria-checked={accent === c} aria-label={c} class={`swatch swatch--lg ${accent === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} />
              ))}
            </div>
          </Field>
          <Field label={t('Theme')}>
            <Segmented
              full
              value={theme}
              options={[
                { value: 'dark', label: t('Dark'), icon: 'moon' },
                { value: 'light', label: t('Light'), icon: 'sun' },
              ]}
              onChange={setTheme}
            />
          </Field>
        </div>
        <Field label={t('Background photos')} hint={photos === 'stock' ? t('Stock landscape photos, ready from minute one.') : t('Upload your photos later in Gallery (from your phone too).')}>
          <Segmented
            full
            value={photos}
            options={[
              { value: 'stock', label: t('Stock'), icon: 'globe' },
              { value: 'gallery', label: t('My gallery'), icon: 'photos' },
              { value: 'mixed', label: t('Mixed'), icon: 'sparkles' },
            ]}
            onChange={setPhotos}
          />
        </Field>
        <Field label={t('Ambient effect')}>
          <div class="fx-grid">
            {(
              [
                { v: 'aurora', name: t('Aurora'), desc: t('Soft colour veils drifting slowly.') },
                { v: 'particles', name: t('Particles'), desc: t('Floating light dust with depth.') },
                { v: 'none', name: t('None'), desc: t('Maximum performance, no WebGL.') },
              ] as const
            ).map((o) => (
              <button type="button" aria-pressed={ambient === o.v} class={`fx ${ambient === o.v ? 'is-active' : ''}`} onClick={() => setAmbient(o.v)}>
                <span class={`fx__swatch fx__swatch--${o.v}`} />
                <strong>{o.name}</strong>
                <small>{o.desc}</small>
              </button>
            ))}
          </div>
        </Field>
        {submitErr && <Callout kind="error">{submitErr}</Callout>}
      </>
    );
  } else if (done) {
    title = t('All set!');
    lead = privateLink
      ? t('Open this private link on the TV, the Raspberry Pi or a tablet: it is this screen’s key, do not publish it. Changes in the admin show up on the screen instantly.')
      : t('Open this address on the TV, the Raspberry Pi or a tablet. Changes made in the panel show up on the display instantly.');
    const sumRows: [IconName, string, string][] = [
      ['monitor', t('Screen'), done.name],
      ['globe', t('Location'), place && !skipLoc ? `${place.name} · ${tz}` : tz],
      ['calendar', t('Calendars'), cals.length ? cals.map((c) => c.name).join(', ') : t('None (add them in Calendars)')],
      ['layout', t('Layout'), t(PRESETS.find((p) => p.id === preset)?.name ?? preset)],
      ['photos', t('Background photos'), photos === 'stock' ? t('Stock') : photos === 'gallery' ? t('My gallery') : t('Mixed')],
    ];
    content = (
      <>
        <div class="wz-done">
          <div class="wz-done__qr">
            <Qr text={displayUrl} label={privateLink ? t('QR code of the private link') : t('QR code of the display address')} />
            <span class="muted small">{t('Scan it with your phone')}</span>
          </div>
          <div class="wz-done__main">
            <Field
              label={privateLink ? t('Screen’s private link') : t('Display address')}
              hint={privateLink ? t('Another screen? Open {url} on it and pair it with the code it shows (Connected screens → Pair).', { url: `${origin}/` }) : undefined}
            >
              <CopyField value={displayUrl} />
            </Field>
            {isLocalhost && !lanIp && <Callout kind="warn">{t('You are on “localhost”: on other devices use this computer’s IP address (e.g. {url}).', { url: `http://192.168.1.50${portPart}/` })}</Callout>}
            <Field label={t('Admin panel')}>
              <CopyField value={adminUrl} />
            </Field>
          </div>
        </div>
        <ul class="wz-summary">
          {sumRows.map(([icon, k, v]) => (
            <li>
              <Icon name={icon} size={15} />
              <span class="muted">{k}</span>
              <strong>{v}</strong>
            </li>
          ))}
        </ul>
        <div class="wz-tips">
          <h3>{t('Tips')}</h3>
          <ul>
            <li>
              <Icon name="zap" size={14} />
              <span>
                {t('Raspberry Pi 3 or an old tablet? Add')} <code>?lite=1</code> {t('to the address (no WebGL effects).')}
              </span>
            </li>
            {photos !== 'stock' && (
              <li>
                <Icon name="photos" size={14} />
                <span>{t('Upload your photos in Gallery.')}</span>
              </li>
            )}
            {status.googleConfigured && (
              <li>
                <Icon name="google" size={14} />
                <span>{t('Link Google Calendar in Calendars → Google.')}</span>
              </li>
            )}
          </ul>
        </div>
      </>
    );
  }

  return (
    <div class="wizard" style={rootStyle}>
      <div class="login__bg" aria-hidden="true">
        <span class="blob blob--a" />
        <span class="blob blob--b" />
        <span class="blob blob--c" />
      </div>
      <header class="wz-top">
        <div class="wz-brand">
          <BrandMark size={36} />
          <span>Calendar</span>
        </div>
        <span class="wz-top__step">{t('Step {n} of {total}', { n: step + 1, total: STEPS.length })}</span>
      </header>
      {progress}
      <form class="wz-card" onSubmit={next} noValidate key={step}>
        <div class="wz-card__body" ref={bodyRef}>
          <div class="wz-head">
            <span class="wz-head__ico" aria-hidden="true">
              <Icon name={cur.icon} size={20} />
            </span>
            <div>
              <h2 tabIndex={-1}>{title}</h2>
              <p>{lead}</p>
            </div>
          </div>
          <div class="stack">{content}</div>
        </div>
        <footer class="wz-nav">
          {step > 0 && step < 5 ? (
            <Button icon="up" class="wz-back" onClick={back} disabled={busy}>
              {t('Back')}
            </Button>
          ) : (
            <span />
          )}
          {step < 4 && (
            <Button type="submit" variant="primary" loading={checking}>
              {t('Next')}
            </Button>
          )}
          {step === 4 && (
            <Button type="submit" variant="primary" icon="check" loading={busy}>
              {t('Finish setup')}
            </Button>
          )}
          {step === 5 && (
            <div class="wz-nav__end">
              <a class="btn btn--default" href={displayUrl} target="_blank" rel="noopener">
                <Icon name="external" size={16} />
                <span>{t('Open the display')}</span>
              </a>
              <Button variant="primary" icon="settings" onClick={onDone}>
                {t('Go to the panel')}
              </Button>
            </div>
          )}
        </footer>
      </form>
      <p class="wz-foot muted small">
        {t('Calendar v{v} · open source (MIT) · inspired by DAKboard, not affiliated with it', { v: status.version })}
      </p>
    </div>
  );
}
