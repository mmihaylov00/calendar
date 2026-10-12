import { GLASS_DEFAULTS, glassVars, normalizeGlass, type PhotoStats } from '../../shared/glass';
import type { DisplayStyle, GlassConfig, LayoutPreset } from '../../shared/types';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Field, PageHeader, Segmented, Slider, ToggleRow } from '../components/ui';
import { t } from '../i18n';
import { allSourceOptions } from '../util';
import type { SectionProps } from './common';

export const PRESETS: { id: LayoutPreset; name: string; desc: string; wizard?: boolean }[] = [
  { id: 'bigCalendar', name: 'Big calendar', desc: 'Full month on a big screen with clock and weather in a side column.', wizard: true },
  { id: 'twoWeeks', name: 'Two weeks', desc: 'This week and the next, with more room for each day. Today is highlighted.' },
  { id: 'leftRight', name: 'Left / Right', desc: 'Photo on one side; clock, weather and agenda on the other. Ideal for landscape screens.', wizard: true },
  { id: 'topBottom', name: 'Top / Bottom', desc: 'Clock and weather on top, calendar below. Great for portrait screens or tablets.', wizard: true },
  { id: 'agenda', name: 'Agenda', desc: 'Upcoming events grouped by day, readable from afar (mobile / tablet).', wizard: true },
  { id: 'today', name: 'Today', desc: 'The day hour by hour with a line for now, the next event in large type and the weather for the coming hours. For the kitchen in the morning.' },
  { id: 'people', name: 'Per person', desc: 'One column per person (per calendar) with today and tomorrow.' },
  { id: 'bigTime', name: 'Big time', desc: 'Large clock over the photo, with today’s and tomorrow’s agenda.', wizard: true },
];

