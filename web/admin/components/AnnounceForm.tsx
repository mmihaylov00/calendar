import { useState } from 'preact/hooks';
import type { AlertStyle, AnnounceResponse, ScreenProfile } from '../../shared/types';
import { api, ApiError } from '../api';
import { t } from '../i18n';
import { withPollNote } from '../liveNote';
import { toast } from './feedback';
import { Icon } from './icons';
import { Button, EmojiPicker, Field, Select, Textarea, TextInput, Toggle } from './ui';

export const ALERT_STYLES: { value: AlertStyle; label: string; emoji: string }[] = [
  { value: 'info', label: 'Info', emoji: '💬' },
  { value: 'success', label: 'Success', emoji: '✅' },
  { value: 'warning', label: 'Warning', emoji: '⚠️' },
  { value: 'urgent', label: 'Urgent', emoji: '🚨' },
];

export const DURATIONS = [
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 h' },
  { value: 4 * 3600, label: '4 h' },
  { value: 12 * 3600, label: '12 h' },
  { value: 86400, label: '24 h' },
];

const TEMPLATES: { emoji: string; title: string; style: AlertStyle; duration: number }[] = [
  { emoji: '🧺', title: 'The washing machine is done', style: 'success', duration: 300 },
  { emoji: '🍽️', title: 'Dinner’s ready!', style: 'info', duration: 300 },
  { emoji: '🚗', title: 'Leaving in 10 minutes', style: 'warning', duration: 600 },
  { emoji: '📦', title: 'A parcel has arrived', style: 'info', duration: 900 },
  { emoji: '🌙', title: 'Bedtime', style: 'info', duration: 900 },
  { emoji: '🚪', title: 'Someone is at the door', style: 'urgent', duration: 60 },
];

export function AlertCardPreview({ emoji, title, body, style }: { emoji: string; title: string; body: string; style: AlertStyle }) {
  return (
    <div class={`alert-prev alert-prev--${style}`}>
      <span class="alert-prev__emoji">{emoji || ALERT_STYLES.find((s) => s.value === style)?.emoji}</span>
      <div class="alert-prev__text">
        <strong>{title || (body ? '' : t('Alert title'))}</strong>
        {body && <p>{body}</p>}
      </div>
      <span class="alert-prev__bar" />
    </div>
  );
}

export function StylePicker({ value, onChange }: { value: AlertStyle; onChange: (v: AlertStyle) => void }) {
  return (
    <div class="style-pick" role="radiogroup">
      {ALERT_STYLES.map((s) => (
        <button type="button" role="radio" aria-checked={value === s.value} class={`style-pick__b style-pick__b--${s.value} ${value === s.value ? 'is-on' : ''}`} onClick={() => onChange(s.value)}>
          <span class="style-pick__dot" />
          {t(s.label)}
        </button>
      ))}
    </div>
  );
}

/** Screen targeting: "Todas" or a subset. value [] = all. */
export function ScreenTargets({ screens, value, onChange }: { screens: Pick<ScreenProfile, 'id' | 'name' | 'screen'>[]; value: string[]; onChange: (v: string[]) => void }) {
  if (screens.length <= 1) return <span class="muted small">{t('All screens')}</span>;
  const all = value.length === 0;
  return (
    <div class="target-pick">
      <button type="button" class={`pill ${all ? 'is-on' : ''}`} onClick={() => onChange([])}>
        {t('All')}
      </button>
      {screens.map((s) => {
        const on = value.includes(s.id);
        return (
          <button
            type="button"
            class={`pill ${on ? 'is-on' : ''}`}
            onClick={() => {
              const next = on ? value.filter((x) => x !== s.id) : [...value, s.id];
              onChange(next.length === screens.length ? [] : next);
            }}
          >
            <span class="dot-color" style={{ background: s.screen.accent }} /> {s.name}
          </button>
        );
      })}
    </div>
  );
}

export function AnnounceForm({ screens, compact, onSent }: { screens: ScreenProfile[]; compact?: boolean; onSent?: (r: AnnounceResponse) => void }) {
  const [emoji, setEmoji] = useState('🔔');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [style, setStyle] = useState<AlertStyle>('info');
  const [duration, setDuration] = useState(60);
  const [sound, setSound] = useState(true);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showBody, setShowBody] = useState(!compact);

  const send = async (e?: Event) => {
    e?.preventDefault();
    if (!title.trim() && !body.trim()) {
      toast(t('Write a title or a text'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await api.announce({ title: title.trim(), body: body.trim(), emoji, style, durationSec: duration, sound, screens: targets });
      toast(r.delivered ? withPollNote(t('Alert sent to {n} screens', { n: r.delivered })) : t('Alert saved: it will show when a screen connects'), r.delivered ? 'ok' : 'info');
      setTitle('');
      setBody('');
      onSent?.(r);
    } catch (err) {
      toast(`${t('Could not send')}: ${(err as ApiError).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class={`announce ${compact ? 'announce--compact' : ''}`} onSubmit={send}>
      <div class="announce__row">
        <EmojiPicker size="lg" value={emoji} allowNone onChange={setEmoji} />
        <TextInput class="announce__title" value={title} onValue={setTitle} placeholder={t('E.g. The washing machine is done')} maxLength={120} />
        {compact && (
          <Button type="submit" variant="primary" icon="megaphone" loading={busy}>
            {t('Send')}
          </Button>
        )}
      </div>
      <div class="quick-add">
        {TEMPLATES.map((tp) => (
          <button
            type="button"
            class="pill"
            onClick={() => {
              setEmoji(tp.emoji);
              setTitle(t(tp.title));
              setStyle(tp.style);
              setDuration(tp.duration);
            }}
          >
            {tp.emoji} {t(tp.title)}
          </button>
        ))}
      </div>
      {showBody ? (
        <Field label={t('Text (optional)')}>
          <Textarea value={body} onValue={setBody} rows={2} maxLength={500} placeholder={t('Alert details…')} />
        </Field>
      ) : (
        <button type="button" class="link-btn small" onClick={() => setShowBody(true)}>
          <Icon name="plus" size={12} /> {t('Add text and options')}
        </button>
      )}
      {showBody && (
        <>
          <div class={`grid announce__opts ${compact ? 'grid--2' : 'grid--3'}`}>
            <Field label={t('Style')}>
              <StylePicker value={style} onChange={setStyle} />
            </Field>
            <Field label={t('Duration')}>
              <Select value={duration} options={DURATIONS} onChange={setDuration} />
            </Field>
            <Field label={t('Sound')}>
              <label class="mini-toggle">
                <Toggle checked={sound} onChange={setSound} />
                <span>{sound ? t('With sound') : t('Silent')}</span>
              </label>
            </Field>
          </div>
          {screens.length > 1 && (
            <Field label={t('Screens')}>
              <ScreenTargets screens={screens} value={targets} onChange={setTargets} />
            </Field>
          )}
        </>
      )}
      {!compact && (
        <div class="announce__foot">
          <AlertCardPreview emoji={emoji} title={title} body={body} style={style} />
          <Button type="submit" variant="primary" icon="megaphone" loading={busy}>
            {t('Send alert')}
          </Button>
        </div>
      )}
    </form>
  );
}
