/**
 * The farming year.
 *
 * Season boundaries reset the field state machine; the daily grind of sowing,
 * tending and reaping is villager labour (`Villager.cropLoop`). Soil is the
 * memory between years: a harvest tires it, legumes feed it, and rest brings
 * it slowly back toward the fertility the valley was born with.
 */

import { TUNING } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';

/**
 * The farming year. Season boundaries reset the field state machine; the
 * daily grind of sowing, tending and reaping is villager labour (cropLoop).
 */
export function cropCycle(g: Game): void {
  const firstDayOf = g.dayOfSeason === 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.def.crop) continue;

    if (g.season === 'summer' && b.sown) {
      // Sun and rain do a little of the tending on their own.
      b.growth = Math.min(1, b.growth + TUNING.passiveGrowth);
    }

    if (!firstDayOf) continue;
    switch (g.season) {
      case 'spring':
        b.sown = false; b.sowProgress = 0; b.growth = 0;
        b.cropPool = 0; b.cropPoolInit = 0; b.workAccum = 0;
        b.sownCrop = null;
        break;
      case 'autumn': {
        // Whatever stands in the field when autumn opens is the harvest.
        const variety = b.standingCrop;
        const pool = b.growth * variety.yieldPerTile * b.area
          * (0.35 + b.fertility * 0.9) * b.rotationFactor;
        b.cropPool = pool;
        b.cropPoolInit = Math.max(0.01, pool);
        // A real harvest tires the soil — unless it was a legume, which feeds it.
        if (b.growth > 0.15) {
          drainSoil(g, b, TUNING.fertilityPerHarvest * b.growth * variety.soilDrain);
        }
        break;
      }
      case 'winter': {
        if (b.cropPool > 1 && b.cropPoolInit > 1) {
          g.log('Part of a harvest froze in the field — it was not reaped in time.', 'bad');
        }
        b.cropPool = 0; b.growth = 0; b.sown = false;
        break;
      }
    }
  }
}

/** Positive `amount` tires the ground; negative enriches it (legumes). */
export function drainSoil(g: Game, b: Building, amount: number): void {
  const w = g.world;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      // Enriching can push past the natural baseline, but only so far.
      const ceiling = Math.min(1, w.fertilityBase[i] + 0.25);
      w.fertility[i] = Math.max(0.05, Math.min(ceiling, w.fertility[i] - amount));
    }
  }
  b.fertility = w.avgFertility(b.x, b.y, b.w, b.h);
}

/** Rested ground slowly recovers toward the fertility it was born with. */
export function soilDrift(g: Game): void {
  const w = g.world;
  for (let i = 0; i < w.fertility.length; i++) {
    if (w.occupied[i] >= 0) continue;
    const base = w.fertilityBase[i];
    if (w.fertility[i] < base) {
      w.fertility[i] = Math.min(base, w.fertility[i] + TUNING.fertilityRegen);
    }
  }
}
