/**
 * Who works where.
 *
 * The player sets job slots and a 1-3 priority per building; `autoPriority`
 * supplies the urgency the player cannot see — an empty market stall, a bare
 * woodpile in autumn, a field in its sowing week. The two are added, and the
 * whole workforce is re-sorted whenever something changes.
 */

import { FOOD_TYPES, RESOURCES, TUNING, type ResId } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';
import { backlog, stockOf, totalOf } from './inventory';
import { hasBuilding } from './placement';
import { residentsServedBy } from './services';

/** Reconcile workers against the job slots the player has opened. */
export function reassign(g: Game): void {
  g.reassignPending = false;
  // Drop workers from buildings that lost slots or were demolished.
  for (const b of g.buildings.values()) {
    const limit = b.state === 'active' ? Math.min(b.jobSlots, b.def.jobs) : 0;
    while (b.workers.length > limit) {
      const id = b.workers.pop()!;
      const v = g.villagers.get(id);
      if (v) { v.jobId = -1; v.releaseAll(g); }
    }
    b.workers = b.workers.filter((id) => {
      const v = g.villagers.get(id);
      if (!v || !v.isAdult) return false;
      v.jobId = b.id;
      return true;
    });
  }

  // `autoPriority` is not cheap — it calls stockOf, foodDaysLeft, backlog,
  // world.findNodes and homesServedBy — and it was being invoked from inside
  // two sort comparators, so ranking n buildings cost O(n log n) full
  // evaluations of it. Nothing it reads changes while reassign runs (it reads
  // raw stores, never the reservation ledger), so each building is scored once.
  const urgency = new Map<number, number>();
  const urgencyOf = (b: Building): number => {
    let p = urgency.get(b.id);
    if (p === undefined) { p = autoPriority(g, b); urgency.set(b.id, p); }
    return p;
  };

  const free = [...g.villagers.values()].filter((v) => v.isAdult && v.jobId < 0);

  // Always hold back a pool of labourers. Without them nothing gets built and
  // half-finished sites swallow every log in the village. This has to run
  // even when nobody is free — that is exactly when it is needed.
  if (g.autoAssign) {
    const sites = [...g.buildings.values()].filter((b) => b.state !== 'active' && !b.paused).length;
    const targetLabour = sites > 0 ? Math.max(1, Math.round(g.adults * 0.25)) : 0;
    // If every pair of hands is already in a workshop, pull some back off the
    // least urgent jobs — otherwise construction sites never get built and
    // the whole settlement quietly seizes up.
    if (free.length < targetLabour) {
      const staffed = [...g.buildings.values()]
        .filter((b) => b.state === 'active' && b.workers.length > 0)
        .sort((a, b) => urgencyOf(a) - urgencyOf(b));
      for (const b of staffed) {
        while (free.length < targetLabour && b.workers.length > 0) {
          const id = b.workers.pop()!;
          const v = g.villagers.get(id);
          if (!v) continue;
          v.jobId = -1;
          v.releaseAll(g);
          free.push(v);
        }
        if (free.length >= targetLabour) break;
      }
    }
    const keep = Math.min(targetLabour, free.length);
    if (keep > 0) free.splice(free.length - keep, keep);
  }
  if (!free.length) return;

  const openings = [...g.buildings.values()]
    .filter((b) => b.state === 'active' && !b.paused && b.workers.length < Math.min(b.jobSlots, b.def.jobs))
    .sort((a, b) => (b.priority * 2 + urgencyOf(b)) - (a.priority * 2 + urgencyOf(a)));

  for (const b of openings) {
    while (b.workers.length < Math.min(b.jobSlots, b.def.jobs) && free.length) {
      // Give the job to whoever lives closest — with a thumb on the scale for
      // kin. A family member already at this bench is worth eight tiles of
      // walking: households drift toward working together, the way the same
      // idea keeps whole families on one plot in Manor Lords. Texture, but
      // also legibility — "the Rushmeres run the sawpit" reads; a roster of
      // unrelated names does not.
      const kinHere = new Set<number>();
      for (const id of b.workers) {
        const fam = g.villagers.get(id)?.familyId ?? -1;
        if (fam >= 0) kinHere.add(fam);
      }
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < free.length; i++) {
        const v = free[i];
        const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
        const bonus = v.familyId >= 0 && kinHere.has(v.familyId) ? 8 : 0;
        const d = Math.hypot((home?.cx ?? v.x) - b.cx, (home?.cy ?? v.y) - b.cy) - bonus;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const v = free.splice(bestI, 1)[0];
      v.jobId = b.id;
      v.releaseAll(g);
      b.workers.push(v.id);
    }
  }
}

/**
 * The rungs `autoPriority` places a job on.
 *
 * Every rule returns `BAND.X + tiebreak`, where the tiebreak is under 1 and
 * orders jobs *within* a rung. That is the whole point of naming them: adding
 * a new kind of work (herders, militia) becomes "which rung, and where in it",
 * rather than re-deriving a ladder of twenty-two loose decimals — which is
 * what this was, and why nobody could safely add to it.
 *
 * The player's own 1-3 priority is added on top at double weight, so a
 * deliberate choice can always outrank one rung of automatic urgency but
 * never the gap between "idle" and "the village is starving".
 */
