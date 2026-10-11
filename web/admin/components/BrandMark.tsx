import { useMemo } from 'preact/hooks';
import { logoSvg } from '../../shared/logo';

/** The Calendar logo mark (inline SVG, sized by the `size` prop in px). */
export function BrandMark({ size = 40, class: cls = '' }: { size?: number; class?: string }) {
  const html = useMemo(() => logoSvg(), []);
  return <span class={`brand-mark-wrap ${cls}`} style={{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML={{ __html: html }} />;
}
