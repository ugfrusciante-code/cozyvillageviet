/** Force-feeds a village everything tier 2 and 3 need, and checks homes climb. */
import { Game } from '../src/sim/game';
import { BUILDING_BY_ID } from '../src/sim/defs';

const g = new Game(20260817);

function force(id: string): boolean {
  const def = BUILDING_BY_ID[id];
  for (let r = 2; r < 30; r++) for (let k = 0; k < 40; k++) {
    const a = (k / 40) * 6.2832;
    const x = Math.round(g.startX + Math.cos(a) * r), y = Math.round(g.startY + Math.sin(a) * r);
    if (g.canPlace(id, x, y).ok) {
      const b = g.place(id, x, y);
      if (b) {
        // Skip the construction phase; this test is about the tier rules.
        for (const kk in def.cost) (b.delivered as Record<string, number>)[kk] = (def.cost as Record<string, number>)[kk];
        b.buildProgress = def.buildWork;
        g.completeBuilding(b, true);
        b.jobSlots = def.jobs;
        return true;
      }
    }
  }
  console.log('  could not place', id);
  return false;
}

for (const id of ['chapel', 'well', 'flowerbed', 'flowerbed', 'garden', 'fountain', 'tavern', 'storehouse']) force(id);

const market = [...g.buildings.values()].find((b) => b.defId === 'market')!;
const store = [...g.buildings.values()].find((b) => b.isStorage)!;
const tavern = [...g.buildings.values()].find((b) => b.defId === 'tavern')!;

function topUp(): void {
  // Stand in for a working economy: keep the stores full of every need.
  for (const r of ['bread', 'berries', 'meat', 'fish', 'firewood', 'clothes', 'shoes', 'ale', 'pottery', 'candles'] as const) {
    if (store.amount(r) < 60) store.add(r, 60 - store.amount(r));
    if (market.amount(r) < 30) market.add(r, 30 - market.amount(r));
  }
  if (tavern.amount('ale') < 20) tavern.add('ale', 20);
}

let lastDay = -1;
while (g.day < 26) {
  g.update(1 / 12);
  if (g.day !== lastDay) {
    lastDay = g.day;
    topUp();
    const t = [0, 0, 0];
    for (const b of g.buildings.values()) if (b.isHouse && b.state === 'active') t[b.tier - 1]++;
    const h = [...g.buildings.values()].find((b) => b.isHouse)!;
    console.log(
      `d${String(g.day).padStart(2)} ${g.season.padEnd(6)} pop ${String(g.population).padStart(2)} ` +
      `content ${(g.averageContentment * 100).toFixed(0)}% tiers ${t.join('/')} ` +
      `charm ${h.localCharm.toFixed(0)} | blockers: ${h.upgradeBlockers.join(', ') || 'none'}`,
    );
  }
}
console.log('\ntax last season:', Math.round(g.stats.lastTax), 'coin:', Math.round(g.coin));
