// Marco brand mark (web/public/favicon.svg) as inline SVG markup for the admin and the display.
// Each call gets its own gradient and clip-path ids, so several marks can share a page.
let seq = 0;

export function logoSvg(className = 'brand-mark'): string {
  const p = `mk${++seq}`;
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true" focusable="false"><defs><linearGradient id="${p}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ffa45c"/></linearGradient><clipPath id="${p}a"><path d="M120 404 V236 A54 54 0 0 1 228 236 V404 Z"/></clipPath><clipPath id="${p}b"><path d="M284 404 V236 A54 54 0 0 1 392 236 V404 Z"/></clipPath></defs><g transform="translate(256 256) scale(1.06) translate(-256 -290)"><path d="M120 404 V236 A54 54 0 0 1 228 236 V404 Z" fill="url(#${p}g)"/><path d="M284 404 V236 A54 54 0 0 1 392 236 V404 Z" fill="#1d2550"/><g clip-path="url(#${p}a)"><circle cx="174" cy="372" r="40" fill="#fff6e6"/></g><g clip-path="url(#${p}b)"><circle cx="338" cy="268" r="26" fill="#fff6e6"/><circle cx="352" cy="256" r="24" fill="#1d2550"/><circle cx="308" cy="330" r="5" fill="#fff6e6"/><circle cx="366" cy="352" r="4" fill="#fff6e6"/></g><path d="M92 236 A82 82 0 0 1 256 236 A82 82 0 0 1 420 236 V432 H92 Z M256 236 V432" fill="none" stroke="#ff5a4e" stroke-width="56" stroke-linejoin="round"/></g></svg>`;
}
