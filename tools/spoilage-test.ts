/**
 * Spoilage mechanics, asserted in isolation: the granary genuinely preserves,
 * honey keeps for ever, winter is a larder, and rot never touches goods a
 * hauler has already reserved.
 */
import { Game } from '../src/sim/game';
import { spoilFood } from '../src/sim/systems/spoilage';
import { Checks } from './assert';

const c = new Checks('spoilage');

const g = new Game(7);
g.speed = 0; // nothing moves; we drive spoilFood by hand
const granary = g.place('granary', g.startX + 8, g.startY + 8)
  ?? g.place('granary', g.startX - 10, g.startY + 6);
c.ok(!!granary, 'placed a granary to test with');
granary!.state = 'active';
const market = [...g.buildings.values()].find((b) => b.def.service?.kind === 'market')!;

// Same bread, two shelves. (The market starts stocked from founding day —
// clear it so both shelves begin equal.)
market.store = {};
granary!.add('bread', 100);
market.add('bread', 100);
market.add('honey', 50);

g.season = 'spring';
for (let d = 0; d < 10; d++) spoilFood(g);

const inGranary = granary!.amount('bread');
const onStall = market.amount('bread');
c.ok(inGranary > onStall, 'bread keeps better in the granary', `${inGranary.toFixed(1)} vs ${onStall.toFixed(1)}`);
const granaryLoss = 100 - inGranary, stallLoss = 100 - onStall;
c.ok(granaryLoss < stallLoss * 0.25, 'granary preserves at least 4x better',
  `granary lost ${granaryLoss.toFixed(2)}, stall lost ${stallLoss.toFixed(2)}`);
c.eq(market.amount('honey'), 50, 'honey never turns');

// Season: the same stall loses more bread in summer than in winter.
const summer = new Game(8), winter = new Game(9);
for (const [game, season] of [[summer, 'summer'], [winter, 'winter']] as const) {
  game.season = season;
  const m = [...game.buildings.values()].find((b) => b.def.service?.kind === 'market')!;
  m.store = {}; m.add('bread', 100);
  spoilFood(game);
}
const summerLoss = 100 - [...summer.buildings.values()].find((b) => b.def.service?.kind === 'market')!.amount('bread');
const winterLoss = 100 - [...winter.buildings.values()].find((b) => b.def.service?.kind === 'market')!.amount('bread');
c.ok(summerLoss > winterLoss * 2.5, 'summer rots ~3x faster than winter',
  `summer ${summerLoss.toFixed(2)}, winter ${winterLoss.toFixed(2)}`);

// Reserved stock is spoken for: rot must never make a reservation a lie.
const g2 = new Game(11);
const m2 = [...g2.buildings.values()].find((b) => b.def.service?.kind === 'market')!;
m2.store = {}; m2.add('berries', 20);
m2.reserveOut('berries', 20); // a hauler has claimed the lot
g2.season = 'summer';
for (let d = 0; d < 5; d++) spoilFood(g2);
c.eq(m2.amount('berries'), 20, 'fully reserved stock never rots');
c.ok((m2.reservedOut.berries ?? 0) <= m2.amount('berries') + 0.001,
  'no building ever promises more than it holds');

c.done();
