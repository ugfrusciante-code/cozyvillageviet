/**
 * The searches villagers run to decide where to walk: who has the goods, who
 * has room for them, and which building site most wants a pair of hands.
 *
 * All of these are linear scans over every building. That is fine at village
 * scale and keeps them obvious; if it ever stops being fine, this is the file
 * to put an index in.
 */

import { TUNING, type ResId } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';

/** Nearest active building holding at least `min` of `res` free to claim. */
export function findSource(g: Game, res: ResId, x: number, y: number, min = 1): Building | undefined {
  let best: Building | undefined;
  let bestD = Infinity;
  for (const b of g.buildings.values()) {
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
export function findSourceAny(g: Game, res: ResId, x: number, y: number, min = 1): Building | undefined {
  const store = findSource(g, res, x, y, min);
  if (store) return store;
  let best: Building | undefined;
  let bestD = Infinity;
  for (const b of g.buildings.values()) {
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
export function findDestination(g: Game, res: ResId, x: number, y: number, amt: number): Building | undefined {
  let best: Building | undefined;
  let bestD = Infinity;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.isStorage) continue;
    if (b.freeSpace(res) < Math.min(amt, 1)) continue;
    const d = Math.hypot(b.cx - x, b.cy - y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/** A workshop with goods waiting for someone to carry them away. */
export interface Pickup { from: Building; res: ResId; amt: number; avail: number }

/**
 * Find the most worthwhile load sitting in a workshop.
 *
 * Storage workers and idle labourers both do this, and used to do it through
 * two copies of the same scan that differed only in three numbers. They still
 * differ in those three: a porter will cross the village for a decent load
 * (`minAmount` 6, distance barely discounted) while a spare pair of hands only
 * bothers with what is close (`minAmount` 3, distance weighted half again).
 * Now that is visible as three arguments rather than buried in a near-copy.
 */
function findPickup(
  g: Game, x: number, y: number,
  minAmount: number, distanceWeight: number, excludeId = -1,
): Pickup | null {
  let best: Pickup | null = null;
  let bestScore = -Infinity;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || b.isStorage || b.isHouse) continue;
    if (b.id === excludeId || b.def.service) continue;
    const out = b.outputStock();
    for (const k in out) {
      const res = k as ResId;
      const amt = b.available(res);
      if (amt < minAmount) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      const score = amt * 2 - d * distanceWeight;
      if (score > bestScore) {
        bestScore = score;
        best = { from: b, res, amt: Math.min(amt, TUNING.carryCapacity), avail: amt };
      }
    }
  }
  return best;
}

/** What a porter working out of `home` should go and collect. */
export function findPorterPickup(g: Game, home: Building, x: number, y: number): Pickup | null {
  return findPickup(g, x, y, 6, 1, home.id);
}

/** Same, for spare labourers: a lower trigger, but they will not walk as far. */
export function findAnyPickup(g: Game, x: number, y: number): Pickup | null {
  return findPickup(g, x, y, 3, 1.5);
}

export function nearestSiteNeedingWork(g: Game, x: number, y: number): Building | undefined {
  let best: Building | undefined;
  let bestScore = -Infinity;
  for (const b of g.buildings.values()) {
    if (b.state === 'active' || b.paused) continue;
    const d = Math.hypot(b.cx - x, b.cy - y);
    const score = b.priority * 40 - d;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

export function randomLandmark(g: Game): Building | undefined {
  const list = [...g.buildings.values()].filter((b) => b.state === 'active' && !b.isHouse);
  if (!list.length) return undefined;
  return list[Math.floor(g.rand() * list.length)];
}
