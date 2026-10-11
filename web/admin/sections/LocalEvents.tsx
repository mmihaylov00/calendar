import { useMemo, useState } from 'preact/hooks';
import type { LocalEvent, RepeatFreq } from '../../shared/types';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Card, ColorPicker, EmojiPicker, Empty, Field, Modal, NumberInput, PageHeader, SearchInput, Segmented, Textarea, TextInput, Toggle, ToggleRow, WeekdayPicker } from '../components/ui';
import { addDays, daysBetween, fmtDay, relDays, todayIn, weekdayNames, weekdayOf } from '../dates';
import { t } from '../i18n';
import { atLimit, has, limit } from '../caps';
import { PrivacyModeField } from './Privacy';
import { LimitNote } from '../components/LimitNote';
import { takeIntent } from '../intent';
import { clone, HEX_RE, isValidDate, normalize, TIME_RE, uid } from '../util';
import type { SectionProps } from './common';

/* ---------------------------------------------------------------- recurrence (mirror of server/localEvents.js rules) */

const mondayIndex = (iso: string) => {
  // days since epoch of the Monday of that week
  const [y, m, d] = iso.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return n - ((weekdayOf(iso) + 6) % 7);
};
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function occursOn(ev: LocalEvent, day: string): boolean {
  if (day < ev.date) return false;
  if (ev.exceptions.includes(day)) return false;
  const r = ev.repeat;
  if (r.freq === 'none') return day === ev.date;
  if (r.until && day > r.until) return false;
  const [y0, m0, d0] = ev.date.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  const iv = Math.max(1, r.interval || 1);
  if (r.freq === 'weekly') {
    const wds = r.weekdays.length ? r.weekdays : [weekdayOf(ev.date)];
    if (!wds.includes(weekdayOf(day))) return false;
    return ((mondayIndex(day) - mondayIndex(ev.date)) / 7) % iv === 0;
  }
  if (r.freq === 'monthly') {
    if (d !== d0) return false;
    return ((y - y0) * 12 + (m - m0)) % iv === 0;
  }
  // yearly
  const dd = m0 === 2 && d0 === 29 && !isLeap(y) ? 28 : d0;
  if (m !== m0 || d !== dd) return false;
  return (y - y0) % iv === 0;
}

/** Next occurrence start ≥ from (null if none within ~3 years). */
export function nextOccurrence(ev: LocalEvent, from: string): string | null {
  if (ev.repeat.freq === 'none') return ev.date >= from ? ev.date : null;
  let day = ev.date > from ? ev.date : from;
  for (let i = 0; i < 1200; i++) {
    if (ev.repeat.until && day > ev.repeat.until) return null;
    if (occursOn(ev, day)) return day;
    day = addDays(day, 1);
  }
  return null;
}

function repeatSummary(ev: LocalEvent, wd: string[]): string {
  const r = ev.repeat;
  if (r.freq === 'none') return '';
  let s = '';
  if (r.freq === 'weekly') {
    const days = (r.weekdays.length ? r.weekdays : [weekdayOf(ev.date)]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => wd[d]).join(', ');
    s = r.interval > 1 ? t('Every {n} weeks: {days}', { n: r.interval, days }) : t('Every week: {days}', { days });
  } else if (r.freq === 'monthly') {
    const d = Number(ev.date.slice(8));
    s = r.interval > 1 ? t('Every {n} months on day {d}', { n: r.interval, d }) : t('Every month on day {d}', { d });
  } else {
    const dm = fmtDay(ev.date, { weekday: false, year: false });
    s = r.interval > 1 ? t('Every {n} years on {date}', { n: r.interval, date: dm }) : t('Every year on {date}', { date: dm });
  }
  if (r.until) s += ` · ${t('until {date}', { date: fmtDay(r.until, { weekday: false, year: true }) })}`;
  return s;
}

