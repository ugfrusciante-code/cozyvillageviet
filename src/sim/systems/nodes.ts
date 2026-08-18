/**
 * Resource nodes on the map — trees, berries, game, clay, ore seams.
 *
 * Nodes are claimed before they are worked so two gatherers never chop the
 * same trunk, and a claim is a promise: whoever takes one must hand it back
 * (see `Villager.releaseAll`) or that tile is lost to the village for good.
 */

import { NODE_INDEX } from '../world';
import type { Harvest, NodeKind } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';

export function claimNode(g: Game, b: Building, kind: NodeKind, radius: number): number {
  const w = g.world;
  const cx = Math.round(b.cx), cy = Math.round(b.cy);
  const candidates = w.findNodes(cx, cy, kind, radius, 96);
  let best = -1, bestD = Infinity;
  for (const i of candidates) {
    if (g.claimedNodes.has(i)) continue;
    const nx = i % w.size, ny = (i / w.size) | 0;
    const d = (nx - cx) ** 2 + (ny - cy) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) g.claimedNodes.add(best);
  return best;
}

export function releaseNode(g: Game, i: number): void { g.claimedNodes.delete(i); }

export function consumeNode(g: Game, i: number, hv: Harvest): number {
  const w = g.world;
  if (i < 0 || w.nodeAmt[i] <= 0) return 0;
  w.nodeAmt[i] -= 1;
  if (w.nodeAmt[i] <= 0) {
    const regrowDay = hv.regrow ? g.day + hv.regrow : -1;
    w.clearNode(i, regrowDay);
    if (regrowDay >= 0) g.regrowKind.set(i, hv.kind);
  }
  g.stats.producedToday[hv.out] = (g.stats.producedToday[hv.out] ?? 0) + hv.yield;
  return hv.yield;
}

export function findPlantingSpot(g: Game, b: Building, radius: number): number {
  const w = g.world;
  const cx = Math.round(b.cx), cy = Math.round(b.cy);
  let best = -1, bestD = Infinity;
  for (let k = 0; k < 90; k++) {
    const a = g.rand() * Math.PI * 2;
    const r = Math.sqrt(g.rand()) * radius;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (w.water[i] || w.occupied[i] >= 0 || w.road[i] || w.node[i] !== 0) continue;
    if (g.claimedNodes.has(i)) continue;
    // Keep a little breathing room between trunks.
    let neighbours = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (w.inBounds(x + dx, y + dy) && w.node[w.idx(x + dx, y + dy)] === NODE_INDEX['tree']) neighbours++;
      }
    }
    if (neighbours >= 4) continue;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) g.claimedNodes.add(best);
  return best;
}

export function plantTree(g: Game, i: number): void {
  if (i < 0) return;
  g.world.setNode(i, 'tree', 1);
  g.claimedNodes.delete(i);
  g.newTrees.push(i);
}

export function regrowNodes(g: Game): void {
  const w = g.world;
  for (let i = 0; i < w.regrowAt.length; i++) {
    if (w.regrowAt[i] >= 0 && g.day >= w.regrowAt[i]) {
      const kind = g.regrowKind.get(i) ?? 'berry';
      const amt = kind === 'clay' ? 10 : kind === 'fish' ? 8 : 3;
      w.setNode(i, kind, amt);
      g.regrowKind.delete(i);
      if (kind === 'tree') g.newTrees.push(i);
    }
  }
}
