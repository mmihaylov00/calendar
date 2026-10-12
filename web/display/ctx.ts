// Shared render context derived from the current config.
import type { DisplayConfig, Lang } from '../shared/types';
import { makeT, normLang } from '../shared/i18n';
import { DEFAULT_CONFIG } from './defaults';

export interface Ctx {
  cfg: DisplayConfig;
  lang: Lang;
  tz: string;
  t: ReturnType<typeof makeT>;
  lite: boolean;
  params: URLSearchParams;
}

const params = new URLSearchParams(location.search);

export const ctx: Ctx = {
  cfg: DEFAULT_CONFIG,
  lang: 'en',
  tz: 'Europe/Sofia',
  t: makeT('en'),
  lite: params.get('lite') === '1',
  params,
};

export function setCtxConfig(cfg: DisplayConfig): void {
  ctx.cfg = cfg;
  ctx.lang = normLang(params.get('lang') || cfg.screen.language);
  ctx.t = makeT(ctx.lang);
  ctx.tz = cfg.datetime.timezone || 'Europe/Sofia';
}
