import { useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { GoogleG, Icon } from '../components/icons';
import { PrivateLinkCard } from '../components/DisplayAccess';
import { Button, Callout, Card, Chips, ColorPicker, Field, PageHeader, Segmented, Slider, Textarea, TextInput, ToggleRow } from '../components/ui';
import { has, limit, offers } from '../caps';
import { locale, t } from '../i18n';
import { cssBytes, EMAIL_RE } from '../util';
import { MIN_PASSWORD, passwordProblem } from '../../shared/password';
import type { SectionProps } from './common';
import { PrivacyCard } from './Privacy';

const kb = (n: number) => (Math.round((n / 1024) * 10) / 10).toLocaleString(locale());

export function ScreenSection({ cfg, set, errors, screenId, saved, go }: SectionProps) {
  const s = cfg.screen;
  const cssMax = limit('customCssBytes');
  const nm = s.nightMode;
  return (
    <>
      <PageHeader scope="screen" title={t('Screen settings')} desc={t('Screen name, appearance and night mode.')} />
      <Card id="scr-general" scope="screen" title={t('General')} icon="monitor">
        <div class="grid grid--2">
          <Field label={t('Screen name')} error={errors['screen.name']}>
            <TextInput value={s.name} error={!!errors['screen.name']} onValue={(v) => set((d) => void (d.screen.name = v))} />
          </Field>
          <Field label={t('Orientation')}>
            <Segmented
              full
              value={s.orientation}
              options={[
                { value: 'auto', label: t('Auto') },
                { value: 'landscape', label: t('Landscape') },
                { value: 'portrait', label: t('Portrait') },
              ]}
              onChange={(v) => set((d) => void (d.screen.orientation = v))}
            />
          </Field>
          <Field label={t('Font size')} error={errors['screen.fontScale']}>
            <Slider value={s.fontScale} min={0.7} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.screen.fontScale = v))} />
          </Field>
        </div>
      </Card>
      <PrivateLinkCard screenId={screenId} saved={saved} mode={saved.security?.displayAccess ?? 'open'} go={go} />
      <Card id="scr-look" scope="screen" title={t('Appearance')} icon="palette">
        <div class="grid grid--2">
          <Field label={t('Theme')}>
            <Segmented
              full
              value={s.theme}
              options={[
                { value: 'dark', label: t('Dark'), icon: 'moon' },
                { value: 'light', label: t('Light'), icon: 'sun' },
              ]}
              onChange={(v) => set((d) => void (d.screen.theme = v))}
            />
          </Field>
          <Field label={t('Accent colour')} error={errors['screen.accent']}>
            <ColorPicker value={s.accent} error={!!errors['screen.accent']} onChange={(v) => v && set((d) => void (d.screen.accent = v))} />
          </Field>
        </div>
      </Card>
      <Card id="scr-night" scope="screen" title={t('Night mode')} icon="moon" desc={t('Dims the screen at night.')}>
        <ToggleRow label={t('Enable night mode')} checked={nm.enabled} onChange={(v) => set((d) => void (d.screen.nightMode.enabled = v))} />
        <div class={`grid grid--3 ${nm.enabled ? '' : 'is-disabled'}`}>
          <Field label={t('From')} error={errors['screen.nightMode.from']}>
            <input class={`input ${errors['screen.nightMode.from'] ? 'is-invalid' : ''}`} type="time" value={nm.from} onInput={(e) => set((d) => void (d.screen.nightMode.from = e.currentTarget.value))} />
          </Field>
          <Field label={t('To')} error={errors['screen.nightMode.to']}>
            <input class={`input ${errors['screen.nightMode.to'] ? 'is-invalid' : ''}`} type="time" value={nm.to} onInput={(e) => set((d) => void (d.screen.nightMode.to = e.currentTarget.value))} />
          </Field>
          <Field label={t('Night brightness')}>
            <Slider value={nm.dim} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.screen.nightMode.dim = v))} />
          </Field>
        </div>
      </Card>
      {has('privacy') && <PrivacyCard cfg={cfg} set={set} errors={errors} go={go} />}
      {has('customCss') && (
        <Card id="scr-css" scope="screen" title={t('Custom CSS')} icon="wand" desc={t('For advanced users: injected into the screen.')}>
          <Field error={errors['screen.customCss']} hint={cssMax != null ? t('{used} of {max} KB', { used: kb(cssBytes(s.customCss)), max: kb(cssMax) }) : undefined}>
            <Textarea mono rows={6} value={s.customCss} placeholder={'.clock { letter-spacing: -0.02em; }'} onValue={(v) => set((d) => void (d.screen.customCss = v))} />
          </Field>
        </Card>
      )}
    </>
  );
}

