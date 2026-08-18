/**
 * The warning lights: what the player needs to know before it becomes a
 * crisis. Recomputed hourly, deliberately few, and always phrased as the
 * problem rather than the symptom.
 */

import { FOOD_TYPES, RESOURCES, TUNING, type ResId } from '../defs';
import type { Alert, Game } from '../game';
import { stockOf, storageCapacity, storageUsed, totalOf } from './inventory';
import { hasBuilding } from './placement';

export function recomputeAlerts(g: Game): void {
  const a: Alert[] = [];
  const foodStock = FOOD_TYPES.reduce((s, f) => s + stockOf(g, f), 0);
  const daysOfFood = foodStock / Math.max(0.01, g.population * TUNING.foodPerDay);
  if (g.population > 0 && daysOfFood < 2) {
    a.push({ id: 'food', text: `Only ${daysOfFood.toFixed(1)} days of food left`, severity: 'danger' });
  } else if (daysOfFood < 5) {
    a.push({ id: 'food', text: 'Food stores are running low', severity: 'warn' });
  }

  const fuel = stockOf(g, 'firewood');
  const winterish = g.season === 'autumn' || g.season === 'winter';
  if (winterish && fuel < g.population * 1.5) {
    a.push({ id: 'fuel', text: 'Not enough firewood for the cold', severity: g.season === 'winter' ? 'danger' : 'warn' });
  } else if (g.population > 4 && fuel < 1) {
    a.push({ id: 'fuel', text: 'No firewood at all — build a woodshed before winter', severity: 'warn' });
  }

  // Rot outpacing a quarter of what the village eats is a storage problem,
  // not bad luck. spoiledToday accumulates through the day, so this fires
  // late in a bad day and clears at midnight — good enough for a warning lamp.
  let spoiled = 0;
  for (const k in g.stats.spoiledToday) spoiled += g.stats.spoiledToday[k as ResId] ?? 0;
  if (spoiled > g.population * TUNING.foodPerDay * 0.25) {
    a.push({
      id: 'spoilage',
      text: hasBuilding(g, 'granary') ? 'Food is rotting far from the granary' : 'Food is rotting — build a granary',
      severity: 'warn',
    });
  }

  if (g.homeless > 0) a.push({ id: 'homeless', text: `${g.homeless} villagers have no home`, severity: 'warn' });
  if (!hasBuilding(g, 'market') && g.population > 4) {
    a.push({ id: 'market', text: 'No market — homes cannot collect goods', severity: 'danger' });
  }
  if (g.idleAdults > Math.max(3, g.adults * 0.4)) {
    a.push({ id: 'idle', text: `${g.idleAdults} villagers have no work`, severity: 'warn' });
  }
  const cap = storageCapacity(g);
  if (cap > 0 && storageUsed(g) > cap * 0.92) {
    a.push({ id: 'storage', text: 'Storage is nearly full', severity: 'warn' });
  }
  if (g.coin < 0) a.push({ id: 'coin', text: 'The treasury is in debt', severity: 'danger' });

  // Sites that can never finish because the village makes none of what they need.
  const blocked = new Set<string>();
  for (const b of g.buildings.values()) {
    if (b.state === 'active' || b.paused || b.materialsComplete()) continue;
    for (const k of Object.keys(b.materialsOwed()) as ResId[]) {
      if (totalOf(g, k) < 1) blocked.add(RESOURCES[k].name);
    }
  }
  if (blocked.size) {
    a.push({
      id: 'blocked',
      text: `Building sites are waiting on ${[...blocked].slice(0, 3).join(', ')}`,
      severity: 'warn',
    });
  }
  g.alerts = a;
}
