/**
 * Herds: animals as an aggregate, not a crowd of entities.
 *
 * A pasture holds a number, a breeding clock and a hunger ledger. Grass feeds
 * the herd most of the year; winter and autumn eat the fodder the shepherds
 * laid in; a fed herd under capacity breeds; a herd at capacity turns its
 * surplus into meat and hides; a hungry herd loses animals. The paddock's
 * area is the whole tuning dial — drag it bigger, feed more heads.
 *
 * Manure is the loop-closer: a stocked pasture slowly enriches the soil
 * beneath and beside it, so parking the sheep next to the wheat is a real
 * placement decision. It writes to `fertilityBase` — the value the daily
 * drift pulls toward — because writing to `fertility` itself would be
 * silently undone by that same drift the next morning.
 */

import type { ResId } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';

/** Heads this paddock can feed off its own grass. */
export function herdCapacity(b: Building): number {
  const h = b.def.husbandry;
  return h ? Math.max(2, Math.floor(b.area / h.tilesPerHead)) : 0;
}

/**
 * True only when the grass is actually under snow. The first cut of this
 * included autumn and starved every flock whose village had no grain economy
 * yet — a founding pair dying because nobody grows wheat is not pressure,
 * it is a trap. Winter alone is pressure: one season to provision for.
 */
export function fodderSeason(g: Game): boolean {
  return g.season === 'winter';
}

export function herdTick(g: Game): void {
  for (const b of g.buildings.values()) {
    const h = b.def.husbandry;
    if (!h || b.state !== 'active') continue;
    const cap = herdCapacity(b);

    // The founding pair walks up with the first completed fence — once. A
    // paddock that starved its flock out stays a monument until demolished.
    if (!b.herdFounded) {
      b.herdFounded = true;
      b.herd = 2;
      g.log(`Two ${h.animal} arrive at the new ${b.name.toLowerCase()}.`, 'good');
    }
    if (b.herd <= 0) continue;

    // Eat. Grass in the green months; the fodder shelf when it dies back.
    let fed = true;
    if (fodderSeason(g)) {
      let need = b.herd * h.fodder.perHeadDay;
      for (const kind of h.fodder.kinds) {
        if (need <= 0.01) break;
        need -= b.take(kind, Math.min(need, b.available(kind)));
      }
      fed = need <= 0.01;
    }

    if (fed) {
      b.herdHunger = 0;
      // Breeding wants headroom and a fed flock: a founding pair grows into
      // a six-head paddock in about two years, and a big flock lambs faster.
      // The first tuning used 0.028 and took six years — technically alive,
      // observably dead.
      if (b.herd < cap) {
        b.breedProgress += 0.08 * Math.min(b.herd / 2, 4);
        if (b.breedProgress >= 1) {
          b.breedProgress = 0;
          b.herd++;
        }
      } else {
        // At capacity the flock still breeds — and the surplus becomes the
        // larder. This is the meat trickle, not a button.
        b.breedProgress += 0.08 * Math.min(b.herd / 2, 4);
        if (b.breedProgress >= 1) {
          b.breedProgress = 0;
          for (const k in h.slaughter) b.add(k as ResId, h.slaughter[k as ResId] ?? 0);
          g.stats.producedToday.meat = (g.stats.producedToday.meat ?? 0) + (h.slaughter.meat ?? 0);
        }
      }
    } else {
      b.herdHunger++;
      b.breedProgress = Math.max(0, b.breedProgress - 0.1);
      if (b.herdHunger >= 4) {
        b.herdHunger = 0;
        b.herd--;
        g.log(`A ${h.animal.replace(/s$/, '')} starved at the ${b.name.toLowerCase()} — the fodder shelf is bare.`, 'bad');
        if (b.herd <= 0) {
          g.log(`The ${b.name.toLowerCase()} stands empty. The whole flock is gone.`, 'bad');
        }
      }
    }

    // Manure: the fuller the paddock, the richer the ground under and around
    // it. Base, not fertility — drift undoes anything else by morning.
    const w = g.world;
    const enrich = 0.0012 * (b.herd / Math.max(1, cap));
    for (let y = b.y - 1; y <= b.y + b.h; y++) {
      for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (w.water[i]) continue;
        w.fertilityBase[i] = Math.min(0.92, w.fertilityBase[i] + enrich);
      }
    }
  }
}

/** How many days the laid-in fodder would last this herd. For UI and priorities. */
export function fodderDays(b: Building): number {
  const h = b.def.husbandry;
  if (!h || b.herd <= 0) return Infinity;
  let stock = 0;
  for (const kind of h.fodder.kinds) stock += b.amount(kind);
  return stock / (b.herd * h.fodder.perHeadDay);
}
