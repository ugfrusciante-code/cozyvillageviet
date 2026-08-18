/**
 * Tool wear: batches consume the kit, a bare toolbox slows the benches, the
 * tinker sells relief without ever taking the last coins.
 */
import { Game } from '../src/sim/game';
import { tinkerTick } from '../src/sim/systems/tinker';
import { takeFromStores } from '../src/sim/systems/inventory';
import { runVillage } from './driver';
import { Checks } from './assert';

const c = new Checks('tool wear');

// A working village — workshops and all — consumes tools over time. A raw
// Game never builds a bench, so this check must play like a player does.
const g = runVillage(7, 30);
c.ok(g.totalOf('tools') < 8, 'thirty days of real work wears the kit down',
  `8 -> ${g.totalOf('tools').toFixed(2)}`);

// The shortage flag engages within a day of the toolbox emptying.
takeFromStores(g, 'tools', 999);
let guard = 0;
const startDay = g.day;
while (g.day <= startDay + 1 && guard++ < 20000) g.update(1 / 12);
c.ok(g.toolsShort, 'an empty toolbox is noticed within a day');

// The tinker: sells when short and solvent, never below the cushion.
const t = new Game(11);
takeFromStores(t, 'tools', 999);
t.coin = 200; t.lastTinkerDay = -99;
tinkerTick(t);
c.ok(t.stockOf('tools') >= 1, 'the tinker sells tools to a solvent village', `${t.stockOf('tools')}`);
c.ok(t.coin >= 60, 'he leaves the cushion untouched', `coin ${Math.round(t.coin)}`);
const coinAfterFirst = t.coin;
tinkerTick(t);
c.ok(t.coin === coinAfterFirst, 'and does not come twice in a season');

const broke = new Game(13);
takeFromStores(broke, 'tools', 999);
broke.coin = 59; broke.lastTinkerDay = -99;
tinkerTick(broke);
c.ok(broke.stockOf('tools') < 1 && broke.coin === 59, 'a broke village keeps its last coins');

c.done();
