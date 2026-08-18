/**
 * The watch: a manned tower blunts a raid, an empty one is timber, and the
 * job leaps up the priority ladder the moment riders are sighted.
 */
import { Game } from '../src/sim/game';
import { TUNING } from '../src/sim/defs';
import { Villager } from '../src/sim/villager';
import { autoPriority, BAND, reassign } from '../src/sim/systems/labour';
import { mannedWatchesOver } from '../src/sim/systems/watch';
import { Checks } from './assert';

const c = new Checks('the watch');

/** A raid against seed 11 with `towers` manned watchtowers by the store. */
function raidOutcome(towers: number): { stolen: number; landed: boolean } {
  const g = new Game(11);
  // The tower wants ten villagers before the village will raise one.
  for (let i = 0; i < 4; i++) {
    const v = new Villager(g.startX + i, g.startY + 2, 25, () => 0.5);
    g.villagers.set(v.id, v);
  }
  const store = [...g.buildings.values()].find((b) => b.isStorage)!;
  store.add('tools', 40); store.add('clothes', 40);
  for (let t = 0; t < towers; t++) {
    let placed = null;
    for (let r = 3; r < 12 && !placed; r++) {
      for (let k = 0; k < 20 && !placed; k++) {
        const a = (k / 20) * Math.PI * 2;
        placed = g.place('watchtower', Math.round(store.cx + Math.cos(a) * r), Math.round(store.cy + Math.sin(a) * r));
      }
    }
    if (!placed) throw new Error('nowhere to put a tower');
    placed.state = 'active';
    placed.jobSlots = 1;
  }
  reassign(g);
  const before = store.total();
  g.raidThreat = 999; g.raidAtDay = g.day;
  g.day = Math.max(g.day, TUNING.raidGraceDays); g.lastDay = g.day - 1;
  g.t = (g.day * TUNING.hoursPerDay + 7) * TUNING.secondsPerHour;
  let landed = false;
  for (let i = 0; i < 120000; i++) {
    g.update(1 / 12);
    if (g.raiders.length > 0) landed = true;
    if (g.raidAtDay < 0 && g.raiders.length === 0 && i > 200) break;
  }
  return { stolen: before - store.total(), landed };
}

const bare = raidOutcome(0);
const watched = raidOutcome(2);
c.ok(bare.landed && bare.stolen > 0, 'an unwatched store is robbed', `lost ${bare.stolen.toFixed(0)}`);
c.ok(watched.stolen < bare.stolen, 'manned towers mean lighter losses',
  `${bare.stolen.toFixed(0)} unwatched vs ${watched.stolen.toFixed(0)} watched`);

// Priority: cold tower in peacetime, everything-drops when riders are near.
const g = new Game(13);
for (let i = 0; i < 4; i++) {
  const v = new Villager(g.startX + i, g.startY + 2, 25, () => 0.5);
  g.villagers.set(v.id, v);
}
let b = null;
for (let r = 4; r < 14 && !b; r++) {
  for (let k = 0; k < 24 && !b; k++) {
    const a = (k / 24) * Math.PI * 2;
    b = g.place('watchtower', Math.round(g.startX + Math.cos(a) * r), Math.round(g.startY + Math.sin(a) * r));
  }
}
if (!b) throw new Error('nowhere to put the priority tower');
b!.state = 'active';
const calm = autoPriority(g, b!);
g.raidAtDay = g.day + 2;
const alarmed = autoPriority(g, b!);
c.ok(calm < BAND.ROUTINE, 'peacetime watch is low work', `${calm}`);
c.ok(alarmed >= BAND.URGENT, 'sighted riders make the tower the job that matters', `${alarmed}`);

// An unmanned tower counts for nothing.
b!.workers = [];
c.eq(mannedWatchesOver(g, b!.cx, b!.cy), 0, 'an empty tower deters nobody');

c.done();
