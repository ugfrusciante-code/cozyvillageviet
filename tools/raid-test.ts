/**
 * Raids: warned before they land, they steal only unpromised goods, the
 * village grieves and recovers, and poverty is the best palisade.
 */
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { RESOURCES, TUNING, type ResId } from '../src/sim/defs';
import { Checks, auditReservations } from './assert';

const c = new Checks('raids');

// --- A prosperous village gets raided, properly.
const g = new Game(7);
const store = [...g.buildings.values()].find((b) => b.isStorage)!;
store.add('tools', 40); store.add('clothes', 40); // ~2000 coin of loot on the shelf
g.day = TUNING.raidGraceDays; g.lastDay = g.day; g.t = (g.day * TUNING.hoursPerDay + 7) * TUNING.secondsPerHour;

let warnedOn = -1, landedOn = -1, peakRaiders = 0;
let ledgerCleanDuring = true;
let guard = 0;
while (landedOn < 0 && guard++ < 400000) {
  g.update(1 / 12);
  if (warnedOn < 0 && g.raidAtDay >= 0) warnedOn = g.day;
  if (g.raiders.length > 0) { landedOn = g.day; }
}
c.ok(warnedOn >= 0, 'threat eventually boils over for a wealthy village', `warned day ${warnedOn}`);
c.ok(landedOn >= 0, 'the raid actually arrives', `landed day ${landedOn}`);
c.ok(landedOn - warnedOn >= 2, 'at least two days of warning', `${landedOn - warnedOn} days`);

const stockBefore = new Map<string, number>();
for (const b of g.buildings.values()) for (const k in b.store) stockBefore.set(`${b.id}:${k}`, (b.store as Record<string, number>)[k] ?? 0);

guard = 0;
while (g.raiders.length > 0 && guard++ < 400000) {
  g.update(1 / 12);
  peakRaiders = Math.max(peakRaiders, g.raiders.length);
  if (guard % 50 === 0 && auditReservations(g).length > 0) ledgerCleanDuring = false;
}
c.ok(g.raiders.length === 0, 'the band leaves', `peak ${peakRaiders} raiders`);
c.ok(ledgerCleanDuring, 'the hauling ledger stays balanced all through the raid');
c.ok(g.raidAtDay === -1 && g.raidThreat === 0, 'the threat resets after the raid');

let stolen = 0;
for (const b of g.buildings.values()) {
  for (const k in b.store) {
    const before = stockBefore.get(`${b.id}:${k}`) ?? 0;
    const now = (b.store as Record<string, number>)[k] ?? 0;
    if (now < before) stolen += (before - now) * RESOURCES[k as ResId].price;
  }
}
c.ok(stolen > 0, 'they did not come for nothing', `~${Math.round(stolen)} coin of goods`);
const mourning = [...g.buildings.values()].some((b) =>
  b.isHouse && b.moodEvents.some((e) => e.label === 'Raiders came through'));
c.ok(mourning, 'every household felt it');
c.ok(g.events.some((e) => e.text.startsWith('The raiders are gone')), 'the chronicle closes the raid');

// --- A save mid-warning keeps the schedule.
const g2 = new Game(11);
g2.raidThreat = TUNING.raidThreshold + 5;
g2.raidAtDay = 99;
const g3 = deserialize(JSON.parse(JSON.stringify(serialize(g2))));
c.ok(g3.raidAtDay === 99 && g3.raidThreat === g2.raidThreat, 'the raid schedule survives a save');

// --- Poverty is the best palisade: a fresh village accrues threat slowly.
const poor = new Game(4242);
poor.day = TUNING.raidGraceDays; poor.lastDay = poor.day;
poor.t = (poor.day * TUNING.hoursPerDay + 7) * TUNING.secondsPerHour;
for (let d = 0; d < 20 && poor.raidAtDay < 0; d++) {
  poor.raidThreat += 0; // accrual happens in dayTick
  for (let i = 0; i < 1200 && poor.day < TUNING.raidGraceDays + d + 1; i++) poor.update(1 / 12);
}
c.ok(poor.raidAtDay < 0 || poor.raidAtDay - TUNING.raidGraceDays > 10,
  'a modest village is left alone for a long while', `threat ${poor.raidThreat.toFixed(1)} after 20 days`);

c.done();
