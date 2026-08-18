/**
 * The watch: defence as a job, not a purchase.
 *
 * A watchtower does nothing by itself — a villager has to stand in it, and
 * that villager is a pair of hands taken from the fields. This is the spec's
 * one cross-system contract for warfare, taken at cozy scale: army
 * generation consumes civilian labour. Here the army is one cold watchman,
 * and the raid he deters is the wage.
 */

import type { Game } from '../game';

/** How many manned towers overlook this spot. */
export function mannedWatchesOver(g: Game, x: number, y: number): number {
  let n = 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.def.watch || b.workers.length === 0) continue;
    if (Math.hypot(b.cx - x, b.cy - y) <= b.def.watch.radius) n++;
  }
  return n;
}
