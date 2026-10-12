import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyScreen, defaultScreenOf, projectScreen } from '../shared/screens';
import { appUrl } from '../shared/path';
import type { AppConfig, AuthMeResponse, StoredConfig } from '../shared/types';
import { api, ApiError, UNAUTHORIZED_EVENT } from './api';
import { loadCaps, type Caps } from './caps';
import { choiceDialog, confirmDialog, DialogHost, toast, ToastHost } from './components/feedback';
import { Icon } from './components/icons';
import { Button } from './components/ui';
import { saveWithRevision, type ConflictChoice } from './configMerge';
import { t } from './i18n';
import { filterNav, NAV_ITEMS, routeFor } from './navFilter';
import { SettingsDialog } from './SettingsDialog';
import { BackgroundSection } from './sections/Background';
import { CalendarsSection } from './sections/Calendars';
import type { SectionProps } from './sections/common';
import { LayoutSection } from './sections/Layout';
import { PhotosSection } from './sections/Photos';
import { WeatherSection } from './sections/Weather';
import { clone, produce, sectionForError, sectionForServerPath, validateAll, type Errors } from './util';

const SECTIONS = {
  calendars: CalendarsSection,
  layout: LayoutSection,
  background: BackgroundSection,
  weather: WeatherSection,
  photos: PhotosSection,
};

