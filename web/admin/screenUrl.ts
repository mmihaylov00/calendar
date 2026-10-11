// Where a screen is opened from the admin ("View screen", the preview iframe, the screen cards).
//
// - Display links loaded (Marco Cloud, or a self-hosted server in private mode): the screen's private link,
//   on the display origin when there is one, else on the admin's own origin.
// - Otherwise (self-hosted open mode, or links not loaded yet): "/?screen=<slug>".
// - Home Assistant ingress uses the current authenticated session and screen slug.
import { appBase, appUrl } from '../shared/path';

export interface ScreenUrlInput {
  /** the screen's saved slug (null = screen not saved yet) */
  slug: string | null;
  /** the screen's private link key, when display links are loaded */
  linkKey?: string | null;
  /** absolute origin that serves the display pages (health.displayOrigin or the links response) */
  displayOrigin?: string | null;
  /** the admin's own origin (location.origin) */
  origin: string;
  /** the admin preview: the display must not store the key or count as a connected TV */
  preview?: boolean;
}

/** URL of a screen, or null when there is nothing to open yet. */
export function screenUrl({ slug, linkKey, displayOrigin, origin, preview }: ScreenUrlInput): string | null {
  if (appBase()) {
    if (slug == null) return null;
    const q = new URLSearchParams({ screen: slug });
    if (preview) q.set('preview', '1');
    return appUrl(`/?${q.toString()}`);
  }
  if (linkKey) {
    const base = (displayOrigin || origin).replace(/\/+$/, '');
    return `${base}/d/${encodeURIComponent(linkKey)}${preview ? '?preview=1' : ''}`;
  }
  if (slug == null) return null;
  const q = new URLSearchParams({ screen: slug });
  if (preview) q.set('preview', '1');
  return `/?${q.toString()}`;
}
