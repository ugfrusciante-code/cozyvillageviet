/**
 * Terrain generation, tile state and pathfinding. No renderer imports.
 */

import type { NodeKind } from './defs';

export const NODE_KINDS: (NodeKind | 'none')[] = [
  'none', 'tree', 'berry', 'herb', 'stone', 'clay', 'iron', 'game', 'fish', 'flower',
];
export const NODE_INDEX: Record<string, number> = Object.fromEntries(
  NODE_KINDS.map((k, i) => [k, i]),
);

// --------------------------------------------------------------------------
// Deterministic RNG + value noise
// --------------------------------------------------------------------------

export class RNG {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  /** Exposed so a save can resume the exact stream position. */
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0 || 1; }
  next(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]; }
  chance(p: number): boolean { return this.next() < p; }
}

function hash2(x: number, y: number, seed: number): number {
  // Math.imul throughout: plain `*` on 32-bit-sized integers overflows the
  // 53-bit float mantissa and silently destroys the low bits of the hash.
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, -2048144789);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x: number, y: number, seed: number, octaves = 4, lac = 2.05, gain = 0.5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;
}

/**
 * Averaging octaves pulls the result tightly around 0.5, so a raw fbm value
 * almost never crosses a threshold like `> 0.7`. This stretches the contrast
 * back out so thresholds behave the way you would expect.
 */
export function noise(x: number, y: number, seed: number, octaves = 4, contrast = 2.4): number {
  const v = fbm(x, y, seed, octaves);
  return Math.max(0, Math.min(1, 0.5 + (v - 0.5) * contrast));
}

// --------------------------------------------------------------------------
// World
// --------------------------------------------------------------------------

export const WATER_LEVEL = 1.35;

export interface WorldOpts { size?: number; seed?: number }

/**
 * How close to a goal still counts as worth walking toward, in tiles. Below
 * this, a search that cannot reach the goal exactly is still useful: it lands
 * the villager near enough for the work loops to accept them.
 */
const NEAR_ENOUGH = 4;

export class World {
  readonly size: number;
  readonly seed: number;

  readonly height: Float32Array;
  readonly fertility: Float32Array;
  /** Fertility as generated — farming drains toward 0, rest recovers toward this. */
  readonly fertilityBase: Float32Array;
  readonly water: Uint8Array;
  /** Tiles decked over: water a villager can walk across. */
  readonly bridge: Uint8Array;
  /** Index into NODE_KINDS. */
  readonly node: Uint8Array;
  /** Remaining harvests left in this node. */
  readonly nodeAmt: Uint8Array;
  /** Day index at which a depleted node returns; -1 = never. */
  readonly regrowAt: Float32Array;
  /** Building id occupying the tile, or -1. */
  readonly occupied: Int32Array;
  /** 1 if a road runs over this tile. */
  readonly road: Uint8Array;
  /** Occupied but walkable — field, pasture and orchard tiles. */
  readonly softBlock: Uint8Array;
  /** Random per-tile jitter, used by the renderer for prop placement. */
  readonly jitter: Float32Array;

  constructor(opts: WorldOpts = {}) {
    this.size = opts.size ?? 96;
    this.seed = opts.seed ?? 1337;
    const n = this.size * this.size;
    this.height = new Float32Array(n);
    this.fertility = new Float32Array(n);
    this.fertilityBase = new Float32Array(n);
    this.water = new Uint8Array(n);
    this.bridge = new Uint8Array(n);
    this.node = new Uint8Array(n);
    this.nodeAmt = new Uint8Array(n);
    this.regrowAt = new Float32Array(n).fill(-1);
    this.occupied = new Int32Array(n).fill(-1);
    this.road = new Uint8Array(n);
    this.softBlock = new Uint8Array(n);
    this.jitter = new Float32Array(n);
    this.generate();
  }

