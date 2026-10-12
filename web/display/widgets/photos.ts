// Photo rotation controller: preloads + decodes the next image before showing it, then hands it to the
// CSS cross-fade.
import { coverPosition, coverWindow, freeBand, type PhotoFrame } from '../../shared/focus';
import type { PhotoStats } from '../../shared/glass';
import type { Photo } from '../../shared/types';
import { ctx } from '../ctx';
import { el, esc, reducedMotion } from '../dom';
import { mediaUrl } from '../identity';

/** set once the first photo's tone has been applied (see measureTone) */
let toneSeen = false;

export class Photos {
  private list: Photo[] = [];
  private idx = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading = false;
  private stopped = false;
  private domCur: HTMLElement | null = null;
  private meta: HTMLElement;
  private shownFile = '';
  private lastGallery = '';
  /** Called when the batch has been shown completely; may replace the list (awaited before wrapping around). */
  onExhausted: (() => Promise<void> | void) | null = null;
  /** Free band of the photo panel, used to keep the subject clear of the clock and weather. */
  frame: PhotoFrame | null = null;

  constructor(private area: HTMLElement, metaEl: HTMLElement) {
    this.meta = metaEl;
    this.area.classList.add('dom');
  }

  /** Gallery file on screen right now ('' for stock photos). */
  get currentFile(): string {
    return this.shownFile;
  }

  /** Last gallery photo shown (for `after=`: sequential orders continue from it). */
  get lastGalleryFile(): string {
    return this.lastGallery;
  }

  applyConfig(): void {
    const b = ctx.cfg.background;
    this.area.style.setProperty('--photo-bright', String(b.brightness));
    if (!this.domCur && this.idx >= 0) this.showCurrentAgain();
    this.area.style.display = b.enabled ? '' : 'none';
    this.reframe();
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.list = [];
    this.domCur?.remove();
    this.domCur = null;
    this.meta.style.display = 'none';
  }

  setList(photos: Photo[]): void {
    const sig = (l: Photo[]) => l.map((p) => `${p.url}@${p.focusX ?? ''},${p.focusY ?? ''}`).join('|');
    if (sig(photos) === sig(this.list)) return;
    // The photo on screen got a new focal point (edited in the admin): re-frame it right away.
    const shown = this.list[this.idx];
    const updated = shown && photos.find((p) => p.url === shown.url);
    const refocus = !!updated && (updated.focusX !== shown.focusX || updated.focusY !== shown.focusY);
    const first = this.list.length === 0;
    this.list = photos.slice();
    this.idx = -1;
    if (first) this.next();
    else if (refocus && updated) {
      this.list = [updated, ...photos.filter((p) => p !== updated)];
      this.idx = 0;
      this.showCurrentAgain();
    }
  }

  /**
   * Measure which vertical parts of the photo panel are covered by the side panel's text blocks and re-apply the
   * focal crop so the subject sits in the largest free band (layout changed, widgets appeared / disappeared).
   */
  reframe(): void {
    const f = this.measure();
    const prev = this.frame;
    const changed = !prev !== !f || (!!f && !!prev && (Math.abs(f.targetY - prev.targetY) > 0.01 || Math.abs(f.aspect - prev.aspect) > 0.01 ||
      JSON.stringify(f.blocks) !== JSON.stringify(prev.blocks)));
    if (!changed) return;
    this.frame = f;
    const n = this.domCur as (HTMLElement & { _ph?: { w: number; h: number; p: Photo } }) | null;
    if (n?._ph) this.frameDom(n, n._ph.w, n._ph.h, n._ph.p);
  }

