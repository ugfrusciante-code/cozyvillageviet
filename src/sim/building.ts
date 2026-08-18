/**
 * A placed building instance: construction, production, storage, housing state.
 */

import {
  type Amounts, type BuildingDef, type CropType, type CropVariety, type ResId, type ServiceKind,
  BUILDING_BY_ID, CROPS, HOUSE_TIERS, MONOCULTURE_PENALTY, RESOURCES, ROTATION_BONUS,
} from './defs';
import type { World } from './world';
import type { Codecs, Descriptor } from './persist';

export type BuildingState = 'building' | 'active';

/** Rolling record of what a household actually received. */
export interface HomeSupply {
  foodTypes: Set<ResId>;
  clothingTypes: Set<ResId>;
  luxuryTypes: Set<ResId>;
  foodDays: number;      // days of food buffered in the home
  fuelDays: number;
  clothing: number;
  luxury: number;
}

let nextBuildingId = 1;
export function resetBuildingIds(): void { nextBuildingId = 1; }
export function setNextBuildingId(n: number): void { nextBuildingId = n; }
export function peekNextBuildingId(): number { return nextBuildingId; }

export class Building {
  readonly id: number;
  readonly def: BuildingDef;
  readonly defId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
  /** Tile villagers walk to when using this building. */
  entrance: { x: number; y: number };
  /** Ground height, sampled at placement so the mesh sits flush. */
  groundY = 0;
  /** Cosmetic variation seed for the renderer. */
  variant = 0;

  state: BuildingState = 'building';
  /** Materials delivered to the site so far. */
  delivered: Amounts = {};
  /** Labour applied to the frame. */
  buildProgress = 0;

  /** Local buffer: inputs waiting to be used and outputs waiting to be hauled. */
  store: Amounts = {};
  /** Goods a villager has claimed but not yet collected. */
  reservedOut: Amounts = {};
  /** Goods en route to this building. */
  incoming: Amounts = {};

  /** Villager ids working here. */
  workers: number[] = [];
  /** How many jobs the player has opened. */
  jobSlots = 0;
  paused = false;
  /** Higher priority buildings get labour and hauling first. */
  priority = 1;

  /** Progress toward the current recipe batch, in worker-seconds. */
  workAccum = 0;
  /** Units produced since the settlement began — shown in the inspector. */
  produced = 0;
  /** 0..1, smoothed, for the UI activity bar. */
  activity = 0;
  /** Reason the building is stalled, surfaced in the UI. */
  status = 'Idle';

  /** Terrain quality under the footprint (farms use it). */
  fertility = 1;

  // --- Housing state ---
  tier = 1;
  /** Family ids living here. The count of these is the household's family count. */
  familyIds: number[] = [];
  residents: number[] = [];
  contentment = 0.5;
  supply: HomeSupply = {
    foodTypes: new Set(), clothingTypes: new Set(), luxuryTypes: new Set(),
    foodDays: 1, fuelDays: 1, clothing: 1, luxury: 0,
  };
  /** Services currently reaching this home. */
  services: Partial<Record<ServiceKind, number>> = {};
  localCharm = 0;
  /** Set when the home meets every requirement of the next tier. */
  upgradeReady = false;
  upgradeBlockers: string[] = [];
  /** Consecutive days a home has failed the tier it currently holds. */
  downgradeStrikes = 0;
  /** True when the household had to raid a storehouse because the stall was bare. */
  rationing = false;

  // --- Agriculture state (buildings with def.crop) ---
  /** 0..1: how far the standing crop has come this year. */
  growth = 0;
  sown = false;
  /** Worker-seconds of sowing applied this spring. */
  sowProgress = 0;
  /** Grain (etc.) still standing in the field once autumn starts. */
  cropPool = 0;
  cropPoolInit = 0;
  /** What the player has told this field to sow next. */
  cropType: CropType = 'wheat';
  /** What actually went into the ground this year, and the year before. */
  sownCrop: CropType | null = null;
  lastCrop: CropType | null = null;
  /** Yield multiplier earned (or lost) by this year's rotation choice. */
  rotationFactor = 1;

  /** Production stops when the village holds this much of the output (null = no cap). */
  limit: number | null = null;

  // --- Service state ---
  /** Villagers within this service's radius. */
  serving = 0;

