import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScreenProfile } from '../../shared/types';
import { nScreens, t } from '../i18n';
import { Icon } from './icons';

/** Header dropdown: "Editando: Salón ▾" to pick which screen the per-screen pages edit. */
export function ScreenSwitcher(props: {
  screens: ScreenProfile[];
  defaultId: string;
  value: string;
  onChange: (id: string) => void;
  onManage: () => void;
  onNew: () => void;
  emphasize?: boolean;
  errorScreens?: Set<string>;
  online?: Record<string, number>;
  /** display access is 'open': show each screen's ?screen= address (private mode: the private link decides) */
  openMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const cur = props.screens.find((s) => s.id === props.value) ?? props.screens[0];
  const single = props.screens.length === 1;
  return (
    <div class="scr-switch" ref={ref}>
      <button
        type="button"
        class={`scr-switch__btn ${props.emphasize ? 'is-emph' : ''} ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('Screen you are editing')}
      >
        <span class="scr-switch__swatch" style={{ background: cur.screen.accent }} />
        <span class="scr-switch__label">
          <span class="scr-switch__pre">{t('Editing')}</span>
          <strong>{cur.name}</strong>
        </span>
        {props.errorScreens?.has(cur.id) && <span class="nav__err">!</span>}
        <Icon name="down" size={13} class="scr-switch__chev" />
      </button>
      {open && (
        <div class="scr-switch__menu" role="listbox">
          <div class="scr-switch__title">{single ? t('A single screen') : nScreens(props.screens.length)}</div>
          {props.screens.map((s) => {
            const on = props.online?.[s.id] ?? 0;
            return (
              <button
                type="button"
                role="option"
                aria-selected={s.id === cur.id}
                class={`scr-switch__item ${s.id === cur.id ? 'is-active' : ''}`}
                onClick={() => {
                  props.onChange(s.id);
                  setOpen(false);
                }}
              >
                <span class="scr-switch__swatch" style={{ background: s.screen.accent }} />
                <span class="scr-switch__name">
                  <strong>{s.name}</strong>
                  {props.openMode && <span class="mono small muted">?screen={s.slug}</span>}
                </span>
                {s.id === props.defaultId && (
                  <span class="scr-switch__star" title={t('Default screen')}>
                    ★
                  </span>
                )}
                {props.errorScreens?.has(s.id) && <span class="nav__err">!</span>}
                {on > 0 && (
                  <span class="scr-switch__online" title={t('{n} connected', { n: on })}>
                    <span class="dot dot--ok" /> {on}
                  </span>
                )}
                {s.id === cur.id && <Icon name="check" size={15} class="scr-switch__check" />}
              </button>
            );
          })}
          <div class="scr-switch__sep" />
          <button
            type="button"
            class="scr-switch__item scr-switch__item--action"
            onClick={() => {
              setOpen(false);
              props.onNew();
            }}
          >
            <Icon name="plus" size={15} /> {t('New screen…')}
          </button>
          <button
            type="button"
            class="scr-switch__item scr-switch__item--action"
            onClick={() => {
              setOpen(false);
              props.onManage();
            }}
          >
            <Icon name="settings" size={15} /> {t('Manage screens…')}
          </button>
        </div>
      )}
    </div>
  );
}
