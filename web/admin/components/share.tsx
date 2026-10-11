// Copy-to-clipboard field and QR code (setup wizard, private display links, pairing).
import { useMemo, useState } from 'preact/hooks';
import { qrSvg } from '../../shared/qr';
import { t } from '../i18n';
import { Icon } from './icons';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back */
  }
  // Plain-http LAN pages have no async clipboard API.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function CopyField({ value, mono = true, label }: { value: string; mono?: boolean; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div class={`copy-field ${mono ? 'copy-field--mono' : ''}`}>
      <code title={value}>{value}</code>
      <button
        type="button"
        class={`btn btn--default btn--sm ${done ? 'is-done' : ''}`}
        aria-label={label ?? t('Copy')}
        onClick={async () => {
          if (await copyText(value)) {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }
        }}
      >
        <Icon name={done ? 'check' : 'copy'} size={15} />
        <span>{done ? t('Copied') : t('Copy')}</span>
      </button>
    </div>
  );
}

export function Qr({ text, label }: { text: string; label: string }) {
  const svg = useMemo(() => {
    try {
      return qrSvg(text, { dark: '#0b0d11', light: '#ffffff', title: label });
    } catch {
      return '';
    }
  }, [text, label]);
  if (!svg) return null;
  return <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

