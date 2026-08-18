/**
 * The simulation.
 *
 * `Game` is the state and the clock: it owns the world, the buildings, the
 * villagers and the households, and it drives the tick. Everything that
 * *decides* anything lives in `./systems` — one file per concern, each a set
 * of plain functions taking the game as their first argument. There is no
 * entity-component framework here and no event bus; a system is just a module
 * that knows how to do one job to a village.
 *
 * Renderer-free by design, so `npm run sim` can play whole years in seconds
 * (see tools/headless.ts). Nothing in this directory may import from
 * ../render — that separation is what makes the economy testable at all.
 *
 * The methods below that only forward into a system are there so that
 * `game.stockOf(…)` still reads the way it did, and so the UI and the
 * villagers keep one obvious surface to talk to.
 */

import {
  RESOURCES, SEASONS, TUNING,
  type Amounts, type Harvest, type NodeKind, type ResId,
  type Season, type ServiceKind,
} from './defs';
import type { Building } from './building';
import type { Family } from './family';
import { Villager } from './villager';
import { Pathfinder, RNG, World } from './world';

import * as inventory from './systems/inventory';
import * as queries from './systems/queries';
import * as nodes from './systems/nodes';
import * as services from './systems/services';
import * as families from './systems/families';
import * as labour from './systems/labour';
import * as placement from './systems/placement';
import * as farming from './systems/farming';
import * as needs from './systems/needs';
import * as population from './systems/population';
import * as trade from './systems/trade';
import * as alerts from './systems/alerts';
import type { Haul } from './systems/hauling';
import { seasonTick } from './systems/seasons';
import { setupStart } from './systems/founding';

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
  lastDay = -1;
  lastHourTick = -1;

  startX = 0;
  startY = 0;
  /** Which regrowing tile is going to come back as what. */
  regrowKind = new Map<number, NodeKind>();
  /** Tiles the renderer still needs to spawn trees for. */
  newTrees: number[] = [];
  /** Tiles the renderer needs to clear. */
  removedNodes: number[] = [];
  /** Goods abandoned because there was nowhere to put them. */
  lostGoods: Amounts = {};

  /** The seed this valley was generated from — needed to rebuild it on load. */
  readonly seed: number;

  // --- Internal: owned by Game, read and written by ./systems. -------------
  // TypeScript has no package-private, so these cannot be `private` without
  // the systems having to go through accessors that would earn their keep in
  // no other way.

  /** Rebuilt each hour: which services reach which tiles. */
  serviceIndex = new Map<ServiceKind, Building[]>();
  /**
   * Open hauling claims, by receipt id (see systems/hauling.ts). Derived
   * state: every trip is abandoned on load, so a fresh game starts empty.
   */
  hauls = new Map<number, Haul>();
  nextHaulId = 1;
  /** Set whenever the workforce needs re-sorting; consumed by the next step. */
  reassignPending = true;
  /**
   * A second stream used only for cosmetic choices (surnames). Kept apart from
   * `rng` so that naming a family can never shift the simulation's dice.
   */
  flavourRng: RNG;
  lastLostWarning = -99;

  constructor(seed = Math.floor(Math.random() * 1e9), skipSetup = false) {
    this.seed = seed;
    this.world = new World({ size: 96, seed });
    this.path = new Pathfinder(this.world);
    this.rng = new RNG(seed ^ 0x9e3779b9);
    this.flavourRng = new RNG(seed ^ 0x517cc1b7);
    if (!skipSetup) setupStart(this);
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

    if (this.reassignPending) labour.reassign(this);

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
      if (this.season !== prevSeason) seasonTick(this, prevSeason);
    }
  }

  private hourTick(): void {
    services.refreshServices(this);
    services.consumeServiceGoods(this);
    alerts.recomputeAlerts(this);
  }

  private dayTick(): void {
    nodes.regrowNodes(this);
    farming.cropCycle(this);
    farming.soilDrift(this);
    population.ageAndHealth(this);
    needs.householdNeeds(this);
    needs.housingAndTiers(this);
    population.birthsAndDeaths(this);
    population.immigration(this);
    families.reconcileFamilies(this);
    trade.runTradeOrders(this);
    trade.decayTradePrices(this);

    if (this.autoAssign) labour.reassign(this);

    this.stats.coinHistory.push(this.coin);
    this.stats.popHistory.push(this.population);
    this.stats.contentHistory.push(this.averageContentment);
    if (this.stats.coinHistory.length > 240) {
      this.stats.coinHistory.shift(); this.stats.popHistory.shift(); this.stats.contentHistory.shift();
    }
    this.stats.producedToday = {};
    this.stats.consumedToday = {};
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

  // ------------------------------------------------------------- bookkeeping

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
    services.refreshServices(this);
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

    alerts.recomputeAlerts(this);
    this.reassignPending = true;
  }

  // ----------------------------------------------------- system pass-throughs
  // Thin forwarding, so callers keep one surface. Anything with real logic
  // belongs in ./systems, not here.

  // placement
  canPlace(defId: string, x: number, y: number, w?: number, h?: number): { ok: boolean; reason?: string } {
    return placement.canPlace(this, defId, x, y, w, h);
  }
  place(defId: string, x: number, y: number, w?: number, h?: number): Building | null {
    return placement.place(this, defId, x, y, w, h);
  }
  demolish(id: number): void { placement.demolish(this, id); }
  completeBuilding(b: Building, silent = false): void { placement.completeBuilding(this, b, silent); }
  hasBuilding(defId: string): boolean { return placement.hasBuilding(this, defId); }

  // inventory
  stockOf(res: ResId): number { return inventory.stockOf(this, res); }
  totalOf(res: ResId): number { return inventory.totalOf(this, res); }
  netFlow(res: ResId): number { return inventory.netFlow(this, res); }

  // villager queries
  findSource(res: ResId, x: number, y: number, min = 1): Building | undefined {
    return queries.findSource(this, res, x, y, min);
  }
  findSourceAny(res: ResId, x: number, y: number, min = 1): Building | undefined {
    return queries.findSourceAny(this, res, x, y, min);
  }
  findDestination(res: ResId, x: number, y: number, amt: number): Building | undefined {
    return queries.findDestination(this, res, x, y, amt);
  }
  findPorterPickup(home: Building, x: number, y: number) {
    return queries.findPorterPickup(this, home, x, y);
  }
  findAnyPickup(x: number, y: number) { return queries.findAnyPickup(this, x, y); }
  nearestSiteNeedingWork(x: number, y: number): Building | undefined {
    return queries.nearestSiteNeedingWork(this, x, y);
  }
  randomLandmark(): Building | undefined { return queries.randomLandmark(this); }

  // nodes
  claimNode(b: Building, kind: NodeKind, radius: number): number {
    return nodes.claimNode(this, b, kind, radius);
  }
  releaseNode(i: number): void { nodes.releaseNode(this, i); }
  consumeNode(i: number, hv: Harvest): number { return nodes.consumeNode(this, i, hv); }
  findPlantingSpot(b: Building, radius: number): number { return nodes.findPlantingSpot(this, b, radius); }
  plantTree(i: number): void { nodes.plantTree(this, i); }

  // services
  marketWishlist(m: Building): { res: ResId; amt: number }[] { return services.marketWishlist(this, m); }
  marketsShortOfGoods(): Building[] { return services.marketsShortOfGoods(this); }

  // labour
  setJobSlots(buildingId: number, slots: number): void { labour.setJobSlots(this, buildingId, slots); }
  assignVillager(villagerId: number, buildingId: number | -1): void {
    labour.assignVillager(this, villagerId, buildingId);
  }

  // trade
  sellPrice(res: ResId): number { return trade.sellPrice(this, res); }
  buyPrice(res: ResId): number { return trade.buyPrice(this, res); }
  sell(res: ResId, amt: number): { ok: boolean; msg: string } { return trade.sell(this, res, amt); }
  buy(res: ResId, amt: number): { ok: boolean; msg: string } { return trade.buy(this, res, amt); }
}
