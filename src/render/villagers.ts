/**
 * Instanced villager rendering.
 *
 * Every villager used to be a Group of ten meshes, which meant ten draw calls
 * each and a hard ceiling around a hundred people. Here each body part is a
 * single InstancedMesh, so the whole population costs nine draw calls no matter
 * how many villagers there are. Limb angles are baked into per-instance
 * matrices on the CPU each frame — cheap, and it keeps the walk cycle.
 */

import {
  BoxGeometry, Color, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute,
  InstancedMesh, Matrix4, MeshLambertMaterial, Object3D, Quaternion, Raycaster,
  SphereGeometry, Vector3,
} from 'three';

import { C } from './palette';
import type { Game } from '../sim/game';
import type { Villager } from '../sim/villager';

const SKIN_TONES = [0xe8c49a, 0xd9a97c, 0xc4906a, 0xb07b56, 0xefd2ab];
const HAIR_TONES = [0x3a2c1e, 0x6b4a33, 0x8a6244, 0xa8845c, 0x4a4038, 0xc9b18a];

/** Tunic colour by trade, so a glance at the street tells you who does what. */
const TRADE_DRESS: Record<string, number> = {
  gathering: 0x6b8452, farming: 0xb0894f, crafting: 0x8a5a3c,
  civic: 0x5f7a99, logistics: 0x9d7e4a, housing: 0x8d8375,
  labourer: 0x968878, child: 0xc98f6a, elder: 0x9a938c,
};

const CARRY_COLORS: Record<string, number> = {
  logs: 0x6b4a33, planks: 0xc8a978, stone: 0xb5aa98, firewood: 0x8a5a33,
  bread: 0xd8a15c, berries: 0x7a4a86, fish: 0x8fb6c4, meat: 0xb4614f,
  grain: 0xd9bb84, flour: 0xefe3cf, clothes: 0x9d6b8a, wool: 0xf0ece2,
  clay: 0x9c7350, bricks: 0xa8563a, iron: 0x7c6f63, tools: 0x8d8375,
  ale: 0xc9a45f, herbs: 0x7f9159, honey: 0xe0a756, beans: 0x8a7a4a,
  turnips: 0xc98f5a, eggs: 0xefe3cf, leather: 0x8a6244, shoes: 0x6b4a33,
  cloth: 0xb7a3c4, pottery: 0xc0663d, candles: 0xe0a756, medicine: 0xa8c4b0,
  iron_ore: 0x7c6f63, hide: 0x9c7350,
};

/** Per-villager animation state that has nowhere to live on the sim object. */
interface Anim {
  bob: number;
  legL: number; legR: number;
  armL: number; armR: number;
  lean: number;
  yaw: number;
  /** Cached so we only recolour on an actual job change. */
  lastJobCat: string;
}

const PART_COUNT_STEP = 64;
const X_AXIS = new Vector3(1, 0, 0);
const SELECT_GLOW = new Color(0xffc07a);

export class VillagerRenderer {
  /** All the instanced parts, in the order their matrices are written. */
  private torso!: InstancedMesh;
  private head!: InstancedMesh;
  private hair!: InstancedMesh;
  private hat!: InstancedMesh;
  private belt!: InstancedMesh;
  private armL!: InstancedMesh;
  private armR!: InstancedMesh;
  private legL!: InstancedMesh;
  private legR!: InstancedMesh;
  private load!: InstancedMesh;
  private cart!: InstancedMesh;
  private parts: InstancedMesh[] = [];

  /** Instance slot per villager id, and the reverse for picking. */
  private slotOf = new Map<number, number>();
  private idAt: number[] = [];
  private anim = new Map<number, Anim>();
  private capacity = 0;

  private dummy = new Object3D();
  private colorTmp = new Color();
  private m4 = new Matrix4();
  private q = new Quaternion();
  private v3 = new Vector3();
  private scaleV = new Vector3();

  constructor(private game: Game, private parent: Object3D) {
    this.build(PART_COUNT_STEP * 4);
  }

  // ------------------------------------------------------------------ build

