// HA calendar entities include Google calendars connected through HA's native integration.
import { haGet } from './homeassistant.js';
import { CALENDAR_ENTITY_RE, calendarToRaw } from './core/haCalendars.js';

export { calendarToRaw };

export async function listCalendars() {
  let calendars;
  try { calendars = await haGet('/api/calendars'); } catch (err) {
    if (err.status === 404) return []; // The calendar integration has not been set up yet.
    throw err;
  }
  if (!Array.isArray(calendars) || calendars.some((c) => !c || !CALENDAR_ENTITY_RE.test(c.entity_id) || typeof c.name !== 'string')) {
    throw new Error('Home Assistant returned an invalid calendar list');
  }
  return calendars.map(({ entity_id, name }) => ({ entity_id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listEvents(entityId, start, end) {
  if (!CALENDAR_ENTITY_RE.test(entityId)) throw new Error('A calendar entity id is required');
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const events = await haGet(`/api/calendars/${encodeURIComponent(entityId)}?${params}`);
  if (!Array.isArray(events)) throw new Error('Home Assistant returned an invalid calendar event list');
  // A malformed response must not replace the last good source cache.
  events.forEach(calendarToRaw);
  return events;
}
