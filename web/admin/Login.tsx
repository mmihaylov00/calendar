import { useState } from 'preact/hooks';
import type { AuthMeResponse } from '../shared/types';
import { api, ApiError } from './api';
import { BrandMark } from './components/BrandMark';
import { GoogleG, Icon } from './components/icons';
import { t } from './i18n';

export function Login({ me, onDone, initialError }: { me: AuthMeResponse; onDone: () => void; initialError?: string }) {
  // older servers do not send googleLoginEnabled: they offered Google whenever it was configured
  const googleLogin = me.googleLoginEnabled ?? me.googleConfigured;
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError ?? '');
  const [shake, setShake] = useState(0);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setErr('');
    try {
      await api.login(pw);
      onDone();
    } catch (e2) {
      const ae = e2 as ApiError;
      if (ae.status === 409) return location.reload(); // the install has no password yet → setup wizard
      setErr(ae.status === 401 ? t('Wrong password') : ae.status === 429 ? t('Too many attempts. Please wait a moment.') : ae.status === 403 && /default password/.test(ae.message) ? t('The initial password only works from your local network. Change it from the local network first.') : ae.message === 'network' ? t('Cannot reach the server') : ae.message);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <div class="login__bg" aria-hidden="true">
        <span class="blob blob--a" />
        <span class="blob blob--b" />
        <span class="blob blob--c" />
      </div>
      <div class={`login__card ${shake ? 'shake' : ''}`} key={shake}>
        <div class="login__logo">
          <BrandMark size={72} />
        </div>
        <h1>{t('Screen panel')}</h1>
        <p class="muted">{t('Manage calendars, photos, weather and everything shown at home.')}</p>
        {me.passwordLoginEnabled && (
          <form onSubmit={submit} class="login__form">
            <input type="text" name="username" autocomplete="username" value="admin" hidden readOnly />
            <div class="input-group input-group--lg">
              <span class="input-group__addon">
                <Icon name="key" size={16} />
              </span>
              <input
                class="input"
                type={(show ? 'text' : 'password') as 'password'}
                autocomplete="current-password"
                placeholder={t('Password')}
                value={pw}
                autoFocus
                onInput={(e) => setPw(e.currentTarget.value)}
              />
              <button type="button" class="input-group__btn" onClick={() => setShow(!show)} aria-label={t('Show')}>
                <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
            <button type="submit" class={`btn btn--primary btn--block btn--lg ${busy ? 'is-loading' : ''}`} disabled={busy || !pw}>
              {busy ? <span class="spinner" /> : null}
              <span>{t('Sign in')}</span>
            </button>
          </form>
        )}
        {me.passwordLoginEnabled && googleLogin && (
          <div class="divider">
            <span>{t('or')}</span>
          </div>
        )}
        {googleLogin && (
          <a class="btn btn--google btn--block btn--lg" href="/auth/google/login">
            <GoogleG size={18} />
            <span>{t('Sign in with Google')}</span>
          </a>
        )}
        {!me.passwordLoginEnabled && !googleLogin && <div class="callout callout--warn">{t('No sign-in method is enabled. Check the server configuration.')}</div>}
        {err && (
          <div class="login__err" role="alert">
            <Icon name="alert" size={14} /> {err}
          </div>
        )}
      </div>
      <a class="login__screen-link" href="/">
        <Icon name="monitor" size={14} /> {t('View the screen')}
      </a>
    </div>
  );
}
