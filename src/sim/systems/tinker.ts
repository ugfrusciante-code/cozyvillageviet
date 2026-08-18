/**
 * The wandering tinker: the safety valve on tool wear.
 *
 * Tools wear out a little with every batch (see villager.ts), and a village
 * that never builds the mine–smelter–blacksmith chain will eventually run
 * dry. That is meant to be pressure, not a terminal state — the original
 * iron soft-lock taught that a bad build order must never be a dead end. So
 * every so often a tinker's cart comes through and sells a few tools at his
 * prices, if the village is short and can pay.
 *
 * He is deliberately a worse deal than making your own: a fifth over the
 * reference price, four tools at most, never more than once a season, and he
 * will not take a village's last sixty coins. The blacksmith is the answer;
 * the tinker is the apology.
 */

import { RESOURCES, TUNING } from '../defs';
import type { Game } from '../game';
import { stockOf, addToStores } from './inventory';

export function tinkerTick(g: Game): void {
  if (g.day - g.lastTinkerDay < TUNING.daysPerSeason) return;
  if (stockOf(g, 'tools') >= 1) return;
  const price = RESOURCES.tools.price * 1.2;
  // He will not take a village's last coins: only what it can spare above a
  // small cushion.
  const affordable = Math.floor(Math.max(0, g.coin - 60) / price);
  const qty = Math.min(4, affordable);
  if (qty < 1) return;
  g.lastTinkerDay = g.day;
  g.coin -= qty * price;
  addToStores(g, 'tools', qty);
  g.log(`A wandering tinker sold the village ${qty} tools for ${Math.round(qty * price)}c.`, 'info');
}
