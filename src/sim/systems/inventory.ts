/**
 * What the village owns and where it is kept.
 *
 * "Stock" and "total" are deliberately different questions: stock is what is
 * on a shelf someone can shop from, total is every last unit including the
 * half-used inputs sitting on a workshop bench. Confusing the two is how you
 * get a village that starves next to a full granary.
 */

import type { Amounts, BuildingDef, ResId } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';

/** Total of a resource across every storage building. */
export function stockOf(g: Game, res: ResId): number {
  let t = 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active') continue;
    if (b.isStorage || b.def.service?.kind === 'market') t += b.amount(res);
  }
  return t;
}

/** Everything held anywhere in the settlement, including workshop buffers. */
export function totalOf(g: Game, res: ResId): number {
  let t = 0;
  for (const b of g.buildings.values()) {
    if (b.state === 'active') t += b.amount(res);
  }
  return t;
}

export function allStock(g: Game): Amounts {
  const out: Amounts = {};
  for (const b of g.buildings.values()) {
    if (b.state !== 'active') continue;
    for (const k in b.store) {
      const res = k as ResId;
      out[res] = (out[res] ?? 0) + (b.store[res] ?? 0);
    }
  }
  return out;
}

export function storageCapacity(g: Game): number {
  let cap = 0;
  for (const b of g.buildings.values()) {
    if (b.state === 'active' && (b.isStorage || b.def.service?.kind === 'market')) cap += b.capacity();
  }
  return cap;
}

export function storageUsed(g: Game): number {
  let used = 0;
  for (const b of g.buildings.values()) {
    if (b.state === 'active' && (b.isStorage || b.def.service?.kind === 'market')) used += b.total();
  }
  return used;
}

export function takeFromStores(g: Game, res: ResId, amt: number): number {
  let left = amt;
  const stores = [...g.buildings.values()]
    .filter((b) => b.state === 'active' && b.amount(res) > 0)
    .sort((a, b) => b.amount(res) - a.amount(res));
  for (const s of stores) {
    if (left <= 0.001) break;
    left -= s.take(res, left);
  }
  return amt - left;
}

export function addToStores(g: Game, res: ResId, amt: number, nearX = g.startX, nearY = g.startY): number {
  let left = amt;
  const stores = [...g.buildings.values()]
    .filter((b) => b.state === 'active' && b.isStorage && b.freeSpace(res) > 0)
    .sort((a, b) => Math.hypot(a.cx - nearX, a.cy - nearY) - Math.hypot(b.cx - nearX, b.cy - nearY));
  for (const s of stores) {
    if (left <= 0.001) break;
    left -= s.add(res, left);
  }
  return amt - left;
}

/** Finished goods sitting in workshops waiting for a haulier. */
export function backlog(g: Game): number {
  let t = 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || b.isStorage || b.isHouse || b.def.service) continue;
    const out = b.outputStock();
    for (const k in out) t += out[k as ResId] ?? 0;
  }
  return t;
}

/** Net production per day for the resource dashboard. */
export function netFlow(g: Game, res: ResId): number {
  return (g.stats.producedToday[res] ?? 0) - (g.stats.consumedToday[res] ?? 0);
}

export function buildingsOfCat(g: Game, cat: BuildingDef['cat']): Building[] {
  return [...g.buildings.values()].filter((b) => b.def.cat === cat);
}
