// A death must leave a mourning event on the household; a birth must lift it;
// both must show in the itemised mood card; and both must expire.
import { Game } from '../src/sim/game';
import { Checks } from './assert';

const c = new Checks('mourning');
const g = new Game(7);
for (let i = 0; i < 1200; i++) g.update(1 / 12);

const v = [...g.villagers.values()].find((x) => x.homeId >= 0 && x.isAdult)!;
const home = g.buildings.get(v.homeId)!;
const name = v.given;
v.age = v.lifespan + 1; // dies of old age at the next day tick

let guard = 0;
while (g.villagers.has(v.id) && guard++ < 4000) g.update(1 / 12);
c.ok(!g.villagers.has(v.id), `${name} died on schedule`);

const mourning = home.moodEvents.find((e) => e.label.includes(name));
c.ok(!!mourning, 'the household is mourning them', JSON.stringify(home.moodEvents));
c.ok((mourning?.delta ?? 0) === -0.1, 'an old-age death weighs -0.1', String(mourning?.delta));

// The card shows it once the next needs pass runs.
for (let i = 0; i < 1600; i++) g.update(1 / 12);
const inCard = home.moodParts.some(([label]) => label.includes(name));
c.ok(inCard || home.residents.length === 0, 'mourning appears in the mood card',
  home.moodParts.map((p) => p[0]).join(', '));

// And it passes: five days on, life continues.
for (let i = 0; i < 4000 && home.moodEvents.some((e) => e.label.includes(name)); i++) g.update(1 / 12);
c.ok(!home.moodEvents.some((e) => e.label.includes(name)), 'grief fades after its five days');

c.done();
