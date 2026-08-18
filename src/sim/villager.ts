/**
 * Villagers: movement, work loops and the hauling behaviour that makes the
 * production chains physical rather than abstract.
 */

import { type ResId, RESOURCES, TUNING } from './defs';
import type { Building } from './building';
import type { Game } from './game';
import type { PathPoint } from './world';
import type { Codecs, Descriptor } from './persist';

export type Action =
  | 'idle' | 'wander' | 'toWork' | 'working'
  | 'toNode' | 'harvesting' | 'planting'
  | 'toPickup' | 'toDrop' | 'toDeposit' | 'toSite' | 'constructing'
  | 'toHome' | 'sleeping' | 'toTavern' | 'relaxing';

const FIRST = [
  'Aldous', 'Beatrix', 'Cedric', 'Dagny', 'Emrys', 'Fenna', 'Godric', 'Halla', 'Ivor', 'Juniper',
  'Kestrel', 'Linnea', 'Merrit', 'Nell', 'Orin', 'Perrin', 'Quilla', 'Rowan', 'Sable', 'Tamsin',
  'Ulric', 'Verity', 'Wren', 'Yarrow', 'Zeph', 'Marlow', 'Odette', 'Bram', 'Clover', 'Elowen',
  'Fable', 'Gwyn', 'Hollis', 'Isolde', 'Jory', 'Kit', 'Lark', 'Mabel', 'Nyle', 'Opal',
];
/** One hauling trip, as asked for by a work loop. See `Villager.beginHaul`. */
interface HaulRequest {
  /** Where the goods are collected from. */
  from: Building;
  res: ResId;
  /** How much to ask for, before capacity and stock clamp it down. */
  want: number;
  /**
   * Who the load is pledged to. `null` means "collect it, decide on arrival" —
   * the porter loops, which clear a workshop without yet knowing which store
   * has room.
   */
  to: Building | null;
  /** Below this the walk is not worth making. */
  min: number;
  verb: 'fetch' | 'collect' | 'site';
  /**
   * Load to weigh an ox against. Defaults to what can actually be picked up;
   * the restocking loop deliberately sizes on what was *asked* for instead, so
   * a big standing order still yokes a cart when the source is running low.
   */
  cartHint?: number;
}

let nextVillagerId = 1;
export function resetVillagerIds(): void { nextVillagerId = 1; }
export function setNextVillagerId(n: number): void { nextVillagerId = n; }
export function peekNextVillagerId(): number { return nextVillagerId; }

export class Villager {
  readonly id: number;
  name: string;
  age: number;
  /** Age at which this villager dies of old age. */
  lifespan: number;
  homeId = -1;
  jobId = -1;
  /** Household this villager belongs to. */
  familyId = -1;

  x: number;
  y: number;
  /** Facing angle, for the renderer. */
  facing = 0;

  path: PathPoint[] = [];
  pathIdx = 0;
  action: Action = 'idle';
  /** What the villager is currently doing, in plain words, for the UI. */
  activity = 'Settling in';

  carry: { res: ResId; amt: number } | null = null;
  /** Building this trip is aimed at. */
  targetB = -1;
  /** Resource + amount this trip is fetching. */
  fetchRes: ResId | null = null;
  fetchAmt = 0;
  /** Tile index of the resource node being worked. */
  targetNode = -1;

  workTimer = 0;
  /** 0.6 → 1.8. Grows slowly with time on the job. */
  skill = 0.85;
  educated = false;
  health = 1;
  /** Cooldown so failed searches do not thrash the pathfinder. */
  retry = 0;
  /** True while this villager has an ox and cart yoked for a haul. */
  hasOx = false;

  constructor(x: number, y: number, age: number, rand: () => number, id?: number) {
    this.id = id ?? nextVillagerId++;
    if (id !== undefined && id >= nextVillagerId) nextVillagerId = id + 1;
    this.x = x; this.y = y;
    this.age = age;
    this.lifespan = 48 + Math.floor(rand() * 20);
    this.name = FIRST[Math.floor(rand() * FIRST.length)];
    this.skill = 0.8 + rand() * 0.2;
  }

  /** How much this villager can shift in one trip — triple it with a cart. */
  get capacity(): number {
    return this.hasOx ? TUNING.cartCapacity : TUNING.carryCapacity;
  }

  /** Given name only until a family adopts them; then "Given Surname". */
  get given(): string { return this.name.split(' ')[0]; }

  /** Take a household's name. The single place a full name is assembled. */
  takeSurname(surname: string): void { this.name = `${this.given} ${surname}`; }

  get isAdult(): boolean { return this.age >= 14 && this.age < 64; }
  get isChild(): boolean { return this.age < 14; }
  get isElder(): boolean { return this.age >= 64; }
  get carrying(): number { return this.carry?.amt ?? 0; }

  get jobTitle(): string {
    if (this.isChild) return 'Child';
    if (this.isElder) return 'Elder';
    return this.jobId >= 0 ? 'Worker' : 'Labourer';
  }

  // ------------------------------------------------------------------ move

