import type { AuthMeResponse } from '../shared/types';
import { appBase } from '../shared/path';

export function homeAssistantMode(me: AuthMeResponse | null): boolean {
  return !!appBase() || !!me?.homeAssistant || me?.user?.method === 'homeassistant';
}