  idx(x: number, y: number): number { return y * this.size + x; }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }
  heightAt(x: number, y: number): number {
    const xi = Math.max(0, Math.min(this.size - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(this.size - 1, Math.round(y)));
    return this.height[this.idx(xi, yi)];
  }

  private generate(): void {
    const s = this.size, seed = this.seed;
    const rng = new RNG(seed);

    // --- Elevation: rolling hills, a valley floor, and a river carved through.
    const riverPhase = rng.range(0, 6.28);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = this.idx(x, y);
        const nx = x / s, ny = y / s;
        let h = noise(nx * 3.2, ny * 3.2, seed, 5, 2.2) * 7.0;
        // Gentle bowl so the map edges rise into hills and the middle is buildable.
        const dx = nx - 0.5, dy = ny - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        h += d * d * 9.0;
        // Carve a meandering river.
        const river = 0.5 + 0.16 * Math.sin(ny * 7.0 + riverPhase) + 0.08 * Math.sin(ny * 13.0 + seed);
        const rd = Math.abs(nx - river);
        const bank = Math.max(0, 1 - rd / 0.055);
        h -= bank * bank * 3.4;
        this.height[i] = h;
        this.jitter[i] = hash2(x, y, seed + 555);
      }
    }

    // Smooth once to kill single-tile spikes.
    const smoothed = Float32Array.from(this.height);
    for (let y = 1; y < s - 1; y++) {
      for (let x = 1; x < s - 1; x++) {
        const i = this.idx(x, y);
        smoothed[i] = (
          this.height[i] * 4 +
          this.height[i - 1] + this.height[i + 1] +
          this.height[i - s] + this.height[i + s]
        ) / 8;
      }
    }
    this.height.set(smoothed);

    // --- Water + fertility
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = this.idx(x, y);
        this.water[i] = this.height[i] < WATER_LEVEL ? 1 : 0;
        const nx = x / s, ny = y / s;
        const f = noise(nx * 4.5 + 11, ny * 4.5 + 7, seed + 31, 3, 2.2);
        // Fertile land sits low and near the river.
        const lowland = Math.max(0, 1 - Math.max(0, this.height[i] - WATER_LEVEL) / 3.0);
        this.fertility[i] = Math.max(0, Math.min(1, f * 0.65 + lowland * 0.55 - 0.18));
        this.fertilityBase[i] = this.fertility[i];
      }
    }

    // --- Resource nodes
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = this.idx(x, y);
        const nx = x / s, ny = y / s;
        if (this.water[i]) {
          // Fish shoals sit in open water away from the very shoreline.
          if (noise(nx * 9 + 3, ny * 9 + 3, seed + 77, 2) > 0.55 && rng.chance(0.30)) {
            this.setNode(i, 'fish', 8);
          }
          continue;
        }
        const h = this.height[i];
        const forest = noise(nx * 5.0, ny * 5.0, seed + 101, 4, 2.6);
        const rocky = noise(nx * 6.5 + 40, ny * 6.5 + 40, seed + 202, 3, 2.8);
        const oreN = noise(nx * 8.0 + 90, ny * 8.0 + 90, seed + 303, 3, 3.0);
        // Forage clusters: berries, herbs and game gather in glades rather than
        // scattering evenly, so a forager hut has somewhere worth standing.
        const glade = noise(nx * 11 + 60, ny * 11 + 20, seed + 404, 3, 2.8);

        if (forest > 0.50) {
          if (glade > 0.66 && rng.chance(0.34)) this.setNode(i, 'berry', 3);
          else if (glade < 0.34 && rng.chance(0.26)) this.setNode(i, 'herb', 3);
          else if (rng.chance(0.045)) this.setNode(i, 'game', 2);
          else if (rng.chance(0.78)) this.setNode(i, 'tree', 1);
        } else if (this.fertility[i] > 0.42 && glade > 0.70 && rng.chance(0.20)) {
          // Hedgerow berries out on the open ground too.
          this.setNode(i, 'berry', 3);
        } else if (rocky > 0.74 && h > WATER_LEVEL + 1.0 && rng.chance(0.24)) {
          this.setNode(i, 'stone', 14);
        } else if (oreN > 0.80 && h > WATER_LEVEL + 1.4 && rng.chance(0.22)) {
          this.setNode(i, 'iron', 12);
        } else if (h < WATER_LEVEL + 2.6 && noise(nx * 7 + 130, ny * 7 + 130, seed + 505, 3, 2.8) > 0.70 && rng.chance(0.34)) {
          this.setNode(i, 'clay', 10);
        } else if (this.fertility[i] > 0.5 && rng.chance(0.05)) {
          this.setNode(i, 'flower', 1);
        } else if (forest > 0.40 && rng.chance(0.22)) {
          this.setNode(i, 'tree', 1);
        }
      }
    }
  }

  setNode(i: number, kind: NodeKind, amt: number): void {
    this.node[i] = NODE_INDEX[kind];
    this.nodeAmt[i] = amt;
    this.regrowAt[i] = -1;
  }

  clearNode(i: number, regrowDay = -1): void {
    this.node[i] = 0;
    this.nodeAmt[i] = 0;
    this.regrowAt[i] = regrowDay;
  }

  nodeKindAt(i: number): NodeKind | 'none' { return NODE_KINDS[this.node[i]]; }

  /** True if a villager can stand on this tile. */
  walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.water[i] && !this.bridge[i]) return false;
    if (this.occupied[i] >= 0 && !this.road[i] && !this.softBlock[i] && !this.bridge[i]) return false;
    return true;
  }

  // ------------------------------------------------------ walkable regions

  /**
   * Which connected patch of walkable ground each tile belongs to, or -1.
   *
   * The valley is not one connected space: the river cuts it in two, and
   * buildings wall parts of it off. Without this, asking to walk somewhere
   * unreachable costs a full flood-fill of everything you *can* reach before
   * A* gives up — which was 86% of all searches and 97% of simulation time.
   */
  private comp: Int32Array | null = null;
  private compScratch: Int32Array | null = null;

  /**
   * Call after anything that changes which tiles can be stood on: a building
   * going up or coming down, a road being laid, a save being loaded.
   * Relabelling is one pass over the map and happens lazily on next use.
   */
  invalidateRegions(): void { this.comp = null; }

  private labelRegions(): Int32Array {
    const s = this.size, n = s * s;
    const comp = this.comp ?? new Int32Array(n);
    this.compScratch ??= new Int32Array(n);
    const q = this.compScratch;
    comp.fill(-1);

    let nextId = 0;
    for (let start = 0; start < n; start++) {
      if (comp[start] !== -1) continue;
      if (!this.walkable(start % s, (start / s) | 0)) continue;
      const id = nextId++;
      let head = 0, tail = 0;
      q[tail++] = start;
      comp[start] = id;
      while (head < tail) {
        const cur = q[head++];
        const cx = cur % s, cy = (cur / s) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
            const ni = ny * s + nx;
            if (comp[ni] !== -1 || !this.walkable(nx, ny)) continue;
            comp[ni] = id;
            q[tail++] = ni;
          }
        }
      }
    }
    this.comp = comp;
    return comp;
  }

  /** Which walkable region this tile is in, or -1 if it cannot be stood on. */
  regionAt(x: number, y: number): number {
    const comp = this.comp ?? this.labelRegions();
    if (!this.inBounds(x, y)) return -1;
    return comp[this.idx(x, y)];
  }

  /**
   * Could a walk from here to there possibly succeed?
   *
   * Deliberately permissive. It labels regions with plain 8-way adjacency,
   * ignoring the corner-cutting rule A* applies, which can only ever join
   * fewer tiles — so a region is never smaller than what A* can traverse.
   *
   * It also accepts anything within `NEAR_ENOUGH` tiles of the goal, because a
   * failed search is not wasted work: it returns a path to the closest tile it
   * reached, and villagers depend on that. Measured over 40 village-days, the
   * near-misses this preserves land an average of 2.4 tiles from their target,
   * which is inside the radius the work loops accept as "arrived". Refusing
   * them starved three seeds out of three.
   *
   * A false "yes" costs one search we would have run anyway. A false "no"
   * strands a villager, so the bias is entirely one way.
   */
  reachable(sx: number, sy: number, tx: number, ty: number, tolerance = 0): boolean {
    const from = this.regionAt(sx, sy);
    // Standing somewhere unwalkable (just displaced by a new building, say):
    // no useful answer, so let the search decide.
    if (from < 0) return true;
    // A* succeeds on any tile within `tolerance` of the goal, and may step
    // into the goal tile itself even when a building sits on it. Both cases
    // are covered by looking at the goal's neighbourhood.
    const r = Math.max(NEAR_ENOUGH, Math.ceil(tolerance));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (this.regionAt(tx + dx, ty + dy) === from) return true;
      }
    }
    return false;
  }

  /** Movement cost multiplier — roads are cheap, rough ground is not. */
  stepCost(x: number, y: number): number {
    const i = this.idx(x, y);
    if (this.road[i]) return 0.6;
    if (this.bridge[i]) return 0.8; // sound planks, but single file
    if (this.softBlock[i]) return 1.35; // trudging between the furrows
    if (this.node[i] === NODE_INDEX['tree']) return 1.4;
    return 1.0;
  }

  /** Steepness penalty between neighbouring tiles. */
  slopeAt(x: number, y: number): number {
    if (!this.inBounds(x + 1, y) || !this.inBounds(x, y + 1)) return 0;
    const h = this.height[this.idx(x, y)];
    return Math.abs(this.height[this.idx(x + 1, y)] - h) + Math.abs(this.height[this.idx(x, y + 1)] - h);
  }

  /** Every tile within `radius` of (cx,cy) whose node matches `kind`. */
  findNodes(cx: number, cy: number, kind: NodeKind, radius: number, limit = 64): number[] {
    const want = NODE_INDEX[kind];
    const out: number[] = [];
    const r = Math.ceil(radius);
    for (let y = Math.max(0, cy - r); y <= Math.min(this.size - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(this.size - 1, cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const i = this.idx(x, y);
        if (this.node[i] === want && this.nodeAmt[i] > 0) {
          out.push(i);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  isNearWater(cx: number, cy: number, radius = 3): boolean {
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.size - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(this.size - 1, cx + radius); x++) {
        if (this.water[this.idx(x, y)]) return true;
      }
    }
    return false;
  }

  avgFertility(cx: number, cy: number, w: number, h: number): number {
    let sum = 0, n = 0;
    for (let y = cy; y < cy + h; y++) {
      for (let x = cx; x < cx + w; x++) {
        if (!this.inBounds(x, y)) continue;
        sum += this.fertility[this.idx(x, y)]; n++;
      }
    }
    return n ? sum / n : 0;
  }

  /** Flat-enough, dry, unoccupied footprint check. */
  canPlace(cx: number, cy: number, w: number, h: number, maxSlope = 1.6): { ok: boolean; reason?: string } {
    let minH = Infinity, maxH = -Infinity;
    for (let y = cy; y < cy + h; y++) {
      for (let x = cx; x < cx + w; x++) {
        if (!this.inBounds(x, y)) return { ok: false, reason: 'Outside the valley' };
        const i = this.idx(x, y);
        if (this.water[i]) return { ok: false, reason: 'Cannot build on water' };
        if (this.occupied[i] >= 0) return { ok: false, reason: 'Something is already here' };
        const hv = this.height[i];
        if (hv < minH) minH = hv;
        if (hv > maxH) maxH = hv;
      }
    }
    if (maxH - minH > maxSlope) return { ok: false, reason: 'Ground is too steep' };
    return { ok: true };
  }
}

// --------------------------------------------------------------------------
// A* pathfinding
// --------------------------------------------------------------------------

class MinHeap {
  private ids: number[] = [];
  private cost: number[] = [];
  get size(): number { return this.ids.length; }
  clear(): void { this.ids.length = 0; this.cost.length = 0; }
  push(id: number, c: number): void {
    this.ids.push(id); this.cost.push(c);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this.swap(p, i); i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastC = this.cost.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.cost[0] = lastC;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.cost[l] < this.cost[m]) m = l;
        if (r < this.ids.length && this.cost[r] < this.cost[m]) m = r;
        if (m === i) break;
        this.swap(m, i); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    // Plain temporaries, not destructuring. `[x, y] = [y, x]` allocates an
    // array per swap, and a single path search swaps thousands of times.
    const i = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = i;
    const c = this.cost[a]; this.cost[a] = this.cost[b]; this.cost[b] = c;
  }
}

// The eight neighbours, held as three flat arrays rather than an array of
// triples. Destructuring `for (const [dx, dy, base] of DIRS)` allocates on
// every one of the millions of neighbour visits a search makes.
const DIR_X = [1, -1, 0, 0, 1, 1, -1, -1];
const DIR_Y = [0, 0, 1, -1, 1, -1, 1, -1];
const DIR_COST = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

export interface PathPoint { x: number; y: number }

/**
 * Shared scratch buffers so pathfinding allocates nothing per call.
 * One Pathfinder per World.
 */
export class Pathfinder {
  private gScore: Float32Array;
  private came: Int32Array;
  private stamp: Int32Array;
  private open: MinHeap = new MinHeap();
  private run = 0;
  /** Rolling counter so we can budget searches per frame. */
  searches = 0;

  constructor(private world: World) {
    const n = world.size * world.size;
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Int32Array(n).fill(-1);
  }

  /**
   * Path from (sx,sy) to any tile within `tolerance` of (tx,ty).
   * Returns tile centres, start excluded. Null if unreachable.
   */
  find(sx: number, sy: number, tx: number, ty: number, tolerance = 0, maxNodes = 4200): PathPoint[] | null {
    const w = this.world, s = w.size;
    sx = Math.round(sx); sy = Math.round(sy);
    tx = Math.round(tx); ty = Math.round(ty);
    if (!w.inBounds(sx, sy) || !w.inBounds(tx, ty)) return null;
    const startI = w.idx(sx, sy), goalI = w.idx(tx, ty);
    if (startI === goalI) return [];
    // Cheap rejection before the expensive part. Without it, an unreachable
    // target costs a full flood-fill of the reachable map every single time it
    // is asked for — and villagers ask constantly.
    if (!w.reachable(sx, sy, tx, ty, tolerance)) return null;

    this.run++; this.searches++;
    const run = this.run;
    const { gScore, came, stamp, open } = this;
    open.clear();
    stamp[startI] = run; gScore[startI] = 0; came[startI] = -1;
    open.push(startI, 0);

    const tol2 = tolerance * tolerance;
    const heur = (x: number, y: number) => {
      const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
      return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
    };

    let expanded = 0;
    let bestFallback = -1, bestFallbackH = Infinity;

    while (open.size > 0) {
      const cur = open.pop();
      const cx = cur % s, cy = (cur / s) | 0;
      const ddx = cx - tx, ddy = cy - ty;
      const d2 = ddx * ddx + ddy * ddy;
      if (cur === goalI || d2 <= tol2) return this.reconstruct(cur, startI);
      if (++expanded > maxNodes) break;
      if (d2 < bestFallbackH) { bestFallbackH = d2; bestFallback = cur; }

      const gc = gScore[cur];
      for (let d = 0; d < 8; d++) {
        const dx = DIR_X[d], dy = DIR_Y[d], base = DIR_COST[d];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const ni = ny * s + nx;
        // Allow stepping into the goal tile even if a building sits on it.
        const passable = w.walkable(nx, ny) || ni === goalI;
        if (!passable) continue;
        // Prevent cutting diagonally through a blocked corner.
        if (dx !== 0 && dy !== 0) {
          if (!w.walkable(cx + dx, cy) && !w.walkable(cx, cy + dy)) continue;
        }
        const slope = Math.abs(w.height[ni] - w.height[cur]);
        const cost = base * w.stepCost(nx, ny) * (1 + slope * 1.2);
        const ng = gc + cost;
        if (stamp[ni] === run && ng >= gScore[ni]) continue;
        stamp[ni] = run; gScore[ni] = ng; came[ni] = cur;
        open.push(ni, ng + heur(nx, ny) * 1.02);
      }
    }
    // Partial path: get as close as we can rather than freezing the villager.
    if (bestFallback >= 0 && bestFallbackH < Infinity && bestFallback !== startI) {
      return this.reconstruct(bestFallback, startI);
    }
    return null;
  }

  private reconstruct(end: number, start: number): PathPoint[] {
    const s = this.world.size;
    const out: PathPoint[] = [];
    let cur = end;
    let guard = 0;
    while (cur !== start && cur >= 0 && guard++ < 8192) {
      out.push({ x: cur % s, y: (cur / s) | 0 });
      cur = this.came[cur];
    }
    out.reverse();
    return out;
  }
}
