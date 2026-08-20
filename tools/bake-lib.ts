/**
 * Shared machinery for baking authored OBJ/MTL sheets into the game's
 * quantised-TypeScript geometry format. `bake-nature.ts` (the nature specimen
 * sheet) and `bake-models.ts` (the building set pieces) both drive this; each
 * tool keeps its own recipe and output layout.
 *
 * The pipeline: parse the OBJ into per-object/per-material triangle chunks,
 * split those into rigid pieces by welded connectivity, pick which pieces
 * survive into the LOD, decimate each survivor to a triangle budget with
 * Rossignac-Borrel vertex clustering, then normalise the result to unit height
 * over the origin and quantise it into base64 Int16.
 */

export type Tri = [number, number, number];

export interface Chunk {
  /** Source object name in the OBJ (`leaf_a`, `stone`, …). */
  object: string;
  /** Material name from the MTL (`foliage_dark`, `stone_warm_grey`, …). */
  material: string;
  tris: Tri[];
}

export interface Material {
  name: string;
  kd: [number, number, number];
  ks: [number, number, number];
  ns: number;
  d: number;
}

export function parseMtl(text: string): Material[] {
  const out: Material[] = [];
  let cur: Material | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('newmtl ')) {
      cur = { name: line.slice(7).trim(), kd: [1, 1, 1], ks: [0, 0, 0], ns: 0, d: 1 };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('Kd ')) {
      const p = line.split(/\s+/);
      cur.kd = [+p[1], +p[2], +p[3]];
    } else if (line.startsWith('Ks ')) {
      const p = line.split(/\s+/);
      cur.ks = [+p[1], +p[2], +p[3]];
    } else if (line.startsWith('Ns ')) {
      cur.ns = +line.split(/\s+/)[1];
    } else if (line.startsWith('d ')) {
      cur.d = +line.split(/\s+/)[1];
    }
  }
  return out;
}

/** One rigid piece of the scene: a single blob, trunk, boulder or slab. */
export interface Piece {
  object: string;
  material: string;
  tris: Tri[];
  /** Centre of the bounding box. */
  cx: number; cy: number; cz: number;
  min: [number, number, number];
  max: [number, number, number];
  /** Longest bounding-box edge — a decent stand-in for "how big is this". */
  span: number;
}

export interface Part {
  material: string;
  /** Flat xyz triples. */
  verts: number[];
  index: number[];
}

export interface Prop {
  name: string;
  parts: Part[];
  /** Bounding size in source units, after the prop is sat on the origin. */
  size: [number, number, number];
  tris: number;
}

/**
 * How a prop is placed over the origin. `base` (the default) centres it on the
 * footprint of its lowest slice and drops it onto y = 0 — right for anything
 * that stands on the ground. `center` pivots it about its bounding-box centre
 * on every axis — right for parts that rotate about themselves, like a
 * windmill's sail cross.
 */
export interface PropOptions {
  /** Which materials get the reserved structural slice of the budget. */
  structural?: (material: string) => boolean;
  /**
   * Materials kept whole, outside the budget — every piece, welded but not
   * decimated. For a roof authored as hundreds of individual tiles there is no
   * good subset: the tiles are the surface, and culling any exposes whatever
   * the artist hid underneath.
   */
  keepAll?: (material: string) => boolean;
  /** Grow surviving pieces to cover the ones dropped (canopies want this). */
  grow?: boolean;
  pivot?: 'base' | 'center';
}

/** Where a prop's source coordinates ended up: `normalised = (src - origin) / norm`. */
export interface PropTransform {
  origin: [number, number, number];
  norm: number;
}

export class Baker {
  /** Vertex positions, shared by every chunk; triangles index into this. */
  readonly pos: number[] = [];
  readonly chunks: Chunk[] = [];
  readonly props: Prop[] = [];

  // ------------------------------------------------------------------ parse

