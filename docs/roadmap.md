# Cozy Village — shipping roadmap

Derived from *Manor Lords: Deep Technical Product Architecture & Systems Specification*
(Feb 2026), mapped onto what this codebase actually has.

## The one idea this roadmap is built on

> **The biggest gap is not missing content volume but missing higher-order orchestration.**
> …New content should compose existing primitives. If a new feature requires its own private
> economy, it should be treated as an architectural smell. — §0, §11

So: no new building lists until the systems underneath them are worth composing. Every slice
below either removes a lie, makes a system observable, or connects two systems that currently
ignore each other.

## Where we already match the spec

Worth stating, because it decides what *not* to rebuild.

| Spec | Us |
|---|---|
| §1.7 Logistics as the hidden economy — goods are physical, location matters | Yes, and it is the strongest part of the game. Reservations, carts, porters, partial deliveries. |
| §1.10 Fertility as per-field state with seasonal decay/recovery, not recomputed from aggregate output | Yes — `world.fertility` / `fertilityBase`, drained by harvest, drifting back. Exactly the recommendation. |
| §4.6 Bounded deterministic scarcity curve rather than scripted price events | Yes — `trade.mod` with `priceElasticity` and `priceRecovery`. |
| §1.9 Production reserves so the player can tell a producer when to stop | Partly — `Building.limit` exists. Spoilage does not. |
| §7.3 Save captures authoritative state + seeds, not cached derivatives; content changes need version migration | Yes, as of the save descriptor and migration chain. |
| §1.2 Family as an aggregation unit | Partly — families exist and own homes, but the villager is still the economic grain. |

## Where we do not, in the order we will fix it

Each slice is independently shippable: green CI, a downloadable build, one commit series.

### S1 — Reachability. *Measured, not guessed.*
97.3% of simulation time is A\*. **Only 3.0% of searches reach their goal**; 85.7% flood-fill
the entire reachable map and give up. Villagers are constantly asked to walk somewhere they
cannot get to — across the river, or onto a wander tile that turns out to be water.

Spec §7.4 names the strategy: *hierarchical navmesh + localized invalidation*. We take the cheap
80%: label connected components of walkable tiles, invalidate on placement, and answer "can I
get there" in O(1) before any search runs.

This is first because everything after it is paid for in iteration speed.

### S2 — Simulation invariants in CI. *§9.1 is a test list we can copy.*
Goods are conserved except through documented events; nobody holds two jobs; no good is
consumed twice through duplicated reservation commits; every transaction has a source and a
sink; save/load produces identical results from the next tick on. We have two of these. The
rest become assertions that run on every push.

### S3 — Transactional inventory. *§7.2*
`reserve(good, qty, owner) -> id`, `commit(id)`, `release(id)`. We have reserve and release
without identity, and the ledger audit has already caught one real leak from exactly that. An
id makes an orphaned claim impossible to express rather than merely detectable.

### S4 — Spoilage and storage quality. *§1.9*
Changes the optimisation problem from "maximise food produced" to "maximise usable food
delivered before it expires", and gives the granary a reason to exist beyond raw capacity. It
is also the cheapest way to make storage placement a decision.

### S5 — Telemetry and inspectors. *§8.1, §8.2*
Labour utilisation, transport queue age, inventory dwell time, recipe input starvation,
market service rate, food months. `game.stats` already collects history that nothing displays.
The diagnostic question that matters most: *is the economy producing but failing to move
goods?* Right now we cannot answer it.

### S6 — Family as the economic grain. *§1.2, §4.1*
Consumption, job assignment, health and militia eligibility resolve per household rather than
per villager. Reduces simulation cardinality while making the population legible.

### S7 — Approval as a modifier stack. *§4.9*
`{ source, magnitude, start, decayCurve }[]` with the score derived, replacing an opaque
contentment float. Without named sources the mood system is invisible and therefore pointless.

### S8 — Development perks with traceable modifiers. *§4.8*
Every modifier answers "why is this sawmill producing 15% more?" in the UI.

### S9 — Militia and raids. *§1.11*
Army generation consumes civilian labour: the cross-system contract that makes defence cost
something. Loot-and-flee first, no combat resolution, per the scope warning we already wrote.

## Deliberately not doing

