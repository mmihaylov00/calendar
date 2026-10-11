import { appBase, appUrl } from '../../shared/path';
import { useEffect, useState } from 'preact/hooks';
import { slugify, SLUG_RE } from '../../shared/screens';
import type { DisplayInfo, ScreenProfile } from '../../shared/types';
import { api, ApiError } from '../api';
import { openPairDialog, shareOrigin } from '../components/DisplayAccess';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Field, Modal, PageHeader, ReorderButtons, Select, TextInput } from '../components/ui';
import { atLimit, limit } from '../caps';
import { screenHref, useDisplayLinks } from '../displayLinks';
import { LimitNote } from '../components/LimitNote';
import { t } from '../i18n';
import { takeIntent } from '../intent';
import { clone, moveItem, uid } from '../util';
import { withPollNote } from '../liveNote';
import type { SectionProps } from './common';

const PRESET_LABEL: Record<string, string> = { bigCalendar: 'Big calendar', leftRight: 'Left / right', topBottom: 'Top / bottom', bigTime: 'Big clock', agenda: 'Agenda', today: 'Today', people: 'Per person', photoFrame: 'Photo frame', twoWeeks: 'Two weeks', board: 'Board', bedside: 'Bedside' };

function uniqueSlug(base: string, taken: Set<string>) {
  let s = slugify(base) || 'screen';
  for (let i = 2, b = s; taken.has(s); i++) s = `${b.slice(0, 29)}-${i}`;
  return s;
}

function NewScreenDialog({ screens, onClose, onCreate }: { screens: ScreenProfile[]; onClose: () => void; onCreate: (p: ScreenProfile) => void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const taken = new Set(screens.map((s) => s.slug));
  const slug = uniqueSlug(name || 'screen', taken);
  const SUGGEST = ['Kitchen', 'Hall', 'Office', 'Bedroom', 'Kids room'];
  const create = async (e?: Event) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    let p: ScreenProfile;
    const src = screens.find((s) => s.id === from);
    if (src) {
      p = clone(src);
      p.id = uid('s');
    } else {
      try {
        p = await api.screenTemplate(name.trim());
      } catch {
        // Older server without the template endpoint: start from the first screen's settings.
        p = clone(screens[0]);
        p.id = uid('s');
      }
    }
    p.name = name.trim();
    p.slug = taken.has(p.slug) || !SLUG_RE.test(p.slug) || src ? slug : p.slug;
    if (screens.some((s) => s.id === p.id)) p.id = uid('s');
    setBusy(false);
    onCreate(p);
  };
  return (
    <Modal
      title={t('New screen')}
      icon="monitor"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon="plus" loading={busy} disabled={!name.trim()} onClick={create}>
            {t('Create screen')}
          </Button>
        </>
      }
    >
      <form class="stack" onSubmit={create}>
        <Field label={t('Name')} hint={name ? `${t('Address')}: /?screen=${slug}` : t('For example: Kitchen, Hall…')}>
          <TextInput value={name} onValue={setName} placeholder={t('Kitchen')} maxLength={60} />
        </Field>
        <div class="quick-add">
          {SUGGEST.filter((s) => !screens.some((x) => x.name.toLowerCase() === t(s).toLowerCase())).map((s) => (
            <button type="button" class="pill" onClick={() => setName(t(s))}>
              {t(s)}
            </button>
          ))}
        </div>
        <Field label={t('Start from')}>
          <Select value={from} options={[{ value: '', label: t('Default settings') }, ...screens.map((s) => ({ value: s.id, label: t('Copy of {name}', { name: s.name }) }))]} onChange={setFrom} />
        </Field>
        <p class="muted small">{t('Calendars, birthdays, filters and alerts are shared by all screens; each screen has its own layout, background, view and widgets.')}</p>
      </form>
    </Modal>
  );
}

