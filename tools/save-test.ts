/** Round-trips a mid-game village through serialize/deserialize and diffs it. */
import { Game } from '../src/sim/game';
import { SAVE_VERSION, serialize, deserialize, type SaveData } from '../src/sim/save';
import { BUILDING_BY_ID, FOOD_TYPES, type ResId } from '../src/sim/defs';
import { RNG } from '../src/sim/world';

const SEED = 20260817;
const g = new Game(SEED);
const prng = new RNG(SEED ^ 0x5f3a);

function plop(id: string, w?: number, h?: number): boolean {
  for (let r = 2; r < 26; r++) for (let k = 0; k < 26; k++) {
    const a = prng.next() * 6.2832;
    const x = Math.round(g.startX + Math.cos(a) * r), y = Math.round(g.startY + Math.sin(a) * r);
    if (g.canPlace(id, x, y, w, h).ok) { const b = g.place(id, x, y, w, h); if (b) return true; }
  }
  return false;
}

const Q = ['woodcutter', 'forager', 'woodshed', 'cottage', 'sawpit', 'granary', 'hunter', 'chapel', 'well', 'stable'];
let qi = 0, lastSlot = -1;
while (g.day < 30) {
  g.update(1 / 12);
  const slot = Math.floor(g.totalHours / 6);
  if (slot !== lastSlot) {
    lastSlot = slot;
    if ([...g.buildings.values()].filter((b) => b.state !== 'active').length < 2 && qi < Q.length) {
      plop(Q[qi]); qi++;
    }
  }
}
plop('field', 6, 5);
while (g.day < 40) g.update(1 / 12);

function snapshot(x: Game) {
  return JSON.stringify({
    t: +x.t.toFixed(4), day: x.day, year: x.year, season: x.season, coin: Math.round(x.coin),
    pop: x.villagers.size, buildings: x.buildings.size, families: x.families.size,
    content: +x.averageContentment.toFixed(6),
    food: Math.round(FOOD_TYPES.reduce((s, f) => s + x.stockOf(f), 0)),
    stock: (['logs', 'planks', 'firewood', 'grain', 'berries', 'meat'] as ResId[])
      .map((r) => `${r}:${x.stockOf(r).toFixed(2)}`).join(','),
    homes: [...x.buildings.values()].filter((b) => b.isHouse)
      .map((b) => `${b.id}:t${b.tier}:f${b.families}:r${b.residents.length}:${b.contentment.toFixed(4)}`).join('|'),
    fields: [...x.buildings.values()].filter((b) => b.def.crop)
      .map((b) => `${b.id}:${b.cropType}:${b.growth.toFixed(4)}:${b.cropPool.toFixed(3)}:${b.fertility.toFixed(4)}`).join('|'),
    vills: [...x.villagers.values()].slice(0, 12)
      .map((v) => `${v.id}:${v.name}:${v.age.toFixed(3)}:${v.x.toFixed(3)},${v.y.toFixed(3)}:${v.jobId}:${v.familyId}:${v.health.toFixed(4)}`).join('|'),
    fams: [...x.families.values()].map((f) => `${f.id}:${f.surname}:${f.homeId}:${f.memberIds.length}`).join('|'),
  }, null, 1);
}

let failed = 0;
const before = snapshot(g);
const data = serialize(g);
const json = JSON.stringify(data);
const g2 = deserialize(JSON.parse(json));
const after = snapshot(g2);

console.log(`save size: ${(json.length / 1024).toFixed(1)} KB (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`buildings ${g.buildings.size}  villagers ${g.villagers.size}  families ${g.families.size}`);

if (before === after) {
  console.log('PASS: state identical after round-trip');
} else {
  failed++;
  console.log('FAIL: state diverged');
  const a = before.split('\n'), b = after.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) console.log(`  line ${i}\n    before: ${a[i]}\n    after:  ${b[i]}`);
  }
}

// Both games should now advance identically for another 10 days.
for (let i = 0; i < 12 * 60 * 10; i++) { g.update(1 / 12); g2.update(1 / 12); }
const b2 = snapshot(g), a2 = snapshot(g2);
if (b2 !== a2) failed++;
console.log(b2 === a2
  ? 'PASS: 10 further days simulate identically'
  : 'FAIL: divergence after continued simulation');
if (b2 !== a2) {
  const a = b2.split('\n'), b = a2.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) console.log(`  line ${i}\n    orig:   ${a[i]}\n    loaded: ${b[i]}`);
  }
}
void BUILDING_BY_ID;

// ------------------------------------------------------ version handling

const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

// A v3 payload must still load. The on-disk shape did not change at v4, only
// the code that produces it, so the migration is an identity step — but the
// chain has to actually run, and this is what proves it does.
const v3 = JSON.parse(JSON.stringify(serialize(g))) as SaveData;
v3.version = 3;
let loadedV3: ReturnType<typeof deserialize> | null = null;
try { loadedV3 = deserialize(v3); } catch (e) { check(false, 'a version 3 save still loads', String(e)); }
if (loadedV3) {
  check(true, 'a version 3 save still loads');
  check(loadedV3.villagers.size === g.villagers.size && loadedV3.buildings.size === g.buildings.size,
    'the migrated village is intact',
    `${loadedV3.villagers.size} villagers, ${loadedV3.buildings.size} buildings`);
}

// A payload from a newer build must be refused, not half-read.
const future = JSON.parse(JSON.stringify(serialize(g))) as SaveData;
future.version = SAVE_VERSION + 1;
let refused = '';
try { deserialize(future); } catch (e) { refused = String(e); }
check(refused.includes('newer build'), 'a save from a newer build is refused clearly', refused || 'it was accepted');

// And so must a version with no migration to reach the present.
const ancient = JSON.parse(JSON.stringify(serialize(g))) as SaveData;
ancient.version = 1;
let ancientErr = '';
try { deserialize(ancient); } catch (e) { ancientErr = String(e); }
check(ancientErr.includes('version 1'), 'an unreadably old save is refused', ancientErr || 'it was accepted');

// Adding a field must not need a migration: a key the loader knows about but
// the payload lacks has to fall back to the class default.
const missingKey = JSON.parse(JSON.stringify(serialize(g))) as SaveData;
for (const b of missingKey.buildings) delete (b as Record<string, unknown>).rotationFactor;
const patched = deserialize(missingKey);
const defaults = [...patched.buildings.values()].every((b) => b.rotationFactor === 1);
check(defaults, 'a field absent from an older payload keeps its class default');

process.exit(failed === 0 ? 0 : 1);
