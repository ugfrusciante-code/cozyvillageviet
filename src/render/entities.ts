/**
 * Procedural meshes for buildings and villagers. Every building is assembled
 * from primitives at runtime, so the game ships with no art assets.
 */

import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry,
  DoubleSide, EdgesGeometry, Group, IcosahedronGeometry, LineBasicMaterial, LineSegments, Material,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, PointLight, RingGeometry,
  SphereGeometry, TorusGeometry, Vector3,
} from 'three';

import { C } from './palette';
import type { Building } from '../sim/building';
import type { Game } from '../sim/game';
import { WATER_LEVEL } from '../sim/world';

const mat = (color: number, opts: { flat?: boolean; transparent?: boolean; opacity?: number } = {}) =>
  new MeshLambertMaterial({
    color, flatShading: opts.flat ?? true,
    transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
  });

const PALETTES: Record<string, { wall: number; roof: number; trim: number }> = {
  timber: { wall: C.linen, roof: C.thatch, trim: C.timber },
  thatch: { wall: C.sand, roof: C.thatch, trim: C.timberDark },
  stone: { wall: C.stone, roof: C.slate, trim: C.stoneDark },
  brick: { wall: C.clayRed, roof: C.terracotta, trim: C.timberDark },
  canvas: { wall: C.cream, roof: C.terracotta, trim: C.timber },
  garden: { wall: 0x8aa05c, roof: 0x6f8f4e, trim: C.timber },
  field: { wall: C.wheat, roof: C.wheat, trim: C.soil },
};

function addBox(g: Group, w: number, h: number, d: number, x: number, y: number, z: number, m: Material): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

