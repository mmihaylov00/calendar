import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { TestHomeAssistantResponse } from '../../shared/types';
import { api, ApiError } from '../api';
import { fetchErrorText } from '../apiErrors';
import { toast } from '../components/feedback';
import { HaEntityPicker, invalidateHaEntities } from '../components/HaEntityPicker';
import { Icon } from '../components/icons';
import { ScreenTargets } from '../components/AnnounceForm';
import { Button, Callout, Card, Field, NumberInput, PageHeader, TextInput, ToggleRow } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import { withPollNote } from '../liveNote';
import type { SectionProps } from './common';

export function HomeAssistantSection(props: SectionProps) {
  return (
    <>
      <HomeAssistantMain {...props} />
      {has('doorbell') && has('doorbellLive') && <DoorbellCard {...props} />}
    </>
  );
}

function HomeAssistantMain({ cfg, set, errors }: SectionProps) {
  const ha = cfg.homeassistant;
  const w = cfg.weather;
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [savingTok, setSavingTok] = useState(false);
  const [test, setTest] = useState<{ loading: boolean; res?: TestHomeAssistantResponse }>({ loading: false });
  const [reloadKey, setReloadKey] = useState(0);

  const saveToken = async () => {
    setSavingTok(true);
    try {
      await api.setHaToken(token.trim());
      toast(t('Token saved'));
      setToken('');
      invalidateHaEntities();
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setSavingTok(false);
    }
  };
  const runTest = async () => {
    setTest({ loading: true });
    try {
      setTest({ loading: false, res: await api.testHomeAssistant(ha.url.trim(), token.trim() || undefined) });
    } catch (e) {
      setTest({ loading: false, res: { ok: false, error: (e as ApiError).message } });
    }
  };

  return (
    <>
      <PageHeader title="Home Assistant" desc={t('Use your home sensors (indoor temperature and humidity, weather station).')} />
      <Card id="ha-conn" title={t('Connection')} icon="home">
        <ToggleRow label={t('Enable Home Assistant')} checked={ha.enabled} onChange={(v) => set((d) => void (d.homeassistant.enabled = v))} />
        <div class={`stack ${ha.enabled ? '' : 'is-disabled'}`}>
          <Field label="URL" error={errors['homeassistant.url']} hint={t('Local address, e.g. http://homeassistant.local:8123')}>
            <TextInput mono value={ha.url} error={!!errors['homeassistant.url']} placeholder="http://homeassistant.local:8123" onValue={(v) => set((d) => void (d.homeassistant.url = v))} prefix={<Icon name="link" size={14} />} />
          </Field>
          <Field
            label={t('Long-lived access token')}
            hint={t('Create it in Home Assistant → your profile → Security → Long-lived access tokens. It is stored only on the server and never shown again.')}
          >
            <div class="search-row">
              <div class="input-group">
                <span class="input-group__addon">
                  <Icon name="key" size={14} />
                </span>
                <input
                  class="input input--mono"
                  type={(show ? 'text' : 'password') as 'password'}
                  value={token}
                  autocomplete="off"
                  placeholder={t('•••••••• (unchanged)')}
                  onInput={(e) => setToken(e.currentTarget.value)}
                />
                <button type="button" class="input-group__btn" onClick={() => setShow(!show)} aria-label={t('Show')}>
                  <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
                </button>
              </div>
              <Button variant="primary" disabled={!token.trim()} loading={savingTok} onClick={saveToken}>
                {t('Save token')}
              </Button>
            </div>
          </Field>
          <div class="row-actions">
            <Button icon="play" loading={test.loading} onClick={runTest} disabled={!ha.url}>
              {t('Test connection')}
            </Button>
            {test.res &&
              (test.res.ok ? (
                <span class="ok-text">
                  <Icon name="check" size={15} /> {t('Connected')} {test.res.version && `· Home Assistant ${test.res.version}`}
                </span>
              ) : (
                <span class="err-text">
                  <Icon name="alert" size={15} /> {fetchErrorText(test.res.error) || t('Could not connect')}
                </span>
              ))}
          </div>
          <Callout>{t('Remember to save the configuration (bottom bar) after changing the URL or enabling the integration.')}</Callout>
        </div>
      </Card>
      <Card
        title={t('Entities')}
        icon="activity"
        muted={!ha.enabled}
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            disabled={!ha.enabled}
            onClick={() => {
              invalidateHaEntities();
              setReloadKey((k) => k + 1);
            }}
          >
            {t('Reload')}
          </Button>
        }
      >
        <div class="grid grid--3">
          <Field label={t('Weather (weather.*)')} error={errors['weather.haWeatherEntity']}>
            <HaEntityPicker domain="weather" enabled={ha.enabled} reloadKey={reloadKey} value={w.haWeatherEntity} onChange={(v) => set((d) => void (d.weather.haWeatherEntity = v))} />
          </Field>
          <Field label={t('Indoor temperature')}>
            <HaEntityPicker
              domain="sensor"
              enabled={ha.enabled}
              reloadKey={reloadKey}
              value={w.haIndoorTempEntity}
              filter={(e) => !e.unit || /°|c|f/i.test(e.unit)}
              onChange={(v) => set((d) => void (d.weather.haIndoorTempEntity = v))}
            />
          </Field>
          <Field label={t('Indoor humidity')}>
            <HaEntityPicker
              domain="sensor"
              enabled={ha.enabled}
              reloadKey={reloadKey}
              value={w.haIndoorHumidityEntity}
              filter={(e) => !e.unit || e.unit === '%'}
              onChange={(v) => set((d) => void (d.weather.haIndoorHumidityEntity = v))}
            />
          </Field>
        </div>
      </Card>
    </>
  );
}

