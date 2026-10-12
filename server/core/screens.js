// Screen profiles (F1): resolve ?screen=, project the v2 config into the flat per-screen view that the display
// (and the legacy single-screen code paths) understand. Pure functions. See docs/API.md and docs/ARCHITECTURE.md.
// Mirror for the admin panel: web/shared/screens.ts (keep both in sync).
import { SCREEN_SPLIT_KEYS, SCREEN_ONLY_KEYS } from './defaults.js';

/** Default screen profile (cfg.defaultScreen, falling back to the first one). */
export function defaultScreen(cfg) {
  return cfg.screens.find((s) => s.id === cfg.defaultScreen) || cfg.screens[0];
}

/**
 * Find a screen by slug (case-insensitive) or id. Returns { screen, fallback } where `fallback` is true when
 * `key` was given but matched nothing (the default screen is returned then). Empty key → default, fallback false.
 */
export function resolveScreen(cfg, key) {
  const k = typeof key === 'string' ? key.trim().toLowerCase() : '';
  if (!k) return { screen: defaultScreen(cfg), fallback: false };
  const hit = cfg.screens.find((s) => s.slug === k || s.id.toLowerCase() === k);
  return hit ? { screen: hit, fallback: false } : { screen: defaultScreen(cfg), fallback: true };
}

/**
 * Flat (v1-shaped) view of one screen: global sections merged with that screen's per-screen sections.
 * `screen.name` = profile name. Includes every global key too (localEvents, birthdays, …).
 */
export function flatView(cfg, screen) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) if (k !== 'screens') out[k] = v;
  for (const k of SCREEN_ONLY_KEYS) out[k] = screen[k];
  out.screen = { name: screen.name, ...screen.screen };
  for (const k of Object.keys(SCREEN_SPLIT_KEYS)) out[k] = { ...cfg[k], ...screen[k] };
  out.screenId = screen.id;
  out.slug = screen.slug;
  return out;
}

/** Enabled remote calendar sources visible on a screen. */
export function screenSourceIds(cfg, screen) {
  const ids = cfg.calendar.sources.filter(s => s.enabled).map(s => s.id);
  if (!screen) return ids;
  if (!screen.calendar.enabled) return [];
  const only = screen.calendar.sourceIds;
  return Array.isArray(only) ? ids.filter(id => only.includes(id)) : ids;
}

export function publicSources(cfg, screen) {
  const visible = new Set(screenSourceIds(cfg, screen));
  return cfg.calendar.sources.filter(s => visible.has(s.id))
    .map(({ id, name, color, emoji, kind }) => ({ id, name, color, emoji, kind }));
}

/** Public config: no provider URLs, secrets, HA entity ids or retired widgets. */
export function displayConfig(cfg, screen, { fallback = false } = {}) {
  const f = flatView(cfg, screen);
  const { sources, sourceIds, ...calendar } = f.calendar;
  const { haWeatherEntity, haIndoorTempEntity, haIndoorHumidityEntity, ...weather } = f.weather;
  return {
    revision: cfg.revision, screenId: screen.id, slug: screen.slug, screenFallback: fallback,
    screen: f.screen, layout: f.layout, background: f.background,
    calendar: { ...calendar, sources: publicSources(cfg, screen) },
    datetime: f.datetime, weather,
  };
}
