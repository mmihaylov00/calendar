import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './components/icons';
import { t } from './i18n';

/**
 * Live, scaled-down preview of a screen in an iframe. Reloaded whenever `reloadKey` changes.
 * `url` is the preview address (displayLinks.ts useScreenUrl with preview: the display then neither registers as a
 * connected screen nor writes its storage), `openUrl` the same screen for a new tab; null while it is not known yet.
 */
export function Preview({ reloadKey, portrait, onClose, variant, saved, url, openUrl, screenName }: { reloadKey: number; portrait: boolean; onClose?: () => void; variant: 'side' | 'sheet'; saved: boolean; url: string | null; openUrl: string | null; screenName?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [orient, setOrient] = useState<'land' | 'port'>(portrait ? 'port' : 'land');
  useEffect(() => setOrient(portrait ? 'port' : 'land'), [portrait]);
  useEffect(() => setLoaded(false), [reloadKey, orient, url]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const W = orient === 'land' ? 1920 : 1080;
  const H = orient === 'land' ? 1080 : 1920;
  // In portrait, cap the height so it fits in the column.
  const maxH = variant === 'sheet' ? window.innerHeight * 0.7 : window.innerHeight * 0.62;
  const scale = Math.min(w / W, orient === 'port' ? maxH / H : Infinity) || 0.1;
  return (
    <div class={`preview preview--${variant}`}>
      <div class="preview__bar">
        <span class="live-dot" />
        <strong>
          {t('Preview')}
          {screenName && <span class="preview__scr"> · {screenName}</span>}
        </strong>
        <div class="preview__tools">
          <button type="button" class={`icon-btn ${orient === 'land' ? 'is-active' : ''}`} onClick={() => setOrient('land')} title={t('Landscape')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="6" width="18" height="12" rx="2" />
            </svg>
          </button>
          <button type="button" class={`icon-btn ${orient === 'port' ? 'is-active' : ''}`} onClick={() => setOrient('port')} title={t('Portrait')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="6" y="3" width="12" height="18" rx="2" />
            </svg>
          </button>
          {saved && openUrl && (
            <a class="icon-btn" href={openUrl} target="_blank" rel="noopener" title={t('Open screen')}>
              <Icon name="external" size={15} />
            </a>
          )}
          {onClose && (
            <button type="button" class="icon-btn" onClick={onClose} title={t('Close')}>
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      </div>
      <div class="preview__frame-wrap" ref={box}>
        <div class="preview__frame" style={{ width: `${W * scale}px`, height: `${H * scale}px` }}>
          {!saved ? (
            <div class="preview__unsaved muted small">{t('Save to preview this screen')}</div>
          ) : w > 0 && url && (
            <iframe
              key={`${reloadKey}-${orient}-${url}`}
              src={`${url}${url.includes('?') ? '&' : '?'}v=${reloadKey}`}
              title={t('Preview')}
              loading="lazy"
              tabIndex={-1}
              style={{ width: `${W}px`, height: `${H}px`, transform: `scale(${scale})` }}
              onLoad={() => setLoaded(true)}
            />
          )}
          {saved && !loaded && <div class="preview__loading shimmer" />}
        </div>
      </div>
      <p class="preview__hint muted small">{t('Reloads on save. Unsaved changes are not shown here.')}</p>
    </div>
  );
}
