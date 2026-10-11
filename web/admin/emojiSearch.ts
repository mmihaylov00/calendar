// Emoji picker index and search. Pure functions (no imports at runtime) so the server tests can load them.

export type EmojiEntry = {
  e: string;
  /** English keywords; the first one is the name. */
  kw: string[];
  /** Folded words of every keyword. */
  words: string[];
};
export type EmojiSection = { id: string; icon: string; title: string; list: EmojiEntry[] };
export type EmojiIndex = { sections: EmojiSection[]; all: EmojiEntry[]; byEmoji: Map<string, EmojiEntry> };

/** Lowercase, no accents, no punctuation: "Piñata" and "pinata" match. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
export const looksLikeEmoji = (s: string) => EMOJI_RE.test(s);

function parse(item: string): EmojiEntry {
  const sp = item.indexOf(' ');
  const e = item.slice(0, sp);
  const kw = item.slice(sp + 1).split(',').map((k) => k.trim()).filter(Boolean);
  const words = [...new Set(kw.flatMap((k) => foldText(k).split(' ')).filter(Boolean))];
  return { e, kw, words };
}

/**
 * Builds the index from the category data. `frequent` becomes a first section (emojis that are
 * not in the data still show, without keywords).
 */
export function buildEmojiIndex(
  cats: { id: string; icon: string; title: string; items: string[] }[],
  frequent: { id: string; icon: string; title: string; emojis: string[] },
): EmojiIndex {
  const byEmoji = new Map<string, EmojiEntry>();
  const sections: EmojiSection[] = cats.map((c) => ({
    id: c.id,
    icon: c.icon,
    title: c.title,
    list: c.items.map((it) => {
      const en = parse(it);
      if (!byEmoji.has(en.e)) byEmoji.set(en.e, en);
      return en;
    }),
  }));
  const all = [...byEmoji.values()];
  const freq: EmojiSection = {
    id: frequent.id,
    icon: frequent.icon,
    title: frequent.title,
    list: frequent.emojis.map((e) => byEmoji.get(e) ?? { e, kw: [], words: [] }),
  };
  return { sections: [freq, ...sections], all, byEmoji };
}

export function emojiName(entry: EmojiEntry | undefined): string {
  return entry?.kw[0] ?? entry?.e ?? '';
}

/** Lower is better; -1 when the token does not match any word. */
function tokenScore(words: string[], tok: string): number {
  let best = -1;
  for (const w of words) {
    let s = -1;
    if (w === tok) s = 0;
    else if (w.startsWith(tok)) s = 1;
    else if (tok.length >= 3 && w.includes(tok)) s = 3;
    if (s >= 0 && (best < 0 || s < best)) best = s;
    if (best === 0) break;
  }
  return best;
}

/**
 * Every word of the query has to match the start of a keyword word (or, from 3 letters, the
 * middle of one).
 */
export function searchEmoji(index: EmojiIndex, query: string): EmojiEntry[] {
  const raw = query.trim();
  if (!raw) return [];
  const exact = index.byEmoji.get(raw);
  const toks = foldText(raw).split(' ').filter(Boolean);
  if (!toks.length) return exact ? [exact] : [];
  const scored: { en: EmojiEntry; s: number; i: number }[] = [];
  index.all.forEach((en, i) => {
    let score = 0;
    for (const tok of toks) {
      const s = tokenScore(en.words, tok);
      if (s < 0) return;
      score += s;
    }
    scored.push({ en, s: score, i });
  });
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  const out = scored.map((x) => x.en);
  if (exact && !out.includes(exact)) out.unshift(exact);
  return out;
}
