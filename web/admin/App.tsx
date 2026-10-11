import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyScreen, defaultScreenOf, projectScreen } from '../shared/screens';
import type { AppConfig, AuthMeResponse, DisplayInfo, SetupStatus, StoredConfig } from '../shared/types';
import { api, ApiError } from './api';
import { BrandMark } from './components/BrandMark';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { choiceDialog, confirmDialog, DialogHost, toast, ToastHost } from './components/feedback';
import { saveWithRevision, type ConflictChoice } from './configMerge';
import { Icon, type IconName } from './components/icons';
import { ScreenSwitcher } from './components/ScreenSwitcher';
import { openPairDialog, PairDialogHost } from './components/DisplayAccess';
import { UpdateBanner, UpdateDialogHost, WhatsNewHost } from './components/Updates';
import { PrivacyBanner } from './components/Privacy';
import { FeedbackDialog } from './components/FeedbackDialog';
import { feedbackMeta } from './feedbackForm';
import { Button, setScopeScreenName } from './components/ui';
import { getLang, nScreens, t } from './i18n';
import { setIntent } from './intent';
import { Login } from './Login';
import { SetupWizard, takeSetupToken } from './Setup';
import { Preview } from './Preview';
import { SETTINGS_INDEX } from './searchIndex';
import { caps as currentCaps, has, hasFeature, loadCaps, type Caps } from './caps';
import { accountNav, filterActions, filterNav, filterSettings, NAV_ITEMS, type NavMeta } from './navFilter';
import { accountLinks, accountMode, authRedirect, homeAssistantMode, logoutRedirect } from './authRedirect';
import { ActivitySection } from './sections/Activity';
import { AlertsSection } from './sections/Alerts';
import { ApiSection } from './sections/Api';
import { BackgroundSection } from './sections/Background';
import { BackupsSection } from './sections/Backups';
import { BirthdaysSection } from './sections/Birthdays';
import { CalendarsSection } from './sections/Calendars';
import type { SectionProps } from './sections/common';
import { CountdownsSection } from './sections/Countdowns';
import { DateTimeSection } from './sections/DateTime';
import { DisplaysSection } from './sections/Displays';
import { FiltersSection } from './sections/Filters';
import { HomeSection } from './sections/Home';
import { HomeAssistantSection } from './sections/HomeAssistant';
import { IconRulesSection } from './sections/IconRules';
import { LayoutSection } from './sections/Layout';
import { LocalEventsSection } from './sections/LocalEvents';
import { MessageSection, NewsSection, TodoSection } from './sections/News';
import { PhotosSection } from './sections/Photos';
import { ScreenSection, SecuritySection } from './sections/Screen';
import { ScreensSection } from './sections/Screens';
import { StatusSection } from './sections/Status';
import { WeatherSection } from './sections/Weather';
import { UNAUTHORIZED_EVENT } from './api';
import { usesPrivateLinks, useScreenUrl } from './displayLinks';
import { withPollNote } from './liveNote';
import { clone, produce, sectionForError, sectionForServerPath, validateAll, type Errors } from './util';

interface NavItem extends NavMeta {
  comp: (p: SectionProps) => any;
}

const SECTIONS: Record<string, (p: SectionProps) => any> = {
  home: HomeSection,
  layout: LayoutSection,
  background: BackgroundSection,
  screen: ScreenSection,
  datetime: DateTimeSection,
  calendars: CalendarsSection,
  local: LocalEventsSection,
  birthdays: BirthdaysSection,
  filters: FiltersSection,
  icons: IconRulesSection,
  countdowns: CountdownsSection,
  weather: WeatherSection,
  news: NewsSection,
  todo: TodoSection,
  message: MessageSection,
  alerts: AlertsSection,
  photos: PhotosSection,
  homeassistant: HomeAssistantSection,
  api: ApiSection,
  screens: ScreensSection,
  displays: DisplaysSection,
  backups: BackupsSection,
  activity: ActivitySection,
  security: SecuritySection,
  status: StatusSection,
};

const NAV: NavItem[] = NAV_ITEMS.map((n) => ({ ...n, comp: SECTIONS[n.id] }));

/** The Account page (multi-tenant servers only) is its own chunk, so self-hosted installs never load it. */
type SectionComp = (p: SectionProps) => any;
let accountChunk: Promise<SectionComp> | null = null;
function AccountPage(p: SectionProps) {
  const [Comp, setComp] = useState<SectionComp | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    accountChunk ??= import('./sections/Account').then((m) => m.AccountSection);
    accountChunk.then(
      (c) => alive && setComp(() => c),
      () => {
        accountChunk = null;
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  if (Comp) return <Comp {...p} />;
  if (failed)
    return (
      <div class="boot__err">
        <Icon name="alert" size={28} />
        <h2>{t('Cannot reach the server')}</h2>
        <Button variant="primary" icon="refresh" onClick={() => location.reload()}>
          {t('Retry')}
        </Button>
      </div>
    );
  return <span class="spinner spinner--lg" />;
}

/** Path and hash of this page, the `next` the account login comes back to. */
const herePath = () => location.pathname + location.hash;

const parseHash = () => {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, anchor] = raw.split('/');
  return { id: NAV.some((n) => n.id === id) ? id : 'home', anchor: anchor || '' };
};

const LS_PREVIEW = 'calendar-admin.preview';
const LS_THEME = 'calendar-admin.theme';
const LS_SCREEN = 'calendar-admin.screen';
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Pick black/white text for a given background hex. */
function onColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111' : '#fff';
}