  private speed(g: Game): number {
    const w = g.world;
    const tx = Math.round(this.x), ty = Math.round(this.y);
    let s = TUNING.walkSpeed;
    if (w.inBounds(tx, ty) && w.road[w.idx(tx, ty)]) s *= TUNING.roadSpeedBonus;
    if (this.isElder) s *= 0.75;
    if (this.isChild) s *= 0.9;
    s *= 0.85 + this.health * 0.25;
    if (this.carry) s *= 0.9;
    if (this.hasOx) s *= TUNING.cartSpeed;
    return s;
  }

  /** Returns true once the villager reaches the end of its path. */
  private stepPath(g: Game, dt: number): boolean {
    if (this.pathIdx >= this.path.length) return true;
    let budget = this.speed(g) * dt;
    while (budget > 0 && this.pathIdx < this.path.length) {
      const p = this.path[this.pathIdx];
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) { this.pathIdx++; continue; }
      if (d <= budget) {
        this.x = p.x; this.y = p.y; budget -= d; this.pathIdx++;
      } else {
        this.x += (dx / d) * budget; this.y += (dy / d) * budget;
        this.facing = Math.atan2(dx, dy);
        budget = 0;
      }
      if (d > 1e-4) this.facing = Math.atan2(dx, dy);
    }
    return this.pathIdx >= this.path.length;
  }

  private goto(g: Game, tx: number, ty: number, tolerance = 0): boolean {
    const p = g.path.find(this.x, this.y, tx, ty, tolerance);
    if (!p) { this.path = []; this.pathIdx = 0; return false; }
    this.path = p; this.pathIdx = 0;
    return true;
  }

  private gotoBuilding(g: Game, b: Building): boolean {
    return this.goto(g, b.entrance.x, b.entrance.y, 0.5);
  }

  private distTo(bx: number, by: number): number { return Math.hypot(bx - this.x, by - this.y); }

  // ------------------------------------------------------------------ tick

  update(g: Game, dt: number): void {
    if (this.retry > 0) this.retry -= dt;

    const home = this.homeId >= 0 ? g.buildings.get(this.homeId) : undefined;
    const night = !g.isWorkHour;

    // Children and elders keep to the village: they never take a job.
    if (!this.isAdult) {
      this.idleLife(g, dt, home, night);
      return;
    }

    // Night: finish the current delivery, then go home. Anything else is
    // abandoned — and every claim it holds must be handed back, or the goods it
    // pledged stay locked out of the economy for good.
    if (night && this.action !== 'toDrop' && this.action !== 'toSite') {
      if (this.action === 'toPickup' || this.fetchRes) this.cancelHaul(g);
      if (this.targetNode >= 0) { g.releaseNode(this.targetNode); this.targetNode = -1; }
      if (this.carry && this.action !== 'toHome' && this.action !== 'sleeping') {
        // Drop what we hold at the nearest store before turning in.
        if (this.beginDeliver(g)) return;
      }
      this.goHome(g, dt, home);
      return;
    }

    const job = this.jobId >= 0 ? g.buildings.get(this.jobId) : undefined;
    if (job && job.state === 'active' && !job.paused) {
      this.workJob(g, dt, job);
    } else {
      this.labour(g, dt);
    }
  }

  // ------------------------------------------------------------- behaviours

  private idleLife(g: Game, dt: number, home: Building | undefined, night: boolean): void {
    this.activity = this.isChild ? 'Playing' : 'Resting';
    if (night) { this.goHome(g, dt, home); return; }
    if (this.action !== 'wander' || this.pathIdx >= this.path.length) {
      if (this.retry > 0) return;
      const anchor = home ?? g.randomLandmark();
      const ax = anchor ? anchor.cx : g.world.size / 2;
      const ay = anchor ? anchor.cy : g.world.size / 2;
      const tx = Math.round(ax + (g.rand() - 0.5) * 14);
      const ty = Math.round(ay + (g.rand() - 0.5) * 14);
      if (!this.goto(g, tx, ty, 1)) this.retry = 2 + g.rand() * 3;
      this.action = 'wander';
    } else if (this.stepPath(g, dt)) {
      this.retry = 1 + g.rand() * 4;
      this.action = 'idle';
    }
  }

  private goHome(g: Game, dt: number, home: Building | undefined): void {
    this.activity = 'Heading home';
    if (!home) { this.action = 'idle'; return; }
    if (this.action === 'sleeping') {
      this.activity = 'Asleep';
      this.health = Math.min(1, this.health + dt * 0.01);
      return;
    }
    if (this.action !== 'toHome') {
      if (!this.gotoBuilding(g, home)) { this.action = 'idle'; this.retry = 3; return; }
      this.action = 'toHome';
    }
    if (this.stepPath(g, dt)) { this.action = 'sleeping'; this.activity = 'Asleep'; }
  }

  /** Workshop / farm / gathering loop. */
  private workJob(g: Game, dt: number, b: Building): void {
    const def = b.def;

    // Gatherers stack their haul in their own hut and let a porter run it to
    // the stores. Walking to the storehouse after every single tree would eat
    // most of the working day.
    if (this.action === 'toDeposit') {
      this.activity = this.carry ? `Carrying ${RESOURCES[this.carry.res].name.toLowerCase()} back` : 'Returning';
      if (!this.stepPath(g, dt)) return;
      if (this.carry) {
        const placed = b.add(this.carry.res, this.carry.amt);
        const left = this.carry.amt - placed;
        this.carry = left > 0.01 ? { res: this.carry.res, amt: left } : null;
        if (this.carry) { this.action = 'idle'; this.beginDeliver(g); return; }
      }
      this.action = 'idle';
      return;
    }

    // Already committed to a haul? See it through before doing anything else.
    //
    // Every loop below can walk away from a trip that is still in flight: the
    // out-of-season branches call `stayAt`, a full output buffer calls
    // `pickUpFrom`, a bench that got its inputs from a porter meanwhile just
    // walks to the bench. Each of those overwrites `action` and strands the
    // reservation the trip is holding — stock promised at the source and a
    // delivery pledged at the destination, both claimed for ever by a villager
    // who has forgotten about them.
    if (this.action === 'toPickup' || this.action === 'toDrop') { this.doTrip(g, dt); return; }

    // Carrying something? Finish that trip first.
    if (this.carry) { this.doDeliver(g, dt); return; }

    if (def.crop) { this.cropLoop(g, dt, b); return; }
    if (def.harvest) { this.harvestLoop(g, dt, b); return; }
    if (def.plants) { this.plantLoop(g, dt, b); return; }
    if (def.recipe) { this.craftLoop(g, dt, b); return; }
    if (def.service || b.isStorage) { this.tendLoop(g, dt, b); return; }

    // Job with no behaviour (town hall clerk): just be present.
    this.stayAt(g, dt, b, 'Keeping the ledgers');
  }

  private stayAt(g: Game, dt: number, b: Building, label: string): void {
    this.activity = label;
    if (this.distTo(b.entrance.x, b.entrance.y) > 1.2) {
      if (this.action !== 'toWork') {
        if (!this.gotoBuilding(g, b)) { this.retry = 3; this.action = 'idle'; return; }
        this.action = 'toWork';
      }
      this.stepPath(g, dt);
    } else {
      this.action = 'working';
      b.activity = b.activity * 0.98 + 0.02;
    }
  }

  // --- gathering -----------------------------------------------------------

  private harvestLoop(g: Game, dt: number, b: Building): void {
    const hv = b.def.harvest!;

    // The hut has filled up faster than the porters can clear it — run a load
    // to the stores rather than stand idle.
    const stock = b.outputStock();
    let stockTotal = 0;
    for (const k in stock) stockTotal += stock[k as ResId] ?? 0;
    if (stockTotal >= TUNING.carryCapacity * 3 || stockTotal >= b.capacity() * 0.8) {
      if (this.pickUpFrom(g, b, stock)) return;
    }

    if (hv.seasons && !hv.seasons.includes(g.season)) {
      b.status = `Out of season (${hv.seasons.join(', ')})`;
      this.stayAt(g, dt, b, 'Waiting for the season');
      return;
    }

    // Do not fell a tree there is nowhere to put.
    if (b.freeSpace(hv.out) < hv.yield && !g.findDestination(hv.out, b.cx, b.cy, hv.yield)) {
      b.status = 'Nowhere to store the haul';
      this.stayAt(g, dt, b, 'Waiting for storage space');
      return;
    }

    if (this.targetNode < 0) {
      if (this.retry > 0) { this.activity = 'Looking for work'; return; }
      const node = g.claimNode(b, hv.kind, hv.radius);
      if (node < 0) {
        b.status = `No ${hv.kind} left in range`;
        this.retry = 3;
        this.stayAt(g, dt, b, 'Nothing left to gather');
        return;
      }
      this.targetNode = node;
      const nx = node % g.world.size, ny = (node / g.world.size) | 0;
      // Fishermen work the bank, not the water.
      const tol = hv.kind === 'fish' ? 1.6 : 0.9;
      if (!this.goto(g, nx, ny, tol)) {
        g.releaseNode(node); this.targetNode = -1; this.retry = 2; return;
      }
      this.action = 'toNode';
      b.status = 'Working';
    }

    if (this.action === 'toNode') {
      this.activity = `Off to gather ${RESOURCES[hv.out].name.toLowerCase()}`;
      if (this.stepPath(g, dt)) { this.action = 'harvesting'; this.workTimer = 0; }
      return;
    }

    if (this.action === 'harvesting') {
      this.activity = `Gathering ${RESOURCES[hv.out].name.toLowerCase()}`;
      const rate = this.workRate(g);
      this.workTimer += dt * rate;
      b.activity = b.activity * 0.9 + 0.1;
      if (this.workTimer >= hv.work) {
        this.workTimer = 0;
        const yielded = g.consumeNode(this.targetNode, hv);
        g.releaseNode(this.targetNode);
        this.targetNode = -1;
        if (yielded > 0) {
          this.carry = { res: hv.out, amt: yielded };
          b.produced += yielded;
          if (hv.extra) {
            for (const k in hv.extra) {
              const res = k as ResId;
              g.pendingExtras.push({ b, res, amt: hv.extra[res] ?? 0 });
            }
          }
          this.gainSkill(dt);
          // Back to the hut, not all the way to the storehouse.
          if (b.freeSpace(hv.out) >= yielded && this.gotoBuilding(g, b)) {
            this.action = 'toDeposit';
          } else {
            this.beginDeliver(g);
          }
        } else {
          this.action = 'idle';
        }
      }
    }
  }

  private plantLoop(g: Game, dt: number, b: Building): void {
    const pl = b.def.plants!;
    if (pl.seasons && !pl.seasons.includes(g.season)) {
      b.status = 'Waiting for planting season';
      this.stayAt(g, dt, b, 'Waiting for spring');
      return;
    }
    if (this.targetNode < 0) {
      if (this.retry > 0) { this.activity = 'Tending saplings'; return; }
      const spot = g.findPlantingSpot(b, pl.radius);
      if (spot < 0) { b.status = 'Forest is full'; this.retry = 4; this.stayAt(g, dt, b, 'Forest is thriving'); return; }
      this.targetNode = spot;
      const nx = spot % g.world.size, ny = (spot / g.world.size) | 0;
      if (!this.goto(g, nx, ny, 0.9)) {
        // Hand the claim back, exactly as harvestLoop does. Without this, a
        // spot the forester cannot reach stays claimed for ever and the
        // plantable ring around the hut quietly shrinks tile by tile.
        g.releaseNode(spot);
        this.targetNode = -1;
        this.retry = 2;
        return;
      }
      this.action = 'toNode';
      b.status = 'Planting';
    }
    if (this.action === 'toNode') {
      this.activity = 'Off to plant saplings';
      if (this.stepPath(g, dt)) { this.action = 'planting'; this.workTimer = 0; }
      return;
    }
    if (this.action === 'planting') {
      this.activity = 'Planting saplings';
      this.workTimer += dt * this.workRate(g);
      b.activity = b.activity * 0.9 + 0.1;
      if (this.workTimer >= pl.work) {
        this.workTimer = 0;
        g.plantTree(this.targetNode);
        this.targetNode = -1;
        this.action = 'idle';
        this.gainSkill(dt);
      }
    }
  }

  // --- agriculture ---------------------------------------------------------

  /**
   * The farming year, as labour. Spring: walk the furrows sowing. Summer: tend
   * the growing crop. Autumn: reap into the field's own store (hauliers move
   * it on). Winter: the field sleeps and its workers hire out as labourers.
   */
  private cropLoop(g: Game, dt: number, b: Building): void {

    // Grain waiting in the field store? Run a load over when it stacks up.
    const stock = b.outputStock();
    let stockTotal = 0;
    for (const k in stock) stockTotal += stock[k as ResId] ?? 0;
    if (stockTotal >= TUNING.carryCapacity * 2) {
      if (this.pickUpFrom(g, b, stock)) return;
    }

    if (g.season === 'winter') {
      b.status = 'Dormant until spring';
      this.labour(g, dt);
      return;
    }

    if (g.season === 'spring' || (g.season === 'summer' && !b.sown)) {
      if (!b.sown) {
        const variety = b.crop;
        b.status = `Sowing ${variety.name.toLowerCase()}`;
        this.fieldWork(g, dt, b, `Sowing ${variety.name.toLowerCase()}`, (rate) => {
          b.sowProgress += rate * dt;
          if (b.sowProgress >= variety.sowWork * b.area) {
            b.sown = true;
            b.growth = 0.02;
            // Lock in what actually went into the ground, and what the field
            // earns (or loses) for following last year's crop with this one.
            b.rotationFactor = b.rotationFactorFor(variety.id);
            b.sownCrop = variety.id;
            b.lastCrop = variety.id;
          }
        });
        return;
      }
      // Sown early: start tending straight away.
    }

    if ((g.season === 'spring' || g.season === 'summer') && b.sown) {
      if (b.growth >= 1) {
        b.status = 'Ripening';
        this.labour(g, dt); // fully grown — lend a hand elsewhere
        return;
      }
      b.status = `Growing ${b.standingCrop.name.toLowerCase()}`;
      this.fieldWork(g, dt, b, 'Tending the crop', (rate) => {
        b.growth = Math.min(1, b.growth + (rate * dt) / (b.standingCrop.tendWork * b.area));
      });
      return;
    }

    if (g.season === 'autumn') {
      if (b.cropPool <= 0.01) {
        b.status = b.cropPoolInit > 0.02 ? 'Harvest done' : 'Nothing grew this year';
        this.labour(g, dt);
        return;
      }
      const reaping = b.standingCrop;
      b.status = `Reaping ${reaping.name.toLowerCase()}`;
      this.fieldWork(g, dt, b, 'Reaping the harvest', (rate) => {
        this.workTimer += rate * dt;
        const batch = reaping.harvestWork * 2;
        if (this.workTimer >= batch) {
          this.workTimer = 0;
          const amt = Math.min(b.cropPool, 2);
          b.cropPool -= amt;
          b.add(reaping.out, amt);
          b.produced += amt;
          // The standing crop visibly shrinks as it is reaped.
          b.growth = Math.max(0, b.growth * (b.cropPool / b.cropPoolInit));
          g.stats.producedToday[reaping.out] = (g.stats.producedToday[reaping.out] ?? 0) + amt;
          this.gainSkill(dt);
        }
      });
      return;
    }

    this.stayAt(g, dt, b, 'Waiting on the season');
  }

  /** Walk to a random spot inside the field and put the hours in. */
  private fieldWork(g: Game, dt: number, b: Building, label: string, apply: (rate: number) => void): void {
    // Not standing in the field yet? Walk in.
    const inField = this.x >= b.x - 0.6 && this.x <= b.x + b.w - 0.4
      && this.y >= b.y - 0.6 && this.y <= b.y + b.h - 0.4;
    if (!inField) {
      if (this.action !== 'toWork') {
        const tx = b.x + 0.5 + Math.floor(g.rand() * b.w) * 0.9;
        const ty = b.y + 0.5 + Math.floor(g.rand() * b.h) * 0.9;
        if (!this.goto(g, Math.round(tx), Math.round(ty), Math.max(1, Math.min(b.w, b.h) / 2))) {
          this.retry = 2; return;
        }
        this.action = 'toWork';
      }
      this.activity = 'Walking to the field';
      this.stepPath(g, dt);
      return;
    }
    this.action = 'working';
    this.activity = label;
    b.activity = b.activity * 0.9 + 0.1;
    // Meander between furrows now and then so the work reads on screen.
    if (g.rand() < dt * 0.25) {
      const tx = Math.round(b.x + g.rand() * (b.w - 1));
      const ty = Math.round(b.y + g.rand() * (b.h - 1));
      if (this.goto(g, tx, ty, 0.8)) this.action = 'toWork';
    }
    apply(this.workRate(g) * (0.7 + b.fertility * 0.45));
  }

  // --- workshops -----------------------------------------------------------

  private craftLoop(g: Game, dt: number, b: Building): void {
    const r = b.def.recipe!;
    if (r.seasons && !r.seasons.includes(g.season)) {
      b.status = `Harvested in ${r.seasons.join(' & ')}`;
      this.stayAt(g, dt, b, 'Tending the crop');
      return;
    }

    // Player-set production cap: hold the bench once the village has enough.
    if (b.limit != null) {
      const primary = Object.keys(r.out)[0] as ResId | undefined;
      if (primary && g.totalOf(primary) >= b.limit) {
        b.status = `Holding at ${b.limit} ${RESOURCES[primary].name}`;
        this.labour(g, dt); // lend the hands out rather than stand about
        return;
      }
    }

    // Buffer full of finished goods → run them to the store.
    const outStock = b.outputStock();
    let outTotal = 0;
    for (const k in outStock) outTotal += outStock[k as ResId] ?? 0;
    if (outTotal >= TUNING.carryCapacity * 2 || (outTotal > 0 && !b.hasInputs() && !this.canFetchInputs(g, b))) {
      if (this.pickUpFrom(g, b, outStock)) return;
    }

    if (!b.hasInputs()) {
      if (this.fetchInputs(g, dt, b)) return;
      b.status = this.missingLabel(b);
      this.stayAt(g, dt, b, 'Waiting on materials');
      return;
    }

    // At the bench?
    if (this.distTo(b.entrance.x, b.entrance.y) > 1.2) {
      if (this.action !== 'toWork') {
        if (!this.gotoBuilding(g, b)) { this.retry = 3; return; }
        this.action = 'toWork';
      }
      this.activity = 'Walking to work';
      this.stepPath(g, dt);
      return;
    }

    this.action = 'working';
    this.activity = `Making ${Object.keys(r.out).map((k) => RESOURCES[k as ResId].name.toLowerCase()).join(' & ')}`;
    b.status = 'Working';
    const rate = this.workRate(g) * (b.def.cat === 'farming' ? 0.6 + b.fertility * 0.9 : 1);
    b.workAccum += dt * rate;
    b.activity = b.activity * 0.9 + 0.1;
    if (b.workAccum >= r.work) {
      b.workAccum -= r.work;
      for (const k in r.in) b.take(k as ResId, r.in[k as ResId] ?? 0);
      for (const k in r.out) {
        const res = k as ResId;
        const amt = (r.out[res] ?? 0)
          * (b.def.cat === 'farming' ? 0.55 + b.fertility * 0.9 : 1)
          * b.sizeFactor; // bigger paddocks and groves yield more per batch
        b.add(res, amt);
        b.produced += amt;
        g.stats.producedToday[res] = (g.stats.producedToday[res] ?? 0) + amt;
      }
      this.gainSkill(dt);
    }
  }

  private missingLabel(b: Building): string {
    const want = b.wantedInputs(1);
    const names = Object.keys(want).map((k) => RESOURCES[k as ResId].name);
    return names.length ? `Waiting for ${names.join(', ')}` : 'Idle';
  }

  private canFetchInputs(g: Game, b: Building): boolean {
    const want = b.wantedInputs(1);
    for (const k in want) {
      if (g.findSourceAny(k as ResId, b.cx, b.cy, 1)) return true;
    }
    return false;
  }

  /** Walk to a store, collect what the bench is short of. Returns true if busy. */
  private fetchInputs(g: Game, dt: number, b: Building): boolean {
    if (this.action === 'toPickup' || this.action === 'toDrop') { this.doTrip(g, dt); return true; }
    if (this.retry > 0) return false;
    const want = b.wantedInputs(4);
    for (const k in want) {
      const res = k as ResId;
      const need = want[res] ?? 0;
      const src = g.findSourceAny(res, b.cx, b.cy, Math.min(2, need));
      if (!src) continue;
      if (this.beginHaul(g, { from: src, res, want: need, to: b, min: 0.5, verb: 'fetch' })) return true;
    }
    this.retry = 2.5;
    return false;
  }

  /** Claim goods sitting in `b` and haul them to a store. */
  private pickUpFrom(g: Game, b: Building, stock: Record<string, number | undefined>): boolean {
    let bestRes: ResId | null = null, bestAmt = 0;
    for (const k in stock) {
      const res = k as ResId;
      const amt = b.available(res);
      if (amt > bestAmt) { bestAmt = amt; bestRes = res; }
    }
    if (!bestRes || bestAmt < 0.5) return false;
    const amt = Math.min(bestAmt, this.capacity);
    b.take(bestRes, amt);
    this.carry = { res: bestRes, amt };
    this.lastPickupB = b.id;
    return this.beginDeliver(g);
  }

  /** Choose a destination for whatever is being carried and start walking. */
  private beginDeliver(g: Game): boolean {
    if (!this.carry) return false;
    const dest = g.findDestination(this.carry.res, this.x, this.y, this.carry.amt);
    if (!dest) {
      // Every store is full. Set the load down rather than stand holding it for
      // ever — a villager frozen mid-errand takes the whole village with them.
      g.noteLostGoods(this.carry.res, this.carry.amt);
      this.carry = null;
      this.releaseCart(g);
      this.retry = 3;
      this.activity = 'Nowhere to store it';
      this.action = 'idle';
      return false;
    }
    if (!this.gotoBuilding(g, dest)) { this.retry = 2; this.action = 'idle'; return false; }
    dest.addIncoming(this.carry.res, this.carry.amt);
    this.targetB = dest.id;
    this.action = 'toDrop';
    this.activity = `Carrying ${RESOURCES[this.carry.res].name.toLowerCase()}`;
    return true;
  }

  private doDeliver(g: Game, dt: number): void {
    if (this.action !== 'toDrop') {
      this.beginDeliver(g);
      return;
    }
    this.doTrip(g, dt);
  }

  /** Shared movement resolution for pickup and drop-off trips. */
  private doTrip(g: Game, dt: number): void {
    const target = g.buildings.get(this.targetB);
    // Pickups only ever come from finished buildings; drop-offs may be sites.
    const gone = !target || (this.action === 'toPickup' && target.state !== 'active');
    if (gone) { this.abortTrip(g); return; }
    if (!this.stepPath(g, dt)) return;

    if (this.action === 'toPickup') {
      const res = this.fetchRes!;
      const wanted = this.fetchAmt;
      const got = target!.take(res, Math.min(wanted, target!.amount(res)));
      target!.releaseOut(res, wanted);
      this.lastPickupB = target!.id;
      this.fetchRes = null; this.fetchAmt = 0;

      const pledgedTo = this.jobDestOverride >= 0 ? g.buildings.get(this.jobDestOverride) : undefined;
      // The pledge was made for the full amount; release any shortfall.
      if (pledgedTo && wanted > got) pledgedTo.clearIncoming(res, wanted - got);
      this.jobDestOverride = -1;

      if (got > 0) {
        this.carry = { res, amt: got };
        const job = this.jobId >= 0 ? g.buildings.get(this.jobId) : undefined;
        const wantsInput = !!job && job.state === 'active'
          && (job.def.recipe?.in as Record<string, number> | undefined)?.[res] !== undefined;
        let dest = pledgedTo;
        if (!dest) {
          dest = wantsInput ? job : g.findDestination(res, this.x, this.y, got);
          if (dest) dest.addIncoming(res, got);
        }
        if (dest && this.gotoBuilding(g, dest)) {
          this.targetB = dest.id;
          this.action = 'toDrop';
          this.activity = `${this.hasOx ? 'Carting' : 'Carrying'} ${RESOURCES[res].name.toLowerCase()}`;
          return;
        }
        if (dest) dest.clearIncoming(res, got);
      }
      this.action = 'idle';
      this.targetB = -1;
      return;
    }

    if (this.action === 'toDrop' && this.carry && target) {
      const { res, amt } = this.carry;
      let placed = 0;
      if (target.state === 'active') {
        target.clearIncoming(res, amt);
        placed = target.add(res, amt);
      } else {
        // Construction site: materials go into the frame, not the stores.
        target.clearIncoming(res, amt);
        placed = target.deliverMaterial(res, amt);
      }
      g.recordTransfer(this.lastPickupB, target.id, res, placed);
      this.lastPickupB = -1;
      const left = amt - placed;
      if (left > 0.01) {
        this.carry = { res, amt: left };
        this.retry = 1.5;
        this.action = 'idle';
        this.activity = 'Nowhere to put it';
      } else {
        this.carry = null;
        this.action = 'idle';
        this.releaseCart(g);
      }
      this.targetB = -1;
    }
  }

  /**
   * Yoke an ox if the load is big enough to be worth the walk to the stable.
   * Small errands stay on foot so the oxen are there when a real haul appears.
   */
  private maybeTakeCart(g: Game, wantedAmt: number): void {
    if (this.hasOx || wantedAmt <= TUNING.carryCapacity) return;
    if (g.claimOx()) this.hasOx = true;
  }

  /** Unhitch: called whenever a trip ends, is abandoned, or the villager dies. */
  private releaseCart(g: Game): void {
    if (!this.hasOx) return;
    this.hasOx = false;
    g.releaseOx();
  }

  /**
   * Start one hauling trip: size the load, yoke an ox if it is worth it, take
   * the claims at both ends, and walk.
   *
   * Every haul in the game goes through here. It used to be five near-identical
   * copies of this sequence, and the copies drifted — one of them leaked its
   * reservations, which quietly froze goods out of the economy for good. Stock
   * is now reserved at a source in exactly one place, and handed back in
   * exactly one place (`cancelHaul`).
   */
  private beginHaul(g: Game, req: HaulRequest): boolean {
    const { from, res, want } = req;
    // The ox has to be decided before the load is sized: `capacity` is what a
    // cart changes, so clamping first would mean no load is ever big enough to
    // justify one.
    this.maybeTakeCart(g, req.cartHint ?? Math.min(want, from.available(res)));
    const amt = Math.min(want, this.capacity, from.available(res));
    if (amt < req.min) return false;
    if (!this.gotoBuilding(g, from)) return false;

    from.reserveOut(res, amt);
    // A haul with no destination is a porter clearing a workshop: nobody has
    // promised to receive it yet, so the store is chosen on arrival.
    req.to?.addIncoming(res, amt);

    this.targetB = from.id;
    this.fetchRes = res;
    this.fetchAmt = amt;
    this.jobDestOverride = req.to ? req.to.id : -1;
    this.action = 'toPickup';
    const name = RESOURCES[res].name.toLowerCase();
    this.activity = req.verb === 'collect' ? `Collecting ${name}`
      : req.verb === 'site' ? `Hauling ${name} to the site`
      : `Fetching ${name}`;
    return true;
  }

  /**
   * Hand back every claim this haul holds: the stock reserved at the source
   * and the delivery pledged to the destination. Leaking either one removes
   * those goods from circulation permanently — this has shipped as a bug once
   * already, which is why `beginHaul` is the only thing that takes the claims.
   */
  private cancelHaul(g: Game): void {
    this.releaseCart(g);
    if (this.fetchRes) {
      if (this.action === 'toPickup' && this.targetB >= 0) {
        g.buildings.get(this.targetB)?.releaseOut(this.fetchRes, this.fetchAmt);
      }
      if (this.jobDestOverride >= 0) {
        g.buildings.get(this.jobDestOverride)?.clearIncoming(this.fetchRes, this.fetchAmt);
      }
    }
    if (this.carry && this.action === 'toDrop' && this.targetB >= 0) {
      g.buildings.get(this.targetB)?.clearIncoming(this.carry.res, this.carry.amt);
    }
    this.fetchRes = null;
    this.fetchAmt = 0;
    this.jobDestOverride = -1;
  }

  private abortTrip(g: Game): void {
    this.cancelHaul(g);
    this.targetB = -1;
    this.action = 'idle';
    this.retry = 1;
  }

  // --- porters, restockers, labourers --------------------------------------

  /**
   * Storage and service workers: keep the market, tavern and healer stocked,
   * and collect finished goods from workshops so crafters stay at the bench.
   */
  private tendLoop(g: Game, dt: number, b: Building): void {
    if (this.action === 'toPickup' || this.action === 'toDrop') { this.doTrip(g, dt); return; }
    if (this.carry) { this.doDeliver(g, dt); return; }
    if (this.retry > 0) { this.stayAt(g, dt, b, 'Sorting the stores'); return; }

    // 1. Service buildings pull their own consumables from storage.
    if (b.def.service?.consumes) {
      for (const res of b.def.service.consumes) {
        const need = 30 - b.amount(res) - (b.incoming[res] ?? 0);
        if (need < 6) continue;
        if (this.startFetch(g, res, Math.min(need, this.capacity), b)) return;
      }
    }

    // 2. Markets pull household goods in proportion to what homes are short of.
    if (b.def.service?.kind === 'market') {
      const wish = g.marketWishlist(b);
      for (const { res, amt } of wish) {
        if (this.startFetch(g, res, Math.min(amt, this.capacity), b)) return;
      }
    }

    // 3. Storage workers act as porters for nearby workshops.
    if (b.isStorage) {
      const pickup = g.findPorterPickup(b, this.x, this.y);
      if (pickup && this.beginHaul(g, {
        from: pickup.from, res: pickup.res, want: pickup.avail, to: null, min: 0, verb: 'collect',
      })) return;
      // Otherwise help raise whatever is under construction.
      if (this.tryConstruction(g)) return;
    }

    this.retry = 1.5 + g.rand();
    this.stayAt(g, dt, b, b.def.service?.kind === 'market' ? 'Minding the stall' : 'Sorting the stores');
  }

  private startFetch(g: Game, res: ResId, amt: number, dest: Building): boolean {
    const src = g.findSource(res, dest.cx, dest.cy, Math.min(amt, 1));
    if (!src || src.id === dest.id) return false;
    return this.beginHaul(g, {
      from: src, res, want: amt, to: dest, min: 1, verb: 'fetch', cartHint: amt,
    });
  }

  /** When set, a completed pickup is delivered here rather than to the workplace. */
  jobDestOverride = -1;
  /** Building the current load was collected from, for the supply-line log. */
  lastPickupB = -1;

  /** Unemployed adults: construction, then hauling, then loitering. */
  private labour(g: Game, dt: number): void {
    if (this.action === 'toPickup' || this.action === 'toDrop') { this.doTrip(g, dt); return; }
    if (this.carry) { this.doDeliver(g, dt); return; }
    if (this.action === 'constructing') { this.construct(g, dt); return; }
    if (this.action === 'toSite') {
      if (this.stepPath(g, dt)) { this.action = 'constructing'; }
      this.activity = 'Off to the building site';
      return;
    }
    if (this.retry > 0) { this.idleLife(g, dt, g.buildings.get(this.homeId), false); return; }

    // Keeping the stalls stocked beats every other odd job.
    if (this.tryRestockMarket(g)) return;
    if (this.tryConstruction(g)) return;

    // Spare hands clear finished goods out of workshops.
    const pickup = g.findAnyPickup(this.x, this.y);
    if (pickup && this.beginHaul(g, {
      from: pickup.from, res: pickup.res, want: pickup.avail, to: null, min: 0, verb: 'collect',
    })) return;

    this.retry = 1.5 + g.rand() * 2;
    this.activity = 'Looking for work';
    this.idleLife(g, dt, g.buildings.get(this.homeId), false);
  }

  /** Any free pair of hands will run goods out to a market that is short. */
  private tryRestockMarket(g: Game): boolean {
    for (const m of g.marketsShortOfGoods()) {
      for (const { res, amt } of g.marketWishlist(m)) {
        if (this.startFetch(g, res, Math.min(amt, this.capacity), m)) return true;
      }
    }
    return false;
  }

  private tryConstruction(g: Game): boolean {
    const site = g.nearestSiteNeedingWork(this.x, this.y);
    if (!site) return false;

    if (!site.materialsComplete()) {
      const owed = site.materialsOwed();
      for (const k in owed) {
        const res = k as ResId;
        const need = owed[res] ?? 0;
        const src = g.findSourceAny(res, site.cx, site.cy, 1);
        if (!src) continue;
        if (this.beginHaul(g, { from: src, res, want: need, to: site, min: 0.5, verb: 'site' })) return true;
      }
      return false;
    }

    if (!this.gotoBuilding(g, site)) return false;
    this.targetB = site.id;
    this.action = 'toSite';
    this.activity = `Building the ${site.name.toLowerCase()}`;
    return true;
  }

  private construct(g: Game, dt: number): void {
    const site = g.buildings.get(this.targetB);
    if (!site || site.state === 'active') { this.action = 'idle'; this.targetB = -1; return; }
    if (!site.materialsComplete()) { this.action = 'idle'; this.targetB = -1; return; }
    this.activity = `Building the ${site.name.toLowerCase()}`;
    site.buildProgress += dt * this.workRate(g) * 1.1;
    site.activity = site.activity * 0.9 + 0.1;
    this.gainSkill(dt);
    if (site.buildProgress >= site.buildWorkTotal) {
      g.completeBuilding(site);
      this.action = 'idle';
      this.targetB = -1;
    }
  }

  // ------------------------------------------------------------------ misc

  /** Work output per second, blending skill, health, contentment and season. */
  workRate(g: Game): number {
    const home = this.homeId >= 0 ? g.buildings.get(this.homeId) : undefined;
    const morale = home ? 0.55 + home.contentment * 0.7 : 0.7;
    const seasonal = g.season === 'winter' ? 0.85 : 1;
    return this.skill * morale * (0.6 + this.health * 0.4) * seasonal;
  }

  private gainSkill(dt: number): void {
    const cap = this.educated ? 1.85 : 1.5;
    if (this.skill < cap) this.skill = Math.min(cap, this.skill + 0.0009);
  }

  /** Release every reservation this villager holds. Called on death or reassignment. */
  releaseAll(g: Game): void {
    this.cancelHaul(g);
    this.releaseCart(g);
    if (this.targetNode >= 0) g.releaseNode(this.targetNode);
    this.targetNode = -1;
    this.targetB = -1;
    this.path = []; this.pathIdx = 0;
    this.action = 'idle';
  }
}

