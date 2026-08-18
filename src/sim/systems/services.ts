/**
 * Services and charm: the wells, chapels, taverns and markets that decide
 * whether a household is merely fed or actually settled.
 *
 * A service reaches a home by radius, and the index of who reaches where is
 * rebuilt every hour rather than kept up to date incrementally — buildings
 * appear rarely and the scan is cheap.
 */

import {
  CLOTHING_TYPES, FOOD_TYPES, LUXURY_TYPES, SERVICE_KINDS, TUNING,
  type ResId, type ServiceKind,
} from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';
import { stockOf } from './inventory';

export function refreshServices(g: Game): void {
  g.serviceIndex.clear();
  for (const k of SERVICE_KINDS) g.serviceIndex.set(k, []);
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.def.service) continue;
    g.serviceIndex.get(b.def.service.kind)!.push(b);
  }
}

/** 0 = none, or the strength of the best provider reaching this point. */
export function serviceLevel(g: Game, kind: ServiceKind, x: number, y: number): { level: number; b?: Building } {
  let level = 0, chosen: Building | undefined;
  for (const b of g.serviceIndex.get(kind) ?? []) {
    const s = b.def.service!;
    if (Math.hypot(b.cx - x, b.cy - y) > s.radius) continue;
    const consumes = s.consumes;
    if (consumes && !consumes.some((r) => b.amount(r) > 0.01)) continue;
    // A stone church counts double for the tier-3 requirement.
    const strength = b.defId === 'church' ? 2 : 1;
    if (strength > level) { level = strength; chosen = b; }
  }
  return { level, b: chosen };
}

export function charmAt(g: Game, x: number, y: number): number {
  let charm = 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.def.charm) continue;
    const r = b.def.charmRadius ?? 10;
    const d = Math.hypot(b.cx - x, b.cy - y);
    if (d > r) continue;
    charm += b.def.charm * (1 - d / r);
  }
  return charm;
}

export function marketsNear(g: Game, x: number, y: number): Building[] {
  return (g.serviceIndex.get('market') ?? [])
    .filter((m) => Math.hypot(m.cx - x, m.cy - y) <= m.def.service!.radius)
    .sort((a, b) => Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y));
}

/** What a market should be restocked with, most urgent first. */
export function marketWishlist(g: Game, m: Building): { res: ResId; amt: number }[] {
  const homes = homesServedBy(g, m);
  // Food is eaten per head; fuel, clothing and comforts are per household.
  const heads = homes.reduce((s, h) => s + h.residents.length, 0) || 1;
  const families = homes.reduce((s, h) => s + Math.max(1, h.families), 0) || 1;
  const targets: { res: ResId; amt: number }[] = [];
  const want = (res: ResId, per: number, units: number) => {
    const target = Math.max(8, per * units * 3);
    const have = m.amount(res) + (m.incoming[res] ?? 0);
    if (target - have > 3) targets.push({ res, amt: target - have });
  };
  // Food first, spread across whatever types the village actually produces.
  const foods = FOOD_TYPES.filter((f) => stockOf(g, f) > 0 || m.amount(f) > 0);
  for (const f of foods) want(f, TUNING.foodPerDay * 1.2 / Math.max(1, foods.length) * 2.2, heads);
  want('firewood', TUNING.fuelPerDay * TUNING.fuelSeason[g.season] * 1.6, families);
  for (const c of CLOTHING_TYPES) if (stockOf(g, c) > 0) want(c, TUNING.clothingPerDay * 3, families);
  for (const l of LUXURY_TYPES) if (stockOf(g, l) > 0) want(l, TUNING.luxuryPerDay * 2, families);
  return targets.sort((a, b) => b.amt - a.amt);
}

/** Markets whose shelves are thin enough that any spare hand should help. */
export function marketsShortOfGoods(g: Game): Building[] {
  const out: Building[] = [];
  for (const m of g.serviceIndex.get('market') ?? []) {
    if (m.state !== 'active') continue;
    const heads = residentsServedBy(g, m);
    if (heads === 0) continue;
    const food = FOOD_TYPES.reduce((t, f) => t + m.amount(f) + (m.incoming[f] ?? 0), 0);
    const fuel = m.amount('firewood') + (m.incoming.firewood ?? 0);
    if (food < heads * TUNING.foodPerDay * 2 || fuel < heads * TUNING.fuelPerDay) out.push(m);
  }
  return out;
}

/** Every home inside this service's radius. */
export function homesServedBy(g: Game, m: Building): Building[] {
  const r = m.def.service?.radius ?? 0;
  const out: Building[] = [];
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.isHouse) continue;
    if (Math.hypot(b.cx - m.cx, b.cy - m.cy) <= r) out.push(b);
  }
  return out;
}

/**
 * How many people it serves, rather than how many roofs.
 *
 * Both counts are wanted, which is why this used to be a second copy of the
 * scan called `homesServedBy2`. Food is eaten per head and fuel is burned per
 * household, so getting these two the wrong way round is a real bug — worth
 * one honest name each.
 */
export function residentsServedBy(g: Game, m: Building): number {
  let n = 0;
  for (const h of homesServedBy(g, m)) n += h.residents.length;
  return n;
}

/** Taverns drink their ale, healers use their medicine. */
export function consumeServiceGoods(g: Game): void {
  for (const b of g.buildings.values()) {
    if (b.state !== 'active') continue;
    const s = b.def.service;
    const consumes = s?.consumes;
    if (!s || !consumes) continue;
    const served = residentsServedBy(g, b);
    b.serving = served;
    const perHour = (s.rate ?? 0.1) * served / TUNING.hoursPerDay;
    for (const res of consumes) {
      if (b.amount(res) > 0) {
        const used = b.take(res, perHour);
        g.stats.consumedToday[res] = (g.stats.consumedToday[res] ?? 0) + used;
        break;
      }
    }
  }
}
