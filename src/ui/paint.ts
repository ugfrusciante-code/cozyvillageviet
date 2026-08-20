/**
 * The painted miniature icon set: every resource, category and HUD symbol as
 * a small flat-shaded SVG in the game's own palette — two tones a shape, a
 * dark outline, no gradients. Replaces emoji everywhere the UI shows a good.
 */

import type { ResId } from '../sim/defs';

const P = (body: string): string =>
  `<svg class="svgi" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ` +
  `stroke="#241a10" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" ` +
  `aria-hidden="true">${body}</svg>`;

// The game palette, quoted for SVG fills.
const WOOD = '#8a6244', WOOD_D = '#6b4a33', STRAW = '#c9a45f', STRAW_L = '#e6c98c';
const STONE = '#b5aa98', STONE_D = '#8d8375', IRON = '#98a0aa', IRON_D = '#6d747d';
const LINEN = '#efe3cf', CREAM = '#f3e7d3', CLAY = '#a8563a', TERRA = '#c06b41';
const HONEY = '#e0a756', MOSS = '#7f9159', MOSS_D = '#5f7442', GOLD = '#d9a75b';

export const PIC: Record<string, string> = {
  // ------------------------------------------------------------- resources
  logs: P(
    `<g transform="rotate(-14 12 12)">` +
    `<rect x="2.6" y="8.8" width="16" height="6.4" rx="3.2" fill="${WOOD}"/>` +
    `<path d="M4 9.6c2.2 1 4.2 1 6.5.4" fill="none" stroke="${WOOD_D}" stroke-width="0.9"/>` +
    `<ellipse cx="19" cy="12" rx="2.7" ry="3.2" fill="${STRAW_L}"/>` +
    `<ellipse cx="19" cy="12" rx="1.3" ry="1.6" fill="${STRAW}"/></g>`,
  ),
  planks: P(
    `<rect x="2.5" y="13.4" width="19" height="3.4" rx="0.8" fill="${WOOD}"/>` +
    `<rect x="4" y="9.8" width="16" height="3.4" rx="0.8" fill="#c8a978"/>` +
    `<rect x="5.5" y="6.2" width="13" height="3.4" rx="0.8" fill="${STRAW_L}"/>`,
  ),
  stone: P(
    `<path d="M3 16.5 6.5 10l5 1 2 5.5-3.5 2.5H5z" fill="${STONE}"/>` +
    `<path d="M12.5 16.5l1.5-5 4.5-1.5 3 4-2 4h-5z" fill="${STONE_D}"/>` +
    `<path d="M6.5 10l5 1 2 5.5" fill="none" stroke="${STONE_D}" stroke-width="0.8"/>`,
  ),
  clay: P(
    `<path d="M3 17c0-3.6 3.6-6.4 9-6.4s9 2.8 9 6.4z" fill="#9c7350"/>` +
    `<path d="M6 13.5c1.6-1.5 4-2.3 6-2.2" fill="none" stroke="#7d5a3e" stroke-width="1"/>` +
    `<ellipse cx="15.6" cy="14.6" rx="2.4" ry="1.4" fill="#b08560"/>`,
  ),
  bricks: P(
    `<rect x="3" y="7.4" width="8.6" height="4.2" rx="0.6" fill="${CLAY}"/>` +
    `<rect x="12.6" y="7.4" width="8.4" height="4.2" rx="0.6" fill="#b96a48"/>` +
    `<rect x="7.6" y="12.4" width="8.8" height="4.2" rx="0.6" fill="${CLAY}"/>`,
  ),
  iron_ore: P(
    `<path d="M4 16.8 7.5 9.4l6.5-1.2 5.5 4.4-2.2 5.6H7z" fill="#5c554e"/>` +
    `<circle cx="10" cy="12.6" r="1.3" fill="#a56a4a"/>` +
    `<circle cx="14.6" cy="14.6" r="1" fill="#8d949e"/>` +
    `<circle cx="13.4" cy="10.4" r="0.9" fill="#a56a4a"/>`,
  ),
  iron: P(
    `<path d="M3 15.6l2.2-4h7l-1.6 4z" fill="${IRON}"/>` +
    `<path d="M11.6 15.6l2.2-4h7l-1.6 4z" fill="${IRON_D}"/>` +
    `<path d="M7 10l2-3.4h6.6L14 10z" fill="#b7bec7"/>`,
  ),
  tools: P(
    `<rect x="10.6" y="6.6" width="3" height="12.6" rx="1.2" fill="${WOOD}" transform="rotate(38 12 13)"/>` +
    `<path d="M6 5.4h9.4a2.6 2.6 0 0 1 2.6 2.6v1.6H8.6C7 9.6 6 8.4 6 7z" fill="${IRON}"/>` +
    `<path d="M6 5.4h4v4.2H8.6C7 9.6 6 8.4 6 7z" fill="${IRON_D}"/>`,
  ),
  firewood: P(
    `<g transform="rotate(8 12 13)">` +
    `<path d="M5 16.8l3.4-9 3 9z" fill="${WOOD_D}"/>` +
    `<path d="M9.6 16.8l3.2-10 3.2 10z" fill="${WOOD}"/>` +
    `<path d="M14.6 16.8l2.8-8 2.8 8z" fill="#a4805c"/>` +
    `<rect x="4" y="14.4" width="16.4" height="2" rx="1" fill="${STRAW}"/></g>`,
  ),
  charcoal: P(
    `<path d="M4 16.5 7 11l4.6.8 1.6 4.9-2.8 2.3H5.6z" fill="#3a332c"/>` +
    `<path d="M12.6 16.8l1.2-4.4 4-1.2 2.6 3.4-1.8 3.6h-4.4z" fill="#2c2620"/>` +
    `<path d="M7 11l4.6.8 1.6 4.9" fill="none" stroke="#575046" stroke-width="0.9"/>` +
    `<path d="M13.8 12.4l4-1.2" fill="none" stroke="#575046" stroke-width="0.9"/>` +
    `<circle cx="9.2" cy="14.4" r="0.7" fill="#8d5638" stroke="none"/>`,
  ),
  grain: P(
    `<path d="M8 20c1-4.5 1-9 .6-13M12 20c.4-5 .4-10 0-14M16 20c-1-4.5-1-9-.6-13" fill="none" stroke="${STRAW}" stroke-width="1.5"/>` +
    `<g fill="${STRAW_L}"><ellipse cx="8.4" cy="6" rx="1.7" ry="3" transform="rotate(-8 8.4 6)"/>` +
    `<ellipse cx="12" cy="4.6" rx="1.7" ry="3"/>` +
    `<ellipse cx="15.6" cy="6" rx="1.7" ry="3" transform="rotate(8 15.6 6)"/></g>`,
  ),
  flour: P(
    `<path d="M6 9.5C5 15 5 17.5 6.8 19h10.4C19 17.5 19 15 18 9.5l-2-1.5H8z" fill="${LINEN}"/>` +
    `<path d="M8 8l-1 -2.6h10L16 8z" fill="#d8c8ac"/>` +
    `<path d="M7.5 5.4h9" stroke="${WOOD_D}" stroke-width="1.4"/>` +
    `<path d="M9 12.5c2 1 4 1 6 0" fill="none" stroke="#d8c8ac" stroke-width="1"/>`,
  ),
  bread: P(
    `<path d="M3.5 13.8c0-3.4 3.8-5.8 8.5-5.8s8.5 2.4 8.5 5.8c0 2.4-1.6 3.8-3.4 3.8H6.9c-1.8 0-3.4-1.4-3.4-3.8z" fill="#d8a15c"/>` +
    `<path d="M8 10.5l1.6 2.6M12 9.8l1.4 2.8M15.8 10.6l1.2 2.4" stroke="${STRAW_L}" stroke-width="1.3"/>`,
  ),
  berries: P(
    `<circle cx="9" cy="14.6" r="3.4" fill="#7a4a86"/>` +
    `<circle cx="15.2" cy="14" r="3" fill="#5d3a6b"/>` +
    `<circle cx="12" cy="10" r="2.8" fill="#8a5a99"/>` +
    `<path d="M12 7.4c.4-1.8 1.6-2.8 3.4-3" fill="none" stroke="${MOSS_D}" stroke-width="1.4"/>` +
    `<path d="M12.8 5.6c1.8-.4 2.8.2 3.4 1.4-1.4.8-2.8.6-3.8-.4z" fill="${MOSS}"/>`,
  ),
  fish: P(
    `<path d="M3.5 12c2.4-3.4 5.8-5 9.4-4.4 2.8.4 5 1.9 6.6 4.4-1.6 2.5-3.8 4-6.6 4.4-3.6.6-7-1-9.4-4.4z" fill="#8fb6c4"/>` +
    `<path d="M19.5 12l3-3.2v6.4z" fill="#6d95a4"/>` +
    `<path d="M12 8c1 2.6 1 5.4 0 8" fill="none" stroke="#6d95a4" stroke-width="1"/>` +
    `<circle cx="7.4" cy="11" r="0.8" fill="#241a10" stroke="none"/>`,
  ),
  meat: P(
    `<path d="M5 15.5C5 10.5 8.6 7 13 7c3.6 0 6 2.2 6 5 0 3.6-3.2 6.5-8 6.5-2.4 0-6 -.6-6-3z" fill="#b4614f"/>` +
    `<path d="M9 13.4c.4-2.6 2-4.2 4.6-4.6" fill="none" stroke="#d8907c" stroke-width="1.5"/>` +
    `<circle cx="4.9" cy="16" r="1.9" fill="${LINEN}"/>`,
  ),
  honey: P(
    `<path d="M6 10.5c-1-3 1-5.5 6-5.5s7 2.5 6 5.5c1.4 4.6-.4 8.5-6 8.5s-7.4-3.9-6-8.5z" fill="${HONEY}"/>` +
    `<path d="M5.6 9.2h12.8" stroke="#b9843e" stroke-width="1.2"/>` +
    `<path d="M6.6 5.8h10.8v-2H6.6z" fill="${WOOD}"/>` +
    `<path d="M9.4 13c1.7 1.2 3.5 1.2 5.2 0" fill="none" stroke="#f0c988" stroke-width="1.3"/>`,
  ),
  herbs: P(
    `<path d="M12 20c-.4-5 .2-9.4 2.4-13.6" fill="none" stroke="${MOSS_D}" stroke-width="1.4"/>` +
    `<g fill="${MOSS}"><path d="M13.6 8.2c-2.6.4-4.2-.6-5-2.8 2.6-.6 4.4.2 5 2.8z"/>` +
    `<path d="M13 12.4c-2.8.6-4.6-.4-5.6-2.6 2.8-.8 4.8 0 5.6 2.6z"/>` +
    `<path d="M14.4 7.6c.4-2.4 1.8-3.6 4.2-3.8-.2 2.6-1.6 3.8-4.2 3.8z"/>` +
    `<path d="M13.4 12c.6-2.6 2.2-3.8 4.8-3.8-.4 2.8-2 4-4.8 3.8z"/></g>`,
  ),
  eggs: P(
    `<path d="M9 19c-2.6 0-4.4-1.8-4.4-4.4C4.6 11 6.6 7 9 7s4.4 4 4.4 7.6c0 2.6-1.8 4.4-4.4 4.4z" fill="${CREAM}"/>` +
    `<path d="M16.4 17.6c-2.2 0-3.7-1.5-3.7-3.7 0-3 1.7-6.3 3.7-6.3s3.7 3.3 3.7 6.3c0 2.2-1.5 3.7-3.7 3.7z" fill="#e6d2ae"/>`,
  ),
  beans: P(
    `<path d="M5 13.4C5 9.6 8 7 11.6 7c2 0 3 .8 3 2.2 0 3.8-3 6.4-6.6 6.4-2 0-3-.8-3-2.2z" fill="${MOSS}" transform="rotate(-14 10 11)"/>` +
    `<path d="M9.6 17.6c0-3 2.4-5.2 5.4-5.2 1.6 0 2.4.6 2.4 1.8 0 3-2.4 5.2-5.4 5.2-1.6 0-2.4-.6-2.4-1.8z" fill="#8a7a4a"/>`,
  ),
  turnips: P(
    `<path d="M12 8.6c3.6 0 6 2 6 4.8 0 3.2-2.6 6.1-6 6.1s-6-2.9-6-6.1c0-2.8 2.4-4.8 6-4.8z" fill="#c98f5a"/>` +
    `<path d="M12 19.5v2" stroke="#a4713f" stroke-width="1.4"/>` +
    `<path d="M10.4 8.4C9 6.6 8.8 4.8 9.8 3c1.6 1 2.3 2.6 2.2 5z" fill="${MOSS}"/>` +
    `<path d="M13.6 8.4c1.4-1.8 1.6-3.6.6-5.4-1.6 1-2.3 2.6-2.2 5z" fill="${MOSS_D}"/>`,
  ),
  hide: P(
    `<path d="M6 5.5c1.6 1.2 3 1.2 4.4 0h3.2c1.4 1.2 2.8 1.2 4.4 0l1.4 3.4c-1.2 1.4-1.2 2.8 0 4.2l-1.4 5.4c-1.6-1.2-3-1.2-4.4 0h-3.2c-1.4-1.2-2.8-1.2-4.4 0l-1.4-5.4c1.2-1.4 1.2-2.8 0-4.2z" fill="#9c7350"/>` +
    `<path d="M9 9c1.8 1.6 4.2 1.6 6 0" fill="none" stroke="#7d5a3e" stroke-width="1"/>`,
  ),
  leather: P(
    `<rect x="4" y="9" width="13" height="8" rx="2.4" fill="${WOOD}"/>` +
    `<circle cx="17" cy="13" r="4" fill="#a4805c"/>` +
    `<circle cx="17" cy="13" r="1.6" fill="${WOOD_D}"/>`,
  ),
  shoes: P(
    `<path d="M6 5.5h5v7c3.6 0 6.4 1.6 7.5 4v2H6z" fill="${WOOD_D}"/>` +
    `<path d="M6 16h12.5v2.5H6z" fill="#4e3625"/>` +
    `<path d="M11 9H8.6M11 11.4H8.6" stroke="#a4805c" stroke-width="1"/>`,
  ),
  wool: P(
    `<path d="M6.4 16.8a3.4 3.4 0 0 1-1-6.6 4.4 4.4 0 0 1 8-2.4 3.8 3.8 0 0 1 5.4 1.4 3.3 3.3 0 0 1 .4 7.4z" fill="${CREAM}"/>` +
    `<path d="M6.4 16.8h12.8" stroke="#c9bda4" stroke-width="1"/>` +
    `<path d="M8.4 12.6c1.2 1 2.6 1 3.8 0M12.8 13.6c1 .8 2.2.8 3.2 0" fill="none" stroke="#c9bda4" stroke-width="1"/>`,
  ),
  cloth: P(
    `<path d="M4 8h13l3 3-3 3H4z" fill="#b7a3c4"/>` +
    `<path d="M4 11h13l3 3-3 3H4z" fill="#9d86ad"/>` +
    `<circle cx="5.8" cy="12.8" r="2.2" fill="#cbbad6"/>`,
  ),
  clothes: P(
    `<path d="M9 5.5 12 7l3-1.5 4 3-2 2.6-1.4-1V19H8.4v-8.9l-1.4 1-2-2.6z" fill="#9d6b8a"/>` +
    `<path d="M8.4 14.6h7.2" stroke="#7c5270" stroke-width="1.2"/>` +
    `<path d="M10.4 6.2c1 .9 2.2.9 3.2 0" fill="none" stroke="#7c5270" stroke-width="1"/>`,
  ),
  ale: P(
    `<path d="M6.5 9h9v10.5h-9z" fill="${WOOD}"/>` +
    `<path d="M8.2 9v10.5M11 9v10.5M13.8 9v10.5" stroke="${WOOD_D}" stroke-width="0.9"/>` +
    `<path d="M15.5 11h2.6a1.9 1.9 0 0 1 0 3.8h-2.6z" fill="none" stroke="#241a10" stroke-width="1.6"/>` +
    `<path d="M6 9c0-1.6 1.4-2.6 3-2 .4-1.4 2-2 3.4-1.4.4-1 1.8-1.2 2.8-.4 1.2-.4 2.4.4 2.4 1.8 0 1.2-.8 2-2.1 2z" fill="${CREAM}"/>`,
  ),
  pottery: P(
    `<path d="M9.4 5.5h5.2c-.3 1.4-.2 2.4.8 3.4 1.6 1.6 2.3 3 2.3 4.8 0 3.3-2.4 5.8-5.7 5.8s-5.7-2.5-5.7-5.8c0-1.8.7-3.2 2.3-4.8 1-1 1.1-2 .8-3.4z" fill="${TERRA}"/>` +
    `<path d="M8.6 12.2c2.2 1.2 4.6 1.2 6.8 0" fill="none" stroke="#96522f" stroke-width="1.2"/>` +
    `<path d="M9 5.5h6" stroke="#241a10" stroke-width="1.6"/>`,
  ),
  candles: P(
    `<rect x="6" y="9.5" width="3.6" height="10" rx="0.8" fill="${CREAM}"/>` +
    `<rect x="13.4" y="11.5" width="3.6" height="8" rx="0.8" fill="#e6d2ae"/>` +
    `<path d="M7.8 8.6C6.9 7.3 7 6.2 7.8 5c.8 1.2.9 2.3 0 3.6z" fill="${HONEY}"/>` +
    `<path d="M15.2 10.6c-.9-1.3-.8-2.4 0-3.6.8 1.2.9 2.3 0 3.6z" fill="${TERRA}"/>`,
  ),
  medicine: P(
    `<path d="M9.4 8.5V5.9h5.2v2.6l1.9 2.3v7.2a1.8 1.8 0 0 1-1.8 1.8h-5.4a1.8 1.8 0 0 1-1.8-1.8v-7.2z" fill="#a8c4b0"/>` +
    `<path d="M9 5.8h6" stroke="${WOOD_D}" stroke-width="2.2"/>` +
    `<path d="M12 11.4v5M9.5 13.9h5" stroke="#5f7a68" stroke-width="1.6"/>`,
  ),

  // ------------------------------------------------------------ categories
  housing: P(
    `<path d="M4 11.5 12 4.5l8 7v8h-16z" fill="${LINEN}"/>` +
    `<path d="M3 11.8 12 4l9 7.8-1.4 1.4L12 6.8l-7.6 6.4z" fill="${TERRA}"/>` +
    `<rect x="10" y="13.5" width="4" height="6" fill="${WOOD_D}"/>`,
  ),
  gathering: P(
    `<rect x="11" y="5" width="2.6" height="15" rx="1.1" fill="${WOOD}" transform="rotate(30 12 12.5)"/>` +
    `<path d="M6.5 4.5c3.4-.4 5.8.6 7.6 3l-2.4 4c-3-.6-4.8-2.4-5.6-5z" fill="${IRON}"/>` +
    `<path d="M6.5 4.5c1 1.8 2 2.9 3.6 3.7l-1.8 2.9c-1.4-1-2.1-2.6-2.2-4.6z" fill="${IRON_D}"/>`,
  ),
  farming: P(
    `<path d="M7 20.5c2.4-5.4 5.8-9.4 11-12.6" fill="none" stroke="${WOOD}" stroke-width="2"/>` +
    `<path d="M18.6 8.6C13.8 7.4 9.9 5.6 7 2.6c5.6-1 10 .6 12.6 4z" fill="${IRON}"/>`,
  ),
  crafting: P(
    `<path d="M4 8.5h11.4c1.7 0 3.1-.7 4.6-2v3.4c-1.1 1.4-2.6 2.2-4.4 2.4l-1.2 3.2 2.4 2v2H7.6v-2l2.4-2-1.4-3.4H6.4C4.9 12.1 4 10.7 4 8.5z" fill="${IRON_D}"/>` +
    `<path d="M4 8.5h11.4c1.7 0 3.1-.7 4.6-2l-.1 1.4c-1.4 1.4-3 2-5 2H4.6z" fill="${IRON}"/>`,
  ),
  civic: P(
    `<path d="M7 20v-8l5-4.5 5 4.5v8z" fill="${LINEN}"/>` +
    `<path d="M12 2.6v4.9M10.3 4.5h3.4" stroke="${HONEY}" stroke-width="1.5"/>` +
    `<path d="M6 12.4 12 7l6 5.4-1.2 1.2L12 9.4l-4.8 4.2z" fill="#76706a"/>` +
    `<rect x="10.6" y="14.6" width="2.8" height="5.4" fill="${WOOD_D}"/>`,
  ),
  logistics: P(
    `<rect x="4" y="7" width="16" height="12" rx="1" fill="${WOOD}"/>` +
    `<path d="M4 11h16M10 7v12M14 7v12" stroke="${WOOD_D}" stroke-width="1.1"/>` +
    `<rect x="4" y="7" width="16" height="2.6" fill="#a4805c" stroke="none"/>`,
  ),
  decor: P(
    `<path d="M8.4 5.5c1.2 1.4 2.4 1.4 3.6 0 1.2 1.4 2.4 1.4 3.6 0l.6 5c0 2.6-1.8 4.4-4.2 4.4S7.8 13.1 7.8 10.5z" fill="#d96a7a"/>` +
    `<path d="M12 15v6" stroke="${MOSS_D}" stroke-width="1.5"/>` +
    `<path d="M12 18.4c-2.2.2-3.6-.6-4.4-2.6 2.2-.2 3.7.6 4.4 2.6z" fill="${MOSS}"/>`,
  ),

  // ------------------------------------------------------------- HUD + misc
  family: P(
    `<circle cx="8.6" cy="7.6" r="2.6" fill="#d9a97c"/>` +
    `<path d="M4.5 19c.5-4.4 2-6.6 4.1-6.6s3.6 2.2 4.1 6.6z" fill="#8a5a3c"/>` +
    `<circle cx="15.8" cy="9" r="2.2" fill="#e8c49a"/>` +
    `<path d="M12.6 19c.4-3.6 1.6-5.4 3.2-5.4 1.7 0 2.9 1.8 3.3 5.4z" fill="#9d6b8a"/>`,
  ),
  approval: P(
    `<path d="M8 11.2 12.6 4c1.4.4 2 1.4 1.8 3l-.6 3h4.6c1.4 0 2.2 1 1.9 2.4l-1.3 5.4c-.3 1.3-1.1 2-2.4 2H8z" fill="#d9a97c"/>` +
    `<rect x="3.5" y="10.8" width="4.5" height="9" rx="1" fill="${LINEN}"/>`,
  ),
  scales: P(
    `<path d="M12 4.5v13M6.2 6.8h11.6" stroke="${HONEY}" stroke-width="1.5"/>` +
    `<path d="M9 19.5c.6-1.4 1.6-2 3-2s2.4.6 3 2z" fill="${WOOD}"/>` +
    `<path d="M3.4 12.4c.4 1.7 1.4 2.6 2.8 2.6s2.4-.9 2.8-2.6l-2.8-5z" fill="${HONEY}"/>` +
    `<path d="M15 12.4c.4 1.7 1.4 2.6 2.8 2.6s2.4-.9 2.8-2.6l-2.8-5z" fill="#c78d3e"/>`,
  ),
  idle: P(
    `<path d="M7 4.5h10v2.4c0 2.4-1.6 3.8-3.4 5.1 1.8 1.3 3.4 2.7 3.4 5.1v2.4H7v-2.4c0-2.4 1.6-3.8 3.4-5.1C8.6 10.7 7 9.3 7 6.9z" fill="${LINEN}"/>` +
    `<path d="M9 17.6c.8-1.6 1.8-2.4 3-2.4s2.2.8 3 2.4z" fill="${STRAW}"/>` +
    `<path d="M9.4 7.4h5.2L12 10z" fill="${STRAW}"/>`,
  ),
  ox: P(
    `<path d="M7.5 9.5c1-1.6 2.6-2.4 4.5-2.4s3.5.8 4.5 2.4l-.8 6.1c-.6 2.4-1.9 3.6-3.7 3.6s-3.1-1.2-3.7-3.6z" fill="#8a6f56"/>` +
    `<path d="M9.6 16.4c.6 1 1.4 1.5 2.4 1.5s1.8-.5 2.4-1.5z" fill="#b59a80"/>` +
    `<path d="M7.8 9C5.6 8.6 4.4 7.2 4.2 5c2.4.2 3.9 1.2 4.6 3.2z" fill="${LINEN}"/>` +
    `<path d="M16.2 9c2.2-.4 3.4-1.8 3.6-4-2.4.2-3.9 1.2-4.6 3.2z" fill="${LINEN}"/>` +
    `<circle cx="10" cy="11.4" r="0.7" fill="#241a10" stroke="none"/>` +
    `<circle cx="14" cy="11.4" r="0.7" fill="#241a10" stroke="none"/>`,
  ),
  water: P(
    `<path d="M6.5 9.5h11L16 19.5H8z" fill="${WOOD}"/>` +
    `<path d="M8.1 9.5 8 19.5M11.9 9.5v10M15.8 9.5l.1 10" stroke="${WOOD_D}" stroke-width="0.9"/>` +
    `<ellipse cx="12" cy="9.5" rx="5.5" ry="1.7" fill="#6ea3ae"/>` +
    `<path d="M6.6 8.7C7.6 5.9 9.6 4.5 12 4.5" fill="none" stroke="${WOOD_D}" stroke-width="1.3"/>`,
  ),
  healer: P(
    `<path d="M5.5 11h13c0 4.4-2.4 7.5-6.5 7.5S5.5 15.4 5.5 11z" fill="${STONE}"/>` +
    `<path d="M5 11h14" stroke="${STONE_D}" stroke-width="1.3"/>` +
    `<rect x="12.4" y="3.4" width="2.6" height="8" rx="1.2" fill="${WOOD}" transform="rotate(32 13.6 7.4)"/>`,
  ),
  book: P(
    `<path d="M12 6.5C10 5 7.6 4.6 4.5 5v12.5c3.1-.4 5.5 0 7.5 1.5z" fill="${LINEN}"/>` +
    `<path d="M12 6.5c2-1.5 4.4-1.9 7.5-1.5v12.5c-3.1-.4-5.5 0-7.5 1.5z" fill="#e0d2b4"/>` +
    `<path d="M12 6.5v12.5" stroke="${WOOD_D}" stroke-width="1"/>` +
    `<path d="M6.5 8.2c1.6-.2 3 .1 4 .8M13.5 9c1-.7 2.4-1 4-.8" fill="none" stroke="#b7a888" stroke-width="1"/>`,
  ),
  market: P(
    `<path d="M4 10.5v8.5h16v-8.5" fill="${LINEN}" stroke-width="1.1"/>` +
    `<path d="M3 10.5 5 5h14l2 5.5c-1.6 1.6-3.2 1.6-4.6 0-1.4 1.6-3.2 1.6-4.4 0-1.2 1.6-3 1.6-4.4 0-1.4 1.6-3 1.6-4.6 0z" fill="${TERRA}"/>` +
    `<path d="M7.6 5.2 6.7 10M12 5v5M16.4 5.2l.9 4.8" stroke="#96522f" stroke-width="1"/>` +
    `<rect x="10.4" y="14" width="3.2" height="5" fill="${WOOD_D}"/>`,
  ),
  fire: P(
    `<path d="M12 3.5c3.6 3 5.9 6 5.9 9.4 0 3.8-2.4 6.6-5.9 6.6s-5.9-2.8-5.9-6.6c0-3.4 2.3-6.4 5.9-9.4z" fill="${TERRA}"/>` +
    `<path d="M12 9c1.9 1.8 3 3.4 3 5.2 0 2.2-1.2 3.6-3 3.6s-3-1.4-3-3.6c0-1.8 1.1-3.4 3-5.2z" fill="${HONEY}"/>`,
  ),
  skull: P(
    `<path d="M12 4.5c4 0 6.8 2.6 6.8 6.2 0 2-.8 3.4-2.2 4.4v3.4h-9.2v-3.4c-1.4-1-2.2-2.4-2.2-4.4 0-3.6 2.8-6.2 6.8-6.2z" fill="${LINEN}"/>` +
    `<circle cx="9.4" cy="10.6" r="1.7" fill="#241a10" stroke="none"/>` +
    `<circle cx="14.6" cy="10.6" r="1.7" fill="#241a10" stroke="none"/>` +
    `<path d="M10.4 18.5v-2M13.6 18.5v-2" stroke="#8d8375" stroke-width="1.3"/>`,
  ),
  homeless: P(
    `<path d="M4 11.5 12 4.5l8 7v8h-16z" fill="#b7a888"/>` +
    `<path d="M3 11.8 12 4l9 7.8-1.4 1.4L12 6.8l-7.6 6.4z" fill="#8d6a52"/>` +
    `<path d="M10.5 13.5 12 16l-1.5 3.5" fill="none" stroke="#241a10" stroke-width="1.4"/>`,
  ),
  barrier: P(
    `<rect x="3.5" y="8" width="17" height="4.6" rx="1" fill="${STRAW}"/>` +
    `<path d="M6 12.6 9.6 8M11 12.6 14.6 8M16 12.6 19.6 8" stroke="#241a10" stroke-width="1.7"/>` +
    `<path d="M6 12.6V20M18 12.6V20" stroke="${WOOD_D}" stroke-width="1.8"/>`,
  ),
  sword: P(
    `<path d="M13.6 13.2 18.5 3.9c.9 0 1.5.6 1.6 1.6l-9.3 4.9z" fill="${IRON}"/>` +
    `<path d="M13.6 13.2 20.1 5.5c.1.9-.1 1.7-.9 2.8l-5.6 4.9z" fill="#b7bec7"/>` +
    `<path d="M8.6 15.4c1.8.4 3 1.6 3.4 3.4" fill="none" stroke="${HONEY}" stroke-width="2"/>` +
    `<path d="M10.8 10.6l2.6 2.6-4.2 4.2c-1 .2-1.8-.2-2.4-1z" fill="${WOOD_D}"/>`,
  ),
  coins: P(
    `<ellipse cx="10" cy="16.6" rx="6.4" ry="2.6" fill="${GOLD}"/>` +
    `<ellipse cx="10" cy="14" rx="6.4" ry="2.6" fill="#e8bc6f"/>` +
    `<ellipse cx="10" cy="11.4" rx="6.4" ry="2.6" fill="${GOLD}"/>` +
    `<ellipse cx="16.6" cy="8.4" rx="3.9" ry="3.4" fill="#e8bc6f"/>` +
    `<ellipse cx="16.6" cy="8.4" rx="2" ry="1.7" fill="${GOLD}"/>`,
  ),
  person: P(
    `<circle cx="12" cy="7.4" r="3.4" fill="#d9a97c"/>` +
    `<path d="M9.2 6.2c1.8-.9 3.8-.9 5.6 0" fill="none" stroke="#6b4a33" stroke-width="1.6"/>` +
    `<path d="M5.5 19.5c.7-4.8 3-7.2 6.5-7.2s5.8 2.4 6.5 7.2z" fill="#968878"/>` +
    `<path d="M10.5 13.2 12 15l1.5-1.8" fill="none" stroke="#6f6250" stroke-width="1.1"/>`,
  ),
  charm: P(
    `<path d="M12 20.5c-4.6-3-7.5-6-7.5-9.3C4.5 8.5 6.4 6.5 9 6.5c1.2 0 2.2.5 3 1.4.8-.9 1.8-1.4 3-1.4 2.6 0 4.5 2 4.5 4.7 0 3.3-2.9 6.3-7.5 9.3z" fill="#d96a7a"/>` +
    `<path d="M8 10.4c.4-1.2 1.2-1.9 2.4-2.1" fill="none" stroke="#efb2ba" stroke-width="1.2"/>`,
  ),
};

/** Wrap an icon at a pixel size; falls back to a blank spacer if unknown. */
export function pic(name: string, size = 15): string {
  const svg = PIC[name];
  if (!svg) return `<span class="pi" style="width:${size}px;height:${size}px"></span>`;
  return `<span class="pi" style="width:${size}px;height:${size}px">${svg}</span>`;
}

/** Resource icon lookup — every ResId has a painted entry. */
export function resPic(id: ResId, size = 15): string {
  return pic(id, size);
}