function oauthErrorMessage(code: string): string {
  const map: Record<string, string> = {
    email_not_allowed: 'This Google account is not allowed to sign in.',
    google_not_configured: 'Google is not configured on the server.',
    google_login_off: 'This server uses its password to sign in. Google is used for calendars.',
    login_required: 'Sign in first.',
    invalid_state: 'The Google session expired. Please try again.',
    missing_code: 'Google returned no authorization. Please try again.',
    no_refresh_token: 'Google did not grant offline access. Remove the app’s access in your Google account and link again.',
    calendar_scope_denied: 'Calendar read permission was not granted.',
    google_exchange_failed: 'Error talking to Google. Please try again.',
    google_access_denied: 'You cancelled Google access.',
  };
  if (code.startsWith('microsoft_')) return microsoftErrorMessage(code);
  return map[code] ? t(map[code]) : `${t('Google error')}: ${code}`;
}

/** Codes the Microsoft calendar connect (Marco Cloud, /auth/microsoft/callback) sends back, all prefixed microsoft_. */
function microsoftErrorMessage(code: string): string {
  const map: Record<string, string> = {
    microsoft_not_configured: 'Microsoft calendars are not available for this account.',
    microsoft_invalid_state: 'The Microsoft session expired. Try again.',
    microsoft_missing_code: 'Microsoft did not return an authorization. Try again.',
    microsoft_no_refresh_token: 'Microsoft did not grant lasting access. Link the account again.',
    microsoft_scope_denied: 'Calendar read permission was not granted.',
    microsoft_no_email: 'Could not get the email of the Microsoft account.',
    microsoft_too_many_accounts: 'You have reached the most Microsoft accounts you can link.',
    microsoft_exchange_failed: 'Could not talk to Microsoft. Try again.',
    microsoft_temporarily_unavailable: 'Microsoft is not answering right now. Try again in a few minutes.',
    microsoft_access_denied: 'You cancelled access with Microsoft.',
    microsoft_consent_required: 'Your organization has to approve Marco before you can link this account.',
  };
  return map[code] ? t(map[code]) : `${t('Microsoft error')}: ${code.slice('microsoft_'.length)}`;
}

/** Scroll to an element id and flash it (palette / deep links). */
function flashAnchor(id: string, tries = 12) {
  const el = document.getElementById(id);
  if (!el) {
    if (tries > 0) setTimeout(() => flashAnchor(id, tries - 1), 80);
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1800);
}

