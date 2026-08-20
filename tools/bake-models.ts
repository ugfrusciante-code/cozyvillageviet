/**
 * Turns the authored building set pieces in `assets/` into
 * `src/render/models-data.ts`.
 *
 * Each OBJ is one dressed set piece — the building itself plus its yard:
 * fences, planting, a cobbled pad — authored at roughly one unit per tile and
 * sharing the nature set's material language. Unlike the nature sheet there is
 * nothing to segment: the whole file becomes a single prop, decimated to a
 * budget a village of unique buildings can afford, with every window kept so
 * the panes can light up after dark.
 *
 * The windmill is the one exception: its sail cross is split out into a second
 * prop pivoted on the hub, so the renderer can spin it. The hub position and
 * the sails' scale relative to the tower ride along as constants.
 *
 *   npm run bake:models            # rewrite src/render/models-data.ts
 *   npm run bake:models -- --list  # just print the inventory
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Baker, encodePart, parseMtl, printInventory,
  type Material, type Piece, type Prop,
} from './bake-lib';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'src/render/models-data.ts');

const LIST_ONLY = process.argv.includes('--list');

// ---------------------------------------------------------------------------
// The recipe
// ---------------------------------------------------------------------------

/**
 * One entry per set piece. `name` is what the renderer asks for; the sim's
 * building ids map onto these in `entities.ts`. The villagers sheet is not
 * baked yet — swapping it in means retiring the instanced walk cycle, which is
 * its own piece of work.
 */
const MODELS: { file: string; name: string; budget: number }[] = [
  { file: 'cottage_housing (1)', name: 'cottage', budget: 1600 },
  { file: 'longhouse_housing (1)', name: 'longhouse', budget: 1600 },
  { file: 'granary_storage', name: 'granary', budget: 1600 },
  { file: 'forge_crafting', name: 'forge', budget: 1600 },
  { file: 'woodcutters_camp', name: 'woodcutter', budget: 1600 },
  { file: 'windmill_production', name: 'mill', budget: 1200 },
];

/**
 * Detail materials get the reserved budget slice: a proportional share would
 * starve them to slivers, and they are exactly what sells each building — a
 * thatch lean-to is the roof of the building it is on, and the smithy's
 * ironmongery (chains, anvil, racks) is the forge's whole signature.
 */
const detail = (m: string) => m === 'thatch_straw' || m === 'iron_dark';

/**
 * Kept whole, outside the budget. Terracotta roofs are authored as hundreds of
 * individual tiles over a pale attic prism — there is no good subset of tiles.
 * Windows are a few dozen triangles a building, and every pane must survive to
 * glow at night.
 */
const keepWhole = (m: string) =>
  m === 'roof_terracotta' || m === 'window_frame' || m === 'window_pane';

/**
 * The sail cross hangs off the tower's +x face, well above the yard: past
 * x ≈ 0.75, above the gallery, and built only from stocks, lattice, cloth and
 * ironmongery. The material list matters — the cap's shingles and the yard's
 * cobbles also stray past that plane, but never in these materials at that
 * height.
 */
const SAIL_X = 0.75;
const SAIL_Y = 1.5;
const SAIL_MATERIALS = new Set(['timber_dark', 'timber_frame', 'fence_wood', 'plaster_linen', 'iron_dark']);
const isSail = (p: Piece) => p.min[0] > SAIL_X && p.min[1] > SAIL_Y && SAIL_MATERIALS.has(p.material);
const SAILS_BUDGET = 260;

// ---------------------------------------------------------------------------

const props: Prop[] = [];
const materials = new Map<string, Material>();
let millHub: [number, number, number] | null = null;
let millSailsScale = 0;

