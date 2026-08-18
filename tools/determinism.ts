/**
 * The refactor safety rope.
 *
 * Plays a fixed build order on three seeds and compares the resulting state
 * digests against committed goldens. Splitting a 1,900-line file with no unit
 * tests is otherwise a gamble; with this it is a sequence of small verifiable
 * steps — move one section, re-run, stay green.
 *
 *   npx tsx tools/determinism.ts             compare (150 days, the per-commit gate)
 *   npx tsx tools/determinism.ts 400          a longer run, for the end of a phase
 *   npx tsx tools/determinism.ts --update     re-record (deliberate changes only)
 *
 * Hashes are taken at checkpoints, not just at the end, so a red run says
 * *when* the villages diverged as well as *which subsystem* did. Comparison
 * only looks at checkpoints present in both the goldens and this run, so a
 * 400-day run still validates itself against 150-day goldens.
 *
 * The three seeds run as separate processes: the simulation is single-threaded
 * and a few hundred village-days is not cheap.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runVillage } from './driver';
import { stateHash, auditReservations, type StateHash } from './assert';
import { FOOD_TYPES, TUNING } from '../src/sim/defs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'golden-hashes.json');
const TSX = join(HERE, '..', 'node_modules', '.bin', 'tsx');

const SEEDS = [20260817, 7, 4242];
const LADDER = [25, 50, 100, 150, 250, 400];

type Marks = Record<string, StateHash>;
type Golden = Record<string, Marks>;
/** Hashes plus a human-readable line, so a green run is also a health check. */
type Run = { marks: Marks; summary: string };

const args = process.argv.slice(2);
const update = args.includes('--update');
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 150);
const checkpoints = [...LADDER.filter((d) => d < days), days];

/** Play one seed and hash it at each checkpoint. */
function measure(seed: number): Run {
  const marks: Marks = {};
  let next = 0;
  const g = runVillage(seed, days, {
    onDay: (game) => {
      while (next < checkpoints.length && game.day >= checkpoints[next]) {
        marks[`d${checkpoints[next]}`] = stateHash(game);
        next++;
      }
    },
  });
  // The loop stops the moment `day` reaches `days`, which can be before noon,
  // so the final checkpoint may not have fired from inside `onDay`.
  if (!marks[`d${days}`]) marks[`d${days}`] = stateHash(g);
  const food = FOOD_TYPES.reduce((s, f) => s + g.stockOf(f), 0);
  const summary = `pop ${g.population}, ${g.buildings.size} buildings, `
    + `${(g.averageContentment * 100).toFixed(0)}% content, `
    + `${(food / Math.max(1, g.population * TUNING.foodPerDay)).toFixed(1)}d food, `
    + `ledger ${auditReservations(g).length ? 'LEAKING' : 'balanced'}`;
  return { marks, summary };
}

// A worker run: one seed, one JSON line on stdout.
const workerSeed = args[args.indexOf('--worker') + 1];
if (args.includes('--worker')) {
  process.stdout.write(JSON.stringify(measure(Number(workerSeed))));
  process.exit(0);
}

function runSeed(seed: number): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [fileURLToPath(import.meta.url), String(days), '--worker', String(seed)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (c) => { out += String(c); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`seed ${seed} exited ${code}`));
      else resolve(JSON.parse(out) as Run);
    });
  });
}

const t0 = Date.now();
console.log(`=== determinism: ${SEEDS.length} seeds × ${days} days ===`);
const results = await Promise.all(SEEDS.map(runSeed));
const observed: Golden = Object.fromEntries(SEEDS.map((s, i) => [String(s), results[i].marks]));
console.log(`ran in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
SEEDS.forEach((s, i) => console.log(`  seed ${s}: ${results[i].summary}`));

if (update) {
  writeFileSync(GOLDEN, `${JSON.stringify(observed, null, 2)}\n`);
  console.log('Recorded → tools/golden-hashes.json');
  process.exit(0);
}

let golden: Golden;
try {
  golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
} catch {
  console.log('No goldens recorded. Run with --update first.');
  process.exit(1);
}

let bad = 0;
let compared = 0;
for (const seed of SEEDS) {
  const want = golden[String(seed)] ?? {};
  const got = observed[String(seed)];
  for (const cp of Object.keys(got)) {
    const a = want[cp], b = got[cp];
    if (!a) continue;              // golden was recorded over a shorter run
    compared++;
    if (a.all === b.all) { console.log(`  PASS  seed ${seed} ${cp}  ${b.all}`); continue; }
    bad++;
    const parts = (Object.keys(b) as (keyof StateHash)[]).filter((k) => k !== 'all' && a[k] !== b[k]);
    console.log(`  FAIL  seed ${seed} ${cp}: diverged in ${parts.join(', ')}`);
    for (const p of parts) console.log(`          ${p}: golden ${a[p]} → now ${b[p]}`);
  }
}

if (compared === 0) {
  console.log('determinism: no checkpoints in common with the goldens — nothing was verified');
  process.exit(1);
}
console.log(bad === 0 ? `determinism: ${compared} checkpoints match` : `determinism: ${bad}/${compared} mismatches`);
process.exit(bad === 0 ? 0 : 1);
