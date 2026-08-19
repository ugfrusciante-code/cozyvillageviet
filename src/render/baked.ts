/**
 * Decoding shared by every baked prop set (the nature set, the building
 * models). The bake tools write quantised base64 geometry and raw MTL
 * materials; this module turns those into BufferGeometry and MeshPhongMaterial
 * on demand. `nature.ts` and `models.ts` wrap it with their own typed tables.
 */

import {
  BufferAttribute, BufferGeometry, Color, LinearSRGBColorSpace, MeshPhongMaterial,
} from 'three';

export interface BakedPartData {
  /** Material name, keyed into the set's material table. */
  m: string;
  /** Dequantisation offset and step, per axis. */
  o: [number, number, number];
  s: [number, number, number];
  /** base64 Int16Array positions and Uint16Array indices. */
  p: string;
  i: string;
}

export interface BakedMaterialData {
  /** Diffuse colour, linear-sRGB, straight off the MTL. */
  kd: [number, number, number];
  ks: [number, number, number];
  ns: number;
  d: number;
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- materials

/**
 * The MTL writes `Kd` in linear space, which is exactly what three.js works
 * in, so the values go straight across with no gamma guesswork.
 */
export function bakedColor(m: BakedMaterialData): Color {
  return new Color().setRGB(m.kd[0], m.kd[1], m.kd[2], LinearSRGBColorSpace);
}

export function bakedMaterial(m: BakedMaterialData): MeshPhongMaterial {
  return new MeshPhongMaterial({
    color: bakedColor(m),
    specular: new Color().setRGB(m.ks[0], m.ks[1], m.ks[2], LinearSRGBColorSpace),
    shininess: m.ns,
    flatShading: true,
    transparent: m.d < 1,
    opacity: m.d,
  });
}

// ----------------------------------------------------------------- geometry

const geometries = new Map<BakedPartData, BufferGeometry>();

/** Unpacks one part, once — decoded geometry is cached and shared. */
export function bakedGeometry(part: BakedPartData): BufferGeometry {
  let geo = geometries.get(part);
  if (geo) return geo;

  const q = new Int16Array(bytes(part.p).buffer);
  const p = new Float32Array(q.length);
  for (let i = 0; i < q.length; i += 3) {
    p[i] = (q[i] + 32767) * part.s[0] + part.o[0];
    p[i + 1] = (q[i + 1] + 32767) * part.s[1] + part.o[1];
    p[i + 2] = (q[i + 2] + 32767) * part.s[2] + part.o[2];
  }
  geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(p, 3));
  geo.setIndex(new BufferAttribute(new Uint16Array(bytes(part.i).buffer), 1));
  geo.computeVertexNormals();
  geometries.set(part, geo);
  return geo;
}