for (const spec of MODELS) {
  const baker = new Baker();
  baker.parseObj(readFileSync(resolve(ROOT, `assets/${spec.file}.obj`), 'utf8'));

  // Merge this file's MTL into the shared material table; the set pieces all
  // come off the same palette, so a name that differs in value is an authoring
  // mistake worth failing loudly on.
  for (const m of parseMtl(readFileSync(resolve(ROOT, `assets/${spec.file}.mtl`), 'utf8'))) {
    const seen = materials.get(m.name);
    if (seen && JSON.stringify(seen) !== JSON.stringify(m)) {
      throw new Error(`material ${m.name} differs between MTL files`);
    }
    materials.set(m.name, m);
  }

  const pieces = baker.chunks.flatMap((c) => baker.components(c));

  if (spec.name !== 'mill') {
    baker.addProp(spec.name, pieces, spec.budget, { structural: detail, keepAll: keepWhole, grow: false });
    props.push(...baker.props);
    continue;
  }

  // --- the windmill: tower and sails part ways at the hub ------------------
  const sails = pieces.filter(isSail);
  const tower = pieces.filter((p) => !isSail(p));
  console.log(`mill sails: ${sails.length} pieces (${[...new Set(sails.map((p) => p.material))].join(', ')})`);

  const towerT = baker.addProp('mill', tower, spec.budget, { structural: detail, keepAll: keepWhole, grow: false });
  const sailsT = baker.addProp('mill_sails', sails, SAILS_BUDGET, { grow: false, pivot: 'center' });
  if (!towerT || !sailsT) throw new Error('mill bake came out empty');

  // The hub, in the tower prop's normalised frame: centre of the sail
  // assembly's source bounding box, pushed through the tower's transform.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of sails) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p.min[a]);
      hi[a] = Math.max(hi[a], p.max[a]);
    }
  }
  millHub = [0, 1, 2].map((a) => ((lo[a] + hi[a]) / 2 - towerT.origin[a]) / towerT.norm) as [number, number, number];
  millSailsScale = sailsT.norm / towerT.norm;
  props.push(...baker.props);
}

printInventory(props, materials.size);
console.log(`mill hub at [${millHub!.map((v) => v.toFixed(3)).join(', ')}], sails scale ${millSailsScale.toFixed(4)}`);

if (LIST_ONLY) process.exit(0);

const f = (n: number) => Number(n.toFixed(4));
const out = `/**
 * GENERATED by \`npm run bake:models\` from the building OBJs in assets/ — do
 * not edit.
 *
 * Same format as \`nature-data.ts\`: positions quantised into an Int16 over each
 * part's own bounding box and base64'd; \`src/render/models.ts\` unpacks them.
 * Props are normalised to unit height and sat on the origin — except the
 * windmill's sails, which pivot about their hub so the renderer can spin them.
 */

export interface ModelPartData {
  /** Material name, keyed into \`MODEL_MATERIALS\`. */
  m: string;
  /** Dequantisation offset and step, per axis. */
  o: [number, number, number];
  s: [number, number, number];
  /** base64 Int16Array positions and Uint16Array indices. */
  p: string;
  i: string;
}

export interface ModelPropData {
  parts: ModelPartData[];
  /** Width, height and depth in tiles once scaled to unit height. */
  size: [number, number, number];
}

export interface ModelMaterialData {
  /** Diffuse colour, linear-sRGB, straight off the MTL. */
  kd: [number, number, number];
  ks: [number, number, number];
  ns: number;
  d: number;
}

export const MODEL_MATERIALS: Record<string, ModelMaterialData> = {
${[...materials.values()].map((m) => `  ${m.name}: { kd: [${m.kd.join(', ')}], ks: [${m.ks.join(', ')}], ns: ${m.ns}, d: ${m.d} },`).join('\n')}
};

export type ModelMaterialName = keyof typeof MODEL_MATERIALS;

export const MODEL_PROPS: Record<string, ModelPropData> = {
${props.map((p) => `  ${p.name}: {
    size: [${p.size.map(f).join(', ')}],
    parts: [
${p.parts.map((x) => `      ${encodePart(x)},`).join('\n')}
    ],
  },`).join('\n')}
};

export type ModelPropName = keyof typeof MODEL_PROPS;

/** The sail hub, in the \`mill\` prop's normalised frame. */
export const MILL_HUB: [number, number, number] = [${millHub!.map((v) => Number(v.toFixed(4))).join(', ')}];

/** Scale for \`mill_sails\` meshes, relative to the scale used for \`mill\`. */
export const MILL_SAILS_SCALE = ${Number(millSailsScale.toFixed(4))};
`;

writeFileSync(OUT, out);
console.log(`\nwrote ${OUT} (${(out.length / 1024).toFixed(1)} KB)`);
