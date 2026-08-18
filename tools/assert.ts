/**
 * Shared harness plumbing: a tiny assertion recorder, and `stateHash` — the
 * safety rope for refactors.
 *
 * There is no unit-test suite here, so "did the 1,876-line split change
 * behaviour?" is otherwise unanswerable. `stateHash` folds the entire
 * simulation into a handful of 32-bit hashes; run a fixed build order for a
 * few hundred days, and any behavioural drift shows up as a changed digest.
 *
 * The hash is split by subsystem on purpose. A single digest tells you only
 * that *something* moved; `buildings` differing while `world` matches tells
 * you where to look.
 */

import { serialize } from '../src/sim/save';
import type { Game } from '../src/sim/game';

// ------------------------------------------------------------------ hashing

/** FNV-1a, 32-bit. Chosen for being short, stable and dependency-free. */
function fnv1a(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/**
 * JSON with object keys sorted.
 *
 * Key *insertion order* is not behaviour: a refactor that happens to write
 * `store.logs` before `store.planks` has changed nothing about the village.
 * Sorting removes that whole class of false alarm, so a red hash always means
 * a real difference.
 */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}

const h = (v: unknown): string => hex(fnv1a(canon(v)));

export interface StateHash {
  all: string;
  clock: string;
  economy: string;
  world: string;
  buildings: string;
  villagers: string;
  families: string;
  derived: string;
}

/**
 * Fold the whole simulation into per-subsystem digests.
 *
 * Most of it comes from `serialize`, which already enumerates every field
 * worth persisting — reusing it means a newly-saved field is automatically
 * covered by the rope. `derived` then adds the state that is deliberately
 * *not* saved (reservations, claims, live paths), because a refactor can
 * easily break those while leaving the save payload looking healthy.
 */
export function stateHash(g: Game): StateHash {
  const d = serialize(g, 'hash');

  const byId = <T extends { id: number }>(xs: T[]): T[] => [...xs].sort((a, b) => a.id - b.id);

  const clock = h({ t: d.t, day: d.day, year: d.year, season: d.season, lastDay: d.lastDay, lastHourTick: d.lastHourTick, rngState: d.rngState });
  const economy = h({ coin: d.coin, trade: d.trade, tradeRules: d.tradeRules, stats: d.stats, lostGoods: d.lostGoods, events: d.events });
  const world = h(d.world);
  const buildings = h(byId(d.buildings));
  const villagers = h(byId(d.villagers));
  const families = h(byId(d.families));

  // Derived state, rebuilt on load and therefore absent from the save.
  const derived = h({
    // Id counters catch a villager who was born and died again between two
    // checkpoints: the population matches, but the village is not the same.
    nextIds: d.nextIds,
    claimedNodes: [...g.claimedNodes].sort((a, b) => a - b),
    oxenInUse: g.oxenInUse,
    autoAssign: g.autoAssign,
    pendingExtras: g.pendingExtras.map((p) => [p.b.id, p.res, p.amt]).sort(),
    transfers: g.transfers.map((t) => [t.from, t.to, t.res, t.amt, t.t]),
    alerts: g.alerts.map((a) => a.id).sort(),
    ledger: [...g.buildings.values()]
      .sort((a, b) => a.id - b.id)
      .map((b) => [b.id, canon(b.reservedOut), canon(b.incoming), b.activity]),
    paths: [...g.villagers.values()]
      .sort((a, b) => a.id - b.id)
      .map((v) => [v.id, v.path.length, v.pathIdx, v.action, v.carry?.res ?? '', v.carry?.amt ?? 0]),
  });

  return {
    all: hex(fnv1a([clock, economy, world, buildings, villagers, families, derived].join('|'))),
    clock, economy, world, buildings, villagers, families, derived,
  };
}

// ------------------------------------------------------------ ledger audit

/**
 * Check the two-sided hauling ledger against the villagers who are supposed to
 * be honouring it.
 *
 * `reservedOut` is stock a source has promised away; `incoming` is a delivery a
 * destination is expecting. Both are claims held by a villager mid-trip, and
 * both are invisible in the UI — a leak shows up only as goods that quietly
 * stop being available. Reconstructing the ledger from who is actually walking
 * where turns that silent failure into a loud one.
 *
 * Returns a list of discrepancies; empty means balanced.
 */
export function auditReservations(g: Game): string[] {
  const problems: string[] = [];
  const key = (id: number, res: string) => `${id}:${res}`;
  const expectReserved = new Map<string, number>();
  const expectIncoming = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const v of g.villagers.values()) {
    if (v.action === 'toPickup' && v.fetchRes && v.targetB >= 0) {
      bump(expectReserved, key(v.targetB, v.fetchRes), v.fetchAmt);
      if (v.jobDestOverride >= 0) bump(expectIncoming, key(v.jobDestOverride, v.fetchRes), v.fetchAmt);
    }
    if (v.action === 'toDrop' && v.carry && v.targetB >= 0) {
      bump(expectIncoming, key(v.targetB, v.carry.res), v.carry.amt);
    }
  }

  const EPS = 0.01;
  for (const b of g.buildings.values()) {
    for (const [ledger, expected, label] of [
      [b.reservedOut, expectReserved, 'reservedOut'],
      [b.incoming, expectIncoming, 'incoming'],
    ] as const) {
      const seen = new Set<string>([...Object.keys(ledger)]);
      for (const k of expected.keys()) if (k.startsWith(`${b.id}:`)) seen.add(k.slice(String(b.id).length + 1));
      for (const res of seen) {
        const have = (ledger as Record<string, number | undefined>)[res] ?? 0;
        const want = expected.get(key(b.id, res)) ?? 0;
        if (Math.abs(have - want) > EPS) {
          problems.push(`${b.name} #${b.id} ${label}.${res}: ledger ${have.toFixed(2)}, villagers account for ${want.toFixed(2)}`);
        }
      }
    }
    for (const [res, amt] of Object.entries(b.reservedOut)) {
      if ((amt ?? 0) - b.amount(res as never) > EPS) {
        problems.push(`${b.name} #${b.id} has promised ${(amt ?? 0).toFixed(2)} ${res} but holds ${b.amount(res as never).toFixed(2)}`);
      }
    }
  }
  return problems;
}

// --------------------------------------------------------------- assertions

/** Records pass/fail so a harness can exit non-zero without bookkeeping. */
export class Checks {
  private failures = 0;
  private passes = 0;

  constructor(private readonly title: string) {
    console.log(`=== ${title} ===`);
  }

  ok(cond: boolean, label: string, detail = ''): boolean {
    if (cond) { this.passes++; console.log(`  PASS  ${label}`); }
    else { this.failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
    return cond;
  }

  eq(actual: unknown, expected: unknown, label: string): boolean {
    return this.ok(canon(actual) === canon(expected), label, `got ${canon(actual)}, want ${canon(expected)}`);
  }

  /** Print the tally and exit. Call as the last line of a harness. */
  done(): never {
    console.log(`${this.title}: ${this.passes} passed, ${this.failures} failed`);
    process.exit(this.failures === 0 ? 0 : 1);
  }
}