/** A simple gabled roof: a box rotated 45° and squashed reads as a prism. */
function addRoof(g: Group, w: number, d: number, h: number, y: number, m: Material, ridgeAlongX = true): void {
  const geo = new CylinderGeometry(0, Math.SQRT1_2, 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  const mesh = new Mesh(geo, m);
  mesh.scale.set(ridgeAlongX ? w * 1.06 : d * 1.06, h, ridgeAlongX ? d * 1.06 : w * 1.06);
  mesh.position.set(0, y + h / 2, 0);
  if (!ridgeAlongX) mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
}

function addGable(g: Group, w: number, d: number, h: number, y: number, m: Material): void {
  // Long pitched roof made from two slabs — reads better on wide buildings.
  for (const s of [-1, 1]) {
    const slab = new Mesh(new BoxGeometry(w * 0.62, 0.12, d * 1.12), m);
    slab.position.set(s * w * 0.26, y + h / 2, 0);
    slab.rotation.z = s * -0.62;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
  }
}

const windowMat = new MeshBasicMaterial({ color: 0xffd9a0 });
const windowDark = new MeshLambertMaterial({ color: 0x4a3a2c });

function addWindows(g: Group, count: number, w: number, y: number, z: number): Mesh[] {
  const out: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const m = new Mesh(new PlaneGeometry(0.3, 0.36), windowDark);
    const spread = w * 0.62;
    m.position.set(-spread / 2 + (spread * (i + 0.5)) / count, y, z);
    m.userData.window = true;
    g.add(m);
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingVisual {
  root: Group;
  built: Group;
  site: Group;
  windows: Mesh[];
  light?: PointLight;
  wheel?: Object3D;
  selection: LineSegments;
  lastTier: number;
  lastState: string;
  /** Last herd count pushed to the flock meshes. */
  lastHerd?: number;
}

export function makeBuildingMesh(b: Building): BuildingVisual {
  const def = b.def;
  const pal = PALETTES[def.palette] ?? PALETTES.timber;
  const wallM = mat(pal.wall);
  const roofM = mat(pal.roof);
  const trimM = mat(pal.trim);

  const root = new Group();
  root.position.set(b.x + b.w / 2, b.groundY, b.y + b.h / 2);

  const built = new Group();
  const site = new Group();
  root.add(built, site);

  const w = b.w * 0.86, d = b.h * 0.86;
  const windows: Mesh[] = [];
  let wheel: Object3D | undefined;
  let light: PointLight | undefined;

  switch (def.id) {
    case 'road': {
      const m = new Mesh(new PlaneGeometry(1, 1), mat(C.soil));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.045;
      m.receiveShadow = true;
      built.add(m);
      break;
    }
    case 'bridge': {
      // A plank deck pinned above the waterline on two posts. groundY here is
      // the riverbed, so the deck rides at a fixed height over the water
      // plane rather than the terrain.
      const deckY = WATER_LEVEL + 0.12 - b.groundY;
      const deck = new Mesh(new BoxGeometry(1.04, 0.1, 1.04), mat(C.timber));
      deck.position.y = deckY;
      deck.receiveShadow = true;
      const rails = new Mesh(new BoxGeometry(1.04, 0.16, 0.08), mat(C.timberDark ?? C.timber));
      rails.position.set(0, deckY + 0.12, 0.46);
      const rails2 = rails.clone();
      rails2.position.z = -0.46;
      for (const sx of [-0.38, 0.38]) {
        const post = new Mesh(new CylinderGeometry(0.06, 0.07, deckY + 0.25, 6), mat(C.timber));
        post.position.set(sx, (deckY + 0.25) / 2 - 0.2, 0);
        built.add(post);
      }
      built.add(deck, rails, rails2);
      break;
    }
    case 'field': {
      const soil = addBox(built, w, 0.12, d, 0, 0, 0, mat(C.soil));
      soil.castShadow = false;
      // One furrow of crop per tile of depth. The rows are grown/recoloured
      // live in updateBuildingVisual as the farming year turns.
      const rows = Math.max(3, Math.round(b.h));
      for (let i = 0; i < rows; i++) {
        const rowMat = new MeshLambertMaterial({ color: 0x7d9a56, flatShading: true });
        const row = new Mesh(new BoxGeometry(w * 0.94, 0.3, 0.16), rowMat);
        row.position.set(0, 0.13, -d / 2 + (d * (i + 0.5)) / rows);
        row.scale.y = 0.1;
        row.castShadow = true;
        row.name = 'croprow';
        built.add(row);
      }
      break;
    }
    case 'pasture': {
      addBox(built, w, 0.06, d, 0, 0, 0, mat(0x86a05a)).castShadow = false;
      // Post-and-rail fence around the drag-defined paddock.
      const postM = trimM;
      const addRail = (len: number, x: number, z: number, alongX: boolean) => {
        const rail = new Mesh(new BoxGeometry(alongX ? len : 0.07, 0.05, alongX ? 0.07 : len), postM);
        rail.position.set(x, 0.42, z);
        built.add(rail);
        const posts = Math.max(2, Math.round(len / 1.4));
        for (let p = 0; p < posts; p++) {
          const t = posts === 1 ? 0 : p / (posts - 1) - 0.5;
          const post = new Mesh(new BoxGeometry(0.09, 0.5, 0.09), postM);
          post.position.set(alongX ? x + t * len : x, 0.25, alongX ? z : z + t * len);
          built.add(post);
        }
      };
      addRail(w, 0, -d / 2, true); addRail(w, 0, d / 2, true);
      addRail(d, -w / 2, 0, false); addRail(d, w / 2, 0, false);
      // Twelve sheep at most; updateBuildingVisual shows as many as the herd
      // actually holds. An empty paddock renders as exactly that.
      const flock = 12;
      for (let i = 0; i < flock; i++) {
        const sheep = new Group();
        const body = new Mesh(new CapsuleGeometry(0.16, 0.22, 3, 6), mat(0xf0ece2));
        body.rotation.z = Math.PI / 2;
        body.position.y = 0.28;
        const head = new Mesh(new BoxGeometry(0.13, 0.13, 0.16), mat(0x4a3a2c));
        head.position.set(0.24, 0.34, 0);
        sheep.add(body, head);
        body.castShadow = true;
        const gx = ((i * 0.37 + b.variant) % 1 - 0.5) * (w - 1);
        const gz = ((i * 0.73 + b.variant * 2) % 1 - 0.5) * (d - 1);
        sheep.position.set(gx, 0, gz);
        sheep.rotation.y = i * 2.2;
        sheep.name = `sheep-${i}`;
        sheep.visible = false;
        built.add(sheep);
      }
      break;
    }
    case 'orchard': {
      addBox(built, w, 0.06, d, 0, 0, 0, mat(0x87a15b)).castShadow = false;
      // A planted grid of fruit trees filling the drag-defined grove.
      const cols = Math.max(2, Math.floor(b.w / 2));
      const rowsN = Math.max(2, Math.floor(b.h / 2));
      for (let ix = 0; ix < cols; ix++) {
        for (let iz = 0; iz < rowsN; iz++) {
          const t = new Group();
          const trunk = new Mesh(new CylinderGeometry(0.07, 0.09, 0.6, 5), mat(C.timberDark));
          trunk.position.y = 0.3;
          const crown = new Mesh(new IcosahedronGeometry(0.4, 0), mat(0x6f8f4e));
          crown.position.y = 0.85;
          crown.castShadow = true;
          t.add(trunk, crown);
          t.position.set(
            (ix + 0.5) / cols * w - w / 2,
            0,
            (iz + 0.5) / rowsN * d - d / 2,
          );
          const s = 0.85 + ((ix * 7 + iz * 13 + b.variant * 10) % 10) / 28;
          t.scale.setScalar(s);
          built.add(t);
        }
      }
      break;
    }
    case 'well': {
      const ring = new Mesh(new CylinderGeometry(0.42, 0.46, 0.42, 10), mat(C.stone));
      ring.position.y = 0.21;
      ring.castShadow = true;
      built.add(ring);
      for (const s of [-1, 1]) {
        const post = new Mesh(new BoxGeometry(0.08, 0.75, 0.08), trimM);
        post.position.set(s * 0.34, 0.6, 0);
        built.add(post);
      }
      const beam = new Mesh(new BoxGeometry(0.85, 0.09, 0.3), roofM);
      beam.position.y = 1.0;
      built.add(beam);
      break;
    }
    case 'fountain': {
      const basin = new Mesh(new CylinderGeometry(0.85, 0.92, 0.34, 14), mat(C.stone));
      basin.position.y = 0.17;
      basin.castShadow = true;
      built.add(basin);
      const water = new Mesh(new CylinderGeometry(0.74, 0.74, 0.06, 14), mat(C.water, { transparent: true, opacity: 0.85 }));
      water.position.y = 0.33;
      built.add(water);
      const col = new Mesh(new CylinderGeometry(0.12, 0.16, 0.7, 8), mat(C.stoneDark));
      col.position.y = 0.65;
      built.add(col);
      const top = new Mesh(new SphereGeometry(0.2, 10, 8), mat(C.stone));
      top.position.y = 1.06;
      built.add(top);
      break;
    }
    case 'flowerbed': {
      addBox(built, 0.85, 0.16, 0.85, 0, 0, 0, mat(C.soil));
      for (let i = 0; i < 5; i++) {
        const f = new Mesh(new IcosahedronGeometry(0.1, 0), mat([0xd96a7a, 0xe8b44a, 0xc98ad4, 0xe57f5a][i % 4]));
        f.position.set((Math.random() - 0.5) * 0.6, 0.26, (Math.random() - 0.5) * 0.6);
        built.add(f);
      }
      break;
    }
    case 'bench': {
      addBox(built, 0.8, 0.06, 0.28, 0, 0.32, 0, trimM);
      addBox(built, 0.8, 0.3, 0.06, 0, 0.38, -0.12, trimM);
      for (const s of [-1, 1]) addBox(built, 0.07, 0.32, 0.24, s * 0.32, 0, 0, trimM);
      break;
    }
    case 'lantern': {
      addBox(built, 0.1, 1.9, 0.1, 0, 0, 0, mat(C.timberDark));
      const lamp = new Mesh(new BoxGeometry(0.26, 0.3, 0.26), windowDark);
      lamp.position.y = 2.05;
      lamp.userData.window = true;
      built.add(lamp);
      windows.push(lamp);
      light = new PointLight(0xffc98a, 0, 7, 2);
      light.position.set(0, 2.05, 0);
      built.add(light);
      break;
    }
    case 'garden': {
      addBox(built, w, 0.07, d, 0, 0, 0, mat(0x8fa85e)).castShadow = false;
      const path = addBox(built, w * 0.28, 0.02, d, 0, 0.07, 0, mat(C.sand));
      path.castShadow = false;
      for (let i = 0; i < 4; i++) {
        const bush = new Mesh(new IcosahedronGeometry(0.34, 0), mat(0x6f8f4e));
        bush.position.set(((i % 2) - 0.5) * w * 0.6, 0.3, (Math.floor(i / 2) - 0.5) * d * 0.6);
        bush.castShadow = true;
        built.add(bush);
      }
      break;
    }
    case 'monument': {
      addBox(built, w * 0.8, 0.4, d * 0.8, 0, 0, 0, mat(C.stone));
      addBox(built, w * 0.5, 0.3, d * 0.5, 0, 0.4, 0, mat(C.stone));
      const shaft = new Mesh(new CylinderGeometry(0.42, 0.62, def.height - 1.4, 8), mat(C.linen));
      shaft.position.y = 0.7 + (def.height - 1.4) / 2;
      shaft.castShadow = true;
      built.add(shaft);
      const cap = new Mesh(new ConeGeometry(0.6, 0.9, 8), mat(C.honey));
      cap.position.y = def.height - 0.3;
      cap.castShadow = true;
      built.add(cap);
      break;
    }
    case 'mill': {
      const body = new Mesh(new CylinderGeometry(w * 0.34, w * 0.46, 3.0, 10), wallM);
      body.position.y = 1.5;
      body.castShadow = true;
      body.receiveShadow = true;
      built.add(body);
      const cap = new Mesh(new ConeGeometry(w * 0.42, 0.9, 10), roofM);
      cap.position.y = 3.35;
      cap.castShadow = true;
      built.add(cap);
      wheel = new Group();
      for (let i = 0; i < 4; i++) {
        const blade = new Mesh(new BoxGeometry(0.14, 2.3, 0.5), mat(C.linen));
        blade.position.y = 1.15;
        blade.castShadow = true;
        const arm = new Group();
        arm.add(blade);
        arm.rotation.z = (i / 4) * Math.PI * 2;
        wheel.add(arm);
      }
      wheel.position.set(0, 3.0, w * 0.46);
      built.add(wheel);
      windows.push(...addWindows(built, 1, w, 1.6, w * 0.35));
      break;
    }
    case 'chapel':
    case 'church': {
      const nave = addBox(built, w, def.height * 0.52, d, 0, 0, 0, wallM);
      void nave;
      addRoof(built, w, d, def.height * 0.3, def.height * 0.52, roofM, true);
      const tower = addBox(built, w * 0.3, def.height * 0.92, w * 0.3, -w * 0.3, 0, -d * 0.3, wallM);
      void tower;
      const spire = new Mesh(new ConeGeometry(w * 0.24, def.height * 0.5, 6), roofM);
      spire.position.set(-w * 0.3, def.height * 0.92 + def.height * 0.25, -d * 0.3);
      spire.castShadow = true;
      built.add(spire);
      const cross = new Mesh(new BoxGeometry(0.06, 0.4, 0.06), mat(C.honey));
      cross.position.set(-w * 0.3, def.height * 1.24, -d * 0.3);
      built.add(cross);
      windows.push(...addWindows(built, def.id === 'church' ? 3 : 2, w, def.height * 0.3, d / 2 + 0.02));
      break;
    }
    case 'market': {
      // Open stalls under striped awnings.
      addBox(built, w, 0.06, d, 0, 0, 0, mat(C.sand)).castShadow = false;
      const colors = [C.terracotta, C.honey, C.moss, C.clayRed];
      for (let i = 0; i < 4; i++) {
        const stall = new Group();
        const table = new Mesh(new BoxGeometry(1.05, 0.08, 0.66), trimM);
        table.position.y = 0.62;
        table.castShadow = true;
        stall.add(table);
        for (const sx of [-0.45, 0.45]) {
          for (const sz of [-0.28, 0.28]) {
            const leg = new Mesh(new BoxGeometry(0.06, 0.62, 0.06), trimM);
            leg.position.set(sx, 0.31, sz);
            stall.add(leg);
          }
        }
        const awn = new Mesh(new BoxGeometry(1.2, 0.06, 0.86), mat(colors[i]));
        awn.position.y = 1.16;
        awn.rotation.x = 0.16;
        awn.castShadow = true;
        stall.add(awn);
        for (const sx of [-0.5, 0.5]) {
          const post = new Mesh(new BoxGeometry(0.05, 1.16, 0.05), trimM);
          post.position.set(sx, 0.58, -0.36);
          stall.add(post);
        }
        stall.position.set(((i % 2) - 0.5) * w * 0.52, 0.06, (Math.floor(i / 2) - 0.5) * d * 0.52);
        stall.rotation.y = (i % 2) * Math.PI;
        built.add(stall);
      }
      break;
    }
    case 'stable': {
      // Open-fronted timber byre with a cart parked outside.
      addBox(built, w, 1.6, d * 0.72, 0, 0, -d * 0.14, wallM);
      addRoof(built, w, d * 0.8, 1.0, 1.6, roofM, true);
      for (const sx of [-1, 1]) {
        const post = new Mesh(new BoxGeometry(0.11, 1.6, 0.11), trimM);
        post.position.set(sx * (w / 2 - 0.08), 0.8, d * 0.22);
        built.add(post);
      }
      // A resting ox: rounded body, low head, stood in the doorway.
      const ox = new Group();
      const body = new Mesh(new CapsuleGeometry(0.26, 0.5, 4, 7), mat(0x8a6f56));
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.5;
      body.castShadow = true;
      const oxHead = new Mesh(new BoxGeometry(0.24, 0.22, 0.28), mat(0x6b5442));
      oxHead.position.set(0.46, 0.55, 0);
      for (const sx of [-1, 1]) {
        const horn = new Mesh(new CylinderGeometry(0.03, 0.02, 0.18, 5), mat(C.linen));
        horn.position.set(0.48, 0.7, sx * 0.1);
        horn.rotation.z = sx * 0.4;
        ox.add(horn);
      }
      ox.add(body, oxHead);
      ox.position.set(-w * 0.18, 0, d * 0.34);
      ox.rotation.y = 0.4;
      built.add(ox);
      // The cart itself.
      const cart = new Group();
      const bed = new Mesh(new BoxGeometry(0.7, 0.22, 0.5), trimM);
      bed.position.y = 0.34;
      bed.castShadow = true;
      cart.add(bed);
      for (const sx of [-1, 1]) {
        const wheelM = new Mesh(new CylinderGeometry(0.22, 0.22, 0.06, 10), mat(C.timberDark));
        wheelM.rotation.x = Math.PI / 2;
        wheelM.position.set(0, 0.22, sx * 0.28);
        cart.add(wheelM);
      }
      cart.position.set(w * 0.3, 0, d * 0.3);
      cart.rotation.y = -0.3;
      built.add(cart);
      break;
    }
    case 'tradepost': {
      addBox(built, w, 1.5, d, 0, 0, 0, wallM);
      addRoof(built, w, d, 1.1, 1.5, roofM, true);
      const awn = new Mesh(new BoxGeometry(w * 0.9, 0.06, 0.8), mat(C.terracotta));
      awn.position.set(0, 1.4, d / 2 + 0.35);
      awn.rotation.x = 0.2;
      awn.castShadow = true;
      built.add(awn);
      const scale = new Mesh(new TorusGeometry(0.22, 0.04, 6, 12), mat(C.honey));
      scale.position.set(w * 0.3, 1.8, d * 0.3);
      built.add(scale);
      windows.push(...addWindows(built, 2, w, 0.9, d / 2 + 0.02));
      break;
    }
    case 'quarry':
    case 'claypit':
    case 'mine': {
      const pit = new Mesh(new CylinderGeometry(w * 0.48, w * 0.34, 0.5, 8), mat(def.id === 'claypit' ? 0x9c7350 : C.stoneDark));
      pit.position.y = -0.18;
      pit.receiveShadow = true;
      built.add(pit);
      if (def.id === 'mine') {
        addBox(built, 1.1, 1.5, 0.5, 0, 0.1, -d * 0.35, trimM);
        const mouth = new Mesh(new BoxGeometry(0.7, 1.0, 0.1), mat(0x2a241f));
        mouth.position.set(0, 0.6, -d * 0.35 + 0.28);
        built.add(mouth);
        addRoof(built, 1.4, 0.9, 0.6, 1.6, roofM, true);
      } else {
        for (let i = 0; i < 3; i++) {
          const rock = new Mesh(new IcosahedronGeometry(0.3 + i * 0.06, 0), mat(def.id === 'claypit' ? 0xa87d58 : C.stone));
          rock.position.set((i - 1) * 0.8, 0.24, d * 0.3);
          rock.castShadow = true;
          built.add(rock);
        }
        const cart = addBox(built, 0.6, 0.3, 0.4, w * 0.3, 0.1, -d * 0.3, trimM);
        void cart;
      }
      break;
    }
    default: {
      // The general case: walls, a pitched roof, a door, windows and a chimney.
      const wallH = Math.max(1.1, def.height * 0.62);
      addBox(built, w, wallH, d, 0, 0, 0, wallM);
      if (w > 2.4) addGable(built, w, d, def.height * 0.4, wallH, roofM);
      else addRoof(built, w, d, Math.max(0.7, def.height * 0.42), wallH, roofM, w >= d);

      // Half-timbered cross braces on timber buildings.
      if (def.palette === 'timber' || def.palette === 'thatch') {
        for (const sx of [-1, 1]) {
          const post = new Mesh(new BoxGeometry(0.09, wallH, 0.09), trimM);
          post.position.set(sx * (w / 2 - 0.06), wallH / 2, d / 2 - 0.05);
          built.add(post);
        }
        const beam = new Mesh(new BoxGeometry(w, 0.1, 0.09), trimM);
        beam.position.set(0, wallH * 0.62, d / 2 - 0.05);
        built.add(beam);
      }

      const door = new Mesh(new PlaneGeometry(0.42, 0.72), mat(C.timberDark));
      door.position.set(w * 0.18, 0.36, d / 2 + 0.02);
      built.add(door);
      windows.push(...addWindows(built, w > 2.4 ? 3 : 2, w, wallH * 0.62, d / 2 + 0.02));

      const smokes = b.isHouse || ['bakery', 'kiln', 'smelter', 'blacksmith', 'pottery', 'brewery', 'tannery'].includes(def.id);
      if (smokes) {
        const ch = addBox(built, 0.28, def.height * 0.55, 0.28, -w * 0.28, wallH * 0.6, -d * 0.2, mat(C.clayRed));
        void ch;
      }
      break;
    }
  }

  // Workshop signature props.
  if (def.id === 'woodcutter' || def.id === 'sawpit' || def.id === 'woodshed') {
    for (let i = 0; i < 4; i++) {
      const log = new Mesh(new CylinderGeometry(0.11, 0.11, 0.9, 6), mat(C.timberDark));
      log.rotation.z = Math.PI / 2;
      log.position.set(w * 0.42, 0.12 + (i % 2) * 0.23, -d * 0.3 + Math.floor(i / 2) * 0.26);
      log.castShadow = true;
      built.add(log);
    }
  }
  if (def.id === 'tavern' || def.id === 'brewery') {
    for (let i = 0; i < 2; i++) {
      const barrel = new Mesh(new CylinderGeometry(0.22, 0.22, 0.42, 8), mat(C.timber));
      barrel.position.set(w * 0.38, 0.21, -d * 0.25 + i * 0.5);
      barrel.castShadow = true;
      built.add(barrel);
    }
  }

  // --- Construction site: stacked materials plus a scaffold frame.
  {
    const frameM = mat(C.timber, { transparent: true, opacity: 0.95 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new Mesh(new BoxGeometry(0.09, Math.max(1, def.height * 0.7), 0.09), frameM);
        post.position.set(sx * w / 2, Math.max(1, def.height * 0.7) / 2, sz * d / 2);
        site.add(post);
      }
    }
    const base = new Mesh(new BoxGeometry(w, 0.1, d), mat(C.soil));
    base.position.y = 0.05;
    base.receiveShadow = true;
    site.add(base);
    const stack = new Mesh(new BoxGeometry(w * 0.5, 0.36, d * 0.4), mat(C.timberDark));
    stack.position.set(0, 0.24, 0);
    stack.name = 'materials';
    site.add(stack);
    // Progress fill: a slab that rises as the frame goes up.
    const fill = new Mesh(new BoxGeometry(w * 0.92, 1, d * 0.92), mat(pal.wall, { transparent: true, opacity: 0.55 }));
    fill.name = 'fill';
    fill.position.y = 0;
    fill.scale.y = 0.001;
    site.add(fill);
  }

  // Selection outline.
  const outline = new LineSegments(
    new EdgesGeometry(new BoxGeometry(b.w, 0.06, b.h)),
    new LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95 }),
  );
  outline.position.y = 0.08;
  outline.visible = false;
  root.add(outline);

  built.visible = false;
  site.visible = true;

  return { root, built, site, windows, light, wheel, selection: outline, lastTier: 0, lastState: '' };
}

