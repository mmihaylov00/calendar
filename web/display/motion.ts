// Pure helpers for the two calendar motions (no DOM, so the tests can load them with Node):
// - marquee: a title cut short slides left until its end shows, waits, slides back, waits, and so on; a chip title
//   clamped to a few lines scrolls up like film credits instead;
// - busy days: a month-grid day with more events than lanes pages through them.

/** Sliding speed in display units (1rem ≈ 10px at 1080p) per second: about 30px/s on a 1080p screen. */
export const MARQUEE_SPEED_U = 3;
/** Credits (clamped multi-line titles): each line moves up in this time, then stays this long before the next. */
export const CREDITS_STEP_MS = 700;
export const CREDITS_HOLD_MS = 1600;
/** Pause at each end of the slide. */
export const MARQUEE_PAUSE_MS = 2500;
/** Overflow (px) below which a title is left alone (sub-pixel rounding, a cut descender). */
export const MARQUEE_MIN_PX = 3;
/** At most this many titles move at once; ?lite=1 (Raspberry Pi) uses the lower one. */
export const MARQUEE_MAX = 40;
export const MARQUEE_MAX_LITE = 6;
/** Time each page of a busy day stays on screen. */
export const PAGE_MS = 8000;

export interface MarqueeTiming {
  /** one full cycle: pause, slide out, pause, slide back */
  duration: number;
  /** keyframe offsets (0..1) where the slide out starts, ends, and where the slide back starts */
  offsets: [number, number, number];
  /** pixels to slide (the hidden part of the title) */
  distance: number;
}

/**
 * Timing of the ping-pong slide for a title that overflows its box by `overflowPx`, on a screen whose display unit
 * (the root font size) is `unitPx`. Returns null when the title fits.
 */
export function marqueeTiming(overflowPx: number, unitPx: number, pauseMs = MARQUEE_PAUSE_MS): MarqueeTiming | null {
  if (!(overflowPx >= MARQUEE_MIN_PX)) return null;
  const speed = Math.max(8, MARQUEE_SPEED_U * (unitPx > 0 ? unitPx : 10)); // px per second
  const distance = Math.ceil(overflowPx);
  const move = Math.max(600, (distance / speed) * 1000);
  const duration = Math.round(2 * pauseMs + 2 * move);
  const a = pauseMs / duration;
  const b = (pauseMs + move) / duration;
  const c = (2 * pauseMs + move) / duration;
  return { duration, offsets: [a, b, c], distance };
}

export interface CreditsTiming {
  duration: number;
  /** keyframes: where (0..1) and how far up (px) the title is; each one starts an eased move to the next */
  frames: { offset: number; y: number }[];
  distance: number;
}

/**
 * A title clamped to a few lines scrolls up like film credits, one line at a time: wait, move up a line, stay, ...,
 * until the last line shows; wait there, glide back to the start (at the side slide's speed). `linePx` is the
 * height of a line; the last step may be shorter. Null when the hidden part is too small to bother.
 */
export function creditsTiming(overflowPx: number, linePx: number, unitPx: number, pauseMs = MARQUEE_PAUSE_MS): CreditsTiming | null {
  if (!(overflowPx >= MARQUEE_MIN_PX)) return null;
  const distance = Math.ceil(overflowPx);
  const lh = linePx > 4 ? linePx : distance;
  const stops: number[] = [];
  for (let y = lh; y < distance - lh * 0.25; y += lh) stops.push(Math.round(y));
  stops.push(distance);
  const pts: [number, number][] = [[0, 0], [pauseMs, 0]];
  let t = pauseMs;
  stops.forEach((y, i) => {
    t += CREDITS_STEP_MS;
    pts.push([t, y]);
    t += i === stops.length - 1 ? pauseMs : CREDITS_HOLD_MS;
    pts.push([t, y]);
  });
  const speed = Math.max(8, MARQUEE_SPEED_U * (unitPx > 0 ? unitPx : 10));
  t += Math.max(600, (distance / speed) * 1000);
  pts.push([t, 0]);
  // offsets from the exact times (a line pitch is rarely a whole number of pixels), so the last one is exactly 1
  return { duration: Math.round(t), frames: pts.map(([ms, y]) => ({ offset: Math.min(1, ms / t), y })), distance };
}

/**
 * Most lines a one-day chip in a month cell may grow to: the whole free height of the day when it is the day's only
 * event, a couple of lines when it shares the day with others (Two weeks has taller rows: a few more).
 */
export function wrapLineCap(chipsThatDay: number, roomy: boolean, freeLanes: number): number {
  if (chipsThatDay <= 1) return Math.max(1, freeLanes);
  return roomy ? 4 : 2;
}

/** Start delay of the i-th moving title, so they do not all set off together (a few seconds apart, repeating). */
export function marqueeDelay(i: number): number {
  return 1200 + ((i * 1700) % 8500);
}

/** Indexes (in screen order) of the titles that may move, given which ones overflow and the budget. */
export function pickMovers(overflowing: boolean[], max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < overflowing.length && out.length < max; i++) if (overflowing[i]) out.push(i);
  return out;
}

export interface Paged<T> {
  item: T;
  page: number;
  lane: number;
}

/**
 * Spread the events of a busy day over pages. `freeLanes` are the lanes of that day not taken by bars that span
 * other days too (those stay put so they keep lining up). Every page fills the free lanes in order; the last page
 * may be shorter. Returns null when there is no free lane (nothing can rotate).
 */
export function planPages<T>(items: T[], freeLanes: number[]): { pages: number; placed: Paged<T>[] } | null {
  const k = freeLanes.length;
  if (!k) return null;
  const placed = items.map((item, i) => ({ item, page: Math.floor(i / k), lane: freeLanes[i % k] }));
  return { pages: Math.max(1, Math.ceil(items.length / k)), placed };
}

/** Page shown by a day with `pages` pages after `step` page turns. */
export function pageAt(step: number, pages: number): number {
  return pages > 1 ? ((step % pages) + pages) % pages : 0;
}

/** Text of the page indicator ("1/3"). */
export function pageLabel(page: number, pages: number): string {
  return `${page + 1}/${pages}`;
}