function whenSummary(ev: LocalEvent): string {
  const multi = ev.endDate !== ev.date;
  const time = ev.allDay ? t('All day') : `${ev.startTime}–${ev.endTime}`;
  if (!multi) return time;
  const n = daysBetween(ev.date, ev.endDate) + 1;
  return `${t('{n} days', { n })} · ${ev.allDay ? t('All day') : `${ev.startTime} → ${ev.endTime}`}`;
}

/* ---------------------------------------------------------------- editor */

function validateEvent(x: LocalEvent): Record<string, string> {
  const e: Record<string, string> = {};
  if (!x.title.trim()) e.title = 'Required';
  if (!isValidDate(x.date)) e.date = 'Invalid date';
  if (!isValidDate(x.endDate) || x.endDate < x.date) e.endDate = 'Must be on or after the start';
  if (!x.allDay) {
    if (!TIME_RE.test(x.startTime)) e.startTime = 'Invalid time (HH:MM)';
    if (!TIME_RE.test(x.endTime)) e.endTime = 'Invalid time (HH:MM)';
    else if (x.endDate === x.date && x.endTime <= x.startTime) e.endTime = 'Must be after the start time';
  }
  if (x.repeat.until && (!isValidDate(x.repeat.until) || x.repeat.until < x.date)) e.until = 'Must be on or after the start';
  if (x.color && !HEX_RE.test(x.color)) e.color = 'Invalid colour';
  return e;
}

export function newLocalEvent(today: string): LocalEvent {
  return {
    id: uid('l'),
    title: '',
    emoji: '',
    color: null,
    location: '',
    notes: '',
    allDay: true,
    date: today,
    endDate: today,
    startTime: '',
    endTime: '',
    repeat: { freq: 'none', interval: 1, until: null, weekdays: [] },
    exceptions: [],
    countdown: false,
  };
}

