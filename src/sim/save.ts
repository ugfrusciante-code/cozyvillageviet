/**
 * Save and load. The valley itself is deterministic from its seed, so a save
 * only has to carry what the player and the simulation changed since: tile
 * deltas, every building and villager, the families, and the clock.
 *
 * Terrain arrays are run-length encoded — the map is overwhelmingly repetitive,
 * which takes a ~37k-number payload down to a few hundred pairs.
 */

import type { CropType, NodeKind, ResId, Season } from './defs';
import { Building, setNextBuildingId, peekNextBuildingId } from './building';
import { Family, setNextFamilyId, peekNextFamilyId } from './family';
import { Villager, setNextVillagerId, peekNextVillagerId } from './villager';
import { Game } from './game';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'cozy-village/save';
export const AUTOSAVE_KEY = 'cozy-village/autosave';

// ---------------------------------------------------------------- encoding

/** [value, runLength, value, runLength, …] */
type RLE = number[];

function rleEncode(arr: ArrayLike<number>, round = 0): RLE {
  const out: RLE = [];
  const q = (v: number) => (round > 0 ? Math.round(v * round) / round : v);
  let prev = q(arr[0]);
  let run = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = q(arr[i]);
    if (v === prev) { run++; continue; }
    out.push(prev, run);
    prev = v; run = 1;
  }
  out.push(prev, run);
  return out;
}

function rleDecodeInto(rle: RLE, target: { [i: number]: number; length: number }): void {
  let i = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k], run = rle[k + 1];
    for (let r = 0; r < run && i < target.length; r++) target[i++] = v;
  }
}

// ------------------------------------------------------------------- shapes

interface SavedBuilding {
  id: number; defId: string; x: number; y: number; w: number; h: number;
  state: string; delivered: Record<string, number>; buildProgress: number;
  store: Record<string, number>; workers: number[]; jobSlots: number;
  paused: boolean; priority: number; workAccum: number; produced: number;
  status: string; fertility: number; entrance: [number, number];
  limit: number | null;
  tier: number; familyIds: number[]; residents: number[]; contentment: number;
  supply: {
    food: string[]; clothing: string[]; luxury: string[];
    foodDays: number; fuelDays: number; clothingAmt: number; luxuryAmt: number;
  };
  localCharm: number; downgradeStrikes: number; rationing: boolean;
  growth: number; sown: boolean; sowProgress: number;
  cropPool: number; cropPoolInit: number;
  cropType: CropType; sownCrop: CropType | null; lastCrop: CropType | null;
  rotationFactor: number;
}

interface SavedVillager {
  id: number; name: string; age: number; lifespan: number;
  homeId: number; jobId: number; familyId: number;
  x: number; y: number; facing: number;
  action: string; activity: string;
  carry: { res: ResId; amt: number } | null;
  targetB: number; fetchRes: ResId | null; fetchAmt: number; targetNode: number;
  jobDestOverride: number; lastPickupB: number;
  workTimer: number; skill: number; educated: boolean; health: number; hasOx: boolean;
}

interface SavedFamily {
  id: number; surname: string; homeId: number; memberIds: number[];
  founded: number; childrenBorn: number;
}

export interface SaveData {
  version: number;
  savedAt: number;
  label: string;
  seed: number;
  rngState: number;
  t: number; day: number; year: number; season: Season;
  lastDay: number; lastHourTick: number;
  coin: number; autoAssign: boolean; oxenInUse: number;
  events: { day: number; text: string; kind: string }[];
  trade: unknown;
  tradeRules: unknown;
  stats: unknown;
  lostGoods: Record<string, number>;
  startX: number; startY: number;
  nextIds: { building: number; villager: number; family: number };
  world: {
    fertility: RLE; node: RLE; nodeAmt: RLE; regrowAt: RLE;
    road: RLE; softBlock: RLE;
    regrowKind: [number, string][];
  };
  buildings: SavedBuilding[];
  villagers: SavedVillager[];
  families: SavedFamily[];
}

// ---------------------------------------------------------------- serialize

