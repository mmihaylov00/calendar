// HA's REST event dates use the same exclusive end-date convention as Google and iCal.
import { isDateStr } from './lib/tz.js';
import { hash } from './lib/text.js';

export const CALENDAR_ENTITY_RE = /^calendar\.[a-z0-9_]+$/;

const validDate = (value) => isDateStr(value) && new Date(value).toISOString().slice(0, 10) === value;
const hasOffset = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value);

export function calendarToRaw(event) {
  if (!event || typeof event !== 'object') throw new Error('Home Assistant returned an invalid calendar event');
  const allDay = typeof event.start?.date === 'string';
  let start, end;
  if (allDay) {
    start = event.start.date;
    end = event.end?.date;
    if (!validDate(start) || !validDate(end) || end <= start) throw new Error('Home Assistant returned invalid all-day event dates');
  } else {
    start = new Date(event.start?.dateTime);
    end = new Date(event.end?.dateTime);
    if (!hasOffset(event.start?.dateTime) || !hasOffset(event.end?.dateTime) || !Number.isFinite(start.getTime())
      || !Number.isFinite(end.getTime()) || end < start) throw new Error('Home Assistant returned invalid timed event dates');
  }
  const title = typeof event.summary === 'string' ? event.summary : '';
  const location = typeof event.location === 'string' ? event.location : '';
  return {
    uid: typeof event.uid === 'string' ? event.uid : hash([title, event.start, event.end, location]),
    title, description: typeof event.description === 'string' ? event.description : '', location, allDay, start, end,
  };
}
