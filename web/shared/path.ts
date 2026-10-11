/** Home Assistant strips this prefix before forwarding an ingress request to Marco. */
export function appBase(pathname = typeof location === 'undefined' ? '/' : location.pathname): string {
  return /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+(?=\/|$)/.exec(pathname)?.[0] ?? '';
}

/** Marco's route within its origin or Home Assistant ingress session. */
export function appPath(pathname = typeof location === 'undefined' ? '/' : location.pathname): string {
  return pathname.slice(appBase(pathname).length) || '/';
}

/** Keep local API, navigation and media URLs inside the current ingress session. */
export function appUrl(url: string): string {
  const base = appBase();
  if (!base || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return url;
  if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`) || url.startsWith(`${base}#`)) return url;
  return `${base}${url}`;
}