  private build(capacity: number): void {
    this.capacity = capacity;
    for (const p of this.parts) {
      this.parent.remove(p);
      p.geometry.dispose();
      (p.material as MeshLambertMaterial).dispose();
    }
    this.parts.length = 0;

    const mk = (geo: InstancedMesh['geometry'], color: number, shadow = true): InstancedMesh => {
      const m = new InstancedMesh(geo, new MeshLambertMaterial({ color, flatShading: true }), capacity);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.castShadow = shadow;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      this.parent.add(m);
      this.parts.push(m);
      return m;
    };

    // Geometry is authored around the part's own pivot so per-instance
    // rotation swings the limb rather than spinning it about its middle.
    const torsoG = new CylinderGeometry(0.13, 0.165, 0.34, 6);
    const headG = new SphereGeometry(0.125, 10, 8);
    const hairG = new SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hatG = new CylinderGeometry(0.06, 0.2, 0.09, 8);
    const beltG = new CylinderGeometry(0.155, 0.16, 0.045, 6);
    const armG = new BoxGeometry(0.07, 0.3, 0.08);
    armG.translate(0, -0.15, 0);           // pivot at the shoulder
    const legG = new BoxGeometry(0.085, 0.36, 0.1);
    legG.translate(0, -0.18, 0);           // pivot at the hip
    const loadG = new BoxGeometry(0.26, 0.2, 0.2);
    const cartG = new BoxGeometry(0.44, 0.26, 0.62);

    this.torso = mk(torsoG, TRADE_DRESS.labourer);
    this.head = mk(headG, SKIN_TONES[0]);
    this.hair = mk(hairG, HAIR_TONES[0], false);
    this.hat = mk(hatG, C.thatch, false);
    this.belt = mk(beltG, 0x4a3a2c, false);
    this.armL = mk(armG, TRADE_DRESS.labourer);
    this.armR = mk(armG.clone(), TRADE_DRESS.labourer);
    this.legL = mk(legG, 0x5c4a38);
    this.legR = mk(legG.clone(), 0x5c4a38);
    this.load = mk(loadG, C.timberDark);
    this.cart = mk(cartG, C.timber);

    // Per-instance colour, so skin, hair and tunic can vary within one mesh.
    for (const p of this.parts) {
      const colors = new Float32Array(capacity * 3).fill(1);
      p.instanceColor = new InstancedBufferAttribute(colors, 3);
      p.instanceColor.setUsage(DynamicDrawUsage);
    }
  }

  private grow(): void {
    const next = this.capacity + Math.max(PART_COUNT_STEP, Math.ceil(this.capacity * 0.5));
    this.build(next);
    this.slotOf.clear();
    this.idAt.length = 0;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, selectedId: number | undefined): void {
    const g = this.game;
    const count = g.villagers.size;
    if (count > this.capacity) this.grow();

    // Slot assignment is rebuilt from scratch each frame: villager counts move
    // slowly and a stable ordering matters less than never leaving a stale
    // instance sitting in the world after someone dies.
    this.idAt.length = 0;
    this.slotOf.clear();

    let i = 0;
    for (const v of g.villagers.values()) {
      if (v.action === 'sleeping') continue;   // indoors, not drawn
      const a = this.animOf(v);
      this.step(v, a, dt);
      this.writeInstance(i, v, a, selectedId === v.id);
      this.slotOf.set(v.id, i);
      this.idAt[i] = v.id;
      i++;
    }

    for (const p of this.parts) {
      p.count = i;
      p.instanceMatrix.needsUpdate = true;
      if (p.instanceColor) p.instanceColor.needsUpdate = true;
    }
    // The load and cart are only drawn for those actually carrying, so they
    // get their own count set inside writeInstance via these tallies.
    this.load.count = i;
    this.cart.count = i;

    // Drop animation state for anyone who has died.
    if (this.anim.size > count * 2 + 32) {
      for (const id of [...this.anim.keys()]) if (!g.villagers.has(id)) this.anim.delete(id);
    }
  }

  private animOf(v: Villager): Anim {
    let a = this.anim.get(v.id);
    if (!a) {
      a = {
        bob: (v.id * 1.7) % 6.28, legL: 0, legR: 0, armL: 0, armR: 0,
        lean: 0, yaw: v.facing, lastJobCat: '',
      };
      this.anim.set(v.id, a);
    }
    return a;
  }

  /** Advance the walk / work cycle for one villager. */
  private step(v: Villager, a: Anim, dt: number): void {
    const moving = v.pathIdx < v.path.length;
    const working = v.action === 'working' || v.action === 'harvesting'
      || v.action === 'constructing' || v.action === 'planting';

    if (moving) {
      a.bob += dt * 10;
      const swing = Math.sin(a.bob);
      a.legL = swing * 0.62;
      a.legR = -swing * 0.62;
      if (v.carry) { a.armL = -1.15; a.armR = -1.15; }
      else { a.armL = -swing * 0.5; a.armR = swing * 0.5; }
      a.lean *= 1 - Math.min(1, dt * 6);
      // Shortest-arc turn toward the direction of travel.
      let d = v.facing - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.yaw += d * Math.min(1, dt * 9);
    } else if (working) {
      a.bob += dt * 6.5;
      const s = Math.sin(a.bob);
      a.armL = -1.5 + s * 0.65;
      a.armR = -1.5 + s * 0.65;
      a.legL = 0; a.legR = 0;
      a.lean = 0.12 + s * 0.1;
    } else {
      const k = 1 - Math.min(1, dt * 5);
      a.armL *= k; a.armR *= k; a.legL *= k; a.legR *= k; a.lean *= k;
    }
  }

