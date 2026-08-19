/**
 * Scene, lighting, sky, terrain, water, vegetation and the RTS camera.
 */

import {
  ACESFilmicToneMapping, BackSide, BufferAttribute, BufferGeometry, Color, ConeGeometry,
  DirectionalLight, DoubleSide, Fog, Group, HemisphereLight,
  IcosahedronGeometry, InstancedMesh, Mesh, MeshLambertMaterial, MeshPhongMaterial,
  MeshStandardMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Points,
  PointsMaterial, Raycaster, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector2,
  Vector3, WebGLRenderer,
} from 'three';

import { C, SEASON_LOOK, skyOfDay } from './palette';
import { buildingVisualHeight } from './entities';
import {
  natureColor, natureMaterialClone, natureProp, scaleToWidth,
  type NatureMaterialName, type NaturePropName,
} from './nature';
import { NODE_INDEX, WATER_LEVEL } from '../sim/world';
import type { Game } from '../sim/game';
import type { Season } from '../sim/defs';

const UP = new Vector3(0, 1, 0);

/**
 * A baked prop standing on the map: one InstancedMesh per material it is made
 * of, all sharing an instance index so a single transform places the whole
 * thing. `used` is how many instances the last refresh wrote.
 */
interface PropSet {
  meshes: InstancedMesh[];
  capacity: number;
  used: number;
}

/**
 * Trees come off a size ladder rather than a species split — the set ships
 * four sizes in two shapes each — and fertile ground grows the bigger ones.
 * Each rung lists its two shapes, its base height in tiles and how much of
 * that height the per-tile jitter adds.
 */
const TREE_LADDER: { shapes: [NaturePropName, NaturePropName]; base: number; vary: number }[] = [
  { shapes: ['tree_sapling_a', 'tree_sapling_b'], base: 1.0, vary: 0.5 },
  { shapes: ['tree_young_a', 'tree_young_b'], base: 1.6, vary: 0.6 },
  { shapes: ['tree_mature_a', 'tree_mature_b'], base: 2.3, vary: 0.9 },
  { shapes: ['tree_elder_a', 'tree_elder_b'], base: 2.9, vary: 0.8 },
];

const BUSHES: NaturePropName[] = ['bush_a', 'bush_b', 'bush_c', 'bush_d'];
const BOULDERS: NaturePropName[] = ['boulder_a', 'boulder_b', 'boulder_c', 'boulder_d', 'boulder_e', 'boulder_f'];
const SANDSTONES: NaturePropName[] = ['sandstone_a', 'sandstone_b', 'sandstone_c', 'sandstone_d'];
const PEBBLES: NaturePropName[] = ['pebble_a', 'pebble_b', 'pebble_c'];
const ORES: NaturePropName[] = ['ore_iron_a', 'ore_iron_b'];
const STUMPS: NaturePropName[] = ['stump_a', 'stump_b'];

/**
 * A stable 0..1 value per tile and salt. The world's own jitter is one sample
 * per tile, and folding it by different multipliers to get "more" randomness
 * correlates the results: gate on `(j * 31) % 1 < 0.06` and the survivors all
 * share a structure that `(j * 127) % 1` can still see. Salting an integer
 * hash of the tile index instead keeps the draws independent.
 */