const requestedRoute = () => location.hash.replace(/^#\/?/, '').split('/')[0];

export function App() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [saved, setSaved] = useState<StoredConfig | null>(null);
  const [draft, setDraft] = useState<StoredConfig | null>(null);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(requestedRoute);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [displayKey, setDisplayKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(() => !!requestedRoute());

  const load = useCallback(async () => {
    try {
      const [capabilities, session] = await Promise.all([loadCaps(api.health), api.me()]);
      setCaps(capabilities);
      setMe(session);
      if (!session.user) {
        setError(t('Sign in to Home Assistant and reopen Calendar.'));
        return;
      }
      const config = await api.getConfig();
      if (!config || !Array.isArray(config.screens) || !config.screens.length) throw new Error(t('The server returned an invalid configuration.'));
      setSaved((current) => current ?? config);
      setDraft((current) => current ?? config);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'network' ? t('Cannot reach the server') : (err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const unauthorized = () => {
      setMe((current) => current ? { ...current, user: null } : current);
      setError(t('Sign in to Home Assistant and reopen Calendar.'));
    };
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized);
  }, [load]);

  useEffect(() => {
    const changed = () => {
      setRoute(requestedRoute());
      if (requestedRoute()) setSettingsOpen(true);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  const nav = useMemo(() => caps ? filterNav(NAV_ITEMS, caps) : NAV_ITEMS, [caps]);
  const currentRoute = routeFor(route, nav) as keyof typeof SECTIONS;
  const go = useCallback((target: string) => {
    setSettingsOpen(true);
    location.hash = `#/${routeFor(target.split('/')[0], NAV_ITEMS)}`;
  }, []);
  const screenId = draft ? defaultScreenOf(draft).id : '';
  const view = useMemo(() => draft ? projectScreen(draft, screenId) : null, [draft, screenId]);
  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const allErrors = useMemo(() => draft ? validateAll(draft, caps ?? undefined) : { global: {}, screens: {}, total: 0 }, [draft, caps]);
  const errors: Errors = { ...allErrors.global, ...(allErrors.screens[screenId] ?? {}) };
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  draftRef.current = draft;
  savedRef.current = saved;

  const set = useCallback((change: (config: AppConfig) => void) => {
    setDraft((current) => current ? applyScreen(current, produce(projectScreen(current, defaultScreenOf(current).id), change)) : current);
  }, []);
  const replaceConfig = useCallback((config: StoredConfig) => {
    setSaved(config);
    setDraft(clone(config));
    setShowErrors(false);
    setDisplayKey((key) => key + 1);
  }, []);

  const askConflict = (): Promise<ConflictChoice> => {
    setSettingsOpen(true);
    return choiceDialog<'reload' | 'overwrite'>({
      title: t('The calendar changed while you were editing'),
      body: t('Load the saved version, or save your changes on top of it. Changes you did not make are retained.'),
      cancel: t('Keep editing'),
      choices: [
        { value: 'reload', label: t('Load saved version'), kind: 'ghost' },
        { value: 'overwrite', label: t('Save my changes'), kind: 'primary' },
      ],
    });
  };

  const save = useCallback(async (): Promise<boolean> => {
    const config = draftRef.current;
    if (!config) return false;
    const validation = validateAll(config);
    if (validation.total) {
      setShowErrors(true);
      const first = Object.keys(validation.global)[0] ?? Object.keys(validation.screens[defaultScreenOf(config).id] ?? {})[0];
      if (first) go(sectionForError(first));
      toast(t('Check the highlighted fields ({n})', { n: validation.total }), 'error');
      return false;
    }
    setSaving(true);
    try {
      const result = await saveWithRevision({
        draft: config,
        base: savedRef.current ?? config,
        put: (body) => api.saveConfig(body),
        get: () => api.getConfig(),
        choose: askConflict,
        isConflict: (err) => err instanceof ApiError && err.status === 409 && err.code === 'conflict',
        merged: (merged, theirs) => { setSaved(theirs); setDraft(merged); },
      });
      if (result.status === 'cancelled') return false;
      replaceConfig(result.config);
      toast(result.status === 'saved' ? t('Changes saved') : t('Loaded the saved version'), result.status === 'saved' ? 'ok' : 'info');
      return result.status === 'saved';
    } catch (err) {
      const failure = err as ApiError;
      if (failure.body && typeof failure.body === 'object' && 'details' in failure.body && Array.isArray(failure.body.details)) {
        const path = failure.body.details[0]?.path;
        if (typeof path === 'string') go(sectionForServerPath(path).section);
      }
      if (failure.status !== 401) toast(t('Could not save: {message}', { message: failure.message === 'network' ? t('server unavailable') : failure.message }), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [go, replaceConfig]);

  const discard = async () => {
    if (saved && await confirmDialog({ title: t('Discard changes?'), body: t('Your unsaved changes will be lost.'), confirm: t('Discard'), danger: true })) {
      setDraft(saved);
      setShowErrors(false);
    }
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving) {
          setSettingsOpen(true);
          void save();
        }
      }
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('keydown', shortcut);
    window.addEventListener('beforeunload', leaving);
    return () => {
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [dirty, saving, save]);

  if (!me?.user || !draft || !saved || !view) {
    return (
      <div class="boot">
        {error ? <div class="boot__err"><Icon name="alert" size={28} /><h2>{error}</h2><Button onClick={() => void load()}>{t('Retry')}</Button></div> : <span class="spinner spinner--lg" />}
        <ToastHost />
      </div>
    );
  }

  const screen = defaultScreenOf(saved);
  const query = new URLSearchParams({ screen: screen.slug, preview: '1', v: String(displayKey) });
  const displayUrl = appUrl(`/?${query}`);
  const closeSettings = () => {
    if (saving || document.querySelector('.calendar-settings .modal-backdrop')) return;
    setSettingsOpen(false);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  };
  const Section = SECTIONS[currentRoute];
  const sectionProps: SectionProps = {
    cfg: view, set, errors: showErrors || dirty ? errors : {}, me, save, dirty,
    full: draft, saved, go,
  };

  return (
    <div class="calendar-app">
      <main class="calendar-workspace" aria-label={t('Calendar')}>
        <header class="calendar-workspace__toolbar">
          <strong>{t('Calendar')}</strong>
          <button type="button" class="calendar-settings-button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" aria-expanded={settingsOpen} aria-label={dirty ? t('Settings · unsaved changes') : t('Settings')}>
            <Icon name="settings" size={20} /><span>{t('Settings')}</span>{dirty && <span class="calendar-settings-button__dot" aria-hidden="true" />}
          </button>
        </header>
        <iframe class="calendar-workspace__display" key={displayUrl} src={displayUrl} title={t('Calendar')} />
      </main>
      {settingsOpen && <SettingsDialog onClose={closeSettings} closingDisabled={saving}>
        <header class="calendar-settings__header">
          <h2 id="calendar-settings-title">{t('Calendar settings')}</h2>
          <button type="button" class="icon-btn" onClick={closeSettings} disabled={saving} aria-label={t('Close settings')}><Icon name="x" size={20} /></button>
        </header>
        <div class="calendar-settings__body">
          <nav class="calendar-settings__nav" aria-label={t('Calendar controls')}>
            {nav.map((item) => <a href={`#/${item.id}`} class={`nav__item ${currentRoute === item.id ? 'is-active' : ''}`} aria-current={currentRoute === item.id ? 'page' : undefined}><Icon name={item.icon} size={18} /><span>{t(item.label)}</span></a>)}
          </nav>
          <div class={`content calendar-settings__content content--${currentRoute}`} key={currentRoute}><Section {...sectionProps} /></div>
        </div>
        <footer class="calendar-settings__footer" aria-label={t('Changes')}>
          <span class="calendar-settings__status" role="status">{dirty ? t('Unsaved changes') : t('Changes saved')}</span>
          <Button variant="ghost" onClick={discard} disabled={saving || !dirty}>{t('Discard')}</Button>
          <Button variant="primary" icon="check" loading={saving} disabled={!dirty} onClick={() => void save()}>{t('Save')}</Button>
        </footer>
        <ToastHost />
        <DialogHost />
      </SettingsDialog>}
      {!settingsOpen && <ToastHost />}
    </div>
  );
}
