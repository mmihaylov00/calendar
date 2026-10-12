import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig as serverValidate } from '../core/validate.js';
import { CONTRACT_PATH, contractText, generateContract } from '../../scripts/gen-contract.mjs';
import { loadWebModules } from './webModules.js';

const [capsMod, nav, util] = await loadWebModules('/web/admin/caps.ts', '/web/admin/navFilter.ts', '/web/admin/util.ts');
const capabilities = () => capsMod.capsFrom({ features: { gallery: true, homeassistant: true, passwordLogin: false } });
const baseConfig = () => ({ ...serverValidate({}).value, revision: 1 });
const source = (extra = {}) => ({ id: 'c_family', type: 'ics', name: 'Family', url: 'https://example.com/family.ics', color: '#336699', emoji: '', kind: 'generic', enabled: true, refreshMin: 5, ...extra });

test('navigation contains only calendar controls and defaults removed routes to Calendars', () => {
  assert.deepEqual(nav.NAV_ITEMS.map((item) => item.id), ['calendars', 'layout', 'background', 'weather', 'photos']);
  assert.equal(nav.routeFor('calendars', nav.NAV_ITEMS), 'calendars');
  assert.equal(nav.routeFor('layout', nav.NAV_ITEMS), 'layout');
  for (const removed of ['', 'home', 'screen', 'datetime', 'local', 'birthdays', 'filters', 'icons', 'countdowns', 'news', 'todo', 'message', 'alerts', 'homeassistant', 'api', 'screens', 'displays', 'backups', 'activity', 'security', 'status']) {
    assert.equal(nav.routeFor(removed, nav.NAV_ITEMS), 'calendars', removed);
  }
  const unavailable = capsMod.capsFrom({ features: { gallery: false } });
  assert.deepEqual(nav.filterNav(nav.NAV_ITEMS, unavailable).map((item) => item.id), ['calendars', 'layout', 'background', 'weather']);
  assert.equal(nav.routeFor('photos', nav.filterNav(nav.NAV_ITEMS, unavailable)), 'calendars');
});

test('capabilities reject invalid limits and retain validator source caps', () => {
  const caps = capsMod.capsFrom({ limits: { sources: 100, photos: -1 }, features: { gallery: false } });
  assert.equal(capsMod.limitOf(caps, 'sources'), 50);
  assert.equal(capsMod.hasFeature(caps, 'gallery'), false);
  assert.ok(!('photos' in caps.limits));
});

test('calendar validation preserves hidden ICS addresses but validates replacements', () => {
  const config = baseConfig();
  config.calendar.sources = [source({ url: '', urlHidden: true })];
  assert.equal(util.validateAll(config, capabilities()).total, 0);
  config.calendar.sources[0].url = 'not a URL';
  assert.ok(util.validateAll(config, capabilities()).global['source.c_family.url']);
  config.calendar.sources[0].url = '';
  config.calendar.sources[0].urlHidden = false;
  assert.ok(util.validateAll(config, capabilities()).global['source.c_family.url']);
});

test('managed HA calendar selection needs no manually configured address and preserves source data', () => {
  const previous = globalThis.location;
  globalThis.location = { pathname: '/api/hassio_ingress/app-token/admin/' };
  try {
    const config = baseConfig();
    config.homeassistant = { ...config.homeassistant, enabled: true, url: '' };
    config.calendar.sources = [source({ type: 'homeassistant', entityId: 'calendar.family', url: undefined })];
    const before = structuredClone(config);
    assert.equal(util.validateAll(config, capabilities()).total, 0);
    assert.deepEqual(config, before, 'validation does not mutate stored calendars or legacy sections');
    config.calendar.sources[0].entityId = 'sensor.family';
    assert.ok(util.validateAll(config, capabilities()).global['source.c_family.entityId']);
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});

test('calendar source limits are enforced and built-in removed widgets are not offered', () => {
  const config = baseConfig();
  config.calendar.sources = [source(), source({ id: 'c_work', name: 'Work' })];
  const limited = capsMod.capsFrom({ limits: { sources: 1 }, features: { passwordLogin: false } });
  assert.equal(util.validateAll(config, limited).global['limit.sources'], util.LIMIT_EXCEEDED);
  assert.deepEqual(util.allSourceOptions(config).map((item) => item.id), ['c_family', 'c_work']);
  config.calendar.sources[1].enabled = false;
  assert.deepEqual(util.allSourceOptions(config).map((item) => item.id), ['c_family']);
});

test('admin contract matches the reduced calendar and media API', () => {
  assert.equal(readFileSync(CONTRACT_PATH, 'utf8'), contractText(generateContract()), 'run npm run contract');
  const paths = generateContract().endpoints.map((endpoint) => endpoint.path);
  for (const retained of ['/api/auth/me', '/api/admin/config', '/api/admin/homeassistant/calendars', '/api/admin/photos']) assert.ok(paths.includes(retained), retained);
  for (const removed of ['/api/admin/displays', '/api/admin/backups', '/api/admin/password', '/api/admin/privacy', '/api/admin/update', '/api/admin/feedback', '/api/admin/announce', '/api/admin/tokens']) assert.ok(!paths.includes(removed), removed);
});
