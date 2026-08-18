/**
 * Households.
 *
 * A family is the unit the village actually taxes, houses and grows: villagers
 * belong to one, homes hold one or more, and an occupied roof always has at
 * least one. `reconcileFamilies` is what keeps that last promise true, so the
 * rest of the sim can divide by `families` without checking for zero.
 */

import { Family, SURNAMES } from '../family';
import type { Building } from '../building';
import type { Villager } from '../villager';
import type { Game } from '../game';

/** Start a new household, moving it into `home` if there is room. */
export function foundFamily(g: Game, home?: Building): Family {
  // Prefer a surname not already in the valley, so names stay legible.
  const taken = new Set([...g.families.values()].map((f) => f.surname));
  const free = SURNAMES.filter((n) => !taken.has(n));
  const pool = free.length ? free : SURNAMES;
  const surname = pool[Math.floor(g.flavourRng.next() * pool.length)];
  const fam = new Family(surname, g.day);
  g.families.set(fam.id, fam);
  if (home) moveFamilyIn(g, fam, home);
  return fam;
}

export function moveFamilyIn(g: Game, fam: Family, home: Building): boolean {
  if (home.familyIds.length >= home.capacityFamilies) return false;
  if (fam.homeId >= 0) {
    const old = g.buildings.get(fam.homeId);
    if (old) old.familyIds = old.familyIds.filter((id) => id !== fam.id);
  }
  fam.homeId = home.id;
  home.familyIds.push(fam.id);
  return true;
}

export function familyOf(g: Game, home: Building): Family | undefined {
  return g.families.get(home.familyIds[0] ?? -1);
}

/** A home with a spare family slot, nearest to (x,y). */
export function homeWithFamilyRoom(g: Game, x: number, y: number): Building | undefined {
  let best: Building | undefined, bestD = Infinity;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.isHouse) continue;
    if (b.familyIds.length >= b.capacityFamilies) continue;
    if (b.residents.length >= b.capacityResidents) continue;
    const d = Math.hypot(b.cx - x, b.cy - y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/** Drop a family that has lost every member. */
export function retireFamily(g: Game, fam: Family): void {
  if (fam.memberIds.length) return;
  const home = g.buildings.get(fam.homeId);
  if (home) home.familyIds = home.familyIds.filter((id) => id !== fam.id);
  g.families.delete(fam.id);
}

export function housingFor(g: Game, v: Villager): void {
  if (v.homeId >= 0 && g.buildings.has(v.homeId)) return;
  let best: Building | undefined, bestD = Infinity;
  for (const b of g.buildings.values()) {
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
      const existing = familyOf(g, best);
      const fam = existing && best.familyIds.length >= best.capacityFamilies
        ? existing
        : (existing ?? foundFamily(g, best));
      v.familyId = fam.id;
      if (!fam.memberIds.includes(v.id)) fam.memberIds.push(v.id);
      v.takeSurname(fam.surname);
    } else if (!best.familyIds.length) {
      const fam = g.families.get(v.familyId);
      if (fam) moveFamilyIn(g, fam, best);
    }
  }
}

/**
 * Keep households and homes consistent: every resident belongs to a family,
 * and every occupied home has at least one. Cheap, and it means the rest of
 * the sim can trust `families` never to be zero under a lived-in roof.
 */
export function reconcileFamilies(g: Game): void {
  for (const home of g.buildings.values()) {
    if (home.state !== 'active' || !home.isHouse) continue;
    // Drop stale ids, then make sure a lived-in home has a household.
    home.familyIds = home.familyIds.filter((id) => g.families.has(id));
    if (home.residents.length && !home.familyIds.length) {
      const resident = home.residents
        .map((id) => g.villagers.get(id))
        .find((v): v is Villager => !!v && v.familyId >= 0 && g.families.has(v.familyId));
      const fam = resident ? g.families.get(resident.familyId)! : foundFamily(g);
      moveFamilyIn(g, fam, home);
    }
  }
  for (const v of g.villagers.values()) {
    if (v.familyId >= 0 && g.families.has(v.familyId)) continue;
    const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
    const fam = (home && familyOf(g, home)) ?? foundFamily(g, home);
    v.familyId = fam.id;
    if (!fam.memberIds.includes(v.id)) fam.memberIds.push(v.id);
  }
}