export function SecuritySection({ cfg, set, errors, me, saved, go }: SectionProps) {
  const a = cfg.auth;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = next ? passwordProblem(next) : null;
  const problemText = problem === 'too_short' ? t('At least {n} characters', { n: MIN_PASSWORD }) : problem === 'too_common' ? t('Too common or too simple') : problem === 'too_long' ? t('At most 200 characters') : '';
  const pwErr = problemText || (rep && rep !== next ? t('Passwords do not match') : '');
  const change = async (e: Event) => {
    e.preventDefault();
    if (pwErr || !next || !cur) return;
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      toast(t('Password updated'));
      if (me.mustChangePassword) location.reload();
      setCur('');
      setNext('');
      setRep('');
    } catch (err) {
      const ae = err as ApiError;
      const code = (ae.body as any)?.code as string | undefined;
      toast(ae.status === 400 && code ? (code === 'too_common' ? t('Too common or too simple') : t('At least {n} characters', { n: MIN_PASSWORD })) : [400, 401, 403].includes(ae.status) ? t('The current password is wrong') : ae.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const emailErr = Object.keys(errors).find((k) => k.startsWith('auth.allowedGoogleEmails'));
  const pwOn = has('passwordLogin');
  const googleOn = offers('googleLogin');
  return (
    <>
      <PageHeader title={t('Security')} desc={t('Who can sign in to this panel.')} />
      {me.user && (
        <Card>
          <div class="who">
            {me.user.picture ? <img class="avatar avatar--lg" src={me.user.picture} alt="" referrerpolicy="no-referrer" /> : <span class="avatar avatar--lg avatar--letter">{(me.user.name || me.user.email || 'A')[0].toUpperCase()}</span>}
            <div>
              <strong>{me.user.name || me.user.email}</strong>
              <div class="muted small">
                {me.user.email} · {me.user.method === 'google' ? t('signed in with Google') : me.user.method === 'account' ? t('signed in with your account') : t('signed in with password')}
              </div>
            </div>
          </div>
        </Card>
      )}
      {has('openDisplayAccess') && (
        <DisplayAccessCard mode={cfg.security?.displayAccess ?? 'open'} savedMode={saved.security?.displayAccess ?? 'open'} onChange={(v) => set((d) => void (d.security = { ...(d.security ?? {}), displayAccess: v }))} go={go} />
      )}
      {googleOn && (
        <Card id="sec-google" title={t('Sign in with Google')} icon="google">
          {!me.googleConfigured && <Callout kind="warn">{t('Google is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).')}</Callout>}
          <Field
            label={t('Allowed Google emails')}
            error={emailErr ? errors[emailErr] : undefined}
            hint={t('If the list is empty, the first Google sign-in while signed in with the password is added automatically.')}
          >
            <Chips values={a.allowedGoogleEmails} placeholder="name@example.com" validate={(v) => EMAIL_RE.test(v)} onChange={(v) => set((d) => void (d.auth.allowedGoogleEmails = v))} />
          </Field>
          {me.googleConfigured && (
            <a class="btn btn--default" href="/auth/google/login">
              <GoogleG size={16} />
              <span>{t('Link my Google account to sign in')}</span>
            </a>
          )}
        </Card>
      )}
      {pwOn && (
        <Card id="sec-password" title={t('Password')} icon="key">
          {me.mustChangePassword && (
            <Callout kind="warn">{t('You are using the initial password. Change it: until then it is only accepted from your local network.')}</Callout>
          )}
          {!me.mustChangePassword && me.passwordFromEnv && (
            <Callout>{t('The password comes from ADMIN_PASSWORD (install without the wizard). We recommend changing it here: the one in .env is then no longer used.')}</Callout>
          )}
          <ToggleRow
            label={t('Allow password sign-in')}
            hint={errors['auth.passwordLoginEnabled'] ? <span class="err-text">{t(errors['auth.passwordLoginEnabled'])}</span> : undefined}
            checked={a.passwordLoginEnabled}
            onChange={(v) => set((d) => void (d.auth.passwordLoginEnabled = v))}
          />
          <form class="pw-form" onSubmit={change}>
            <input type="text" name="username" autocomplete="username" value="admin" hidden readOnly />
            <Field label={t('Current password')}>
              <input class="input" type="password" autocomplete="current-password" value={cur} onInput={(e) => setCur(e.currentTarget.value)} />
            </Field>
            <div class="grid grid--2">
              <Field label={t('New password')} error={problemText || undefined} hint={t('At least {n} characters; nothing obvious.', { n: MIN_PASSWORD })}>
                <input class="input" type="password" autocomplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
              </Field>
              <Field label={t('Repeat password')} error={rep && rep !== next ? t('Passwords do not match') : undefined}>
                <input class="input" type="password" autocomplete="new-password" value={rep} onInput={(e) => setRep(e.currentTarget.value)} />
              </Field>
            </div>
            <div>
              <Button type="submit" variant="primary" icon="shield" loading={busy} disabled={!!pwErr || !cur || !next || rep !== next}>
                {t('Change password')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {(pwOn || googleOn) && (
        <Card id="sec-sessions" title={t('Sessions')} icon="shield">
          <p class="muted small">{t('Signs out every browser and device (including this one). Changing the password signs out the other sessions automatically.')}</p>
          <div>
            <Button
              variant="default"
              icon="logout"
              onClick={async () => {
                try {
                  await api.logoutAll();
                } catch {
                  /* ignore */
                }
                location.reload();
              }}
            >
              {t('Sign out everywhere')}
            </Button>
          </div>
        </Card>
      )}
      <Callout>
        {t('Calendar URLs, tokens and screen keys are never sent to other screens and never appear in the activity log.')}
      </Callout>
    </>
  );
}

function DisplayAccessCard({ mode, savedMode, onChange, go }: { mode: 'private' | 'open'; savedMode: 'private' | 'open'; onChange: (v: 'private' | 'open') => void; go: (r: string) => void }) {
  const opts: { v: 'private' | 'open'; icon: 'key' | 'wifi'; title: string; body: string; badge?: string }[] = [
    {
      v: 'private',
      icon: 'key',
      title: t('Private'),
      badge: t('Recommended'),
      body: t('Each screen gets in with its private link (/d/…) or by pairing it with a code. Without a key nothing is shown: safe on shared networks or when Marco is reachable from the Internet.'),
    },
    {
      v: 'open',
      icon: 'wifi',
      title: t('Open (local network)'),
      body: t('As before version 0.3: anyone who reaches the server’s address sees the calendar without a key. Only use it on a trusted home network.'),
    },
  ];
  return (
    <Card id="sec-display" title={t('Display access')} icon="monitor" desc={t('Who can see the family calendar on a screen.')}>
      <div class="access-mode" role="radiogroup" aria-label={t('Display access')}>
        {opts.map((o) => (
          <button type="button" role="radio" aria-checked={mode === o.v} class={`access-mode__opt ${mode === o.v ? 'is-active' : ''}`} onClick={() => onChange(o.v)}>
            <Icon name={o.icon} size={18} />
            <div>
              <strong>
                {o.title}
                {o.badge && <span class="badge badge--soft">{o.badge}</span>}
              </strong>
              <p>{o.body}</p>
            </div>
          </button>
        ))}
      </div>
      {mode === 'open' && savedMode === 'open' && (
        <Callout kind="warn">{t('Screens are in open mode: anyone who can reach this server can see the calendar without a key. Recommended: private links and pairing.')}</Callout>
      )}
      {mode === 'private' && savedMode === 'open' && (
        <Callout kind="warn">
          {t('When you save, screens that get in without a key will show a pairing code. Open each one’s private link (Screen → Settings) or pair it from Connected screens.')}
        </Callout>
      )}
      {mode === 'open' && savedMode === 'private' && (
        <Callout kind="warn">{t('When you save, anyone who reaches the server’s address will be able to see the calendar without a key. Screens showing a pairing code come back by themselves within a minute.')}</Callout>
      )}
      <p class="muted small">
        {t('Private links are in Screen → Settings; paired devices in Connected screens.')}{' '}
        <button type="button" class="link-btn" onClick={() => go('screen/scr-link')}>
          {t('See this screen’s link')}
        </button>
      </p>
    </Card>
  );
}
