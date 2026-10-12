// Layouts with their own content area (#view inside .main): Today (hour-by-hour timeline), Per person (one column
// per calendar). The other layouts (including Two weeks, a two-row month grid) leave #view empty.
// Everything is plain HTML strings + setHTML (patched only when it changes) and one fitting pass that drops whole
// rows that do not fit, so nothing is ever cut in half.
import type { PublicCalendarSource } from '../../shared/types';
import { addDays, diffDays, formatCountdown, formatDateLine, formatTime, relativeDayLabel } from '../../shared/i18n';
import { chipColors } from '../color';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { type NEvent, sortForDay } from '../eventModel';
import type { Tick } from '../time';

export const VIEW_PRESETS = ['today', 'people'];

export interface ViewData {
  events: NEvent[];
}

const SKELETON: Record<string, string> = {
  today: `<div class="td-head"><div class="td-title"></div><div class="td-allday"></div></div>
    <div class="td-next"></div>
    <div class="td-line"><div class="td-grid"></div><div class="td-evs"></div><div class="td-now"><span></span></div></div>`,
  people: `<div class="pp-shared"></div><div class="pp-cols"></div>`,
};

const colStyle = (hex: string) => {
  const c = chipColors(hex);
  return `--c:${c.base};--tint:${c.tint};--shade:${c.shade};--on:${c.onSolid}`;
};
const hm = (ms: number) => formatTime(new Date(ms), ctx.tz, ctx.cfg.datetime.format24, ctx.cfg.datetime.showAmPm);
const emojiOr = (e: NEvent, fallback = '') => (e.emoji ? esc(e.emoji) : fallback);

/** Timed single-day events of a day, by start. */
function timedOn(events: NEvent[], key: string): NEvent[] {
  return events.filter((e) => e.timed && e.startKey === key).sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
}
/** All-day and multi-day events covering a day. */
function allDayOn(events: NEvent[], key: string): NEvent[] {
  return events.filter((e) => e.bar && e.spanFirst <= key && e.spanLast >= key).sort(sortForDay);
}
/** "Check-in", "Day 2 of 5", … for an all-day / multi-day item on a given day ('' when nothing to add). */
function barNote(e: NEvent, key: string): string {
  const { t } = ctx;
  if (e.checkoutMarker) return t('checkOut');
  if (e.airbnb) return key === e.spanFirst ? t('checkIn') : key === e.spanLast ? t('checkOut') : t('dayXofY', { x: diffDays(e.spanFirst, key) + 1, y: e.days + 1 });
  if (e.days > 1 && ctx.cfg.calendar.showDayXofY) return t('dayXofY', { x: diffDays(e.spanFirst, key) + 1, y: e.days });
  return '';
}

/** The next thing to look at: upcoming today, else what is on now, else tomorrow's first event. */
function nextOf(events: NEvent[], tick: Tick): { e: NEvent; kind: 'next' | 'now' | 'tomorrow' } | null {
  const nowMs = tick.now.getTime();
  const today = timedOn(events, tick.dayKey);
  const next = today.find((e) => e.startMs > nowMs);
  if (next) return { e: next, kind: 'next' };
  const on = today.filter((e) => e.startMs <= nowMs && e.endMs > nowMs).pop();
  if (on) return { e: on, kind: 'now' };
  const tm = timedOn(events, addDays(tick.dayKey, 1))[0];
  return tm ? { e: tm, kind: 'tomorrow' } : null;
}

/**
 * Hide rows until `box` stops overflowing. `pick()` returns the next row to drop (or null to stop); `after(row)` runs
 * after each drop (e.g. to update a "+2 more" label, which itself takes room).
 */
function fitRows(box: HTMLElement, pick: () => HTMLElement | null, after?: (row: HTMLElement) => void): void {
  for (let guard = 0; guard < 200 && box.scrollHeight > box.clientHeight + 1; guard++) {
    const row = pick();
    if (!row) return;
    row.classList.add('fit-hide');
    after?.(row);
  }
}

/**
 * Single-line chip rows: drop the chips that would overflow the line, from the last one. The Today line is aligned to
 * the right, so it overflows on the left: its first chip would lose the start of its title.
 */
