import { useEffect, useState } from 'preact/hooks';
import type { AdminPhoto } from '../../shared/types';
import { api } from '../api';
import { Callout, Card, Field, PageHeader, Segmented, Select, Slider, TextInput, ToggleRow } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import type { SectionProps } from './common';

const INTERVALS = [30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 86400];

function intervalLabel(s: number) {
  if (s < 60) return t('{n} seconds', { n: s });
  if (s < 3600) return s === 60 ? t('1 minute') : t('{n} minutes', { n: s / 60 });
  if (s < 86400) return s === 3600 ? t('1 hour') : t('{n} hours', { n: s / 3600 });
  return t('1 day');
}

export function BackgroundSection({ cfg, set, errors }: SectionProps) {
  const b = cfg.background;
  const galleryOn = has('gallery');
  const usesGallery = galleryOn && b.source !== 'stock';
  const [gallery, setGallery] = useState<AdminPhoto[] | null>(null);
  useEffect(() => {
    if (usesGallery && gallery === null) api.photos().then(setGallery, () => setGallery([]));
  }, [usesGallery]);
  const inRotation = gallery?.filter((p) => !p.hidden).length ?? 0;
  const intervals = INTERVALS.includes(b.intervalSec) ? INTERVALS : [...INTERVALS, b.intervalSec].sort((a, c) => a - c);
  return (
    <>
      <PageHeader scope="screen" title={t('Background')} desc={t('Background photos and rotation.')} />
      <Card id="bg-photos" scope="screen" title={t('Background photos')} icon="image">
        <ToggleRow label={t('Show background photos')} checked={b.enabled} onChange={(v) => set((d) => void (d.background.enabled = v))} />
        <div class={`stack ${b.enabled ? '' : 'is-disabled'}`}>
          {(galleryOn || b.source !== 'stock') && (
            <Field label={t('Source')}>
              <Segmented
                full
                value={b.source}
                options={[
                  { value: 'stock', label: t('Stock'), icon: 'globe' },
                  { value: 'gallery', label: t('My gallery'), icon: 'photos' },
                  { value: 'mixed', label: t('Mixed'), icon: 'sparkles' },
                ]}
                onChange={(v) => set((d) => void (d.background.source = v))}
              />
              {!galleryOn && <Callout kind="warn">{t('{name} is not available here. Pick another option.', { name: t('Gallery') })}</Callout>}
            </Field>
          )}
          {(!galleryOn || b.source !== 'gallery') && (
            <Field label={t('Stock photo topic')} hint={t('Rough keyword (e.g. nature, sea, mountains).')}>
              <TextInput value={b.stockTopic} onValue={(v) => set((d) => void (d.background.stockTopic = v))} placeholder="nature" />
            </Field>
          )}
          {usesGallery &&
            (gallery && gallery.length > 0 && inRotation === 0 ? (
              <Callout kind="warn">
                <strong>{t('All gallery photos are hidden.')}</strong>{' '}
                {t('Stock photos will be shown until you show some again in')}{' '}
                <a href="#/photos">
                  <strong>{t('Gallery')}</strong>
                </a>
                .
              </Callout>
            ) : (
              <Callout>
                {gallery && gallery.length > 0 ? `${t('{shown} of {total} in rotation', { shown: inRotation, total: gallery.length })}. ` : ''}
                {t('Manage your photos and choose which ones are shown in')}{' '}
                <a href="#/photos">
                  <strong>{t('Gallery')}</strong>
                </a>
                .
              </Callout>
            ))}
          {usesGallery && (
            <Field
              label={t('Photo order')}
              hint={
                (b.order ?? 'random') === 'random'
                  ? t('Shuffled, without repeating the photos of the previous batch.')
                  : t('Continues where it left off and starts over at the end.')
              }
              error={errors['background.order']}
            >
              <div class="bg-order">
                <Segmented
                  full
                  value={b.order ?? 'random'}
                  options={[
                    { value: 'random', label: t('Random'), icon: 'sparkles' },
                    { value: 'newest', label: t('Newest first'), icon: 'history' },
                    { value: 'name', label: t('By name'), icon: 'list' },
                  ]}
                  onChange={(v) => set((d) => void (d.background.order = v))}
                />
              </div>
            </Field>
          )}
          <div class="grid grid--2">
            <Field label={t('Change photo every')} error={errors['background.intervalSec']}>
              <Select value={b.intervalSec} options={intervals.map((s) => ({ value: s, label: intervalLabel(s) }))} onChange={(v) => set((d) => void (d.background.intervalSec = v))} />
            </Field>
            <Field label={t('Brightness')}>
              <Slider value={b.brightness} min={0.2} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.background.brightness = v))} />
            </Field>
          </div>
          {cfg.screen.style === 'modern' && <Callout kind="info">{t('With the Modern style, the glass cards are set in Layout > Glass.')}</Callout>}
          <div class="grid grid--2">
            <Field label={t('Weather panel blur')} hint={t('0 = no blur. On a Raspberry Pi, less blur is lighter.')}>
              <Slider value={b.panelBlur ?? 18} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('No blur'))} onChange={(v) => set((d) => void (d.background.panelBlur = v))} />
            </Field>
            <Field label={t('Weather panel darkness')} hint={t('Darker = easier to read over bright photos.')}>
              <Slider value={b.panelShade ?? 0.5} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.background.panelShade = v))} />
            </Field>
          </div>
          <ToggleRow label={t('Show photo author / title')} checked={b.showMeta} onChange={(v) => set((d) => void (d.background.showMeta = v))} />
          <ToggleRow label={t('Crop to fill the screen')} hint={t('When off, the whole photo is shown with bars.')} checked={b.cover} onChange={(v) => set((d) => void (d.background.cover = v))} />
        </div>
      </Card>
    </>
  );
}
