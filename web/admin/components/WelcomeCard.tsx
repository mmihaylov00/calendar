// First-run welcome card on Inicio for Marco Cloud accounts (or any admin opened with ?welcome=1, which the cloud's
// sign-up flow sends): put the screen on a TV (the pairing dialog, which also offers the private link) or add
// calendars. It goes away for good once a display has connected or the user closes it (remembered per user in
// this browser). A self-hosted server has its own setup wizard and never shows it.
import { useEffect, useState } from 'preact/hooks';
import type { AuthMeResponse, DashboardResponse } from '../../shared/types';
import { api } from '../api';
import { caps, has } from '../caps';
import { t } from '../i18n';
import { openPairDialog } from './DisplayAccess';
import { Icon } from './icons';
import { Button } from './ui';

const LS_PREFIX = 'marco-admin.welcome-done:';

/** Sent by the cloud after sign-up; read once at load, then dropped from the address bar. */
const fromUrl = (() => {
  try {
    return new URLSearchParams(location.search).get('welcome') === '1';
  } catch {
    return false;
  }
})();

const keyOf = (me: AuthMeResponse) => LS_PREFIX + (me.user?.email ?? '').toLowerCase();
const isDone = (me: AuthMeResponse) => {
  try {
    return localStorage.getItem(keyOf(me)) === '1';
  } catch {
    return false;
  }
};
const markDone = (me: AuthMeResponse) => {
  try {
    localStorage.setItem(keyOf(me), '1');
  } catch {
    /* private mode: the card comes back on the next visit until a display connects */
  }
};

/** Whether this admin offers the card at all (multi-tenant server, or the ?welcome=1 hand-off). */
export const welcomeOffered = (me: AuthMeResponse) =>
  (fromUrl || caps().tenancy === 'multi' || has('accountMenu')) && me.account?.household.role !== 'member';

export function WelcomeCard({ me, dash, go, onShown }: { me: AuthMeResponse; dash: DashboardResponse | null; go: (r: string) => void; onShown?: (shown: boolean) => void }) {
  const offered = welcomeOffered(me);
  const [done, setDone] = useState(() => !offered || isDone(me));
  const anyDisplay = !!dash && dash.displays.length > 0;

  useEffect(() => {
    if (!fromUrl) return;
    try {
      const u = new URL(location.href);
      u.searchParams.delete('welcome');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch {
      /* ignore */
    }
  }, []);
  // A display that has connected once (paired or opened by its link) means the TV part is done.
  useEffect(() => {
    if (offered && anyDisplay && !done) {
      markDone(me);
      setDone(true);
    }
  }, [offered, anyDisplay, done]);
  // A TV paired from another browser that has not connected yet still counts.
  const waiting = offered && !done && !!dash && !anyDisplay;
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    api
      .devices()
      .then((r) => {
        if (live && r.devices.length > 0) {
          markDone(me);
          setDone(true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [waiting]);
  useEffect(() => {
    if (done) return;
    const onPaired = () => {
      markDone(me);
      setDone(true);
    };
    window.addEventListener('marco:paired', onPaired);
    return () => window.removeEventListener('marco:paired', onPaired);
  }, [done]);

  const shown = !done && !!dash && !anyDisplay;
  useEffect(() => onShown?.(shown), [shown]);
  if (!shown) return null;
  const close = () => {
    markDone(me);
    setDone(true);
  };
  return (
    <section class="card welcome-card" aria-labelledby="welcome-card-h">
      <button type="button" class="icon-btn welcome-card__close" onClick={close} title={t('Close')} aria-label={t('Close')}>
        <Icon name="x" size={16} />
      </button>
      <h2 id="welcome-card-h">{t('Your screen is ready')}</h2>
      <p>{t('Now put it on the TV and add your calendars.')}</p>
      <div class="welcome-card__actions">
        <Button variant="primary" icon="monitor" onClick={() => openPairDialog()}>
          {t('Put it on the TV')}
        </Button>
        <Button icon="calendar" onClick={() => go('calendars')}>
          {t('Add calendars')}
        </Button>
      </div>
      <p class="muted small">{t('You can change everything later and create more screens.')}</p>
    </section>
  );
}
