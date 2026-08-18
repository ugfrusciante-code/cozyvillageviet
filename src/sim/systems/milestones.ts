/**
 * Milestones: the sandbox's light goal layer.
 *
 * Not scenarios, not a campaign — a short list of derived-stat achievements
 * surfaced in the ledger, because an endless sandbox still wants somewhere to
 * look when asking "what next?". Every check reads state the sim already
 * tracks; nothing here adds mechanics, and a completed milestone awards
 * nothing but the day it happened and a line in the chronicle. The reward is
 * the village.
 *
 * Checks run once a day. Progress is a plain fraction so the ledger can show
 * a bar without knowing what it measures.
 */

import { FOOD_TYPES, TUNING } from '../defs';
import type { Game } from '../game';
import { stockOf } from './inventory';
import { foodDaysLeft } from './labour';

export interface MilestoneDef {
  id: string;
  name: string;
  desc: string;
  /** Current progress toward the goal, as value / target. */
  progress: (g: Game) => { value: number; target: number };
}

/** Lifetime output of every building of one kind — `produced` never resets. */
function madeBy(g: Game, defId: string): number {
  let t = 0;
  for (const b of g.buildings.values()) if (b.defId === defId) t += b.produced;
  return t;
}

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'first-winter', name: 'The First Winter',
    desc: 'Reach the second spring with anyone left to see it.',
    progress: (g) => ({ value: Math.min(g.day, 16), target: 16 }),
  },
  {
    id: 'twenty-souls', name: 'Twenty Souls',
    desc: 'House and feed twenty villagers at once.',
    progress: (g) => ({ value: g.population, target: 20 }),
  },
  {
    id: 'roof-for-everyone', name: 'A Roof for Everyone',
    desc: 'A dozen villagers, and not one of them sleeping outside.',
    progress: (g) => ({ value: g.homeless === 0 ? Math.min(g.population, 12) : 0, target: 12 }),
  },
  {
    id: 'full-larder', name: 'The Full Larder',
    desc: 'A month of food in store for a village of twelve or more.',
    progress: (g) => ({
      value: g.population >= 12 ? Math.min(foodDaysLeft(g), 30) : 0, target: 30,
    }),
  },
  {
    id: 'daily-bread', name: 'Our Daily Bread',
    desc: 'Bake three hundred loaves over the life of the village.',
    progress: (g) => ({ value: Math.min(madeBy(g, 'bakery'), 300), target: 300 }),
  },
  {
    id: 'clothed', name: 'Cloth of Our Own',
    desc: 'Tailor a hundred sets of clothes from your own wool.',
    progress: (g) => ({ value: Math.min(madeBy(g, 'tailor'), 100), target: 100 }),
  },
  {
    id: 'five-winters', name: 'Five Winters',
    desc: 'Endure five whole years in the valley.',
    progress: (g) => ({ value: Math.min(g.day, 80), target: 80 }),
  },
  {
    id: 'three-children', name: 'A House Full of Laughter',
    desc: 'One family raises three children under one roof.',
    progress: (g) => {
      let best = 0;
      for (const f of g.families.values()) best = Math.max(best, f.childrenBorn);
      return { value: Math.min(best, 3), target: 3 };
    },
  },
  {
    id: 'burgage-row', name: 'Burgage Row',
    desc: 'Three homes grown to the third tier.',
    progress: (g) => {
      let n = 0;
      for (const b of g.buildings.values()) if (b.isHouse && b.state === 'active' && b.tier >= 3) n++;
      return { value: Math.min(n, 3), target: 3 };
    },
  },
  {
    id: 'stone-church', name: 'A Spire Above the Trees',
    desc: 'Raise a stone church.',
    progress: (g) => ({ value: g.hasBuilding('church') ? 1 : 0, target: 1 }),
  },
  {
    id: 'cobbled', name: 'The Long Road',
    desc: 'Lay a hundred tiles of road.',
    progress: (g) => {
      let n = 0;
      const road = g.world.road;
      for (let i = 0; i < road.length; i++) if (road[i]) n++;
      return { value: Math.min(n, 100), target: 100 };
    },
  },
  {
    id: 'master-of-coin', name: 'Master of Coin',
    desc: 'A treasury of one thousand coins.',
    progress: (g) => ({ value: Math.min(g.coin, 1000), target: 1000 }),
  },
  {
    id: 'well-fed-and-happy', name: 'The Good Years',
    desc: 'Twenty villagers, none hungry, and two in three content.',
    progress: (g) => {
      const food = FOOD_TYPES.reduce((s, f) => s + stockOf(g, f), 0);
      const fed = food > g.population * TUNING.foodPerDay * 5;
      const ok = g.population >= 20 && fed && g.averageContentment >= 0.66;
      return { value: ok ? 1 : 0, target: 1 };
    },
  },
];

/** Once a day: mark anything newly complete and put it in the chronicle. */
export function checkMilestones(g: Game): void {
  for (const m of MILESTONES) {
    if (g.milestonesDone[m.id] !== undefined) continue;
    const { value, target } = m.progress(g);
    if (value >= target) {
      g.milestonesDone[m.id] = g.day;
      g.log(`Milestone: ${m.name} — ${m.desc}`, 'good');
    }
  }
}
