/**
 * Herds: they arrive, grow into the paddock, eat their winter stores, starve
 * legibly, feed the larder at capacity, and dung the ground under them —
 * into fertilityBase, because anything written to fertility itself is undone
 * by the nightly drift.
 */
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { herdCapacity, herdTick } from '../src/sim/systems/livestock';
import { Villager } from '../src/sim/villager';
import { Checks } from './assert';

const c = new Checks('livestock');

function withPasture(seed: number, side: number): { g: Game; p: import('../src/sim/building').Building } {
  const g = new Game(seed);
  for (let i = 0; i < 8; i++) {
    const v = new Villager(g.startX + i * 0.3, g.startY + 2, 25, () => 0.5);
    g.villagers.set(v.id, v);
  }
  for (let r = 4; r < 20; r++) {
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const x = Math.round(g.startX + Math.cos(a) * r), y = Math.round(g.startY + Math.sin(a) * r);
      if (g.canPlace('pasture', x, y, side, side).ok) {
        const p = g.place('pasture', x, y, side, side)!;
        p.state = 'active';
        return { g, p };
      }
    }
  }
  throw new Error('no room for a pasture');
}

// --- Capacity scales with the drag.
const small = withPasture(7, 3);
const big = withPasture(7, 9);
c.ok(herdCapacity(big.p) > herdCapacity(small.p) * 3,
  'a big paddock feeds far more than a small one',
  `${herdCapacity(small.p)} vs ${herdCapacity(big.p)} head`);

// --- The founding pair arrives and the herd grows toward capacity in the green months.
const { g, p } = withPasture(11, 6);
g.season = 'spring';
herdTick(g);
c.eq(p.herd, 2, 'the founding pair arrives with the fence');
for (let d = 0; d < 120; d++) { g.season = d % 2 ? 'spring' : 'summer'; herdTick(g); }
c.ok(p.herd >= herdCapacity(p), 'a fed herd grows into its paddock',
  `${p.herd}/${herdCapacity(p)} after 120 green days`);

// --- At capacity, breeding becomes the larder. (Porters clear the shed in
// real play; here the store is emptied so the cull window is not measuring
// leftover shelf space.)
p.store = {};
for (let d = 0; d < 80; d++) { g.season = 'summer'; herdTick(g); }
c.ok(p.amount('meat') > 0 && p.amount('hide') > 0,
  'a full paddock turns surplus lambs into meat and hides',
  `+${p.amount('meat').toFixed(0)} meat, +${p.amount('hide').toFixed(0)} hide`);

// --- Winter without fodder starves the flock; with fodder it holds.
const lean = withPasture(13, 6);
lean.g.season = 'spring';
herdTick(lean.g);
lean.p.herd = 6;
lean.g.season = 'winter';
const before = lean.p.herd;
for (let d = 0; d < 12; d++) herdTick(lean.g);
c.ok(lean.p.herd < before, 'an unprovisioned winter thins the flock', `${before} -> ${lean.p.herd}`);

const fed = withPasture(17, 6);
fed.g.season = 'spring';
herdTick(fed.g);
fed.p.herd = 6;
fed.p.add('grain', 60);
fed.g.season = 'winter';
for (let d = 0; d < 12; d++) herdTick(fed.g);
c.eq(fed.p.herd >= 6, true, 'a provisioned flock winters whole');

// --- Manure enriches the base, and the drift then lifts the soil itself.
const { g: mg, p: mp } = withPasture(19, 6);
mg.season = 'spring';
herdTick(mg);
mp.herd = herdCapacity(mp);
const w = mg.world;
const i0 = w.idx(mp.x, mp.y);
const baseBefore = w.fertilityBase[i0];
for (let d = 0; d < 60; d++) herdTick(mg);
c.ok(w.fertilityBase[i0] > baseBefore, 'a stocked paddock enriches fertilityBase',
  `${baseBefore.toFixed(3)} -> ${w.fertilityBase[i0].toFixed(3)}`);

// --- The herd survives a save.
const round = deserialize(JSON.parse(JSON.stringify(serialize(g))));
const rp = [...round.buildings.values()].find((b) => b.def.husbandry)!;
c.ok(rp.herd === p.herd && rp.herdFounded, 'the flock survives a save', `${rp.herd} head`);

// --- And a starved-out paddock stays empty rather than respawning sheep.
lean.p.herd = 0;
for (let d = 0; d < 6; d++) herdTick(lean.g);
c.eq(lean.p.herd, 0, 'a lost flock does not respawn for free');

c.done();
