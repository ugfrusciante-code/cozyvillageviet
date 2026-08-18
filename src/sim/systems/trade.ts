/**
 * Trade with the world outside the valley.
 *
 * Prices move against you as you use them: dumping fifty cloth on the market
 * drops the price of cloth, and it recovers only slowly. That is the whole
 * economic pressure here — there is no way to farm one good forever.
 */

import { ALL_RES, RESOURCES, TUNING, type ResId } from '../defs';
import type { Game } from '../game';
import { stockOf, takeFromStores } from './inventory';
import { hasBuilding } from './placement';

export function priceOf(g: Game, res: ResId): number {
  return RESOURCES[res].price * (g.trade.mod[res] ?? 1);
}

export function sellPrice(g: Game, res: ResId): number { return priceOf(g, res) * (1 - TUNING.tradeSpread); }

export function buyPrice(g: Game, res: ResId): number { return priceOf(g, res) * (1 + TUNING.tradeSpread); }

export function canTrade(g: Game): boolean { return hasBuilding(g, 'tradepost'); }

export function sell(g: Game, res: ResId, amt: number): { ok: boolean; msg: string } {
  if (!canTrade(g)) return { ok: false, msg: 'You need a Trading Post.' };
  const have = stockOf(g, res);
  const qty = Math.min(amt, have);
  if (qty < 1) return { ok: false, msg: `No ${RESOURCES[res].name} in store.` };
  const unit = sellPrice(g, res);
  takeFromStores(g, res, qty);
  const income = unit * qty;
  g.coin += income;
  g.stats.lastTradeIncome += income;
  g.trade.mod[res] = Math.max(0.45, (g.trade.mod[res] ?? 1) - qty * TUNING.priceElasticity);
  g.trade.soldToday[res] = (g.trade.soldToday[res] ?? 0) + qty;
  return { ok: true, msg: `Sold ${Math.round(qty)} ${RESOURCES[res].name} for ${Math.round(income)}c.` };
}

export function buy(g: Game, res: ResId, amt: number): { ok: boolean; msg: string } {
  if (!canTrade(g)) return { ok: false, msg: 'You need a Trading Post.' };
  const post = [...g.buildings.values()].find((b) => b.defId === 'tradepost' && b.state === 'active');
  if (!post) return { ok: false, msg: 'No Trading Post.' };
  const unit = buyPrice(g, res);
  const affordable = Math.floor(g.coin / unit);
  const room = post.freeSpace(res);
  const qty = Math.min(amt, affordable, room);
  if (qty < 1) {
    if (affordable < 1) return { ok: false, msg: 'Not enough coin.' };
    return { ok: false, msg: 'The Trading Post is full.' };
  }
  g.coin -= unit * qty;
  post.add(res, qty);
  g.trade.mod[res] = Math.min(2.2, (g.trade.mod[res] ?? 1) + qty * TUNING.priceElasticity);
  g.trade.boughtToday[res] = (g.trade.boughtToday[res] ?? 0) + qty;
  return { ok: true, msg: `Bought ${Math.round(qty)} ${RESOURCES[res].name} for ${Math.round(unit * qty)}c.` };
}

export function decayTradePrices(g: Game): void {
  for (const res of ALL_RES) {
    const m = g.trade.mod[res] ?? 1;
    if (Math.abs(m - 1) < 0.001) { delete g.trade.mod[res]; continue; }
    g.trade.mod[res] = m + (1 - m) * TUNING.priceRecovery * 4;
  }
  g.trade.soldToday = {};
  g.trade.boughtToday = {};
}

/** Standing sell-above / buy-below orders, settled once a day. */
export function runTradeOrders(g: Game): void {
  if (!canTrade(g)) return;
  for (const k in g.tradeRules) {
    const res = k as ResId;
    const rule = g.tradeRules[res];
    if (!rule) continue;
    const stock = stockOf(g, res);
    if (rule.sellAbove != null && stock > rule.sellAbove + 1) {
      const qty = Math.min(stock - rule.sellAbove, 40);
      const r = sell(g, res, qty);
      if (r.ok) g.log(`Standing order: ${r.msg}`, 'info');
    } else if (rule.buyBelow != null && stock < rule.buyBelow - 1 && g.coin > 60) {
      const qty = Math.min(rule.buyBelow - stock, 20);
      const r = buy(g, res, qty);
      if (r.ok) g.log(`Standing order: ${r.msg}`, 'info');
    }
  }
}