/** Homes visibly grow as they climb the tiers. */
export function applyTier(v: BuildingVisual, b: Building): void {
  if (!b.isHouse) return;
  const scale = b.tier === 1 ? 1 : b.tier === 2 ? 1.16 : 1.3;
  v.built.scale.set(scale, scale * (b.tier === 3 ? 1.22 : b.tier === 2 ? 1.1 : 1), scale);
  const roofTint = b.tier === 3 ? C.terracotta : b.tier === 2 ? C.thatch : C.thatch;
  v.built.traverse((o) => {
    const m = (o as Mesh).material as MeshLambertMaterial | undefined;
    if (m && m.color && (m.color.getHex() === C.thatch || m.color.getHex() === C.terracotta)) {
      m.color.setHex(roofTint);
    }
  });
}

export function updateBuildingVisual(v: BuildingVisual, b: Building, g: Game, nightGlow: number): void {
  const isBuilt = b.state === 'active';
  if (v.lastState !== b.state) {
    v.lastState = b.state;
    v.built.visible = isBuilt;
    v.site.visible = !isBuilt;
  }

  // The rendered flock samples the real herd — up to twelve on screen, and
  // an empty paddock shows exactly nothing. Only touched when the count
  // moves; getObjectByName every frame would be silly.
  if (b.def.husbandry && isBuilt && v.lastHerd !== b.herd) {
    v.lastHerd = b.herd;
    const show = Math.min(12, b.herd);
    for (let i = 0; i < 12; i++) {
      const sheep = v.built.getObjectByName(`sheep-${i}`);
      if (sheep) sheep.visible = i < show;
    }
  }
  if (!isBuilt) {
    const fill = v.site.getObjectByName('fill') as Mesh | undefined;
    if (fill) {
      const f = Math.max(0.001, b.buildFraction) * Math.max(1, b.def.height * 0.75);
      fill.scale.y = f;
      fill.position.y = f / 2;
    }
    const stack = v.site.getObjectByName('materials') as Mesh | undefined;
    if (stack) {
      let have = 0, want = 0;
      for (const k in b.def.cost) {
        want += (b.def.cost as Record<string, number>)[k] ?? 0;
        have += (b.delivered as Record<string, number>)[k] ?? 0;
      }
      const ratio = want ? have / want : 1;
      stack.scale.set(1, Math.max(0.06, ratio), 1);
      stack.position.y = 0.24 * Math.max(0.06, ratio);
    }
    return;
  }

  if (v.lastTier !== b.tier) { v.lastTier = b.tier; applyTier(v, b); }

  // Windows light up after dark.
  for (const wnd of v.windows) {
    const lit = nightGlow > 0.05 && (b.isHouse ? b.residents.length > 0 : b.workers.length > 0 || b.def.cat === 'decor');
    wnd.material = lit ? windowMat : windowDark;
  }
  if (v.light) v.light.intensity = nightGlow * 2.4;

  if (v.wheel) v.wheel.rotation.z += (0.4 + b.activity * 2.4) * 0.016;

  // The farming year, painted onto the furrows: bare soil, young green rows,
  // ripe gold, stubble as the reapers work through, dormant in winter.
  if (b.def.crop) {
    const dormant = g.season === 'winter' || (!b.sown && b.growth <= 0.01);
    const ripeGold = new Color(0xd9bb84);
    for (const child of v.built.children) {
      if (child.name !== 'croprow') continue;
      const row = child as Mesh;
      const h = dormant ? 0.06 : 0.1 + Math.max(0.02, b.growth) * 0.95;
      row.scale.y = h;
      const m = row.material as MeshLambertMaterial;
      if (dormant) m.color.setHex(0x8a6c4c);
      else m.color.setHex(0x7d9a56).lerp(ripeGold, Math.min(1, b.growth * 1.2));
    }
  }
}

