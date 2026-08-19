# Cozy Village

A 3D village/colony sim in the browser. Three.js + TypeScript + Vite. Buildings and villagers are
generated from primitives at runtime; the trees, rocks, ore and minerals come from one baked
nature set (`assets/nature_set.obj`), and its eighteen materials are the palette the whole game
is drawn in.

```bash
npm install
npm run dev      # play at http://localhost:5180
npm run build    # typecheck + production bundle
npm run sim      # run the simulation headlessly for 70 days and print a report
npm run bake:nature          # re-bake src/render/nature-data.ts from assets/nature_set.obj
npm run bake:nature -- --list  # just print the prop inventory it finds
```

The village **saves itself as you play** and resumes where you left off when you
come back. The ☰ menu holds a manual save slot, file export/import, and a fresh start.

## What it is

You settle a procedurally generated river valley with eight people, a storehouse, a market
stall and a well. Everything after that you build, staff and supply yourself.

The design is benchmarked against three games:

| Borrowed from | What it became here |
| --- | --- |
| **Manor Lords**: burgage plots, needs *variety*, market distribution by proximity | Homes upgrade through three tiers gated on distinct food types, clothing types, comfort goods, fuel, water, faith, ale and local charm. Markets serve the nearest households first. |
| **Foundation**: free placement, jobs, taxation, *Splendour* | No grid snapping beyond tiles, decorative buildings radiate **Charm** that gates tier 3 and lifts contentment, and the Town Hall collects real tax. |
| **Settlement Survival**: no individual micromanagement, happiness gates output *and* births | You set job slots per building, not per person. Contentment scales work rate, birth rate and emigration. |

## The loop

1. **Gatherers** (woodcutter, forager, hunter, fishery, quarry, mine…) work resource nodes in
   range and stack the haul in their own hut.
2. **Farms are drag-drawn**: press and drag to define a field, pasture or orchard from a garden
   patch up to a 9×9 plot. Jobs, cost and yield scale with the acreage. Fields live a full
   farming year: sown in spring, tended in summer, reaped in autumn, dormant in winter; an
   unreaped crop freezes in the field, and worked soil slowly tires (rest it and it recovers).
3. **Porters and idle labourers** carry finished goods to a storehouse or granary, and haul
   materials to construction sites. At each turn of the season, out-of-season crews stand down
   and their hands go where the work is.
4. **Workshops** pull inputs from storage and run recipes: logs → planks, clay + firewood →
   bricks, grain → flour → bread, wool → cloth → clothes, hides → leather → shoes. Each can be
   capped ("make until N in store") and given a priority.
5. **Market workers** stock the stalls; **households** shop at the nearest stall. What arrives
   decides contentment, which decides upgrades, births, and how fast everyone works.
6. **The Trading Post** takes standing orders: sell everything above X, buy back up to Y, settled
   once a day at drifting prices.
7. **An Ox Stable** puts carts on the road: a haulier with an ox shifts 36 at a time instead of 12,
   at a slightly slower walk. Oxen are a shared pool, claimed only for loads worth the trip.

Select any building to see its **supply lines**: who delivered to it and who it feeds, drawn as
arcs in the world and listed in the inspector.

Roads make every step of that faster. Villagers move 70% quicker on them, and hauling is most
of the working day.

## Systems

- **Time**: 24h day (60s at 1×), 4 days a season, 4 seasons a year. Speeds 1×–10×, space to pause.
- **Seasons**: winter burns 4× the firewood, stops the foragers and slows every worker.
  Fields are sown in spring and reaped in autumn.
- **Economy**: 31 resources across five categories, 53 buildings, chains up to four conversions deep (logs → firewood → charcoal → iron → tools).
  Trade prices at the Trading Post move against you as you flood or drain a market, then drift back.
- **Population**: villagers age, learn their trade (a School raises the skill ceiling for life),
  fall ill, have children when content and well fed, and leave when they are not.
- **Families**: every household is a named family. Children are born into one and inherit the
  surname, newcomers marry in or found their own, and a home's tier caps how many families
  can live under its roof. Tax is levied per household.
- **Crop rotation**: fields are sown with wheat, beans or turnips. Following a crop with a
  different one pays ×1.25; repeating it costs ×0.78. Wheat is the big yield but hardest on the
  soil, beans are a legume that puts fertility *back*, turnips are cheap bulk. Wheat is also not
  food until you have a mill and a bakery — sow turnips early if you have neither.
- **Saving**: autosaves every 30s and on leaving the tab, with a manual slot and JSON
  export/import. Saves store only what changed since worldgen, run-length encoded, so a
  full village is ~100 KB.
- **Storage**: food spoils each season without a granary; a full storehouse stops production dead,
  and the game says so.

## Code layout

```
src/sim/      pure simulation, no renderer imports, runs headlessly
  defs.ts     resources, buildings, house tiers, tuning constants
  world.ts    terrain generation, resource nodes, A* pathfinding
  building.ts a placed building: construction, storage, production, household state
  villager.ts movement and the work/haul/build behaviour loops
  game.ts     time, needs, contentment, tax, trade, job assignment
  family.ts   households: surnames, members, generations
  save.ts     versioned snapshot: RLE tile deltas + entities, deterministic
src/render/   three.js scene, procedural meshes, warm seasonal palette,
              weather, clouds, overlays
  villagers.ts instanced crowd: every villager drawn from ~11 InstancedMeshes
src/ui/       DOM overlay
tools/        headless harnesses used to balance the economy
```

`src/sim` deliberately imports nothing from `src/render`, so `npm run sim` plays whole years in
seconds. That is how the economy was balanced. The harness caught a reservation leak that froze
the whole village, a priority inversion that left the woodcutter unstaffed while the woodshed
starved, a storage deadlock that permanently disabled any villager holding an undeliverable load,
and — most recently — a market that sized its food orders off a household count of zero.

`tools/save-test.ts` round-trips a mid-game village and asserts the state is byte-identical, then
simulates both copies for ten more days and asserts they stay in lockstep. `tools/ox-test.ts`
checks carts actually move more than a person can and that the ox pool never leaks.

## Controls

- **Pan**: WASD, arrow keys, or drag with left/right mouse. Click the minimap to jump.
- **Rotate**: Q / E, or middle-drag. **Zoom**: scroll. **R** rotates a building before placing.
- **Build**: pick from the bottom bar, click the ground. Shift keeps the tool active.
  Roads drag in runs; fields, pastures and orchards drag out to the size you want.
- **Overlays**: fertility and charm heat-maps, next to the minimap.
- **Cancel**: Esc or right-click. **Inspect**: click any building or villager; hover for tooltips.
- **Speed**: 1-4 keys, space to pause
- **Menu**: ☰ for save, load, export/import and a new village