  /** Bake one villager's parts into the instance buffers. */
  private writeInstance(i: number, v: Villager, a: Anim, selected: boolean): void {
    const g = this.game;
    const scale = (v.isChild ? 0.62 : v.isElder ? 0.92 : 1) * 1.5;
    const y = g.world.heightAt(v.x, v.y);
    const moving = v.pathIdx < v.path.length;
    const bobY = moving ? Math.abs(Math.sin(a.bob)) * 0.03 : 0;

    // Root transform: position on the ground, yaw to face travel, slight lean.
    const root = this.dummy;
    root.position.set(v.x + 0.5, y + bobY, v.y + 0.5);
    root.rotation.set(a.lean, a.yaw, 0);
    root.scale.setScalar(scale);
    root.updateMatrix();
    const R = root.matrix;

    const place = (mesh: InstancedMesh, px: number, py: number, pz: number, rx = 0) => {
      this.q.setFromAxisAngle(X_AXIS, rx);
      this.scaleV.set(1, 1, 1);
      this.v3.set(px, py, pz);
      this.m4.compose(this.v3, this.q, this.scaleV);
      this.m4.premultiply(R);
      mesh.setMatrixAt(i, this.m4);
    };

    place(this.torso, 0, 0.57, 0);
    place(this.head, 0, 0.86, 0);
    place(this.hair, 0, 0.885, 0);
    place(this.belt, 0, 0.45, 0);
    place(this.armL, -0.185, 0.7, 0, a.armL);
    place(this.armR, 0.185, 0.7, 0, a.armR);
    place(this.legL, -0.075, 0.4, 0, a.legL);
    place(this.legR, 0.075, 0.4, 0, a.legR);

    // Hats: adults only. Children get an empty transform rather than a slot of
    // their own, which keeps every part array the same length.
    if (v.isChild) place(this.hat, 0, -50, 0);
    else place(this.hat, 0, 0.97, 0);

    if (v.carry) place(this.load, 0, 0.62, 0.24);
    else place(this.load, 0, -50, 0);

    if (v.hasOx) place(this.cart, 0, 0.3, -0.75);
    else place(this.cart, 0, -50, 0);

    // --- colours
    const job = v.jobId >= 0 ? g.buildings.get(v.jobId) : undefined;
    const cat = v.isChild ? 'child' : v.isElder ? 'elder'
      : (job && TRADE_DRESS[job.def.cat] ? job.def.cat : 'labourer');
    const tunic = TRADE_DRESS[cat];
    a.lastJobCat = cat;

    const skin = SKIN_TONES[v.id % SKIN_TONES.length];
    const hair = HAIR_TONES[(v.id * 7) % HAIR_TONES.length];

    // A selected villager glows warm so they can be picked out of a crowd.
    const tint = (hex: number): Color => {
      this.colorTmp.setHex(hex);
      if (selected) this.colorTmp.lerp(SELECT_GLOW, 0.55);
      return this.colorTmp;
    };

    this.torso.setColorAt(i, tint(tunic));
    this.armL.setColorAt(i, tint(tunic));
    this.armR.setColorAt(i, tint(tunic));
    this.head.setColorAt(i, tint(skin));
    this.hair.setColorAt(i, tint(hair));
    this.hat.setColorAt(i, tint(v.isElder ? 0x8d8375 : C.thatch));
    this.belt.setColorAt(i, tint(0x4a3a2c));
    this.legL.setColorAt(i, tint(0x5c4a38));
    this.legR.setColorAt(i, tint(0x5c4a38));
    this.load.setColorAt(i, tint(v.carry ? (CARRY_COLORS[v.carry.res] ?? 0x8a6244) : 0x8a6244));
    this.cart.setColorAt(i, tint(C.timber));
  }

  // ---------------------------------------------------------------- picking

  /** The villager under the cursor, or undefined. */
  pick(raycaster: Raycaster): Villager | undefined {
    // Torso and head are the big targets; testing those two is enough and
    // avoids nine intersect passes per hover.
    for (const mesh of [this.torso, this.head]) {
      const hits = raycaster.intersectObject(mesh, false);
      if (!hits.length) continue;
      const inst = hits[0].instanceId;
      if (inst === undefined) continue;
      const id = this.idAt[inst];
      const v = this.game.villagers.get(id);
      if (v) return v;
    }
    return undefined;
  }

  dispose(): void {
    for (const p of this.parts) {
      this.parent.remove(p);
      p.geometry.dispose();
      (p.material as MeshLambertMaterial).dispose();
    }
    this.parts.length = 0;
  }
}

export { CARRY_COLORS, TRADE_DRESS };
