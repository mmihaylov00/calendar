// Help and feedback (Marco Cloud, features.feedback): a short form that reaches the people who run the server, with
// the signed in email as reply-to, and a link to GitHub issues for those who prefer to report in public.
// Limits and the technical details are in ../feedbackForm.ts (tested).
import { useState } from 'preact/hooks';
import type { FeedbackKind, FeedbackMeta } from '../../shared/types';
import { api, ApiError } from '../api';
import { t } from '../i18n';
import { FEEDBACK_MAX, feedbackBody, GITHUB_ISSUES_URL, messageError, messageLength, metaRows } from '../feedbackForm';
import { toast } from './feedback';
import { Icon } from './icons';
import { Button, Field, Modal, Segmented, Textarea } from './ui';

const PLACEHOLDER: Record<FeedbackKind, string> = {
  problem: 'What you were doing, what you expected and what happened.',
  idea: 'What you would like Marco to do and what you would use it for.',
  other: 'Write whatever you want to tell us.',
};

export function FeedbackDialog(props: { email: string; meta: FeedbackMeta; onClose: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>('problem');
  const [message, setMessage] = useState('');
  const [withMeta, setWithMeta] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showError, setShowError] = useState(false);
  const error = messageError(message);
  const rows = metaRows(props.meta);

  const send = async () => {
    if (error) {
      setShowError(true);
      return;
    }
    setSending(true);
    try {
      await api.sendFeedback(feedbackBody(kind, message, props.meta, withMeta));
      setSent(true);
    } catch (e) {
      const err = e as ApiError;
      toast(err.status === 0 ? t('No connection to the server') : err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Modal title={t('Help and feedback')} icon="help" size="md" onClose={props.onClose} autoFocus={false} footer={<Button variant="primary" onClick={props.onClose}>{t('Close')}</Button>}>
        <div class="fb-done">
          <span class="fb-done__icon">
            <Icon name="check" size={26} />
          </span>
          <h4>{t('Thanks, we will read it.')}</h4>
          {props.email && <p class="muted">{t('If needed, we will reply to {email}.', { email: props.email })}</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('Help and feedback')}
      icon="help"
      size="md"
      onClose={props.onClose}
      dirty={messageLength(message) > 0}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose} disabled={sending}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon="check" loading={sending} onClick={send}>
            {t('Send')}
          </Button>
        </>
      }
    >
      <div class="fb">
        <p class="muted fb__intro">{t('Tell us what went wrong or what you miss. We read everything, even if we cannot always reply.')}</p>
        <Field label={t('Type')}>
          <Segmented<FeedbackKind>
            full
            value={kind}
            onChange={setKind}
            options={[
              { value: 'problem', label: t('Problem'), icon: 'alert' },
              { value: 'idea', label: t('Idea'), icon: 'sparkles' },
              { value: 'other', label: t('Something else'), icon: 'message' },
            ]}
          />
        </Field>
        <Field label={t('Message')} error={showError && error ? error : undefined}>
          <Textarea value={message} onValue={setMessage} rows={6} maxLength={FEEDBACK_MAX} placeholder={t(PLACEHOLDER[kind])} />
          <div class="fb__count muted small">
            {messageLength(message)}/{FEEDBACK_MAX}
          </div>
        </Field>
        {props.email && (
          <Field label={t('We will reply to')}>
            <div class="fb__reply">
              <Icon name="user" size={15} />
              <span>{props.email}</span>
            </div>
          </Field>
        )}
        <div class={`fb__meta ${withMeta ? 'is-on' : ''}`}>
          <label class="fb__check">
            <input type="checkbox" checked={withMeta} onChange={(e) => setWithMeta(e.currentTarget.checked)} />
            <span class="check-box">
              <Icon name="check" size={12} />
            </span>
            <span>{t('Include technical details')}</span>
          </label>
          <p class="muted small fb__meta-note">{withMeta ? t('This is exactly what will be sent with your message:') : t('Only your message will be sent.')}</p>
          {withMeta && (
            <dl class="fb__list">
              {rows.map(([k, v]) => (
                <>
                  <dt>{t(k)}</dt>
                  <dd>{v}</dd>
                </>
              ))}
            </dl>
          )}
        </div>
        <div class="fb__github">
          <a class="link-btn" href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={14} /> {t('Open an issue on GitHub')}
          </a>
          <p class="muted small">{t('GitHub issues are public: do not include personal details, addresses or private links.')}</p>
        </div>
      </div>
    </Modal>
  );
}
