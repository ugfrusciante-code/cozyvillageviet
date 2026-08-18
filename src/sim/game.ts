/**
 * The simulation: time, population, needs, contentment, taxation, trade and
 * the queries villagers use to find work. Renderer-free by design so it can be
 * run headlessly (see tools/headless.ts).
 */

import {
  ALL_RES, BUILDING_BY_ID, CLOTHING_TYPES, FOOD_TYPES, HOUSE_TIERS, LUXURY_TYPES,
  RESOURCES, SEASONS, TUNING,
  type Amounts, type BuildingDef, type Harvest, type NodeKind, type ResId,
  type Season, type ServiceKind,
} from './defs';
import { Building, resetBuildingIds } from './building';
import { Family, SURNAMES, resetFamilyIds } from './family';
import { Villager, resetVillagerIds } from './villager';
import { Pathfinder, RNG, World, NODE_INDEX } from './world';

export interface GameEvent {
  day: number;
  text: string;
  kind: 'good' | 'bad' | 'info';
}

export interface Alert {
  id: string;
  text: string;
  severity: 'warn' | 'danger';
}

export interface TradeState {
  /** Multiplier on the reference price, moved by your own trading. */
  mod: Partial<Record<ResId, number>>;
  soldToday: Partial<Record<ResId, number>>;
  boughtToday: Partial<Record<ResId, number>>;
}

export interface Stats {
  producedToday: Amounts;
  consumedToday: Amounts;
  coinHistory: number[];
  popHistory: number[];
  contentHistory: number[];
  lastTax: number;
  lastUpkeep: number;
  lastTradeIncome: number;
}

const SERVICE_KINDS: ServiceKind[] = ['water', 'faith', 'leisure', 'health', 'market', 'learning'];

export class Game {
  world: World;
  path: Pathfinder;
  rng: RNG;

  buildings = new Map<number, Building>();
  villagers = new Map<number, Villager>();
  families = new Map<number, Family>();

  /** Game seconds elapsed. Play opens at 07:00 on the first day of spring. */
  t = 7 * TUNING.secondsPerHour;
  day = 0;
  year = 1;
  season: Season = 'spring';
  speed = 1;
  paused = false;

  coin: number = TUNING.startingCoin;
  events: GameEvent[] = [];
  alerts: Alert[] = [];

  trade: TradeState = { mod: {}, soldToday: {}, boughtToday: {} };
  stats: Stats = {
    producedToday: {}, consumedToday: {},
    coinHistory: [], popHistory: [], contentHistory: [],
    lastTax: 0, lastUpkeep: 0, lastTradeIncome: 0,
  };

  /** Node tiles currently being worked, so two gatherers never share a tree. */
  claimedNodes = new Set<number>();
  /** Secondary harvest outputs waiting to be banked (hides from a hunt). */
  pendingExtras: { b: Building; res: ResId; amt: number }[] = [];

  /** Recent building-to-building deliveries, for the supply-line overlay. */
  transfers: { from: number; to: number; res: ResId; amt: number; t: number }[] = [];
  /** Standing orders executed daily at the trading post. */
  tradeRules: Partial<Record<ResId, { sellAbove?: number | null; buyBelow?: number | null }>> = {};

  autoAssign = true;
  /** Draught oxen currently yoked to a cart. */
  oxenInUse = 0;
  /** Rebuilt each hour: which services reach which tiles. */
  private serviceIndex = new Map<ServiceKind, Building[]>();
  lastDay = -1;
  lastHourTick = -1;
  private reassignPending = true;

  /** The seed this valley was generated from — needed to rebuild it on load. */
  readonly seed: number;

  /**
   * A second stream used only for cosmetic choices (surnames). Kept apart from
   * `rng` so that naming a family can never shift the simulation's dice.
   */
  private flavourRng: RNG;

  constructor(seed = Math.floor(Math.random() * 1e9), skipSetup = false) {
    this.seed = seed;
    this.world = new World({ size: 96, seed });
    this.path = new Pathfinder(this.world);
    this.rng = new RNG(seed ^ 0x9e3779b9);
    this.flavourRng = new RNG(seed ^ 0x517cc1b7);
    if (!skipSetup) this.setupStart();
  }

  /** Read/write the RNG stream position so a save resumes deterministically. */
  get rngState(): number { return this.rng.state; }
  set rngState(v: number) { this.rng.state = v; }

  rand(): number { return this.rng.next(); }

  // ---------------------------------------------------------------- clock

  get totalHours(): number { return this.t / TUNING.secondsPerHour; }
  get hour(): number { return this.totalHours % TUNING.hoursPerDay; }
  get dayFraction(): number { return this.hour / TUNING.hoursPerDay; }
  get isWorkHour(): boolean {
    return this.hour >= TUNING.workStartHour && this.hour < TUNING.workEndHour;
  }
  get isNight(): boolean { return this.hour < 5.5 || this.hour > 20.5; }
  get dayOfSeason(): number { return this.day % TUNING.daysPerSeason; }
  get seasonProgress(): number {
    return (this.day % TUNING.daysPerSeason + this.dayFraction) / TUNING.daysPerSeason;
  }

  // ------------------------------------------------------------- start-up

  private setupStart(): void {
    resetBuildingIds();
    resetVillagerIds();
    resetFamilyIds();
    const w = this.world;

    // Find a flat, dry, pleasant spot near the middle of the valley to settle.
    let best = { x: w.size / 2, y: w.size / 2, score: -Infinity };
    for (let y = 20; y < w.size - 20; y += 2) {
      for (let x = 20; x < w.size - 20; x += 2) {
        const chk = w.canPlace(x - 4, y - 4, 9, 9, 1.4);
        if (!chk.ok) continue;
        let trees = 0, forage = 0, farmland = 0, flat = 0;
        for (let dy = -9; dy <= 9; dy++) {
          for (let dx = -9; dx <= 9; dx++) {
            if (!w.inBounds(x + dx, y + dy)) continue;
            const i = w.idx(x + dx, y + dy);
            const kind = w.node[i];
            if (kind === NODE_INDEX['tree']) trees++;
            else if (kind === NODE_INDEX['berry'] || kind === NODE_INDEX['game']) forage++;
            // Open, fertile, dry ground: where the fields will eventually go.
            if (kind === 0 && !w.water[i] && w.fertility[i] > 0.4) farmland++;
            if (Math.abs(dx) <= 6 && Math.abs(dy) <= 6) flat -= w.slopeAt(x + dx, y + dy);
          }
        }
        const nearWater = w.isNearWater(x, y, 12) ? 14 : 0;
        const centre = -Math.hypot(x - w.size / 2, y - w.size / 2) * 0.7;
        // Food first, then farmland to grow into — a settlement with no
        // plough-land nearby is a dead end even if the berries are lovely.
        const score = Math.min(trees, 260) * 0.06 + Math.min(forage, 60) * 0.5
          + Math.min(farmland, 70) * 0.34
          + flat * 0.6 + nearWater + centre;
        if (score > best.score) best = { x, y, score };
      }
    }
    const ox = Math.round(best.x), oy = Math.round(best.y);
    this.startX = ox; this.startY = oy;

    const store = this.forcePlace('storehouse', ox - 1, oy - 1);
    if (store) {
      store.jobSlots = 1;
      store.add('logs', 70); store.add('planks', 34); store.add('stone', 40);
      store.add('bread', 46); store.add('berries', 24); store.add('firewood', 30);
      // Enough tools to sink a quarry AND a mine, so the iron chain is always
      // reachable however the player sequences those two.
      store.add('tools', 8); store.add('clothes', 6);
    }
    // The settlers arrive with a stall pitched and a well already sunk, so the
    // household supply loop is running from the first minute.
    const market = this.forcePlace('market', ox - 6, oy - 1);
    if (market) {
      market.jobSlots = 1;
      market.add('bread', 20); market.add('berries', 12); market.add('firewood', 16);
      market.add('clothes', 4);
    }
    this.forcePlace('well', ox - 2, oy + 2);

    const c1 = this.forcePlace('cottage', ox - 5, oy + 3);
    const c2 = this.forcePlace('cottage', ox + 3, oy + 3);
    const c3 = this.forcePlace('cottage', ox - 5, oy - 4);

    const homes = [c1, c2, c3].filter(Boolean) as Building[];
    for (let i = 0; i < TUNING.startingVillagers; i++) {
      const home = homes[i % Math.max(1, homes.length)];
      const age = i < 2 ? 8 + Math.floor(this.rand() * 5) : 18 + Math.floor(this.rand() * 26);
      const v = new Villager(
        (home?.cx ?? ox) + (this.rand() - 0.5) * 2,
        (home?.cy ?? oy) + 1.5 + (this.rand() - 0.5) * 2,
        age, () => this.rand(),
      );
      if (home) { v.homeId = home.id; home.residents.push(v.id); }
      this.villagers.set(v.id, v);
    }
    // Group the settlers into founding families, one household per cottage,
    // so everyone under a roof shares a surname from the first day.
    for (const h of homes) {
      const fam = this.foundFamily(h);
      for (const vid of h.residents) {
        const v = this.villagers.get(vid);
        if (!v) continue;
        v.familyId = fam.id;
        fam.memberIds.push(vid);
        v.takeSurname(fam.surname);
      }
    }

    this.log('Your people arrive in the valley. Give them shelter before winter.', 'info');
    this.refreshServices();
    this.reassign();
  }