function hash01(tile: number, salt: number): number {
  let h = Math.imul(tile | 0, 374761393) + Math.imul(salt | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Picks an entry from a variant list. */
const pick = <T,>(list: T[], tile: number, salt: number): T =>
  list[Math.min(list.length - 1, Math.floor(hash01(tile, salt) * list.length))];

export class View {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private skyMesh: Mesh;
  private skyMat: ShaderMaterial;

  private terrain!: Mesh;
  private terrainGeo!: BufferGeometry;
  private baseColors!: Float32Array;
  private water!: Mesh;

  /** Baked nature props, keyed by name; see `buildVegetation`. */
  private sets = new Map<NaturePropName, PropSet>();
  /** One live material per MTL entry, so the season can recolour them. */
  private natMats = new Map<NatureMaterialName, MeshPhongMaterial>();
  private tufts!: InstancedMesh;
  private flowers!: InstancedMesh;
  private reeds!: InstancedMesh;
  /** Allocated instance counts; `count` is lowered to the live draw each refresh. */
  private groundCaps = { tuft: 0, flower: 0, reed: 0 };

  /** Camera focus point on the ground. */
  target = new Vector3(48, 0, 48);
  private distance = 30;
  private yaw = Math.PI * 0.25;
  private pitch = 0.82;

  private raycaster = new Raycaster();
  private season: Season = 'spring';

  readonly propRoot = new Group();
  private smoke!: Points;
  private smokeVel!: Float32Array;
  private smokeLife!: Float32Array;

  constructor(private canvas: HTMLCanvasElement, private game: Game) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.camera = new PerspectiveCamera(46, 1, 0.5, 620);
    this.scene.fog = new Fog(C.cream, 60, 260);

    this.hemi = new HemisphereLight(0xbdd4e8, 0x8e8467, 1.0);
    this.scene.add(this.hemi);

    this.sun = new DirectionalLight(0xfff2d8, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    const s = 62;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // --- Sky dome
    this.skyMat = new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new Color(0x77aede) },
        bottomColor: { value: new Color(0xd8e8f2) },
        offset: { value: 12 },
        exponent: { value: 0.75 },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 bottomColor;
        uniform float offset; uniform float exponent;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), exponent)), 1.0);
        }`,
    });
    this.skyMesh = new Mesh(new SphereGeometry(320, 24, 16), this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this.scene.add(this.propRoot);
    this.buildTerrain();
    this.buildWater();
    this.buildVegetation();
    this.buildSmoke();
    this.buildWeather();

    this.target.set(game.startX, 0, game.startY);
    this.resize();
  }

  // -------------------------------------------------------------- terrain

  private buildTerrain(): void {
    const w = this.game.world;
    const n = w.size;
    // Indexed grid with shared vertices: computeVertexNormals then averages
    // face normals, which is what turns hard low-poly facets into the rolling,
    // softly lit meadows the reference games have.
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const o = (y * n + x) * 3;
        positions[o] = x;
        positions[o + 1] = w.height[w.idx(x, y)];
        positions[o + 2] = y;
      }
    }
    const index = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x, b = a + 1, c = a + n, d = a + n + 1;
        index[q++] = a; index[q++] = c; index[q++] = b;
        index[q++] = b; index[q++] = c; index[q++] = d;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.setIndex(new BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terrainGeo = geo;
    this.baseColors = colors;
    const mat = new MeshLambertMaterial({ vertexColors: true });
    this.terrain = new Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    this.scene.add(this.terrain);
    this.paintTerrain('spring');
  }

  /** Data overlay painted into the ground: none, soil fertility, or charm. */
  overlay: 'none' | 'fertility' | 'charm' = 'none';

  setOverlay(mode: 'none' | 'fertility' | 'charm'): void {
    this.overlay = mode;
    this.paintTerrain(this.season);
  }

  /** Recolour the ground for a season. Cheap enough to do on season change. */
  paintTerrain(season: Season): void {
    const w = this.game.world;
    const n = w.size;
    const look = SEASON_LOOK[season];
    const colors = this.baseColors;
    const tmp = new Color();
    const rock = new Color(C.stone);
    const sandC = new Color(C.sand);
    const soilC = new Color(C.soil);
    const heatLow = new Color(0x8a4a3a);
    const heatHigh = new Color(0x6fd18a);

    // Charm overlay needs a per-tile pass over every emitter — do it once.
    let charmMap: Float32Array | null = null;
    if (this.overlay === 'charm') {
      charmMap = new Float32Array(n * n);
      for (const b of this.game.buildings.values()) {
        if (b.state !== 'active' || !b.def.charm) continue;
        const r = b.def.charmRadius ?? 10;
        const x0 = Math.max(0, Math.floor(b.cx - r)), x1 = Math.min(n - 1, Math.ceil(b.cx + r));
        const y0 = Math.max(0, Math.floor(b.cy - r)), y1 = Math.min(n - 1, Math.ceil(b.cy + r));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const d = Math.hypot(b.cx - x, b.cy - y);
            if (d <= r) charmMap[y * n + x] += b.def.charm * (1 - d / r);
          }
        }
      }
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = w.idx(x, y);
        const height = w.height[i];
        const fert = w.fertility[i];
        const slope = Math.min(1, w.slopeAt(x, y) / 3.2);
        const jit = (w.jitter[i] - 0.5) * 0.05;

        tmp.copy(look.grassDeep).lerp(look.grass, Math.min(1, fert * 1.5 + 0.15));
        // Bare rock on steep ground, damp sand at the waterline.
        tmp.lerp(rock, Math.min(0.55, slope * 0.62));
        const shore = Math.max(0, 1 - Math.abs(height - WATER_LEVEL) / 0.85);
        tmp.lerp(sandC, shore * 0.55);
        if (w.road[i]) tmp.lerp(soilC, 0.8);
        tmp.offsetHSL(0, 0, jit);

        if (this.overlay === 'fertility' && !w.water[i]) {
          tmp.lerp(fert > 0.5 ? heatHigh : heatLow, 0.35 + Math.abs(fert - 0.5) * 0.5);
        } else if (charmMap && !w.water[i]) {
          const c = Math.min(1, charmMap[y * n + x] / 24);
          tmp.lerp(heatHigh, c * 0.6);
          if (charmMap[y * n + x] < 0.5) tmp.lerp(heatLow, 0.12);
        }

        const o = (y * n + x) * 3;
        colors[o] = tmp.r; colors[o + 1] = tmp.g; colors[o + 2] = tmp.b;
      }
    }
    (this.terrainGeo.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  /** Repaint just the tiles a road was drawn on. */
  markTerrainDirty(): void { this.paintTerrain(this.season); }

  private buildWater(): void {
    const n = this.game.world.size;
    const geo = new PlaneGeometry(n * 1.4, n * 1.4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshStandardMaterial({
      color: C.water, transparent: true, opacity: 0.88,
      roughness: 0.18, metalness: 0.05, side: DoubleSide,
    });
    this.water = new Mesh(geo, mat);
    this.water.position.set(n / 2, WATER_LEVEL - 0.06, n / 2);
    this.water.receiveShadow = false;
    this.scene.add(this.water);
  }

  // ----------------------------------------------------------- vegetation

  /** One live material per MTL entry, shared by every prop that uses it. */
  private natMat(name: NatureMaterialName): MeshPhongMaterial {
    let m = this.natMats.get(name);
    if (!m) { m = natureMaterialClone(name); this.natMats.set(name, m); }
    return m;
  }

  /**
   * Registers a baked prop: one InstancedMesh per material it is made of, all
   * indexed together so a single matrix places the whole prop.
   */
  private propSet(name: NaturePropName, capacity: number, castShadow = true): void {
    const meshes = natureProp(name).map(({ material, geometry }) => {
      const m = new InstancedMesh(geometry, this.natMat(material), capacity);
      m.castShadow = castShadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.propRoot.add(m);
      return m;
    });
    this.sets.set(name, { meshes, capacity, used: 0 });
  }

  /** Stamps the dummy's transform into every mesh of a prop. */
  private place(name: NaturePropName, dummy: Object3D): void {
    const set = this.sets.get(name);
    if (!set || set.used >= set.capacity) return;
    dummy.updateMatrix();
    for (const m of set.meshes) m.setMatrixAt(set.used, dummy.matrix);
    set.used++;
  }

  private buildVegetation(): void {
    const w = this.game.world;

    const count = (kind: string) => {
      let c = 0;
      for (let i = 0; i < w.node.length; i++) if (w.node[i] === NODE_INDEX[kind]) c++;
      return c;
    };

    // Headroom on every cap: the forester plants, the woodcutter fells, and
    // refreshProps is expected to cope without reallocating.
    const treeCap = Math.max(64, count('tree') + 900);
    // Any one rung can take a good share of the forest, so each shape gets
    // room for far more than its average draw rather than the exact split.
    for (const rung of TREE_LADDER) {
      const big = rung.base >= 2.3;
      for (const shape of rung.shapes) this.propSet(shape, Math.ceil(treeCap * 0.42) + 24, big);
    }

    const bushCap = Math.max(24, Math.ceil((count('berry') + count('herb') + count('flower') + count('game')) * 0.6) + 40);
    for (const b of BUSHES) this.propSet(b, bushCap, false);

    const rockCap = Math.max(16, Math.ceil(count('stone') * 0.4) + 20);
    for (const b of BOULDERS) this.propSet(b, rockCap);
    const oreCap = Math.max(16, Math.ceil(count('iron') * 0.7) + 20);
    for (const o of ORES) this.propSet(o, oreCap);

    // Clay reads as a patch of dark spoil with fired-looking lumps on it.
    const clayCap = Math.max(16, count('clay') + 20);
    this.propSet('soil_pad', clayCap, false);
    this.propSet('brick', clayCap, false);

    // Wilderness dressing. None of this is a resource node — it is scattered
    // straight off the terrain so the rest of the material set actually shows
    // up in the valley instead of only on the sample sheet.
    for (const p of PEBBLES) this.propSet(p, 420, false);
    for (const s of SANDSTONES) this.propSet(s, 140);
    for (const s of STUMPS) this.propSet(s, 90, false);
    this.propSet('slate', 260);
    this.propSet('quartz', 96);
    this.propSet('coal', 90, false);
    this.propSet('ore_copper', Math.max(16, Math.ceil(count('iron') * 0.5) + 20));
    this.propSet('scrap_a', 48, false);
    this.propSet('pot', 48, false);

    // Ground cover: grass tufts and wildflowers scattered over fertile open
    // ground. Pure set dressing, but it is most of what "lush" means.
    const tuftG = new ConeGeometry(0.1, 0.34, 4);
    tuftG.translate(0, 0.15, 0);
    this.tufts = new InstancedMesh(
      tuftG, new MeshLambertMaterial({ color: natureColor('foliage_moss').clone(), flatShading: true }), 3200,
    );
    this.tufts.receiveShadow = true;
    const flowerG = new IcosahedronGeometry(0.075, 0);
    flowerG.translate(0, 0.14, 0);
    this.flowers = new InstancedMesh(
      flowerG, new MeshLambertMaterial({ flatShading: true }), 700,
    );
    const reedGeo = new ConeGeometry(0.16, 0.9, 4);
    reedGeo.translate(0, 0.45, 0);
    this.reeds = new InstancedMesh(
      reedGeo, new MeshLambertMaterial({ color: natureColor('foliage_moss').clone(), flatShading: true }),
      Math.max(16, count('fish') + 20),
    );
    this.reeds.castShadow = true;
    this.reeds.receiveShadow = true;
    for (const m of [this.tufts, this.flowers, this.reeds]) {
      m.frustumCulled = false;
      this.propRoot.add(m);
    }
    this.groundCaps = { tuft: this.tufts.count, flower: this.flowers.count, reed: this.reeds.count };

    this.applySeasonToNature();
    this.refreshProps();
  }

  /** How steep the ground is at a tile — used to decide where rock shows. */
  private slopeAt(i: number): number {
    const w = this.game.world, s = w.size;
    const x = i % s, y = (i / s) | 0;
    const h = w.height[i];
    const e = w.height[x + 1 < s ? i + 1 : i], n = w.height[y + 1 < s ? i + s : i];
    return Math.abs(e - h) + Math.abs(n - h);
  }

  /** Rebuild every instanced prop from the world grid. */
  refreshProps(): void {
    const w = this.game.world;
    const dummy = new Object3D();
    for (const set of this.sets.values()) set.used = 0;
    let tuft = 0, flower = 0, reed = 0;
    const flowerPalette = [0xd96a7a, 0xe8b44a, 0xc98ad4, 0xe57f5a, 0xf0e6c8];
    const flowerColor = new Color();

    for (let i = 0; i < w.node.length; i++) {
      const kind = w.node[i];
      const x = i % w.size, y = (i / w.size) | 0;
      const j = w.jitter[i];
      const px = x + 0.5 + (j - 0.5) * 0.55;
      const pz = y + 0.5 + ((j * 7.3) % 1 - 0.5) * 0.55;
      const py = w.height[i];
      const free = !w.water[i] && w.occupied[i] < 0 && !w.road[i];

      // Ground cover and mineral dressing live on open, unbuilt ground.
      if (kind === 0) {
        if (!free) continue;
        const fert = w.fertility[i];
        const hash = hash01(i, 11);

        if (fert > 0.34) {
          if (hash < 0.5 && tuft < this.groundCaps.tuft) {
            dummy.position.set(px, py, pz);
            dummy.rotation.set(0, j * 6.28, 0);
            dummy.scale.setScalar(0.75 + hash * 0.9);
            dummy.updateMatrix();
            this.tufts.setMatrixAt(tuft++, dummy.matrix);
          }
          const hash2v = hash01(i, 12);
          if (hash2v > 0.9 && fert > 0.45 && flower < this.groundCaps.flower) {
            dummy.position.set(x + 0.5 + (hash2v - 0.95) * 6, py, pz);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.setScalar(0.8 + hash * 0.6);
            dummy.updateMatrix();
            this.flowers.setMatrixAt(flower, dummy.matrix);
            flowerColor.setHex(pick(flowerPalette, i, 13));
            this.flowers.setColorAt(flower, flowerColor);
            flower++;
          }
        }
        this.scatterMinerals(i, px, py, pz, j, fert, dummy);
        continue;
      }

      if (!free && kind !== NODE_INDEX['fish']) continue;

      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, j * Math.PI * 2, 0);
      dummy.scale.setScalar(1);

      if (kind === NODE_INDEX['tree']) {
        // Fertile ground pushes a tile up the size ladder; the jitter decides
        // the rest, so a wood grades from saplings on the ridge to elders in
        // the bottoms instead of being uniformly tall.
        const t = Math.min(0.999, hash01(i, 21) * 0.72 + w.fertility[i] * 0.45);
        const rung = TREE_LADDER[t < 0.26 ? 0 : t < 0.56 ? 1 : t < 0.82 ? 2 : 3];
        const shape = rung.shapes[hash01(i, 22) < 0.5 ? 0 : 1];
        const h = rung.base + hash01(i, 23) * rung.vary;
        const spread = 0.88 + hash01(i, 24) * 0.3;
        dummy.scale.set(h * spread, h, h * spread);
        this.place(shape, dummy);
      } else if (
        kind === NODE_INDEX['berry'] || kind === NODE_INDEX['herb']
        || kind === NODE_INDEX['flower'] || kind === NODE_INDEX['game']
      ) {
        const bush = pick(BUSHES, i, 31);
        const h = (kind === NODE_INDEX['flower'] ? 0.3 : 0.5) + hash01(i, 32) * 0.28;
        dummy.scale.setScalar(h);
        this.place(bush, dummy);
      } else if (kind === NODE_INDEX['stone']) {
        const rock = pick(BOULDERS, i, 41);
        dummy.scale.setScalar(0.5 + hash01(i, 42) * 0.5);
        this.place(rock, dummy);
      } else if (kind === NODE_INDEX['iron']) {
        dummy.scale.setScalar(0.45 + hash01(i, 51) * 0.35);
        this.place(pick(ORES, i, 52), dummy);
        // Green copper shows on about a third of the seams.
        if (hash01(i, 53) < 0.34) {
          dummy.scale.setScalar(0.3 + hash01(i, 54) * 0.2);
          this.place('ore_copper', dummy);
        }
      } else if (kind === NODE_INDEX['clay']) {
        // A pad of spoil with fired-looking lumps on it. The pad has no
        // thickness, so it rides a hair above the ground to stay out of the
        // terrain on a slope.
        dummy.position.y = py + 0.03;
        dummy.scale.setScalar(scaleToWidth('soil_pad', 0.8 + hash01(i, 61) * 0.35));
        this.place('soil_pad', dummy);
        dummy.position.y = py + 0.05;
        dummy.scale.setScalar(scaleToWidth('brick', 0.45 + hash01(i, 62) * 0.22));
        this.place('brick', dummy);
      } else if (kind === NODE_INDEX['fish'] && reed < this.groundCaps.reed) {
        dummy.position.y = WATER_LEVEL - 0.1;
        dummy.scale.setScalar(0.8 + j * 0.4);
        dummy.updateMatrix();
        this.reeds.setMatrixAt(reed++, dummy.matrix);
      }
    }

    for (const set of this.sets.values()) {
      for (const m of set.meshes) { m.count = set.used; m.instanceMatrix.needsUpdate = true; }
    }
    this.tufts.count = tuft;
    this.flowers.count = flower;
    this.reeds.count = reed;
    for (const m of [this.tufts, this.flowers, this.reeds]) m.instanceMatrix.needsUpdate = true;
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
  }

  /**
   * Rock, ore and the odd bit of village litter, scattered off the terrain
   * rather than off the simulation. Nothing here is harvestable; it exists so
   * the valley shows the whole material set and so bare ground reads as bare
   * ground rather than as untextured grass.
   */
  private scatterMinerals(
    i: number, px: number, py: number, pz: number, j: number, fert: number, dummy: Object3D,
  ): void {
    const w = this.game.world;
    const slope = this.slopeAt(i);
    const high = w.height[i] - WATER_LEVEL;
    dummy.position.set(px, py, pz);
    dummy.rotation.set(0, j * Math.PI * 2, 0);

    // Rarest first: each tile gets at most one of these, so anything checked
    // late only ever lands where nothing earlier claimed the ground.

    // The rare rusted tool or broken pot, where someone worked this before you.
    if (hash01(i, 71) < 0.004) {
      const litter: NaturePropName = hash01(i, 72) < 0.5 ? 'scrap_a' : 'pot';
      dummy.scale.setScalar(scaleToWidth(litter, 0.26 + hash01(i, 73) * 0.12));
      this.place(litter, dummy);
      return;
    }
    // Quartz only up on the tops.
    if (high > 4.5 && hash01(i, 74) < 0.02) {
      dummy.scale.setScalar(0.3 + hash01(i, 75) * 0.25);
      this.place('quartz', dummy);
      return;
    }
    // A felled stump here and there in the woodland fringes.
    if (fert > 0.42 && hash01(i, 76) < 0.014) {
      const s = pick(STUMPS, i, 77);
      dummy.scale.setScalar(scaleToWidth(s, 0.5 + hash01(i, 78) * 0.18));
      this.place(s, dummy);
      return;
    }
    // Coal shows through the sour ground below the crags.
    if (fert < 0.22 && hash01(i, 79) < 0.016) {
      dummy.scale.setScalar(scaleToWidth('coal', 0.5 + hash01(i, 80) * 0.35));
      this.place('coal', dummy);
      return;
    }
    // Slate breaks out of steep ground, sandstone off dry shoulders.
    if (slope > 0.55 && hash01(i, 81) < 0.05) {
      dummy.scale.setScalar(scaleToWidth('slate', 0.5 + hash01(i, 82) * 0.4));
      this.place('slate', dummy);
      return;
    }
    if (slope > 0.32 && fert < 0.34 && hash01(i, 83) < 0.035) {
      const s = pick(SANDSTONES, i, 84);
      dummy.scale.setScalar(scaleToWidth(s, 0.45 + hash01(i, 85) * 0.35));
      this.place(s, dummy);
      return;
    }
    // Loose chippings on thin, dry soil — the commonest and the smallest.
    if (fert < 0.4 && hash01(i, 86) < 0.06) {
      const p = pick(PEBBLES, i, 87);
      dummy.scale.setScalar(scaleToWidth(p, 0.2 + hash01(i, 88) * 0.16));
      this.place(p, dummy);
    }
  }

  /**
   * Pushes the season onto the nature materials. The canopy carries most of
   * it: `foliage_dark` turns rust and `foliage_moss` turns gold in autumn, and
   * both take a dusting of snow in winter along with the exposed rock.
   */
  private applySeasonToNature(): void {
    const look = SEASON_LOOK[this.season];
    const winter = this.season === 'winter';
    const autumn = this.season === 'autumn';
    const snow = new Color(0xe8edf2);

    const tint = (
      name: NatureMaterialName, toward: Color, amount: number, snowAmount: number,
    ) => {
      const m = this.natMats.get(name);
      if (!m) return;
      m.color.copy(natureColor(name)).lerp(toward, amount);
      if (winter && snowAmount > 0) m.color.lerp(snow, snowAmount);
    };

    tint('foliage_dark', autumn ? new Color(0xb4602c) : look.foliage, autumn ? 0.6 : 0.5, 0.3);
    tint('foliage_moss', autumn ? new Color(0xd39a3f) : look.foliageAlt, autumn ? 0.62 : 0.5, 0.5);
    tint('timber_frame', new Color(C.timberDark), 0.15, 0.12);
    for (const rock of ['stone_warm_grey', 'stone_slate', 'stone_sand', 'soil_dark'] as NatureMaterialName[]) {
      tint(rock, natureColor(rock), 0, 0.34);
    }

    if (this.tufts) {
      (this.tufts.material as MeshLambertMaterial).color
        .copy(natureColor('foliage_moss')).lerp(snow, winter ? 0.75 : autumn ? 0.2 : 0);
      this.tufts.visible = !winter;
    }
    if (this.reeds) {
      (this.reeds.material as MeshLambertMaterial).color
        .copy(natureColor('foliage_moss')).lerp(new Color(0xbaa96a), autumn || winter ? 0.5 : 0);
    }
    if (this.flowers) this.flowers.visible = this.season === 'spring' || this.season === 'summer';
  }

  // -------------------------------------------------------------- weather

  private weather!: Points;
  private weatherVel!: Float32Array;
  private clouds: Mesh[] = [];
  /** 0 = clear, 1 = snowing/raining. Eased so showers roll in and out. */
  private precip = 0;

  private buildWeather(): void {
    const N = 900;
    const pos = new Float32Array(N * 3);
    this.weatherVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] = -999;
      this.weatherVel[i] = 3 + Math.random() * 3;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new PointsMaterial({
      color: 0xffffff, size: 0.14, transparent: true, opacity: 0.7,
      depthWrite: false, sizeAttenuation: true,
    });
    this.weather = new Points(geo, mat);
    this.weather.frustumCulled = false;
    this.scene.add(this.weather);

    // A few fair-weather clouds drifting over the valley.
    const cloudMat = new MeshLambertMaterial({
      color: 0xf6f4ef, transparent: true, opacity: 0.82, flatShading: true,
    });
    const n = this.game.world.size;
    for (let c = 0; c < 9; c++) {
      const cloud = new Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const puff = new Mesh(new IcosahedronGeometry(2.2 + Math.random() * 2.4, 0), cloudMat);
        puff.scale.set(1.6, 0.55, 1);
        puff.position.set(p * 2.6 + Math.random() * 1.4, Math.random() * 0.8, Math.random() * 2.2);
        cloud.add(puff);
      }
      cloud.position.set(Math.random() * n, 34 + Math.random() * 10, Math.random() * n);
      (cloud as unknown as { driftSpeed: number }).driftSpeed = 0.35 + Math.random() * 0.5;
      this.scene.add(cloud);
      this.clouds.push(cloud as unknown as Mesh);
    }
  }

  /** Is today a wet day? Deterministic per game day so saves/reloads agree. */
  private isWetDay(): boolean {
    const g = this.game;
    if (g.season === 'winter') return true; // it snows most winter days
    if (g.season === 'summer') return false;
    const h = Math.imul(g.day ^ 0x9e37, 2654435761) >>> 0;
    return (h % 100) < 38; // spring & autumn showers
  }

  private updateWeather(dt: number): void {
    const g = this.game;
    const winter = g.season === 'winter';
    const wet = this.isWetDay();
    this.precip += ((wet ? 1 : 0) - this.precip) * Math.min(1, dt * 0.25);

    const mat = this.weather.material as PointsMaterial;
    mat.color.setHex(winter ? 0xffffff : 0x9fb6c8);
    mat.size = winter ? 0.16 : 0.1;
    mat.opacity = 0.65 * this.precip;
    this.weather.visible = this.precip > 0.03;
    if (!this.weather.visible) return;

    const pos = this.weather.geometry.getAttribute('position') as BufferAttribute;
    const cx = this.target.x, cz = this.target.z;
    const R = 34;
    const active = Math.floor(pos.count * this.precip);
    for (let i = 0; i < active; i++) {
      let y = pos.getY(i);
      if (y < -100) {
        // Spawn in a disc above the camera focus.
        pos.setXYZ(i, cx + (Math.random() - 0.5) * R * 2, 16 + Math.random() * 10, cz + (Math.random() - 0.5) * R * 2);
        continue;
      }
      const speed = winter ? this.weatherVel[i] * 0.55 : this.weatherVel[i] * 3.2;
      y -= speed * dt;
      let x = pos.getX(i);
      if (winter) x += Math.sin(g.t * 1.3 + i) * dt * 0.6; // snow drifts
      const ground = this.game.world.heightAt(x, pos.getZ(i));
      if (y <= ground) {
        pos.setXYZ(i, cx + (Math.random() - 0.5) * R * 2, 16 + Math.random() * 10, cz + (Math.random() - 0.5) * R * 2);
      } else {
        pos.setX(i, x);
        pos.setY(i, y);
      }
    }
    // Park the inactive tail.
    for (let i = active; i < pos.count; i++) if (pos.getY(i) > -100) pos.setY(i, -999);
    pos.needsUpdate = true;
  }

  private updateClouds(dt: number): void {
    const n = this.game.world.size;
    for (const cloud of this.clouds) {
      const speed = (cloud as unknown as { driftSpeed: number }).driftSpeed;
      cloud.position.x += speed * dt;
      if (cloud.position.x > n + 14) cloud.position.x = -14;
    }
  }

  // ---------------------------------------------------------------- smoke

  private buildSmoke(): void {
    const N = 320;
    const pos = new Float32Array(N * 3);
    this.smokeVel = new Float32Array(N * 3);
    this.smokeLife = new Float32Array(N);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -999;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new PointsMaterial({
      color: 0xf2e6d6, size: 0.85, transparent: true, opacity: 0.34,
      depthWrite: false, sizeAttenuation: true,
    });
    this.smoke = new Points(geo, mat);
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
  }

  private emitSmoke(x: number, y: number, z: number): void {
    const pos = this.smoke.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < this.smokeLife.length; i++) {
      if (this.smokeLife[i] > 0) continue;
      this.smokeLife[i] = 2.4 + Math.random() * 1.6;
      pos.setXYZ(i, x + (Math.random() - 0.5) * 0.2, y, z + (Math.random() - 0.5) * 0.2);
      this.smokeVel[i * 3] = (Math.random() - 0.5) * 0.18;
      this.smokeVel[i * 3 + 1] = 0.5 + Math.random() * 0.35;
      this.smokeVel[i * 3 + 2] = (Math.random() - 0.5) * 0.18;
      return;
    }
  }

  private smokeTimer = 0;

  private updateSmoke(dt: number): void {
    const pos = this.smoke.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < this.smokeLife.length; i++) {
      if (this.smokeLife[i] <= 0) continue;
      this.smokeLife[i] -= dt;
      if (this.smokeLife[i] <= 0) { pos.setY(i, -999); continue; }
      pos.setXYZ(
        i,
        pos.getX(i) + this.smokeVel[i * 3] * dt,
        pos.getY(i) + this.smokeVel[i * 3 + 1] * dt,
        pos.getZ(i) + this.smokeVel[i * 3 + 2] * dt,
      );
      this.smokeVel[i * 3 + 1] *= 1 - dt * 0.25;
    }
    pos.needsUpdate = true;

    // Chimneys puff while the village is awake and warm.
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.16;
      const chimneys: { x: number; y: number; z: number }[] = [];
      for (const b of this.game.buildings.values()) {
        if (b.state !== 'active') continue;
        const smokes = b.isHouse || b.defId === 'bakery' || b.defId === 'kiln'
          || b.defId === 'smelter' || b.defId === 'blacksmith' || b.defId === 'pottery';
        if (!smokes) continue;
        if (b.isHouse && this.game.season !== 'winter' && !this.game.isNight) continue;
        if (!b.isHouse && b.activity < 0.05) continue;
        chimneys.push({ x: b.cx + 0.5, y: b.groundY + buildingVisualHeight(b) + 0.7, z: b.cy + 0.4 });
      }
      if (chimneys.length) {
        const c = chimneys[Math.floor(Math.random() * chimneys.length)];
        this.emitSmoke(c.x, c.y, c.z);
      }
    }
  }

  // --------------------------------------------------------------- camera

  panBy(dx: number, dz: number): void {
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const scale = this.distance * 0.0016;
    this.target.x += (dx * cos - dz * sin) * scale;
    this.target.z += (dx * sin + dz * cos) * scale;
    this.clampTarget();
  }

  panWorld(dx: number, dz: number): void {
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    this.target.x += dx * cos - dz * sin;
    this.target.z += dx * sin + dz * cos;
    this.clampTarget();
  }

  rotateBy(d: number): void { this.yaw += d; }
  get yawAngle(): number { return this.yaw; }
  pitchBy(d: number): void {
    this.pitch = Math.max(0.34, Math.min(1.42, this.pitch + d));
  }
  zoomBy(d: number): void {
    this.distance = Math.max(12, Math.min(140, this.distance * (1 + d)));
  }
  get zoom(): number { return this.distance; }

  focusOn(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.clampTarget();
  }

  private clampTarget(): void {
    const n = this.game.world.size;
    this.target.x = Math.max(2, Math.min(n - 2, this.target.x));
    this.target.z = Math.max(2, Math.min(n - 2, this.target.z));
    this.target.y = this.game.world.heightAt(this.target.x, this.target.z);
  }

  private updateCamera(): void {
    const d = this.distance;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * d,
      this.target.y + sp * d,
      this.target.z + Math.cos(this.yaw) * cp * d,
    );
    this.camera.lookAt(this.target);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Ground tile under a screen point, or null. */
  pickTile(ndc: Vector2): { x: number; y: number } | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (hit) return { x: Math.floor(hit.point.x), y: Math.floor(hit.point.z) };
    // Fall back to the water plane so the cursor still reads a position.
    const hit2 = this.raycaster.intersectObject(this.water, false)[0];
    if (hit2) return { x: Math.floor(hit2.point.x), y: Math.floor(hit2.point.z) };
    return null;
  }

  /** A raycaster already aimed through the given screen point. */
  raycasterFor(ndc: Vector2): Raycaster {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  raycastObjects(ndc: Vector2, objects: Object3D[]): Object3D | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(objects, true);
    return hits.length ? hits[0].object : null;
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    const g = this.game;

    if (g.season !== this.season) {
      this.season = g.season;
      this.paintTerrain(this.season);
      this.applySeasonToNature();
    }

    this.updateWeather(dt);
    this.updateClouds(dt);

    // Sun arc + sky colours.
    const t = g.dayFraction;
    const sky = skyOfDay(t);
    this.skyMat.uniforms.topColor.value.copy(sky.top);
    this.skyMat.uniforms.bottomColor.value.copy(sky.bottom);
    (this.scene.fog as Fog).color.copy(sky.fog);
    this.renderer.setClearColor(sky.fog);

    const sunAngle = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(sunAngle);
    const azim = Math.cos(sunAngle);
    this.sun.position.set(
      this.target.x + azim * 70,
      Math.max(6, elev * 80 + 12),
      this.target.z + 42,
    );
    this.sun.target.position.copy(this.target);
    this.sun.color.copy(sky.sun);
    this.sun.intensity = sky.sunIntensity;
    this.hemi.color.copy(sky.ambient);
    this.hemi.groundColor.copy(sky.ground);
    this.hemi.intensity = sky.ambientIntensity;

    const fogNear = this.distance * 1.2 + 24;
    (this.scene.fog as Fog).near = fogNear;
    (this.scene.fog as Fog).far = fogNear + 190;

    // Water shimmer.
    const wm = this.water.material as MeshStandardMaterial;
    wm.color.copy(new Color(C.waterDeep)).lerp(new Color(C.water), 0.5 + Math.sin(g.t * 0.5) * 0.12);
    this.water.position.y = WATER_LEVEL - 0.06 + Math.sin(g.t * 0.9) * 0.012;

    this.updateSmoke(dt);
    this.skyMesh.position.copy(this.camera.position);
    this.updateCamera();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

}

export { UP };
