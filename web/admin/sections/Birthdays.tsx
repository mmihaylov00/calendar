import { useMemo, useState } from 'preact/hooks';
import type { Birthday, BirthdayCsvResult } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, ColorPicker, EmojiPicker, Empty, Modal, PageHeader, SearchInput, Segmented, Textarea, TextInput, ToggleRow } from '../components/ui';
import { fmtDay, monthNames, nextBirthday, relDays, todayIn } from '../dates';
import { t } from '../i18n';
import { atLimit, has, limit } from '../caps';
import { PrivacyModeField } from './Privacy';
import { LimitNote } from '../components/LimitNote';
import { takeIntent } from '../intent';
import { daysInMonth, normalize, uid } from '../util';
import type { SectionProps } from './common';

/** Client-side fallback of the server CSV parser (docs/ARCHITECTURE.md), used if the endpoint is unavailable. */
function parseCsvLocal(text: string, existing: Birthday[]): BirthdayCsvResult {
  const items: Birthday[] = [];
  const errors: BirthdayCsvResult['errors'] = [];
  let duplicates = 0;
  const yy = new Date().getFullYear() % 100;
  const key = (n: string, d: number, m: number) => `${normalize(n)}|${d}|${m}`;
  const seen = new Set(existing.map((b) => key(b.name, b.day, b.month)));
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[;,\t]/).map((s) => s.trim());
    if (i === 0 && /^(nombre|name|nome)$/i.test(parts[0]) ) return;
    const [name, date] = parts;
    const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(date ?? '');
    if (!name || !m) return void errors.push({ line: i + 1, text: raw, message: !name ? 'missing name' : 'invalid date' });
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year: number | null = m[3] ? Number(m[3]) : null;
    if (year != null && m[3].length === 2) year += year <= yy ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month) || (year != null && (year < 1900 || year > 2100))) return void errors.push({ line: i + 1, text: raw, message: 'invalid date' });
    const k = key(name, day, month);
    if (seen.has(k)) return void duplicates++;
    seen.add(k);
    items.push({ id: uid('b'), name: name.slice(0, 80), day, month, year, emoji: '' });
  });
  return { items, errors, duplicates };
}

