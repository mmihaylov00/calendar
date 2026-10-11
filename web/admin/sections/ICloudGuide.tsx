import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { fetchErrorText } from '../apiErrors';
import { toast } from '../components/feedback';
import { Button, Callout, Field, Modal, Segmented, TextInput } from '../components/ui';
import { Icon } from '../components/icons';
import { t } from '../i18n';
import { isHttpUrl } from '../util';

type Device = 'iphone' | 'mac' | 'web';

/** Steps per device to get the public link of an iCloud calendar (Apple's English UI names). */
const STEPS: Record<Device, string[]> = {
  iphone: [
    'Open the Calendar app and tap Calendars.',
    'Tap ⓘ next to the iCloud calendar you want to show.',
    'Turn on Public Calendar, then tap Share Link.',
    'Choose Copy and paste the link below.',
  ],
  mac: [
    'Open the Calendar app on your Mac.',
    'In the calendar list, hold the pointer over the iCloud calendar and click the share icon (or Control-click it and choose Share Calendar).',
    'Select Public Calendar.',
    'Copy the address that appears (it starts with webcal://) and paste it below.',
  ],
  web: [
    'Go to icloud.com/calendar on a computer or tablet.',
    'Hold the pointer over the calendar in the sidebar and click the share icon.',
    'Turn on Public Calendar and select Copy.',
    'Paste the link below.',
  ],
};

/** webcal:// is the same feed over HTTPS (iCloud gives webcal:// links). */
export const icloudUrl = (s: string) => s.trim().replace(/^webcal:\/\//i, 'https://');

/**
 * Apple iCloud has no API to link an account: this guide explains how to get a calendar's public link and adds it as
 * an iCal source (after testing it). The caller adds the source; the user still saves as usual.
 */
export function ICloudGuide({
  onClose,
  onAdd,
  exists,
  disabled,
  note,
}: {
  onClose: () => void;
  onAdd: (name: string, url: string) => void;
  /** a source with this URL is already in the list */
  exists: (url: string) => boolean;
  /** the list is full (plan limit) */
  disabled?: boolean;
  /** shown under the fields (the limit note) */
  note?: ComponentChildren;
}) {
  const [device, setDevice] = useState<Device>(() => (/Macintosh/.test(navigator.userAgent) && !('ontouchend' in document) ? 'mac' : 'iphone'));
  const [url, setUrl] = useState('');
  const [name, setName] = useState('iCloud');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** the test failed once for this URL: the button adds it anyway */
  const [failed, setFailed] = useState(false);
  const u = icloudUrl(url);
  const valid = !!u && isHttpUrl(u);

  const add = async () => {
    if (!valid) return setError(t('Invalid URL: it must start with https://, http:// or webcal://'));
    if (exists(u)) return setError(t('That calendar is already in the list.'));
    if (!failed) {
      setBusy(true);
      try {
        const res = await api.testIcs(u);
        if (!res.ok) {
          setError(fetchErrorText(res.error) || t('Could not read the calendar'));
          setFailed(true);
          return;
        }
      } catch (e) {
        setError((e as ApiError).message || t('Could not read the calendar'));
        setFailed(true);
        return;
      } finally {
        setBusy(false);
      }
    }
    onAdd(name.trim() || 'iCloud', u);
    toast(t('Calendar added. Save to apply the changes.'));
    onClose();
  };

  return (
    <Modal
      title={t('Apple iCloud calendar')}
      icon="apple"
      size="sm"
      autoFocus={false}
      dirty={!!url.trim()}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon="plus" loading={busy} disabled={disabled || !url.trim()} onClick={add}>
            {failed ? t('Add anyway') : t('Add calendar')}
          </Button>
        </>
      }
    >
      <div class="stack icloud-guide">
        <p class="muted">{t('To show an iCloud calendar you need its public link. Here is how to get it:')}</p>
        <Segmented
          full
          value={device}
          options={[
            { value: 'iphone', label: t('iPhone or iPad') },
            { value: 'mac', label: 'Mac' },
            { value: 'web', label: 'iCloud.com' },
          ]}
          onChange={setDevice}
        />
        <ol class="howto">
          {STEPS[device].map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ol>
        <Callout kind="info">{t('Anyone who has the link can see the calendar, but it is long and impossible to guess. Changes you make in iCloud reach Calendar within a few minutes.')}</Callout>
        <Field label={t('Calendar link')} error={error || undefined}>
          <TextInput
            mono
            value={url}
            placeholder="webcal://p…-caldav.icloud.com/published/…"
            inputMode="url"
            autocomplete="off"
            spellcheck={false}
            prefix={<Icon name="link" size={14} />}
            onValue={(v) => {
              setUrl(v);
              setError('');
              setFailed(false);
            }}
          />
        </Field>
        <Field label={t('Name')}>
          <TextInput value={name} placeholder="iCloud" onValue={setName} />
        </Field>
        {note}
      </div>
    </Modal>
  );
}