  private measure(): PhotoFrame | null {
    const a = this.area.getBoundingClientRect();
    if (a.height < 10 || a.width < 10) return null;
    const blocks: [number, number][] = [];
    const side = document.querySelector<HTMLElement>('#app .side');
    if (side && side.offsetHeight > 0) {
      const els = [side.querySelector('.side-top'), ...Array.from(side.querySelectorAll('.side-mid > *')), side.querySelector('.side-bottom')];
      for (const el of els) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 2 || r.width < 2) continue;
        // only what actually sits over the photo (most of its width)
        if (Math.min(r.right, a.right) - Math.max(r.left, a.left) < a.width * 0.3) continue;
        const r3 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
        blocks.push([r3((r.top - a.top) / a.height), r3((r.bottom - a.top) / a.height)]);
      }
    }
    const band = freeBand(blocks);
    return {
      aspect: Math.round((a.width / a.height) * 1000) / 1000,
      targetY: Math.round(band.target * 1000) / 1000,
      freeTop: Math.round(band.top * 1000) / 1000,
      freeBottom: Math.round(band.bottom * 1000) / 1000,
      blocks: blocks.slice(0, 8),
    };
  }

  private frameDom(node: HTMLElement, w: number, h: number, p: Photo): void {
    const bw = this.area.clientWidth || window.innerWidth, bh = this.area.clientHeight || window.innerHeight;
    if (!ctx.cfg.background.cover || !w || !h) return;
    const ty = this.frame?.targetY ?? 0.5;
    node.style.backgroundPosition = coverPosition(w, h, bw, bh, p.focusX, p.focusY, 0.5, ty);
    const win = coverWindow(w, h, bw, bh, p.focusX, p.focusY, 0.5, ty);
    // zoom (Ken Burns) around the focal point, so it stays in frame
    node.style.transformOrigin = `${(win.ax * 100).toFixed(1)}% ${(win.ay * 100).toFixed(1)}%`;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped || !ctx.cfg.background.enabled) return;
    this.timer = setTimeout(() => this.next(), ctx.cfg.background.intervalSec * 1000);
  }

  private async load(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = mediaUrl(url);
    try {
      await img.decode();
    } catch (e) {
      // decode() can reject spuriously (e.g. under memory pressure); fall back to the load event
      if (!(img.complete && img.naturalWidth)) {
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(e);
          if (img.complete) (img.naturalWidth ? res() : rej(e));
        });
      }
    }
    return img;
  }

  async next(): Promise<void> {
    if (this.stopped) return;
    if (this.loading || !this.list.length || !ctx.cfg.background.enabled) {
      this.schedule();
      return;
    }
    this.loading = true;
    try {
      let tries = 0;
      while (tries++ < Math.min(5, this.list.length)) {
        if (this.idx + 1 >= this.list.length && this.onExhausted) {
          // batch done: fetch the next one first (it continues the rotation), then show its first photo
          try {
            await this.onExhausted();
          } catch {
            /* keep the old list */
          }
          if (!this.list.length) break;
        }
        this.idx++;
        if (this.idx >= this.list.length) this.idx = 0;
        const p = this.list[this.idx];
        try {
          const img = await this.load(p.url).catch(async () => {
            await new Promise((r) => setTimeout(r, 1500)); // one retry for transient network/decoder hiccups
            return this.load(p.url);
          });
          if (this.stopped) return;
          this.display(p, img);
          applyTone(img);
          break;
        } catch (e) {
          console.warn('[photos] failed', p.url, e);
        }
      }
    } finally {
      this.loading = false;
      this.schedule();
    }
  }

  private showCurrentAgain(): void {
    const p = this.list[this.idx];
    if (p) this.load(p.url).then((img) => { if (!this.stopped) this.display(p, img); }).catch((e) => console.warn('[photos]', e));
  }

  private display(p: Photo, img: HTMLImageElement): void {
    const b = ctx.cfg.background;
    this.shownFile = p.file || '';
    if (p.file) this.lastGallery = p.file;
    const node = el('div', `ph${b.cover ? '' : ' contain'}`);
    node.style.backgroundImage = `url("${img.src.replace(/"/g, '%22')}")`;
    node.style.setProperty('--kb-dur', `${b.intervalSec + 6}s`);
    node.style.setProperty('--kb-x', `${(Math.random() * 2 - 1).toFixed(2)}%`);
    node.style.setProperty('--kb-y', `${(Math.random() * 2 - 1).toFixed(2)}%`);
    (node as HTMLElement & { _ph?: unknown })._ph = { w: img.naturalWidth, h: img.naturalHeight, p };
    this.frameDom(node, img.naturalWidth, img.naturalHeight, p);
    const old = this.domCur;
    this.area.querySelector('.ph-stack')!.appendChild(node);
    this.domCur = node;
    const fade = b.transition !== 'none' && !reducedMotion();
    if (fade && typeof node.animate === 'function') {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2200, easing: 'ease-in-out', fill: 'backwards' }).onfinish = () =>
        old?.remove();
    } else old?.remove();
    const showMeta = b.showMeta && (p.author || p.title);
    this.meta.style.display = showMeta ? '' : 'none';
    if (showMeta) this.meta.innerHTML = esc(p.title ? `${p.title}${p.author ? ' · ' + p.author : ''}` : ctx.t('photoBy', { a: p.author! }));
  }
}

/**
 * Measure how bright / busy the photo is where text sits (clock: top, weather: bottom) and expose it as
 * --tone-top / --tone-bottom (0 = dark & calm, 1 = bright & busy). CSS scales the scrim and the frosted
 * weather card with it, so dark photos stay vivid and light ones stay legible.
 */
const toneCanvas = document.createElement('canvas');
/** Latest measure of the photo (for the Modern glass tint / ink); null until a photo could be read. */
export let photoStats: PhotoStats | null = null;
function applyTone(img: HTMLImageElement): void {
  try {
    const W = 48, H = 32;
    toneCanvas.width = W; toneCanvas.height = H;
    const g = toneCanvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data; // throws on tainted (non-CORS) images → keep defaults
    const region = (y0: number, y1: number) => {
      let sum = 0, sq = 0, n = 0;
      for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          sum += l; sq += l * l; n++;
        }
      }
      const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
      const bright = Math.min(1, Math.max(0, (mean - 0.18) / 0.5));
      const busy = Math.min(1, std / 0.22);
      return Math.min(1, bright * 0.75 + busy * 0.35);
    };
    const root = document.documentElement.style;
    // The first photo sets the tone at once: easing it in from the default made the glass cards and the chips
    // visibly change a second after the screen appeared. Later photos still ease (with the photo crossfade).
    const first = !toneSeen;
    toneSeen = true;
    if (first) document.documentElement.classList.add('tone-instant');
    root.setProperty('--tone-top', region(0, 0.4).toFixed(3));
    const toneBottom = region(0.5, 1);
    root.setProperty('--tone-bottom', toneBottom.toFixed(3));
    // whole frame: saturation-weighted colour (the dominant hue, not the grey average of everything)
    let wr = 0, wg = 0, wb = 0, ws = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g2 = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
      const w = 0.05 + (mx ? (mx - mn) / mx : 0) * Math.min(1, mx / 96);
      wr += r * w; wg += g2 * w; wb += b * w; ws += w;
    }
    photoStats = { tone: toneBottom, rgb: [wr / ws, wg / ws, wb / ws].map(Math.round) as [number, number, number] };
    window.dispatchEvent(new Event('marco:photo-tone'));
    if (first) {
      void getComputedStyle(document.documentElement).getPropertyValue('--tone-bottom');
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('tone-instant')));
    }
  } catch {
    /* cross-origin without CORS: leave the defaults */
  }
}
