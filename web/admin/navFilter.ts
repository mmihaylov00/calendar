import type { AppConfig, FeatureName } from '../shared/types';
import type { IconName } from './components/icons';
import { hasFeature, type Caps } from './caps';

export interface NavMeta {
  id: 'calendars' | 'layout' | 'background' | 'weather' | 'photos';
  label: string;
  icon: IconName;
  feature?: FeatureName;
  enabled?: (config: AppConfig) => boolean;
}

export const NAV_ITEMS: NavMeta[] = [
  { id: 'calendars', label: 'Calendars', icon: 'calendar' },
  { id: 'layout', label: 'Layout', icon: 'layout' },
  { id: 'background', label: 'Background', icon: 'image' },
  { id: 'weather', label: 'Weather', icon: 'cloud' },
  { id: 'photos', label: 'Gallery', icon: 'photos', feature: 'gallery' },
];

export function filterNav(items: readonly NavMeta[], caps: Caps): NavMeta[] {
  return items.filter((item) => !item.feature || hasFeature(caps, item.feature));
}

export function routeFor(id: string, visible: readonly { id: string }[]): string {
  return visible.some((item) => item.id === id) ? id : 'calendars';
}
