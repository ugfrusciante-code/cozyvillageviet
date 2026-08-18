/**
 * Runs the simulation with no renderer, building out a plausible village, so
 * the economy can be checked for stalls, starvation and deadlocked hauling.
 *
 *   npm run sim [days] [seed]
 *
 * The build order itself lives in `driver.ts`, shared with `determinism.ts`.
 */

import { FOOD_TYPES, TUNING, type ResId } from '../src/sim/defs';
import { runVillage } from './driver';
import type { Game } from '../src/sim/game';

const DAYS = Number(process.argv[2] ?? 70);
const SEED = Number(process.argv[3] ?? 20260817);

function stockLine(g: Game): string {
  const keys: ResId[] = ['logs', 'planks', 'stone', 'firewood', 'bread', 'berries', 'meat', 'grain', 'clothes', 'ale'];
  return keys.map((k) => `${k[0].toUpperCase()}${k.slice(1, 3)} ${Math.round(g.stockOf(k))}`).join('  ');
}

function report(g: Game): void {
  const food = FOOD_TYPES.reduce((s, f) => s + g.stockOf(f), 0);
  const daysFood = food / Math.max(1, g.population * TUNING.foodPerDay);
  const tiers = [0, 0, 0];
  for (const b of g.buildings.values()) if (b.isHouse && b.state === 'active') tiers[b.tier - 1]++;
  const sites = [...g.buildings.values()].filter((b) => b.state !== 'active').length;
  console.log(
    `Y${g.year} ${g.season.padEnd(6)} d${String(g.day).padStart(2)} | ` +
    `pop ${String(g.population).padStart(3)} (${g.children}c ${g.idleAdults}idle) | ` +
    `content ${(g.averageContentment * 100).toFixed(0)}% | ` +
    `coin ${Math.round(g.coin).toString().padStart(5)} | ` +
    `food ${daysFood.toFixed(1)}d | homes T1/2/3 ${tiers.join('/')} | sites ${sites}`,
  );
  if (g.day % 12 === 0) console.log(`         ${stockLine(g)}`);
}

const g = runVillage(SEED, DAYS, {
  onDay: (game) => { if (game.day % 4 === 0) report(game); },
  onSkip: (game, id) => console.log(`  [day ${game.day}] skipped ${id}`),
});

console.log('\n--- final ---');
report(g);
console.log(`buildings: ${g.buildings.size}, villagers: ${g.villagers.size}`);
for (const b of g.buildings.values()) {
  console.log(
    `  #${b.id} ${b.name.padEnd(18)} ${b.state.padEnd(9)} ` +
    `mat=${JSON.stringify(b.delivered)} need=${JSON.stringify(b.outstandingMaterials())} ` +
    `prog=${b.buildProgress.toFixed(0)}/${b.def.buildWork} jobs=${b.workers.length}/${b.jobSlots} ` +
    `store=${JSON.stringify(b.store)} status="${b.status}"`,
  );
}
const stalled = [...g.buildings.values()]
  .filter((b) => b.state === 'active' && b.workers.length > 0 && b.activity < 0.02)
  .map((b) => `${b.name}: ${b.status}`);
console.log(`stalled workplaces (${stalled.length}):`);
for (const s of [...new Set(stalled)].slice(0, 14)) console.log('  -', s);
console.log('\nrecent events:');
for (const e of g.events.slice(-12)) console.log(`  d${e.day} [${e.kind}] ${e.text}`);