export function serialize(g: Game, label = 'Manual save'): SaveData {
  const w = g.world;
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    label,
    seed: g.seed,
    rngState: g.rngState,
    t: g.t, day: g.day, year: g.year, season: g.season,
    lastDay: g.lastDay, lastHourTick: g.lastHourTick,
    coin: g.coin, autoAssign: g.autoAssign, oxenInUse: g.oxenInUse,
    events: g.events.slice(-60),
    trade: g.trade,
    tradeRules: g.tradeRules,
    stats: g.stats,
    lostGoods: g.lostGoods as Record<string, number>,
    startX: g.startX, startY: g.startY,
    nextIds: {
      building: peekNextBuildingId(),
      villager: peekNextVillagerId(),
      family: peekNextFamilyId(),
    },
    world: {
      fertility: rleEncode(w.fertility, 1000),
      node: rleEncode(w.node),
      nodeAmt: rleEncode(w.nodeAmt),
      regrowAt: rleEncode(w.regrowAt),
      road: rleEncode(w.road),
      softBlock: rleEncode(w.softBlock),
      regrowKind: [...g.regrowKind.entries()].map(([i, k]) => [i, k] as [number, string]),
    },
    buildings: [...g.buildings.values()].map((b) => ({
      id: b.id, defId: b.defId, x: b.x, y: b.y, w: b.w, h: b.h,
      state: b.state,
      delivered: b.delivered as Record<string, number>,
      buildProgress: b.buildProgress,
      store: b.store as Record<string, number>,
      workers: [...b.workers], jobSlots: b.jobSlots,
      paused: b.paused, priority: b.priority, workAccum: b.workAccum,
      produced: b.produced, status: b.status, fertility: b.fertility,
      entrance: [b.entrance.x, b.entrance.y] as [number, number],
      limit: b.limit,
      tier: b.tier, familyIds: [...b.familyIds], residents: [...b.residents],
      contentment: b.contentment,
      supply: {
        food: [...b.supply.foodTypes],
        clothing: [...b.supply.clothingTypes],
        luxury: [...b.supply.luxuryTypes],
        foodDays: b.supply.foodDays, fuelDays: b.supply.fuelDays,
        clothingAmt: b.supply.clothing, luxuryAmt: b.supply.luxury,
      },
      localCharm: b.localCharm, downgradeStrikes: b.downgradeStrikes,
      rationing: b.rationing,
      growth: b.growth, sown: b.sown, sowProgress: b.sowProgress,
      cropPool: b.cropPool, cropPoolInit: b.cropPoolInit,
      cropType: b.cropType, sownCrop: b.sownCrop, lastCrop: b.lastCrop,
      rotationFactor: b.rotationFactor,
    })),
    villagers: [...g.villagers.values()].map((v) => ({
      id: v.id, name: v.name, age: v.age, lifespan: v.lifespan,
      homeId: v.homeId, jobId: v.jobId, familyId: v.familyId,
      x: v.x, y: v.y, facing: v.facing,
      action: v.action, activity: v.activity,
      carry: v.carry ? { res: v.carry.res, amt: v.carry.amt } : null,
      targetB: v.targetB, fetchRes: v.fetchRes, fetchAmt: v.fetchAmt,
      targetNode: v.targetNode,
      jobDestOverride: v.jobDestOverride, lastPickupB: v.lastPickupB,
      workTimer: v.workTimer, skill: v.skill, educated: v.educated,
      health: v.health, hasOx: v.hasOx,
    })),
    families: [...g.families.values()].map((f) => ({
      id: f.id, surname: f.surname, homeId: f.homeId,
      memberIds: [...f.memberIds], founded: f.founded,
      childrenBorn: f.childrenBorn,
    })),
  };
}

// -------------------------------------------------------------- deserialize

