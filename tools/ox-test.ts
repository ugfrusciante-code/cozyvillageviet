/** Confirms oxen get yoked, raise haul size, and are always returned. */
import { Game } from '../src/sim/game';
import { TUNING } from '../src/sim/defs';

const g = new Game(4242);
function force(id: string, w?: number, h?: number) {
  for (let r = 3; r < 26; r++) for (let k = 0; k < 40; k++) {
    const a = (k / 40) * 6.2832;
    const x = Math.round(g.startX + Math.cos(a) * r), y = Math.round(g.startY + Math.sin(a) * r);
    if (g.canPlace(id, x, y, w, h).ok) {
      const b = g.place(id, x, y, w, h);
      if (b) {
        const c = b.buildCost();
        for (const kk in c) (b.delivered as Record<string, number>)[kk] = (c as Record<string, number>)[kk];
        b.buildProgress = b.buildWorkTotal;
        g.completeBuilding(b, true);
        return b;
      }
    }
  }
  return null;
}

for (const id of ['woodcutter', 'sawpit', 'woodshed', 'storehouse', 'cottage', 'cottage']) force(id);
// Population past the stable gate.
const homes = [...g.buildings.values()].filter((b) => b.isHouse);
import('../src/sim/villager').then(async ({ Villager }) => {
  for (let i = 0; i < 14; i++) {
    const home = homes[i % homes.length];
    const v = new Villager(home.cx, home.cy + 1, 24, () => Math.random());
    v.homeId = home.id;
    g.villagers.set(v.id, v);
  }
  const stable = force('stable');
  console.log(`stable built: ${!!stable}, oxen: ${g.oxenTotal}`);

  // Pile up a backlog worth carting.
  const store = [...g.buildings.values()].find((b) => b.isStorage)!;
  store.add('logs', 300);
  const wc = [...g.buildings.values()].find((b) => b.defId === 'woodcutter')!;
  wc.add('logs', 200);

  let maxInUse = 0, everCarted = 0, maxLoad = 0;
  for (let i = 0; i < 20000; i++) {
    g.update(1 / 12);
    maxInUse = Math.max(maxInUse, g.oxenInUse);
    for (const v of g.villagers.values()) {
      if (v.hasOx) everCarted++;
      if (v.carry) maxLoad = Math.max(maxLoad, v.carry.amt);
    }
  }
  console.log(`peak oxen in use: ${maxInUse} / ${g.oxenTotal}`);
  console.log(`cart-frames observed: ${everCarted}`);
  console.log(`largest single load: ${maxLoad.toFixed(0)} (walking cap ${TUNING.carryCapacity}, cart cap ${TUNING.cartCapacity})`);
  let failed = 0;
  const gate = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`); };
  gate(maxLoad > TUNING.carryCapacity, 'carts move more than a person can');
  gate(g.oxenInUse <= g.oxenTotal, 'ox pool never oversubscribed');

  // Nobody mid-trip at the end should leave the pool stuck high forever.
  const carrying = [...g.villagers.values()].filter((v) => v.hasOx).length;
  console.log(`oxen accounted for: inUse=${g.oxenInUse}, villagers holding=${carrying}`);
  gate(g.oxenInUse === carrying, 'ox accounting balanced');
  process.exit(failed === 0 ? 0 : 1);
});
