import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { normalize } from '../util';
import { Icon, type IconName } from './icons';

export interface PaletteItem {
  id: string;
  label: string;
  /** small text on the right / under the label (e.g. the page) */
  hint?: string;
  icon?: IconName;
  emoji?: string;
  group: string;
  /** extra search words (already translated or language-neutral) */
  keywords?: string;
  run: () => void;
}

function score(item: PaletteItem, tokens: string[]): number {
  if (!tokens.length) return 1;
  const label = normalize(item.label);
  const hay = `${label} ${normalize(item.hint ?? '')} ${normalize(item.keywords ?? '')} ${normalize(item.group)}`;
  let total = 0;
  for (const tok of tokens) {
    let s = 0;
    if (label.startsWith(tok)) s = 100;
    else if (new RegExp(`(^|[\\s/(·-])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) s = 80;
    else if (label.includes(tok)) s = 60;
    else if (hay.includes(tok)) s = 40;
    else {
      // subsequence on the label (typo-tolerant-ish "fuzzy")
      let i = 0;
      for (const ch of label) if (ch === tok[i]) i++;
      if (i === tok.length && tok.length >= 3) s = 15;
    }
    if (!s) return 0;
    total += s;
  }
  return total - label.length * 0.05;
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    const scored = items.map((it) => ({ it, s: score(it, tokens) })).filter((x) => x.s > 0);
    if (tokens.length) scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, tokens.length ? 40 : 60).map((x) => x.it);
  }, [q, items]);

  useEffect(() => setIdx(0), [q]);
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    list.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [idx, results]);

  const run = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    // let the palette unmount first so focus/scroll land on the page
    setTimeout(() => it.run(), 0);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[idx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // group consecutive results (when not searching, keep the natural group order)
  let lastGroup = '';
  return (
    <div class="cmdk-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="cmdk" role="dialog" aria-modal="true" aria-label={t('Search')}>
        <div class="cmdk__search">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={q}
            placeholder={t('Search settings, pages, screens or actions…')}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={onKey}
            aria-controls="cmdk-list"
            aria-activedescendant={results[idx] ? `cmdk-${results[idx].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div class="cmdk__list" id="cmdk-list" role="listbox" ref={list}>
          {results.length === 0 && <div class="cmdk__empty">{t('No results for “{q}”', { q })}</div>}
          {results.map((it, i) => {
            const head = !q && it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <>
                {head && <div class="cmdk__group">{head}</div>}
                <button
                  type="button"
                  id={`cmdk-${it.id}`}
                  role="option"
                  aria-selected={i === idx}
                  class={`cmdk__item ${i === idx ? 'is-sel' : ''}`}
                  onPointerMove={() => i !== idx && setIdx(i)}
                  onClick={() => run(it)}
                >
                  <span class="cmdk__icon">{it.emoji ? <span>{it.emoji}</span> : <Icon name={it.icon ?? 'search'} size={16} />}</span>
                  <span class="cmdk__label">{it.label}</span>
                  {q && <span class="cmdk__kind">{it.group}</span>}
                  {it.hint && <span class="cmdk__hint">{it.hint}</span>}
                  {i === idx && <Icon name="enter" size={14} class="cmdk__enter" />}
                </button>
              </>
            );
          })}
        </div>
        <div class="cmdk__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('navigate')}
          </span>
          <span>
            <kbd>↵</kbd> {t('open')}
          </span>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> {t('open/close')}
          </span>
        </div>
      </div>
    </div>
  );
}
