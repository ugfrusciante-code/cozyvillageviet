/**
 * Putting things on the map: whether a building may go somewhere, what happens
 * to the tiles under it, and how it comes down again.
 *
 * `registerFootprint` is where the map stops being scenery — it stamps the
 * occupancy grid, lays road, marks fields as walk-through, and fells the trees
 * around a new building so the settlement reads as a clearing rather than
 * being swallowed by the forest.
 */

import { BUILDING_BY_ID, type ResId } from '../defs';
import { Building } from '../building';
import { NODE_INDEX } from '../world';
import type { Game } from '../game';
import { addToStores, stockOf, takeFromStores } from './inventory';
import { refreshServices } from './services';

export function canPlace(g: Game, defId: string, x: number, y: number, w?: number, h?: number): { ok: boolean; reason?: string } {
  const def = BUILDING_BY_ID[defId];
  if (!def) return { ok: false, reason: 'Unknown building' };
  const fw = w ?? def.size[0], fh = h ?? def.size[1];
  if (def.zone) {
    if (fw < def.zone.minSide || fh < def.zone.minSide) return { ok: false, reason: `At least ${def.zone.minSide}×${def.zone.minSide}` };
    if (fw > def.zone.maxSide || fh > def.zone.maxSide) return { ok: false, reason: `At most ${def.zone.maxSide}×${def.zone.maxSide}` };
  }
  if (def.minPop && g.population < def.minPop) {
    return { ok: false, reason: `Needs ${def.minPop} villagers` };
  }
  if (def.needs) {
    for (const req of def.needs) {
      if (!hasBuilding(g, req)) {
        return { ok: false, reason: `Requires a ${BUILDING_BY_ID[req].name}` };
      }
    }
  }
  const maxSlope = def.cat === 'decor' || def.id === 'road' ? 3.0 : def.zone ? 2.2 : 1.6;
  const base = g.world.canPlace(x, y, fw, fh, maxSlope);
  if (!base.ok) return base;
  const cx = Math.round(x + fw / 2), cy = Math.round(y + fh / 2);
  if (def.nearWater && !g.world.isNearWater(cx, cy, 3)) {
    return { ok: false, reason: 'Must be built on the shore' };
  }
  if (def.needsFertile) {
    // Thin soil is allowed — the yield just suffers for it. Only true
    // wasteland is refused outright.
    const f = g.world.avgFertility(x, y, fw, fh);
    if (f < 0.18) return { ok: false, reason: 'Soil here is too poor to plough' };
  }
  if (def.harvest) {
    const near = g.world.findNodes(cx, cy, def.harvest.kind, def.harvest.radius, 1);
    if (near.length === 0) return { ok: false, reason: `No ${def.harvest.kind} within range` };
  }
  return { ok: true };
}

/** Queue a building as a construction site. Returns the new building or null. */
export function place(g: Game, defId: string, x: number, y: number, w?: number, h?: number): Building | null {
  const check = canPlace(g, defId, x, y, w, h);
  if (!check.ok) return null;
  const b = new Building(defId, x, y, g.world, w, h);
  registerFootprint(g, b);
  b.computeEntrance(g.world);
  b.state = 'building';
  // Roads and tiny decorations go up instantly — no site, no haulage.
  if (b.def.id === 'road' || (b.def.buildWork <= 8 && Object.keys(b.def.cost).length <= 1)) {
    const cost = b.buildCost();
    let affordable = true;
    for (const k in cost) {
      if (stockOf(g, k as ResId) < (cost[k as ResId] ?? 0)) { affordable = false; break; }
    }
    if (!affordable) { unregisterFootprint(g, b); return null; }
    for (const k in cost) takeFromStores(g, k as ResId, cost[k as ResId] ?? 0);
    for (const k in cost) b.delivered[k as ResId] = cost[k as ResId] ?? 0;
    b.buildProgress = b.buildWorkTotal;
    completeBuilding(g, b, true);
  }
  g.buildings.set(b.id, b);
  g.reassignPending = true;
  return b;
}

export function registerFootprint(g: Game, b: Building): void {
  const w = g.world;
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
          g.removedNodes.push(i);
          addToStores(g, 'logs', 2, b.cx, b.cy);
        }
      }
    }
  }
}

export function unregisterFootprint(g: Game, b: Building): void {
  const w = g.world;
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

export function demolish(g: Game, id: number): void {
  const b = g.buildings.get(id);
  if (!b) return;
  // Return a portion of the materials to the stores.
  for (const k in b.delivered) {
    const res = k as ResId;
    addToStores(g, res, (b.delivered[res] ?? 0) * 0.5, b.cx, b.cy);
  }
  for (const k in b.store) addToStores(g, k as ResId, b.store[k as ResId] ?? 0, b.cx, b.cy);
  for (const vid of b.workers) {
    const v = g.villagers.get(vid);
    if (v) { v.jobId = -1; v.releaseAll(g); }
  }
  for (const vid of b.residents) {
    const v = g.villagers.get(vid);
    if (v) { v.homeId = -1; v.releaseAll(g); }
  }
  unregisterFootprint(g, b);
  g.buildings.delete(id);
  g.reassignPending = true;
  refreshServices(g);
  g.log(`${b.name} demolished.`, 'info');
}

export function completeBuilding(g: Game, b: Building, silent = false): void {
  b.state = 'active';
  b.status = 'Idle';
  b.computeEntrance(g.world);
  if (b.isHouse) b.tier = 1;
  g.reassignPending = true;
  refreshServices(g);
  if (!silent && b.def.cat !== 'decor' && b.defId !== 'road') {
    g.log(`${b.name} finished.`, 'good');
  }
}

export function hasBuilding(g: Game, defId: string): boolean {
  for (const b of g.buildings.values()) {
    if (b.defId === defId && b.state === 'active') return true;
  }
  return false;
}
