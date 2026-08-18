/**
 * Founding the settlement.
 *
 * Picks where the first villagers stop walking — flat, dry, near water, with
 * forage now and plough-land to grow into — then hands them a storehouse, a
 * stall, a well and three cottages so the household supply loop is already
 * turning on the first morning rather than after the first crisis.
 */

import { BUILDING_BY_ID, TUNING, type ResId } from '../defs';
import { Building, resetBuildingIds } from '../building';
import { resetFamilyIds } from '../family';
import { Villager, resetVillagerIds } from '../villager';
import { NODE_INDEX } from '../world';
import type { Game } from '../game';
import { foundFamily } from './families';
import { reassign } from './labour';
import { registerFootprint } from './placement';
import { refreshServices } from './services';

/** Place a starting building, ignoring cost, already complete. */
export function forcePlace(g: Game, defId: string, x: number, y: number): Building | null {
  const def = BUILDING_BY_ID[defId];
  for (let r = 0; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx, py = y + dy;
        if (g.world.canPlace(px, py, def.size[0], def.size[1], 1.2).ok) {
          const b = new Building(defId, px, py, g.world);
          registerFootprint(g, b);
          b.state = 'active';
          b.buildProgress = b.buildWorkTotal;
          const cost = b.buildCost();
          for (const k in cost) b.delivered[k as ResId] = cost[k as ResId] ?? 0;
          b.computeEntrance(g.world);
          g.buildings.set(b.id, b);
          return b;
        }
      }
    }
  }
  return null;
}

export function setupStart(g: Game): void {
  resetBuildingIds();
  resetVillagerIds();
  resetFamilyIds();
  const w = g.world;

  // Find a flat, dry, pleasant spot near the middle of the valley to settle.
  let best = { x: w.size / 2, y: w.size / 2, score: -Infinity };
  for (let y = 20; y < w.size - 20; y += 2) {
    for (let x = 20; x < w.size - 20; x += 2) {
      const chk = w.canPlace(x - 4, y - 4, 9, 9, 1.4);
      if (!chk.ok) continue;
      let trees = 0, forage = 0, farmland = 0, flat = 0;
      for (let dy = -9; dy <= 9; dy++) {
        for (let dx = -9; dx <= 9; dx++) {
          if (!w.inBounds(x + dx, y + dy)) continue;
          const i = w.idx(x + dx, y + dy);
          const kind = w.node[i];
          if (kind === NODE_INDEX['tree']) trees++;
          else if (kind === NODE_INDEX['berry'] || kind === NODE_INDEX['game']) forage++;
          // Open, fertile, dry ground: where the fields will eventually go.
          if (kind === 0 && !w.water[i] && w.fertility[i] > 0.4) farmland++;
          if (Math.abs(dx) <= 6 && Math.abs(dy) <= 6) flat -= w.slopeAt(x + dx, y + dy);
        }
      }
      const nearWater = w.isNearWater(x, y, 12) ? 14 : 0;
      const centre = -Math.hypot(x - w.size / 2, y - w.size / 2) * 0.7;
      // Food first, then farmland to grow into — a settlement with no
      // plough-land nearby is a dead end even if the berries are lovely.
      const score = Math.min(trees, 260) * 0.06 + Math.min(forage, 60) * 0.5
        + Math.min(farmland, 70) * 0.34
        + flat * 0.6 + nearWater + centre;
      if (score > best.score) best = { x, y, score };
    }
  }
  const ox = Math.round(best.x), oy = Math.round(best.y);
  g.startX = ox; g.startY = oy;

  const store = forcePlace(g, 'storehouse', ox - 1, oy - 1);
  if (store) {
    store.jobSlots = 1;
    store.add('logs', 70); store.add('planks', 34); store.add('stone', 40);
    store.add('bread', 46); store.add('berries', 24); store.add('firewood', 30);
    // Enough tools to sink a quarry AND a mine, so the iron chain is always
    // reachable however the player sequences those two.
    store.add('tools', 8); store.add('clothes', 6);
  }
  // The settlers arrive with a stall pitched and a well already sunk, so the
  // household supply loop is running from the first minute.
  const market = forcePlace(g, 'market', ox - 6, oy - 1);
  if (market) {
    market.jobSlots = 1;
    market.add('bread', 20); market.add('berries', 12); market.add('firewood', 16);
    market.add('clothes', 4);
  }
  forcePlace(g, 'well', ox - 2, oy + 2);

  const c1 = forcePlace(g, 'cottage', ox - 5, oy + 3);
  const c2 = forcePlace(g, 'cottage', ox + 3, oy + 3);
  const c3 = forcePlace(g, 'cottage', ox - 5, oy - 4);

  const homes = [c1, c2, c3].filter(Boolean) as Building[];
  for (let i = 0; i < TUNING.startingVillagers; i++) {
    const home = homes[i % Math.max(1, homes.length)];
    const age = i < 2 ? 8 + Math.floor(g.rand() * 5) : 18 + Math.floor(g.rand() * 26);
    const v = new Villager(
      (home?.cx ?? ox) + (g.rand() - 0.5) * 2,
      (home?.cy ?? oy) + 1.5 + (g.rand() - 0.5) * 2,
      age, () => g.rand(),
    );
    if (home) { v.homeId = home.id; home.residents.push(v.id); }
    g.villagers.set(v.id, v);
  }
  // Group the settlers into founding families, one household per cottage,
  // so everyone under a roof shares a surname from the first day.
  for (const h of homes) {
    const fam = foundFamily(g, h);
    for (const vid of h.residents) {
      const v = g.villagers.get(vid);
      if (!v) continue;
      v.familyId = fam.id;
      fam.memberIds.push(vid);
      v.takeSurname(fam.surname);
    }
  }

  g.log('Your people arrive in the valley. Give them shelter before winter.', 'info');
  refreshServices(g);
  reassign(g);
}