/** Tiny schematic drawing of each layout preset. */
export function Schematic({ id, side }: { id: LayoutPreset; side: 'left' | 'right' }) {
  const accent = 'var(--accent)';
  const block = 'var(--schem-block)';
  const photo = `url(#ph-${id})`;
  const L = side === 'left';
  const cells = (x: number, y: number, w: number, h: number, cols: number, rows: number) => {
    const out = [];
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        out.push(<rect x={x + c * cw + 0.6} y={y + r * ch + 0.6} width={cw - 1.2} height={ch - 1.2} rx={1} fill={block} opacity={r === 1 && c === 3 ? 1 : 0.55} />);
    return out;
  };
  return (
    <svg viewBox="0 0 160 90" class="schematic" aria-hidden="true">
      <defs>
        <linearGradient id={`ph-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b3d63" />
          <stop offset="0.55" stop-color="#7a4b63" />
          <stop offset="1" stop-color="#d0875e" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" rx="6" fill={photo} />
      <path d="M0 70 L40 48 L70 62 L105 40 L160 66 L160 90 L0 90 Z" fill="#000" opacity=".28" />
      {id === 'bigCalendar' && (
        <g>
          <rect x={L ? 6 : 108} y="6" width="46" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x={L ? 11 : 113} y="12" width="30" height="8" rx="2" fill={accent} />
          <rect x={L ? 11 : 113} y="25" width="20" height="4" rx="2" fill="var(--schem-line)" />
          <rect x={L ? 11 : 113} y="40" width="36" height="14" rx="3" fill="var(--schem-line)" opacity=".5" />
          {cells(L ? 56 : 6, 6, 98, 78, 7, 5)}
          <rect x={(L ? 56 : 6) + 3 * 14 + 1} y={6 + 15.6 + 1} width="12" height="13.6" rx="1.5" fill="none" stroke={accent} stroke-width="1.4" />
        </g>
      )}
      {id === 'leftRight' && (
        <g>
          <rect x={L ? 6 : 82} y="6" width="72" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x={L ? 12 : 88} y="13" width="40" height="11" rx="2" fill={accent} />
          <rect x={L ? 12 : 88} y="29" width="26" height="4" rx="2" fill="var(--schem-line)" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect x={L ? 12 : 88} y={42 + i * 8} width={56 - (i % 2) * 14} height="5" rx="2" fill="var(--schem-line)" opacity=".55" />
          ))}
        </g>
      )}
      {id === 'topBottom' && (
        <g>
          <rect x="6" y="6" width="148" height="24" rx="4" fill={block} opacity="0.9" />
          <rect x="12" y="11" width="38" height="14" rx="2" fill={accent} />
          <rect x="112" y="12" width="36" height="12" rx="3" fill="var(--schem-line)" opacity=".5" />
          {cells(6, 34, 148, 50, 7, 3)}
        </g>
      )}
      {id === 'bigTime' && (
        <g>
          <rect x="40" y="22" width="80" height="26" rx="4" fill={accent} />
          <rect x="58" y="53" width="44" height="4" rx="2" fill="var(--schem-line)" />
          <rect x="6" y="66" width="148" height="18" rx="4" fill={block} opacity="0.9" />
          {[0, 1, 2].map((i) => (
            <rect x={12 + i * 48} y="71" width="40" height="8" rx="2" fill="var(--schem-line)" opacity=".55" />
          ))}
        </g>
      )}
      {id === 'twoWeeks' && (
        <g>
          <rect x={L ? 6 : 116} y="6" width="38" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x={L ? 11 : 121} y="12" width="26" height="8" rx="2" fill={accent} />
          <rect x={L ? 11 : 121} y="25" width="18" height="4" rx="2" fill="var(--schem-line)" />
          {cells(L ? 48 : 6, 6, 106, 78, 7, 2)}
          <rect x={(L ? 48 : 6) + 3 * 15.14 + 0.6} y={45.6} width="13.9" height="37.8" rx="1.5" fill="none" stroke={accent} stroke-width="1.4" />
        </g>
      )}
      {id === 'today' && (
        <g>
          <rect x="6" y="6" width="44" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x="11" y="12" width="28" height="8" rx="2" fill={accent} />
          <rect x="11" y="62" width="34" height="16" rx="3" fill="var(--schem-line)" opacity=".5" />
          <rect x="54" y="6" width="100" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x="58" y="10" width="92" height="16" rx="3" fill="var(--schem-line)" opacity=".35" />
          <rect x="62" y="14" width="40" height="5" rx="2" fill="var(--schem-line)" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect x="66" y={32 + i * 10} width="84" height=".8" fill="var(--schem-line)" opacity=".45" />
          ))}
          <rect x="68" y="35" width="60" height="7" rx="1.5" fill="#4c8dff" opacity=".7" />
          <rect x="68" y="62" width="46" height="7" rx="1.5" fill="#2ec4b6" opacity=".7" />
          <rect x="60" y="51" width="90" height="1.4" fill={accent} />
          <circle cx="62" cy="51.7" r="2" fill={accent} />
        </g>
      )}
      {id === 'people' && (
        <g>
          <rect x="6" y="6" width="148" height="20" rx="4" fill={block} opacity="0.9" />
          <rect x="12" y="10" width="34" height="12" rx="2" fill={accent} />
          {[0, 1, 2, 3].map((i) => (
            <g>
              <rect x={6 + i * 37.5} y="30" width="35" height="54" rx="3" fill={block} opacity=".75" />
              <circle cx={13 + i * 37.5} cy="37" r="3.6" fill={['#4c8dff', '#ff9f1c', '#2ec4b6', '#9b5de5'][i]} />
              {[0, 1, 2].map((j) => (
                <rect x={10 + i * 37.5} y={46 + j * 9} width={26 - ((i + j) % 2) * 8} height="4" rx="1.5" fill="var(--schem-line)" opacity=".55" />
              ))}
            </g>
          ))}
        </g>
      )}



      {id === 'agenda' && (
        <g>
          <rect x="6" y="6" width="148" height="16" rx="4" fill={block} opacity="0.9" />
          <rect x="12" y="10" width="30" height="8" rx="2" fill={accent} />
          {[0, 1, 2, 3].map((i) => (
            <g>
              <rect x="6" y={26 + i * 15} width="148" height="12" rx="3" fill={block} opacity=".7" />
              <rect x="10" y={29 + i * 15} width="3" height="6" rx="1" fill={accent} />
              <rect x="18" y={30 + i * 15} width={70 - i * 9} height="4" rx="2" fill="var(--schem-line)" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export const STYLES: { id: DisplayStyle; name: string; desc: string }[] = [
  { id: 'modern', name: 'Modern', desc: 'More minimal, Apple-like: glass cards over the photo, a Lock Screen clock and fewer lines.' },
  { id: 'classic', name: 'Classic', desc: 'The original look: thin clock, outlined cards and the full grid.' },
];

/** Tiny drawing of each display style (same scene: photo with clock + widgets, calendar on the right). */
export function StyleThumb({ id }: { id: DisplayStyle }) {
  const modern = id === 'modern';
  const accent = 'var(--accent)';
  const rows = [0, 1, 2, 3];
  const cols = [0, 1, 2, 3, 4, 5, 6];
  return (
    <svg viewBox="0 0 160 90" class="schematic" aria-hidden="true">
      <defs>
        <linearGradient id={`st-ph-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b3d63" />
          <stop offset="0.55" stop-color="#7a4b63" />
          <stop offset="1" stop-color="#d0875e" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" rx="6" fill="#0d0e12" />
      <path d="M6 0 H58 V90 H6 a6 6 0 0 1 -6 -6 V6 a6 6 0 0 1 6 -6z" fill={`url(#st-ph-${id})`} />
      <text x={modern ? 8 : 9} y="22" fill="#fff" font-size="15" font-weight={modern ? 600 : 200} letter-spacing={modern ? -0.6 : 0} font-family="system-ui, sans-serif">
        9:41
      </text>
      {modern ? (
        <g>
          <rect x="6" y="40" width="46" height="18" rx="5" fill="#fff" fill-opacity=".2" stroke="#fff" stroke-opacity=".45" stroke-width=".6" />
          <rect x="10" y="45" width="5" height="5" rx="1.4" fill={accent} opacity=".85" />
          <rect x="18" y="46" width="22" height="3" rx="1.5" fill="#fff" opacity=".85" />
          <rect x="6" y="62" width="46" height="22" rx="6" fill="#fff" fill-opacity=".2" stroke="#fff" stroke-opacity=".45" stroke-width=".6" />
          <text x="10" y="76" fill="#fff" font-size="9" font-weight="300" font-family="system-ui, sans-serif">19°</text>
        </g>
      ) : (
        <g>
          <rect x="6" y="40" width="46" height="9" rx="4.5" fill="#000" fill-opacity=".45" stroke={accent} stroke-width=".7" />
          <rect x="6" y="51" width="46" height="9" rx="4.5" fill="#000" fill-opacity=".45" stroke="#2ec4b6" stroke-width=".7" />
          <rect x="6" y="64" width="46" height="20" rx="4" fill="#000" fill-opacity=".5" stroke="#fff" stroke-opacity=".25" stroke-width=".6" />
          <text x="10" y="78" fill="#fff" font-size="10" font-weight="200" font-family="system-ui, sans-serif">19°</text>
        </g>
      )}
      <rect x="64" y="7" width={modern ? 30 : 26} height="5" rx="1.5" fill="#fff" opacity={modern ? 0.95 : 0.75} />
      {rows.map((r) => (
        <g>
          <rect x="64" y={18 + r * 17.5} width="90" height=".5" fill="#fff" opacity={modern ? 0.18 : 0.14} />
          {cols.map((c) => (
            <g>
              {!modern && c > 0 && <rect x={64 + c * 12.9} y={18 + r * 17.5} width=".5" height="17.5" fill="#fff" opacity=".14" />}
              {modern && r === 1 && c === 3 ? (
                <circle cx={64 + c * 12.9 + 4.5} cy={18 + r * 17.5 + 4.5} r="3.2" fill={accent} />
              ) : (
                <rect x={64 + c * 12.9 + 2} y={18 + r * 17.5 + 2.5} width="5" height="2.4" rx=".8" fill="#fff" opacity={modern ? 0.7 : 0.45} />
              )}
              {!modern && r === 1 && c === 3 && (
                <rect x={64 + c * 12.9 + 0.6} y={18 + r * 17.5 + 0.6} width="11.7" height="16.3" rx="1.5" fill="none" stroke={accent} stroke-width=".8" />
              )}
            </g>
          ))}
          {r !== 2 && (
            <rect
              x={64 + (r % 2) * 25 + 1}
              y={18 + r * 17.5 + 9}
              width={modern ? 36 : 50}
              height="4"
              rx={modern ? 1.6 : 1}
              fill={['#4c8dff', '#2ec4b6', '', '#f15bb5'][r]}
              opacity={modern ? 0.45 : 0.95}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

/** The two sample photos of the glass preview (a dark dusk and a bright beach), with their measured stats. */
const GLASS_SCENES: { id: string; label: string; stats: PhotoStats }[] = [
  { id: 'dark', label: 'Dark photo', stats: { tone: 0.18, rgb: [92, 70, 128] } },
  { id: 'bright', label: 'Bright photo', stats: { tone: 0.85, rgb: [70, 150, 190] } },
];

/** Live preview of the glass settings: the same maths as the screen, drawn over two sample photos. */
export function GlassPreview({ glass }: { glass: GlassConfig }) {
  return (
    <div class="glass-pv" aria-hidden="true">
      {GLASS_SCENES.map((sc) => {
        const g = glassVars(glass, sc.stats, { lite: false, hasPhoto: true });
        const v = g.vars;
        const blur = normalizeGlass(glass).blur;
        const style = {
          '--pv-bg': `rgb(${v['--g-rgb']} / ${v['--g-a']})`,
          '--pv-filter': blur > 0 ? `blur(${(blur * 0.45).toFixed(1)}px) saturate(${v['--g-filter'].match(/saturate\(([\d.]+)\)/)?.[1] ?? '1.8'})` : 'none',
          '--g-edge': v['--g-edge'],
        } as Record<string, string>;
        return (
          <div class={`glass-pv__scene glass-pv__scene--${sc.id}`}>
            <div class="glass-pv__sun" />
            <div class="glass-pv__hill" />
            <div class={`glass-pv__card ${g.inkDark ? 'is-ink-dark' : ''} ${g.thin ? 'is-thin' : ''} ${g.edge ? 'has-edge' : ''}`} style={style}>
              <div class="glass-pv__row">
                <span class="glass-pv__loc">Lisboa</span>
                <span class="glass-pv__temp">19°</span>
              </div>
              <div class="glass-pv__ev">
                <i />
                <span>17:30</span>
              </div>
            </div>
            <span class="glass-pv__label">{t(sc.label)}</span>
          </div>
        );
      })}
    </div>
  );
}

const opacityWord = (v: number) =>
  v < 0.2 ? 'Very see-through' : v < 0.42 ? 'More see-through' : v <= 0.58 ? 'Balanced' : v <= 0.8 ? 'More solid' : 'Very solid';

/** Glass options of the Modern style (like the iPhone's Liquid Glass settings). */
export function GlassCard({ cfg, set }: Pick<SectionProps, 'cfg' | 'set'>) {
  const g = normalizeGlass(cfg.screen.glass);
  const put = <K extends keyof GlassConfig>(k: K, v: GlassConfig[K]) =>
    set((d) => void (d.screen.glass = { ...normalizeGlass(d.screen.glass), [k]: v }));
  const isDefault = (Object.keys(GLASS_DEFAULTS) as (keyof GlassConfig)[]).every((k) => g[k] === GLASS_DEFAULTS[k]);
  return (
    <Card
      id="layout-glass"
      scope="screen"
      title={t('Glass')}
      icon="sparkles"
      desc={t('How the glass cards of the Modern style look on this screen.')}
      actions={
        <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => set((d) => void (d.screen.glass = { ...GLASS_DEFAULTS }))}>
          {t('Reset')}
        </Button>
      }
    >
      <div class="glass-set">
        <GlassPreview glass={g} />
        <div class="glass-set__controls">
          <Field label={t('Appearance')} hint={t('Automatic adapts to each photo: clearer over dark photos, more tinted over bright ones.')}>
            <Segmented
              value={g.appearance}
              full
              options={[
                { value: 'clear', label: t('Clear') },
                { value: 'tinted', label: t('Tinted') },
                { value: 'auto', label: t('Automatic') },
              ]}
              onChange={(v) => put('appearance', v)}
            />
          </Field>
          <Field label={t('Transparency')}>
            <Slider value={g.opacity} min={0} max={1} step={0.05} format={(v) => t(opacityWord(v))} onChange={(v) => put('opacity', v)} />
          </Field>
          <Field label={t('Blur')} hint={t('On the Raspberry Pi (lite mode) there is no blur and the cards are solid.')}>
            <Slider value={g.blur} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('No blur'))} onChange={(v) => put('blur', v)} />
          </Field>
          <Field label={t('Tint')} hint={t('With “From the photo”, the glass takes the colour of the photo on screen, as the iPhone does.')}>
            <Segmented
              value={g.tint}
              full
              options={[
                { value: 'light', label: t('Light') },
                { value: 'dark', label: t('Dark') },
                { value: 'photo', label: t('From the photo') },
              ]}
              onChange={(v) => put('tint', v)}
            />
          </Field>
          <ToggleRow label={t('Edge highlight')} hint={t('A thin bright line along the edge of each card.')} checked={g.edge} onChange={(v) => put('edge', v)} />
        </div>
      </div>
    </Card>
  );
}

/** Calendar columns for the people layout. */
function PresetOptions({ cfg, set, full }: SectionProps) {
  const l = cfg.layout;

  if (l.preset !== 'people') return null;
  const opts = allSourceOptions(full, { includeDisabled: false }).filter((o) => o.id !== 'birthdays');
  const holidays = new Set(full.calendar.sources.filter((x) => x.kind === 'holidays').map((x) => x.id));
  const auto = !Array.isArray(l.people);
  const ids = l.people ?? [];
  const full5 = ids.length >= 5;
  const toggle = (id: string, on: boolean) =>
    set((d) => {
      const cur = d.layout.people ?? [];
      const next = new Set(on ? [...cur, id] : cur.filter((x) => x !== id));
      d.layout.people = opts.map((o) => o.id).filter((x) => next.has(x)).slice(0, 5);
    });
  return (
    <Card id="layout-options" scope="screen" title={t('Columns per person')} icon="list" desc={t('Each chosen calendar is a column with today and tomorrow. Holidays and birthdays go in a shared line above.')}>
      <Segmented
        full
        value={auto ? 'auto' : 'pick'}
        options={[
          { value: 'auto', label: t('Automatic') },
          { value: 'pick', label: t('Choose calendars') },
        ]}
        onChange={(v) => set((d) => void (d.layout.people = v === 'auto' ? null : opts.filter((o) => !holidays.has(o.id)).slice(0, 5).map((o) => o.id)))}
      />
      {auto ? (
        <p class="muted small">{t('The first five calendars are used, without holidays or birthdays.')}</p>
      ) : (
        <>
          <ul class="gcal-list screen-src-list">
            {opts.map((o) => {
              const on = ids.includes(o.id);
              return (
                <li>
                  <label class={`gcal ${on ? 'is-on' : ''} ${!on && full5 ? 'is-dim' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!on && full5} onChange={(e) => toggle(o.id, e.currentTarget.checked)} />
                    <span class="check-box">
                      <Icon name="check" size={12} />
                    </span>
                    <span class="dot-color" style={{ background: o.color }} />
                    <span class="gcal__name">
                      {o.emoji ? `${o.emoji} ` : ''}
                      {o.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p class="muted small">{t('Up to five columns, shown in the order of this list.')}</p>
          {ids.length === 0 && <Callout kind="warn">{t('No calendar is ticked: the screen will ask you to choose one.')}</Callout>}
        </>
      )}
    </Card>
  );
}

export function LayoutSection(props: SectionProps) {
  const { cfg, set } = props;
  const l = cfg.layout;
  const hasSide = ['bigCalendar', 'leftRight', 'today', 'twoWeeks'].includes(l.preset);
  const style: DisplayStyle = cfg.screen.style === 'modern' ? 'modern' : 'classic';
  return (
    <>
      <PageHeader title={t('Layout')} scope="screen" desc={t('Choose how elements are arranged on the screen.')} />
      <Card
        id="layout-style"
        scope="screen"
        title={t('Display style')}
        icon="palette"
        desc={t('Independent of the layout: each screen can have its own style.')}
      >
        <Field label={t('Style')}>
          <Segmented
            value={style}
            options={STYLES.map((o) => ({ value: o.id, label: t(o.name) }))}
            onChange={(v) => set((d) => void (d.screen.style = v))}
          />
        </Field>
        <div class="preset-grid style-grid">
          {STYLES.map((o) => (
            <button
              type="button"
              class={`preset ${style === o.id ? 'is-active' : ''}`}
              onClick={() => set((d) => void (d.screen.style = o.id))}
              aria-pressed={style === o.id}
            >
              <StyleThumb id={o.id} />
              <div class="preset__text">
                <div class="preset__name">
                  <span class="radio-dot" />
                  {t(o.name)}
                </div>
                <p>{t(o.desc)}</p>
              </div>
            </button>
          ))}
        </div>
      </Card>
      {style === 'modern' && <GlassCard cfg={cfg} set={set} />}
      <div class="preset-grid" id="layout-presets">
        {PRESETS.map((p) => (
          <button
            type="button"
            class={`preset ${l.preset === p.id ? 'is-active' : ''}`}
            onClick={() => set((d) => void (d.layout.preset = p.id))}
            aria-pressed={l.preset === p.id}
          >
            <Schematic id={p.id} side={l.sidePanel} />
            <div class="preset__text">
              <div class="preset__name">
                <span class="radio-dot" />
                {t(p.name)}
              </div>
              <p>{t(p.desc)}</p>
            </div>
          </button>
        ))}
      </div>
      <PresetOptions {...props} />
      <Card id="layout-side" scope="screen" title={t('Side panel')} icon="layout" desc={t('Only for layouts with a side column.')} muted={!hasSide}>
        <div class="grid grid--2">
          <Field label={t('Position')}>
            <Segmented
              value={l.sidePanel}
              disabled={!hasSide}
              options={[
                { value: 'left', label: t('Left') },
                { value: 'right', label: t('Right') },
              ]}
              onChange={(v) => set((d) => void (d.layout.sidePanel = v))}
            />
          </Field>
          <Field label={t('Width')}>
            <Slider
              value={l.sideWidth}
              min={0.22}
              max={0.5}
              step={0.01}
              disabled={!hasSide}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => set((d) => void (d.layout.sideWidth = v))}
            />
          </Field>
        </div>
      </Card>
    </>
  );
}