  startX = 0;
  startY = 0;

  /** Place a starting building, ignoring cost, already complete. */
  private forcePlace(defId: string, x: number, y: number): Building | null {
    const def = BUILDING_BY_ID[defId];
    for (let r = 0; r < 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx, py = y + dy;
          if (this.world.canPlace(px, py, def.size[0], def.size[1], 1.2).ok) {
            const b = new Building(defId, px, py, this.world);
            this.registerFootprint(b);
            b.state = 'active';
            b.buildProgress = b.buildWorkTotal;
            const cost = b.buildCost();
            for (const k in cost) b.delivered[k as ResId] = cost[k as ResId] ?? 0;
            b.computeEntrance(this.world);
            this.buildings.set(b.id, b);
            return b;
          }
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------- placement

  canPlace(defId: string, x: number, y: number, w?: number, h?: number): { ok: boolean; reason?: string } {
    const def = BUILDING_BY_ID[defId];
    if (!def) return { ok: false, reason: 'Unknown building' };
    const fw = w ?? def.size[0], fh = h ?? def.size[1];
    if (def.zone) {
      if (fw < def.zone.minSide || fh < def.zone.minSide) return { ok: false, reason: `At least ${def.zone.minSide}×${def.zone.minSide}` };
      if (fw > def.zone.maxSide || fh > def.zone.maxSide) return { ok: false, reason: `At most ${def.zone.maxSide}×${def.zone.maxSide}` };
    }
    if (def.minPop && this.population < def.minPop) {
      return { ok: false, reason: `Needs ${def.minPop} villagers` };
    }
    if (def.needs) {
      for (const req of def.needs) {
        if (!this.hasBuilding(req)) {
          return { ok: false, reason: `Requires a ${BUILDING_BY_ID[req].name}` };
        }
      }
    }
    const maxSlope = def.cat === 'decor' || def.id === 'road' ? 3.0 : def.zone ? 2.2 : 1.6;
    const base = this.world.canPlace(x, y, fw, fh, maxSlope);
    if (!base.ok) return base;
    const cx = Math.round(x + fw / 2), cy = Math.round(y + fh / 2);
    if (def.nearWater && !this.world.isNearWater(cx, cy, 3)) {
      return { ok: false, reason: 'Must be built on the shore' };
    }
    if (def.needsFertile) {
      // Thin soil is allowed — the yield just suffers for it. Only true
      // wasteland is refused outright.
      const f = this.world.avgFertility(x, y, fw, fh);
      if (f < 0.18) return { ok: false, reason: 'Soil here is too poor to plough' };
    }
    if (def.harvest) {
      const near = this.world.findNodes(cx, cy, def.harvest.kind, def.harvest.radius, 1);
      if (near.length === 0) return { ok: false, reason: `No ${def.harvest.kind} within range` };
    }
    return { ok: true };
  }

  /** Queue a building as a construction site. Returns the new building or null. */
  place(defId: string, x: number, y: number, w?: number, h?: number): Building | null {
    const check = this.canPlace(defId, x, y, w, h);
    if (!check.ok) return null;
    const b = new Building(defId, x, y, this.world, w, h);
    this.registerFootprint(b);
    b.computeEntrance(this.world);
    b.state = 'building';
    // Roads and tiny decorations go up instantly — no site, no haulage.
    if (b.def.id === 'road' || (b.def.buildWork <= 8 && Object.keys(b.def.cost).length <= 1)) {
      const cost = b.buildCost();
      let affordable = true;
      for (const k in cost) {
        if (this.stockOf(k as ResId) < (cost[k as ResId] ?? 0)) { affordable = false; break; }
      }
      if (!affordable) { this.unregisterFootprint(b); return null; }
      for (const k in cost) this.takeFromStores(k as ResId, cost[k as ResId] ?? 0);
      for (const k in cost) b.delivered[k as ResId] = cost[k as ResId] ?? 0;
      b.buildProgress = b.buildWorkTotal;
      this.completeBuilding(b, true);
    }
    this.buildings.set(b.id, b);
    this.reassignPending = true;
    return b;
  }

  private registerFootprint(b: Building): void {
    const w = this.world;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (w.inBounds(x, y)) {
          const i = w.idx(x, y);
          w.occupied[i] = b.id;
          if (b.defId === 'road') w.road[i] = 1;
          if (b.def.zone) w.softBlock[i] = 1; // fields are walked through, not around
          // Clear whatever was growing here.
          if (b.defId !== 'road' && w.node[i] !== 0) w.clearNode(i);
        }
      }
    }
    // Villagers clear the trees immediately around anything they raise, so the
    // settlement reads as a clearing rather than being swallowed by the forest.
    if (b.defId !== 'road' && b.def.cat !== 'decor') {
      for (let y = b.y - 1; y <= b.y + b.h; y++) {
        for (let x = b.x - 1; x <= b.x + b.w; x++) {
          if (!w.inBounds(x, y)) continue;
          const i = w.idx(x, y);
          if (w.node[i] === NODE_INDEX['tree']) {
            w.clearNode(i);
            this.removedNodes.push(i);
            this.addToStores('logs', 2, b.cx, b.cy);
          }
        }
      }
    }
  }

