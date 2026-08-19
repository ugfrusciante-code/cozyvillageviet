/**
 * The nature set: trees, stumps, bushes, boulders, ore and mineral props baked
 * out of `assets/nature_set.obj`, plus the eighteen materials that came with
 * them.
 *
 * `nature-data.ts` holds the quantised geometry; this module unpacks it lazily
 * through `baked.ts` and turns the MTL entries into three.js materials. Every
 * prop arrives normalised to unit height and sitting on the origin, so callers
 * scale by the size they want rather than by some magic factor.
 */

import { Color, MeshPhongMaterial } from 'three';

import { bakedColor, bakedGeometry, bakedMaterial } from './baked';
import {
  NATURE_MATERIALS, NATURE_PROPS,
  type NatureMaterialName, type NaturePropName,
} from './nature-data';

export type { NatureMaterialName, NaturePropName };

// ---------------------------------------------------------------- materials

const colors = new Map<string, Color>();

export function natureColor(name: NatureMaterialName): Color {
  let c = colors.get(name);
  if (!c) {
    c = bakedColor(NATURE_MATERIALS[name]);
    colors.set(name, c);
  }
  return c;
}

/** The same colour as an sRGB hex, for the UI and minimap. */
export function natureHex(name: NatureMaterialName): number {
  return natureColor(name).getHex();
}

const materials = new Map<string, MeshPhongMaterial>();

/** The shared material for a name. Do not mutate it — clone first. */
export function natureMaterial(name: NatureMaterialName): MeshPhongMaterial {
  let m = materials.get(name);
  if (!m) { m = bakedMaterial(NATURE_MATERIALS[name]); materials.set(name, m); }
  return m;
}

/** A private copy, for callers that recolour with the season or the weather. */
export function natureMaterialClone(name: NatureMaterialName): MeshPhongMaterial {
  return bakedMaterial(NATURE_MATERIALS[name]);
}

// ----------------------------------------------------------------- geometry

export interface NaturePart {
  material: NatureMaterialName;
  geometry: ReturnType<typeof bakedGeometry>;
}

/** Every material part of a prop, in the order the exporter listed them. */
export function natureProp(name: NaturePropName): NaturePart[] {
  return NATURE_PROPS[name].parts.map((part) => ({
    material: part.m as NatureMaterialName,
    geometry: bakedGeometry(part),
  }));
}

/** Width, height and depth of a prop, with height normalised to ~1. */
export function natureSize(name: NaturePropName): [number, number, number] {
  return NATURE_PROPS[name].size;
}

/** Scale factor that makes a prop `width` wide — for flat props like pads. */
export function scaleToWidth(name: NaturePropName, width: number): number {
  const s = natureSize(name);
  return width / Math.max(0.05, Math.max(s[0], s[2]));
}

export const NATURE_PROP_NAMES = Object.keys(NATURE_PROPS) as NaturePropName[];
