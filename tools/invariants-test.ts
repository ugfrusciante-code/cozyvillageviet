/**
 * Structural invariants, checked continuously while a village plays.
 *
 * These are the §9.1-style rules from the Manor Lords architecture spec,
 * translated to this sim: relationships that must hold at every instant, not
 * just at the end of a run. Each one is a statement of the form "two pieces of
 * state that describe the same fact must agree" — worker lists and jobIds,
 * resident lists and homeIds, the reservation ledger and the villagers walking
 * it, the claimed-node set and the villagers who claimed them.
 *
 * A violation here is a leak in the making: every one of these pairs has
 * already produced (or nearly produced) a shipped bug when one side drifted.
 */

import { Game } from '../src/sim/game';
import { BUILDING_BY_ID } from '../src/sim/defs';
import { RNG } from '../src/sim/world';
import { auditReservations } from './assert';

const violations = new Map<string, { count: number; first: string }>();
let ticksChecked = 0;

function report(rule: string, detail: string): void {
  const v = violations.get(rule);
  if (v) v.count++;
  else violations.set(rule, { count: 1, first: detail });
}

function checkInvariants(g: Game, tick: number): void {
  ticksChecked++;
  const at = (s: string) => `tick ${tick}, day ${g.day}: ${s}`;

  // --- Employment: b.workers and v.jobId are two views of one fact.
  const seenWorker = new Set<number>();
  for (const b of g.buildings.values()) {
    for (const id of b.workers) {
      if (seenWorker.has(id)) report('worker-in-two-places', at(`villager ${id} appears in two worker lists`));
      seenWorker.add(id);
      const v = g.villagers.get(id);
      if (!v) report('worker-ghost', at(`${b.name} #${b.id} lists dead villager ${id}`));
      else if (v.jobId !== b.id) report('worker-jobid-mismatch', at(`${v.name} in ${b.name}'s workers but jobId=${v.jobId}`));
    }
  }
  for (const v of g.villagers.values()) {
    if (v.jobId >= 0) {
      const b = g.buildings.get(v.jobId);
      if (!b) report('jobid-ghost', at(`${v.name} has jobId ${v.jobId} but no such building`));
      else if (!b.workers.includes(v.id)) report('jobid-not-listed', at(`${v.name} has jobId ${b.id} but is not in its workers`));
    }
  }

  // --- Housing: b.residents and v.homeId, same shape.
  const seenResident = new Set<number>();
  for (const b of g.buildings.values()) {
    for (const id of b.residents) {
      if (seenResident.has(id)) report('resident-in-two-homes', at(`villager ${id} resides in two homes`));
      seenResident.add(id);
      const v = g.villagers.get(id);
      if (!v) report('resident-ghost', at(`${b.name} #${b.id} houses dead villager ${id}`));
      else if (v.homeId !== b.id) report('resident-homeid-mismatch', at(`${v.name} in ${b.name}'s residents but homeId=${v.homeId}`));
    }
  }

  // --- Families: memberIds, familyId, homeId, familyIds all describe one household.
  for (const f of g.families.values()) {
    for (const id of f.memberIds) {
      const v = g.villagers.get(id);
      if (!v) report('family-ghost-member', at(`family ${f.surname} lists dead villager ${id}`));
      else if (v.familyId !== f.id) report('family-membership-mismatch', at(`${v.name} in ${f.surname}'s members but familyId=${v.familyId}`));
    }
    if (f.homeId >= 0) {
      const home = g.buildings.get(f.homeId);
      if (!home) report('family-ghost-home', at(`family ${f.surname} homed in demolished building ${f.homeId}`));
      else if (!home.familyIds.includes(f.id)) report('family-home-mismatch', at(`${f.surname} points at ${home.name} which does not list it`));
    }
  }

  // --- The hauling ledger balances against the villagers walking it.
  for (const p of auditReservations(g)) report('ledger', at(p));

  // --- Node claims: every claimed tile is held by exactly one villager.
  const holders = new Map<number, number>();
  for (const v of g.villagers.values()) {
    if (v.targetNode >= 0) holders.set(v.targetNode, (holders.get(v.targetNode) ?? 0) + 1);
  }
  for (const [node, n] of holders) {
    if (n > 1) report('node-double-claim', at(`${n} villagers hold node ${node}`));
    if (!g.claimedNodes.has(node)) report('node-unregistered', at(`a villager works node ${node} without a claim`));
  }
  for (const node of g.claimedNodes) {
    if (!holders.has(node)) report('node-orphan-claim', at(`node ${node} is claimed but no villager holds it`));
  }

  // --- Stocks and ledgers never go negative; loads are real.
  for (const b of g.buildings.values()) {
    for (const ledger of [b.store, b.reservedOut, b.incoming, b.delivered] as Record<string, number | undefined>[]) {
      for (const k in ledger) {
        if ((ledger[k] ?? 0) < -0.001) report('negative-stock', at(`${b.name} #${b.id} has ${ledger[k]} ${k}`));
      }
    }
  }
  for (const v of g.villagers.values()) {
    if (v.carry && v.carry.amt <= 0) report('empty-carry', at(`${v.name} carries ${v.carry.amt} ${v.carry.res}`));
  }

  // --- The ox pool is a count of actual holders.
  let holding = 0;
  for (const v of g.villagers.values()) if (v.hasOx) holding++;
  if (g.oxenInUse !== holding) report('ox-count', at(`oxenInUse=${g.oxenInUse} but ${holding} villagers hold one`));
  if (g.oxenInUse > g.oxenTotal) report('ox-oversubscribed', at(`${g.oxenInUse} in use of ${g.oxenTotal} stabled`));

  if (!Number.isFinite(g.coin)) report('coin-nan', at(`coin=${g.coin}`));
}

// ---------------------------------------------------------------- the run

// Forester included on purpose: planting claims tiles through a different
// path (findPlantingSpot) than gathering does, and it must obey the same
// claim-release contract.
const BUILD = ['woodcutter', 'forager', 'woodshed', 'cottage', 'sawpit', 'granary', 'forester', 'hunter', 'quarry'];

for (const seed of [20260817, 7]) {
  const g = new Game(seed);
  const prng = new RNG(seed ^ 0x5f3a);
  const plop = (id: string): boolean => {
    for (let r = 2; r < 26; r++) for (let k = 0; k < 26; k++) {
      const a = prng.next() * 6.2832;
      const x = Math.round(g.startX + Math.cos(a) * r), y = Math.round(g.startY + Math.sin(a) * r);
      if (g.canPlace(id, x, y).ok) { const b = g.place(id, x, y); if (b) { b.jobSlots = BUILDING_BY_ID[id].jobs; return true; } }
    }
    return false;
  };
  let qi = 0;
  const DAYS = 45;
  for (let tick = 0; g.day < DAYS && tick < 4_000_000; tick++) {
    g.update(1 / 12);
    // Keep at most two sites open, like a player would.
    if (tick % 600 === 0 && qi < BUILD.length) {
      const open = [...g.buildings.values()].filter((b) => b.state !== 'active').length;
      if (open < 2 && plop(BUILD[qi])) qi++;
    }
    if (tick % 40 === 0) checkInvariants(g, tick);
  }
  console.log(`seed ${seed}: day ${g.day}, pop ${g.population}, ${g.buildings.size} buildings`);
}

console.log(`\nchecked ${ticksChecked} snapshots`);
if (violations.size === 0) {
  console.log('PASS: every structural invariant held at every snapshot');
  process.exit(0);
}
for (const [rule, v] of violations) {
  console.log(`FAIL  ${rule} — ${v.count}× — first: ${v.first}`);
}
process.exit(1);
