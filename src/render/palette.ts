/**
 * The whole look of the game lives here: warm neutrals, terracotta, honey and
 * moss, with a soft seasonal shift and a warm-to-cool day/night curve.
 */

import { Color } from 'three';
import type { Season } from '../sim/defs';

export const C = {
  cream: 0xf3e7d3,
  sand: 0xe3cba6,
  wheat: 0xd9bb84,
  terracotta: 0xc06b41,
  clayRed: 0xa8563a,
  honey: 0xe0a756,
  moss: 0x7f9159,
  grass: 0x8aa05c,
  grassDeep: 0x62784a,
  pine: 0x3f5b41,
  timber: 0x8a6244,
  timberDark: 0x6b4a33,
  thatch: 0xc9a45f,
  stone: 0xb5aa98,
  stoneDark: 0x8d8375,
  slate: 0x76706a,
  water: 0x6ea3ae,
  waterDeep: 0x4c7d8c,
  snow: 0xeef1f3,
  soil: 0x8a6c4c,
  linen: 0xefe3cf,
} as const;

export interface SeasonLook {
  grass: Color;
  grassDeep: Color;
  foliage: Color;
  foliageAlt: Color;
  soil: Color;
  /** Blended over everything to sell the season. */
  ambient: Color;
  snow: number;
}

const c = (hex: number) => new Color(hex);

export const SEASON_LOOK: Record<Season, SeasonLook> = {
  spring: {
    grass: c(0xa8bf6e), grassDeep: c(0x7d9a56), foliage: c(0x7fa653), foliageAlt: c(0xa8c46a),
    soil: c(0x8a6c4c), ambient: c(0xfff3dd), snow: 0,
  },
  summer: {
    grass: c(0x9fb663), grassDeep: c(0x74904f), foliage: c(0x5f7f45), foliageAlt: c(0x7d9b4e),
    soil: c(0x94764f), ambient: c(0xfff0cf), snow: 0,
  },
  autumn: {
    grass: c(0xc0ad66), grassDeep: c(0x94834f), foliage: c(0xc07b3a), foliageAlt: c(0xd9a04b),
    soil: c(0x7d6244), ambient: c(0xffe6c4), snow: 0,
  },
  winter: {
    grass: c(0xdcdcd6), grassDeep: c(0xb0b6b0), foliage: c(0x46604a), foliageAlt: c(0xdfe6e8),
    soil: c(0x8d8781), ambient: c(0xdfe9f5), snow: 1,
  },
};

/** Sky, fog and sun colour across a day. `t` is 0..1 through the 24h clock. */
export function skyOfDay(t: number): {
  top: Color; bottom: Color; fog: Color; sun: Color; sunIntensity: number;
  ambient: Color; ambientIntensity: number; ground: Color;
} {
  // Key times: 0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk.
  // Night stays moonlit and readable rather than truly dark — this is a cozy
  // game, not a horror one, and the player still needs to see their village.
  const stops = [
    { t: 0.00, top: 0x2b3a5c, bottom: 0x4a5a7d, fog: 0x50618a, sun: 0x8fa4d8, si: 0.55, amb: 0x8296c4, ai: 1.10, gnd: 0x4a5068 },
    { t: 0.22, top: 0x54608a, bottom: 0xb08c86, fog: 0xb59398, sun: 0xe8a06c, si: 0.85, amb: 0x9c96a8, ai: 1.15, gnd: 0x6d5f50 },
    { t: 0.30, top: 0x86a8cf, bottom: 0xf0c69a, fog: 0xe6c6a4, sun: 0xffc489, si: 1.35, amb: 0xb6c6d8, ai: 1.15, gnd: 0x8a7a5e },
    { t: 0.50, top: 0x77aede, bottom: 0xd8e8f2, fog: 0xd7e2e6, sun: 0xfff2d8, si: 1.70, amb: 0xc9dcec, ai: 1.20, gnd: 0x99906f },
    { t: 0.70, top: 0x7ba6d0, bottom: 0xf3cfa0, fog: 0xe8c9a2, sun: 0xffd39a, si: 1.45, amb: 0xbdcedd, ai: 1.15, gnd: 0x95805c },
    { t: 0.80, top: 0x5b6690, bottom: 0xd79a72, fog: 0xc79a80, sun: 0xf5a468, si: 0.95, amb: 0x9a95ab, ai: 1.10, gnd: 0x6e5c48 },
    { t: 0.88, top: 0x33436b, bottom: 0x5c5c80, fog: 0x5a6288, sun: 0x8496c8, si: 0.6, amb: 0x8590b4, ai: 1.10, gnd: 0x4e5470 },
    { t: 1.00, top: 0x2b3a5c, bottom: 0x4a5a7d, fog: 0x50618a, sun: 0x8fa4d8, si: 0.55, amb: 0x8296c4, ai: 1.10, gnd: 0x4a5068 },
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = Math.max(1e-5, b.t - a.t);
  const k = Math.max(0, Math.min(1, (t - a.t) / span));
  const mix = (x: number, y: number) => new Color(x).lerp(new Color(y), k);
  return {
    top: mix(a.top, b.top),
    bottom: mix(a.bottom, b.bottom),
    fog: mix(a.fog, b.fog),
    sun: mix(a.sun, b.sun),
    sunIntensity: a.si + (b.si - a.si) * k,
    ambient: mix(a.amb, b.amb),
    ambientIntensity: a.ai + (b.ai - a.ai) * k,
    ground: mix(a.gnd, b.gnd),
  };
}
