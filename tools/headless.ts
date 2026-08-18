/**
 * Runs the simulation with no renderer, building out a plausible village, so
 * the economy can be checked for stalls, starvation and deadlocked hauling.
 *
 *   npm run sim
 */

import { Game } from '../src/sim/game';
import { BUILDING_BY_ID, FOOD_TYPES, TUNING, type ResId } from '../src/sim/defs';
import { RNG } from '../src/sim/world';

const SEED = Number(process.argv[3] ?? 20260817);
const g = new Game(SEED);
g.speed = 1;
const prng = new RNG(SEED ^ 0x5f3a);

const ox = g.startX, oy = g.startY;

/** Try to place `defId` somewhere near the settlement centre. */
function plop(defId: string, hintX = ox, hintY = oy, spread = 26): boolean {
  const def = BUILDING_BY_ID[defId];
  for (let r = 1; r < spread; r++) {
    for (let k = 0; k < 26; k++) {
      const a = prng.next() * Math.PI * 2;
      const x = Math.round(hintX + Math.cos(a) * r);
      const y = Math.round(hintY + Math.sin(a) * r);
      if (g.canPlace(defId, x, y).ok) {
        const b = g.place(defId, x, y);
        if (b) { b.jobSlots = def.jobs; return true; }
      }
    }
  }
  return false;
}

/**
 * A build order a competent player might follow. Each entry only goes down
 * once the village can support it, and only two sites run at a time — which is
 * how a real player paces construction.
 */
const QUEUE: { id: string; minPop?: number }[] = [
  { id: 'woodcutter' }, { id: 'forager' }, { id: 'woodshed' },
  { id: 'cottage' }, { id: 'sawpit' }, { id: 'cottage' },
  { id: 'granary', minPop: 9 }, { id: 'forester', minPop: 9 },
  { id: 'hunter', minPop: 10 }, { id: 'cottage', minPop: 10 },
  { id: 'quarry', minPop: 11 }, { id: 'chapel', minPop: 11 },
  { id: 'cottage', minPop: 12 }, { id: 'field', minPop: 13 },
  { id: 'pasture', minPop: 14 }, { id: 'cottage', minPop: 15 },
  { id: 'weaver', minPop: 16 }, { id: 'tailor', minPop: 17 },
  { id: 'mill', minPop: 18 }, { id: 'bakery', minPop: 19 },
  { id: 'cottage', minPop: 20 }, { id: 'townhall', minPop: 21 },
  { id: 'well', minPop: 22 }, { id: 'claypit', minPop: 24 },
  { id: 'kiln', minPop: 25 }, { id: 'cottage', minPop: 26 },
  { id: 'herbalist', minPop: 27 }, { id: 'brewery', minPop: 28 },
  { id: 'tavern', minPop: 30 }, { id: 'garden', minPop: 30 },
  { id: 'tannery', minPop: 32 }, { id: 'cobbler', minPop: 33 },
  { id: 'cottage', minPop: 34 }, { id: 'storehouse', minPop: 35 },
  { id: 'blacksmith', minPop: 36 }, { id: 'tradepost', minPop: 38 },
  { id: 'apiary', minPop: 39 }, { id: 'chandler', minPop: 40 },
  { id: 'school', minPop: 42 }, { id: 'apothecary', minPop: 44 },
  { id: 'healer', minPop: 46 }, { id: 'pottery', minPop: 48 },
  { id: 'church', minPop: 50 }, { id: 'fountain', minPop: 52 },
];

let qi = 0;
let lastReport = -1;
let lastCheck = -1;
const DAYS = Number(process.argv[2] ?? 70);

const step = 1 / 12;
let guard = 0;
while (g.day < DAYS && guard++ < 8_000_000) {
  g.update(step);

  // Re-evaluate the build order a few times a day.
  const slot = Math.floor(g.totalHours / 6);
  if (slot !== lastCheck) {
    lastCheck = slot;
    const openSites = [...g.buildings.values()].filter((b) => b.state !== 'active').length;
    if (openSites < 2 && qi < QUEUE.length) {
      const next = QUEUE[qi];
      if (g.population >= (next.minPop ?? 0)) {
        if (plop(next.id)) qi++;
        else if (g.canPlace(next.id, g.startX, g.startY).reason?.includes('Requires')) { /* wait */ }
        else { console.log(`  [day ${g.day}] skipped ${next.id}`); qi++; }
      }
    }
  }

  if (g.day !== lastReport && g.hour > 12) {
    lastReport = g.day;
    if (g.day % 4 === 0) report();
  }
}

function stockLine(): string {
  const keys: ResId[] = ['logs', 'planks', 'stone', 'firewood', 'bread', 'berries', 'meat', 'grain', 'clothes', 'ale'];
  return keys.map((k) => `${k[0].toUpperCase()}${k.slice(1, 3)} ${Math.round(g.stockOf(k))}`).join('  ');
}

function report(): void {
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
  if (g.day % 12 === 0) console.log(`         ${stockLine()}`);
}

console.log('\n--- final ---');
report();
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