- **Multi-region** (§1.4, §4.7). The spec is region-centric because Manor Lords is a territorial
  game. This is one valley, and a region boundary with nothing on the other side is cost with
  no play. Revisit only if S1–S9 land and the map starts feeling small.
- **Strategic Lord AI** (FEAT-01), **diplomacy** (FEAT-02), **feudal obligations** (FEAT-03),
  **sieges** (FEAT-05). All P0 in the spec, all downstream of multi-region and rival lords.
- **Individual-life simulation.** §11 Phase B explicitly warns against it, and so does the
  8-edge cap we already wrote into the relationships design.

## How a slice ships

1. Branch off `main`, land it as a small commit series.
2. `npx tsc --noEmit`, `npm test`, `npm run rope` all green locally.
3. Push. CI repeats all three and uploads a playable build.
4. If the rope goes red, that is a behaviour change: it is either a bug, or it is the point of
   the slice and the goldens get re-recorded in the same commit that caused it.

---

## Shipped

### S1 — Reachability ✅
Simulation is **2.2× faster** end to end and the rope dropped from ~35s to 16s, with **all 12
determinism checkpoints unchanged** — so this is pure speed, not a rebalance.

Three findings, in order of size:

1. **The A\* inner loop was allocating.** `[a, b] = [b, a]` in the heap swap builds a throwaway
   array per swap, and `for (const [dx, dy, base] of DIRS)` destructures a sub-array on every
   one of the millions of neighbour visits a search makes. Plain temporaries and three flat
   direction arrays: **2.2× on their own**, verified behaviour-neutral in isolation.
2. **Region labelling** rejects a search whose goal is in a different walkable component,
   before paying for a flood-fill. 10.9% of searches, of which **8,115 of 8,595 returned null
   anyway** — pure waste.
3. **The near-miss rule is load-bearing.** The first version of the check returned null for
   every unreachable goal, and starved all three seeds — pop 1 and zero food on one of them.
   A failed search is not wasted work: it returns a path to the closest tile it reached, and
   the 480 near-misses it was discarding landed an average of **2.4 tiles** from their target,
   inside the radius the work loops accept as arrival. Rejecting now requires the goal to be
   more than `NEAR_ENOUGH` (4) tiles from anything reachable, which keeps every useful partial
   path and still discards the cross-river ones.

The measurement that started this — 97.3% of sim time in A\*, only 3.0% of searches reaching
their goal — was worth more than the fix. The remaining cost is now genuine pathfinding.

### S2 — Simulation invariants in CI ✅
Sixteen structural rules checked at 1,600 snapshots across two 45-day villages, gating every
push: workers↔jobIds, residents↔homeIds, families↔members↔homes, the hauling ledger against
the villagers walking it, node claims against holders, no negative stock, the ox pool as a
count of actual holders. Writing the node-claim rule found the next leak by inspection —
`plantLoop` abandoned claimed planting spots on a failed path, permanently shrinking the
forester's ring. Fixed, rope unchanged.

### S3 — Transactional inventory ✅
Every hauling claim is an identified receipt (`systems/hauling.ts`): open, settle each side,
re-pledge, cancel — and cancellation releases what the record says is open instead of
re-deriving it from action flags, which is how both shipped leaks happened. Aggregates stay
materialised but are maintained in one module only; the invariant harness proves
aggregate == Σ receipts at every snapshot and catches a manufactured bypass. Behaviour
identical: 12/12 checkpoints unchanged.

### S4 — Spoilage and storage quality ✅
Food rots by class (berries fast, bread slow, roots barely, honey never), scaled by shelf
(granary 0.15, storehouse 0.5, stall 1.0) and season (winter halves, summer +50%). Replaces
the old "8% a season unless a granary exists anywhere" force field. Rot never touches
reserved stock, so receipts stay honest. All three seeds survive 110 days; seed 7 holds
pop 8–10 through year 13. First deliberate behaviour change — goldens re-recorded.

### S5 — Telemetry ✅ (first pass)
The Village Ledger: sparklines over the 240-day histories, today's made/used/rotted flows,
and the producing-but-not-moving diagnostics (hauls under way, starved workshops, goods
awaiting a haulier). Inspectors per §8.2 remain open for a later pass.
