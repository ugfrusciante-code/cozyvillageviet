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
import { homesServedBy } from './services';

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
        .sort((a, b) => autoPriority(g, a) - autoPriority(g, b));
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
    .sort((a, b) => (b.priority * 2 + autoPriority(g, b)) - (a.priority * 2 + autoPriority(g, a)));

  for (const b of openings) {
    while (b.workers.length < Math.min(b.jobSlots, b.def.jobs) && free.length) {
      // Give the job to whoever lives closest.
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < free.length; i++) {
        const v = free[i];
        const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
        const d = Math.hypot((home?.cx ?? v.x) - b.cx, (home?.cy ?? v.y) - b.cy);
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
    if (g.season === 'spring' && !b.sown) return feeds ? 6.6 : 4.2;
    if (g.season === 'summer' && b.sown && b.growth < 1) return feeds ? 4.6 : 3.0;
    if (g.season === 'autumn' && b.cropPool > 0.5) return feeds ? 6.6 : 4.2;
    return 0.5;
  }

  // A workshop with nothing to work on is worse than useless: it holds staff
  // who should be upstream digging the input out of the ground. The same
  // goes for out-of-season work — a forager in January is two idle hands.
  if (d.recipe) {
    if (d.recipe.seasons && !d.recipe.seasons.includes(g.season)) return 0.4;
    for (const k of Object.keys(d.recipe.in) as ResId[]) {
      if (stockOf(g, k) + b.amount(k) < (d.recipe.in[k] ?? 0)) return 0.5;
    }
  }
  if (d.harvest) {
    if (d.harvest.seasons && !d.harvest.seasons.includes(g.season)) return 0.4;
    if (!g.world.findNodes(
      Math.round(b.cx), Math.round(b.cy), d.harvest.kind, d.harvest.radius, 1,
    ).length) return 0.4;
  }

  // Extraction outranks the conversion that depends on it, and when the
  // larder is bare, gathering food outranks absolutely everything.
  if (d.harvest) {
    if (RESOURCES[d.harvest.out]?.food) return foodDaysLeft(g) < 2.5 ? 7.8 : 6.2;
    return 5.6;
  }
  if (d.recipe) {
    const outs = Object.keys(d.recipe.out) as ResId[];
    if (outs.some((k) => RESOURCES[k]?.food)) {
      const base = d.cat === 'farming' ? 5.4 : 5.0;
      return foodDaysLeft(g) < 2.5 ? 7.6 : base;
    }
    if (outs.some((k) => RESOURCES[k]?.fuel)) {
      // Firewood is existential once the cold comes, so a thin woodpile
      // outranks almost everything else. Otherwise it is ordinary work.
      const perDay = g.population * TUNING.fuelPerDay * TUNING.fuelSeason[g.season];
      if (totalOf(g, 'firewood') < perDay * 4) return 6.0;
      return 4.6;
    }
    if (d.cat === 'farming') return 4.0;
    return 2.5;
  }
  if (d.plants) return 3.0;
  if (d.service?.kind === 'market') {
    // A bare stall is the most urgent job in the village: every household
    // shops here, and nothing else matters if they cannot eat.
    const homes = homesServedBy(g, b);
    const heads = homes.reduce((n, h) => n + h.residents.length, 0);
    const food = FOOD_TYPES.reduce((t, f) => t + b.amount(f), 0);
    if (heads > 0 && food < heads * TUNING.foodPerDay * 1.5) return 7.5;
    return 5.8;
  }
  if (d.cat === 'logistics') {
    // When finished goods are stacking up in workshops, porters matter more
    // than anything else in the village.
    return backlog(g) > 60 ? 6.5 : 4.4;
  }
  return 1;
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