function EventEditor({ initial, isNew, defaultColor, onSave, onClose, onDelete }: { initial: LocalEvent; isNew: boolean; defaultColor: string; onSave: (e: LocalEvent) => void; onClose: () => void; onDelete?: () => void }) {
  const [ev, setEv] = useState<LocalEvent>(() => clone(initial));
  const [tried, setTried] = useState(false);
  const [exc, setExc] = useState('');
  const wd = weekdayNames('short');
  const upd = (fn: (x: LocalEvent) => void) => setEv((x) => {
    const c = clone(x);
    fn(c);
    return c;
  });
  const errs = validateEvent(ev);
  const shown = tried ? errs : {};
  const multi = ev.endDate !== ev.date;
  const submit = (e?: Event) => {
    e?.preventDefault();
    setTried(true);
    if (Object.keys(errs).length) return;
    const out = clone(ev);
    out.title = out.title.trim();
    if (out.allDay) {
      out.startTime = '';
      out.endTime = '';
    }
    if (out.repeat.freq !== 'weekly') out.repeat.weekdays = [];
    if (out.repeat.freq === 'none') {
      out.repeat.until = null;
      out.repeat.interval = 1;
      out.exceptions = [];
    }
    onSave(out);
  };
  const unit = ev.repeat.freq === 'weekly' ? t('weeks') : ev.repeat.freq === 'monthly' ? t('months') : t('years');
  return (
    <Modal
      title={isNew ? t('New event') : t('Edit event')}
      icon="calendar"
      onClose={onClose}
      dirty={JSON.stringify(ev) !== JSON.stringify(initial)}
      size="lg"
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" icon="trash" class="btn--danger-text" onClick={onDelete}>
              {t('Delete')}
            </Button>
          )}
          <span class="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon="check" onClick={submit}>
            {isNew ? t('Add') : t('Apply')}
          </Button>
        </>
      }
    >
      <form class="stack ev-editor" onSubmit={submit}>
        <div class="ev-editor__title">
          <EmojiPicker size="lg" value={ev.emoji} allowNone onChange={(v) => upd((x) => void (x.emoji = v))} />
          <TextInput class="input--lg" value={ev.title} error={!!shown.title} maxLength={120} placeholder={t('Event title')} onValue={(v) => upd((x) => void (x.title = v))} />
          <ColorPicker compact allowNone value={ev.color} onChange={(v) => upd((x) => void (x.color = v))} />
        </div>
        {shown.title && <div class="field__error">{t(shown.title)}</div>}
        <div class="ev-editor__row">
          <ToggleRow
            label={t('All day')}
            checked={ev.allDay}
            onChange={(v) =>
              upd((x) => {
                x.allDay = v;
                if (!v && !x.startTime) {
                  x.startTime = '09:00';
                  x.endTime = '10:00';
                }
              })
            }
          />
          <ToggleRow
            label={t('Several days')}
            checked={multi}
            onChange={(v) => upd((x) => void (x.endDate = v ? addDays(x.date, 1) : x.date))}
          />
        </div>
        <div class="grid grid--2">
          <Field label={multi ? t('From') : t('Date')} error={shown.date}>
            <div class="dt-pair">
              <input
                class={`input ${shown.date ? 'is-invalid' : ''}`}
                type="date"
                value={ev.date}
                onInput={(e) => {
                  const v = e.currentTarget.value;
                  upd((x) => {
                    const len = isValidDate(x.endDate) && isValidDate(x.date) ? daysBetween(x.date, x.endDate) : 0;
                    x.date = v;
                    if (isValidDate(v)) x.endDate = addDays(v, Math.max(0, len));
                  });
                }}
              />
              {!ev.allDay && <input class={`input input--time ${shown.startTime ? 'is-invalid' : ''}`} type="time" value={ev.startTime} onInput={(e) => upd((x) => void (x.startTime = e.currentTarget.value))} />}
            </div>
          </Field>
          {(multi || !ev.allDay) && (
            <Field label={multi ? t('Until (inclusive)') : t('Ends')} error={shown.endDate || shown.endTime}>
              <div class="dt-pair">
                {multi && <input class={`input ${shown.endDate ? 'is-invalid' : ''}`} type="date" min={ev.date} value={ev.endDate} onInput={(e) => upd((x) => void (x.endDate = e.currentTarget.value))} />}
                {!ev.allDay && <input class={`input input--time ${shown.endTime ? 'is-invalid' : ''}`} type="time" value={ev.endTime} onInput={(e) => upd((x) => void (x.endTime = e.currentTarget.value))} />}
              </div>
            </Field>
          )}
        </div>

        <Field label={t('Repeat')}>
          <Segmented<RepeatFreq>
            full
            value={ev.repeat.freq}
            options={[
              { value: 'none', label: t('Off') },
              { value: 'weekly', label: t('Weekly') },
              { value: 'monthly', label: t('Monthly') },
              { value: 'yearly', label: t('Yearly') },
            ]}
            onChange={(v) => upd((x) => void (x.repeat.freq = v))}
          />
        </Field>
        {ev.repeat.freq !== 'none' && (
          <div class="repeat-box">
            <div class="grid grid--2">
              <Field label={t('Every')}>
                <NumberInput value={ev.repeat.interval} min={1} max={99} suffix={unit} onValue={(v) => upd((x) => void (x.repeat.interval = Math.max(1, Math.min(99, Math.round(v) || 1))))} />
              </Field>
              <Field label={t('Until (optional)')} error={shown.until}>
                <div class="dt-pair">
                  <input class={`input ${shown.until ? 'is-invalid' : ''}`} type="date" min={ev.date} value={ev.repeat.until ?? ''} onInput={(e) => upd((x) => void (x.repeat.until = e.currentTarget.value || null))} />
                  {ev.repeat.until && (
                    <button type="button" class="icon-btn" onClick={() => upd((x) => void (x.repeat.until = null))} title={t('No end')}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              </Field>
            </div>
            {ev.repeat.freq === 'weekly' && (
              <Field label={t('Weekdays')} hint={ev.repeat.weekdays.length ? undefined : t('None ticked: same weekday as the start date ({day}).', { day: wd[weekdayOf(isValidDate(ev.date) ? ev.date : '2026-01-05')] })}>
                <WeekdayPicker labels={wd} value={ev.repeat.weekdays} onChange={(v) => upd((x) => void (x.repeat.weekdays = v))} />
              </Field>
            )}
            <div class="muted small">
              <Icon name="repeat" size={12} /> {repeatSummary(ev, wd)}
            </div>
            <Field label={t('Exceptions (days it does not repeat)')}>
              <div class="exc-list">
                {ev.exceptions.map((d) => (
                  <span class="chip">
                    {fmtDay(d, { year: true })}
                    <button type="button" aria-label={t('Remove')} onClick={() => upd((x) => void (x.exceptions = x.exceptions.filter((y) => y !== d)))}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
                <input class="input input--sm exc-list__in" type="date" min={ev.date} value={exc} onInput={(e) => setExc(e.currentTarget.value)} />
                <Button
                  size="sm"
                  icon="plus"
                  disabled={!isValidDate(exc) || ev.exceptions.includes(exc)}
                  onClick={() => {
                    if (!occursOn({ ...ev, exceptions: [] }, exc)) toast(t('The event does not repeat on that day'), 'info');
                    upd((x) => void (x.exceptions = [...x.exceptions, exc].sort()));
                    setExc('');
                  }}
                >
                  {t('Add')}
                </Button>
              </div>
            </Field>
          </div>
        )}

        <div class="grid grid--2">
          <Field label={t('Location')}>
            <TextInput value={ev.location} maxLength={120} placeholder={t('Optional')} onValue={(v) => upd((x) => void (x.location = v))} />
          </Field>
          <Field label={t('Countdown')}>
            <label class="mini-toggle">
              <Toggle checked={ev.countdown} onChange={(v) => upd((x) => void (x.countdown = v))} />
              <span>{t('Show “In N days” on the screen')}</span>
            </label>
          </Field>
        </div>
        <Field label={t('Notes')}>
          <Textarea value={ev.notes} rows={2} maxLength={1000} placeholder={t('Optional')} onValue={(v) => upd((x) => void (x.notes = v))} />
        </Field>
        <div class="ev-editor__preview">
          <span class="muted small">{t('Preview')}</span>
          <div class="event-pill" style={{ '--ev': ev.color || defaultColor } as any}>
            <span class="event-pill__emoji">{ev.emoji || '·'}</span>
            <span class="event-pill__title">{ev.title || t('Untitled')}</span>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- page */

export function LocalEventsSection({ full, setFull, errors, cfg }: SectionProps) {
  const le = full.localEvents;
  const today = todayIn(cfg.datetime.timezone);
  const [editing, setEditing] = useState<{ ev: LocalEvent; isNew: boolean } | null>(() => (takeIntent('local', 'add') ? { ev: newLocalEvent(today), isNew: true } : null));
  const [q, setQ] = useState('');
  const [showPast, setShowPast] = useState(false);
  const wd = weekdayNames('short');

  const groups = useMemo(() => {
    const nq = normalize(q);
    const items = le.items.filter((x) => !nq || normalize(`${x.title} ${x.location} ${x.notes}`).includes(nq));
    const up: { ev: LocalEvent; next: string }[] = [];
    const rec: { ev: LocalEvent; next: string | null }[] = [];
    const past: LocalEvent[] = [];
    for (const ev of items) {
      if (ev.repeat.freq !== 'none') rec.push({ ev, next: nextOccurrence(ev, today) });
      else if (ev.endDate >= today) up.push({ ev, next: ev.date });
      else past.push(ev);
    }
    up.sort((a, b) => a.next.localeCompare(b.next));
    rec.sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999'));
    past.sort((a, b) => b.date.localeCompare(a.date));
    return { up, rec, past };
  }, [le.items, q, today]);

  const saveEv = (ev: LocalEvent) => {
    const isNew = !le.items.some((x) => x.id === ev.id);
    if (isNew && atLimit('localEvents', le.items.length)) {
      toast(t('You have reached the maximum ({max}).', { max: limit('localEvents') ?? le.items.length }), 'error');
      return;
    }
    setFull((d) => {
      const i = d.localEvents.items.findIndex((x) => x.id === ev.id);
      if (i >= 0) d.localEvents.items[i] = ev;
      else d.localEvents.items.push(ev);
    });
    toast(editing?.isNew ? t('Event added · save to publish') : t('Event updated · save to publish'), 'ok', 2200);
    setEditing(null);
  };
  const remove = async (ev: LocalEvent) => {
    const ok = await confirmDialog({ title: t('Delete “{name}”', { name: ev.title }), body: ev.repeat.freq !== 'none' ? t('All repetitions will be deleted.') : undefined, confirm: t('Delete'), danger: true });
    if (!ok) return;
    setFull((d) => void (d.localEvents.items = d.localEvents.items.filter((x) => x.id !== ev.id)));
    setEditing(null);
  };
  const duplicate = (ev: LocalEvent) => setEditing({ ev: { ...clone(ev), id: uid('l'), title: t('{name} (copy)', { name: ev.title }).slice(0, 120) }, isNew: true });

  const Row = ({ ev, next }: { ev: LocalEvent; next?: string | null }) => {
    const color = ev.color || le.color;
    const hasErr = Object.keys(errors).some((k) => k.startsWith(`local.${ev.id}.`));
    const n = next ? daysBetween(today, next) : null;
    return (
      <li class={`lev ${hasErr ? 'has-err' : ''}`} style={{ '--ev': color } as any}>
        <button type="button" class="lev__main" onClick={() => setEditing({ ev, isNew: false })}>
          <span class="lev__date">
            {next ? (
              <>
                <strong>{Number(next.slice(8))}</strong>
                <span>{fmtDay(next, { weekday: false, year: false }).replace(/^\d+\s*/, '')}</span>
              </>
            ) : (
              <span class="muted">–</span>
            )}
          </span>
          <span class="lev__emoji">{ev.emoji || le.emoji || '📅'}</span>
          <span class="lev__text">
            <strong>{ev.title || t('Untitled')}</strong>
            <span class="muted small">
              {ev.repeat.freq !== 'none' ? repeatSummary(ev, wd) : fmtDay(ev.date, { year: 'auto' })}
              {' · '}
              {whenSummary(ev)}
              {ev.location && ` · 📍 ${ev.location}`}
            </span>
          </span>
          {n != null && n >= 0 && n <= 30 && <span class="badge badge--soft">{relDays(n)}</span>}
          {ev.countdown && (
            <span class="badge badge--accent" title={t('Shown as a countdown')}>
              ⏳
            </span>
          )}
          {hasErr && <span class="nav__err">!</span>}
        </button>
        <div class="lev__actions">
          <button type="button" class="icon-btn" title={t('Duplicate')} onClick={() => duplicate(ev)}>
            <Icon name="copy" size={15} />
          </button>
          <button type="button" class="icon-btn icon-btn--danger" title={t('Delete')} onClick={() => remove(ev)}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title={t('Local events')} desc={t('Events created right here, without Google or iCal: appointments, activities, recurring reminders… They appear on every screen showing this calendar.')}>
        <Button variant="primary" icon="plus" onClick={() => setEditing({ ev: newLocalEvent(today), isNew: true })} disabled={atLimit('localEvents', le.items.length)}>
          {t('New event')}
        </Button>
      </PageHeader>
      <LimitNote name="localEvents" count={le.items.length} />

      <Card title={t('Local calendar')} icon="calendar" scope="global" id="local-settings">
        <ToggleRow label={t('Show local events')} hint={t('Turn off to hide them without deleting.')} checked={le.enabled} onChange={(v) => setFull((d) => void (d.localEvents.enabled = v))} />
        <div class={`legend-edit ${le.enabled ? '' : 'is-disabled'}`}>
          <EmojiPicker value={le.emoji} allowNone onChange={(v) => setFull((d) => void (d.localEvents.emoji = v))} />
          <ColorPicker compact value={le.color} onChange={(v) => v && setFull((d) => void (d.localEvents.color = v))} />
          <TextInput value={le.name} maxLength={60} placeholder={t('Family')} onValue={(v) => setFull((d) => void (d.localEvents.name = v))} />
          <span class="muted small">{t('Name in the legend')}</span>
        </div>
        {has('privacy') && <PrivacyModeField value={le.privacy ?? 'busy'} onChange={(v) => setFull((d) => void (d.localEvents.privacy = v))} />}
      </Card>

      <Card
        title={t('Events')}
        icon="list"
        id="local-list"
        desc={t('{n} events · {r} recurring', { n: le.items.length, r: groups.rec.length })}
        actions={le.items.length > 6 && <SearchInput value={q} onValue={setQ} placeholder={t('Search…')} />}
      >
        {le.items.length === 0 ? (
          <Empty icon="calendar" title={t('No local events yet')}>
            <p>{t('Create a one-off or recurring event: “🏊 Swimming on Tuesdays”, “🗑️ Glass collection every 2 weeks”…')}</p>
            <Button variant="primary" icon="plus" onClick={() => setEditing({ ev: newLocalEvent(today), isNew: true })}>
              {t('New event')}
            </Button>
          </Empty>
        ) : (
          <>
            {groups.up.length > 0 && (
              <div class="lev-group">
                <h4>{t('Upcoming')}</h4>
                <ul class="lev-list">
                  {groups.up.map((x) => (
                    <Row ev={x.ev} next={x.next} />
                  ))}
                </ul>
              </div>
            )}
            {groups.rec.length > 0 && (
              <div class="lev-group">
                <h4>
                  <Icon name="repeat" size={13} /> {t('Recurring')}
                </h4>
                <ul class="lev-list">
                  {groups.rec.map((x) => (
                    <Row ev={x.ev} next={x.next} />
                  ))}
                </ul>
              </div>
            )}
            {groups.past.length > 0 && (
              <div class="lev-group">
                <button type="button" class="lev-group__toggle" onClick={() => setShowPast(!showPast)}>
                  <Icon name="down" size={13} class={showPast ? 'rot-180' : ''} /> {t('Past ({n})', { n: groups.past.length })}
                </button>
                {showPast && (
                  <>
                    <ul class="lev-list lev-list--past">
                      {groups.past.map((ev) => (
                        <Row ev={ev} />
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      onClick={async () => {
                        const ok = await confirmDialog({ title: t('Delete {n} past events', { n: groups.past.length }), confirm: t('Clear'), danger: true });
                        if (ok) setFull((d) => void (d.localEvents.items = d.localEvents.items.filter((x) => x.repeat.freq !== 'none' || x.endDate >= today)));
                      }}
                    >
                      {t('Delete past ones')}
                    </Button>
                  </>
                )}
              </div>
            )}
            {q && !groups.up.length && !groups.rec.length && !groups.past.length && <div class="muted small">{t('No results')}</div>}
          </>
        )}
      </Card>

      {editing && (
        <EventEditor
          initial={editing.ev}
          isNew={editing.isNew}
          defaultColor={le.color}
          onClose={() => setEditing(null)}
          onSave={saveEv}
          onDelete={editing.isNew ? undefined : () => remove(editing.ev)}
        />
      )}
    </>
  );
}
