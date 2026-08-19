/**
 * Turns `assets/nature_set.obj` + `.mtl` into `src/render/nature-data.ts`.
 *
 * The source is a staged specimen sheet, not a set of loose props: a grid of
 * ten trees in the north, a plot of buildings in the middle, and bays of rock,
 * ore and mineral samples in the south. This tool segments that scene back
 * into individual props, decimates each one to a triangle budget the game can
 * afford to instance a few thousand times, and writes the result out as
 * quantised base64 so the game still ships as a single small bundle. The
 * heavy lifting — parsing, segmentation, decimation, encoding — lives in
 * `bake-lib.ts`, shared with the building bake.
 *
 *   npm run bake:nature            # rewrite src/render/nature-data.ts
 *   npm run bake:nature -- --list  # just print the inventory it found
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Baker, clusterXZ, encodePart, parseMtl, printInventory, type Piece } from './bake-lib';

const ROOT = resolve(import.meta.dirname, '..');
const OBJ = resolve(ROOT, 'assets/nature_set.obj');
const MTL = resolve(ROOT, 'assets/nature_set.mtl');
const OUT = resolve(ROOT, 'src/render/nature-data.ts');

const LIST_ONLY = process.argv.includes('--list');

// ---------------------------------------------------------------------------
// The recipe
// ---------------------------------------------------------------------------

/**
 * The ten tree specimens sit on a 5 x 2 grid. Eight are trees on a size ladder
 * from sapling to elder; the two at x ≈ +9.7 are felled stumps.
 */
const TREE_GRID: { at: [number, number]; name: string; budget: number }[] = [
  { at: [-9.68, -10.40], name: 'tree_sapling_a', budget: 130 },
  { at: [-4.85, -10.40], name: 'tree_young_a', budget: 190 },
  { at: [0.00, -10.40], name: 'tree_mature_a', budget: 300 },
  { at: [4.86, -10.41], name: 'tree_elder_a', budget: 400 },
  { at: [9.71, -10.39], name: 'stump_a', budget: 90 },
  { at: [-9.68, -4.98], name: 'tree_sapling_b', budget: 130 },
  { at: [-4.84, -4.98], name: 'tree_young_b', budget: 190 },
  { at: [-0.01, -4.99], name: 'tree_mature_b', budget: 300 },
  { at: [4.85, -4.97], name: 'tree_elder_b', budget: 400 },
  { at: [9.67, -4.99], name: 'stump_b', budget: 90 },
];

/** Per-material rules for the mineral bays in the south of the sheet. */
const MINERAL_RULES: Record<string, { link: number; minSpan: number; keep: number; budget: number; prefix: string }> = {
  stone:      { link: 0.02, minSpan: 0.22, keep: 6, budget: 46, prefix: 'boulder' },
  slate:      { link: 0.75, minSpan: 0.10, keep: 2, budget: 84, prefix: 'slate' },
  sandstone:  { link: 0.28, minSpan: 0.30, keep: 4, budget: 40, prefix: 'sandstone' },
  ore_iron:   { link: 0.05, minSpan: 0.40, keep: 2, budget: 40, prefix: 'ore_iron' },
  ore_copper: { link: 0.65, minSpan: 0.10, keep: 2, budget: 84, prefix: 'ore_copper' },
  coal:       { link: 0.65, minSpan: 0.10, keep: 2, budget: 96, prefix: 'coal' },
  quartz:     { link: 0.95, minSpan: 0.10, keep: 2, budget: 72, prefix: 'quartz' },
  metal:      { link: 0.75, minSpan: 0.05, keep: 2, budget: 72, prefix: 'scrap' },
  brick:      { link: 0.85, minSpan: 0.10, keep: 2, budget: 72, prefix: 'brick' },
  pot:        { link: 0.06, minSpan: 0.04, keep: 1, budget: 14, prefix: 'pot' },
  soil:       { link: 0.06, minSpan: 0.20, keep: 1, budget: 28, prefix: 'soil_pad' },
};

/** Small stone chips, reused as ground scatter rather than as resource nodes. */
const PEBBLE_KEEP = 3;

const baker = new Baker();

