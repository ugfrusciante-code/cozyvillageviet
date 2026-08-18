/**
 * A headless player.
 *
 * Both `headless.ts` (economy inspection) and `determinism.ts` (the refactor
 * safety rope) need to drive a village the same way; if they drifted apart the
 * golden hashes would stop describing the run anyone actually looks at. So the
 * build order and its pacing live here, once.
 */

import { Game } from '../src/sim/game';
import { BUILDING_BY_ID } from '../src/sim/defs';
import { RNG } from '../src/sim/world';

/**
 * A build order a competent player might follow. Each entry only goes down
 * once the village can support it, and only two sites run at a time — which is
 * how a real player paces construction.
 */
export const QUEUE: { id: string; minPop?: number }[] = [
  { id: 'woodcutter' }, { id: 'forager' }, { id: 'woodshed' },
  { id: 'cottage' }, { id: 'sawpit' }, { id: 'cottage' },
  { id: 'granary', minPop: 9 }, { id: 'forester', minPop: 9 },
  { id: 'hunter', minPop: 10 }, { id: 'cottage', minPop: 10 },
  { id: 'quarry', minPop: 11 }, { id: 'chapel', minPop: 11 },
  { id: 'cottage', minPop: 12 }, { id: 'field', minPop: 13 },
  { id: 'pasture', minPop: 14 }, { id: 'cottage', minPop: 15 },
  { id: 'weaver', minPop: 16 }, { id: 'tailor', minPop: 17 },
  { id: 'mill', minPop: 18 }, { id: 'bakery', minPop: 19 },
  { id: 'cottage', minPop: 20 }, { id: 'townhall', minPop: 21 },
  { id: 'well', minPop: 22 }, { id: 'claypit', minPop: 24 },
  { id: 'kiln', minPop: 25 }, { id: 'cottage', minPop: 26 },
  { id: 'herbalist', minPop: 27 }, { id: 'brewery', minPop: 28 },
  { id: 'tavern', minPop: 30 }, { id: 'garden', minPop: 30 },
  { id: 'tannery', minPop: 32 }, { id: 'cobbler', minPop: 33 },
  { id: 'cottage', minPop: 34 }, { id: 'storehouse', minPop: 35 },
  { id: 'blacksmith', minPop: 36 }, { id: 'tradepost', minPop: 38 },
  { id: 'apiary', minPop: 39 }, { id: 'chandler', minPop: 40 },
  { id: 'school', minPop: 42 }, { id: 'apothecary', minPop: 44 },
  { id: 'healer', minPop: 46 }, { id: 'pottery', minPop: 48 },
  { id: 'church', minPop: 50 }, { id: 'fountain', minPop: 52 },
];

export interface DriverOpts {
  /** Called once per in-game day, just after noon. */
  onDay?: (g: Game) => void;
  /** Called when a queued building could not be placed anywhere. */
  onSkip?: (g: Game, defId: string) => void;
  /** Simulated seconds per tick. 1/12 keeps a day at a few hundred steps. */
  step?: number;
}

/** Play `days` days of a village from `seed`, following QUEUE. */
export function runVillage(seed: number, days: number, opts: DriverOpts = {}): Game {
  const g = new Game(seed);
  g.speed = 1;
  const prng = new RNG(seed ^ 0x5f3a);
  const step = opts.step ?? 1 / 12;

  /** Try to place `defId` somewhere near the settlement centre. */
  const plop = (defId: string): boolean => {
    const def = BUILDING_BY_ID[defId];
    for (let r = 1; r < 26; r++) {
      for (let k = 0; k < 26; k++) {
        const a = prng.next() * Math.PI * 2;
        const x = Math.round(g.startX + Math.cos(a) * r);
        const y = Math.round(g.startY + Math.sin(a) * r);
        if (g.canPlace(defId, x, y).ok) {
          const b = g.place(defId, x, y);
          if (b) { b.jobSlots = def.jobs; return true; }
        }
      }
    }
    return false;
  };

  let qi = 0;
  let lastReport = -1;
  let lastCheck = -1;
  let guard = 0;

  while (g.day < days && guard++ < 40_000_000) {
    g.update(step);

    // Re-evaluate the build order a few times a day.
    const slot = Math.floor(g.totalHours / 6);
    if (slot !== lastCheck) {
      lastCheck = slot;
      const openSites = [...g.buildings.values()].filter((b) => b.state !== 'active').length;
      if (openSites < 2 && qi < QUEUE.length) {
        const next = QUEUE[qi];
        if (g.population >= (next.minPop ?? 0)) {
          if (plop(next.id)) qi++;
          else if (g.canPlace(next.id, g.startX, g.startY).reason?.includes('Requires')) { /* wait */ }
          else { opts.onSkip?.(g, next.id); qi++; }
        }
      }
    }

    if (g.day !== lastReport && g.hour > 12) {
      lastReport = g.day;
      opts.onDay?.(g);
    }
  }
  return g;
}
