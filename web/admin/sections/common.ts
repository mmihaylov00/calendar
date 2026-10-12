import type { AppConfig, AuthMeResponse, StoredConfig } from '../../shared/types';
import type { Errors } from '../util';

export interface SectionProps {
  /** Flat view of the selected screen (global sections merged with that screen's sections). */
  cfg: AppConfig;
  /** Mutate a cloned draft of the flat view (written back to the selected screen + globals). */
  set: (fn: (d: AppConfig) => void) => void;
  /** Visible errors for the selected screen + global lists. */
  errors: Errors;
  me: AuthMeResponse;
  /** Save the draft immediately (used before leaving the page, e.g. Google connect). */
  save: () => Promise<boolean>;
  dirty: boolean;
  /** Full v2 draft (screens[], global lists). */
  full: StoredConfig;
  /** Saved (server) version of the config, for "what is live" comparisons. */
  saved: StoredConfig;
  /** Navigate to a route (hash) */
  go: (route: string) => void;
}
