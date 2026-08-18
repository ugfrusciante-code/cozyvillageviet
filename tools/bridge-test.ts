/**
 * Bridges: the water stops deciding how far your hauliers walk.
 *
 * Worldgen never actually splits the valley in two — the region census says
 * every map is one connected walk — so the honest claim is not "bridges
 * reconnect the map" but "bridges collapse detours". A storehouse across a
 * bay can be a sixty-tile trudge around the shore; planks turn it into a
 * stroll. Asserted directly: find a crossing whose walk-around is long, deck
 * it, and the path must shrink to roughly the width of the water.
 */
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { Checks } from './assert';

const c = new Checks('bridges');

/** A water column whose banks are walkable and whose detour is painful. */
function findCrossing(g: Game): { x: number; y1: number; y2: number; detour: number } | null {
  const w = g.world;
  let best: { x: number; y1: number; y2: number; detour: number } | null = null;
  for (let x = 8; x < w.size - 8; x += 2) {
    for (let y = 8; y < w.size - 8; y++) {
      if (!w.water[w.idx(x, y)] || w.water[w.idx(x, y - 1)]) continue;
      let span = 0;
      while (span < 6 && w.water[w.idx(x, y + span)]) span++;
      if (span >= 6 || span < 1) continue;
      const a = { x, y: y - 1 }, b = { x, y: y + span };
      if (!w.walkable(a.x, a.y) || !w.walkable(b.x, b.y)) continue;
      const path = g.path.find(a.x, a.y, b.x, b.y, 0.5);
      const detour = path ? path.length : Infinity;
      if (detour > (best?.detour ?? 24) && detour < Infinity) best = { x, y1: y, y2: y + span - 1, detour };
    }
  }
  return best;
}

// Seed chosen by survey: its worst crossing is a 60-tile trudge around the shore.
const g = new Game(20260817);
const cross = findCrossing(g);
c.ok(!!cross, 'somewhere, crossing the water the long way is painful',
  cross ? `${cross.detour}-tile detour for ${cross.y2 - cross.y1 + 1} tiles of water` : 'no such spot');
if (!cross) c.done();
const { x, y1, y2, detour } = cross!;
const w = g.world;
const north = { x, y: y1 - 1 }, south = { x, y: y2 + 1 };

const store = [...g.buildings.values()].find((b) => b.isStorage)!;
store.add('logs', 60); store.add('planks', 60);

let laid = 0;
for (let y = y1; y <= y2; y++) {
  if (g.canPlace('bridge', x, y).ok && g.place('bridge', x, y)) laid++;
}
c.ok(laid === y2 - y1 + 1, 'a line of planks goes down over open water', `${laid} tiles`);

const after = g.path.find(north.x, north.y, south.x, south.y, 0.5);
c.ok(!!after, 'the crossing is walkable');
c.ok((after?.length ?? Infinity) <= (y2 - y1 + 1) + 4,
  'the detour collapses to the width of the water',
  `${detour} tiles around -> ${after?.length} across`);

// Dry feet only.
const wet = (after ?? []).some((p) => {
  const i = w.idx(Math.round(p.x), Math.round(p.y));
  return w.water[i] && !w.bridge[i];
});
c.ok(!wet, 'nobody swims');

// Placement rules hold.
c.ok(!g.canPlace('bridge', north.x, north.y).ok, 'no bridges on dry land');
c.ok(!g.canPlace('bridge', x, y1).ok, 'no double-decking');

// The crossing survives a save byte-for-byte.
const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
const loaded = g2.path.find(north.x, north.y, south.x, south.y, 0.5);
c.ok(!!loaded && loaded.length <= (y2 - y1 + 1) + 4, 'the crossing survives a save');

// Demolition gives the water its way again.
for (const b of [...g2.buildings.values()]) if (b.defId === 'bridge') g2.demolish(b.id);
const back = g2.path.find(north.x, north.y, south.x, south.y, 0.5);
c.ok(!back || back.length > (y2 - y1 + 1) + 6, 'tear out the planks and the detour returns');

c.done();
