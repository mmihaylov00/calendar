import { useEffect, useState } from 'preact/hooks';
import type { HaEntity } from '../../shared/types';
import { api } from '../api';
import { t } from '../i18n';
import { Icon } from './icons';

const cache: Record<string, Promise<HaEntity[]> | undefined> = {};

export function invalidateHaEntities() {
  for (const k of Object.keys(cache)) delete cache[k];
}

function load(domain: 'sensor' | 'weather' | 'camera') {
  if (!cache[domain]) {
    cache[domain] = api.haEntities(domain).catch((e) => {
      delete cache[domain];
      throw e;
    });
  }
  return cache[domain]!;
}

/** Searchable entity picker (datalist) with live state of the selected entity. */
export function HaEntityPicker(props: {
  domain: 'sensor' | 'weather' | 'camera';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Optional filter, e.g. by unit (°C / %). */
  filter?: (e: HaEntity) => boolean;
  error?: boolean;
  enabled: boolean;
  reloadKey?: number;
}) {
  const [list, setList] = useState<HaEntity[] | null>(null);
  const [err, setErr] = useState('');
  const id = `ha-${props.domain}-${Math.random().toString(36).slice(2, 7)}`;
  const [listId] = useState(id);
  useEffect(() => {
    if (!props.enabled) return;
    let alive = true;
    load(props.domain)
      .then((l) => alive && (setList(l), setErr('')))
      .catch((e) => alive && setErr(e.message || 'error'));
    return () => {
      alive = false;
    };
  }, [props.domain, props.enabled, props.reloadKey]);
  const options = (list ?? []).filter((e) => !props.filter || props.filter(e));
  const sel = list?.find((e) => e.entity_id === props.value);
  return (
    <div class="ha-picker">
      <div class={`input-group ${props.error ? 'is-invalid' : ''}`}>
        <span class="input-group__addon">
          <Icon name="home" size={14} />
        </span>
        <input
          class="input input--mono"
          list={listId}
          value={props.value}
          disabled={!props.enabled}
          placeholder={props.placeholder ?? `${props.domain}.…`}
          onInput={(e) => props.onChange(e.currentTarget.value.trim())}
          spellcheck={false}
        />
        {props.value && (
          <button type="button" class="input-group__btn" aria-label={t('Remove')} onClick={() => props.onChange('')}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <datalist id={listId}>
        {options.map((e) => (
          <option value={e.entity_id}>{`${e.name}: ${e.state}${e.unit ? ' ' + e.unit : ''}`}</option>
        ))}
      </datalist>
      <div class="field__hint">
        {!props.enabled
          ? t('Enable Home Assistant to pick entities.')
          : err
            ? <span class="err-text">{t('Could not load entities')}: {err}</span>
            : sel
              ? <span>
                  {sel.name}: <strong>{sel.state}{sel.unit ? ` ${sel.unit}` : ''}</strong>
                </span>
              : list
                ? t('{n} entities available', { n: options.length })
                : t('Loading…')}
      </div>
    </div>
  );
}
