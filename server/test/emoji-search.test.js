// Admin emoji picker search (web/admin/emojiSearch.ts + emoji-data.ts, loaded through Node's TypeScript
// type stripping, so these tests are skipped on runtimes older than Node 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod = null;
let data = null;
try {
  mod = await import('../../web/admin/emojiSearch.ts');
  data = await import('../../web/admin/emoji-data.ts');
} catch {
  mod = null;
}
const opts = { skip: mod && data ? false : 'TypeScript imports need Node ≥ 22.18' };
const FREQ = ['🎂', '✈️', '⚽', '🏠'];
const index = () => mod.buildEmojiIndex(data.EMOJI_CATEGORIES, { id: 'frequent', icon: '⭐', title: 'Frequent', emojis: FREQ });
const first = (q) => mod.searchEmoji(index(), q).slice(0, 5).map((e) => e.e);

test('emoji data: unique English keywords, compact', opts, () => {
  const seen = new Set();
  for (const c of data.EMOJI_CATEGORIES) {
    for (const it of c.items) {
      const e = it.slice(0, it.indexOf(' '));
      assert.ok(!seen.has(e), `duplicate ${e}`);
      seen.add(e);
      const keywords = it.slice(it.indexOf(' ') + 1);
      assert.ok(keywords.trim(), it);
      assert.ok(!keywords.includes('|'), it);
    }
  }
  assert.ok(seen.size >= 350 && seen.size <= 460, `${seen.size} emojis`);
});

test('emoji search: English words, accents and ranking', opts, () => {
  assert.equal(first('birthday')[0], '🎂');
  assert.ok(first('AIRPLANE').includes('✈️'));
  assert.ok(first('pinata').includes('🪅'));
  assert.equal(first('football')[0], '⚽');
  assert.ok(first('birthday cake').includes('🎂'));
  assert.deepEqual(first('cumpleaños'), []);
  assert.deepEqual(first('futebol'), []);
  assert.deepEqual(first('zzqx'), []);
  assert.deepEqual(first('  '), []);
  assert.equal(first('🎂')[0], '🎂');
});

test('emoji names are English; frequent section comes first', opts, () => {
  const idx = index();
  assert.equal(idx.sections[0].id, 'frequent');
  assert.deepEqual(idx.sections[0].list.map((e) => e.e), FREQ);
  const cake = idx.byEmoji.get('🎂');
  assert.equal(mod.emojiName(cake), 'birthday cake');
  assert.ok(mod.looksLikeEmoji('🦩'));
  assert.ok(!mod.looksLikeEmoji('abc'));
});
