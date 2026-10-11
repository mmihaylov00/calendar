import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { Icon } from './icons';

export interface SourceOption {
  id: string;
  name: string;
  color: string;
  emoji?: string;
}

/** Multi-select of calendar sources. `value` [] (or null with allowNull) means "all". */
export function SourcePicker({ options, value, onChange, allLabel, compact }: { options: SourceOption[]; value: string[]; onChange: (v: string[]) => void; allLabel?: string; compact?: boolean }) {
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
  const sel = options.filter((o) => value.includes(o.id));
  const label = !value.length ? allLabel ?? t('All calendars') : sel.length === 1 ? sel[0].name : t('{n} calendars', { n: sel.length });
  return (
    <div class="pop" ref={ref}>
      <button type="button" class={`src-pick ${compact ? 'src-pick--compact' : ''} ${value.length ? 'is-some' : ''}`} onClick={() => setOpen(!open)}>
        <span class="src-pick__dots">
          {(sel.length ? sel : options).slice(0, 4).map((o) => (
            <span class="dot-color" style={{ background: o.color }} />
          ))}
        </span>
        <span class="src-pick__label">{label}</span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div class="pop__panel src-pick__panel">
          <label class="src-pick__opt">
            <input type="checkbox" checked={!value.length} onChange={() => onChange([])} />
            <span class="check-box">
              <Icon name="check" size={12} />
            </span>
            <strong>{allLabel ?? t('All calendars')}</strong>
          </label>
          <div class="src-pick__sep" />
          {options.map((o) => {
            const on = value.includes(o.id);
            return (
              <label class="src-pick__opt">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} />
                <span class="check-box">
                  <Icon name="check" size={12} />
                </span>
                <span class="dot-color" style={{ background: o.color }} />
                <span>
                  {o.emoji ? `${o.emoji} ` : ''}
                  {o.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
