/** Grows a large population and times the sim tick, to size the renderer. */
import { Game } from '../src/sim/game';
import { Villager } from '../src/sim/villager';

const g = new Game(4242);
// Force a big population without waiting years for it to breed.
const homes = [...g.buildings.values()].filter((b) => b.isHouse);
for (let i = 0; i < 320; i++) {
  const home = homes[i % homes.length];
  const v = new Villager(home.cx + (Math.random() - 0.5) * 8, home.cy + (Math.random() - 0.5) * 8,
    18 + Math.floor(Math.random() * 20), () => Math.random());
  v.homeId = home.id;
  g.villagers.set(v.id, v);
}
console.log(`population: ${g.villagers.size}`);

const t0 = performance.now();
const STEPS = 600;
for (let i = 0; i < STEPS; i++) g.update(1 / 30);
const ms = performance.now() - t0;
console.log(`${STEPS} sim ticks in ${ms.toFixed(0)}ms  →  ${(ms / STEPS).toFixed(2)}ms per tick`);
console.log(`budget at 60fps is 16.7ms/frame; sim uses ${((ms / STEPS) / 16.7 * 100).toFixed(1)}%`);
console.log(`still alive: ${g.villagers.size}, buildings ${g.buildings.size}`);
