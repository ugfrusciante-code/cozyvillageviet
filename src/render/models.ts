/**
 * The building set: authored set pieces — cottage, longhouse, granary, forge,
 * woodcutter's camp, windmill — baked out of the OBJs in `assets/` by
 * `npm run bake:models`.
 *
 * `models-data.ts` holds the quantised geometry; this module unpacks it lazily
 * through `baked.ts`, exactly as `nature.ts` does for the nature set. Every
 * prop arrives normalised to unit height and sitting on the origin, except the
 * windmill's sails, which pivot about their hub so the renderer can spin them.
 */

import { MeshPhongMaterial } from 'three';

import { bakedGeometry, bakedMaterial } from './baked';
import {
  MODEL_MATERIALS, MODEL_PROPS,
  type ModelMaterialName, type ModelPropName,
} from './models-data';

export type { ModelMaterialName, ModelPropName };
export { MILL_HUB, MILL_SAILS_SCALE } from './models-data';

const materials = new Map<string, MeshPhongMaterial>();

/** The shared material for a name. Do not mutate it — clone first. */
export function modelMaterial(name: ModelMaterialName): MeshPhongMaterial {
  let m = materials.get(name);
  if (!m) { m = bakedMaterial(MODEL_MATERIALS[name]); materials.set(name, m); }
  return m;
}

export interface ModelPart {
  material: ModelMaterialName;
  geometry: ReturnType<typeof bakedGeometry>;
}

/** Every material part of a prop, in the order the exporter listed them. */
export function modelProp(name: ModelPropName): ModelPart[] {
  return MODEL_PROPS[name].parts.map((part) => ({
    material: part.m as ModelMaterialName,
    geometry: bakedGeometry(part),
  }));
}

/** Width, height and depth of a prop, with height normalised to ~1. */
export function modelSize(name: ModelPropName): [number, number, number] {
  return MODEL_PROPS[name].size;
}