function fitLine(line: HTMLElement): void {
  const chips = Array.from(line.children) as HTMLElement[];
  for (const c of chips) c.classList.remove('fit-hide');
  const box = line.getBoundingClientRect();
  const over = () => {
    const vis = chips.filter((c) => !c.classList.contains('fit-hide'));
    if (vis.length < 2) return false;
    return vis[0].getBoundingClientRect().left < box.left - 1 || vis[vis.length - 1].getBoundingClientRect().right > box.right + 1;
  };
  for (let i = chips.length - 1; i > 0 && over(); i--) chips[i].classList.add('fit-hide');
}

export class Views {
  private kind = '';

  constructor(private root: HTMLElement) {}

  /** Build the skeleton of a layout (no-op when it is not one of VIEW_PRESETS or did not change). */
  setPreset(preset: string): void {
    const kind = VIEW_PRESETS.includes(preset) ? preset : '';
    if (kind === this.kind) return;
    this.kind = kind;
    this.root.className = kind ? `view view-${kind}` : 'view';
    this.root.innerHTML = SKELETON[kind] ?? '';
  }

  render(d: ViewData, tick: Tick): void {
    if (!this.kind) return;
    if (this.kind === 'today') this.today(d, tick);
    else if (this.kind === 'people') this.people(d, tick);
  }

  /** Drop whole rows that do not fit after layout or font changes. */
  fit(): void {
    if (this.kind === 'today') {
      const line = this.root.querySelector<HTMLElement>('.td-allday');
      if (line) fitLine(line);
    } else if (this.kind === 'people') this.fitPeople();
  }