  parseObj(text: string): void {
    let object = '';
    let material = '';
    let cur: Chunk | null = null;
    const push = () => {
      if (!cur || !cur.tris.length) return;
      this.chunks.push(cur);
      cur = null;
    };
    for (const raw of text.split('\n')) {
      if (raw.startsWith('v ')) {
        const p = raw.split(/\s+/);
        this.pos.push(+p[1], +p[2], +p[3]);
      } else if (raw.startsWith('o ')) {
        push();
        object = raw.slice(2).trim();
      } else if (raw.startsWith('usemtl ')) {
        push();
        material = raw.slice(7).trim();
      } else if (raw.startsWith('f ')) {
        if (!cur) cur = { object, material, tris: [] };
        const p = raw.split(/\s+/);
        const idx: number[] = [];
        for (let i = 1; i < p.length; i++) {
          if (!p[i]) continue;
          let n = parseInt(p[i], 10);
          idx.push(n < 0 ? this.pos.length / 3 + n : n - 1);
        }
        // Fan-triangulate; the export is already triangles but this costs nothing.
        for (let i = 1; i < idx.length - 1; i++) cur.tris.push([idx[0], idx[i], idx[i + 1]]);
      }
    }
    push();
  }

  bounds(tris: Tri[]): { min: [number, number, number]; max: [number, number, number] } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) {
      for (const v of t) {
        for (let a = 0; a < 3; a++) {
          const c = this.pos[v * 3 + a];
          if (c < min[a]) min[a] = c;
          if (c > max[a]) max[a] = c;
        }
      }
    }
    return { min, max };
  }

  makePiece(object: string, material: string, tris: Tri[]): Piece {
    const { min, max } = this.bounds(tris);
    return {
      object, material, tris, min, max,
      cx: (min[0] + max[0]) / 2, cy: (min[1] + max[1]) / 2, cz: (min[2] + max[2]) / 2,
      span: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
    };
  }

  // --------------------------------------------------- connected components

  /**
   * Splits a chunk into rigid pieces. Triangles are welded by rounded position
   * first — the exporter writes flat-shaded soup, so faces of the same blob only
   * meet at coincident coordinates, never at shared indices.
   */
  components(chunk: Chunk): Piece[] {
    const pos = this.pos;
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r)!;
      while (parent.get(a) !== r) { const n = parent.get(a)!; parent.set(a, r); a = n; }
      return r;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const t of chunk.tris) for (const v of t) if (!parent.has(v)) parent.set(v, v);

    const weld = new Map<string, number>();
    for (const t of chunk.tris) {
      for (const v of t) {
        const key = `${pos[v * 3].toFixed(4)},${pos[v * 3 + 1].toFixed(4)},${pos[v * 3 + 2].toFixed(4)}`;
        const seen = weld.get(key);
        if (seen === undefined) weld.set(key, v); else union(v, seen);
      }
    }
    for (const t of chunk.tris) { union(t[0], t[1]); union(t[1], t[2]); }

    const groups = new Map<number, Tri[]>();
    for (const t of chunk.tris) {
      const r = find(t[0]);
      const g = groups.get(r);
      if (g) g.push(t); else groups.set(r, [t]);
    }
    return [...groups.values()].map((tris) => this.makePiece(chunk.object, chunk.material, tris));
  }

  // ------------------------------------------------------------- decimation

  /**
   * Rossignac-Borrel vertex clustering: snap every vertex to a coarse grid, keep
   * one representative per occupied cell, then drop the triangles that collapse.
   * On a canopy it fuses neighbouring leaf blobs into fewer, chunkier masses; on
   * a trunk or a boulder it just removes facets. One algorithm handles the whole
   * set, and because the representative is the vertex furthest from the piece's
   * centre, silhouettes survive the cut.
   */
  cluster(tris: Tri[], divisions: number): { verts: number[]; index: number[] } {
    const pos = this.pos;
    const { min, max } = this.bounds(tris);
    const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    const cell = extent / divisions;
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;

    const cells = new Map<string, { v: number; d: number; out: number }>();
    const keyOf = (v: number) =>
      `${Math.floor((pos[v * 3] - min[0]) / cell)},${Math.floor((pos[v * 3 + 1] - min[1]) / cell)},${Math.floor((pos[v * 3 + 2] - min[2]) / cell)}`;

    for (const t of tris) {
      for (const v of t) {
        const key = keyOf(v);
        const dx = pos[v * 3] - cx, dy = pos[v * 3 + 1] - cy, dz = pos[v * 3 + 2] - cz;
        const d = dx * dx + dy * dy + dz * dz;
        const cur = cells.get(key);
        if (!cur || d > cur.d) cells.set(key, { v, d, out: cur ? cur.out : -1 });
      }
    }

    const verts: number[] = [];
    for (const c of cells.values()) {
      c.out = verts.length / 3;
      verts.push(pos[c.v * 3], pos[c.v * 3 + 1], pos[c.v * 3 + 2]);
    }

    const index: number[] = [];
    const seen = new Set<string>();
    for (const t of tris) {
      const a = cells.get(keyOf(t[0]))!.out;
      const b = cells.get(keyOf(t[1]))!.out;
      const c = cells.get(keyOf(t[2]))!.out;
      if (a === b || b === c || a === c) continue;              // collapsed
      const dedupe = [a, b, c].slice().sort((x, y) => x - y).join(',');
      if (seen.has(dedupe)) continue;                            // coincident face
      seen.add(dedupe);
      index.push(a, b, c);
    }

    // Drop vertices no surviving triangle references.
    const used = new Map<number, number>();
    const packedVerts: number[] = [];
    const packedIndex: number[] = [];
    for (const i of index) {
      let n = used.get(i);
      if (n === undefined) {
        n = packedVerts.length / 3;
        used.set(i, n);
        packedVerts.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
      }
      packedIndex.push(n);
    }
    return { verts: packedVerts, index: packedIndex };
  }

  /** Decimates to the largest mesh that still fits `budget` triangles. */
  toBudget(tris: Tri[], budget: number): { verts: number[]; index: number[] } {
    if (tris.length <= budget) {
      return this.cluster(tris, 4096);                           // welds only, no loss
    }
    let best: { verts: number[]; index: number[] } | null = null;
    let lo = 2, hi = 200;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.cluster(tris, mid);
      if (r.index.length / 3 <= budget) { best = r; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (best && best.index.length) return best;
    // Every division that fit the budget collapsed the piece entirely (thin
    // slabs and discs do this). Take the coarsest grid that still leaves faces.
    for (let d = 3; d <= 200; d++) {
      const r = this.cluster(tris, d);
      if (r.index.length) return r;
    }
    return this.cluster(tris, 4096);
  }

  // ------------------------------------------------------------------ props

  /**
   * Picks which pieces of a group survive into the LOD. Biggest first, skipping
   * anything buried inside a piece already kept — on a canopy that thins two
   * hundred leaf blobs down to the couple of dozen that actually carry the
   * silhouette.
   */
  selectPieces(pieces: Piece[], maxKeep: number): Piece[] {
    const sorted = [...pieces].sort((a, b) => b.span - a.span);
    const kept: Piece[] = [];
    const inner = 0.3;
    for (const p of sorted) {
      if (kept.length >= maxKeep) break;
      // Buried means "inside the middle of something already kept, on every
      // axis". Testing per axis rather than by radius matters for slabs: a lump
      // resting on a wide flat pad is close to its centre in x and z but well
      // clear of it in y, and must not be thrown away.
      const buried = kept.some((k) => p.span < k.span
        && Math.abs(p.cx - k.cx) < (k.max[0] - k.min[0]) * inner
        && Math.abs(p.cy - k.cy) < (k.max[1] - k.min[1]) * inner
        && Math.abs(p.cz - k.cz) < (k.max[2] - k.min[2]) * inner);
      if (!buried) kept.push(p);
    }
    // If coverage culling left room in the budget, spend it on the next biggest.
    for (const p of sorted) {
      if (kept.length >= maxKeep) break;
      if (!kept.includes(p)) kept.push(p);
    }
    return kept;
  }

  /**
   * Decimates one group and concatenates the results.
   *
   * Crucially this runs per piece, never across pieces: clustering vertices from
   * two different leaf blobs into one cell webs them together into flat sheets,
   * which is what a canopy must not look like. With `grow` on, survivors are
   * grown a little about their own centres to fill the space the dropped blobs
   * left — right for foliage, wrong for walls.
   */
  reduceGroup(pieces: Piece[], budget: number, grow = true): { verts: number[]; index: number[] } {
    const kept = this.selectPieces(pieces, Math.max(1, Math.floor(budget / 12)));
    const keptTris = kept.reduce((s, p) => s + p.tris.length, 0);
    const total = pieces.reduce((s, p) => s + p.tris.length, 0);
    const growBy = grow ? Math.min(1.42, 1 + 0.38 * (1 - keptTris / total)) : 1;

    const verts: number[] = [];
    const index: number[] = [];
    for (const p of kept) {
      // Budget left, spread over the pieces still to come. Decimation rounds up
      // as often as down, so the running total is what enforces the cap.
      const left = budget - index.length / 3;
      if (left < 8) break;
      const share = Math.max(10, Math.min(64, Math.round((budget * p.tris.length) / keptTris), left));
      const r = this.toBudget(p.tris, share);
      if (!r.index.length) continue;
      const base = verts.length / 3;
      for (let i = 0; i < r.verts.length; i += 3) {
        verts.push(
          p.cx + (r.verts[i] - p.cx) * growBy,
          p.cy + (r.verts[i + 1] - p.cy) * growBy,
          p.cz + (r.verts[i + 2] - p.cz) * growBy,
        );
      }
      for (const n of r.index) index.push(base + n);
    }
    return { verts, index };
  }

  /**
   * Recentres a prop over the origin, drops it onto y = 0 (or pivots it about
   * its centre), then normalises it to unit height so the renderer can ask for
   * a tree "2.4 tiles tall" without caring which specimen it drew. Returns the
   * transform it applied, so recipes can map source-space anchor points (a
   * windmill's hub, say) into the prop's normalised frame.
   */
  addProp(name: string, pieces: Piece[], budget: number, opts: PropOptions = {}): PropTransform | null {
    if (!pieces.length) return null;
    const structural = opts.structural
      ?? ((m: string) => m === 'timber_frame' || m === 'fence_wood');
    const grow = opts.grow ?? true;

    const groups = new Map<string, Piece[]>();
    for (const p of pieces) {
      const g = groups.get(p.material);
      if (g) g.push(p); else groups.set(p.material, [p]);
    }

    // Split the budget between materials. A straight share of the source
    // triangles starves the trunk — a canopy is thousands of leaf blobs against
    // a hundred triangles of timber — so the structure gets a reserved slice and
    // the foliage divides the rest. Kept-whole materials sit outside the split.
    const keepAll = opts.keepAll ?? (() => false);
    const count = (want: boolean) => [...groups].reduce(
      (s, [m, ps]) => s + (!keepAll(m) && structural(m) === want ? ps.reduce((t, p) => t + p.tris.length, 0) : 0), 0,
    );
    const sTris = count(true), oTris = count(false);
    const sFrac = oTris === 0 ? 1 : sTris === 0 ? 0 : 0.3;

    const parts: Part[] = [];
    for (const [material, ps] of groups) {
      if (keepAll(material)) {
        const verts: number[] = [];
        const index: number[] = [];
        for (const p of ps) {
          const r = this.toBudget(p.tris, p.tris.length);   // welds only
          const base = verts.length / 3;
          for (const v of r.verts) verts.push(v);
          for (const n of r.index) index.push(base + n);
        }
        if (index.length) parts.push({ material, verts, index });
        continue;
      }
      const pool = budget * (structural(material) ? sFrac : 1 - sFrac);
      const denom = structural(material) ? sTris : oTris;
      const mine = ps.reduce((s, p) => s + p.tris.length, 0);
      const share = Math.max(12, Math.round((pool * mine) / denom));
      const { verts, index } = this.reduceGroup(ps, share, grow);
      if (index.length) parts.push({ material, verts, index });
    }
    if (!parts.length) return null;

    // Bounds come off the decimated geometry, not the source, so the prop's
    // recorded size is the size that actually gets drawn.
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
      for (let i = 0; i < p.verts.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], p.verts[i + a]);
          hi[a] = Math.max(hi[a], p.verts[i + a]);
        }
      }
    }
    const height = Math.max(1e-4, hi[1] - lo[1]);
    // Props are normalised to unit height, but a pad or a slab is essentially
    // flat and dividing by its thickness sends its footprint to infinity. Below
    // an eighth of its own width, a prop normalises against its width instead.
    const flat = Math.max(hi[0] - lo[0], hi[2] - lo[2]);
    const norm = Math.max(height, flat * 0.12);

    // Centre on the footprint of the lowest slice, so a leaning tree still
    // stands on its trunk rather than on the middle of its canopy.
    let ox: number, oy: number, oz: number;
    if (opts.pivot === 'center') {
      ox = (lo[0] + hi[0]) / 2; oy = (lo[1] + hi[1]) / 2; oz = (lo[2] + hi[2]) / 2;
    } else {
      const cut = lo[1] + height * 0.18;
      let sx = 0, sz = 0, n = 0;
      for (const p of parts) {
        for (let i = 0; i < p.verts.length; i += 3) {
          if (p.verts[i + 1] > cut) continue;
          sx += p.verts[i]; sz += p.verts[i + 2]; n++;
        }
      }
      ox = n ? sx / n : (lo[0] + hi[0]) / 2;
      oy = lo[1];
      oz = n ? sz / n : (lo[2] + hi[2]) / 2;
    }
    const inv = 1 / norm;

    for (const p of parts) {
      for (let i = 0; i < p.verts.length; i += 3) {
        p.verts[i] = (p.verts[i] - ox) * inv;
        p.verts[i + 1] = (p.verts[i + 1] - oy) * inv;
        p.verts[i + 2] = (p.verts[i + 2] - oz) * inv;
      }
    }

    this.props.push({
      name, parts,
      size: [(hi[0] - lo[0]) * inv, height * inv, (hi[2] - lo[2]) * inv],
      tris: parts.reduce((s, p) => s + p.index.length / 3, 0),
    });
    return { origin: [ox, oy, oz], norm };
  }
}

