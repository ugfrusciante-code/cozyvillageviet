/**
 * Milestones: they fire when earned, never twice, and survive a save.
 */
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { MILESTONES } from '../src/sim/systems/milestones';
import { Checks } from './assert';

const c = new Checks('milestones');

const ids = new Set(MILESTONES.map((m) => m.id));
c.ok(ids.size === MILESTONES.length, 'milestone ids are unique');

const g = new Game(7);
let guard = 0;
while (g.day < 18 && guard++ < 200000) g.update(1 / 12);

c.ok(g.milestonesDone['first-winter'] !== undefined, 'The First Winter fires at the second spring',
  `done: ${Object.keys(g.milestonesDone).join(', ') || 'none'}`);
c.ok(g.milestonesDone['twenty-souls'] === undefined, 'Twenty Souls does not fire at pop ' + g.population);
c.ok(g.events.some((e) => e.text.includes('The First Winter')), 'the chronicle records it');

const firedOn = g.milestonesDone['first-winter'];
for (let i = 0; i < 3000; i++) g.update(1 / 12);
c.ok(g.milestonesDone['first-winter'] === firedOn, 'a milestone never re-fires or moves its day');

const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
c.eq(g2.milestonesDone, g.milestonesDone, 'the chronicle survives a save');

// A pre-milestone save (no key at all) loads with none done, not a crash.
const old = JSON.parse(JSON.stringify(serialize(g)));
delete old.milestones;
const g3 = deserialize(old);
c.eq(g3.milestonesDone, {}, 'an older save simply starts the chronicle fresh');

c.done();
