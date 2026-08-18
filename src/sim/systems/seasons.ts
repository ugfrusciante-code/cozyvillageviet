/**
 * The turn of the season: the workforce is reshuffled as crops and forage go
 * in and out of season, and tax and upkeep settle. Four of these make a year.
 */

import type { Season } from '../defs';
import type { Game } from '../game';
import { BAND, autoPriority } from './labour';
import { hasBuilding } from './placement';

export function seasonTick(g: Game, prev: Season): void {
  // The turn of the season reshuffles the workforce: out-of-season crews
  // (winter foragers, dormant orchards) stand down so their hands are free
  // for the mill, the woodshed and the building sites.
  if (g.autoAssign) {
    for (const b of g.buildings.values()) {
      if (b.state !== 'active' || !b.workers.length) continue;
      // Anything that has fallen into the IDLE band is out of season now.
      if (autoPriority(g, b) < BAND.LOW) {
        for (const id of b.workers) {
          const v = g.villagers.get(id);
          if (v) { v.jobId = -1; v.releaseAll(g); }
        }
        b.workers = [];
      }
    }
    g.reassignPending = true;
  }
  // Tax and upkeep settle at the turn of each season.
  let tax = 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active') continue;
    if (b.isHouse) tax += b.tierDef().tax * Math.max(1, b.families) * (0.6 + b.contentment * 0.6);
  }
  const hasHall = hasBuilding(g, 'townhall');
  tax = hasHall ? tax : tax * 0.25;
  let upkeep = 0;
  for (const b of g.buildings.values()) {
    if (b.state === 'active' && b.def.upkeep) upkeep += b.def.upkeep;
  }
  g.coin += tax - upkeep;
  g.stats.lastTax = tax;
  g.stats.lastUpkeep = upkeep;

  g.log(
    `${g.season[0].toUpperCase() + g.season.slice(1)} of year ${g.year}. ` +
    `Tax ${Math.round(tax)}c, upkeep ${Math.round(upkeep)}c.`,
    tax >= upkeep ? 'info' : 'bad',
  );

  if (g.season === 'winter') {
    g.log('Winter closes in. Firewood burns four times faster now.', 'bad');
  }
  if (g.season === 'spring') {
    g.log('The thaw arrives. Fields can be sown again.', 'good');
  }

  if (g.coin < 0) {
    g.log('The treasury is empty. Upkeep is eating the village alive.', 'bad');
  }

  // Spoilage is per-building and daily now (systems/spoilage.ts) — a granary
  // protects what is actually on its shelves, not every larder in the valley.
  void prev;
}