  constructor(defId: string, x: number, y: number, world: World, w?: number, h?: number, id?: number) {
    this.id = id ?? nextBuildingId++;
    if (id !== undefined && id >= nextBuildingId) nextBuildingId = id + 1;
    this.defId = defId;
    this.def = BUILDING_BY_ID[defId];
    this.x = x; this.y = y;
    this.w = w ?? this.def.size[0]; this.h = h ?? this.def.size[1];
    this.cx = x + this.w / 2; this.cy = y + this.h / 2;
    this.entrance = { x: Math.round(this.cx), y: y + this.h };
    // Zone buildings staff up with their acreage.
    this.jobSlots = this.def.zone
      ? Math.max(1, Math.min(6, Math.round(this.area / 8)))
      : this.def.jobs;
    this.fertility = world.avgFertility(x, y, this.w, this.h);
    let sum = 0, n = 0;
    for (let ty = y; ty < y + this.h; ty++) {
      for (let tx = x; tx < x + this.w; tx++) {
        if (world.inBounds(tx, ty)) { sum += world.height[world.idx(tx, ty)]; n++; }
      }
    }
    this.groundY = n ? sum / n : 0;
    this.variant = Math.floor(((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000 / 1000;
  }

  get isHouse(): boolean { return this.def.cat === 'housing'; }
  /** Households under this roof. */
  get families(): number { return this.familyIds.length; }
  /** The crop variety this field is set to sow. */
  get crop(): CropVariety { return CROPS[this.cropType]; }
  /** The variety actually standing in the field right now. */
  get standingCrop(): CropVariety { return CROPS[this.sownCrop ?? this.cropType]; }

  /**
   * Sowing something new after last year's crop is rewarded; sowing the same
   * thing twice running is punished. Called the moment seed hits the ground.
   */
  rotationFactorFor(next: CropType): number {
    if (!this.lastCrop) return 1;
    return this.lastCrop === next ? MONOCULTURE_PENALTY : ROTATION_BONUS;
  }
  get area(): number { return this.w * this.h; }
  /** Zone recipes were balanced for a 4×4 plot; bigger plots scale up from there. */
  get sizeFactor(): number { return this.def.zone ? this.area / 16 : 1; }
  get isStorage(): boolean { return (this.def.storage ?? 0) > 0 && this.def.cat === 'logistics'; }
  get name(): string { return this.def.name; }

  /** Pick a walkable tile next to the footprint for villagers to path to. */
  computeEntrance(world: World): void {
    const candidates: { x: number; y: number }[] = [];
    for (let tx = this.x - 1; tx <= this.x + this.w; tx++) {
      candidates.push({ x: tx, y: this.y - 1 }, { x: tx, y: this.y + this.h });
    }
    for (let ty = this.y - 1; ty <= this.y + this.h; ty++) {
      candidates.push({ x: this.x - 1, y: ty }, { x: this.x + this.w, y: ty });
    }
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (!world.walkable(c.x, c.y)) continue;
      const i = world.idx(c.x, c.y);
      const score = (world.road[i] ? 4 : 0) - world.slopeAt(c.x, c.y);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) this.entrance = best;
  }

  // ---------------------------------------------------------------- storage

  amount(res: ResId): number { return this.store[res] ?? 0; }

  add(res: ResId, amt: number): number {
    if (amt <= 0) return 0;
    const room = this.freeSpace(res);
    const take = Math.min(amt, room);
    if (take <= 0) return 0;
    this.store[res] = (this.store[res] ?? 0) + take;
    return take;
  }

  take(res: ResId, amt: number): number {
    const have = this.store[res] ?? 0;
    const got = Math.min(have, amt);
    if (got <= 0) return 0;
    this.store[res] = have - got;
    if (this.store[res]! <= 0.0001) delete this.store[res];
    return got;
  }

  /** Stock free to be claimed by a haulier. */
  available(res: ResId): number {
    return Math.max(0, (this.store[res] ?? 0) - (this.reservedOut[res] ?? 0));
  }

  reserveOut(res: ResId, amt: number): void {
    this.reservedOut[res] = (this.reservedOut[res] ?? 0) + amt;
  }

  releaseOut(res: ResId, amt: number): void {
    const v = (this.reservedOut[res] ?? 0) - amt;
    if (v > 0.001) this.reservedOut[res] = v; else delete this.reservedOut[res];
  }

  addIncoming(res: ResId, amt: number): void {
    this.incoming[res] = (this.incoming[res] ?? 0) + amt;
  }

  clearIncoming(res: ResId, amt: number): void {
    const v = (this.incoming[res] ?? 0) - amt;
    if (v > 0.001) this.incoming[res] = v; else delete this.incoming[res];
  }

  total(): number {
    let t = 0;
    for (const k in this.store) t += this.store[k as ResId] ?? 0;
    return t;
  }

  accepts(res: ResId): boolean {
    const only = this.def.storeOnly;
    if (!only) return true;
    return only.includes(RESOURCES[res].cat);
  }

  capacity(): number {
    if (this.def.storage) return this.def.storage;
    // Workshops keep a small working buffer.
    return 120;
  }

  freeSpace(res: ResId): number {
    if (!this.accepts(res)) return 0;
    return Math.max(0, this.capacity() - this.total());
  }

  // ---------------------------------------------------------- construction

  /** Materials for this instance — drag-sized zones cost more the bigger they are. */
  buildCost(): Amounts {
    const scale = Math.max(1, this.sizeFactor);
    const out: Amounts = {};
    for (const k in this.def.cost) {
      out[k as ResId] = Math.ceil((this.def.cost[k as ResId] ?? 0) * scale);
    }
    return out;
  }

  /** Labour to raise this instance. */
  get buildWorkTotal(): number { return this.def.buildWork * Math.max(1, this.sizeFactor); }

  /**
   * Materials this site is still short of.
   *
   * The default subtracts what is already on a haulier's back, which is what a
   * villager deciding whether to fetch more needs to know — otherwise five
   * people all set off with the same last eight planks. `'delivered'` counts
   * only what has physically arrived, which is what belongs on the panel: a
   * progress bar that fills when carts are *dispatched* would be lying.
   */
  materialsOwed(counting: 'pledged' | 'delivered' = 'pledged'): Amounts {
    const cost = this.buildCost();
    const out: Amounts = {};
    for (const k in cost) {
      const res = k as ResId;
      const pledged = counting === 'pledged' ? (this.incoming[res] ?? 0) : 0;
      const need = (cost[res] ?? 0) - (this.delivered[res] ?? 0) - pledged;
      if (need > 0.001) out[res] = need;
    }
    return out;
  }

  materialsComplete(): boolean {
    const cost = this.buildCost();
    for (const k in cost) {
      const res = k as ResId;
      if ((this.delivered[res] ?? 0) < (cost[res] ?? 0) - 0.001) return false;
    }
    return true;
  }

  deliverMaterial(res: ResId, amt: number): number {
    const need = (this.buildCost()[res] ?? 0) - (this.delivered[res] ?? 0);
    const take = Math.max(0, Math.min(amt, need));
    if (take > 0) this.delivered[res] = (this.delivered[res] ?? 0) + take;
    return take;
  }

  get buildFraction(): number {
    return Math.min(1, this.buildProgress / Math.max(1, this.buildWorkTotal));
  }

  // ------------------------------------------------------------- production

  /** True when the local buffer holds a full set of recipe inputs. */
  hasInputs(): boolean {
    const r = this.def.recipe;
    if (!r) return true;
    for (const k in r.in) {
      const res = k as ResId;
      if ((this.store[res] ?? 0) < (r.in[res] ?? 0) - 0.001) return false;
    }
    return true;
  }

  /** Inputs the workshop wants fetched from storage, sized for a few batches. */
  wantedInputs(batches = 4): Amounts {
    const out: Amounts = {};
    const r = this.def.recipe;
    if (!r) return out;
    for (const k in r.in) {
      const res = k as ResId;
      const target = (r.in[res] ?? 0) * batches;
      const need = target - (this.store[res] ?? 0);
      if (need > 0.5) out[res] = need;
    }
    return out;
  }

  /** Finished goods sitting here that hauliers should move to storage. */
  outputStock(): Amounts {
    const out: Amounts = {};
    const recipeInputs = this.def.recipe?.in ?? {};
    for (const k in this.store) {
      const res = k as ResId;
      if (recipeInputs[res] !== undefined) continue; // still an input
      const amt = this.store[res] ?? 0;
      if (amt > 0.001) out[res] = amt;
    }
    return out;
  }

  tierDef() { return HOUSE_TIERS[Math.max(0, Math.min(HOUSE_TIERS.length - 1, this.tier - 1))]; }

  get capacityFamilies(): number { return this.def.homes ? this.def.homes * this.tierDef().capacity : 0; }

  /** Heads that can live here: a family is two adults and up to a child each. */
  get capacityResidents(): number { return this.capacityFamilies * 3; }
}

// ---------------------------------------------------------------- persistence

/**
 * What the saver does with each field. See `./persist` — the `satisfies` below
 * means adding a field to Building without deciding this is a build error.
 */
export const BUILDING_PERSIST = {
  // Identity and footprint: fixed at construction, so the loader passes them in.
  id: 'ctor', defId: 'ctor', x: 'ctor', y: 'ctor', w: 'ctor', h: 'ctor',

  // Rebuilt from defId, the footprint, or the terrain underneath.
  def: 'derived', cx: 'derived', cy: 'derived',
  groundY: 'derived', variant: 'derived',
  area: 'derived', sizeFactor: 'derived',
  isHouse: 'derived', isStorage: 'derived', name: 'derived',
  buildWorkTotal: 'derived', capacityFamilies: 'derived', capacityResidents: 'derived',
  families: 'derived', crop: 'derived', standingCrop: 'derived',
  buildFraction: 'derived',
  // ^ every one of these is a getter: computed, never assigned.

  // The reservation ledger is deliberately not saved. Every trip is abandoned
  // on load, so both sides start empty; a two-sided ledger written to disk can
  // only ever come back disagreeing with itself. See Game.afterLoad.
  reservedOut: 'derived', incoming: 'derived',

  // Recomputed on the next hourly or daily tick.
  services: 'derived', upgradeReady: 'derived', upgradeBlockers: 'derived',
  serving: 'derived',
  /** Smoothed UI meter; decays to nothing within a few seconds anyway. */
  activity: 'transient',

  // Construction and production.
  state: 'save', delivered: 'save', buildProgress: 'save', store: 'save',
  workers: 'save', jobSlots: 'save', paused: 'save', priority: 'save',
  workAccum: 'save', produced: 'save', status: 'save', fertility: 'save',
  limit: 'save',

  // Household.
  tier: 'save', familyIds: 'save', residents: 'save', contentment: 'save',
  localCharm: 'save', downgradeStrikes: 'save', rationing: 'save',

  // Field.
  growth: 'save', sown: 'save', sowProgress: 'save',
  cropPool: 'save', cropPoolInit: 'save',
  cropType: 'save', sownCrop: 'save', lastCrop: 'save', rotationFactor: 'save',

  // Not plain JSON.
  entrance: 'custom', supply: 'custom',
} satisfies Descriptor<Building>;

export const BUILDING_CODECS: Codecs<Building> = {
  // Stored as a pair rather than an object, which is also the shape older
  // saves use.
  entrance: {
    get: (b) => [b.entrance.x, b.entrance.y],
    set: (b, v) => { const [x, y] = v as [number, number]; b.entrance = { x, y }; },
  },
  // Three Sets and four numbers. The key names are the ones on disk.
  supply: {
    get: (b) => ({
      food: [...b.supply.foodTypes],
      clothing: [...b.supply.clothingTypes],
      luxury: [...b.supply.luxuryTypes],
      foodDays: b.supply.foodDays, fuelDays: b.supply.fuelDays,
      clothingAmt: b.supply.clothing, luxuryAmt: b.supply.luxury,
    }),
    set: (b, v) => {
      const s = v as {
        food: ResId[]; clothing: ResId[]; luxury: ResId[];
        foodDays: number; fuelDays: number; clothingAmt: number; luxuryAmt: number;
      };
      b.supply = {
        foodTypes: new Set(s.food), clothingTypes: new Set(s.clothing),
        luxuryTypes: new Set(s.luxury),
        foodDays: s.foodDays, fuelDays: s.fuelDays,
        clothing: s.clothingAmt, luxury: s.luxuryAmt,
      };
    },
  },
};