  private unregisterFootprint(b: Building): void {
    const w = this.world;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (w.inBounds(x, y)) {
          const i = w.idx(x, y);
          if (w.occupied[i] === b.id) { w.occupied[i] = -1; w.softBlock[i] = 0; }
          if (b.defId === 'road') w.road[i] = 0;
        }
      }
    }
  }

  demolish(id: number): void {
    const b = this.buildings.get(id);
    if (!b) return;
    // Return a portion of the materials to the stores.
    for (const k in b.delivered) {
      const res = k as ResId;
      this.addToStores(res, (b.delivered[res] ?? 0) * 0.5, b.cx, b.cy);
    }
    for (const k in b.store) this.addToStores(k as ResId, b.store[k as ResId] ?? 0, b.cx, b.cy);
    for (const vid of b.workers) {
      const v = this.villagers.get(vid);
      if (v) { v.jobId = -1; v.releaseAll(this); }
    }
    for (const vid of b.residents) {
      const v = this.villagers.get(vid);
      if (v) { v.homeId = -1; v.releaseAll(this); }
    }
    this.unregisterFootprint(b);
    this.buildings.delete(id);
    this.reassignPending = true;
    this.refreshServices();
    this.log(`${b.name} demolished.`, 'info');
  }

  completeBuilding(b: Building, silent = false): void {
    b.state = 'active';
    b.status = 'Idle';
    b.computeEntrance(this.world);
    if (b.isHouse) b.tier = 1;
    this.reassignPending = true;
    this.refreshServices();
    if (!silent && b.def.cat !== 'decor' && b.defId !== 'road') {
      this.log(`${b.name} finished.`, 'good');
    }
  }

  hasBuilding(defId: string): boolean {
    for (const b of this.buildings.values()) {
      if (b.defId === defId && b.state === 'active') return true;
    }
    return false;
  }

  // ------------------------------------------------------------- inventory

  /** Total of a resource across every storage building. */
  stockOf(res: ResId): number {
    let t = 0;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active') continue;
      if (b.isStorage || b.def.service?.kind === 'market') t += b.amount(res);
    }
    return t;
  }

  /** Everything held anywhere in the settlement, including workshop buffers. */
  totalOf(res: ResId): number {
    let t = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active') t += b.amount(res);
    }
    return t;
  }

  allStock(): Amounts {
    const out: Amounts = {};
    for (const b of this.buildings.values()) {
      if (b.state !== 'active') continue;
      for (const k in b.store) {
        const res = k as ResId;
        out[res] = (out[res] ?? 0) + (b.store[res] ?? 0);
      }
    }
    return out;
  }

  storageCapacity(): number {
    let cap = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' && (b.isStorage || b.def.service?.kind === 'market')) cap += b.capacity();
    }
    return cap;
  }

  storageUsed(): number {
    let used = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' && (b.isStorage || b.def.service?.kind === 'market')) used += b.total();
    }
    return used;
  }

  takeFromStores(res: ResId, amt: number): number {
    let left = amt;
    const stores = [...this.buildings.values()]
      .filter((b) => b.state === 'active' && b.amount(res) > 0)
      .sort((a, b) => b.amount(res) - a.amount(res));
    for (const s of stores) {
      if (left <= 0.001) break;
      left -= s.take(res, left);
    }
    return amt - left;
  }

  addToStores(res: ResId, amt: number, nearX = this.startX, nearY = this.startY): number {
    let left = amt;
    const stores = [...this.buildings.values()]
      .filter((b) => b.state === 'active' && b.isStorage && b.freeSpace(res) > 0)
      .sort((a, b) => Math.hypot(a.cx - nearX, a.cy - nearY) - Math.hypot(b.cx - nearX, b.cy - nearY));
    for (const s of stores) {
      if (left <= 0.001) break;
      left -= s.add(res, left);
    }
    return amt - left;
  }

  // -------------------------------------------------------- villager queries

  /** Nearest active building holding at least `min` of `res` free to claim. */
  findSource(res: ResId, x: number, y: number, min = 1): Building | undefined {
    let best: Building | undefined;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.isStorage) continue;
      if (b.available(res) < min) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /**
   * Like findSource, but falls back to taking goods straight out of a workshop
   * when the stores are empty. Builders will happily pull logs off the
   * woodcutter's own pile rather than wait for a porter who may never come.
   */
  findSourceAny(res: ResId, x: number, y: number, min = 1): Building | undefined {
    const store = this.findSource(res, x, y, min);
    if (store) return store;
    let best: Building | undefined;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || b.isHouse) continue;
      if (b.def.service?.kind === 'market') continue;
      // Never strip a workshop of the inputs it is about to use.
      if (b.def.recipe?.in && (b.def.recipe.in as Record<string, number>)[res] !== undefined) continue;
      if (b.available(res) < min) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** Nearest storage with room for `amt` of `res`. */
  findDestination(res: ResId, x: number, y: number, amt: number): Building | undefined {
    let best: Building | undefined;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.isStorage) continue;
      if (b.freeSpace(res) < Math.min(amt, 1)) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** A workshop with finished goods a porter from `home` should collect. */
  findPorterPickup(home: Building, x: number, y: number): { from: Building; res: ResId; amt: number; avail: number } | null {
    let best: { from: Building; res: ResId; amt: number; avail: number } | null = null;
    let bestScore = -Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || b.isStorage || b.id === home.id) continue;
      if (b.def.service || b.isHouse) continue;
      const out = b.outputStock();
      for (const k in out) {
        const res = k as ResId;
        const amt = b.available(res);
        if (amt < 6) continue;
        const d = Math.hypot(b.cx - x, b.cy - y);
        const score = amt * 2 - d;
        if (score > bestScore) {
          bestScore = score;
          best = { from: b, res, amt: Math.min(amt, TUNING.carryCapacity), avail: amt };
        }
      }
    }
    return best;
  }

  /** Same, but for spare labourers, with a lower trigger. */
  findAnyPickup(x: number, y: number): { from: Building; res: ResId; amt: number; avail: number } | null {
    let best: { from: Building; res: ResId; amt: number; avail: number } | null = null;
    let bestScore = -Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || b.isStorage || b.isHouse) continue;
      if (b.def.service && b.def.service.kind !== 'market') continue;
      if (b.def.service?.kind === 'market') continue;
      const out = b.outputStock();
      for (const k in out) {
        const res = k as ResId;
        const amt = b.available(res);
        if (amt < 3) continue;
        const d = Math.hypot(b.cx - x, b.cy - y);
        const score = amt * 2 - d * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = { from: b, res, amt: Math.min(amt, TUNING.carryCapacity), avail: amt };
        }
      }
    }
    return best;
  }

  nearestSiteNeedingWork(x: number, y: number): Building | undefined {
    let best: Building | undefined;
    let bestScore = -Infinity;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' || b.paused) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      const score = b.priority * 40 - d;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  randomLandmark(): Building | undefined {
    const list = [...this.buildings.values()].filter((b) => b.state === 'active' && !b.isHouse);
    if (!list.length) return undefined;
    return list[Math.floor(this.rand() * list.length)];
  }

  // ------------------------------------------------------------------ nodes

  claimNode(b: Building, kind: NodeKind, radius: number): number {
    const w = this.world;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    const candidates = w.findNodes(cx, cy, kind, radius, 96);
    let best = -1, bestD = Infinity;
    for (const i of candidates) {
      if (this.claimedNodes.has(i)) continue;
      const nx = i % w.size, ny = (i / w.size) | 0;
      const d = (nx - cx) ** 2 + (ny - cy) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) this.claimedNodes.add(best);
    return best;
  }

  releaseNode(i: number): void { this.claimedNodes.delete(i); }

  consumeNode(i: number, hv: Harvest): number {
    const w = this.world;
    if (i < 0 || w.nodeAmt[i] <= 0) return 0;
    w.nodeAmt[i] -= 1;
    if (w.nodeAmt[i] <= 0) {
      const regrowDay = hv.regrow ? this.day + hv.regrow : -1;
      w.clearNode(i, regrowDay);
      if (regrowDay >= 0) this.regrowKind.set(i, hv.kind);
    }
    this.stats.producedToday[hv.out] = (this.stats.producedToday[hv.out] ?? 0) + hv.yield;
    return hv.yield;
  }

  regrowKind = new Map<number, NodeKind>();

  findPlantingSpot(b: Building, radius: number): number {
    const w = this.world;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    let best = -1, bestD = Infinity;
    for (let k = 0; k < 90; k++) {
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * radius;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (w.water[i] || w.occupied[i] >= 0 || w.road[i] || w.node[i] !== 0) continue;
      if (this.claimedNodes.has(i)) continue;
      // Keep a little breathing room between trunks.
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (w.inBounds(x + dx, y + dy) && w.node[w.idx(x + dx, y + dy)] === NODE_INDEX['tree']) neighbours++;
        }
      }
      if (neighbours >= 4) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) this.claimedNodes.add(best);
    return best;
  }

  plantTree(i: number): void {
    if (i < 0) return;
    this.world.setNode(i, 'tree', 1);
    this.claimedNodes.delete(i);
    this.newTrees.push(i);
  }

  /** Tiles the renderer still needs to spawn trees for. */
  newTrees: number[] = [];
  /** Tiles the renderer needs to clear. */
  removedNodes: number[] = [];

  // --------------------------------------------------------------- services

  private refreshServices(): void {
    this.serviceIndex.clear();
    for (const k of SERVICE_KINDS) this.serviceIndex.set(k, []);
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.def.service) continue;
      this.serviceIndex.get(b.def.service.kind)!.push(b);
    }
  }

  /** 0 = none, or the strength of the best provider reaching this point. */
  private serviceLevel(kind: ServiceKind, x: number, y: number): { level: number; b?: Building } {
    let level = 0, chosen: Building | undefined;
    for (const b of this.serviceIndex.get(kind) ?? []) {
      const s = b.def.service!;
      if (Math.hypot(b.cx - x, b.cy - y) > s.radius) continue;
      const consumes = s.consumes;
      if (consumes && !consumes.some((r) => b.amount(r) > 0.01)) continue;
      // A stone church counts double for the tier-3 requirement.
      const strength = b.defId === 'church' ? 2 : 1;
      if (strength > level) { level = strength; chosen = b; }
    }
    return { level, b: chosen };
  }

  charmAt(x: number, y: number): number {
    let charm = 0;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.def.charm) continue;
      const r = b.def.charmRadius ?? 10;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d > r) continue;
      charm += b.def.charm * (1 - d / r);
    }
    return charm;
  }

  marketsNear(x: number, y: number): Building[] {
    return (this.serviceIndex.get('market') ?? [])
      .filter((m) => Math.hypot(m.cx - x, m.cy - y) <= m.def.service!.radius)
      .sort((a, b) => Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y));
  }

  /** What a market should be restocked with, most urgent first. */
  marketWishlist(m: Building): { res: ResId; amt: number }[] {
    const homes = this.homesServedBy(m);
    // Food is eaten per head; fuel, clothing and comforts are per household.
    const heads = homes.reduce((s, h) => s + h.residents.length, 0) || 1;
    const families = homes.reduce((s, h) => s + Math.max(1, h.families), 0) || 1;
    const targets: { res: ResId; amt: number }[] = [];
    const want = (res: ResId, per: number, units: number) => {
      const target = Math.max(8, per * units * 3);
      const have = m.amount(res) + (m.incoming[res] ?? 0);
      if (target - have > 3) targets.push({ res, amt: target - have });
    };
    // Food first, spread across whatever types the village actually produces.
    const foods = FOOD_TYPES.filter((f) => this.stockOf(f) > 0 || m.amount(f) > 0);
    for (const f of foods) want(f, TUNING.foodPerDay * 1.2 / Math.max(1, foods.length) * 2.2, heads);
    want('firewood', TUNING.fuelPerDay * TUNING.fuelSeason[this.season] * 1.6, families);
    for (const c of CLOTHING_TYPES) if (this.stockOf(c) > 0) want(c, TUNING.clothingPerDay * 3, families);
    for (const l of LUXURY_TYPES) if (this.stockOf(l) > 0) want(l, TUNING.luxuryPerDay * 2, families);
    return targets.sort((a, b) => b.amt - a.amt);
  }

  /** Markets whose shelves are thin enough that any spare hand should help. */
  marketsShortOfGoods(): Building[] {
    const out: Building[] = [];
    for (const m of this.serviceIndex.get('market') ?? []) {
      if (m.state !== 'active') continue;
      const heads = this.homesServedBy(m).reduce((n, h) => n + h.residents.length, 0);
      if (heads === 0) continue;
      const food = FOOD_TYPES.reduce((t, f) => t + m.amount(f) + (m.incoming[f] ?? 0), 0);
      const fuel = m.amount('firewood') + (m.incoming.firewood ?? 0);
      if (food < heads * TUNING.foodPerDay * 2 || fuel < heads * TUNING.fuelPerDay) out.push(m);
    }
    return out;
  }

  homesServedBy(m: Building): Building[] {
    const r = m.def.service!.radius;
    const out: Building[] = [];
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.isHouse) continue;
      if (Math.hypot(b.cx - m.cx, b.cy - m.cy) <= r) out.push(b);
    }
    return out;
  }

  // ---------------------------------------------------------------- families

  /** Start a new household, moving it into `home` if there is room. */
  foundFamily(home?: Building): Family {
    // Prefer a surname not already in the valley, so names stay legible.
    const taken = new Set([...this.families.values()].map((f) => f.surname));
    const free = SURNAMES.filter((n) => !taken.has(n));
    const pool = free.length ? free : SURNAMES;
    const surname = pool[Math.floor(this.flavourRng.next() * pool.length)];
    const fam = new Family(surname, this.day);
    this.families.set(fam.id, fam);
    if (home) this.moveFamilyIn(fam, home);
    return fam;
  }

  moveFamilyIn(fam: Family, home: Building): boolean {
    if (home.familyIds.length >= home.capacityFamilies) return false;
    if (fam.homeId >= 0) {
      const old = this.buildings.get(fam.homeId);
      if (old) old.familyIds = old.familyIds.filter((id) => id !== fam.id);
    }
    fam.homeId = home.id;
    home.familyIds.push(fam.id);
    return true;
  }

  familyOf(home: Building): Family | undefined {
    return this.families.get(home.familyIds[0] ?? -1);
  }

  /** A home with a spare family slot, nearest to (x,y). */
  private homeWithFamilyRoom(x: number, y: number): Building | undefined {
    let best: Building | undefined, bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.isHouse) continue;
      if (b.familyIds.length >= b.capacityFamilies) continue;
      if (b.residents.length >= b.capacityResidents) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** Drop a family that has lost every member. */
  private retireFamily(fam: Family): void {
    if (fam.memberIds.length) return;
    const home = this.buildings.get(fam.homeId);
    if (home) home.familyIds = home.familyIds.filter((id) => id !== fam.id);
    this.families.delete(fam.id);
  }

  // ------------------------------------------------------------------- oxen

  /** Total draught oxen stabled in the village. */
  get oxenTotal(): number {
    let n = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' && b.def.oxen) n += b.def.oxen;
    }
    return n;
  }

  /** Yoke an ox to a cart, if one is free. */
  claimOx(): boolean {
    if (this.oxenInUse >= this.oxenTotal) return false;
    this.oxenInUse++;
    return true;
  }

  releaseOx(): void {
    if (this.oxenInUse > 0) this.oxenInUse--;
  }

  // ------------------------------------------------------------- population

  get population(): number { return this.villagers.size; }
  get adults(): number {
    let n = 0;
    for (const v of this.villagers.values()) if (v.isAdult) n++;
    return n;
  }
  get children(): number {
    let n = 0;
    for (const v of this.villagers.values()) if (v.isChild) n++;
    return n;
  }
  get employed(): number {
    let n = 0;
    for (const v of this.villagers.values()) if (v.isAdult && v.jobId >= 0) n++;
    return n;
  }
  get idleAdults(): number { return this.adults - this.employed; }
  get homeless(): number {
    let n = 0;
    for (const v of this.villagers.values()) if (v.homeId < 0) n++;
    return n;
  }
  get averageContentment(): number {
    let sum = 0, n = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' && b.isHouse && b.residents.length) { sum += b.contentment; n++; }
    }
    return n ? sum / n : 0.5;
  }

  /** Reconcile workers against the job slots the player has opened. */
  reassign(): void {
    this.reassignPending = false;
    // Drop workers from buildings that lost slots or were demolished.
    for (const b of this.buildings.values()) {
      const limit = b.state === 'active' ? Math.min(b.jobSlots, b.def.jobs) : 0;
      while (b.workers.length > limit) {
        const id = b.workers.pop()!;
        const v = this.villagers.get(id);
        if (v) { v.jobId = -1; v.releaseAll(this); }
      }
      b.workers = b.workers.filter((id) => {
        const v = this.villagers.get(id);
        if (!v || !v.isAdult) return false;
        v.jobId = b.id;
        return true;
      });
    }

    const free = [...this.villagers.values()].filter((v) => v.isAdult && v.jobId < 0);

    // Always hold back a pool of labourers. Without them nothing gets built and
    // half-finished sites swallow every log in the village. This has to run
    // even when nobody is free — that is exactly when it is needed.
    if (this.autoAssign) {
      const sites = [...this.buildings.values()].filter((b) => b.state !== 'active' && !b.paused).length;
      const targetLabour = sites > 0 ? Math.max(1, Math.round(this.adults * 0.25)) : 0;
      // If every pair of hands is already in a workshop, pull some back off the
      // least urgent jobs — otherwise construction sites never get built and
      // the whole settlement quietly seizes up.
      if (free.length < targetLabour) {
        const staffed = [...this.buildings.values()]
          .filter((b) => b.state === 'active' && b.workers.length > 0)
          .sort((a, b) => this.autoPriority(a) - this.autoPriority(b));
        for (const b of staffed) {
          while (free.length < targetLabour && b.workers.length > 0) {
            const id = b.workers.pop()!;
            const v = this.villagers.get(id);
            if (!v) continue;
            v.jobId = -1;
            v.releaseAll(this);
            free.push(v);
          }
          if (free.length >= targetLabour) break;
        }
      }
      const keep = Math.min(targetLabour, free.length);
      if (keep > 0) free.splice(free.length - keep, keep);
    }
    if (!free.length) return;

    const openings = [...this.buildings.values()]
      .filter((b) => b.state === 'active' && !b.paused && b.workers.length < Math.min(b.jobSlots, b.def.jobs))
      .sort((a, b) => (b.priority * 2 + this.autoPriority(b)) - (a.priority * 2 + this.autoPriority(a)));

    for (const b of openings) {
      while (b.workers.length < Math.min(b.jobSlots, b.def.jobs) && free.length) {
        // Give the job to whoever lives closest.
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < free.length; i++) {
          const v = free[i];
          const home = v.homeId >= 0 ? this.buildings.get(v.homeId) : undefined;
          const d = Math.hypot((home?.cx ?? v.x) - b.cx, (home?.cy ?? v.y) - b.cy);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        const v = free.splice(bestI, 1)[0];
        v.jobId = b.id;
        v.releaseAll(this);
        b.workers.push(v.id);
      }
    }
  }

  /**
   * Ranking used when jobs are filled automatically: keep people fed and warm
   * before anyone is sent to carve pottery.
   */
  private autoPriority(b: Building): number {
    const d = b.def;

    // The farming year drives field urgency: sowing and harvest are the two
    // moments where missing hands cost a whole season.
    if (d.crop) {
      // Sowing and reaping are short windows that decide the whole year, so
      // they outrank almost everything — but only if the crop can actually
      // feed someone. Wheat is not food until there is a mill and a bakery to
      // turn it into bread; a field of it must not starve the foragers.
      const variety = b.sownCrop ? b.standingCrop : b.crop;
      const edible = RESOURCES[variety.out]?.food === true;
      const feeds = edible || (this.hasBuilding('mill') && this.hasBuilding('bakery'));
      if (this.season === 'spring' && !b.sown) return feeds ? 6.6 : 4.2;
      if (this.season === 'summer' && b.sown && b.growth < 1) return feeds ? 4.6 : 3.0;
      if (this.season === 'autumn' && b.cropPool > 0.5) return feeds ? 6.6 : 4.2;
      return 0.5;
    }

    // A workshop with nothing to work on is worse than useless: it holds staff
    // who should be upstream digging the input out of the ground. The same
    // goes for out-of-season work — a forager in January is two idle hands.
    if (d.recipe) {
      if (d.recipe.seasons && !d.recipe.seasons.includes(this.season)) return 0.4;
      for (const k of Object.keys(d.recipe.in) as ResId[]) {
        if (this.stockOf(k) + b.amount(k) < (d.recipe.in[k] ?? 0)) return 0.5;
      }
    }
    if (d.harvest) {
      if (d.harvest.seasons && !d.harvest.seasons.includes(this.season)) return 0.4;
      if (!this.world.findNodes(
        Math.round(b.cx), Math.round(b.cy), d.harvest.kind, d.harvest.radius, 1,
      ).length) return 0.4;
    }

    // Extraction outranks the conversion that depends on it, and when the
    // larder is bare, gathering food outranks absolutely everything.
    if (d.harvest) {
      if (RESOURCES[d.harvest.out]?.food) return this.foodDaysLeft() < 2.5 ? 7.8 : 6.2;
      return 5.6;
    }
    if (d.recipe) {
      const outs = Object.keys(d.recipe.out) as ResId[];
      if (outs.some((k) => RESOURCES[k]?.food)) {
        const base = d.cat === 'farming' ? 5.4 : 5.0;
        return this.foodDaysLeft() < 2.5 ? 7.6 : base;
      }
      if (outs.some((k) => RESOURCES[k]?.fuel)) {
        // Firewood is existential once the cold comes, so a thin woodpile
        // outranks almost everything else. Otherwise it is ordinary work.
        const perDay = this.population * TUNING.fuelPerDay * TUNING.fuelSeason[this.season];
        if (this.totalOf('firewood') < perDay * 4) return 6.0;
        return 4.6;
      }
      if (d.cat === 'farming') return 4.0;
      return 2.5;
    }
    if (d.plants) return 3.0;
    if (d.service?.kind === 'market') {
      // A bare stall is the most urgent job in the village: every household
      // shops here, and nothing else matters if they cannot eat.
      const homes = this.homesServedBy(b);
      const heads = homes.reduce((n, h) => n + h.residents.length, 0);
      const food = FOOD_TYPES.reduce((t, f) => t + b.amount(f), 0);
      if (heads > 0 && food < heads * TUNING.foodPerDay * 1.5) return 7.5;
      return 5.8;
    }
    if (d.cat === 'logistics') {
      // When finished goods are stacking up in workshops, porters matter more
      // than anything else in the village.
      return this.backlog() > 60 ? 6.5 : 4.4;
    }
    return 1;
  }

  /** How many days the village could eat for on what is in store. */
  foodDaysLeft(): number {
    const stock = FOOD_TYPES.reduce((t, f) => t + this.stockOf(f), 0);
    return stock / Math.max(0.01, this.population * TUNING.foodPerDay);
  }

  /** Finished goods sitting in workshops waiting for a haulier. */
  backlog(): number {
    let t = 0;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || b.isStorage || b.isHouse || b.def.service) continue;
      const out = b.outputStock();
      for (const k in out) t += out[k as ResId] ?? 0;
    }
    return t;
  }

  setJobSlots(buildingId: number, slots: number): void {
    const b = this.buildings.get(buildingId);
    if (!b) return;
    b.jobSlots = Math.max(0, Math.min(b.def.jobs, Math.round(slots)));
    this.reassignPending = true;
  }

  assignVillager(villagerId: number, buildingId: number | -1): void {
    const v = this.villagers.get(villagerId);
    if (!v || !v.isAdult) return;
    if (v.jobId >= 0) {
      const old = this.buildings.get(v.jobId);
      if (old) old.workers = old.workers.filter((id) => id !== villagerId);
    }
    v.releaseAll(this);
    v.jobId = -1;
    if (buildingId >= 0) {
      const b = this.buildings.get(buildingId);
      if (b && b.state === 'active' && b.workers.length < b.def.jobs) {
        b.workers.push(villagerId);
        v.jobId = b.id;
        b.jobSlots = Math.max(b.jobSlots, b.workers.length);
      }
    }
  }

  private housingFor(v: Villager): void {
    if (v.homeId >= 0 && this.buildings.has(v.homeId)) return;
    let best: Building | undefined, bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.isHouse) continue;
      if (b.residents.length >= b.capacityResidents) continue;
      const d = Math.hypot(b.cx - v.x, b.cy - v.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      v.homeId = best.id;
      best.residents.push(v.id);
      // Somebody has to be the household: an occupied home always has a family.
      if (v.familyId < 0) {
        const existing = this.familyOf(best);
        const fam = existing && best.familyIds.length >= best.capacityFamilies
          ? existing
          : (existing ?? this.foundFamily(best));
        v.familyId = fam.id;
        if (!fam.memberIds.includes(v.id)) fam.memberIds.push(v.id);
        v.takeSurname(fam.surname);
      } else if (!best.familyIds.length) {
        const fam = this.families.get(v.familyId);
        if (fam) this.moveFamilyIn(fam, best);
      }
    }
  }

  /**
   * Keep households and homes consistent: every resident belongs to a family,
   * and every occupied home has at least one. Cheap, and it means the rest of
   * the sim can trust `families` never to be zero under a lived-in roof.
   */
  private reconcileFamilies(): void {
    for (const home of this.buildings.values()) {
      if (home.state !== 'active' || !home.isHouse) continue;
      // Drop stale ids, then make sure a lived-in home has a household.
      home.familyIds = home.familyIds.filter((id) => this.families.has(id));
      if (home.residents.length && !home.familyIds.length) {
        const resident = home.residents
          .map((id) => this.villagers.get(id))
          .find((v): v is Villager => !!v && v.familyId >= 0 && this.families.has(v.familyId));
        const fam = resident ? this.families.get(resident.familyId)! : this.foundFamily();
        this.moveFamilyIn(fam, home);
      }
    }
    for (const v of this.villagers.values()) {
      if (v.familyId >= 0 && this.families.has(v.familyId)) continue;
      const home = v.homeId >= 0 ? this.buildings.get(v.homeId) : undefined;
      const fam = (home && this.familyOf(home)) ?? this.foundFamily(home);
      v.familyId = fam.id;
      if (!fam.memberIds.includes(v.id)) fam.memberIds.push(v.id);
    }
  }

  // -------------------------------------------------------------- main tick

  update(realDt: number): void {
    if (this.paused || this.speed === 0) return;
    const dt = Math.min(0.25, realDt) * this.speed;
    // Sub-step so fast speeds do not make villagers tunnel past their targets.
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / 0.1)));
    const sub = dt / steps;
    for (let s = 0; s < steps; s++) this.step(sub);
  }

  private step(dt: number): void {
    this.t += dt;

    if (this.reassignPending) this.reassign();

    for (const v of this.villagers.values()) v.update(this, dt);

    // Bank secondary harvest yields (hides, beeswax).
    if (this.pendingExtras.length) {
      for (const e of this.pendingExtras) e.b.add(e.res, e.amt);
      this.pendingExtras.length = 0;
    }

    // Decay activity meters so idle buildings read as idle.
    for (const b of this.buildings.values()) b.activity *= 1 - dt * 0.25;

    const hourNow = Math.floor(this.totalHours);
    if (hourNow !== this.lastHourTick) {
      this.lastHourTick = hourNow;
      this.hourTick();
    }

    const dayNow = Math.floor(this.totalHours / TUNING.hoursPerDay);
    if (dayNow !== this.lastDay) {
      const prevSeason = this.season;
      this.lastDay = dayNow;
      this.day = dayNow;
      const seasonIdx = Math.floor(this.day / TUNING.daysPerSeason) % 4;
      this.season = SEASONS[seasonIdx];
      this.year = Math.floor(this.day / (TUNING.daysPerSeason * 4)) + 1;
      this.dayTick();
      if (this.season !== prevSeason) this.seasonTick(prevSeason);
    }
  }

  private hourTick(): void {
    this.refreshServices();
    this.consumeServiceGoods();
    this.recomputeAlerts();
  }

  /** Taverns drink their ale, healers use their medicine. */
  private consumeServiceGoods(): void {
    for (const b of this.buildings.values()) {
      if (b.state !== 'active') continue;
      const s = b.def.service;
      const consumes = s?.consumes;
      if (!s || !consumes) continue;
      const served = this.homesServedBy2(b);
      b.serving = served;
      const perHour = (s.rate ?? 0.1) * served / TUNING.hoursPerDay;
      for (const res of consumes) {
        if (b.amount(res) > 0) {
          const used = b.take(res, perHour);
          this.stats.consumedToday[res] = (this.stats.consumedToday[res] ?? 0) + used;
          break;
        }
      }
    }
  }

  private homesServedBy2(b: Building): number {
    const r = b.def.service?.radius ?? 0;
    let n = 0;
    for (const h of this.buildings.values()) {
      if (h.state === 'active' && h.isHouse && Math.hypot(h.cx - b.cx, h.cy - b.cy) <= r) n += h.residents.length;
    }
    return n;
  }

  // -------------------------------------------------------------- day tick

  private dayTick(): void {
    this.regrowNodes();
    this.cropCycle();
    this.soilDrift();
    this.ageAndHealth();
    this.householdNeeds();
    this.housingAndTiers();
    this.birthsAndDeaths();
    this.immigration();
    this.reconcileFamilies();
    this.runTradeOrders();
    this.decayTradePrices();

    if (this.autoAssign) this.reassign();

    this.stats.coinHistory.push(this.coin);
    this.stats.popHistory.push(this.population);
    this.stats.contentHistory.push(this.averageContentment);
    if (this.stats.coinHistory.length > 240) {
      this.stats.coinHistory.shift(); this.stats.popHistory.shift(); this.stats.contentHistory.shift();
    }
    this.stats.producedToday = {};
    this.stats.consumedToday = {};
  }

  /**
   * The farming year. Season boundaries reset the field state machine; the
   * daily grind of sowing, tending and reaping is villager labour (cropLoop).
   */
  private cropCycle(): void {
    const firstDayOf = this.dayOfSeason === 0;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.def.crop) continue;

      if (this.season === 'summer' && b.sown) {
        // Sun and rain do a little of the tending on their own.
        b.growth = Math.min(1, b.growth + TUNING.passiveGrowth);
      }

      if (!firstDayOf) continue;
      switch (this.season) {
        case 'spring':
          b.sown = false; b.sowProgress = 0; b.growth = 0;
          b.cropPool = 0; b.cropPoolInit = 0; b.workAccum = 0;
          b.sownCrop = null;
          break;
        case 'autumn': {
          // Whatever stands in the field when autumn opens is the harvest.
          const variety = b.standingCrop;
          const pool = b.growth * variety.yieldPerTile * b.area
            * (0.35 + b.fertility * 0.9) * b.rotationFactor;
          b.cropPool = pool;
          b.cropPoolInit = Math.max(0.01, pool);
          // A real harvest tires the soil — unless it was a legume, which feeds it.
          if (b.growth > 0.15) {
            this.drainSoil(b, TUNING.fertilityPerHarvest * b.growth * variety.soilDrain);
          }
          break;
        }
        case 'winter': {
          if (b.cropPool > 1 && b.cropPoolInit > 1) {
            this.log('Part of a harvest froze in the field — it was not reaped in time.', 'bad');
          }
          b.cropPool = 0; b.growth = 0; b.sown = false;
          break;
        }
      }
    }
  }

  /** Positive `amount` tires the ground; negative enriches it (legumes). */
  private drainSoil(b: Building, amount: number): void {
    const w = this.world;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        // Enriching can push past the natural baseline, but only so far.
        const ceiling = Math.min(1, w.fertilityBase[i] + 0.25);
        w.fertility[i] = Math.max(0.05, Math.min(ceiling, w.fertility[i] - amount));
      }
    }
    b.fertility = w.avgFertility(b.x, b.y, b.w, b.h);
  }

  /** Rested ground slowly recovers toward the fertility it was born with. */
  private soilDrift(): void {
    const w = this.world;
    for (let i = 0; i < w.fertility.length; i++) {
      if (w.occupied[i] >= 0) continue;
      const base = w.fertilityBase[i];
      if (w.fertility[i] < base) {
        w.fertility[i] = Math.min(base, w.fertility[i] + TUNING.fertilityRegen);
      }
    }
  }

  /** Standing sell-above / buy-below orders, settled once a day. */
  private runTradeOrders(): void {
    if (!this.canTrade()) return;
    for (const k in this.tradeRules) {
      const res = k as ResId;
      const rule = this.tradeRules[res];
      if (!rule) continue;
      const stock = this.stockOf(res);
      if (rule.sellAbove != null && stock > rule.sellAbove + 1) {
        const qty = Math.min(stock - rule.sellAbove, 40);
        const r = this.sell(res, qty);
        if (r.ok) this.log(`Standing order: ${r.msg}`, 'info');
      } else if (rule.buyBelow != null && stock < rule.buyBelow - 1 && this.coin > 60) {
        const qty = Math.min(rule.buyBelow - stock, 20);
        const r = this.buy(res, qty);
        if (r.ok) this.log(`Standing order: ${r.msg}`, 'info');
      }
    }
  }

  private regrowNodes(): void {
    const w = this.world;
    for (let i = 0; i < w.regrowAt.length; i++) {
      if (w.regrowAt[i] >= 0 && this.day >= w.regrowAt[i]) {
        const kind = this.regrowKind.get(i) ?? 'berry';
        const amt = kind === 'clay' ? 10 : kind === 'fish' ? 8 : 3;
        w.setNode(i, kind, amt);
        this.regrowKind.delete(i);
        if (kind === 'tree') this.newTrees.push(i);
      }
    }
  }

  private ageAndHealth(): void {
    const daysPerYear = TUNING.daysPerSeason * 4;
    for (const v of this.villagers.values()) {
      v.age += 1 / daysPerYear;
      const home = v.homeId >= 0 ? this.buildings.get(v.homeId) : undefined;
      const healer = this.serviceLevel('health', v.x, v.y).level > 0;
      let drift = 0.01;
      if (home) {
        if (home.supply.foodDays <= 0.01) drift -= 0.10;
        if (home.supply.fuelDays <= 0.01 && (this.season === 'winter' || this.season === 'autumn')) drift -= 0.07;
        if (home.contentment > 0.6) drift += 0.01;
      } else {
        drift -= 0.05;
      }
      if (healer) drift += 0.035;
      if (this.season === 'winter') drift -= 0.015;
      v.health = Math.max(0, Math.min(1, v.health + drift));
    }
  }

  /** The core needs loop: markets feed homes, homes become content or don't. */
  private householdNeeds(): void {
    const fuelFactor = TUNING.fuelSeason[this.season];

    for (const home of this.buildings.values()) {
      if (home.state !== 'active' || !home.isHouse) continue;
      const people = home.residents.length;
      if (people === 0) { home.contentment = 0.5; continue; }

      // Homes shop at the market. With no market in range they can still raid
      // a nearby storehouse, but they get no choice and no comforts.
      let markets = this.marketsNear(home.cx, home.cy);
      const fallback = markets.length === 0;
      if (fallback) {
        markets = [...this.buildings.values()]
          .filter((b) => b.state === 'active' && b.isStorage && Math.hypot(b.cx - home.cx, b.cy - home.cy) <= 22)
          .sort((a, b) => Math.hypot(a.cx - home.cx, a.cy - home.cy) - Math.hypot(b.cx - home.cx, b.cy - home.cy));
      }
      // Last resort: if the stall is bare, a household will walk to the nearest
      // storehouse and ration. A village must never starve beside a full
      // granary just because no one is minding the stall.
      const reserves = fallback ? [] : [...this.buildings.values()]
        .filter((b) => b.state === 'active' && b.isStorage && Math.hypot(b.cx - home.cx, b.cy - home.cy) <= 26)
        .sort((a, b) => Math.hypot(a.cx - home.cx, a.cy - home.cy) - Math.hypot(b.cx - home.cx, b.cy - home.cy));

      const s = home.supply;
      s.foodTypes.clear(); s.clothingTypes.clear(); s.luxuryTypes.clear();

      // --- Food: draw a day's worth, preferring variety.
      let foodNeed = people * TUNING.foodPerDay;
      const foodOrder = [...FOOD_TYPES].sort((a, b) => this.marketStock(markets, b) - this.marketStock(markets, a));
      // First pass: one portion of each available type, for variety.
      for (const f of foodOrder) {
        if (foodNeed <= 0.01) break;
        const got = this.drawFromMarkets(markets, f, Math.min(foodNeed, people * 0.34));
        if (got > 0.01) { s.foodTypes.add(f); foodNeed -= got; this.countConsumed(f, got); }
      }
      // Second pass: fill the rest with whatever there is.
      for (const f of foodOrder) {
        if (foodNeed <= 0.01) break;
        const got = this.drawFromMarkets(markets, f, foodNeed);
        if (got > 0.01) { s.foodTypes.add(f); foodNeed -= got; this.countConsumed(f, got); }
      }
      // Third pass: rationing. Fills bellies but earns no variety credit, so a
      // rationing village never climbs the housing tiers.
      let rationed = false;
      for (const f of foodOrder) {
        if (foodNeed <= 0.01) break;
        const got = this.drawFromMarkets(reserves, f, foodNeed);
        if (got > 0.01) { foodNeed -= got; rationed = true; this.countConsumed(f, got); }
      }
      if (rationed) home.rationing = true; else home.rationing = false;
      const foodMet = 1 - foodNeed / Math.max(0.001, people * TUNING.foodPerDay);
      s.foodDays = foodMet;

      // --- Fuel
      const households = Math.max(1, home.families);
      const fuelNeed = households * TUNING.fuelPerDay * fuelFactor;
      let fuelGot = this.drawFromMarkets(markets, 'firewood', fuelNeed);
      if (fuelGot < fuelNeed - 0.01) fuelGot += this.drawFromMarkets(reserves, 'firewood', fuelNeed - fuelGot);
      this.countConsumed('firewood', fuelGot);
      s.fuelDays = fuelNeed <= 0.001 ? 1 : fuelGot / fuelNeed;

      // --- Clothing (slow wear, so this is mostly about having any at all)
      const clothNeed = households * TUNING.clothingPerDay;
      let clothGot = 0;
      for (const c of CLOTHING_TYPES) {
        const got = this.drawFromMarkets(markets, c, clothNeed);
        if (got > 0.0001) { s.clothingTypes.add(c); clothGot += got; this.countConsumed(c, got); }
        else if (this.marketStock(markets, c) > 0.5) s.clothingTypes.add(c);
      }
      s.clothing = Math.min(1, clothGot / Math.max(0.0001, clothNeed));
      // A market that stocks a clothing type counts as supplying it even in a
      // week where nothing wore out.
      for (const c of CLOTHING_TYPES) if (this.marketStock(markets, c) > 0.5) s.clothingTypes.add(c);

      // --- Comforts
      const luxNeed = households * TUNING.luxuryPerDay;
      let luxGot = 0;
      for (const l of LUXURY_TYPES) {
        if (this.marketStock(markets, l) > 0.5) s.luxuryTypes.add(l);
        const got = this.drawFromMarkets(markets, l, luxNeed);
        if (got > 0.0001) { luxGot += got; this.countConsumed(l, got); }
      }
      s.luxury = Math.min(1, luxGot / Math.max(0.0001, luxNeed));

      // --- Services and beauty
      home.services = {};
      for (const k of SERVICE_KINDS) {
        const lvl = this.serviceLevel(k, home.cx, home.cy).level;
        if (lvl > 0) home.services[k] = lvl;
      }
      home.localCharm = this.charmAt(home.cx, home.cy);

      // Raiding a storehouse feeds a family but never impresses it: no variety
      // credit, and comforts do not count as delivered.
      if (fallback) {
        const keep = [...s.foodTypes][0];
        s.foodTypes.clear();
        if (keep) s.foodTypes.add(keep);
        s.clothingTypes.clear();
        s.luxuryTypes.clear();
      }

      // --- Contentment
      const variety = Math.min(1, s.foodTypes.size / 3);
      const hasWater = (home.services.water ?? 0) > 0 ? 1 : 0;
      const faith = Math.min(1, (home.services.faith ?? 0) / 2);
      const leisure = (home.services.leisure ?? 0) > 0 ? 1 : 0;
      const health = (home.services.health ?? 0) > 0 ? 1 : 0;
      const charmScore = Math.min(1, home.localCharm / 20);
      const crowding = home.def.id === 'longhouse' ? -0.1 : 0;

      const target =
        foodMet * 0.34 +
        variety * 0.08 +
        Math.min(1, s.fuelDays) * (this.season === 'winter' ? 0.20 : 0.14) +
        Math.min(1, s.clothing * 4 + (s.clothingTypes.size ? 0.6 : 0)) * 0.08 +
        hasWater * 0.09 +
        faith * 0.08 +
        leisure * 0.07 +
        health * 0.05 +
        charmScore * 0.09 +
        Math.min(1, s.luxury * 4 + (s.luxuryTypes.size ? 0.5 : 0)) * 0.06 +
        crowding;

      // Contentment moves gradually — one bad day should not empty a village.
      home.contentment += (Math.max(0, Math.min(1, target)) - home.contentment) * 0.34;
    }
  }

  private countConsumed(res: ResId, amt: number): void {
    this.stats.consumedToday[res] = (this.stats.consumedToday[res] ?? 0) + amt;
  }

  private marketStock(markets: Building[], res: ResId): number {
    let t = 0;
    for (const m of markets) t += m.amount(res);
    return t;
  }

  private drawFromMarkets(markets: Building[], res: ResId, amt: number): number {
    let left = amt;
    for (const m of markets) {
      if (left <= 0.001) break;
      left -= m.take(res, left);
    }
    return amt - left;
  }

  private housingAndTiers(): void {
    for (const home of this.buildings.values()) {
      if (home.state !== 'active' || !home.isHouse) continue;
      const next = HOUSE_TIERS[home.tier]; // tier is 1-based, so this is the next rung
      home.upgradeBlockers = [];
      if (!next) { home.upgradeReady = false; continue; }
      const s = home.supply;
      const blockers: string[] = [];
      if (s.foodTypes.size < next.foodTypes) blockers.push(`${next.foodTypes} food types (has ${s.foodTypes.size})`);
      if (s.clothingTypes.size < next.clothingTypes) blockers.push(`${next.clothingTypes} clothing type${next.clothingTypes > 1 ? 's' : ''}`);
      if (s.luxuryTypes.size < next.luxuryTypes) blockers.push(`${next.luxuryTypes} comfort goods`);
      if (next.fuel && s.fuelDays < 0.5) blockers.push('firewood at the market');
      if (next.water && !(home.services.water ?? 0)) blockers.push('a well in range');
      if (next.faith > (home.services.faith ?? 0)) blockers.push(next.faith >= 2 ? 'a stone church' : 'a chapel');
      if (next.leisure && !(home.services.leisure ?? 0)) blockers.push('a tavern serving ale');
      if (home.localCharm < next.charm) blockers.push(`charm ${next.charm} (has ${home.localCharm.toFixed(0)})`);
      if (home.contentment < 0.55) blockers.push('a contented household');

      home.upgradeBlockers = blockers;
      home.upgradeReady = blockers.length === 0;
      if (home.upgradeReady) {
        home.tier = next.tier;
        const surname = this.familyOf(home)?.surname ?? 'household';
        this.log(`The ${surname} home became a ${next.name}.`, 'good');
      } else if (home.tier > 1 && (s.foodDays < 0.3 || (next.water && !(home.services.water ?? 0)))) {
        // Sustained neglect knocks a house back down a rung.
        home.downgradeStrikes = (home.downgradeStrikes ?? 0) + 1;
        if (home.downgradeStrikes > 4) {
          home.tier--; home.downgradeStrikes = 0;
          this.log('A household fell on hard times and lost its standing.', 'bad');
        }
      } else {
        home.downgradeStrikes = 0;
      }
    }
  }

  private birthsAndDeaths(): void {
    const dying: Villager[] = [];
    for (const v of this.villagers.values()) {
      if (v.age >= v.lifespan) { dying.push(v); continue; }
      if (v.health <= 0) { dying.push(v); continue; }
    }
    for (const v of dying) {
      const cause = v.age >= v.lifespan ? 'of old age' : 'of hardship';
      this.removeVillager(v);
      this.log(`${v.name} died ${cause}.`, cause === 'of old age' ? 'info' : 'bad');
    }

    // Births
    const foodStock = FOOD_TYPES.reduce((s, f) => s + this.stockOf(f), 0);
    const foodPerHead = foodStock / Math.max(1, this.population);
    for (const home of this.buildings.values()) {
      if (home.state !== 'active' || !home.isHouse) continue;
      const cap = home.capacityResidents;
      if (home.residents.length >= cap) continue;
      const adults = home.residents
        .map((id) => this.villagers.get(id))
        .filter((v): v is Villager => !!v && v.isAdult && v.age < 45);
      if (adults.length < 2) continue;
      if (home.contentment < TUNING.birthContentment) continue;
      if (foodPerHead < 1.5) continue;
      const chance = 0.05 * home.contentment * Math.min(1, foodPerHead / 4);
      if (this.rand() < chance) {
        // The child is born into the family of one of the adults present.
        const parent = adults.find((a) => a.familyId >= 0) ?? adults[0];
        let fam = this.families.get(parent.familyId);
        if (!fam) fam = this.foundFamily(home);
        const baby = new Villager(home.cx, home.cy + 1, 0, () => this.rand());
        baby.homeId = home.id;
        baby.familyId = fam.id;
        baby.takeSurname(fam.surname);
        fam.memberIds.push(baby.id);
        fam.childrenBorn++;
        home.residents.push(baby.id);
        this.villagers.set(baby.id, baby);
        baby.educated = this.serviceLevel('learning', home.cx, home.cy).level > 0;
        if (baby.educated) baby.skill += 0.15;
        this.log(`${baby.name} was born to the ${fam.surname} family.`, 'good');
      }
    }

    // Emigration: sustained misery drives people out.
    for (const v of [...this.villagers.values()]) {
      const home = v.homeId >= 0 ? this.buildings.get(v.homeId) : undefined;
      const c = home?.contentment ?? 0.15;
      if (c < TUNING.leaveContentment && v.isAdult && this.rand() < 0.02) {
        this.removeVillager(v);
        this.log(`${v.name} left the valley in search of better.`, 'bad');
      }
    }
  }

  private removeVillager(v: Villager): void {
    v.releaseAll(this);
    if (v.familyId >= 0) {
      const fam = this.families.get(v.familyId);
      if (fam) {
        fam.memberIds = fam.memberIds.filter((id) => id !== v.id);
        this.retireFamily(fam);
      }
    }
    if (v.jobId >= 0) {
      const b = this.buildings.get(v.jobId);
      if (b) b.workers = b.workers.filter((id) => id !== v.id);
    }
    if (v.homeId >= 0) {
      const h = this.buildings.get(v.homeId);
      if (h) h.residents = h.residents.filter((id) => id !== v.id);
    }
    this.villagers.delete(v.id);
    this.reassignPending = true;
  }

  private immigration(): void {
    // Spare beds + a contented, well-fed village attracts newcomers.
    let spare = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' && b.isHouse) spare += Math.max(0, b.capacityResidents - b.residents.length);
    }
    if (spare <= 0) return;
    const content = this.averageContentment;
    if (content < 0.5) return;
    const foodStock = FOOD_TYPES.reduce((s, f) => s + this.stockOf(f), 0);
    if (foodStock < this.population * 2) return;
    const chance = 0.16 * (content - 0.45) * Math.min(3, spare);
    if (this.rand() < chance) {
      const v = new Villager(this.startX, this.startY, 17 + Math.floor(this.rand() * 16), () => this.rand());
      this.villagers.set(v.id, v);
      this.housingFor(v);
      // A newcomer either marries into a household with room, or founds one.
      const home = v.homeId >= 0 ? this.buildings.get(v.homeId) : undefined;
      const host = home && home.familyIds.length < home.capacityFamilies
        ? undefined
        : home ? this.familyOf(home) : undefined;
      let fam = host;
      if (!fam) {
        const roomy = home && home.familyIds.length < home.capacityFamilies
          ? home : this.homeWithFamilyRoom(this.startX, this.startY);
        fam = this.foundFamily(roomy);
        if (fam.homeId >= 0 && v.homeId !== fam.homeId) {
          const h = this.buildings.get(fam.homeId);
          if (h && h.residents.length < h.capacityResidents) {
            if (home) home.residents = home.residents.filter((id) => id !== v.id);
            v.homeId = h.id;
            h.residents.push(v.id);
          }
        }
      }
      v.familyId = fam.id;
      fam.memberIds.push(v.id);
      v.takeSurname(fam.surname);
      this.reassignPending = true;
      this.log(`${v.name} arrived looking for a home.`, 'good');
    }
    // Orphaned villagers find whatever bed exists.
    for (const v of this.villagers.values()) if (v.homeId < 0) this.housingFor(v);
  }

  // ------------------------------------------------------------ season tick

  private seasonTick(prev: Season): void {
    // The turn of the season reshuffles the workforce: out-of-season crews
    // (winter foragers, dormant orchards) stand down so their hands are free
    // for the mill, the woodshed and the building sites.
    if (this.autoAssign) {
      for (const b of this.buildings.values()) {
        if (b.state !== 'active' || !b.workers.length) continue;
        if (this.autoPriority(b) < 1) {
          for (const id of b.workers) {
            const v = this.villagers.get(id);
            if (v) { v.jobId = -1; v.releaseAll(this); }
          }
          b.workers = [];
        }
      }
      this.reassignPending = true;
    }
    // Tax and upkeep settle at the turn of each season.
    let tax = 0;
    for (const b of this.buildings.values()) {
      if (b.state !== 'active') continue;
      if (b.isHouse) tax += b.tierDef().tax * Math.max(1, b.families) * (0.6 + b.contentment * 0.6);
    }
    const hasHall = this.hasBuilding('townhall');
    tax = hasHall ? tax : tax * 0.25;
    let upkeep = 0;
    for (const b of this.buildings.values()) {
      if (b.state === 'active' && b.def.upkeep) upkeep += b.def.upkeep;
    }
    this.coin += tax - upkeep;
    this.stats.lastTax = tax;
    this.stats.lastUpkeep = upkeep;

    this.log(
      `${this.season[0].toUpperCase() + this.season.slice(1)} of year ${this.year}. ` +
      `Tax ${Math.round(tax)}c, upkeep ${Math.round(upkeep)}c.`,
      tax >= upkeep ? 'info' : 'bad',
    );

    if (this.season === 'winter') {
      this.log('Winter closes in. Firewood burns four times faster now.', 'bad');
    }
    if (this.season === 'spring') {
      this.log('The thaw arrives. Fields can be sown again.', 'good');
    }

    if (this.coin < 0) {
      this.log('The treasury is empty. Upkeep is eating the village alive.', 'bad');
    }

    // Food spoils slowly outside a granary.
    const hasGranary = this.hasBuilding('granary');
    if (!hasGranary) {
      for (const f of FOOD_TYPES) {
        const spoiled = this.stockOf(f) * 0.08;
        if (spoiled > 0.5) this.takeFromStores(f, spoiled);
      }
    }
    void prev;
  }

  // ------------------------------------------------------------------ trade

  priceOf(res: ResId): number {
    return RESOURCES[res].price * (this.trade.mod[res] ?? 1);
  }
  sellPrice(res: ResId): number { return this.priceOf(res) * (1 - TUNING.tradeSpread); }
  buyPrice(res: ResId): number { return this.priceOf(res) * (1 + TUNING.tradeSpread); }

  canTrade(): boolean { return this.hasBuilding('tradepost'); }

  sell(res: ResId, amt: number): { ok: boolean; msg: string } {
    if (!this.canTrade()) return { ok: false, msg: 'You need a Trading Post.' };
    const have = this.stockOf(res);
    const qty = Math.min(amt, have);
    if (qty < 1) return { ok: false, msg: `No ${RESOURCES[res].name} in store.` };
    const unit = this.sellPrice(res);
    this.takeFromStores(res, qty);
    const income = unit * qty;
    this.coin += income;
    this.stats.lastTradeIncome += income;
    this.trade.mod[res] = Math.max(0.45, (this.trade.mod[res] ?? 1) - qty * TUNING.priceElasticity);
    this.trade.soldToday[res] = (this.trade.soldToday[res] ?? 0) + qty;
    return { ok: true, msg: `Sold ${Math.round(qty)} ${RESOURCES[res].name} for ${Math.round(income)}c.` };
  }

  buy(res: ResId, amt: number): { ok: boolean; msg: string } {
    if (!this.canTrade()) return { ok: false, msg: 'You need a Trading Post.' };
    const post = [...this.buildings.values()].find((b) => b.defId === 'tradepost' && b.state === 'active');
    if (!post) return { ok: false, msg: 'No Trading Post.' };
    const unit = this.buyPrice(res);
    const affordable = Math.floor(this.coin / unit);
    const room = post.freeSpace(res);
    const qty = Math.min(amt, affordable, room);
    if (qty < 1) {
      if (affordable < 1) return { ok: false, msg: 'Not enough coin.' };
      return { ok: false, msg: 'The Trading Post is full.' };
    }
    this.coin -= unit * qty;
    post.add(res, qty);
    this.trade.mod[res] = Math.min(2.2, (this.trade.mod[res] ?? 1) + qty * TUNING.priceElasticity);
    this.trade.boughtToday[res] = (this.trade.boughtToday[res] ?? 0) + qty;
    return { ok: true, msg: `Bought ${Math.round(qty)} ${RESOURCES[res].name} for ${Math.round(unit * qty)}c.` };
  }

  private decayTradePrices(): void {
    for (const res of ALL_RES) {
      const m = this.trade.mod[res] ?? 1;
      if (Math.abs(m - 1) < 0.001) { delete this.trade.mod[res]; continue; }
      this.trade.mod[res] = m + (1 - m) * TUNING.priceRecovery * 4;
    }
    this.trade.soldToday = {};
    this.trade.boughtToday = {};
  }

  // ----------------------------------------------------------------- alerts

  private recomputeAlerts(): void {
    const a: Alert[] = [];
    const foodStock = FOOD_TYPES.reduce((s, f) => s + this.stockOf(f), 0);
    const daysOfFood = foodStock / Math.max(0.01, this.population * TUNING.foodPerDay);
    if (this.population > 0 && daysOfFood < 2) {
      a.push({ id: 'food', text: `Only ${daysOfFood.toFixed(1)} days of food left`, severity: 'danger' });
    } else if (daysOfFood < 5) {
      a.push({ id: 'food', text: 'Food stores are running low', severity: 'warn' });
    }

    const fuel = this.stockOf('firewood');
    const winterish = this.season === 'autumn' || this.season === 'winter';
    if (winterish && fuel < this.population * 1.5) {
      a.push({ id: 'fuel', text: 'Not enough firewood for the cold', severity: this.season === 'winter' ? 'danger' : 'warn' });
    } else if (this.population > 4 && fuel < 1) {
      a.push({ id: 'fuel', text: 'No firewood at all — build a woodshed before winter', severity: 'warn' });
    }

    if (this.homeless > 0) a.push({ id: 'homeless', text: `${this.homeless} villagers have no home`, severity: 'warn' });
    if (!this.hasBuilding('market') && this.population > 4) {
      a.push({ id: 'market', text: 'No market — homes cannot collect goods', severity: 'danger' });
    }
    if (this.idleAdults > Math.max(3, this.adults * 0.4)) {
      a.push({ id: 'idle', text: `${this.idleAdults} villagers have no work`, severity: 'warn' });
    }
    const cap = this.storageCapacity();
    if (cap > 0 && this.storageUsed() > cap * 0.92) {
      a.push({ id: 'storage', text: 'Storage is nearly full', severity: 'warn' });
    }
    if (this.coin < 0) a.push({ id: 'coin', text: 'The treasury is in debt', severity: 'danger' });

    // Sites that can never finish because the village makes none of what they need.
    const blocked = new Set<string>();
    for (const b of this.buildings.values()) {
      if (b.state === 'active' || b.paused || b.materialsComplete()) continue;
      for (const k of Object.keys(b.outstandingMaterials()) as ResId[]) {
        if (this.totalOf(k) < 1) blocked.add(RESOURCES[k].name);
      }
    }
    if (blocked.size) {
      a.push({
        id: 'blocked',
        text: `Building sites are waiting on ${[...blocked].slice(0, 3).join(', ')}`,
        severity: 'warn',
      });
    }
    this.alerts = a;
  }

  recordTransfer(from: number, to: number, res: ResId, amt: number): void {
    if (from < 0 || to < 0 || amt < 0.5) return;
    this.transfers.push({ from, to, res, amt, t: this.t });
    if (this.transfers.length > 120) this.transfers.splice(0, this.transfers.length - 120);
  }

  /** Transfers touching this building in the recent past, newest first. */
  transfersFor(id: number, horizon = 120): { from: number; to: number; res: ResId; amt: number; t: number }[] {
    const cutoff = this.t - horizon;
    return this.transfers.filter((x) => (x.from === id || x.to === id) && x.t >= cutoff).reverse();
  }

  /** Goods abandoned because there was nowhere to put them. */
  lostGoods: Amounts = {};
  private lastLostWarning = -99;

  noteLostGoods(res: ResId, amt: number): void {
    this.lostGoods[res] = (this.lostGoods[res] ?? 0) + amt;
    if (this.day - this.lastLostWarning >= 2) {
      this.lastLostWarning = this.day;
      this.log(`${RESOURCES[res].name} was left to spoil — the village has no room for it.`, 'bad');
    }
  }

  log(text: string, kind: GameEvent['kind'] = 'info'): void {
    this.events.push({ day: this.day, text, kind });
    if (this.events.length > 200) this.events.shift();
  }

  /**
   * Bring a freshly-deserialised game back to a runnable state: rebuild the
   * derived indexes that are cheaper to recompute than to store.
   */
  afterLoad(): void {
    this.refreshServices();
    // Workers list and villager.jobId must agree; trust the villagers.
    for (const b of this.buildings.values()) {
      b.workers = b.workers.filter((id) => this.villagers.get(id)?.jobId === b.id);
    }

    // The reservation ledger is derived state, not saved state. Every trip was
    // abandoned on load, so no goods are claimed or pledged: start from empty
    // rather than trying to persist a two-sided bookkeeping structure that can
    // only ever disagree with itself.
    for (const b of this.buildings.values()) {
      b.reservedOut = {};
      b.incoming = {};
    }
    this.claimedNodes.clear();

    // Oxen are counted, not owned: recount from who is actually holding one.
    this.oxenInUse = 0;
    const stabled = this.oxenTotal;
    for (const v of this.villagers.values()) {
      if (!v.hasOx) continue;
      if (this.oxenInUse < stabled) this.oxenInUse++;
      else v.hasOx = false; // stable was demolished under them
    }

    this.recomputeAlerts();
    this.reassignPending = true;
  }

  // --------------------------------------------------------------- helpers

  buildingsOfCat(cat: BuildingDef['cat']): Building[] {
    return [...this.buildings.values()].filter((b) => b.def.cat === cat);
  }

  /** Net production per day for the resource dashboard. */
  netFlow(res: ResId): number {
    return (this.stats.producedToday[res] ?? 0) - (this.stats.consumedToday[res] ?? 0);
  }
}