function CsvDialog({ existing, onClose, onAdd }: { existing: Birthday[]; onClose: () => void; onAdd: (items: Birthday[]) => void }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<BirthdayCsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const months = monthNames('short');
  const parse = async () => {
    setBusy(true);
    try {
      setRes(await api.parseBirthdaysCsv(text));
    } catch (e) {
      if ([404, 405].includes((e as ApiError).status)) setRes(parseCsvLocal(text, existing));
      else toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Import birthdays')}
      icon="upload"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          {res && res.items.length > 0 ? (
            <Button variant="primary" icon="plus" onClick={() => onAdd(res.items)}>
              {t('Add {n} birthdays', { n: res.items.length })}
            </Button>
          ) : (
            <Button variant="primary" icon="play" loading={busy} disabled={!text.trim()} onClick={parse}>
              {t('Check')}
            </Button>
          )}
        </>
      }
    >
      <div class="stack">
        <p class="muted small">
          {t('Paste one line per person:')} <code>{t('name')};dd/mm</code> {t('or')} <code>{t('name')};dd/mm/yyyy</code>. {t('Comma or tab also work (copy from a spreadsheet).')}
        </p>
        <Textarea
          mono
          rows={8}
          value={text}
          placeholder={t('name;dd/mm/yyyy')}
          onValue={(v) => {
            setText(v);
            setRes(null);
          }}
        />
        {res && (
          <div class="csv-result">
            <div class="csv-result__sum">
              <span class="ok-text">
                <Icon name="check" size={14} /> {t('{n} valid', { n: res.items.length })}
              </span>
              {res.duplicates > 0 && <span class="muted">{t('{n} already existed', { n: res.duplicates })}</span>}
              {res.errors.length > 0 && (
                <span class="err-text">
                  <Icon name="alert" size={14} /> {t('{n} with errors', { n: res.errors.length })}
                </span>
              )}
            </div>
            {res.items.length > 0 && (
              <ul class="csv-result__list">
                {res.items.slice(0, 50).map((b) => (
                  <li>
                    <span>🎂</span> <strong>{b.name}</strong>{' '}
                    <span class="muted">
                      {b.day} {months[b.month - 1]}
                      {b.year ? ` ${b.year}` : ''}
                    </span>
                  </li>
                ))}
                {res.items.length > 50 && <li class="muted">… +{res.items.length - 50}</li>}
              </ul>
            )}
            {res.errors.length > 0 && (
              <ul class="csv-result__errs">
                {res.errors.slice(0, 20).map((e) => (
                  <li>
                    <span class="mono small">#{e.line}</span> <code>{e.text}</code> <span class="err-text">{t(e.message)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DayMonth({ day, month, onChange, error }: { day: number; month: number; onChange: (d: number, m: number) => void; error?: boolean }) {
  const months = monthNames('short');
  return (
    <div class={`daymonth ${error ? 'is-invalid' : ''}`}>
      <select class="daymonth__d" value={day} aria-label={t('Day')} onChange={(e) => onChange(Number(e.currentTarget.value), month)}>
        {Array.from({ length: daysInMonth(month) }, (_, i) => (
          <option value={i + 1}>{i + 1}</option>
        ))}
      </select>
      <select
        class="daymonth__m"
        value={month}
        aria-label={t('Month')}
        onChange={(e) => {
          const m = Number(e.currentTarget.value);
          onChange(Math.min(day, daysInMonth(m)), m);
        }}
      >
        {months.map((n, i) => (
          <option value={i + 1}>{n}</option>
        ))}
      </select>
    </div>
  );
}

export function BirthdaysSection({ full, setFull, errors, cfg }: SectionProps) {
  const bd = full.birthdays;
  const today = todayIn(cfg.datetime.timezone);
  const [sort, setSort] = useState<'next' | 'name' | 'month'>('next');
  const [q, setQ] = useState('');
  const [csv, setCsv] = useState(false);
  const [name, setName] = useState('');
  const [day, setDay] = useState(Number(today.slice(8)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [year, setYear] = useState('');
  const [emoji, setEmoji] = useState('');
  const [focusAdd] = useState(() => takeIntent('birthdays', 'add'));

  const rows = useMemo(() => {
    const nq = normalize(q);
    const list = bd.items.filter((b) => !nq || normalize(b.name).includes(nq)).map((b) => ({ b, next: nextBirthday(b, today) }));
    if (sort === 'next') list.sort((a, c) => a.next.days - c.next.days || a.b.name.localeCompare(c.b.name));
    else if (sort === 'name') list.sort((a, c) => a.b.name.localeCompare(c.b.name, undefined, { sensitivity: 'base' }));
    else list.sort((a, c) => a.b.month - c.b.month || a.b.day - c.b.day);
    return list;
  }, [bd.items, sort, q, today]);
  const upcoming = useMemo(() => bd.items.map((b) => ({ b, next: nextBirthday(b, today) })).sort((a, c) => a.next.days - c.next.days).slice(0, 4), [bd.items, today]);

  const upd = (id: string, fn: (b: Birthday) => void) =>
    setFull((d) => {
      const b = d.birthdays.items.find((x) => x.id === id);
      if (b) fn(b);
    });
  const atMax = atLimit('birthdays', bd.items.length);
  const yearNum = year.trim() ? Number(year) : null;
  const yearBad = yearNum != null && !(Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100);
  const add = (e: Event) => {
    e.preventDefault();
    if (!name.trim() || yearBad || atMax) return;
    if (bd.items.some((b) => normalize(b.name) === normalize(name) && b.day === day && b.month === month)) {
      toast(t('That birthday is already in the list'), 'info');
      return;
    }
    setFull((d) => void d.birthdays.items.push({ id: uid('b'), name: name.trim().slice(0, 80), day, month, year: yearNum, emoji }));
    toast(t('🎂 {name} added · save to publish', { name: name.trim() }), 'ok', 2200);
    setName('');
    setYear('');
    setEmoji('');
  };
  const remove = async (b: Birthday) => {
    const ok = await confirmDialog({ title: t('Delete {name}’s birthday', { name: b.name }), confirm: t('Delete'), danger: true });
    if (ok) setFull((d) => void (d.birthdays.items = d.birthdays.items.filter((x) => x.id !== b.id)));
  };

  const labelFor = (n: { days: number; age: number | null }) => (n.age != null && bd.showAge ? `${relDays(n.days)} · ${t('turns {n}', { n: n.age })}` : relDays(n.days));

  return (
    <>
      <PageHeader title={t('Birthdays')} desc={t('Shown every year on the calendar. With a birth year the screen shows the age: “🎂 Name (34)”.')}>
        <Button icon="upload" disabled={atMax} onClick={() => setCsv(true)}>
          {t('Import CSV')}
        </Button>
      </PageHeader>

      {upcoming.length > 0 && (
        <div class="bday-next">
          {upcoming.map(({ b, next }) => (
            <div class={`bday-next__card ${next.days === 0 ? 'is-today' : ''}`}>
              <span class="bday-next__emoji">{b.emoji || bd.emoji || '🎂'}</span>
              <div>
                <strong>{b.name}</strong>
                <span class="muted small">
                  {fmtDay(next.date, { year: false })} · {labelFor(next)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title={t('Birthday calendar')} icon="cake" scope="global" id="bday-settings">
        <ToggleRow label={t('Show birthdays')} checked={bd.enabled} onChange={(v) => setFull((d) => void (d.birthdays.enabled = v))} />
        <div class={`stack ${bd.enabled ? '' : 'is-disabled'}`}>
          <div class="legend-edit">
            <EmojiPicker value={bd.emoji} allowNone onChange={(v) => setFull((d) => void (d.birthdays.emoji = v))} />
            <ColorPicker compact value={bd.color} onChange={(v) => v && setFull((d) => void (d.birthdays.color = v))} />
            <TextInput value={bd.name} maxLength={60} placeholder={t('Birthdays')} onValue={(v) => setFull((d) => void (d.birthdays.name = v))} />
            <span class="muted small">{t('Name in the legend')}</span>
          </div>
          <ToggleRow icon="🔢" label={t('Show age')} hint={t('Only if the birth year is known')} checked={bd.showAge} onChange={(v) => setFull((d) => void (d.birthdays.showAge = v))} />
          {has('privacy') && <PrivacyModeField value={bd.privacy ?? 'keep'} onChange={(v) => setFull((d) => void (d.birthdays.privacy = v))} />}
        </div>
      </Card>

      <Card
        title={t('People')}
        icon="list"
        id="bday-list"
        desc={t('{n} birthdays', { n: bd.items.length })}
        actions={
          <Segmented
            size="sm"
            value={sort}
            options={[
              { value: 'next', label: t('Upcoming') },
              { value: 'month', label: t('By month') },
              { value: 'name', label: t('A-Z') },
            ]}
            onChange={setSort}
          />
        }
      >
        <form class="bday-add" onSubmit={add}>
          <EmojiPicker value={emoji} allowNone onChange={setEmoji} />
          <TextInput class="bday-add__name" value={name} onValue={setName} placeholder={t('Name')} maxLength={80} autoFocus={focusAdd} />
          <DayMonth
            day={day}
            month={month}
            onChange={(d, m) => {
              setDay(d);
              setMonth(m);
            }}
          />
          <input class={`input bday-add__year ${yearBad ? 'is-invalid' : ''}`} inputMode="numeric" placeholder={t('Year (opt.)')} value={year} maxLength={4} onInput={(e) => setYear(e.currentTarget.value.replace(/\D/g, ''))} />
          <Button type="submit" variant="primary" icon="plus" disabled={!name.trim() || yearBad || atMax}>
            {t('Add')}
          </Button>
        </form>
        <LimitNote name="birthdays" count={bd.items.length} />
        {bd.items.length > 8 && <SearchInput value={q} onValue={setQ} placeholder={t('Search person…')} />}
        {bd.items.length === 0 ? (
          <Empty icon="cake" title={t('No birthdays yet')}>
            {t('Add them one by one or paste a list with “Import CSV”.')}
          </Empty>
        ) : (
          <div class="bday-table">
            {rows.map(({ b, next }) => {
              const err = errors[`bday.${b.id}.name`] || errors[`bday.${b.id}.date`] || errors[`bday.${b.id}.year`];
              return (
                <div class={`bday-row ${next.days === 0 ? 'is-today' : ''} ${err ? 'has-err' : ''}`} key={b.id}>
                  <EmojiPicker value={b.emoji} allowNone onChange={(v) => upd(b.id, (x) => void (x.emoji = v))} />
                  <input class={`input input--bare bday-row__name ${errors[`bday.${b.id}.name`] ? 'is-invalid' : ''}`} value={b.name} maxLength={80} onInput={(e) => upd(b.id, (x) => void (x.name = e.currentTarget.value))} />
                  <DayMonth day={b.day} month={b.month} onChange={(d, m) => upd(b.id, (x) => ((x.day = d), (x.month = m)))} />
                  <input
                    class={`input bday-row__year ${errors[`bday.${b.id}.year`] ? 'is-invalid' : ''}`}
                    inputMode="numeric"
                    placeholder={t('Year')}
                    value={b.year ?? ''}
                    maxLength={4}
                    onInput={(e) => {
                      const v = e.currentTarget.value.replace(/\D/g, '');
                      upd(b.id, (x) => void (x.year = v ? Number(v) : null));
                    }}
                  />
                  <span class={`bday-row__next ${next.days <= 7 ? 'is-soon' : ''}`}>{labelFor(next)}</span>
                  <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Delete')} onClick={() => remove(b)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              );
            })}
            {q && rows.length === 0 && <div class="muted small">{t('No results')}</div>}
          </div>
        )}
        {Object.keys(errors).some((k) => k.startsWith('bday.')) && <Callout kind="error">{t('Check the birthdays marked in red.')}</Callout>}
      </Card>
      {csv && (
        <CsvDialog
          existing={bd.items}
          onClose={() => setCsv(false)}
          onAdd={(items) => {
            const room = Math.max(0, (limit('birthdays') ?? Infinity) - bd.items.length);
            const added = items.slice(0, room);
            setFull((d) => void d.birthdays.items.push(...added));
            setCsv(false);
            toast(t('{n} birthdays added · save to publish', { n: added.length }), added.length ? 'ok' : 'info');
            if (added.length < items.length) toast(t('You have reached the maximum ({max}).', { max: limit('birthdays') ?? bd.items.length }), 'info');
          }}
        />
      )}
    </>
  );
}
