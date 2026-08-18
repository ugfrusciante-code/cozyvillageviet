/**
 * Food rots.
 *
 * This changes the food problem from "produce as much as possible" into
 * "produce what can be eaten or properly stored before it turns" — a granary
 * becomes a preservation building rather than a bigger box, and a mountain of
 * berries in autumn is no longer a plan for winter.
 *
 * Rules, chosen to stay cozy rather than punishing:
 *  - Each food loses `ResourceDef.spoil` of itself per day (honey never
 *    turns). A building's `preserves` scales that: 0.15 in the granary,
 *    0.5 in the storehouse, full rate on a market stall or a workshop bench.
 *  - Winter is a larder: cold halves spoilage. Summer speeds it by half.
 *  - Only unpromised stock rots. Goods a hauler has reserved are already
 *    spoken for, and rotting them would make the reservation ledger promise
 *    more than the building holds.
 *
 * This replaces the old flat "8% of everything, once a season, unless a
 * granary exists anywhere" rule, which made one granary a village-wide
 * force field and made storage placement meaningless.
 */

import { RESOURCES, type ResId } from '../defs';
import type { Game } from '../game';

/** Seasonal multiplier: cold keeps, heat turns. */
const SEASON_ROT = { spring: 1, summer: 1.5, autumn: 1, winter: 0.5 } as const;

export function spoilFood(g: Game): void {
  const seasonFactor = SEASON_ROT[g.season];
  let lostTotal = 0;
  let worstRes: ResId | null = null;
  let worstAmt = 0;

  for (const b of g.buildings.values()) {
    if (b.state !== 'active') continue;
    const keep = b.def.preserves ?? 1;
    if (keep <= 0) continue;
    for (const k in b.store) {
      const res = k as ResId;
      const rate = RESOURCES[res].spoil;
      if (!rate) continue;
      // Only what nobody has claimed may rot — never out from under a receipt.
      const exposed = b.available(res);
      if (exposed <= 0.01) continue;
      const lost = Math.min(exposed, exposed * rate * keep * seasonFactor);
      if (lost <= 0.0001) continue;
      b.take(res, lost);
      g.stats.spoiledToday[res] = (g.stats.spoiledToday[res] ?? 0) + lost;
      lostTotal += lost;
      if (lost > worstAmt) { worstAmt = lost; worstRes = res; }
    }
  }

  // One line, occasionally, when it is actually costing something — not a
  // daily nag. The alert panel handles the standing condition.
  if (lostTotal > 2.5 && worstRes && g.day - g.lastSpoilWarning >= 6) {
    g.lastSpoilWarning = g.day;
    const name = RESOURCES[worstRes].name.toLowerCase();
    g.log(
      g.hasBuilding('granary')
        ? `Food is turning faster than it is eaten — mostly ${name}. The granary is not close enough to everything.`
        : `Food is spoiling — mostly ${name}. A granary would keep it.`,
      'bad',
    );
  }
}
