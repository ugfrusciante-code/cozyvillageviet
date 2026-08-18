/**
 * Who is born, who leaves, who dies.
 *
 * Every arm of this reads contentment: contented, well-fed homes have
 * children and attract newcomers, miserable ones lose people to the road.
 * Population is therefore an output of the economy rather than a dial.
 */

import { FOOD_TYPES, TUNING } from '../defs';
import { Villager } from '../villager';
import type { Game } from '../game';
import { familyOf, foundFamily, homeWithFamilyRoom, housingFor, retireFamily } from './families';
import { stockOf } from './inventory';
import { serviceLevel } from './services';

export function ageAndHealth(g: Game): void {
  const daysPerYear = TUNING.daysPerSeason * 4;
  for (const v of g.villagers.values()) {
    v.age += 1 / daysPerYear;
    const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
    const healer = serviceLevel(g, 'health', v.x, v.y).level > 0;
    let drift = 0.01;
    if (home) {
      if (home.supply.foodDays <= 0.01) drift -= 0.10;
      if (home.supply.fuelDays <= 0.01 && (g.season === 'winter' || g.season === 'autumn')) drift -= 0.07;
      if (home.contentment > 0.6) drift += 0.01;
    } else {
      drift -= 0.05;
    }
    if (healer) drift += 0.035;
    if (g.season === 'winter') drift -= 0.015;
    v.health = Math.max(0, Math.min(1, v.health + drift));
  }
}

export function birthsAndDeaths(g: Game): void {
  const dying: Villager[] = [];
  for (const v of g.villagers.values()) {
    if (v.age >= v.lifespan) { dying.push(v); continue; }
    if (v.health <= 0) { dying.push(v); continue; }
  }
  for (const v of dying) {
    const cause = v.age >= v.lifespan ? 'of old age' : 'of hardship';
    removeVillager(g, v);
    g.log(`${v.name} died ${cause}.`, cause === 'of old age' ? 'info' : 'bad');
  }

  // Births
  const foodStock = FOOD_TYPES.reduce((s, f) => s + stockOf(g, f), 0);
  const foodPerHead = foodStock / Math.max(1, g.population);
  for (const home of g.buildings.values()) {
    if (home.state !== 'active' || !home.isHouse) continue;
    const cap = home.capacityResidents;
    if (home.residents.length >= cap) continue;
    const adults = home.residents
      .map((id) => g.villagers.get(id))
      .filter((v): v is Villager => !!v && v.isAdult && v.age < 45);
    if (adults.length < 2) continue;
    if (home.contentment < TUNING.birthContentment) continue;
    if (foodPerHead < 1.5) continue;
    const chance = 0.05 * home.contentment * Math.min(1, foodPerHead / 4);
    if (g.rand() < chance) {
      // The child is born into the family of one of the adults present.
      const parent = adults.find((a) => a.familyId >= 0) ?? adults[0];
      let fam = g.families.get(parent.familyId);
      if (!fam) fam = foundFamily(g, home);
      const baby = new Villager(home.cx, home.cy + 1, 0, () => g.rand());
      baby.homeId = home.id;
      baby.familyId = fam.id;
      baby.takeSurname(fam.surname);
      fam.memberIds.push(baby.id);
      fam.childrenBorn++;
      home.residents.push(baby.id);
      g.villagers.set(baby.id, baby);
      baby.educated = serviceLevel(g, 'learning', home.cx, home.cy).level > 0;
      if (baby.educated) baby.skill += 0.15;
      g.log(`${baby.name} was born to the ${fam.surname} family.`, 'good');
    }
  }

  // Emigration: sustained misery drives people out.
  for (const v of [...g.villagers.values()]) {
    const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
    const c = home?.contentment ?? 0.15;
    if (c < TUNING.leaveContentment && v.isAdult && g.rand() < 0.02) {
      removeVillager(g, v);
      g.log(`${v.name} left the valley in search of better.`, 'bad');
    }
  }
}

export function removeVillager(g: Game, v: Villager): void {
  v.releaseAll(g);
  if (v.familyId >= 0) {
    const fam = g.families.get(v.familyId);
    if (fam) {
      fam.memberIds = fam.memberIds.filter((id) => id !== v.id);
      retireFamily(g, fam);
    }
  }
  if (v.jobId >= 0) {
    const b = g.buildings.get(v.jobId);
    if (b) b.workers = b.workers.filter((id) => id !== v.id);
  }
  if (v.homeId >= 0) {
    const h = g.buildings.get(v.homeId);
    if (h) h.residents = h.residents.filter((id) => id !== v.id);
  }
  g.villagers.delete(v.id);
  g.reassignPending = true;
}

export function immigration(g: Game): void {
  // Spare beds + a contented, well-fed village attracts newcomers.
  let spare = 0;
  for (const b of g.buildings.values()) {
    if (b.state === 'active' && b.isHouse) spare += Math.max(0, b.capacityResidents - b.residents.length);
  }
  if (spare <= 0) return;
  const content = g.averageContentment;
  if (content < 0.5) return;
  const foodStock = FOOD_TYPES.reduce((s, f) => s + stockOf(g, f), 0);
  if (foodStock < g.population * 2) return;
  const chance = 0.16 * (content - 0.45) * Math.min(3, spare);
  if (g.rand() < chance) {
    const v = new Villager(g.startX, g.startY, 17 + Math.floor(g.rand() * 16), () => g.rand());
    g.villagers.set(v.id, v);
    housingFor(g, v);
    // A newcomer either marries into a household with room, or founds one.
    const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
    const host = home && home.familyIds.length < home.capacityFamilies
      ? undefined
      : home ? familyOf(g, home) : undefined;
    let fam = host;
    if (!fam) {
      const roomy = home && home.familyIds.length < home.capacityFamilies
        ? home : homeWithFamilyRoom(g, g.startX, g.startY);
      fam = foundFamily(g, roomy);
      if (fam.homeId >= 0 && v.homeId !== fam.homeId) {
        const h = g.buildings.get(fam.homeId);
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
    g.reassignPending = true;
    g.log(`${v.name} arrived looking for a home.`, 'good');
  }
  // Orphaned villagers find whatever bed exists.
  for (const v of g.villagers.values()) if (v.homeId < 0) housingFor(g, v);
}
