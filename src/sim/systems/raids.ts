/**
 * Raiders: the price of prosperity.
 *
 * Threat is not a dice roll. It accrues daily in proportion to the village's
 * visible wealth — full stores and a heavy purse draw eyes — so a raid is a
 * cost of growth, never bad luck. Poor villages are simply not worth the
 * ride, and nothing happens at all during the first three years.
 *
 * When threat boils over, the village gets two days of warning ("riders seen
 * on the far road") to sell down, spend, or brace. Then a small band walks in
 * from the map edge, takes what it can carry from the richest store, and
 * leaves. Nobody dies and nothing burns: this economy's precious thing is
 * goods, and losing what you spent seasons optimising is the sting that
 * matters. Every home carries the shock for a few days.
 *
 * Raiders never touch promised stock — they steal from `available()`, so a
 * hauling receipt is never made a lie even mid-raid.
 *
 * In-flight raiders are not saved. Like hauls, an interrupted raid simply
 * re-forms: the schedule survives the save, the walkers do not.
 */

import { RESOURCES, TUNING, type ResId } from '../defs';
import type { Building } from '../building';
import type { Game } from '../game';
import type { PathPoint } from '../world';

export interface Raider {
  id: number;
  x: number;
  y: number;
  /** For the renderer. */
  facing: number;
  path: PathPoint[];
  pathIdx: number;
  state: 'toLoot' | 'looting' | 'leaving';
  lootTimer: number;
  carry: { res: ResId; amt: number } | null;
  targetB: number;
  /** Where they came in; they leave the same way. */
  entryX: number;
  entryY: number;
}

/** Everything a raiding party would size itself against. */
function visibleWealth(g: Game): number {
  let w = g.coin * 0.5;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !(b.isStorage || b.def.service?.kind === 'market')) continue;
    for (const k in b.store) {
      const res = k as ResId;
      w += (b.store[res] ?? 0) * RESOURCES[res].price;
    }
  }
  return w;
}

/** The store a band would head for: richest by sale value, reachable or not — reachability is checked at spawn. */
function richestStore(g: Game): Building | undefined {
  let best: Building | undefined;
  let bestV = 0;
  for (const b of g.buildings.values()) {
    if (b.state !== 'active' || !b.isStorage) continue;
    let v = 0;
    for (const k in b.store) v += (b.store[k as ResId] ?? 0) * RESOURCES[k as ResId].price;
    if (v > bestV) { bestV = v; best = b; }
  }
  return best;
}

/** Daily: let threat simmer, warn, and launch when the day comes. */
export function raidTick(g: Game): void {
  if (g.day < TUNING.raidGraceDays) return;

  if (g.raidAtDay < 0) {
    g.raidThreat += visibleWealth(g) / 800;
    if (g.raidThreat >= TUNING.raidThreshold) {
      g.raidAtDay = g.day + 2;
      g.log('Riders have been seen on the far road. They are counting our granaries.', 'bad');
    }
    return;
  }

  // A raid that was mid-flight when the game was saved re-forms here: the
  // walkers were not persisted, but the day was.
  if (g.day >= g.raidAtDay && g.raiders.length === 0) launchRaid(g);
}

function launchRaid(g: Game): void {
  const target = richestStore(g);
  if (!target) { standDown(g); return; }

  // A band walks in from the edge — somewhere that can actually reach the
  // target. The entrance tile itself is often built over or crowded in a
  // grown village, so the acceptable regions are those of its walkable
  // neighbourhood — the same tolerance the pathfinder itself applies. Judging
  // by the entrance's exact tile silently cancelled 13 raids out of 14.
  const w = g.world;
  const ex0 = Math.round(target.entrance.x), ey0 = Math.round(target.entrance.y);
  const regions = new Set<number>();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const r = w.regionAt(ex0 + dx, ey0 + dy);
      if (r >= 0) regions.add(r);
    }
  }
  const edges: number[] = [];
  for (let i = 0; i < w.size; i++) {
    for (const [x, y] of [[i, 0], [i, w.size - 1], [0, i], [w.size - 1, i]] as const) {
      if (regions.has(w.regionAt(x, y))) edges.push(w.idx(x, y));
    }
  }
  if (edges.length === 0) { standDown(g); return; }
  const entry = edges[Math.floor(g.rand() * edges.length)];
  const ex = entry % w.size, ey = (entry / w.size) | 0;

  const size = Math.min(6, 2 + Math.floor(visibleWealth(g) / 800));
  for (let i = 0; i < size; i++) {
    const raider: Raider = {
      id: g.nextRaiderId++,
      x: ex + (g.rand() - 0.5) * 2, y: ey + (g.rand() - 0.5) * 2,
      facing: 0,
      path: [], pathIdx: 0,
      state: 'toLoot', lootTimer: 0,
      carry: null, targetB: target.id,
      entryX: ex, entryY: ey,
    };
    const p = g.path.find(raider.x, raider.y, target.entrance.x, target.entrance.y, 1.2);
    if (p) { raider.path = p; g.raiders.push(raider); }
  }
  if (!g.raiders.length) { standDown(g); return; }
  g.log(`Raiders! ${g.raiders.length} of them, making for the ${target.name.toLowerCase()}.`, 'bad');
}