// ---------------------------------------------------------------------------
// Placement ghost
// ---------------------------------------------------------------------------

export function makeGhost(): { root: Group; box: Mesh; ring: Mesh } {
  const root = new Group();
  const box = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({ color: 0x8fd18a, transparent: true, opacity: 0.34, depthWrite: false }),
  );
  root.add(box);
  const ring = new Mesh(
    new RingGeometry(0.9, 1, 48),
    new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.3, side: DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  root.add(ring);
  root.visible = false;
  return { root, box, ring };
}

export function disposeObject(o: Object3D): void {
  o.traverse((c) => {
    const m = c as Mesh;
    if (m.geometry) (m.geometry as BufferGeometry).dispose?.();
    const mm = m.material as Material | Material[] | undefined;
    if (Array.isArray(mm)) mm.forEach((x) => x.dispose?.());
    else mm?.dispose?.();
  });
}

export { Vector3, Color };

// ------------------------------------------------------------------ raiders

/**
 * A rider on foot: hooded, dark, deliberately unlike any villager silhouette.
 * A handful at most walk the map at once, so these are plain meshes rather
 * than instances.
 */
export function makeRaiderMesh(): Group {
  const g = new Group();
  const cloak = new Mesh(new ConeGeometry(0.34, 1.05, 7), mat(0x2e2a33, { flat: true }));
  cloak.position.y = 0.55;
  const hood = new Mesh(new SphereGeometry(0.17, 8, 6), mat(0x241f2b, { flat: true }));
  hood.position.y = 1.08;
  const sack = new Mesh(new SphereGeometry(0.16, 7, 5), mat(0x6b5136, { flat: true }));
  sack.position.set(0, 0.78, -0.26);
  sack.scale.set(1, 0.85, 0.8);
  sack.name = 'sack';
  sack.visible = false;
  g.add(cloak, hood, sack);
  return g;
}