/**
 * Doorbell camera: which camera, how long, which screens, sound, and a test button that rings with these values.
 * `snapshot`: a server without a live camera (features.doorbellLive off, Marco Cloud) shows the picture Home Assistant
 * sends with the ring. There is no camera to pick; `example` (the Home Assistant setup) goes at the end. That server has no Home Assistant page: the API page shows this card.
 */
export function DoorbellCard({ cfg, set, errors, full, snapshot = false, example }: SectionProps & { snapshot?: boolean; example?: ComponentChildren }) {
  const ha = cfg.homeassistant;
  const db = ha.doorbell ?? { camera: '', seconds: 60, screenIds: [], sound: true };
  const [busy, setBusy] = useState<'' | 'ring' | 'dismiss'>('');
  const upd = (fn: (d: typeof db) => void) => set((d) => {
    d.homeassistant.doorbell ??= { camera: '', seconds: 60, screenIds: [], sound: true };
    fn(d.homeassistant.doorbell);
  });
  const run = async (action: 'ring' | 'dismiss') => {
    setBusy(action);
    try {
      const secs = Math.min(300, Math.max(10, Math.round(Number(db.seconds) || 60)));
      const ring = { action: 'ring' as const, seconds: secs, sound: db.sound, screens: db.screenIds };
      let r;
      if (action === 'dismiss') r = await api.doorbell({ action });
      else r = await api.doorbell(!snapshot && db.camera ? { ...ring, camera: db.camera } : ring);
      if (action === 'dismiss') toast(t('Doorbell removed from the screens'));
      else toast(r.delivered ? withPollNote(t('Doorbell sent to {n} screens', { n: r.delivered })) : t('Doorbell sent, but no screen is connected'), r.delivered ? 'ok' : 'info');
    } catch (e) {
      toast(fetchErrorText((e as ApiError).message) || t('Could not send'), 'error');
    } finally {
      setBusy('');
    }
  };
  const timeField = (
    <Field label={t('Time on screen')} error={errors['homeassistant.doorbell.seconds']} hint={t('Between 10 and 300 seconds. Ringing again makes it longer.')}>
      <NumberInput value={db.seconds} min={10} max={300} suffix="s" error={!!errors['homeassistant.doorbell.seconds']} onValue={(v) => upd((d) => void (d.seconds = v))} />
    </Field>
  );
  return (
    <Card id={snapshot ? 'api-doorbell' : 'ha-doorbell'} title={snapshot ? t('Doorbell') : t('Doorbell and camera')} icon="bell">
      <p class="muted small">
        {snapshot
          ? t('When someone rings, Home Assistant sends Marco a picture from the camera and the screens show it full screen for a few seconds, with a door chime. It also wakes screens in night mode while it lasts.')
          : t('When someone rings, Home Assistant tells Marco and the screens show the camera full screen for a few seconds, with a door chime. It also wakes screens in night mode while it lasts.')}
      </p>
      {snapshot ? (
        timeField
      ) : (
        <div class="grid grid--2">
          <Field label={t('Camera (camera.*)')} error={errors['homeassistant.doorbell.camera']} hint={!ha.enabled ? undefined : t('Without a camera, the screens only show the notice.')}>
            <HaEntityPicker domain="camera" enabled={ha.enabled} value={db.camera} error={!!errors['homeassistant.doorbell.camera']} onChange={(v) => upd((d) => void (d.camera = v))} />
          </Field>
          {timeField}
        </div>
      )}
      <Field label={t('Screens')}>
        <ScreenTargets screens={full.screens} value={db.screenIds} onChange={(v) => upd((d) => void (d.screenIds = v))} />
      </Field>
      <ToggleRow label={t('Door chime')} checked={db.sound} onChange={(v) => upd((d) => void (d.sound = v))} />
      <div class="row-actions">
        <Button icon="play" loading={busy === 'ring'} disabled={!!busy} onClick={() => run('ring')}>
          {snapshot ? t('Test without a picture') : t('Test')}
        </Button>
        <Button variant="ghost" icon="x" loading={busy === 'dismiss'} disabled={!!busy} onClick={() => run('dismiss')}>
          {t('Remove from the screens')}
        </Button>
      </div>
      <Callout>
        {snapshot
          ? t('From Home Assistant: POST /api/hooks/doorbell with an API token and the camera picture (JPEG, PNG or WebP, 2 MB at most). Marco keeps only the latest picture while the doorbell rings, 10 minutes at most, and then deletes it. Only the screens that are ringing see it.')
          : t('From Home Assistant: POST /api/hooks/doorbell with an API token ("API & webhooks"). The picture goes through this server: the Home Assistant token never reaches the screens and no picture is stored.')}
      </Callout>
      {example}
    </Card>
  );
}
