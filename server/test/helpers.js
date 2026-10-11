import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ICON_RULES } from '../core/defaults.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => fs.readFileSync(path.join(dir, 'fixtures', name), 'utf8');
// The regression calendars keep their original titles; fixture keywords are not shipped defaults.
const FIXTURE_KEYWORDS = { r_birthday: ['cumple'], r_doctor: ['dentista', 'médico'], r_dinner: ['cena'], r_vacation: ['vacaciones'], r_flight: ['vuelo'] };
export const RULES = DEFAULT_ICON_RULES.map((r) => ({ ...r, match: [...r.match, ...(FIXTURE_KEYWORDS[r.id] || [])] }));
