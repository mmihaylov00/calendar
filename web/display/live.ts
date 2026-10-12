// Calendar config polling backs up live SSE updates when a connection drops.
import type { StreamHello } from '../shared/types';

export const CONFIG_POLL_MS = 90_000;

export interface ConfigPollOptions {
  /** Current config revision (before the fetch). */
  revision: () => number | undefined;
  /** Fetch, save and apply the config; false on failure (401 / 403 handling lives in the caller). */
  fetchConfig: () => Promise<boolean>;
  /** Called after a fetched config carries a different revision (refetch calendar events). */
  changed: () => void;
  intervalMs?: number;
}

/** Poll the display config; same contract as the SSE `config` event. */
export function startConfigPoll(o: ConfigPollOptions): { close(): void; tick(): Promise<void> } {
  let closed = false;
  let busy = false;
  const tick = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const before = o.revision();
      if ((await o.fetchConfig()) && !closed && o.revision() !== before) o.changed();
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? CONFIG_POLL_MS);
  return {
    close() {
      closed = true;
      clearInterval(timer);
    },
    tick,
  };
}

export interface StreamHandlers {
  hello?: (d: Partial<StreamHello>) => void;
  config?: (d: { revision: number }) => void;
  reload?: () => void;
  events?: (d: { hash: string }) => void;
  photos?: (d: { hidden?: string[] }) => void;
  revoked?: (d: { code: string }) => void;
  open?: () => void;
  down?: () => void;
}

/** Ignore unknown or malformed updates before calling the calendar's handlers. */
export function dispatch(name: string, data: unknown, h: StreamHandlers): boolean {
  const d = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  switch (name) {
    case 'hello': h.hello?.(d as Partial<StreamHello>); return true;
    case 'config': if (typeof d.revision === 'number') h.config?.({ revision: d.revision }); return true;
    case 'events': if (typeof d.hash === 'string') h.events?.({ hash: d.hash }); return true;
    case 'photos':
      h.photos?.({ hidden: Array.isArray(d.hidden) ? d.hidden.filter((f): f is string => typeof f === 'string') : undefined });
      return true;
    case 'reload': h.reload?.(); return true;
    case 'revoked': h.revoked?.({ code: typeof d.code === 'string' ? d.code : 'invalid_key' }); return true;
    default: return false;
  }
}