export function deserialize(data: SaveData): Game {
  if (data.version !== SAVE_VERSION) {
    throw new Error(`Save is version ${data.version}, this build reads ${SAVE_VERSION}.`);
  }
  // Rebuild the valley from its seed, then lay the saved deltas over the top.
  const g = new Game(data.seed, true);
  const w = g.world;

  rleDecodeInto(data.world.fertility, w.fertility);
  rleDecodeInto(data.world.node, w.node);
  rleDecodeInto(data.world.nodeAmt, w.nodeAmt);
  rleDecodeInto(data.world.regrowAt, w.regrowAt);
  rleDecodeInto(data.world.road, w.road);
  rleDecodeInto(data.world.softBlock, w.softBlock);
  g.regrowKind = new Map(data.world.regrowKind.map(([i, k]) => [i, k as NodeKind]));

  g.rngState = data.rngState;
  g.t = data.t; g.day = data.day; g.year = data.year; g.season = data.season;
  g.lastDay = data.lastDay; g.lastHourTick = data.lastHourTick;
  g.coin = data.coin; g.autoAssign = data.autoAssign;
  g.oxenInUse = data.oxenInUse ?? 0;
  g.events = data.events.map((e) => ({ ...e, kind: e.kind as 'good' | 'bad' | 'info' }));
  g.trade = data.trade as Game['trade'];
  g.tradeRules = data.tradeRules as Game['tradeRules'];
  g.stats = data.stats as Game['stats'];
  g.lostGoods = data.lostGoods ?? {};
  g.startX = data.startX; g.startY = data.startY;

  // Buildings first: villagers and families reference them by id.
  for (const sb of data.buildings) {
    const b = new Building(sb.defId, sb.x, sb.y, w, sb.w, sb.h, sb.id);
    b.state = sb.state as Building['state'];
    b.delivered = sb.delivered as Building['delivered'];
    b.buildProgress = sb.buildProgress;
    b.store = sb.store as Building['store'];
    b.workers = sb.workers; b.jobSlots = sb.jobSlots;
    b.paused = sb.paused; b.priority = sb.priority; b.workAccum = sb.workAccum;
    b.produced = sb.produced; b.status = sb.status; b.fertility = sb.fertility;
    b.entrance = { x: sb.entrance[0], y: sb.entrance[1] };
    b.limit = sb.limit;
    b.tier = sb.tier; b.familyIds = sb.familyIds; b.residents = sb.residents;
    b.contentment = sb.contentment;
    b.supply = {
      foodTypes: new Set(sb.supply.food as ResId[]),
      clothingTypes: new Set(sb.supply.clothing as ResId[]),
      luxuryTypes: new Set(sb.supply.luxury as ResId[]),
      foodDays: sb.supply.foodDays, fuelDays: sb.supply.fuelDays,
      clothing: sb.supply.clothingAmt, luxury: sb.supply.luxuryAmt,
    };
    b.localCharm = sb.localCharm; b.downgradeStrikes = sb.downgradeStrikes;
    b.rationing = sb.rationing;
    b.growth = sb.growth; b.sown = sb.sown; b.sowProgress = sb.sowProgress;
    b.cropPool = sb.cropPool; b.cropPoolInit = sb.cropPoolInit;
    b.cropType = sb.cropType; b.sownCrop = sb.sownCrop; b.lastCrop = sb.lastCrop;
    b.rotationFactor = sb.rotationFactor;
    g.buildings.set(b.id, b);

    // Re-stamp the occupancy grid without the side effects of placement
    // (which would fell trees and hand out free logs all over again).
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (w.inBounds(x, y)) w.occupied[w.idx(x, y)] = b.id;
      }
    }
  }

  for (const sf of data.families) {
    const f = new Family(sf.surname, sf.founded, sf.id);
    f.homeId = sf.homeId; f.memberIds = sf.memberIds;
    f.childrenBorn = sf.childrenBorn;
    g.families.set(f.id, f);
  }

  for (const sv of data.villagers) {
    const v = new Villager(sv.x, sv.y, sv.age, () => 0.5, sv.id);
    v.name = sv.name; v.lifespan = sv.lifespan;
    v.homeId = sv.homeId; v.jobId = sv.jobId; v.familyId = sv.familyId;
    v.facing = sv.facing;
    v.action = sv.action as Villager['action'];
    v.activity = sv.activity;
    v.carry = sv.carry;
    v.targetB = sv.targetB; v.fetchRes = sv.fetchRes; v.fetchAmt = sv.fetchAmt;
    v.targetNode = sv.targetNode;
    v.jobDestOverride = sv.jobDestOverride; v.lastPickupB = sv.lastPickupB;
    v.workTimer = sv.workTimer; v.skill = sv.skill; v.educated = sv.educated;
    v.health = sv.health; v.hasOx = sv.hasOx;
    // Paths are not saved: everyone re-plans from where they stand. That means
    // EVERY walking state must be reset — `stepPath` treats an empty path as
    // "arrived", so a hauler restored mid-trip would otherwise complete its
    // pickup or drop-off instantly from wherever it happened to be standing.
    //
    // Abandoning the trip also means abandoning every claim it held: the
    // reservation at the source, the pledge to the destination, and any tree
    // or seam the villager had called dibs on. A claim held by a villager who
    // is now idle would never be released.
    v.path = []; v.pathIdx = 0;
    if (v.action !== 'sleeping' && v.action !== 'working') v.action = 'idle';
    v.fetchRes = null;
    v.fetchAmt = 0;
    v.jobDestOverride = -1;
    v.targetB = -1;
    v.targetNode = -1;
    // `carry` is deliberately kept: the goods are physically in their hands and
    // will be re-delivered on the next tick.
    g.villagers.set(v.id, v);
  }

  setNextBuildingId(data.nextIds.building);
  setNextVillagerId(data.nextIds.villager);
  setNextFamilyId(data.nextIds.family);

  g.afterLoad();
  return g;
}

// ------------------------------------------------------------------ storage

export function saveToStorage(g: Game, key = SAVE_KEY, label = 'Manual save'): SaveData {
  const data = serialize(g, label);
  localStorage.setItem(key, JSON.stringify(data));
  return data;
}

export function loadFromStorage(key = SAVE_KEY): Game | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return deserialize(JSON.parse(raw) as SaveData);
}

export function peekSave(key = SAVE_KEY): { savedAt: number; label: string; day: number; year: number; pop: number } | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== SAVE_VERSION) return null;
    return { savedAt: d.savedAt, label: d.label, day: d.day, year: d.year, pop: d.villagers.length };
  } catch {
    return null;
  }
}

export function clearSave(key = SAVE_KEY): void {
  localStorage.removeItem(key);
}

/** Download the save as a file, so a village can outlive the browser profile. */
export function exportSave(g: Game): { name: string; json: string } {
  const data = serialize(g, 'Exported');
  return {
    name: `cozy-village-y${data.year}-d${data.day}.json`,
    json: JSON.stringify(data),
  };
}
