/**
 * What a household consumes each day, and what that buys it.
 *
 * Homes shop at the market; the goods they find there become food days, fuel
 * days, variety and comfort, and those roll up into one contentment figure
 * that drives births, emigration, work rate and tax. Rationing from a
 * storehouse fills bellies but earns no credit — a village that survives on
 * raided reserves never climbs the housing tiers, which is the point.
 */

import {
  CLOTHING_TYPES, FOOD_TYPES, HOUSE_TIERS, LUXURY_TYPES, SERVICE_KINDS, TUNING,
  type ResId,
} from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';
import { familyOf } from './families';
import { charmAt, marketsNear, serviceLevel } from './services';

/** The core needs loop: markets feed homes, homes become content or don't. */
export function householdNeeds(g: Game): void {
  const fuelFactor = TUNING.fuelSeason[g.season];

  for (const home of g.buildings.values()) {
    if (home.state !== 'active' || !home.isHouse) continue;
    const people = home.residents.length;
    if (people === 0) { home.contentment = 0.5; continue; }

    // Homes shop at the market. With no market in range they can still raid
    // a nearby storehouse, but they get no choice and no comforts.
    let markets = marketsNear(g, home.cx, home.cy);
    const fallback = markets.length === 0;
    if (fallback) {
      markets = [...g.buildings.values()]
        .filter((b) => b.state === 'active' && b.isStorage && Math.hypot(b.cx - home.cx, b.cy - home.cy) <= 22)
        .sort((a, b) => Math.hypot(a.cx - home.cx, a.cy - home.cy) - Math.hypot(b.cx - home.cx, b.cy - home.cy));
    }
    // Last resort: if the stall is bare, a household will walk to the nearest
    // storehouse and ration. A village must never starve beside a full
    // granary just because no one is minding the stall.
    const reserves = fallback ? [] : [...g.buildings.values()]
      .filter((b) => b.state === 'active' && b.isStorage && Math.hypot(b.cx - home.cx, b.cy - home.cy) <= 26)
      .sort((a, b) => Math.hypot(a.cx - home.cx, a.cy - home.cy) - Math.hypot(b.cx - home.cx, b.cy - home.cy));

    const s = home.supply;
    s.foodTypes.clear(); s.clothingTypes.clear(); s.luxuryTypes.clear();

    // --- Food: draw a day's worth, preferring variety.
    let foodNeed = people * TUNING.foodPerDay;
    const foodOrder = [...FOOD_TYPES].sort((a, b) => marketStock(g, markets, b) - marketStock(g, markets, a));
    // First pass: one portion of each available type, for variety.
    for (const f of foodOrder) {
      if (foodNeed <= 0.01) break;
      const got = drawFromMarkets(g, markets, f, Math.min(foodNeed, people * 0.34));
      if (got > 0.01) { s.foodTypes.add(f); foodNeed -= got; countConsumed(g, f, got); }
    }
    // Second pass: fill the rest with whatever there is.
    for (const f of foodOrder) {
      if (foodNeed <= 0.01) break;
      const got = drawFromMarkets(g, markets, f, foodNeed);
      if (got > 0.01) { s.foodTypes.add(f); foodNeed -= got; countConsumed(g, f, got); }
    }
    // Third pass: rationing. Fills bellies but earns no variety credit, so a
    // rationing village never climbs the housing tiers.
    let rationed = false;
    for (const f of foodOrder) {
      if (foodNeed <= 0.01) break;
      const got = drawFromMarkets(g, reserves, f, foodNeed);
      if (got > 0.01) { foodNeed -= got; rationed = true; countConsumed(g, f, got); }
    }
    if (rationed) home.rationing = true; else home.rationing = false;
    const foodMet = 1 - foodNeed / Math.max(0.001, people * TUNING.foodPerDay);
    s.foodDays = foodMet;

    // --- Fuel
    const households = Math.max(1, home.families);
    const fuelNeed = households * TUNING.fuelPerDay * fuelFactor;
    let fuelGot = drawFromMarkets(g, markets, 'firewood', fuelNeed);
    if (fuelGot < fuelNeed - 0.01) fuelGot += drawFromMarkets(g, reserves, 'firewood', fuelNeed - fuelGot);
    countConsumed(g, 'firewood', fuelGot);
    s.fuelDays = fuelNeed <= 0.001 ? 1 : fuelGot / fuelNeed;

    // --- Clothing (slow wear, so this is mostly about having any at all)
    const clothNeed = households * TUNING.clothingPerDay;
    let clothGot = 0;
    for (const c of CLOTHING_TYPES) {
      const got = drawFromMarkets(g, markets, c, clothNeed);
      if (got > 0.0001) { s.clothingTypes.add(c); clothGot += got; countConsumed(g, c, got); }
      else if (marketStock(g, markets, c) > 0.5) s.clothingTypes.add(c);
    }
    s.clothing = Math.min(1, clothGot / Math.max(0.0001, clothNeed));
    // A market that stocks a clothing type counts as supplying it even in a
    // week where nothing wore out.
    for (const c of CLOTHING_TYPES) if (marketStock(g, markets, c) > 0.5) s.clothingTypes.add(c);

    // --- Comforts
    const luxNeed = households * TUNING.luxuryPerDay;
    let luxGot = 0;
    for (const l of LUXURY_TYPES) {
      if (marketStock(g, markets, l) > 0.5) s.luxuryTypes.add(l);
      const got = drawFromMarkets(g, markets, l, luxNeed);
      if (got > 0.0001) { luxGot += got; countConsumed(g, l, got); }
    }
    s.luxury = Math.min(1, luxGot / Math.max(0.0001, luxNeed));

    // --- Services and beauty
    home.services = {};
    for (const k of SERVICE_KINDS) {
      const lvl = serviceLevel(g, k, home.cx, home.cy).level;
      if (lvl > 0) home.services[k] = lvl;
    }
    home.localCharm = charmAt(g, home.cx, home.cy);

    // Raiding a storehouse feeds a family but never impresses it: no variety
    // credit, and comforts do not count as delivered.
    if (fallback) {
      const keep = [...s.foodTypes][0];
      s.foodTypes.clear();
      if (keep) s.foodTypes.add(keep);
      s.clothingTypes.clear();
      s.luxuryTypes.clear();
    }

    // --- Contentment
    const variety = Math.min(1, s.foodTypes.size / 3);
    const hasWater = (home.services.water ?? 0) > 0 ? 1 : 0;
    const faith = Math.min(1, (home.services.faith ?? 0) / 2);
    const leisure = (home.services.leisure ?? 0) > 0 ? 1 : 0;
    const health = (home.services.health ?? 0) > 0 ? 1 : 0;
    const charmScore = Math.min(1, home.localCharm / 20);
    const crowding = home.def.id === 'longhouse' ? -0.1 : 0;

    const target =
      foodMet * 0.34 +
      variety * 0.08 +
      Math.min(1, s.fuelDays) * (g.season === 'winter' ? 0.20 : 0.14) +
      Math.min(1, s.clothing * 4 + (s.clothingTypes.size ? 0.6 : 0)) * 0.08 +
      hasWater * 0.09 +
      faith * 0.08 +
      leisure * 0.07 +
      health * 0.05 +
      charmScore * 0.09 +
      Math.min(1, s.luxury * 4 + (s.luxuryTypes.size ? 0.5 : 0)) * 0.06 +
      crowding;

    // Contentment moves gradually — one bad day should not empty a village.
    home.contentment += (Math.max(0, Math.min(1, target)) - home.contentment) * 0.34;
  }
}