export const BAND = {
  /** Nothing to do here: out of season, no inputs, nothing left in range. */
  IDLE: 0.4,
  /** Work with no particular claim on anyone. */
  LOW: 1.0,
  /** Ordinary craft: it matters, but not today. */
  ROUTINE: 2.5,
  /** Keeps the village turning — farm upkeep, spare porters. */
  SUPPORT: 4.0,
  /** Making the things households actually consume. */
  PRODUCTION: 5.0,
  /** Getting raw material out of the ground. Outranks what converts it. */
  EXTRACTION: 6.0,
  /** People go hungry or cold if this is not staffed now. */
  URGENT: 7.5,
} as const;

/**
 * Ranking used when jobs are filled automatically: keep people fed and warm
 * before anyone is sent to carve pottery.
 */
export function autoPriority(g: Game, b: Building): number {
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
    const feeds = edible || (hasBuilding(g, 'mill') && hasBuilding(g, 'bakery'));
    if (g.season === 'spring' && !b.sown) return feeds ? BAND.EXTRACTION + 0.6 : BAND.SUPPORT + 0.2;
    if (g.season === 'summer' && b.sown && b.growth < 1) return feeds ? BAND.SUPPORT + 0.6 : BAND.ROUTINE + 0.5;
    if (g.season === 'autumn' && b.cropPool > 0.5) return feeds ? BAND.EXTRACTION + 0.6 : BAND.SUPPORT + 0.2;
    return BAND.IDLE + 0.1;
  }

  // A workshop with nothing to work on is worse than useless: it holds staff
  // who should be upstream digging the input out of the ground. The same
  // goes for out-of-season work — a forager in January is two idle hands.
  if (d.recipe) {
    if (d.recipe.seasons && !d.recipe.seasons.includes(g.season)) return BAND.IDLE;
    for (const k of Object.keys(d.recipe.in) as ResId[]) {
      if (stockOf(g, k) + b.amount(k) < (d.recipe.in[k] ?? 0)) return BAND.IDLE + 0.1;
    }
  }
  if (d.harvest) {
    if (d.harvest.seasons && !d.harvest.seasons.includes(g.season)) return BAND.IDLE;
    if (!g.world.findNodes(
      Math.round(b.cx), Math.round(b.cy), d.harvest.kind, d.harvest.radius, 1,
    ).length) return BAND.IDLE;
  }

  // Extraction outranks the conversion that depends on it, and when the
  // larder is bare, gathering food outranks absolutely everything.
  if (d.harvest) {
    if (RESOURCES[d.harvest.out]?.food) return foodDaysLeft(g) < 2.5 ? BAND.URGENT + 0.3 : BAND.EXTRACTION + 0.2;
    return BAND.PRODUCTION + 0.6;
  }
  if (d.recipe) {
    const outs = Object.keys(d.recipe.out) as ResId[];
    if (outs.some((k) => RESOURCES[k]?.food)) {
      const base = d.cat === 'farming' ? BAND.PRODUCTION + 0.4 : BAND.PRODUCTION;
      return foodDaysLeft(g) < 2.5 ? BAND.URGENT + 0.1 : base;
    }
    if (outs.some((k) => RESOURCES[k]?.fuel)) {
      // Firewood is existential once the cold comes, so a thin woodpile
      // outranks almost everything else. Otherwise it is ordinary work.
      const perDay = g.population * TUNING.fuelPerDay * TUNING.fuelSeason[g.season];
      if (totalOf(g, 'firewood') < perDay * 4) return BAND.EXTRACTION;
      return BAND.SUPPORT + 0.6;
    }
    if (d.cat === 'farming') return BAND.SUPPORT;
    return BAND.ROUTINE;
  }
  if (d.plants) return BAND.ROUTINE + 0.5;
  if (d.service?.kind === 'market') {
    // A bare stall is the most urgent job in the village: every household
    // shops here, and nothing else matters if they cannot eat.
    const heads = residentsServedBy(g, b);
    const food = FOOD_TYPES.reduce((t, f) => t + b.amount(f), 0);
    if (heads > 0 && food < heads * TUNING.foodPerDay * 1.5) return BAND.URGENT;
    return BAND.PRODUCTION + 0.8;
  }
  if (d.cat === 'logistics') {
    // When finished goods are stacking up in workshops, porters matter more
    // than anything else in the village.
    return backlog(g) > 60 ? BAND.EXTRACTION + 0.5 : BAND.SUPPORT + 0.4;
  }
  return BAND.LOW;
}

/** How many days the village could eat for on what is in store. */
export function foodDaysLeft(g: Game): number {
  const stock = FOOD_TYPES.reduce((t, f) => t + stockOf(g, f), 0);
  return stock / Math.max(0.01, g.population * TUNING.foodPerDay);
}

export function setJobSlots(g: Game, buildingId: number, slots: number): void {
  const b = g.buildings.get(buildingId);
  if (!b) return;
  b.jobSlots = Math.max(0, Math.min(b.def.jobs, Math.round(slots)));
  g.reassignPending = true;
}

export function assignVillager(g: Game, villagerId: number, buildingId: number | -1): void {
  const v = g.villagers.get(villagerId);
  if (!v || !v.isAdult) return;
  if (v.jobId >= 0) {
    const old = g.buildings.get(v.jobId);
    if (old) old.workers = old.workers.filter((id) => id !== villagerId);
  }
  v.releaseAll(g);
  v.jobId = -1;
  if (buildingId >= 0) {
    const b = g.buildings.get(buildingId);
    if (b && b.state === 'active' && b.workers.length < b.def.jobs) {
      b.workers.push(villagerId);
      v.jobId = b.id;
      b.jobSlots = Math.max(b.jobSlots, b.workers.length);
    }
  }
}
