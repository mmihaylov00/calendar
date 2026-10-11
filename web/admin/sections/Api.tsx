import { useEffect, useState } from 'preact/hooks';
import type { ApiTokenCreated, ApiTokenInfo } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Empty, Field, Modal, PageHeader, Segmented, TextInput } from '../components/ui';
import { fmtDateTime } from '../dates';
import { atLimit, has, limit, runtime } from '../caps';
import { LimitNote } from '../components/LimitNote';
import { relTime, t } from '../i18n';
import { takeIntent } from '../intent';
import type { SectionProps } from './common';
import { DoorbellCard } from './HomeAssistant';

/** True for hosts that are only reachable on the local network (private IPs, localhost, .local/.lan). */
export function isLanHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || h.endsWith('.internal')) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return !h.includes('.') && !h.includes(':'); // single-label LAN names ("raspberrypi")
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('Copied'), 'ok', 1500);
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div class="codeblock">
      <div class="codeblock__bar">
        <span class="mono small muted">{lang}</span>
        <button type="button" class="btn btn--ghost btn--sm" onClick={() => copyText(code)}>
          <Icon name="copy" size={14} />
          <span>{t('Copy')}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function NewTokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: ApiTokenCreated) => void }) {
  const [name, setName] = useState('Home Assistant');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const create = async (e?: Event) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await api.createToken(name.trim());
      setCreated(c);
      onCreated(c);
    } catch (err) {
      const ae = err as ApiError;
      toast(ae.status === 409 ? t('You reached the maximum of 20 tokens. Revoke one.') : ae.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={created ? t('Token created') : t('New API token')}
      icon="key"
      onClose={onClose}
      size="sm"
      footer={
        created ? (
          <Button variant="primary" icon="check" onClick={onClose}>
            {t('I have copied it')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" icon="key" loading={busy} disabled={!name.trim()} onClick={create}>
              {t('Create token')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div class="stack">
          <Callout kind="warn">{t('Copy it now: for security it will not be shown again.')}</Callout>
          <div class="token-reveal">
            <code>{created.token}</code>
            <button type="button" class="btn btn--primary btn--sm" onClick={() => copyText(created.token)}>
              <Icon name="copy" size={14} />
              <span>{t('Copy')}</span>
            </button>
          </div>
          <p class="muted small">{t('Use it in the header Authorization: Bearer <token>. The examples below include it while this page is open.')}</p>
        </div>
      ) : (
        <form class="stack" onSubmit={create}>
          <Field label={t('Name')} hint={t('To recognise it in the list and the activity log.')}>
            <TextInput value={name} onValue={setName} maxLength={60} placeholder="Home Assistant" />
          </Field>
        </form>
      )}
    </Modal>
  );
}

export function ApiSection(props: SectionProps) {
  const { full } = props;
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(() => takeIntent('api', 'new'));
  const [fresh, setFresh] = useState<string>('');
  const [ex, setEx] = useState<'ha' | 'curl'>('ha');

  const load = async () => {
    try {
      setTokens(await api.tokens());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
      setTokens([]);
    }
  };
  const tokensOn = has('apiTokens');
  const hooksOn = has('webhooks');
  useEffect(() => {
    if (tokensOn) load();
  }, []);
  const tokensFull = atLimit('apiTokens', tokens?.length ?? 0);

  const revoke = async (tk: ApiTokenInfo) => {
    const ok = await confirmDialog({
      title: t('Revoke “{name}”', { name: tk.name }),
      body: t('Automations using it will stop working immediately.'),
      confirm: t('Revoke'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeToken(tk.id);
      toast(t('Token revoked'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  // A reverse proxy can restrict /api/hooks/* to the LAN, and Home Assistant should
  // call the Pi directly: when the panel is opened through a public domain, show a LAN placeholder instead.
  // On Workers (Marco Cloud) the hooks live on the panel's own public origin.
  const workers = runtime() === 'workers';
  const lanPanel = workers || isLanHost(location.hostname);
  const base = lanPanel ? location.origin : `http://${t('<pi-ip>')}:3000`;
  const token = fresh || 'cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const slugs = full.screens.map((s) => s.slug);
  const washer = t('The washing machine is done');
  const priv = has('privacy');
  // servers without a live camera (Marco Cloud): the ring carries a snapshot, and the doorbell card lives here
  const snapshotBell = hooksOn && has('doorbell') && !has('doorbellLive');
  const yaml = `# ${t('Home Assistant configuration.yaml')}
rest_command:
  marco_alert:
    url: "${base}/api/hooks/announce"
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: >-
      {"title": {{ title | tojson }}, "body": {{ (body | default('')) | tojson }},
       "emoji": {{ (emoji | default('🔔')) | tojson }}, "style": "{{ style | default('info') }}",
       "durationSec": {{ duration | default(120) }}, "sound": true}${priv ? `
  marco_privacy:
    url: "${base}/api/hooks/privacy"
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: '{"mode": "{{ mode }}"}'` : ''}

automation:
  - alias: "${t('Alert: washing machine done')}"
    triggers:
      - trigger: state
        entity_id: sensor.washing_machine_status
        to: "finished"
    actions:
      - action: rest_command.marco_alert
        data:
          title: "${washer} 🧺"
          emoji: "🧺"
          style: "success"
          duration: 300${priv ? `
  - alias: "${t('Private mode while there are guests')}"
    triggers:
      - trigger: state
        entity_id: input_boolean.guests
    actions:
      - action: rest_command.marco_privacy
        data:
          mode: "{{ 'on' if trigger.to_state.state == 'on' else 'off' }}"` : ''}`;
  const curl = `# ${t('Check the token')}
curl -H "Authorization: Bearer ${token}" ${base}/api/hooks/ping

# ${slugs.length > 1 ? t('Alert on screen “{slug}”', { slug: slugs[0] }) : t('Alert on all screens')}
curl -X POST ${base}/api/hooks/announce \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":${JSON.stringify(washer).replace(/'/g, "'\\''")},"emoji":"🧺","style":"success","durationSec":300,"sound":true${slugs.length > 1 ? `,"screens":["${slugs[0]}"]` : ''}}'

# ${t('Reload all screens')}
curl -X POST ${base}/api/hooks/reload \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{}'

# ${t('Night mode')}: on | off | auto
curl -X POST ${base}/api/hooks/night \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"mode":"on"}'${priv ? `

# ${t('Private mode for 3 hours')}: on | off | toggle
curl -X POST ${base}/api/hooks/privacy \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"mode":"on","hours":3}'` : ''}${snapshotBell ? `

# ${t('Doorbell with the camera picture')} (JPEG, PNG, WebP; 2 MB)
curl -X POST ${base}/api/hooks/doorbell \\
  -H "Authorization: Bearer ${token}" \\
  -F image=@doorbell.jpg -F action=ring -F seconds=60

# ${t('Take the doorbell off the screens')}
curl -X POST ${base}/api/hooks/doorbell \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"action":"dismiss"}'` : ''}`;
  // Home Assistant takes a snapshot of the camera and sends it with the ring; the file is removed right after, since
  // Home Assistant serves www/ at /local/ without a sign in.
  const bellYaml = `# ${t('Home Assistant configuration.yaml')}
shell_command:
  marco_doorbell: >-
    curl -s -X POST -H "Authorization: Bearer ${token}"
    -F image=@/config/www/doorbell.jpg -F action=ring -F seconds=60
    ${base}/api/hooks/doorbell
  marco_doorbell_clean: rm -f /config/www/doorbell.jpg

automation:
  - alias: "${t('Doorbell on the Marco screens')}"
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_doorbell
        to: "on"
    actions:
      - action: camera.snapshot
        target:
          entity_id: camera.front_door
        data:
          filename: /config/www/doorbell.jpg
      - action: shell_command.marco_doorbell
      - action: shell_command.marco_doorbell_clean
    mode: single`;

  return (
    <>
      <PageHeader title={t('API & webhooks')} desc={t('Lets Home Assistant or other systems send alerts, reload screens or turn on night mode.')}>
        {tokensOn && (
          <Button variant="primary" icon="plus" disabled={tokensFull} onClick={() => setCreating(true)}>
            {t('New token')}
          </Button>
        )}
      </PageHeader>

      {tokensOn && (
        <Card title={t('API tokens')} icon="key" id="api-tokens" desc={t('Stored hashed: shown only once when created.')}>
          {err && <Callout kind="error">{err}</Callout>}
          <LimitNote name="apiTokens" count={tokens?.length ?? 0} />
          {tokens === null ? (
            <div class="skeleton-list">
              <div class="skeleton" />
            </div>
          ) : tokens.length === 0 ? (
            <Empty icon="key" title={t('No tokens yet')}>
              {t('Create one for Home Assistant and paste it into the example below.')}
            </Empty>
          ) : (
            <div class="table-wrap">
              <table class="table tokens">
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Token')}</th>
                    <th>{t('Created')}</th>
                    <th>{t('Last used')}</th>
                    <th class="num">{t('Uses')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((tk) => (
                    <tr>
                      <td>
                        <strong>{tk.name}</strong>
                      </td>
                      <td>
                        <code class="mono small">{tk.prefix}…</code>
                      </td>
                      <td class="muted" title={tk.createdAt}>
                        {fmtDateTime(tk.createdAt)}
                      </td>
                      <td class="muted" title={tk.lastUsedAt ?? ''}>
                        {tk.lastUsedAt ? (
                          <>
                            {relTime(tk.lastUsedAt)}
                            {tk.lastUsedIp && <span class="small"> · {tk.lastUsedIp}</span>}
                          </>
                        ) : (
                          t('Never')
                        )}
                      </td>
                      <td class="num">{tk.useCount}</td>
                      <td class="num">
                        <Button size="sm" variant="ghost" icon="trash" onClick={() => revoke(tk)}>
                          {t('Revoke')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {hooksOn && (
        <Card title={t('Examples')} icon="code" id="api-examples" actions={<Segmented size="sm" value={ex} options={[{ value: 'ha', label: 'Home Assistant' }, { value: 'curl', label: 'curl' }]} onChange={setEx} />}>
          {!fresh && <p class="muted small">{t('Replace cs_XXXX… with your token (or create a new one and it fills in).')}</p>}
          {!workers && !lanPanel && (
            <Callout kind="info">
              {t('You are using the panel from outside the local network. Home Assistant must call the Pi directly on the local network (e.g. http://192.168.1.50:3000): /api/hooks is blocked from the Internet. Replace <pi-ip> with its IP.')}
            </Callout>
          )}
          {ex === 'ha' ? <CodeBlock lang="yaml" code={yaml} /> : <CodeBlock lang="bash" code={curl} />}
          <div class="api-ref">
            <h4>{t('Endpoints')}</h4>
            <ul>
              <li>
                <code>GET /api/hooks/ping</code>: {t('checks the token')}
              </li>
              <li>
                <code>POST /api/hooks/announce</code>: <code>{'{ title, body, emoji, style: info|success|warning|urgent, durationSec, sound, screens: [slug] }'}</code>
              </li>
              <li>
                <code>POST /api/hooks/reload</code>: <code>{'{ screens?: [slug] }'}</code>
              </li>
              <li>
                <code>POST /api/hooks/night</code>: <code>{'{ mode: on|off|auto, screens?: [slug] }'}</code>
              </li>
              {has('privacy') && (
                <li>
                  <code>POST /api/hooks/privacy</code>: <code>{'{ mode: on|off|toggle, hours?, until?, untilTime?: "HH:MM", screens?: [slug] }'}</code> · <code>GET /api/hooks/privacy</code>
                </li>
              )}
              {has('doorbell') && (
                <li>
                  <code>POST /api/hooks/doorbell</code>:{' '}
                  {snapshotBell ? (
                    <>
                      <code>{'{ action: ring|dismiss, seconds?: 10..300, screens?: [slug], sound? }'}</code> · {t('the picture as an image field (multipart) or as an image/jpeg body with the fields in the URL')}
                    </>
                  ) : (
                    <code>{'{ action: ring|dismiss, seconds?: 10..300, screens?: [slug], camera?: camera.x }'}</code>
                  )}
                </li>
              )}
            </ul>
            <p class="muted small">
              {t('Available screens')}: {slugs.map((s) => <code class="slug-code">{s}</code>)} · {t('Limit: 30 requests per minute per token.')}
              {limit('hookCommandsPerDay') != null && <> {t('At most {n} alerts and commands a day across all tokens.', { n: limit('hookCommandsPerDay') ?? 0 })}</>}
            </p>
          </div>
        </Card>
      )}

      {snapshotBell && <DoorbellCard {...props} snapshot example={<CodeBlock lang="yaml" code={bellYaml} />} />}

      {creating && tokensOn && (
        <NewTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setFresh(c.token);
            load();
          }}
        />
      )}
    </>
  );
}
