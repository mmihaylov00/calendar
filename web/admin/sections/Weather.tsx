import { useEffect, useState } from 'preact/hooks';
import { HaEntityPicker } from '../components/HaEntityPicker';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Field, NumberInput, PageHeader, Segmented, Select, TextInput, ToggleRow } from '../components/ui';
import { ScopeBadge } from '../components/ui';
import type { AdminStatus, GeocodeResult, OpenMeteoModel, WeatherKeyStatus, WeatherProvider } from '../../shared/types';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { has } from '../caps';
import { getLang, t } from '../i18n';
import type { SectionProps } from './common';

export function WeatherSection({ cfg, set, errors }: SectionProps) {
  const w = cfg.weather;
  const haOffered = has('homeassistant');
  const haOn = haOffered && cfg.homeassistant.enabled;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async (e?: Event) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      // Through this server (GET /api/admin/geocode), so the browser only talks to its own server.
      const j = await api.geocode(q.trim(), getLang());
      setResults(j.results ?? []);
    } catch (e) {
      setResults([]);
      if ((e as ApiError).status === 429) toast(t('Too many searches in a row. Wait a few minutes.'), 'error');
      else toast(t('Search failed (no Internet connection?). Try again.'), 'error');
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <PageHeader title={t('Weather')} desc={t('Forecast, humidity and wind for your town. Choose where the data comes from: every source is free.')} />
      <Card id="wx-main" title={t('Weather')} icon="cloud">
        <ToggleRow label={<>{t('Show weather')} <ScopeBadge scope="screen" /></>} checked={w.enabled} onChange={(v) => set((d) => void (d.weather.enabled = v))} />
        <div class={`stack ${w.enabled ? '' : 'is-disabled'}`}>
          <Field label={t('Location')} hint={t('Search a city to fill in the coordinates.')}>
            <form class="search-row" onSubmit={search}>
              <TextInput value={q} onValue={setQ} placeholder={t('Search city…')} prefix={<Icon name="search" size={14} />} />
              <Button type="submit" loading={searching}>
                {t('Search')}
              </Button>
            </form>
            {results && (
              <div class="geo-results">
                {results.length === 0 && <div class="muted small">{t('No results')}</div>}
                {results.map((r) => (
                  <button
                    type="button"
                    class="geo-result"
                    onClick={() => {
                      set((d) => {
                        d.weather.lat = Math.round(r.lat * 1000) / 1000;
                        d.weather.lon = Math.round(r.lon * 1000) / 1000;
                        d.weather.locationName = [r.name, r.admin1].filter(Boolean).join(', ');
                      });
                      setResults(null);
                      setQ('');
                    }}
                  >
                    <Icon name="pin" size={14} />
                    <span>
                      <strong>{r.name}</strong> <span class="muted">{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
                    </span>
                    <span class="mono small muted">
                      {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          <div class="grid grid--3">
            <Field label={t('Display name')}>
              <TextInput value={w.locationName} onValue={(v) => set((d) => void (d.weather.locationName = v))} />
            </Field>
            <Field label={t('Latitude')} error={errors['weather.lat']}>
              <NumberInput value={w.lat} step={0.001} min={-90} max={90} error={!!errors['weather.lat']} onValue={(v) => set((d) => void (d.weather.lat = v))} />
            </Field>
            <Field label={t('Longitude')} error={errors['weather.lon']}>
              <NumberInput value={w.lon} step={0.001} min={-180} max={180} error={!!errors['weather.lon']} onValue={(v) => set((d) => void (d.weather.lon = v))} />
            </Field>
          </div>
          <div class="grid grid--2">
            <Field label={t('Units')}>
              <Segmented
                full
                value={w.units}
                options={[
                  { value: 'metric', label: '°C · km/h' },
                  { value: 'imperial', label: '°F · mph' },
                ]}
                onChange={(v) => set((d) => void (d.weather.units = v))}
              />
            </Field>
            <Field label={<>{t('Extended forecast')} <ScopeBadge scope="screen" /></>}>
              <Segmented
                full
                value={w.forecastDays}
                options={[1, 3, 4, 5, 7].map((n) => ({ value: n, label: `${n} d`, title: t('{n} days', { n }) }))}
                onChange={(v) => set((d) => void (d.weather.forecastDays = v))}
              />
            </Field>
          </div>
          <ToggleRow icon="🕐" label={t('Hourly forecast')} hint={t('Next 8 hours')} checked={w.showHourly} onChange={(v) => set((d) => void (d.weather.showHourly = v))} />
          <ToggleRow icon="☔" label={t('Chance of rain')} checked={w.showPrecipChance} onChange={(v) => set((d) => void (d.weather.showPrecipChance = v))} />
        </div>
      </Card>
      <WeatherSourceCard cfg={cfg} set={set} errors={errors} haOffered={haOffered} haOn={haOn} />
      {haOffered && (
        <Card id="wx-ha" scope="global" title={t('Home Assistant data')} icon="home" desc={t('Optional: use your weather station and indoor sensors.')} muted={!haOn}>
          <div class="grid grid--3">
            <Field label={t('Weather entity')} error={errors['weather.haWeatherEntity']}>
              <HaEntityPicker domain="weather" enabled={haOn} value={w.haWeatherEntity} error={!!errors['weather.haWeatherEntity']} onChange={(v) => set((d) => void (d.weather.haWeatherEntity = v))} />
            </Field>
            <Field label={t('Indoor temperature')}>
              <HaEntityPicker
                domain="sensor"
                enabled={haOn}
                value={w.haIndoorTempEntity}
                filter={(e) => !e.unit || /°|c|f/i.test(e.unit)}
                onChange={(v) => set((d) => void (d.weather.haIndoorTempEntity = v))}
              />
            </Field>
            <Field label={t('Indoor humidity')}>
              <HaEntityPicker
                domain="sensor"
                enabled={haOn}
                value={w.haIndoorHumidityEntity}
                filter={(e) => !e.unit || e.unit === '%'}
                onChange={(v) => set((d) => void (d.weather.haIndoorHumidityEntity = v))}
              />
            </Field>
          </div>
        </Card>
      )}
    </>
  );
}

/** Short description of each source; the licence line is shown for the chosen one. */
function sourceOptions(haOffered: boolean, current: WeatherProvider) {
  const opts: { v: WeatherProvider; icon: 'globe' | 'cloud' | 'key' | 'home'; title: string; badge?: string; body: string }[] = [
    {
      v: 'open-meteo',
      icon: 'globe',
      title: 'Open-Meteo',
      badge: t('Recommended'),
      body: t('No key needed. Uses the best weather model for your area, or the one you pick (ECMWF, ICON, GFS…).'),
    },
    {
      v: 'met-norway',
      icon: 'cloud',
      title: 'MET Norway',
      body: t('No key needed. The Norwegian Meteorological Institute, with forecasts for the whole world. Outside the Nordic countries it gives no chance of rain.'),
    },
    {
      v: 'pirate-weather',
      icon: 'key',
      title: 'Pirate Weather',
      badge: t('Free key'),
      body: t('Needs your own free key (10,000 calls a month; Calendar uses about 3,000). NOAA and ECMWF models.'),
    },
  ];
  if (haOffered || current === 'homeassistant') {
    opts.push({ v: 'homeassistant', icon: 'home', title: 'Home Assistant', body: t('Current weather from your Home Assistant entity, with the Open-Meteo forecast.') });
  }
  return opts;
}

const MODEL_LABELS: Record<OpenMeteoModel, string> = {
  best_match: 'Automatic (recommended)',
  ecmwf_ifs: 'ECMWF IFS (European centre)',
  icon_seamless: 'DWD ICON (Germany)',
  gfs_seamless: 'NOAA GFS (United States)',
  meteofrance_seamless: 'Météo-France (Europe, up to 4 days)',
  ukmo_seamless: 'UK Met Office (United Kingdom)',
  gem_seamless: 'GEM (Canada)',
  jma_seamless: 'JMA (Japan)',
};

const LICENCE: Record<string, { name: string; site: string; url: string; licence?: string; licenceUrl?: string }> = {
  'open-meteo': { name: 'Open-Meteo', site: 'open-meteo.com', url: 'https://open-meteo.com/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'met-norway': { name: 'MET Norway', site: 'api.met.no', url: 'https://api.met.no/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'pirate-weather': { name: 'Pirate Weather', site: 'pirateweather.net', url: 'https://pirateweather.net/' },
};

const WX_ERRORS: Record<string, string> = {
  key_missing: 'The weather source key is missing.',
  key_invalid: 'The weather source does not accept the saved key. Check it.',
  rate_limited: 'The weather source got too many requests. Calendar will try again in a few minutes.',
  http: 'Could not reach the weather source. The screens show the latest data.',
  bad_response: 'The weather source sent an answer Calendar does not understand.',
};

function WeatherSourceCard({ cfg, set, errors, haOffered, haOn }: Pick<SectionProps, 'cfg' | 'set' | 'errors'> & { haOffered: boolean; haOn: boolean }) {
  const w = cfg.weather;
  const provider = w.provider;
  const [keyStatus, setKeyStatus] = useState<WeatherKeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [wxStatus, setWxStatus] = useState<AdminStatus['weather'] | null>(null);

  useEffect(() => {
    api.weatherKey().then(setKeyStatus).catch(() => setKeyStatus(null));
    if (has('status')) api.status().then((s) => setWxStatus(s.weather)).catch(() => {});
  }, []);

  const saveKey = async (value: string) => {
    setSavingKey(true);
    try {
      const st = await api.setWeatherKey(value);
      setKeyStatus(st);
      setKey('');
      setEditKey(false);
      toast(value ? t('Key saved') : t('Key removed'));
    } catch (e) {
      const err = e as ApiError;
      toast(err.status === 400 ? t('Pirate Weather does not accept this key. Copy it again from your account.') : t('Could not save the key.'), 'error');
    } finally {
      setSavingKey(false);
    }
  };

  const fromOpenMeteo = provider === 'open-meteo' || provider === 'homeassistant';
  const lic = LICENCE[fromOpenMeteo ? 'open-meteo' : provider];
  const model = fromOpenMeteo && w.model !== 'best_match' ? MODEL_LABELS[w.model]?.replace(/ \(.*\)$/, '') : '';
  const opts = sourceOptions(haOffered, provider);
  const keyError = errors['weather.apiKey'];
  // The status is about the saved provider: show it only while the page shows that one.
  const statusError = wxStatus && wxStatus.ok === false && (!wxStatus.provider || wxStatus.provider === (provider === 'homeassistant' ? 'open-meteo' : provider)) ? WX_ERRORS[wxStatus.errorCode || 'http'] : null;

  return (
    <Card id="wx-source" scope="global" title={t('Data source')} icon="globe" desc={t('Where Calendar gets the forecast. You can change it at any time.')}>
      <div class="access-mode wx-sources" role="radiogroup" aria-label={t('Data source')}>
        {opts.map((o) => (
          <button type="button" role="radio" aria-checked={provider === o.v} class={`access-mode__opt ${provider === o.v ? 'is-active' : ''}`} onClick={() => set((d) => void (d.weather.provider = o.v))}>
            <Icon name={o.icon} size={18} />
            <div>
              <strong>
                <span class="wx-sources__name">{o.title}</span>
                {o.badge && <span class="badge badge--soft">{o.badge}</span>}
              </strong>
              <p>{o.body}</p>
            </div>
          </button>
        ))}
      </div>
      {provider === 'homeassistant' && !haOffered && <Callout kind="warn">{t('{name} is not available here. Pick another option.', { name: 'Home Assistant' })}</Callout>}
      {provider === 'homeassistant' && haOffered && !haOn && (
        <Callout kind="warn">
          {t('Enable and configure Home Assistant in')} <a href="#/homeassistant">Home Assistant</a>.
        </Callout>
      )}
      {fromOpenMeteo && (
        <Field label={t('Forecast model')} hint={t('Automatic picks the best model for your area. Some models give no chance of rain or UV index; those values are not shown.')}>
          <Select<OpenMeteoModel>
            value={w.model}
            options={(Object.keys(MODEL_LABELS) as OpenMeteoModel[]).map((m) => ({ value: m, label: t(MODEL_LABELS[m]) }))}
            onChange={(v) => set((d) => void (d.weather.model = v))}
          />
        </Field>
      )}
      {provider === 'pirate-weather' && (
        <Field
          label={t('Pirate Weather key')}
          error={keyError ? t('Save your Pirate Weather key before choosing this source.') : undefined}
          hint={
            <>
              {t('Create one for free at')}{' '}
              <a href="https://pirate-weather.apiable.io/" target="_blank" rel="noopener noreferrer">
                pirateweather.net
              </a>
              . {t('It is kept on the server only and never shown again.')}
            </>
          }
        >
          {keyStatus?.set && !editKey ? (
            <div class="search-row">
              <span class="wx-key-saved">
                <Icon name="check" size={14} /> {t('Key saved')} <span class="mono muted">…{keyStatus.hint}</span>
              </span>
              <Button onClick={() => setEditKey(true)}>{t('Change')}</Button>
              <Button variant="danger" loading={savingKey} onClick={() => saveKey('')}>
                {t('Remove')}
              </Button>
            </div>
          ) : (
            <form
              class="search-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) saveKey(key.trim());
              }}
            >
              <TextInput type="password" mono autocomplete="off" value={key} onValue={setKey} error={!!keyError} placeholder={t('Paste your key here')} prefix={<Icon name="key" size={14} />} />
              <Button type="submit" variant="primary" disabled={!key.trim()} loading={savingKey}>
                {t('Save key')}
              </Button>
            </form>
          )}
        </Field>
      )}
      {statusError && <Callout kind="error">{t(statusError)}</Callout>}
      <p class="muted small wx-credit">
        {t('Data from')}{' '}
        <a href={lic.url} target="_blank" rel="noopener noreferrer">
          {lic.name}
        </a>
        {model ? ` (${model})` : ''}
        {lic.licence ? (
          <>
            {', '}
            {t('licensed under')}{' '}
            <a href={lic.licenceUrl} target="_blank" rel="noopener noreferrer">
              {lic.licence}
            </a>
          </>
        ) : null}
        . {t('The screens credit it with a small note next to the weather.')}
      </p>
    </Card>
  );
}