// ---------------------------------------------------------------- persistence

/** See `./persist`. Adding a field to Villager without classifying it fails the build. */
export const VILLAGER_PERSIST = {
  id: 'ctor',

  // Getters: computed from age, name and load.
  capacity: 'derived', given: 'derived', isAdult: 'derived', isChild: 'derived',
  isElder: 'derived', carrying: 'derived', jobTitle: 'derived',

  /**
   * Not saved on purpose. Everyone re-plans from where they stand on load,
   * which is also why every walking action is reset — `stepPath` treats an
   * empty path as "arrived", so a restored hauler would otherwise finish its
   * delivery instantly from wherever it happened to be.
   */
  path: 'derived', pathIdx: 'derived',
  /** Search cooldown; a fresh villager simply tries again. */
  retry: 'transient',

  name: 'save', age: 'save', lifespan: 'save',
  homeId: 'save', jobId: 'save', familyId: 'save',
  x: 'save', y: 'save', facing: 'save',
  action: 'save', activity: 'save', carry: 'save',
  targetB: 'save', fetchRes: 'save', fetchAmt: 'save', targetNode: 'save',
  jobDestOverride: 'save', lastPickupB: 'save',
  workTimer: 'save', skill: 'save', educated: 'save', health: 'save', hasOx: 'save',
} satisfies Descriptor<Villager>;

export const VILLAGER_CODECS: Codecs<Villager> = {};