/** Single-link clustering of pieces on the ground plane. */
export function clusterXZ(pieces: Piece[], link: number): Piece[][] {
  const parent = pieces.map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const dx = pieces[i].cx - pieces[j].cx, dz = pieces[i].cz - pieces[j].cz;
      if (dx * dx + dz * dz <= link * link) {
        const ra = find(i), rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const out = new Map<number, Piece[]>();
  for (let i = 0; i < pieces.length; i++) {
    const r = find(i);
    const g = out.get(r);
    if (g) g.push(pieces[i]); else out.set(r, [pieces[i]]);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- encoding

export function b64(buf: ArrayBufferView): string {
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('base64');
}

/** Positions ride in an Int16 over the prop's own bounding box. */
export function encodePart(part: Part): string {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < part.verts.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], part.verts[i + a]);
      hi[a] = Math.max(hi[a], part.verts[i + a]);
    }
  }
  const scale = [0, 1, 2].map((a) => Math.max(1e-6, (hi[a] - lo[a]) / 65534));
  const q = new Int16Array(part.verts.length);
  for (let i = 0; i < part.verts.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      q[i + a] = Math.max(-32767, Math.min(32767, Math.round((part.verts[i + a] - lo[a]) / scale[a] - 32767)));
    }
  }
  const idx = new Uint16Array(part.index);
  const f = (n: number) => Number(n.toFixed(6));
  return `{ m: '${part.material}', o: [${lo.map(f).join(', ')}], s: [${scale.map((v) => v.toExponential(8)).join(', ')}], p: '${b64(q)}', i: '${b64(idx)}' }`;
}

/** Prints the inventory a bake produced, one aligned line per prop. */
export function printInventory(props: Prop[], materialCount: number): void {
  const width = Math.max(...props.map((p) => p.name.length));
  for (const p of props) {
    const parts = p.parts.map((x) => `${x.material}:${x.index.length / 3}`).join(' ');
    console.log(
      `${p.name.padEnd(width)}  ${String(p.tris).padStart(4)} tris  ` +
      `${p.size.map((v) => v.toFixed(2)).join(' x ')}  ${parts}`,
    );
  }
  console.log(`\n${props.length} props, ${props.reduce((s, p) => s + p.tris, 0)} triangles, ${materialCount} materials`);
}
