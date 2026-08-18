/**
 * Save and load. The valley itself is deterministic from its seed, so a save
 * only has to carry what the player and the simulation changed since: tile
 * deltas, every building and villager, the families, and the clock.
 *
 * Terrain arrays are run-length encoded — the map is overwhelmingly repetitive,
 * which takes a ~37k-number payload down to a few hundred pairs.
 */

import type { NodeKind, Season } from './defs';
import {
  BUILDING_CODECS, BUILDING_PERSIST, Building, setNextBuildingId, peekNextBuildingId,
} from './building';
import { FAMILY_CODECS, FAMILY_PERSIST, Family, setNextFamilyId, peekNextFamilyId } from './family';
import {
  VILLAGER_CODECS, VILLAGER_PERSIST, Villager, setNextVillagerId, peekNextVillagerId,
} from './villager';
import { decode, encode } from './persist';
import { Game } from './game';

export const SAVE_VERSION = 4;
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

/**
 * Per-object payloads are whatever the class's descriptor says to write, so
 * there is deliberately no hand-maintained mirror of the class shape here.
 * That mirror is what lost the reservation ledger: four edit sites, no
 * compile-time link to the class, and nothing to notice a field going missing.
 */
type Saved = Record<string, unknown>;

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
  /** Absent in saves from before milestones existed; defaults to none. */
  milestones?: Record<string, number>;
  /** Raid schedule. The walkers themselves are transient and re-form on load. */
  raidThreat?: number;
  raidAtDay?: number;
  startX: number; startY: number;
  nextIds: { building: number; villager: number; family: number };
  world: {
    fertility: RLE; node: RLE; nodeAmt: RLE; regrowAt: RLE;
    road: RLE; softBlock: RLE;
    /** Absent in saves older than bridges; nothing was decked back then. */
    bridge?: RLE;
    regrowKind: [number, string][];
  };
  buildings: Saved[];
  villagers: Saved[];
  families: Saved[];
}

/**
 * Loaders for older payloads, applied in sequence: a v3 save runs
 * MIGRATIONS[3] and is then a v4 save.
 *
 * Most changes need nothing here. A newly-saved field is simply absent from an
 * old payload, and `decode` leaves it at the class default — so migrations are
 * for renames and changes of meaning, which are rare. v3 to v4 changed how the
 * payload is *produced*, not what it contains, hence the identity step.
 */
const MIGRATIONS: Record<number, (d: SaveData) => SaveData> = {
  3: (d) => d,
};

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
    milestones: g.milestonesDone,
    raidThreat: g.raidThreat,
    raidAtDay: g.raidAtDay,
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
      bridge: rleEncode(w.bridge),
      regrowKind: [...g.regrowKind.entries()].map(([i, k]) => [i, k] as [number, string]),
    },
    buildings: [...g.buildings.values()].map((b) => encode(b, BUILDING_PERSIST, BUILDING_CODECS)),
    villagers: [...g.villagers.values()].map((v) => encode(v, VILLAGER_PERSIST, VILLAGER_CODECS)),
    families: [...g.families.values()].map((f) => encode(f, FAMILY_PERSIST, FAMILY_CODECS)),
  };
}

// --------------------------------------------------------------- migration

/** Bring any readable payload up to the current version, or refuse it. */
function migrate(data: SaveData): SaveData {
  if (data.version > SAVE_VERSION) {
    throw new Error(
      `Save is version ${data.version}; this build reads up to ${SAVE_VERSION}. It was made by a newer build.`,
    );
  }
  let d = data;
  while (d.version < SAVE_VERSION) {
    const step = MIGRATIONS[d.version];
    if (!step) throw new Error(`No way to read a version ${d.version} save.`);
    d = { ...step(d), version: d.version + 1 };
  }
  return d;
}

// -------------------------------------------------------------- deserialize

export function deserialize(raw: SaveData): Game {
  const data = migrate(raw);
  // Rebuild the valley from its seed, then lay the saved deltas over the top.
  const g = new Game(data.seed, true);
  const w = g.world;

  rleDecodeInto(data.world.fertility, w.fertility);
  rleDecodeInto(data.world.node, w.node);
  rleDecodeInto(data.world.nodeAmt, w.nodeAmt);
  rleDecodeInto(data.world.regrowAt, w.regrowAt);
  rleDecodeInto(data.world.road, w.road);
  rleDecodeInto(data.world.softBlock, w.softBlock);
  if (data.world.bridge) rleDecodeInto(data.world.bridge, w.bridge);
  g.regrowKind = new Map(data.world.regrowKind.map(([i, k]) => [i, k as NodeKind]));
  // Roads and soft-blocked field tiles just changed under us.
  w.invalidateRegions();

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
  g.milestonesDone = data.milestones ?? {};
  g.raidThreat = data.raidThreat ?? 0;
  g.raidAtDay = data.raidAtDay ?? -1;
  g.startX = data.startX; g.startY = data.startY;

  // Buildings first: villagers and families reference them by id.
  for (const sb of data.buildings) {
    const b = new Building(
      sb.defId as string, sb.x as number, sb.y as number, w,
      sb.w as number, sb.h as number, sb.id as number,
    );
    decode(b, sb, BUILDING_PERSIST, BUILDING_CODECS);
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
    const f = new Family(sf.surname as string, sf.founded as number, sf.id as number);
    decode(f, sf, FAMILY_PERSIST, FAMILY_CODECS);
    g.families.set(f.id, f);
  }

  for (const sv of data.villagers) {
    const v = new Villager(sv.x as number, sv.y as number, sv.age as number, () => 0.5, sv.id as number);
    decode(v, sv, VILLAGER_PERSIST, VILLAGER_CODECS);
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
    if (d.version > SAVE_VERSION || (d.version < SAVE_VERSION && !MIGRATIONS[d.version])) return null;
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
