/**
 * Hand-drawn SVG chrome for the UI: window controls, HUD glyphs, mouse hints.
 * Everything inherits `currentColor` so CSS owns the palette. Resource and
 * building icons stay emoji — these are only the engraved UI furniture.
 */

const svg = (body: string, vb = '0 0 24 24'): string =>
  `<svg class="svgi" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" ` +
  `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const I = {
  question: svg('<path d="M9 9.5a3 3 0 1 1 4.6 2.5c-1 .7-1.6 1.3-1.6 2.5"/><circle cx="12" cy="18.2" r="0.6" fill="currentColor" stroke="none"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  pause: svg('<path d="M9 6v12M15 6v12" stroke-width="2.6"/>'),
  focus: svg('<circle cx="12" cy="12" r="5.5"/><path d="M12 3v3.4M12 17.6V21M3 12h3.4M17.6 12H21"/>'),
  plus: svg('<path d="M12 6v12M6 12h12" stroke-width="2.4"/>'),
  minus: svg('<path d="M6 12h12" stroke-width="2.4"/>'),
  caret: svg('<path d="M7 10l5 5 5-5"/>'),
  arrow: svg('<path d="M4 12h14M13 6.5l5.5 5.5L13 17.5"/>'),
  lock: svg('<rect x="6" y="11" width="12" height="8.5" rx="1.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),

  // The traveling merchant's cart, for trade rows.
  cart: svg('<path d="M3 8h11v7H3zM14 10h4l3 3v2h-3"/><circle cx="7" cy="17.6" r="1.9"/><circle cx="16.5" cy="17.6" r="1.9"/><path d="M9 17.6h5.6"/>'),
  person: svg('<circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 20c.7-4 3.2-6 6.5-6s5.8 2 6.5 6"/>'),
  people: svg('<circle cx="8.5" cy="8" r="2.8"/><path d="M3.5 19c.5-3.4 2.4-5.2 5-5.2s4.5 1.8 5 5.2"/><circle cx="16.5" cy="7" r="2.4"/><path d="M15.5 13.6c2.7-.4 4.6 1.6 5 5"/>'),
  coin: svg('<ellipse cx="12" cy="6.5" rx="7" ry="2.6"/><path d="M5 6.5v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 10.5v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14.5v3c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-3"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" stroke-width="1.7"/>'),

  // Bottom round-menu glyphs.
  road: svg('<path d="M4 20c6-2 3-7 8-8s8-4 8-8" stroke-width="2.4"/><path d="M4 20c6-2 3-7 8-8" stroke-dasharray="0.1 4.2" stroke-width="1.4" transform="translate(0,-1.5)"/>'),
  hammer: svg('<path d="M6 4.5h8l3 3v2.5h-6.5" fill="currentColor" stroke="none" opacity="0.25"/><path d="M6.5 4.5h7.2l3.3 3.2V10h-6.7L8 7.7 6.5 9V4.5zM10.8 10.3 5 19.5l2.2 1.4 5.7-9.2"/>'),
  scroll: svg('<path d="M7 4.5h11a2 2 0 0 1 2 2c0 1.1-.9 2-2 2h-2"/><path d="M7 4.5a2 2 0 0 0-2 2V18a2.4 2.4 0 0 0 2.4 2.4H17c1.6 0 2.5-1 2.6-2.4H9.5A2.5 2.5 0 0 1 7 15.5V4.5z"/><path d="M9 8.5V6.4M16 8.5h-5M16 12h-5M13.5 15.5H11"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.9M12 18.3v2.9M2.8 12h2.9M18.3 12h2.9M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2" stroke-width="2.6"/>'),

  // Mouse hint glyphs (left / right button shaded, and a drag arrow).
  mouseL: svg('<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v7M7 10h10"/><path d="M8 4.6a4.6 4.6 0 0 1 4-1.6v7H7V8a5 5 0 0 1 1-3.4z" fill="currentColor" stroke="none" opacity="0.85"/>'),
  mouseR: svg('<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v7M7 10h10"/><path d="M16 4.6a4.6 4.6 0 0 0-4-1.6v7h5V8a5 5 0 0 0-1-3.4z" fill="currentColor" stroke="none" opacity="0.85"/>'),
  mouseDrag: svg('<rect x="8.5" y="5" width="9" height="16" rx="4.5"/><path d="M13 5v6M8.5 11h9"/><path d="M2.5 8.5 5 6l2.5 2.5M5 6v12l-2.5-2.5M5 18l2.5-2.5"/>'),

  // The lord's portrait and household crest, top right.
  portrait: svg(
    '<circle cx="24" cy="24" r="23" fill="#171512" stroke="none"/>' +
    '<path d="M24 9c-6.5 0-10 4.8-10 10.5 0 3.4 1 6 2.4 7.8C13 29.5 10.5 33.5 10 39h28c-.5-5.5-3-9.5-6.4-11.7 1.4-1.8 2.4-4.4 2.4-7.8C34 13.8 30.5 9 24 9z" fill="#4a4032" stroke="none"/>' +
    '<path d="M24 12.5c-4.6 0-7 3.4-7 7.3 0 4.2 2.9 7.7 7 7.7s7-3.5 7-7.7c0-3.9-2.4-7.3-7-7.3z" fill="#8a7358" stroke="none"/>' +
    '<path d="M17.6 17.5c1.8-1.2 4-1.8 6.4-1.8s4.6.6 6.4 1.8" stroke="#3c3327" stroke-width="1.6"/>' +
    '<path d="M14 39c1-4.6 3.4-7.9 6.6-9.6 1 .9 2.1 1.4 3.4 1.4s2.4-.5 3.4-1.4c3.2 1.7 5.6 5 6.6 9.6z" fill="#5c5140" stroke="none"/>',
    '0 0 48 48',
  ),
  crest: svg(
    '<path d="M12 2.5c3 1.6 6 2.2 9 2.2v8.1c0 4.6-3.4 7.6-9 9.7-5.6-2.1-9-5.1-9-9.7V4.7c3 0 6-.6 9-2.2z" fill="#7c2620" stroke="#2a0f0c" stroke-width="1.3"/>' +
    '<path d="M5 12l7-4.5L19 12v3l-7-4.5L5 15z" fill="#d9b45c" stroke="none"/>',
    '0 0 24 24',
  ),
};

export type IconName = keyof typeof I;