function build(): void {
  const pieces = new Map<string, Piece[]>();
  for (const c of baker.chunks) {
    const list = pieces.get(c.object) ?? [];
    list.push(...baker.components(c));
    pieces.set(c.object, list);
  }

  // --- trees and stumps -----------------------------------------------------
  const canopy = ['timber_frame', 'leaf_a', 'leaf_b'].flatMap((o) => pieces.get(o) ?? []);
  const claimed = new Set<Piece>();
  for (const spec of TREE_GRID) {
    const mine: Piece[] = [];
    for (const p of canopy) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < TREE_GRID.length; i++) {
        const dx = p.cx - TREE_GRID[i].at[0], dz = p.cz - TREE_GRID[i].at[1];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      if (bd > 2.4 * 2.4) continue;
      if (TREE_GRID[best] !== spec) continue;
      mine.push(p);
      claimed.add(p);
    }
    // The stumps' pale cut face is a fence_wood disc sitting on the same spot.
    if (spec.name.startsWith('stump')) {
      for (const p of pieces.get('fence') ?? []) {
        const dx = p.cx - spec.at[0], dz = p.cz - spec.at[1];
        if (dx * dx + dz * dz < 0.5 * 0.5) mine.push(p);
      }
    }
    baker.addProp(spec.name, mine, spec.budget);
  }

  // --- shrubs ---------------------------------------------------------------
  // Whatever foliage was not part of a specimen tree is hedging and undergrowth
  // planted around the buildings; each clump becomes a bush.
  const loose = ['leaf_a', 'leaf_b'].flatMap((o) => pieces.get(o) ?? []).filter((p) => !claimed.has(p) && p.cz > -2.5);
  const bushes = clusterXZ(loose, 0.5)
    .map((g) => ({ g, h: Math.max(...g.map((p) => p.max[1])) - Math.min(...g.map((p) => p.min[1])) }))
    .filter(({ g, h }) => g.length >= 3 && h > 0.16 && h < 1.5)
    .sort((a, b) => b.g.length - a.g.length);
  const picks = [0, 1, 2, 3].map((i) => bushes[Math.floor((i * bushes.length) / 4)]).filter(Boolean);
  picks.forEach(({ g }, i) => baker.addProp(`bush_${'abcd'[i]}`, g, 44));

  // --- minerals -------------------------------------------------------------
  for (const [object, rule] of Object.entries(MINERAL_RULES)) {
    const groups = clusterXZ(pieces.get(object) ?? [], rule.link)
      .map((g) => ({ g, span: Math.max(...g.map((p) => p.span)) }))
      .filter(({ span }) => span >= rule.minSpan)
      .sort((a, b) => b.span - a.span)
      .slice(0, rule.keep);
    groups.forEach(({ g }, i) => baker.addProp(
      groups.length > 1 ? `${rule.prefix}_${'abcdef'[i]}` : rule.prefix, g, rule.budget,
    ));
  }

  // --- pebbles --------------------------------------------------------------
  const chips = (pieces.get('stone') ?? []).filter((p) => p.span < 0.2).sort((a, b) => b.span - a.span);
  chips.slice(0, PEBBLE_KEEP).forEach((p, i) => baker.addProp(`pebble_${'abc'[i]}`, [p], 12));
}

// ---------------------------------------------------------------------------

baker.parseObj(readFileSync(OBJ, 'utf8'));
const materials = parseMtl(readFileSync(MTL, 'utf8'));
build();

printInventory(baker.props, materials.length);

if (LIST_ONLY) process.exit(0);

const props = baker.props;
const f = (n: number) => Number(n.toFixed(4));
const out = `/**
 * GENERATED by \`npm run bake:nature\` from assets/nature_set.obj — do not edit.
 *
 * Positions are quantised into an Int16 over each part's own bounding box and
 * base64'd; \`src/render/nature.ts\` unpacks them into BufferGeometry. Props are
 * normalised to unit height and sat on the origin, so the renderer scales by
 * the height it wants.
 */

export interface NaturePartData {
  /** Material name, keyed into \`NATURE_MATERIALS\`. */
  m: string;
  /** Dequantisation offset and step, per axis. */
  o: [number, number, number];
  s: [number, number, number];
  /** base64 Int16Array positions and Uint16Array indices. */
  p: string;
  i: string;
}

export interface NaturePropData {
  parts: NaturePartData[];
  /** Width, height and depth in tiles once scaled to unit height. */
  size: [number, number, number];
}

export interface NatureMaterialData {
  /** Diffuse colour, linear-sRGB, straight off the MTL. */
  kd: [number, number, number];
  ks: [number, number, number];
  ns: number;
  d: number;
}

export const NATURE_MATERIALS: Record<string, NatureMaterialData> = {
${materials.map((m) => `  ${m.name}: { kd: [${m.kd.join(', ')}], ks: [${m.ks.join(', ')}], ns: ${m.ns}, d: ${m.d} },`).join('\n')}
};

export type NatureMaterialName = keyof typeof NATURE_MATERIALS;

export const NATURE_PROPS: Record<string, NaturePropData> = {
${props.map((p) => `  ${p.name}: {
    size: [${p.size.map(f).join(', ')}],
    parts: [
${p.parts.map((x) => `      ${encodePart(x)},`).join('\n')}
    ],
  },`).join('\n')}
};

export type NaturePropName = keyof typeof NATURE_PROPS;
`;

writeFileSync(OUT, out);
console.log(`\nwrote ${OUT} (${(out.length / 1024).toFixed(1)} KB)`);
