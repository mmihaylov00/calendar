import { useMemo, useState } from 'preact/hooks';
import { confirmDialog } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Card, Chips, ColorPicker, EmojiPicker, Empty, Field, PageHeader, ReorderButtons, Select, useReorder } from '../components/ui';
import { t } from '../i18n';
import { clone, DEFAULT_ICON_RULES, matchIconRule, moveItem, resolveEmoji, uid } from '../util';
import type { SectionProps } from './common';

export function IconRulesSection({ cfg, set, errors }: SectionProps) {
  const rules = cfg.calendar.iconRules;
  const sources = cfg.calendar.sources;
  const [sample, setSample] = useState('');
  const [sampleSrc, setSampleSrc] = useState<string>(sources[0]?.id ?? '');
  const src = sources.find((s) => s.id === sampleSrc);
  const match = useMemo(() => matchIconRule(rules, sample), [rules, sample]);
  const emoji = resolveEmoji(rules, src, sample);
  const color = match?.rule.color || src?.color || cfg.screen.accent;

  const move = (from: number, to: number) => set((d) => void (d.calendar.iconRules = moveItem(d.calendar.iconRules, from, to)));
  const reorder = useReorder(move);

  const restore = async () => {
    const ok = await confirmDialog({
      title: t('Restore default rules'),
      body: t('Your current rules will be replaced by the defaults.'),
      confirm: t('Restore'),
      danger: true,
    });
    if (ok) set((d) => void (d.calendar.iconRules = clone(DEFAULT_ICON_RULES)));
  };

  return (
    <>
      <PageHeader title={t('Automatic icons')} desc={t('Rules that add an emoji (and optionally a colour) based on the event title. Evaluated in order: the first match wins.')}>
        <Button variant="ghost" icon="refresh" onClick={restore}>
          {t('Restore defaults')}
        </Button>
      </PageHeader>

      <Card id="ico-tester" title={t('Test rules')} icon="wand" class="tester">
        <div class="tester__row">
          <Field label={t('Event title')} class="tester__input">
            <input class="input input--lg" value={sample} placeholder={t('Type an event title…')} onInput={(e) => setSample(e.currentTarget.value)} />
          </Field>
          {sources.length > 0 && (
            <Field label={t('Calendar')} class="tester__src">
              <Select value={sampleSrc} options={[{ value: '', label: t('(none)') }, ...sources.map((s) => ({ value: s.id, label: `${s.emoji || ''} ${s.name}`.trim() }))]} onChange={setSampleSrc} />
            </Field>
          )}
        </div>
        <div class="tester__preview">
          <div class="event-pill" style={{ '--ev': color } as any}>
            <span class="event-pill__emoji">{emoji || '·'}</span>
            <span class="event-pill__title">{sample || t('Untitled')}</span>
          </div>
          <div class="tester__why small muted">
            {match ? (
              <>
                {t('Rule #{n} · matches', { n: match.index + 1 })} <span class="chip chip--static">{match.keyword}</span>
              </>
            ) : emoji ? (
              t('No rule: the calendar’s emoji is used')
            ) : (
              t('No rule matches')
            )}
          </div>
        </div>
      </Card>

      <Card
        title={t('Rules')}
        id="ico-rules"
        scope="global"
        icon="tag"
        desc={t('{n} rules · case- and accent-insensitive', { n: rules.length })}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            onClick={() => set((d) => void d.calendar.iconRules.unshift({ id: uid('r'), match: [], emoji: '⭐', color: null }))}
          >
            {t('New rule')}
          </Button>
        }
      >
        {rules.length === 0 ? (
          <Empty icon="tag" title={t('No rules')}>
            {t('Add a rule or restore the defaults.')}
          </Empty>
        ) : (
          <div class="rule-list">
            {rules.map((r, i) => {
              const upd = (fn: (x: typeof r) => void) =>
                set((d) => {
                  const x = d.calendar.iconRules.find((y) => y.id === r.id);
                  if (x) fn(x);
                });
              const hit = match?.rule.id === r.id;
              return (
                <div key={r.id} class={`rule ${hit ? 'is-hit' : ''}`} {...(reorder.rowProps(i) as any)}>
                  <span class="grip" {...reorder.handleProps(i)}>
                    <Icon name="grip" size={16} />
                  </span>
                  <span class="rule__n">{i + 1}</span>
                  <EmojiPicker size="lg" value={r.emoji} error={!!errors[`rule.${r.id}.emoji`]} onChange={(v) => upd((x) => void (x.emoji = v))} />
                  <div class="rule__chips">
                    <Chips
                      values={r.match}
                      error={!!errors[`rule.${r.id}.match`]}
                      placeholder={t('Keywords (Enter or comma to add)')}
                      onChange={(v) => upd((x) => void (x.match = v))}
                    />
                  </div>
                  <ColorPicker compact allowNone value={r.color} onChange={(v) => upd((x) => void (x.color = v))} />
                  <ReorderButtons index={i} count={rules.length} onMove={move} />
                  <button
                    type="button"
                    class="icon-btn icon-btn--danger"
                    aria-label={t('Delete')}
                    title={t('Delete')}
                    onClick={() => set((d) => void (d.calendar.iconRules = d.calendar.iconRules.filter((x) => x.id !== r.id)))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