export function App() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const homeAssistant = homeAssistantMode(me);
  const [caps, setCapsState] = useState<Caps>(() => currentCaps());
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [bootErr, setBootErr] = useState('');
  const [loginErr, setLoginErr] = useState<string | undefined>();
  const [saved, setSaved] = useState<StoredConfig | null>(null);
  const [draft, setDraft] = useState<StoredConfig | null>(null);
  const [screenIdRaw, setScreenIdRaw] = useState<string>(() => lsGet(LS_SCREEN) || '');
  const [route, setRoute] = useState(() => parseHash().id);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(1);
  const [showPreview, setShowPreview] = useState(() => lsGet(LS_PREVIEW) !== '0');
  const [sheet, setSheet] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [adminTheme, setAdminTheme] = useState(() => lsGet(LS_THEME) || '');
  const [showErrors, setShowErrors] = useState(false);
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);
  const wide = useMedia('(min-width: 1360px)');
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (adminTheme) document.documentElement.dataset.theme = adminTheme;
    else delete document.documentElement.dataset.theme;
    lsSet(LS_THEME, adminTheme);
  }, [adminTheme]);

  /* ---------- boot & auth */
  const loadMe = useCallback(async () => {
    try {
      // Capabilities and the session in parallel; a server without /api/health keeps every feature on.
      const [c, m] = await Promise.all([loadCaps(api.health), api.me()]);
      setCapsState(c);
      if (!homeAssistantMode(m) && m.needsSetup && hasFeature(c, 'setupWizard')) {
        // Fresh install: the wizard replaces the login.
        const st = await api.setupStatus();
        if (st.needsSetup) {
          setSetup(st);
        }
      } else setSetup(null);
      setMe(m);
      setBootErr('');
      return m;
    } catch (e) {
      setBootErr((e as ApiError).message === 'network' ? t('Cannot reach the server') : (e as ApiError).message);
      return null;
    }
  }, []);

  const loadConfig = useCallback(async (keepDraft = false) => {
    try {
      const c = await api.getConfig();
      if (!c || !Array.isArray((c as StoredConfig).screens)) throw new ApiError(500, t('The server returned an old config format. Update the server.'));
      setSaved(c);
      setDraft((d) => (keepDraft && d ? d : c));
    } catch (e) {
      if ((e as ApiError).status !== 401) setBootErr((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    takeSetupToken(); // keeps ?setup=<token> for the wizard (this tab only) and removes it from the address bar
    // OAuth redirects may come back with ?error=… or ?google=connected
    const qs = new URLSearchParams(location.search);
    const err = qs.get('error');
    const g = qs.get('connected') || qs.get('google');
    const ms = qs.get('microsoft');
    const errMsg = err ? oauthErrorMessage(err) : '';
    if (g) setTimeout(() => toast(`${t('Google account linked')}: ${g}`, 'ok'), 400);
    if (ms) setTimeout(() => toast(`${t('Microsoft account linked')}: ${ms}`, 'ok'), 400);
    if (err || g || ms) history.replaceState(null, '', location.pathname + location.hash);
    loadMe().then((m) => {
      if (m?.user) {
        loadConfig();
        if (errMsg) setTimeout(() => toast(errMsg, 'error'), 400);
      } else if (errMsg) setLoginErr(errMsg);
    });
  }, []);

  const meRef = useRef(me);
  meRef.current = me;
  /** Set right before the page leaves on purpose (logout, account login), so "unsaved changes" does not ask again. */
  const leavingRef = useRef(false);

  /* ---------- account mode (Marco Cloud): signing in happens on the account pages */
  useEffect(() => {
    if (!me || me.user || setup) return;
    const url = authRedirect(me, caps, herePath());
    if (url) {
      leavingRef.current = true;
      location.assign(url);
    }
  }, [me, caps, setup]);

  useEffect(() => {
    const on = () => {
      const url = authRedirect(meRef.current, currentCaps(), herePath());
      if (url) {
        location.assign(url);
        return;
      }
      setMe((m) => (m ? { ...m, user: null } : m));
      setLoginErr(homeAssistantMode(meRef.current) ? t('Sign in to Home Assistant and reopen Marco.') : t('Your session expired. Please sign in again.'));
      loadMe();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);

  /* ---------- connected displays (for the switcher / nav badge); the Displays page polls on its own */
  const loggedIn = !!me?.user && !!draft;
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    const load = () =>
      api
        .displays()
        .then((r) => alive && setDisplays(r.displays))
        .catch(() => alive && setDisplays((d) => d ?? []));
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loggedIn]);

  /* ---------- pairing deep link: the QR on a waiting display opens /admin/#pair=<code> */
  useEffect(() => {
    const take = () => {
      if (homeAssistantMode(meRef.current)) return false;
      const m = /^#\/?pair=([A-Za-z0-9 -]{1,12})/.exec(location.hash);
      if (!m) return false;
      history.replaceState(null, '', `${location.pathname}${location.search}#/displays`);
      setRoute('displays');
      openPairDialog(m[1]);
      return true;
    };
    take();
    const on = () => void take();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  /* ---------- routing */
  useEffect(() => {
    const on = () => {
      const h = parseHash();
      setRoute(h.id);
      setNavOpen(false);
      if (h.anchor) flashAnchor(h.anchor);
      else {
        mainRef.current?.scrollTo({ top: 0 });
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('hashchange', on);
    const h = parseHash();
    if (h.anchor) flashAnchor(h.anchor);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((r: string) => {
    const target = `#/${r}`;
    if (location.hash === target) {
      const h = parseHash();
      if (h.anchor) flashAnchor(h.anchor);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } else location.hash = target;
  }, []);

  /* ---------- selected screen */
  const screenId = useMemo(() => {
    if (!draft) return screenIdRaw;
    return draft.screens.some((s) => s.id === screenIdRaw) ? screenIdRaw : defaultScreenOf(draft).id;
  }, [draft, screenIdRaw]);
  const screenIdRef = useRef(screenId);
  screenIdRef.current = screenId;
  const setScreenId = useCallback((id: string) => {
    setScreenIdRaw(id);
    lsSet(LS_SCREEN, id);
  }, []);

  const view = useMemo(() => (draft ? projectScreen(draft, screenId) : null), [draft, screenId]);
  const curScreen = draft?.screens.find((s) => s.id === screenId) ?? (draft ? defaultScreenOf(draft) : null);
  setScopeScreenName(curScreen?.name ?? '');
  // Preview and "view" links use the SAVED slug: the draft one changes on every keystroke and the server
  // doesn't know it until saved (null = screen not saved yet).
  const savedSlug = (curScreen && saved?.screens.find((s) => s.id === curScreen.id)?.slug) || null;
  // Private link on the display origin (Marco Cloud, self-hosted private mode) or /?screen=<slug> (open mode).
  const previewUrl = useScreenUrl(saved, savedSlug ? curScreen?.id : null, { preview: true });
  const viewUrl = useScreenUrl(saved, savedSlug ? curScreen?.id : null);

  /* ---------- draft state */
  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const allErrors = useMemo(() => (draft ? validateAll(draft, caps) : { global: {}, screens: {}, total: 0 }), [draft, caps]);
  const errors: Errors = useMemo(() => ({ ...allErrors.global, ...(allErrors.screens[screenId] ?? {}) }), [allErrors, screenId]);
  const errorKeys = Object.keys(errors);
  const visibleErrors = showErrors || dirty ? errors : {};
  const errorScreens = useMemo(() => new Set(Object.entries(allErrors.screens).filter(([, e]) => Object.keys(e).length).map(([id]) => id)), [allErrors]);

  const set = useCallback((fn: (d: AppConfig) => void) => setDraft((f) => (f ? applyScreen(f, produce(projectScreen(f, screenIdRef.current), fn)) : f)), []);
  const setFull = useCallback((fn: (d: StoredConfig) => void) => setDraft((f) => (f ? produce(f, fn) : f)), []);
  const replaceConfig = useCallback((c: StoredConfig) => {
    setSaved(c);
    setDraft(clone(c));
    setShowErrors(false);
    setPreviewKey((k) => k + 1);
  }, []);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  /** Jump to the first error: switch screen if needed, then route + anchor. */
  const revealError = useCallback((all: ReturnType<typeof validateAll>) => {
    const d = draftRef.current!;
    const g = Object.keys(all.global);
    const cur = Object.keys(all.screens[screenIdRef.current] ?? {});
    let key = cur[0] ?? g[0];
    if (!key) {
      const other = d.screens.find((s) => Object.keys(all.screens[s.id] ?? {}).length);
      if (other) {
        setScreenId(other.id);
        key = Object.keys(all.screens[other.id])[0];
        toast(t('Error in screen {name}', { name: other.name }), 'error');
      }
    }
    if (key) {
      const sec = sectionForError(key);
      if (sec !== parseHash().id) location.hash = `#/${sec}`;
    }
  }, []);

  /** After a 409: the config was saved elsewhere (another tab or device, or the server itself after a Google sign-in). */
  const askConflict = (): Promise<ConflictChoice> =>
    choiceDialog<'reload' | 'overwrite'>({
      title: t('The settings changed while you were editing'),
      body: (
        <>
          <p>{t('They were saved from another tab or device.')}</p>
          <p>{t('You can load the saved version (and lose what you changed here) or save your changes on top of it. Anything you did not touch stays as it is in the saved version.')}</p>
        </>
      ),
      cancel: t('Keep editing'),
      choices: [
        { value: 'reload', label: t('Load the saved version'), kind: 'ghost' },
        { value: 'overwrite', label: t('Save my changes'), kind: 'primary' },
      ],
    });

  const save = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (!d) return false;
    const all = validateAll(d);
    if (all.total) {
      setShowErrors(true);
      toast(t('Check the highlighted fields ({n})', { n: all.total }), 'error');
      revealError(all);
      return false;
    }
    setSaving(true);
    let cur = d;
    try {
      const out = await saveWithRevision({
        draft: d,
        base: savedRef.current ?? d,
        put: (body) => api.saveConfig(body),
        get: () => api.getConfig(),
        choose: askConflict,
        isConflict: (e) => e instanceof ApiError && e.status === 409 && e.code === 'conflict',
        merged: (m, theirs) => {
          cur = m;
          setSaved(theirs);
          setDraft(m);
        },
      });
      if (out.status === 'cancelled') return false;
      setSaved(out.config);
      setDraft(out.config);
      setShowErrors(false);
      setPreviewKey((k) => k + 1);
      toast(out.status === 'saved' ? t('Changes saved · the screen will update by itself') : t('Loaded the saved version'), out.status === 'saved' ? 'ok' : 'info');
      return out.status === 'saved';
    } catch (e) {
      const ae = e as ApiError;
      const details = (ae.body as any)?.details as { path: string; message: string }[] | undefined;
      if (ae.status === 400 && details?.length) {
        const first = sectionForServerPath(details[0].path);
        if (first.screenIndex != null) {
          const scr = cur.screens[first.screenIndex];
          if (scr && scr.id !== screenIdRef.current) {
            setScreenId(scr.id);
            toast(t('Error in screen {name}', { name: scr.name }), 'error');
          }
        }
        if (first.section !== parseHash().id) location.hash = `#/${first.section}`;
      }
      if (ae.status !== 401) toast(`${t('Could not save')}: ${ae.message === 'network' ? t('server unavailable') : ae.message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const discard = async () => {
    const ok = await confirmDialog({ title: t('Discard changes?'), body: t('Your unsaved changes will be lost.'), confirm: t('Discard'), danger: true });
    if (ok && saved) {
      setDraft(saved);
      setShowErrors(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      } else if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault();
        // drop focus now so keystrokes typed before the palette renders never land in a form field
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (loggedIn) setPalette((p) => !p);
      } else if (k === '/' && !e.ctrlKey && !e.metaKey && loggedIn) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !(e.target as HTMLElement)?.isContentEditable) {
          e.preventDefault();
          setPalette(true);
        }
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty && !leavingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty, saving, save, loggedIn]);

  const refreshDisplays = async (screens?: string[]) => {
    try {
      await api.refreshDisplays(screens);
      toast(withPollNote(t('Screens reloading…')), 'info');
      setPreviewKey((k) => k + 1);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const displayCommand = async (action: 'identify' | 'night', mode?: 'on' | 'off' | 'auto') => {
    try {
      const r = await api.displayCommand({ action, mode });
      const label = action === 'identify' ? t('Identifying screens') : mode === 'on' ? t('Night mode on') : mode === 'off' ? t('Night mode off') : t('Automatic night mode');
      toast(r.delivered ? withPollNote(`${label} · ${nScreens(r.delivered)}`) : `${label} · ${nScreens(r.delivered)}`, r.delivered ? 'ok' : 'info');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const logout = async () => {
    if (dirty) {
      const ok = await confirmDialog({ title: t('Leave without saving?'), body: t('You have unsaved changes.'), confirm: t('Leave'), danger: true });
      if (!ok) return;
    }
    let res: unknown = null;
    try {
      res = await api.logout();
    } catch {
      /* ignore */
    }
    const dest = logoutRedirect(me, caps, res);
    if (dest) {
      setMenuOpen(false);
      leavingRef.current = true;
      location.assign(dest);
      return;
    }
    setSaved(null);
    setDraft(null);
    setLoginErr(undefined);
    setMenuOpen(false);
    loadMe();
  };

  /* ---------- pages the server offers (features in /api/health) */
  const nav = useMemo(
    () => accountNav(filterNav(NAV, caps), caps).map((n) => (n.id === 'security' && caps.tenancy === 'multi' ? { ...n, comp: AccountPage } : n)),
    [caps]
  );

  /* ---------- command palette items */
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (!draft) return [];
    const items: PaletteItem[] = [];
    const gPages = t('Pages');
    const gActions = t('Actions');
    const gScreens = t('Screens');
    const gSettings = t('Settings');
    const pageLabel = (id: string) => t(nav.find((n) => n.id === id)?.label ?? id);
    const run = (r: string, intent?: string) => () => {
      if (intent) setIntent(r.split('/')[0], intent);
      go(r);
    };
    const actions: PaletteItem[] = [
      { id: 'a-announce', group: gActions, icon: 'megaphone', label: t('Send alert'), run: run('alerts/al-send', 'focus') },
      { id: 'a-refresh', group: gActions, icon: 'refresh', label: t('Refresh displays'), run: () => refreshDisplays() },
      { id: 'a-night-on', group: gActions, icon: 'moon', label: t('Night mode now'), run: () => displayCommand('night', 'on') },
      { id: 'a-night-off', group: gActions, icon: 'sun', label: t('Night mode off'), run: () => displayCommand('night', 'off') },
      { id: 'a-night-auto', group: gActions, icon: 'clock', label: t('Automatic night mode'), run: () => displayCommand('night', 'auto') },
      { id: 'a-pair', group: gActions, icon: 'link', label: t('Pair a screen'), run: () => openPairDialog() },
      { id: 'a-identify', group: gActions, icon: 'target', label: t('Identify screens'), run: () => displayCommand('identify') },
      { id: 'a-new-screen', group: gActions, icon: 'plus', label: t('New screen'), run: run('screens', 'new') },
      { id: 'a-new-bday', group: gActions, icon: 'cake', label: t('Add birthday'), run: run('birthdays', 'add') },
      { id: 'a-new-event', group: gActions, icon: 'plus', label: t('New local event'), run: run('local', 'add') },
      { id: 'a-new-countdown', group: gActions, icon: 'hourglass', label: t('New countdown'), run: run('countdowns', 'add') },
      { id: 'a-new-rule', group: gActions, icon: 'filter', label: t('New filter rule'), run: run('filters', 'add') },
      { id: 'a-export', group: gActions, icon: 'download', label: t('Export backup'), run: run('backups/bk-export', 'export') },
      { id: 'a-backup', group: gActions, icon: 'archive', label: t('Create a backup now'), run: run('backups/bk-auto', 'backup') },
      { id: 'a-token', group: gActions, icon: 'key', label: t('Create API token'), run: run('api/api-tokens', 'new') },
      { id: 'a-view', group: gActions, icon: 'external', label: t('View screen'), hint: curScreen?.name, run: () => viewUrl && window.open(viewUrl, '_blank', 'noopener') },
      { id: 'a-theme', group: gActions, icon: 'moon', label: t('Change panel theme'), run: () => setAdminTheme((x) => (x === 'dark' ? 'light' : x === 'light' ? '' : 'dark')) },
      { id: 'a-feedback', group: gActions, icon: 'help', label: t('Help and feedback'), run: () => setFeedbackOpen(true) },
    ];
    items.push(...filterActions(actions, caps).filter((a) => !homeAssistant || a.id !== 'a-pair'));
    if (dirty) items.unshift({ id: 'a-save', group: gActions, icon: 'check', label: t('Save changes'), run: () => save() });
    for (const s of draft.screens) {
      items.push({
        id: `s-${s.id}`,
        group: gScreens,
        icon: 'monitor',
        label: t('Switch to screen {name}', { name: s.name }),
        hint: s.id === screenId ? t('editing') : usesPrivateLinks(saved) ? undefined : `?screen=${s.slug}`,
        keywords: `${s.name} ${s.slug} screen switch`,
        run: () => {
          setScreenId(s.id);
          toast(t('Editing: {name}', { name: s.name }), 'info', 1800);
        },
      });
    }
    for (const n of nav) items.push({ id: `p-${n.id}`, group: gPages, icon: n.icon, label: t(n.label), hint: n.group ? t(n.group) : undefined, keywords: n.keywords, run: run(n.id) });
    filterSettings(SETTINGS_INDEX, caps, nav.map((n) => n.id)).forEach((s) =>
      items.push({ id: `k-${SETTINGS_INDEX.indexOf(s)}`, group: gSettings, icon: nav.find((n) => n.id === s.route)?.icon ?? 'settings', label: t(s.label), hint: pageLabel(s.route), keywords: s.keywords, run: run(s.anchor ? `${s.route}/${s.anchor}` : s.route) })
    );
    // individual items: birthdays, local events, rules
    for (const b of draft.birthdays.items) items.push({ id: `b-${b.id}`, group: t('Birthdays'), emoji: b.emoji || draft.birthdays.emoji || '🎂', label: b.name, hint: `${String(b.day).padStart(2, '0')}/${String(b.month).padStart(2, '0')}`, run: run('birthdays') });
    for (const e of draft.localEvents.items) items.push({ id: `l-${e.id}`, group: t('Local events'), emoji: e.emoji || '📅', label: e.title, hint: e.date, run: run('local') });
    return items;
  }, [draft, saved, screenId, dirty, savedSlug, viewUrl, nav, caps, homeAssistant]);

  /* ---------- render */
  const accent = view?.screen.accent && /^#[0-9a-f]{6}$/i.test(view.screen.accent) ? view.screen.accent : '#ff5a4e';
  const rootStyle = { '--accent': accent, '--on-accent': onColor(accent) } as any;

  if (!me) {
    return (
      <div class="boot" style={rootStyle}>
        {bootErr ? (
          <div class="boot__err">
            <Icon name="alert" size={28} />
            <h2>{bootErr}</h2>
            <Button variant="primary" icon="refresh" onClick={() => loadMe().then((m) => m?.user && loadConfig())}>
              {t('Retry')}
            </Button>
          </div>
        ) : (
          <span class="spinner spinner--lg" />
        )}
        <ToastHost />
      </div>
    );
  }

  if (!homeAssistant && setup && me.needsSetup) {
    return (
      <div style={rootStyle}>
        <SetupWizard
          status={setup}
          onDone={async () => {
            setSetup(null);
            const m = await loadMe();
            if (m?.user) loadConfig();
          }}
        />
        <ToastHost />
      </div>
    );
  }

  if (!me.user && accountMode(me, caps)) {
    // the effect above is sending the browser to the account login
    return (
      <div class="boot" style={rootStyle}>
        <span class="spinner spinner--lg" />
        <ToastHost />
      </div>
    );
  }

  if (!me.user) {
    if (homeAssistant) {
      return (
        <div class="boot" style={rootStyle}>
          <div class="boot__err">
            <Icon name="shield" size={28} />
            <h2>{t('Sign in to Home Assistant and reopen Marco.')}</h2>
          </div>
          <ToastHost />
        </div>
      );
    }
    return (
      <div style={rootStyle}>
        <Login
          me={me}
          initialError={loginErr}
          onDone={async () => {
            const m = await loadMe();
            if (m?.user) loadConfig(true);
          }}
        />
        <ToastHost />
      </div>
    );
  }

  if (!draft || !saved || !view || !curScreen) {
    return (
      <div class="boot" style={rootStyle}>
        {bootErr ? (
          <div class="boot__err">
            <Icon name="alert" size={28} />
            <h2>{bootErr}</h2>
            <Button variant="primary" icon="refresh" onClick={() => loadConfig()}>
              {t('Retry')}
            </Button>
          </div>
        ) : (
          <span class="spinner spinner--lg" />
        )}
        <ToastHost />
      </div>
    );
  }

  const current = nav.find((n) => n.id === route) ?? nav[0];
  const Section = current.comp;
  const groups = [...new Set(nav.map((n) => n.group))];
  const liveCommands = has('displayCommands');
  const errCountBySection: Record<string, number> = {};
  if (showErrors || dirty) for (const k of errorKeys) errCountBySection[sectionForError(k)] = (errCountBySection[sectionForError(k)] ?? 0) + 1;
  const user = me.user;
  const household = me.account?.household ?? null;
  const links = has('accountMenu') ? accountLinks(me) : null;
  const feedback = hasFeature(caps, 'feedback');
  const accountPage = caps.tenancy === 'multi';
  const portrait = view.screen.orientation === 'portrait';
  const previewSide = wide && showPreview;
  const online: Record<string, number> = {};
  for (const d of displays ?? []) if (d.connected) online[d.screenId] = (online[d.screenId] ?? 0) + 1;
  const onlineTotal = Object.values(online).reduce((a, b) => a + b, 0);
  const multi = draft.screens.length > 1;

  const sectionProps: SectionProps = {
    cfg: view,
    set,
    errors: visibleErrors,
    me,
    save,
    dirty,
    full: draft,
    setFull,
    saved,
    replaceConfig,
    screenId,
    setScreenId,
    go,
    reloadPreview: () => setPreviewKey((k) => k + 1),
    updateMe: setMe,
  };

  return (
    <div class={`shell ${previewSide ? 'has-preview' : ''} ${navOpen ? 'nav-open' : ''}`} style={rootStyle}>
      <aside class="sidebar">
        <div class="brand">
          <BrandMark size={34} />
          <div>
            <strong class="wordmark" aria-label="Marco">marco</strong>
            <span class="muted small">{t('Control panel')}</span>
          </div>
        </div>
        <button type="button" class="nav-search" onClick={() => setPalette(true)}>
          <Icon name="search" size={15} />
          <span>{t('Search…')}</span>
          <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <nav class="nav">
          {groups.map((g) => (
            <div class="nav__group">
              {g && (
                <div class="nav__title">
                  {t(g)}
                  {g === 'Screen' && multi && <span class="nav__title-scr">· {curScreen.name}</span>}
                </div>
              )}
              {nav.filter((n) => n.group === g).map((n) => {
                const en = n.enabled?.(view);
                const ec = errCountBySection[n.id];
                const badge = n.id === 'displays' && displays ? onlineTotal : null;
                return (
                  <a href={`#/${n.id}`} class={`nav__item ${route === n.id ? 'is-active' : ''}`} aria-current={route === n.id ? 'page' : undefined}>
                    <Icon name={n.icon} size={18} />
                    <span>{t(n.label)}</span>
                    {ec ? (
                      <span class="nav__err">{ec}</span>
                    ) : badge != null ? (
                      <span class={`nav__count ${badge ? 'is-on' : ''}`} title={t('{n} connected', { n: badge })}>
                        {badge}
                      </span>
                    ) : (
                      en !== undefined && <span class={`nav__dot ${en ? 'is-on' : ''}`} title={en ? t('Enabled') : t('Disabled')} />
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div class="sidebar__foot">
          <div class="sidebar__tools">
            <button
              type="button"
              class="icon-btn"
              title={t('Panel theme')}
              onClick={() => setAdminTheme(adminTheme === 'dark' ? 'light' : adminTheme === 'light' ? '' : 'dark')}
            >
              <Icon name={adminTheme === 'light' ? 'sun' : adminTheme === 'dark' ? 'moon' : 'monitor'} size={16} />
            </button>
            {feedback && (
              <button type="button" class="icon-btn" title={t('Help and feedback')} aria-label={t('Help and feedback')} onClick={() => (setNavOpen(false), setFeedbackOpen(true))}>
                <Icon name="help" size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div class="scrim" onClick={() => setNavOpen(false)} />

      <div class="main-col">
        <header class="topbar">
          <button type="button" class="icon-btn topbar__menu" onClick={() => setNavOpen(true)} aria-label={t('Menu')}>
            <Icon name="menu" size={20} />
          </button>
          <div class="topbar__crumb">
            {current.group && (
              <>
                <span class="muted hide-md">{t(current.group)}</span>
                <Icon name="down" size={12} class="crumb-sep hide-md" />
              </>
            )}
            <strong>{t(current.label)}</strong>
          </div>
          <ScreenSwitcher
            screens={draft.screens}
            defaultId={draft.defaultScreen}
            value={screenId}
            onChange={(id) => setScreenId(id)}
            onManage={() => go('screens')}
            onNew={() => {
              setIntent('screens', 'new');
              go('screens');
            }}
            emphasize={!!current.perScreen && multi}
            errorScreens={showErrors || dirty ? errorScreens : undefined}
            online={online}
            openMode={saved?.security?.displayAccess === 'open'}
          />
          <div class="topbar__actions">
            <button type="button" class="icon-btn topbar__search" title={`${t('Search')} (Ctrl K)`} aria-label={t('Search')} onClick={() => setPalette(true)}>
              <Icon name="search" size={18} />
            </button>
            <a class="btn btn--ghost hide-sm hide-lg" href={viewUrl ?? undefined} target="_blank" rel="noopener" title={t('View screen')}>
              <Icon name="external" size={16} />
              <span>{t('View screen')}</span>
            </a>
            {liveCommands && (
              <Button variant="ghost" icon="refresh" class="hide-sm hide-lg" onClick={() => refreshDisplays()}>
                {t('Refresh displays')}
              </Button>
            )}
            <button
              type="button"
              class={`icon-btn ${previewSide || sheet ? 'is-active' : ''}`}
              title={t('Preview')}
              onClick={() => {
                if (wide) {
                  setShowPreview(!showPreview);
                  lsSet(LS_PREVIEW, showPreview ? '0' : '1');
                } else setSheet(true);
              }}
            >
              <Icon name="eye" size={18} />
            </button>
            <div class="menu-wrap">
              <button type="button" class="avatar-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label={t('Account')}>
                {user.picture ? <img class="avatar" src={user.picture} alt="" referrerpolicy="no-referrer" /> : <span class="avatar avatar--letter">{(user.name || user.email || 'A')[0].toUpperCase()}</span>}
              </button>
              {menuOpen && (
                <>
                  <div class="menu-scrim" onClick={() => setMenuOpen(false)} />
                  <div class="menu">
                    <div class="menu__who">
                      <strong>{user.name || t('Administrator')}</strong>
                      {user.email && user.email !== user.name && <span class="muted small">{user.email}</span>}
                      {household && (
                        <span class="menu__household muted small">
                          <Icon name="home" size={13} />
                          <span>
                            {household.name} · {household.role === 'owner' ? t('Owner') : t('Member')}
                          </span>
                        </span>
                      )}
                    </div>
                    <a class="menu__item show-lg" href={viewUrl ?? undefined} target="_blank" rel="noopener" onClick={() => setMenuOpen(false)}>
                      <Icon name="external" size={16} /> {t('View screen')} · {curScreen.name}
                    </a>
                    {liveCommands && (
                      <button
                        type="button"
                        class="menu__item show-lg"
                        onClick={() => {
                          setMenuOpen(false);
                          refreshDisplays();
                        }}
                      >
                        <Icon name="refresh" size={16} /> {t('Refresh displays')}
                      </button>
                    )}
                    <a class="menu__item" href="#/displays" onClick={() => setMenuOpen(false)}>
                      <Icon name="wifi" size={16} /> {t('Connected screens')}
                    </a>
                    {feedback && (
                      <button
                        type="button"
                        class="menu__item"
                        onClick={() => {
                          setMenuOpen(false);
                          setFeedbackOpen(true);
                        }}
                      >
                        <Icon name="help" size={16} /> {t('Help and feedback')}
                      </button>
                    )}
                    {links ? (
                      <>
                        {(accountPage || links.account) && (
                          <a class="menu__item" href={accountPage ? '#/security' : links.account!} onClick={() => setMenuOpen(false)}>
                            <Icon name="user" size={16} /> {t('Account')}
                          </a>
                        )}
                        {links.sessions && (
                          <a class="menu__item" href={links.sessions} onClick={() => setMenuOpen(false)}>
                            <Icon name="shield" size={16} /> {t('Open sessions')}
                          </a>
                        )}
                        {links.remove && (
                          <a class="menu__item menu__item--danger" href={links.remove} onClick={() => setMenuOpen(false)}>
                            <Icon name="trash" size={16} /> {t('Delete account')}
                          </a>
                        )}
                      </>
                    ) : (
                      <a class="menu__item" href="#/security" onClick={() => setMenuOpen(false)}>
                        <Icon name={accountPage ? 'user' : 'shield'} size={16} /> {t(accountPage ? 'Account' : 'Security')}
                      </a>
                    )}
                    {!homeAssistant && (
                      <button type="button" class="menu__item menu__item--danger" onClick={logout}>
                        <Icon name="logout" size={16} /> {t('Sign out')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <UpdateBanner />
        <PrivacyBanner tz={saved.datetime.timezone} go={go} />
        <div class="content-row">
          <main class={`content content--${route}`} ref={mainRef} key={`${route}`}>
            <Section {...sectionProps} />
          </main>
          {previewSide && (
            <aside class="preview-col">
              <Preview variant="side" saved={savedSlug != null} url={previewUrl} openUrl={viewUrl} screenName={multi ? curScreen.name : ''} reloadKey={previewKey} portrait={portrait} onClose={() => (setShowPreview(false), lsSet(LS_PREVIEW, '0'))} />
            </aside>
          )}
        </div>

        <div class={`savebar ${dirty || saving ? 'is-visible' : ''}`} role="region" aria-label={t('Unsaved changes')}>
          <div class="savebar__inner">
            <span class="savebar__status">
              <span class="pulse-dot" />
              <span>{t('Unsaved changes')}</span>
              {allErrors.total > 0 && (
                <button type="button" class="savebar__errs" onClick={() => (revealError(allErrors), setShowErrors(true))}>
                  <Icon name="alert" size={13} /> {allErrors.total === 1 ? t('1 error') : t('{n} errors', { n: allErrors.total })}
                </button>
              )}
            </span>
            <span class="savebar__kbd hide-sm">Ctrl S</span>
            <Button variant="ghost" onClick={discard} disabled={saving}>
              {t('Discard')}
            </Button>
            <Button variant="primary" icon="check" loading={saving} onClick={() => save()}>
              {t('Save')}
            </Button>
          </div>
        </div>
      </div>

      {sheet && !previewSide && (
        <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div class="sheet">
            <Preview variant="sheet" saved={savedSlug != null} url={previewUrl} openUrl={viewUrl} screenName={multi ? curScreen.name : ''} reloadKey={previewKey} portrait={portrait} onClose={() => setSheet(false)} />
          </div>
        </div>
      )}
      {palette && <CommandPalette items={paletteItems} onClose={() => setPalette(false)} />}
      {!homeAssistant && <PairDialogHost saved={saved} defaultScreenId={screenId} onPaired={() => window.dispatchEvent(new Event('marco:paired'))} />}
      <UpdateDialogHost />
      <WhatsNewHost />
      {feedbackOpen && feedback && (
        <FeedbackDialog
          email={user.email}
          meta={feedbackMeta({
            version: caps.version,
            page: route,
            screens: draft.screens.length,
            userAgent: navigator.userAgent,
            lang: getLang(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
      <ToastHost />
      <DialogHost />
    </div>
  );
}
