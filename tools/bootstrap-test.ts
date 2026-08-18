/**
 * Guards against soft-locks: a chain whose only inputs come from a building
 * that itself costs the chain's output. The iron branch shipped with exactly
 * that shape (mine cost 4 tools AND required a blacksmith; tools came only
 * from the blacksmith, iron only from the smelter, ore only from the mine)
 * and a village that spent 2 tools on a quarry could never reach it again.
 */
import { BUILDINGS, BUILDING_BY_ID, CROPS, RESOURCES, type ResId } from '../src/sim/defs';
import { Game } from '../src/sim/game';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// --- 1. No building may require a prerequisite it is the sole supplier for.
/** Crops are produced by the farming system, not by a recipe or a harvest. */
const CROP_OUTPUTS = new Set<ResId>(Object.values(CROPS).map((c) => c.out));

function producersOf(res: ResId): string[] {
  return BUILDINGS.filter((d) =>
    d.harvest?.out === res
    || (d.harvest?.extra && res in d.harvest.extra)
    || (d.recipe?.out && res in d.recipe.out)
    || (!!d.crop && CROP_OUTPUTS.has(res)),
  ).map((d) => d.id);
}

const circular: string[] = [];
for (const d of BUILDINGS) {
  if (!d.needs) continue;
  for (const req of d.needs) {
    // Does the prerequisite's own construction depend on something only `d` makes?
    for (const costRes of Object.keys(d.cost) as ResId[]) {
      const makers = producersOf(costRes);
      if (!makers.length) continue;
      // Walk one level: does every producer of this cost depend on `d`'s output?
      const dOutputs = new Set<ResId>([
        ...(d.harvest ? [d.harvest.out] : []),
        ...(d.recipe ? Object.keys(d.recipe.out) as ResId[] : []),
      ]);
      for (const maker of makers) {
        const m = BUILDING_BY_ID[maker];
        const inputs = Object.keys(m.recipe?.in ?? {}) as ResId[];
        const needsD = inputs.some((i) => dOutputs.has(i))
          || inputs.some((i) => producersOf(i).length === 1 && producersOf(i)[0] === d.id);
        if (needsD && makers.length === 1) {
          circular.push(`${d.id} needs ${req}, but its cost (${costRes}) comes only from ${maker}, which depends on ${d.id}`);
        }
      }
    }
  }
}
check(circular.length === 0, 'no building requires a prerequisite it alone enables',
  circular.join(' | ') || 'none found');

// --- 2. The starting stock must cover every tool-costing building reachable early.
const g = new Game(20260817);
const startTools = g.stockOf('tools');
const earlyToolCosts = BUILDINGS
  .filter((d) => (d.cost.tools ?? 0) > 0 && !d.minPop && !d.needs)
  .map((d) => ({ id: d.id, tools: d.cost.tools ?? 0 }));
const totalEarly = earlyToolCosts.reduce((t, x) => t + x.tools, 0);
check(startTools >= totalEarly,
  'starting tools cover every ungated tool-costing building',
  `have ${startTools}, need ${totalEarly} (${earlyToolCosts.map((x) => `${x.id}:${x.tools}`).join(', ')})`);

// --- 3. Every resource used as a recipe input has a producer.
const orphanInputs: string[] = [];
for (const d of BUILDINGS) {
  for (const res of Object.keys(d.recipe?.in ?? {}) as ResId[]) {
    if (!producersOf(res).length) orphanInputs.push(`${d.id} consumes ${res}, nothing produces it`);
  }
}
check(orphanInputs.length === 0, 'every recipe input has at least one producer',
  orphanInputs.join(' | ') || 'all inputs satisfied');

// --- 4. Report (not assert) the shape of the economy, for Phase 2.
const constructionOnly = (Object.keys(RESOURCES) as ResId[]).filter((r) => {
  const consumedByRecipe = BUILDINGS.some((d) => d.recipe?.in && r in d.recipe.in);
  const isHousehold = RESOURCES[r].food || RESOURCES[r].clothing || RESOURCES[r].fuel || RESOURCES[r].luxury;
  const usedAsCost = BUILDINGS.some((d) => r in d.cost);
  return !consumedByRecipe && !isHousehold && usedAsCost;
});
console.log(`\nINFO construction-only sinks (tools wear out via TUNING.toolWear, so they no longer belong here; the rest are Phase 2 targets): ${constructionOnly.join(', ') || 'none'}`);

console.log(failures === 0 ? '\nAll bootstrap checks passed.' : `\n${failures} check(s) failed.`);
// --- Chain depth: the economy's shape, asserted. Depth 1 is anything pulled
// straight from the world; each recipe adds one. The plan's bar is at least
// four conversions end to end, which charcoal smelting provides:
// logs -> firewood -> charcoal -> iron -> tools.
{
  const depth = new Map<string, number>();
  const harvested = new Set<string>();
  for (const d of BUILDINGS) {
    if (d.harvest) {
      harvested.add(d.harvest.out);
      for (const k in d.harvest.extra ?? {}) harvested.add(k);
    }
    if (d.crop) for (const c of Object.values(CROPS)) harvested.add(c.out);
  }
  for (const h of harvested) depth.set(h, 1);
  // Relax until fixed point: a recipe's outputs sit one above its deepest input.
  for (let pass = 0; pass < 12; pass++) {
    for (const d of BUILDINGS) {
      if (!d.recipe) continue;
      let worst = 0;
      let ready = true;
      for (const k in d.recipe.in) {
        const di = depth.get(k);
        if (di === undefined) { ready = false; break; }
        worst = Math.max(worst, di);
      }
      if (!ready) continue;
      for (const k in d.recipe.out) {
        depth.set(k, Math.max(depth.get(k) ?? 0, worst + 1));
      }
    }
  }
  const deepest = [...depth.entries()].sort((a, b) => b[1] - a[1])[0];
  const conversions = deepest[1] - 1;
  check(conversions >= 4, `the longest chain runs ${conversions} conversions (${deepest[0]} is depth ${deepest[1]})`);
}

process.exit(failures === 0 ? 0 : 1);