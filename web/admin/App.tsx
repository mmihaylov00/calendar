import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyScreen, defaultScreenOf, projectScreen } from '../shared/screens';
import { appUrl } from '../shared/path';
import type { AppConfig, AuthMeResponse, StoredConfig } from '../shared/types';
import { api, ApiError, UNAUTHORIZED_EVENT } from './api';
import { loadCaps, type Caps } from './caps';
import { BrandMark } from './components/BrandMark';
import { choiceDialog, confirmDialog, DialogHost, toast, ToastHost } from './components/feedback';
import { Icon } from './components/icons';
import { Button, setScopeScreenName } from './components/ui';
import { saveWithRevision, type ConflictChoice } from './configMerge';
import { t } from './i18n';
import { filterNav, NAV_ITEMS, routeFor } from './navFilter';
import { Preview } from './Preview';
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

function useWidePreview() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1360px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1360px)');
    const changed = () => setWide(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return wide;
}

export function App() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [saved, setSaved] = useState<StoredConfig | null>(null);
  const [draft, setDraft] = useState<StoredConfig | null>(null);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(requestedRoute);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [showPreview, setShowPreview] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const wide = useWidePreview();

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
      setNavOpen(false);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  const nav = useMemo(() => caps ? filterNav(NAV_ITEMS, caps) : NAV_ITEMS, [caps]);
  const currentRoute = routeFor(route, nav) as keyof typeof SECTIONS;
  const go = useCallback((target: string) => { location.hash = `#/${routeFor(target.split('/')[0], NAV_ITEMS)}`; }, []);
  const screenId = draft ? defaultScreenOf(draft).id : '';
  const view = useMemo(() => draft ? projectScreen(draft, screenId) : null, [draft, screenId]);
  setScopeScreenName('');
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
    setPreviewKey((key) => key + 1);
  }, []);

  const askConflict = (): Promise<ConflictChoice> => choiceDialog<'reload' | 'overwrite'>({
    title: t('The calendar changed while you were editing'),
    body: t('Load the saved version, or save your changes on top of it. Changes you did not make are retained.'),
    cancel: t('Keep editing'),
    choices: [
      { value: 'reload', label: t('Load saved version'), kind: 'ghost' },
      { value: 'overwrite', label: t('Save my changes'), kind: 'primary' },
    ],
  });

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
        if (dirty && !saving) void save();
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
  const query = new URLSearchParams({ screen: screen.slug });
  const openUrl = appUrl(`/?${query}`);
  query.set('preview', '1');
  const previewUrl = appUrl(`/?${query}`);
  const previewSide = wide && showPreview;
  const Section = SECTIONS[currentRoute];
  const sectionProps: SectionProps = {
    cfg: view, set, errors: showErrors || dirty ? errors : {}, me, save, dirty,
    full: draft, saved, go,
  };

  return (
    <div class={`shell ${previewSide ? 'has-preview' : ''} ${navOpen ? 'nav-open' : ''}`}>
      <aside class="sidebar">
        <div class="brand"><BrandMark size={34} /><strong class="wordmark">calendar</strong></div>
        <nav class="nav" aria-label={t('Calendar controls')}>
          {nav.map((item) => <a href={`#/${item.id}`} class={`nav__item ${currentRoute === item.id ? 'is-active' : ''}`} aria-current={currentRoute === item.id ? 'page' : undefined}><Icon name={item.icon} size={18} /><span>{t(item.label)}</span></a>)}
        </nav>
      </aside>
      <div class="scrim" onClick={() => setNavOpen(false)} />
      <div class="main-col">
        <header class="topbar">
          <button type="button" class="icon-btn topbar__menu" aria-label={t('Navigation')} onClick={() => setNavOpen(!navOpen)}><Icon name="menu" size={18} /></button>
          <div class="topbar__crumb"><strong>{t(nav.find((item) => item.id === currentRoute)?.label ?? 'Calendars')}</strong></div>
          <div class="topbar__actions">
            <a class="btn btn--ghost" href={openUrl} target="_blank" rel="noopener"><Icon name="external" size={16} />{t('Open calendar')}</a>
            <button type="button" class={`icon-btn ${previewSide || sheet ? 'is-active' : ''}`} title={t('Preview')} onClick={() => wide ? setShowPreview(!showPreview) : setSheet(true)}><Icon name="eye" size={18} /></button>
          </div>
        </header>
        <div class="content-row">
          <main class={`content content--${currentRoute}`} key={currentRoute}><Section {...sectionProps} /></main>
          {previewSide && <aside class="preview-col"><Preview variant="side" saved url={previewUrl} openUrl={openUrl} reloadKey={previewKey} portrait={view.screen.orientation === 'portrait'} onClose={() => setShowPreview(false)} /></aside>}
        </div>
        <div class={`savebar ${dirty || saving ? 'is-visible' : ''}`} role="region" aria-label={t('Unsaved changes')}>
          <div class="savebar__inner"><span class="savebar__status">{t('Unsaved changes')}</span><Button variant="ghost" onClick={discard} disabled={saving}>{t('Discard')}</Button><Button variant="primary" icon="check" loading={saving} onClick={() => void save()}>{t('Save')}</Button></div>
        </div>
      </div>
      {sheet && !previewSide && <div class="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && setSheet(false)}><div class="sheet"><Preview variant="sheet" saved url={previewUrl} openUrl={openUrl} reloadKey={previewKey} portrait={view.screen.orientation === 'portrait'} onClose={() => setSheet(false)} /></div></div>}
      <ToastHost />
      <DialogHost />
    </div>
  );
}
