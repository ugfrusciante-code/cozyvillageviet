/**
 * Render-to-texture portraits: the little "photographs" the UI frames in
 * build cards and window hero bands. Each building type (and villager dress)
 * is staged once in an offscreen WebGL scene, lit like late morning, rendered,
 * and cached as a data URL. The game still ships with no art assets — these
 * are the same procedural meshes the world uses.
 */

import {
  AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Group,
  Mesh, MeshLambertMaterial, OrthographicCamera, Scene, SphereGeometry, WebGLRenderer,
} from 'three';

import { BUILDING_BY_ID, type BuildingDef } from '../sim/defs';
import type { Building } from '../sim/building';
import { disposeObject, makeBuildingMesh } from './entities';
import { C } from './palette';

let renderer: WebGLRenderer | null = null;
let rendererDead = false;
const cache = new Map<string, string | null>();

function getRenderer(): WebGLRenderer | null {
  if (renderer || rendererDead) return renderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  } catch {
    rendererDead = true;
    renderer = null;
  }
  return renderer;
}

const lambert = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

/** Shared stage: warm key light, cool fill, a grass footing. */
function stage(scene: Scene): void {
  scene.add(new AmbientLight(0xcfd8e8, 1.35));
  const sun = new DirectionalLight(0xfff2d8, 2.0);
  sun.position.set(3.2, 5.2, 2.6);
  scene.add(sun);
  const rim = new DirectionalLight(0xffd9a0, 0.55);
  rim.position.set(-2.6, 2.2, -2.4);
  scene.add(rim);
}

function shoot(scene: Scene, pxW: number, pxH: number, halfH: number, lookY: number): string | null {
  const r = getRenderer();
  if (!r) return null;
  const aspect = pxW / pxH;
  const cam = new OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, -80, 120);
  // The game's own 3/4 view: yawed a third-turn, pitched well above the horizon.
  const yaw = 0.62, pitch = 0.58, dist = 30;
  cam.position.set(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist + lookY,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  cam.lookAt(0, lookY, 0);
  r.setSize(pxW, pxH, false);
  r.render(scene, cam);
  try {
    return r.domElement.toDataURL('image/png');
  } catch {
    return null;
  }
}

function stubBuilding(def: BuildingDef, w: number, h: number): Building {
  return {
    def, x: 0, y: 0, w, h, groundY: 0, area: w * h, variant: 3,
    isHouse: !!def.homes,
  } as unknown as Building;
}

/**
 * A building's portrait at the given pixel size, or null while WebGL is
 * unavailable. Zone buildings pose at a friendly mid size rather than their
 * minimum footprint.
 */
export function buildingPortrait(defId: string, pxW = 300, pxH = 190): string | null {
  const key = `b:${defId}@${pxW}x${pxH}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const def = BUILDING_BY_ID[defId];
  if (!def) return null;

  const scene = new Scene();
  stage(scene);

  const w = def.zone ? Math.max(def.size[0], 5) : def.size[0];
  const h = def.zone ? Math.max(def.size[1], 5) : def.size[1];
  const vis = makeBuildingMesh(stubBuilding(def, w, h));
  vis.built.visible = true;
  vis.site.visible = false;
  vis.root.position.set(0, 0, 0);
  scene.add(vis.root);

  // Crop rows on a portrait field should look ripe, not freshly tilled.
  if (def.crop) {
    for (const child of vis.built.children) {
      if (child.name !== 'croprow') continue;
      child.scale.y = 0.85;
      ((child as Mesh).material as MeshLambertMaterial).color.setHex(0xcbb070);
    }
  }

  const footing = new Mesh(
    new CylinderGeometry(Math.max(w, h) * 0.92, Math.max(w, h) * 0.98, 0.14, 22),
    lambert(0x74904f),
  );
  footing.position.y = -0.08;
  scene.add(footing);

  const tall = def.height > 4;
  const halfH = Math.max(1.5, Math.max(def.height * (tall ? 0.62 : 0.78), Math.max(w, h) * 0.55));
  const url = shoot(scene, pxW, pxH, halfH, Math.max(0.8, def.height * 0.34));

  scene.remove(vis.root, footing);
  disposeObject(vis.root);
  disposeObject(footing);
  cache.set(key, url);
  return url;
}

/**
 * A chest-up villager portrait in the given tunic colour — the same primitive
 * figure the street uses, posed against nothing.
 */
export function villagerPortrait(tunic: number, opts: { hat?: boolean; skin?: number; hair?: number } = {}): string | null {
  const hat = opts.hat ?? true;
  const skin = opts.skin ?? 0xd9a97c;
  const hair = opts.hair ?? 0x6b4a33;
  const key = `v:${tunic}:${hat ? 1 : 0}:${skin}:${hair}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const scene = new Scene();
  stage(scene);

  const fig = new Group();
  const torso = new Mesh(new CylinderGeometry(0.13, 0.165, 0.34, 6), lambert(tunic));
  torso.position.y = 0.57;
  const belt = new Mesh(new CylinderGeometry(0.155, 0.16, 0.045, 6), lambert(0x4a3a2c));
  belt.position.y = 0.45;
  const head = new Mesh(new SphereGeometry(0.125, 10, 8), lambert(skin));
  head.position.y = 0.86;
  const hairM = new Mesh(new SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), lambert(hair));
  hairM.position.y = 0.885;
  const armL = new Mesh(new BoxGeometry(0.07, 0.3, 0.08), lambert(tunic));
  armL.position.set(-0.185, 0.7 - 0.15, 0);
  const armR = armL.clone();
  armR.position.x = 0.185;
  fig.add(torso, belt, head, hairM, armL, armR);
  if (hat) {
    const hatM = new Mesh(new CylinderGeometry(0.06, 0.2, 0.09, 8), lambert(C.thatch));
    hatM.position.y = 0.97;
    fig.add(hatM);
  }
  fig.rotation.y = 0.5;
  scene.add(fig);

  const url = shoot(scene, 160, 160, 0.34, 0.74);
  scene.remove(fig);
  disposeObject(fig);
  cache.set(key, url);
  return url;
}

/** Tunic colour by trade, mirroring the street's dress code. */
export const TRADE_TUNIC: Record<string, number> = {
  gathering: 0x6b8452, farming: 0xb0894f, crafting: 0x8a5a3c,
  civic: 0x5f7a99, logistics: 0x9d7e4a, housing: 0x8d8375,
  labourer: 0x968878, child: 0xc98f6a, elder: 0x9a938c,
};

export { Color };