  // ------------------------------------------------------------------------------------------------ Today
  private today(d: ViewData, tick: Tick): void {
    const { lang, t } = ctx;
    const root = this.root;
    const key = tick.dayKey;
    const nowMs = tick.now.getTime();
    const p = tick.parts;
    // the date as the screen writes it everywhere else ("Miércoles, 14 de octubre", "Wednesday, 14 October")
    setHTML(root.querySelector('.td-title')!, `<b>${esc(t('today'))}</b><span>${esc(formatDateLine(lang, key, ctx.cfg.datetime.dateFormat, ctx.cfg.datetime.dateCustom))}</span>`);

    // all-day + multi-day things of today, as chips next to the title
    const chips = allDayOn(d.events, key).map((e) => {
      const note = barNote(e, key);
      return `<span class="td-chip" style="${colStyle(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<b>${esc(e.title)}</b>${note ? `<em>${esc(note)}</em>` : ''}</span>`;
    });
    setHTML(root.querySelector('.td-allday')!, chips.join(''));

    // the next event, large
    const nx = nextOf(d.events, tick);
    let next: string;
    if (nx) {
      const e = nx.e;
      const kicker = nx.kind === 'now'
        ? `${t('happeningNow')} · ${t('untilTime', { t: hm(e.endMs) })}`
        : nx.kind === 'tomorrow'
          ? `${t('firstTomorrow')} · ${hm(e.startMs)}`
          : `${t('upNext')} · ${formatCountdown(lang, e.startMs - nowMs)}`;
      const sub = [`${hm(e.startMs)}–${hm(e.endMs)}`, e.ev.location || '', sourceName(e)].filter(Boolean).map(esc).join(' · ');
      next = `<div class="td-card${nx.kind === 'now' ? ' is-now' : ''}" style="${colStyle(e.color)}">
        <span class="td-em">${emojiOr(e, '<i class="td-dot"></i>')}</span>
        <div class="td-txt"><span class="td-k">${esc(kicker)}</span><span class="td-tt">${esc(e.title)}</span><span class="td-sub">${sub}</span></div></div>`;
    } else {
      next = `<div class="td-card is-empty"><div class="td-txt"><span class="td-tt">${esc(t('nothingMoreToday'))}</span></div></div>`;
    }
    setHTML(root.querySelector('.td-next')!, next);

    // hour-by-hour timeline: 07:00–22:00 at least, stretched to every event of the day and to "now"
    const evs = timedOn(d.events, key);
    const startOfDay = nowMs - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
    const minOf = (ms: number) => (ms - startOfDay) / 60000;
    let h0 = Math.min(7, p.hour), h1 = Math.max(22, p.hour + 1);
    for (const e of evs) {
      h0 = Math.min(h0, Math.floor(minOf(e.startMs) / 60));
      h1 = Math.max(h1, Math.ceil(Math.min(24 * 60, minOf(e.endMs)) / 60));
    }
    h0 = Math.max(0, h0);
    h1 = Math.min(24, Math.max(h1, h0 + 1));
    const span = (h1 - h0) * 60;
    const pct = (m: number) => `${(((m - h0 * 60) / span) * 100).toFixed(3)}%`;
    const nowMin = p.hour * 60 + p.minute;
    const f24 = ctx.cfg.datetime.format24;
    const hourLbl = (h: number) => (f24 ? `${String(h).padStart(2, '0')}:00` : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`);
    const step = h1 - h0 > 15 ? 2 : 1;
    let grid = '';
    for (let h = h0; h <= h1; h++) {
      const near = Math.abs(h * 60 - nowMin) < 22;
      const lbl = (h - h0) % step === 0 && h < 24 && !near ? `<span>${esc(hourLbl(h))}</span>` : '';
      grid += `<div class="td-hr${h * 60 < nowMin ? ' past' : ''}" style="top:${pct(h * 60)}">${lbl}</div>`;
    }
    setHTML(root.querySelector('.td-grid')!, grid);

    // lanes: overlapping events (counting the minimum drawn height) share the width
    const box = root.querySelector<HTMLElement>('.td-evs')!;
    const H = box.clientHeight || 1;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const minMin = Math.ceil(((rem * 4.4) / H) * span);
    const items = evs.map((e) => {
      const a = Math.max(h0 * 60, minOf(e.startMs));
      const b = Math.min(h1 * 60, Math.max(minOf(e.endMs), a + 15));
      return { e, a, b, vis: Math.max(b, a + minMin), lane: 0, of: 1 };
    });
    let cluster: typeof items = [];
    let clusterEnd = -1;
    const closeCluster = () => {
      const n = Math.max(1, ...cluster.map((x) => x.lane + 1));
      for (const x of cluster) x.of = n;
      cluster = [];
    };
    for (const it of items) {
      if (it.a >= clusterEnd) closeCluster();
      const used = new Set(cluster.filter((x) => x.vis > it.a).map((x) => x.lane));
      let lane = 0;
      while (used.has(lane)) lane++;
      it.lane = lane;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.vis);
    }
    closeCluster();
    const rows = items.map(({ e, a, b, vis, lane, of }) => {
      const past = e.endMs <= nowMs;
      const on = e.startMs <= nowMs && e.endMs > nowMs;
      const tall = ((b - a) / span) * H > rem * 7.4;
      const loc = tall && e.ev.location ? `<span class="td-loc">${esc(e.ev.location)}</span>` : '';
      return `<div class="td-ev${past ? ' past' : ''}${on ? ' ongoing' : ''}${tall ? ' tall' : ''}" style="${colStyle(e.color)};top:${pct(a)};height:calc(${(((vis - a) / span) * 100).toFixed(3)}% - 0.3rem);left:calc(${((lane / of) * 100).toFixed(2)}% + 0.2rem);width:calc(${(100 / of).toFixed(2)}% - 0.4rem)">
        <span class="td-l1"><b>${esc(hm(e.startMs))}</b>${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<span>${esc(e.title)}</span></span>${loc}</div>`;
    });
    setHTML(box, rows.join(''));
    const nowEl = root.querySelector<HTMLElement>('.td-now')!;
    nowEl.style.top = pct(nowMin + p.second / 60);
    nowEl.firstElementChild!.textContent = hm(nowMs);
    this.fit();
  }

  // ------------------------------------------------------------------------------------------------ Per person
  private columns(): PublicCalendarSource[] {
    const srcs = ctx.cfg.calendar.sources || [];
    const want = ctx.params.get('people')?.split(',').filter(Boolean) ?? ctx.cfg.layout.people;
    // a list (even an empty one, "nothing ticked" in the admin) is used as is; null means automatic
    if (Array.isArray(want)) return want.map((id) => srcs.find((s) => s.id === id)).filter((s): s is PublicCalendarSource => !!s).slice(0, 5);
    return srcs.filter((s) => s.kind !== 'holidays' && s.kind !== 'birthdays').slice(0, 5);
  }

  private people(d: ViewData, tick: Tick): void {
    const { t } = ctx;
    const today = tick.dayKey, tomorrow = addDays(today, 1);
    const nowMs = tick.now.getTime();
    const cols = this.columns();
    const inCols = new Set(cols.map((s) => s.id));
    this.root.style.setProperty('--pp-n', String(Math.max(1, cols.length)));
    this.root.classList.toggle('pp-many', cols.length >= 4);

    // shared things (holidays, birthdays, calendars without a column): one line above the columns
    const shared = [today, tomorrow].flatMap((key) =>
      d.events
        .filter((e) => !inCols.has(e.ev.sourceId) && e.startKey === key && (e.allDay || e.ev.kind === 'holidays' || e.ev.kind === 'birthdays'))
        .map((e) => `<span class="pp-chip" style="${colStyle(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<b>${esc(e.title)}</b><em>${esc(relativeDayLabel(ctx.lang, key, today))}</em></span>`),
    );
    const sharedEl = this.root.querySelector<HTMLElement>('.pp-shared')!;
    setHTML(sharedEl, shared.length ? `<span class="pp-who">${esc(t('everyone'))}</span>${shared.join('')}` : '');
    sharedEl.style.display = shared.length ? '' : 'none';

    const row = (e: NEvent, key: string) => {
      if (e.bar) {
        const note = barNote(e, key);
        return `<div class="pp-ev allday" style="${colStyle(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<span class="pp-tt">${esc(e.title)}</span>${note ? `<em>${esc(note)}</em>` : ''}</div>`;
      }
      const past = e.endMs <= nowMs, on = e.startMs <= nowMs && e.endMs > nowMs;
      return `<div class="pp-ev${past ? ' past' : ''}${on ? ' ongoing' : ''}" style="${colStyle(e.color)}"><b class="pp-tm">${esc(hm(e.startMs))}</b>${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<span class="pp-tt">${esc(e.title)}</span></div>`;
    };
    const section = (s: PublicCalendarSource, key: string) => {
      const list = [...allDayOn(d.events, key), ...timedOn(d.events, key)].filter((e) => e.ev.sourceId === s.id);
      const body = list.length ? list.map((e) => row(e, key)).join('') : `<div class="pp-none">${esc(t('nothingPlanned'))}</div>`;
      return `<div class="pp-sec${key === today ? ' is-today' : ''}"><div class="pp-day">${esc(relativeDayLabel(ctx.lang, key, today, false))}</div><div class="pp-list">${body}</div><div class="pp-more"></div></div>`;
    };
    const html = cols.length
      ? cols.map((s) => {
          const initial = (s.name.trim()[0] || '?').toUpperCase();
          return `<div class="pp-col" style="${colStyle(s.color)}"><div class="pp-head"><span class="pp-av">${s.emoji ? esc(s.emoji) : esc(initial)}</span><span class="pp-name">${esc(s.name)}</span></div>${section(s, today)}${section(s, tomorrow)}</div>`;
        }).join('')
      : `<div class="pp-empty">${esc(t('noPeople'))}</div>`;
    setHTML(this.root.querySelector('.pp-cols')!, html);
    this.fit();
  }

  private fitPeople(): void {
    for (const col of Array.from(this.root.querySelectorAll<HTMLElement>('.pp-col'))) {
      const rows = Array.from(col.querySelectorAll<HTMLElement>('.pp-ev'));
      for (const r of rows) r.classList.remove('fit-hide');
      for (const m of Array.from(col.querySelectorAll<HTMLElement>('.pp-more'))) m.textContent = '';
      const visible = (sel: string) => Array.from(col.querySelectorAll<HTMLElement>(sel)).filter((r) => !r.classList.contains('fit-hide'));
      // what is over first (oldest first), then tomorrow from the end, then today from the end
      fitRows(
        col,
        () => visible('.is-today .pp-ev.past')[0] ?? visible('.pp-sec:not(.is-today) .pp-ev').pop() ?? visible('.is-today .pp-ev').pop() ?? null,
        (r) => {
          const sec = r.closest('.pp-sec')!;
          const n = sec.querySelectorAll('.pp-ev.fit-hide:not(.past)').length;
          sec.querySelector('.pp-more')!.textContent = n ? ctx.t('more', { n }) : '';
        },
      );
    }
  }

}

function sourceName(e: NEvent): string {
  const s = ctx.cfg.calendar.sources?.find((x) => x.id === e.ev.sourceId);
  return s && s.kind !== 'holidays' ? s.name : '';
}
