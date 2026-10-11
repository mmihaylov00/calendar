import { useState } from 'preact/hooks';
import type { NewsFeed, TestRssResponse } from '../../shared/types';
import { api, ApiError } from '../api';
import { fetchErrorText } from '../apiErrors';
import { Icon } from '../components/icons';
import { Button, Card, EmojiPicker, Empty, Field, NumberInput, PageHeader, ReorderButtons, Slider, Textarea, TextInput, Toggle, ToggleRow } from '../components/ui';
import { ScopeBadge } from '../components/ui';
import { atLimit } from '../caps';
import { LimitNote } from '../components/LimitNote';
import { t } from '../i18n';
import { isHttpUrl, moveItem, uid } from '../util';
import type { SectionProps } from './common';

function FeedRow({ f, i, n, errors, upd, remove, move }: { f: NewsFeed; i: number; n: number; errors: Record<string, string>; upd: (fn: (x: NewsFeed) => void) => void; remove: () => void; move: (a: number, b: number) => void }) {
  const [test, setTest] = useState<{ loading: boolean; res?: TestRssResponse }>({ loading: false });
  const valid = isHttpUrl(f.url);
  const run = async () => {
    setTest({ loading: true });
    try {
      setTest({ loading: false, res: await api.testRss(f.url.trim()) });
    } catch (e) {
      setTest({ loading: false, res: { ok: false, error: (e as ApiError).message } });
    }
  };
  return (
    <div class={`feed ${f.enabled ? '' : 'is-off'}`}>
      <div class="feed__row">
        <TextInput class="feed__name" value={f.name} placeholder={t('Name')} error={!!errors[`feed.${f.id}.name`]} onValue={(v) => upd((x) => void (x.name = v))} />
        <TextInput
          class="feed__url"
          mono
          value={f.url}
          placeholder="https://…/rss"
          error={!!errors[`feed.${f.id}.url`]}
          onValue={(v) => {
            upd((x) => void (x.url = v));
            setTest({ loading: false });
          }}
          suffix={
            f.url ? (
              <span class={valid ? 'ok-text' : 'err-text'}>
                <Icon name={valid ? 'check' : 'x'} size={14} />
              </span>
            ) : undefined
          }
        />
        <Button size="sm" icon="play" disabled={!valid} loading={test.loading} onClick={run}>
          {t('Test')}
        </Button>
        <Toggle checked={f.enabled} onChange={(v) => upd((x) => void (x.enabled = v))} label={t('Enabled')} />
        <ReorderButtons index={i} count={n} onMove={move} />
        <button type="button" class="icon-btn icon-btn--danger" onClick={remove} aria-label={t('Delete')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      {test.res && (
        <div class={`test-result ${test.res.ok ? 'is-ok' : 'is-err'}`}>
          {test.res.ok ? (
            <span>
              <Icon name="check" size={14} /> <strong>{test.res.title || f.name}</strong> · {t('{n} items', { n: test.res.count ?? 0 })}
            </span>
          ) : (
            <span>
              <Icon name="alert" size={14} /> {fetchErrorText(test.res.error) || t('Invalid feed')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function NewsSection({ cfg, set, errors }: SectionProps) {
  const n = cfg.news;
  const move = (a: number, b: number) => set((d) => void (d.news.feeds = moveItem(d.news.feeds, a, b)));
  return (
    <>
      <PageHeader title={t('News')} desc={t('RSS headlines rotating on the screen.')} />
      <Card
        title={t('RSS feeds')}
        id="news-feeds"
        icon="news"
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={atLimit('newsFeeds', n.feeds.length)} onClick={() => set((d) => void d.news.feeds.push({ id: uid('n'), name: '', url: '', enabled: true }))}>
            {t('Add feed')}
          </Button>
        }
      >
        <ToggleRow label={<>{t('Show news')} <ScopeBadge scope="screen" /></>} checked={n.enabled} onChange={(v) => set((d) => void (d.news.enabled = v))} />
        <div class={`stack ${n.enabled ? '' : 'is-disabled'}`}>
          <LimitNote name="newsFeeds" count={n.feeds.length} />
          {n.feeds.length === 0 ? (
            <Empty icon="news" title={t('No feeds')}>
              {t('Add the RSS URL of your favourite newspaper.')}
            </Empty>
          ) : (
            n.feeds.map((f, i) => (
              <FeedRow
                key={f.id}
                f={f}
                i={i}
                n={n.feeds.length}
                errors={errors}
                move={move}
                remove={() => set((d) => void (d.news.feeds = d.news.feeds.filter((x) => x.id !== f.id)))}
                upd={(fn) =>
                  set((d) => {
                    const x = d.news.feeds.find((y) => y.id === f.id);
                    if (x) fn(x);
                  })
                }
              />
            ))
          )}
          <div class="grid grid--2">
            <Field label={<>{t('Change headline every')} <ScopeBadge scope="screen" /></>} error={errors['news.rotateSec']}>
              <Slider value={n.rotateSec} min={5} max={60} step={1} format={(v) => `${v} s`} onChange={(v) => set((d) => void (d.news.rotateSec = v))} />
            </Field>
            <Field label={t('Max. headlines')} error={errors['news.maxItems']}>
              <NumberInput value={n.maxItems} min={1} max={200} error={!!errors['news.maxItems']} onValue={(v) => set((d) => void (d.news.maxItems = v))} />
            </Field>
          </div>
        </div>
      </Card>
    </>
  );
}

export function TodoSection({ cfg, set }: SectionProps) {
  const td = cfg.todo;
  const [text, setText] = useState('');
  const add = (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    set((d) => void d.todo.items.push({ id: uid('t'), text: text.trim(), done: false }));
    setText('');
  };
  const move = (a: number, b: number) => set((d) => void (d.todo.items = moveItem(d.todo.items, a, b)));
  return (
    <>
      <PageHeader title={t('To-dos')} desc={t('A simple to-do list visible on the screen.')} />
      <Card title={t('To-do list')} icon="checklist">
        <ToggleRow label={<>{t('Show to-dos')} <ScopeBadge scope="screen" /></>} checked={td.enabled} onChange={(v) => set((d) => void (d.todo.enabled = v))} />
        <form class="search-row" onSubmit={add}>
          <TextInput value={text} onValue={setText} placeholder={t('New to-do…')} />
          <Button type="submit" variant="primary" icon="plus">
            {t('Add')}
          </Button>
        </form>
        {td.items.length === 0 ? (
          <Empty icon="checklist" title={t('Nothing pending')} />
        ) : (
          <ul class="todo-list">
            {td.items.map((it, i) => (
              <li key={it.id} class={it.done ? 'is-done' : ''}>
                <label class="todo-check">
                  <input type="checkbox" checked={it.done} onChange={(e) => set((d) => void (d.todo.items[i].done = e.currentTarget.checked))} />
                  <span class="check-box">
                    <Icon name="check" size={12} />
                  </span>
                </label>
                <input class="input input--bare" value={it.text} onInput={(e) => set((d) => void (d.todo.items[i].text = e.currentTarget.value))} />
                <ReorderButtons index={i} count={td.items.length} onMove={move} />
                <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Delete')} onClick={() => set((d) => void d.todo.items.splice(i, 1))}>
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {td.items.some((x) => x.done) && (
          <Button size="sm" variant="ghost" onClick={() => set((d) => void (d.todo.items = d.todo.items.filter((x) => !x.done)))}>
            {t('Clear completed')}
          </Button>
        )}
      </Card>
    </>
  );
}

export function MessageSection({ cfg, set }: SectionProps) {
  const m = cfg.message;
  return (
    <>
      <PageHeader scope="screen" title={t('Message')} desc={t('A custom highlighted notice on the screen.')} />
      <Card scope="screen" title={t('Custom message')} icon="message">
        <ToggleRow label={t('Show message')} checked={m.enabled} onChange={(v) => set((d) => void (d.message.enabled = v))} />
        <div class="message-editor">
          <EmojiPicker size="lg" value={m.emoji} allowNone onChange={(v) => set((d) => void (d.message.emoji = v))} />
          <Textarea value={m.text} rows={3} maxLength={280} placeholder={t('Welcome home! 🏡')} onValue={(v) => set((d) => void (d.message.text = v))} />
        </div>
        <div class="field__hint">{m.text.length}/280</div>
        {m.text && (
          <div class="message-preview">
            <span>{m.emoji}</span>
            <p>{m.text}</p>
          </div>
        )}
      </Card>
    </>
  );
}
