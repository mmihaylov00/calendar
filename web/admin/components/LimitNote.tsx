import { atLimit, limit, type LimitName } from '../caps';
import { t } from '../i18n';
import { Callout } from './ui';

/** Shown next to an "add" control: a warning when the list is over its limit, a short note when it is full. */
export function LimitNote({ name, count }: { name: LimitName; count: number }) {
  const max = limit(name);
  if (max == null || !atLimit(name, count)) return null;
  if (count > max) return <Callout kind="error">{t('There are {n} and the maximum is {max}. Remove some to be able to save.', { n: count, max })}</Callout>;
  return <p class="muted small limit-note">{t('You have reached the maximum ({max}).', { max })}</p>;
}
