// The screens' private links (GET /api/admin/display-links), loaded once per saved config revision and shared by
// every place that opens a screen: the preview iframe, "Ver pantalla", the screen cards and the Displays page.
// Links are only loaded where they decide the URL: Marco Cloud (always private) and a self-hosted server in
// private mode. In open mode a screen is opened with "/?screen=<slug>". See screenUrl.ts for the URL rules.
import { useEffect, useState } from 'preact/hooks';
import type { DisplayLinksResponse, StoredConfig } from '../shared/types';
import { api } from './api';
import { caps, has } from './caps';
import { screenUrl } from './screenUrl';
import { appBase } from '../shared/path';

type State = { status: 'idle' | 'loading' | 'ready' | 'error'; revision: number; data: DisplayLinksResponse | null };

let state: State = { status: 'idle', revision: -1, data: null };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Whether screens are opened by their private link (and so the links must be loaded). */
export const usesPrivateLinks = (saved: Pick<StoredConfig, 'security'> | null | undefined): boolean =>
  !appBase() && (!has('openDisplayAccess') || saved?.security?.displayAccess !== 'open');

function load(revision: number, force = false): Promise<void> {
  if (!force && state.revision === revision && state.status !== 'idle' && state.status !== 'error') return pending ?? Promise.resolve();
  state = { ...state, status: 'loading', revision };
  notify();
  const p = api
    .displayLinks()
    .then((data) => {
      if (state.revision === revision) state = { status: 'ready', revision, data };
    })
    .catch(() => {
      if (state.revision === revision) state = { status: 'error', revision, data: null };
    })
    .finally(() => {
      if (pending === p) pending = null;
      notify();
    });
  pending = p;
  return p;
}

/** Load the links again (after a link was regenerated). */
export const refreshDisplayLinks = (): Promise<void> => load(state.revision < 0 ? 0 : state.revision, true);

/** The private links for `saved` (null while loading, on error and in open mode). */
export function useDisplayLinks(saved: StoredConfig | null): { data: DisplayLinksResponse | null; settled: boolean } {
  const [, force] = useState(0);
  const wanted = !!saved && usesPrivateLinks(saved);
  const revision = saved?.revision ?? -1;
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (wanted) void load(revision);
  }, [wanted, revision]);
  if (!wanted) return { data: null, settled: true };
  const current = state.revision === revision;
  return { data: current ? state.data : null, settled: current && (state.status === 'ready' || state.status === 'error') };
}

/** Display origin for links: the server's (health), else the links response's, else null (same origin). */
export const displayOriginOf = (data: DisplayLinksResponse | null): string | null => caps().displayOrigin || data?.displayOrigin || null;

/**
 * URL that opens screen `screenId` as saved, or null when there is nothing to open yet (unsaved screen, links still
 * loading). A failed links request falls back to "/?screen=<slug>", which a self-hosted admin session can open.
 */
export function useScreenUrl(saved: StoredConfig | null, screenId: string | null | undefined, opts: { preview?: boolean } = {}): string | null {
  const links = useDisplayLinks(saved);
  return screenHref(saved, screenId, links, opts);
}

/** Non-hook form of useScreenUrl for lists (pass the result of one useDisplayLinks call). */
export function screenHref(
  saved: StoredConfig | null,
  screenId: string | null | undefined,
  links: { data: DisplayLinksResponse | null; settled: boolean },
  { preview = false }: { preview?: boolean } = {},
): string | null {
  const scr = saved?.screens.find((s) => s.id === screenId);
  if (!saved || !scr) return null;
  const wanted = usesPrivateLinks(saved);
  if (wanted && !links.settled) return null;
  const link = links.data?.links.find((l) => l.screenId === scr.id);
  return screenUrl({ slug: scr.slug, linkKey: link?.key ?? null, displayOrigin: displayOriginOf(links.data), origin: location.origin, preview });
}

/** Tests only. */
export function _resetDisplayLinks() {
  state = { status: 'idle', revision: -1, data: null };
  pending = null;
}
