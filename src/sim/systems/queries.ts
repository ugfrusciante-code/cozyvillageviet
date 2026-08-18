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

/** A workshop with finished goods a porter from `home` should collect. */
export function findPorterPickup(g: Game, home: Building, x: number, y: number): { from: Building; res: ResId; amt: number; avail: number } | null {
  let best: { from: Building; res: ResId; amt: number; avail: number } | null = null;
  let bestScore = -Infinity;
  for (const b of g.buildings.values()) {
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
export function findAnyPickup(g: Game, x: number, y: number): { from: Building; res: ResId; amt: number; avail: number } | null {
  let best: { from: Building; res: ResId; amt: number; avail: number } | null = null;
  let bestScore = -Infinity;
  for (const b of g.buildings.values()) {
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