function standDown(g: Game): void {
  g.raidAtDay = -1;
  g.raidThreat = 0;
}

/** Per-tick raider movement and looting. Called from the main step. */
export function stepRaiders(g: Game, dt: number): void {
  if (!g.raiders.length) return;
  const speed = TUNING.walkSpeed * 1.05;

  for (const r of g.raiders) {
    // Walk the path, same arithmetic as villagers.
    let budget = speed * dt;
    while (budget > 0 && r.pathIdx < r.path.length) {
      const p = r.path[r.pathIdx];
      const dx = p.x - r.x, dy = p.y - r.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) { r.pathIdx++; continue; }
      if (d <= budget) { r.x = p.x; r.y = p.y; budget -= d; r.pathIdx++; }
      else { r.x += (dx / d) * budget; r.y += (dy / d) * budget; budget = 0; }
      if (d > 1e-4) r.facing = Math.atan2(dx, dy);
    }
    if (r.pathIdx < r.path.length) continue;

    if (r.state === 'toLoot') {
      r.state = 'looting';
      r.lootTimer = 2.5; // a few breaths to fill the sacks
    } else if (r.state === 'looting') {
      r.lootTimer -= dt;
      if (r.lootTimer > 0) continue;
      const b = g.buildings.get(r.targetB);
      if (b) {
        // Grab the most valuable thing on the shelf that nobody has promised
        // to a hauler. One sackful each.
        let bestRes: ResId | null = null, bestV = 0;
        for (const k in b.store) {
          const res = k as ResId;
          const avail = b.available(res);
          const v = avail > 0.5 ? RESOURCES[res].price * Math.min(avail, TUNING.carryCapacity) : 0;
          if (v > bestV) { bestV = v; bestRes = res; }
        }
        if (bestRes) {
          const amt = Math.min(b.available(bestRes), TUNING.carryCapacity);
          b.take(bestRes, amt);
          r.carry = { res: bestRes, amt };
          g.raidLosses[bestRes] = (g.raidLosses[bestRes] ?? 0) + amt;
        }
      }
      r.state = 'leaving';
      const p = g.path.find(r.x, r.y, r.entryX, r.entryY, 1.5);
      r.path = p ?? []; r.pathIdx = 0;
      // No way back? They melt into the woods where they stand.
      if (!p) r.path = [];
    }
    // 'leaving' with an exhausted path: gone.
  }

  const before = g.raiders.length;
  g.raiders = g.raiders.filter((r) => !(r.state === 'leaving' && r.pathIdx >= r.path.length));
  if (before > 0 && g.raiders.length === 0) {
    const taken = Object.entries(g.raidLosses)
      .map(([res, amt]) => `${Math.round(amt as number)} ${RESOURCES[res as ResId].name.toLowerCase()}`)
      .join(', ');
    g.log(taken ? `The raiders are gone, and so is ${taken}.` : 'The raiders left empty-handed.', taken ? 'bad' : 'good');
    // The whole village felt it, looted or not.
    for (const b of g.buildings.values()) {
      if (b.state === 'active' && b.isHouse && b.residents.length) {
        b.moodEvents.push({ label: 'Raiders came through', delta: -0.12, until: g.day + 4 });
      }
    }
    g.raidLosses = {};
    standDown(g);
  }
}