export function countConsumed(g: Game, res: ResId, amt: number): void {
  g.stats.consumedToday[res] = (g.stats.consumedToday[res] ?? 0) + amt;
}

export function marketStock(g: Game, markets: Building[], res: ResId): number {
  let t = 0;
  for (const m of markets) t += m.amount(res);
  return t;
}

export function drawFromMarkets(g: Game, markets: Building[], res: ResId, amt: number): number {
  let left = amt;
  for (const m of markets) {
    if (left <= 0.001) break;
    left -= m.take(res, left);
  }
  return amt - left;
}

export function housingAndTiers(g: Game): void {
  for (const home of g.buildings.values()) {
    if (home.state !== 'active' || !home.isHouse) continue;
    const next = HOUSE_TIERS[home.tier]; // tier is 1-based, so this is the next rung
    home.upgradeBlockers = [];
    if (!next) { home.upgradeReady = false; continue; }
    const s = home.supply;
    const blockers: string[] = [];
    if (s.foodTypes.size < next.foodTypes) blockers.push(`${next.foodTypes} food types (has ${s.foodTypes.size})`);
    if (s.clothingTypes.size < next.clothingTypes) blockers.push(`${next.clothingTypes} clothing type${next.clothingTypes > 1 ? 's' : ''}`);
    if (s.luxuryTypes.size < next.luxuryTypes) blockers.push(`${next.luxuryTypes} comfort goods`);
    if (next.fuel && s.fuelDays < 0.5) blockers.push('firewood at the market');
    if (next.water && !(home.services.water ?? 0)) blockers.push('a well in range');
    if (next.faith > (home.services.faith ?? 0)) blockers.push(next.faith >= 2 ? 'a stone church' : 'a chapel');
    if (next.leisure && !(home.services.leisure ?? 0)) blockers.push('a tavern serving ale');
    if (home.localCharm < next.charm) blockers.push(`charm ${next.charm} (has ${home.localCharm.toFixed(0)})`);
    if (home.contentment < 0.55) blockers.push('a contented household');

    home.upgradeBlockers = blockers;
    home.upgradeReady = blockers.length === 0;
    if (home.upgradeReady) {
      home.tier = next.tier;
      const surname = familyOf(g, home)?.surname ?? 'household';
      g.log(`The ${surname} home became a ${next.name}.`, 'good');
    } else if (home.tier > 1 && (s.foodDays < 0.3 || (next.water && !(home.services.water ?? 0)))) {
      // Sustained neglect knocks a house back down a rung.
      home.downgradeStrikes = (home.downgradeStrikes ?? 0) + 1;
      if (home.downgradeStrikes > 4) {
        home.tier--; home.downgradeStrikes = 0;
        g.log('A household fell on hard times and lost its standing.', 'bad');
      }
    } else {
      home.downgradeStrikes = 0;
    }
  }
}