export function ScreensSection({ full, setFull, saved, screenId, setScreenId, go, dirty, save }: SectionProps) {
  const [creating, setCreating] = useState(() => takeIntent('screens', 'new'));
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    api
      .displays()
      .then((r) => setDisplays(r.displays))
      .catch(() => {});
  }, []);
  // Private mode (default): a device opens its screen's private link or is paired; ?screen= only works in open mode
  // (and in this admin's own previews).
  const homeAssistant = !!appBase();
  const openMode = homeAssistant || saved.security?.displayAccess === 'open';
  const linkState = useDisplayLinks(saved);
  const links = linkState.data;
  const screens = full.screens;
  const taken = (exceptId: string) => new Set(screens.filter((s) => s.id !== exceptId).map((s) => s.slug));
  const upd = (id: string, fn: (s: ScreenProfile) => void) =>
    setFull((d) => {
      const s = d.screens.find((x) => x.id === id);
      if (s) fn(s);
    });
  const move = (a: number, b: number) => setFull((d) => void (d.screens = moveItem(d.screens, a, b)));
  const origin = openMode ? location.origin : shareOrigin(links) || location.origin;
  const linkOf = (id: string) => links?.links.find((l) => l.screenId === id);

  const duplicate = (s: ScreenProfile) => {
    if (atLimit('screens', screens.length)) return toast(t('Maximum {n} screens', { n: limit('screens') ?? screens.length }), 'error');
    const p = clone(s);
    p.id = uid('s');
    p.name = t('{name} (copy)', { name: s.name }).slice(0, 60);
    p.slug = uniqueSlug(p.name, taken(''));
    setFull((d) => void d.screens.splice(d.screens.findIndex((x) => x.id === s.id) + 1, 0, p));
    setScreenId(p.id);
    toast(t('Screen duplicated · save to apply'), 'info');
  };

  const remove = async (s: ScreenProfile) => {
    if (screens.length <= 1) return;
    const n = displays.filter((d) => d.connected && d.screenId === s.id).length;
    // Scheduled messages that only target this screen: an empty list would mean "all screens",
    // so they get disabled instead (the server applies the same rule on save/import).
    const orphans = full.schedules.items.filter((m) => m.screenIds.length > 0 && m.screenIds.every((x) => x === s.id));
    const ok = await confirmDialog({
      title: t('Delete screen “{name}”', { name: s.name }),
      body: (
        <>
          <p>{t('Its layout and settings will be deleted. Calendars and other shared content are kept.')}</p>
          {n > 0 && <p class="err-text">{t('{n} connected screens use it: they will switch to the default screen.', { n })}</p>}
          {orphans.length > 0 && (
            <>
              <p class="err-text">{t('These scheduled messages only show on this screen and will be disabled:')}</p>
              <ul>
                {orphans.map((m) => (
                  <li key={m.id}>{`${m.emoji ? m.emoji + ' ' : ''}${m.title || t('(untitled)')}`}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ),
      confirm: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    setFull((d) => {
      d.screens = d.screens.filter((x) => x.id !== s.id);
      if (d.defaultScreen === s.id) d.defaultScreen = d.screens[0].id;
      for (const m of d.schedules.items) {
        const keep = m.screenIds.filter((x) => x !== s.id);
        if (m.screenIds.length && !keep.length) m.enabled = false;
        m.screenIds = keep;
      }
    });
    if (screenId === s.id) setScreenId(screens.find((x) => x.id !== s.id)!.id);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Copied'), 'ok', 1500);
    } catch {
      toast(text, 'info', 6000);
    }
  };

  const reload = async (s: ScreenProfile) => {
    try {
      await api.refreshDisplays([s.id]);
      toast(withPollNote(t('Reloading {name}…', { name: s.name })), 'info');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <>
      <PageHeader title={t('Screens')} desc={
          homeAssistant ? t('Each screen has its own layout and widgets. Open a screen from Home Assistant using your administrator account.') : openMode
            ? t('Each screen (living room, kitchen, hall…) has its own layout and widgets. Open /?screen=<address> on each device.')
            : t('Each screen (living room, kitchen, hallway…) has its own layout and widgets. Each device opens its screen’s private link or is paired with a code.')
        }>
        <Button variant="primary" icon="plus" disabled={atLimit('screens', screens.length)} onClick={() => setCreating(true)}>
          {t('New screen')}
        </Button>
      </PageHeader>
      <LimitNote name="screens" count={screens.length} />
      <div class="screen-cards" id="scr-list">
        {screens.map((s, i) => {
          const isDefault = s.id === full.defaultScreen;
          const isNew = !saved.screens.some((x) => x.id === s.id);
          const savedSlug = saved.screens.find((x) => x.id === s.id)?.slug;
          const slugChanged = !!savedSlug && savedSlug !== s.slug;
          const slugOk = SLUG_RE.test(s.slug) && !taken(s.id).has(s.slug);
          const ds = displays.filter((d) => d.screenId === s.id);
          const on = ds.filter((d) => d.connected).length;
          const link = linkOf(s.id);
          // Copy: open mode → the ?screen= address; private → the screen's private link (none until saved).
          const url = openMode ? `${origin}${appUrl('/')}?screen=${s.slug}` : link ? `${origin}${appUrl(link.path)}` : '';
          return (
            <section class={`screen-card ${s.id === screenId ? 'is-current' : ''}`} style={{ '--sc': s.screen.accent } as any} key={s.id}>
              <div class="screen-card__thumb" aria-hidden="true">
                <div class={`mini-layout mini-layout--${s.layout.preset} ${s.layout.sidePanel === 'right' ? 'is-right' : ''} ${s.screen.theme === 'light' ? 'is-light' : ''} ${s.screen.orientation === 'portrait' ? 'is-portrait' : ''}`}>
                  <span class="ml-a" />
                  <span class="ml-b" />
                  <span class="ml-c" />
                </div>
              </div>
              <div class="screen-card__body">
                <div class="screen-card__head">
                  <TextInput class="screen-card__name" value={s.name} maxLength={60} onValue={(v) => upd(s.id, (x) => void (x.name = v))} error={!s.name.trim()} />
                  {isDefault ? (
                    <span class="badge badge--accent" title={t('Shown when the URL names no screen')}>
                      ★ {t('Default')}
                    </span>
                  ) : (
                    <button type="button" class="link-btn small" onClick={() => setFull((d) => void (d.defaultScreen = s.id))}>
                      ☆ {t('Make default')}
                    </button>
                  )}
                  {isNew && <span class="badge badge--soft">{t('New')}</span>}
                </div>
                {openMode ? (
                  <div class="screen-card__slug">
                    <TextInput
                      mono
                      class="input--sm"
                      value={s.slug}
                      error={!slugOk}
                      prefix={<span class="mono small">?screen=</span>}
                      onValue={(v) => upd(s.id, (x) => void (x.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)))}
                    />
                    <button type="button" class="icon-btn" title={t('Generate from name')} onClick={() => upd(s.id, (x) => void (x.slug = uniqueSlug(x.name, taken(s.id))))}>
                      <Icon name="wand" size={15} />
                    </button>
                    <button type="button" class="icon-btn" title={t('Copy URL')} onClick={() => copy(url)}>
                      <Icon name="copy" size={15} />
                    </button>
                  </div>
                ) : (
                  // Private links: the screen's own link, read only, ready to copy (the slug does not open anything here)
                  <div class="screen-card__slug screen-card__link">
                    <input
                      class="input input--mono input--sm"
                      value={url}
                      readOnly
                      spellcheck={false}
                      aria-label={t('Private link')}
                      placeholder={isNew ? t('Save the screen to get its private link.') : t('Loading the link…')}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button type="button" class="btn btn--sm btn--ghost" title={url ? t('Copy private link') : t('Save the screen to get its private link.')} disabled={!url} onClick={() => copy(url)}>
                      <Icon name="copy" size={15} /> {t('Copy')}
                    </button>
                  </div>
                )}
                {openMode && !slugOk && <div class="field__error">{t('Only lowercase letters, numbers and hyphens; must be unique')}</div>}
                {openMode && slugChanged && slugOk && <div class="field__hint warn-text">{t('Screens using ?screen={old} will show the default screen until you change their URL.', { old: savedSlug! })}</div>}
                <div class="screen-card__meta">
                  <span>
                    <Icon name="layout" size={13} /> {t(PRESET_LABEL[s.layout.preset] ?? s.layout.preset)}
                  </span>
                  <span>{s.screen.language.toUpperCase()}</span>
                  <span>{s.screen.theme === 'light' ? t('Light') : t('Dark')}</span>
                  <span>{s.calendar.sourceIds === null ? t('All calendars') : t('{n} calendars', { n: s.calendar.sourceIds.length })}</span>
                  <span class={on ? 'ok-text' : 'muted'}>
                    <Icon name={on ? 'wifi' : 'wifiOff'} size={13} /> {on ? t('{n} online', { n: on }) : ds.length ? t('offline') : t('no devices')}
                  </span>
                </div>
                <div class="screen-card__actions">
                  <Button
                    size="sm"
                    variant={s.id === screenId ? 'primary' : 'default'}
                    icon="edit"
                    onClick={() => {
                      setScreenId(s.id);
                      go('layout');
                    }}
                  >
                    {s.id === screenId ? t('Editing') : t('Edit')}
                  </Button>
                  <Button size="sm" variant="ghost" icon="copy" disabled={atLimit('screens', screens.length)} onClick={() => duplicate(s)}>
                    {t('Duplicate')}
                  </Button>
                  {screenHref(saved, s.id, linkState) && (
                    <a class="btn btn--ghost btn--sm" href={screenHref(saved, s.id, linkState)!} target="_blank" rel="noopener">
                      <Icon name="external" size={15} />
                      <span>{t('Open')}</span>
                    </a>
                  )}
                  {on > 0 && (
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => reload(s)}>
                      {t('Reload')}
                    </Button>
                  )}
                  <span class="screen-card__tail">
                    <ReorderButtons index={i} count={screens.length} onMove={move} />
                    <button type="button" class="icon-btn icon-btn--danger" disabled={screens.length <= 1} title={screens.length <= 1 ? t('At least one screen must remain') : t('Delete')} onClick={() => remove(s)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      {dirty && screens.some((s) => !saved.screens.some((x) => x.id === s.id)) && (
        <Callout kind="info">
          {t('New screens exist once you save.')}{' '}
          <button type="button" class="link-btn" onClick={() => save()}>
            {t('Save now')}
          </button>
        </Callout>
      )}
      <Card title={t('How to assign a screen to a device')} icon="info" muted={false}>
        {homeAssistant && <Callout>{t('Open Calendar from the Home Assistant sidebar, then use the screen’s Open button. Home Assistant handles sign-in; no separate pairing code is needed.')}</Callout>}
        {!openMode ? (
          <ol class="howto">
            <li>
              {t('On the device, open its screen’s private link (copy button above, or')}{' '}
              <button type="button" class="link-btn" onClick={() => go('screen/scr-link')}>
                {t('Screen → Settings → Private link')}
              </button>
              {t(', with its QR code).')}
            </li>
            <li>
              {t('Or open')} <code>{origin}/</code> {t('on the device and pair it with the code it shows:')}{' '}
              <button type="button" class="link-btn" onClick={() => openPairDialog()}>
                {t('Pair a screen')}
              </button>
              .
            </li>
            <li>
              {t('Check what each device shows in')} <a href="#/displays">{t('Connected screens')}</a>.
            </li>
          </ol>
        ) : (
        <ol class="howto">
          <li>
            {t('Open in the device browser')} <code>{origin}{appUrl('/')}?screen={t('kitchen')}</code> {t('(replace “{slug}” with the screen address).', { slug: t('kitchen') })}
          </li>
          <li>
            {t('Without ?screen= the default screen (★) is shown. Check what each device shows in')}{' '}
            <a href="#/displays">{t('Connected screens')}</a>.
          </li>
        </ol>
        )}
      </Card>
      {creating && (
        <NewScreenDialog
          screens={screens}
          onClose={() => setCreating(false)}
          onCreate={(p) => {
            if (atLimit('screens', screens.length)) return toast(t('Maximum {n} screens', { n: limit('screens') ?? screens.length }), 'error');
            setFull((d) => void d.screens.push(p));
            setScreenId(p.id);
            setCreating(false);
            toast(t('Screen “{name}” created · save to apply', { name: p.name }), 'ok');
          }}
        />
      )}
    </>
  );
}
