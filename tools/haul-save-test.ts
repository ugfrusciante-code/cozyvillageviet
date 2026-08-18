/**
 * Regression: a villager saved mid-haul used to teleport-complete the delivery
 * on load, because save.ts left `toPickup`/`toDrop` intact with an empty path
 * and `stepPath` treats an empty path as "arrived".
 *
 * Also asserts the reservation ledger and node claims come back consistent.
 */
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { BUILDING_BY_ID, type ResId } from '../src/sim/defs';
import { RNG } from '../src/sim/world';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const SEED = 20260817;
const g = new Game(SEED);
const prng = new RNG(SEED ^ 0x5f3a);

function plop(id: string): boolean {
  for (let r = 2; r < 26; r++) for (let k = 0; k < 26; k++) {
    const a = prng.next() * 6.2832;
    const x = Math.round(g.startX + Math.cos(a) * r), y = Math.round(g.startY + Math.sin(a) * r);
    if (g.canPlace(id, x, y).ok) { const b = g.place(id, x, y); if (b) { b.jobSlots = BUILDING_BY_ID[id].jobs; return true; } }
  }
  return false;
}
for (const id of ['woodcutter', 'forager', 'woodshed', 'sawpit', 'granary']) plop(id);

// Run until several villagers are genuinely mid-trip.
let midTrip: ReturnType<typeof collect> = [];
function collect() {
  return [...g.villagers.values()]
    .filter((v) => v.action === 'toPickup' || v.action === 'toDrop' || v.action === 'toDeposit')
    .map((v) => ({
      id: v.id, action: v.action, x: v.x, y: v.y,
      carry: v.carry ? { ...v.carry } : null,
      targetB: v.targetB, fetchRes: v.fetchRes, fetchAmt: v.fetchAmt,
    }));
}
for (let i = 0; i < 60000; i++) {
  g.update(1 / 12);
  if (i > 4000 && i % 7 === 0) {
    midTrip = collect();
    if (midTrip.length >= 2) break;
  }
}
check(midTrip.length >= 2, 'found villagers mid-haul to test with', `${midTrip.length} in transit`);

// Total goods in the world before the save.
const ALL: ResId[] = ['logs', 'planks', 'firewood', 'berries', 'meat', 'grain', 'bread', 'stone'];
const worldTotal = (x: Game) => {
  let t = 0;
  for (const b of x.buildings.values()) for (const r of ALL) t += b.amount(r);
  for (const v of x.villagers.values()) if (v.carry && ALL.includes(v.carry.res)) t += v.carry.amt;
  return t;
};
const before = worldTotal(g);
const beforeIds = midTrip.map((m) => m.id);

const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));

// 1. Nobody comes back still walking.
const stillWalking = [...g2.villagers.values()].filter(
  (v) => v.action === 'toPickup' || v.action === 'toDrop' || v.action === 'toDeposit' || v.action === 'toSite',
);
check(stillWalking.length === 0, 'no villager restored in a walking state',
  stillWalking.length ? stillWalking.map((v) => `${v.name}:${v.action}`).join(', ') : 'all reset to idle');

// 2. Goods are conserved across the save — nothing teleported into a store.
const after = worldTotal(g2);
check(Math.abs(before - after) < 0.001, 'goods conserved across save/load',
  `${before.toFixed(2)} → ${after.toFixed(2)}`);

// 3. The formerly in-transit villagers still physically hold their load.
const keptLoad = beforeIds.every((id) => {
  const wasCarrying = midTrip.find((m) => m.id === id)!.carry;
  const now = g2.villagers.get(id);
  if (!now) return false;
  if (!wasCarrying) return true;
  return !!now.carry && Math.abs(now.carry.amt - wasCarrying.amt) < 0.001;
});
check(keptLoad, 'in-transit villagers still holding their goods after load');

// 4. Reservation ledger is empty and consistent.
let reserved = 0, incoming = 0;
for (const b of g2.buildings.values()) {
  for (const k in b.reservedOut) reserved += b.reservedOut[k as ResId] ?? 0;
  for (const k in b.incoming) incoming += b.incoming[k as ResId] ?? 0;
}
check(reserved === 0 && incoming === 0, 'reservation ledger starts clean',
  `reserved=${reserved} incoming=${incoming}`);

// 5. No node is claimed by a villager who is not working it.
const claimedByIdle = [...g2.villagers.values()].filter((v) => v.targetNode >= 0).length;
check(claimedByIdle === 0, 'no orphaned node claims', `${claimedByIdle} villagers hold a node`);

// 6. Oxen accounting survives the trip.
const holding = [...g2.villagers.values()].filter((v) => v.hasOx).length;
check(g2.oxenInUse === holding && g2.oxenInUse <= g2.oxenTotal, 'ox pool consistent after load',
  `inUse=${g2.oxenInUse} holding=${holding} total=${g2.oxenTotal}`);

// 7. The loaded village keeps running and delivers those goods properly.
const carriedBefore = [...g2.villagers.values()].filter((v) => v.carry).length;
for (let i = 0; i < 6000; i++) g2.update(1 / 12);
const afterRun = worldTotal(g2);
check(afterRun >= after - 0.001, 'village keeps running after load without losing goods',
  `${after.toFixed(2)} → ${afterRun.toFixed(2)}, ${carriedBefore} loads were in hand`);

console.log(failures === 0 ? '\nAll haul-save checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
