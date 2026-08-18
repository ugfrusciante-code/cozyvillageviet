/**
 * How saving decides what to save.
 *
 * Every persistable class declares a descriptor next to its fields saying what
 * each one is: written to disk, rebuilt on load, or scratch. The descriptor is
 * checked with `satisfies Record<StateKeys<T>, Persist>`, which is the whole
 * point of the exercise — **adding a field without classifying it fails the
 * build.**
 *
 * That enforcement is not theoretical. The reservation ledger was silently
 * left out of the save for months because `SavedBuilding` was a hand-written
 * mirror that nothing checked against the class, and the bug it caused (goods
 * teleporting on load) took a dedicated harness to find. Five new systems are
 * about to add fields to these classes.
 *
 * The other benefit is that adding a `'save'` field needs no migration at all:
 * a key missing from an old payload simply keeps the class default.
 */

/** Fields of `T`, excluding its methods. Getters are included — they are state-shaped. */
export type StateKeys<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? never : K
}[keyof T];

export type Persist =
  /** Plain JSON: copied straight out and straight back in. */
  | 'save'
  /** Saved, but only the constructor can set it (readonly identity fields). */
  | 'ctor'
  /** Saved through a hand-written codec — Sets, tuples, anything not plain JSON. */
  | 'custom'
  /** Recomputed on load. Cheaper or safer to derive than to store. */
  | 'derived'
  /** Per-tick scratch. A fresh default is always correct. */
  | 'transient';

/** A codec for one `'custom'` field. */
export interface Codec<T> {
  get(o: T): unknown;
  set(o: T, v: unknown): void;
}

export type Descriptor<T> = Record<StateKeys<T>, Persist>;
export type Codecs<T> = Partial<Record<StateKeys<T>, Codec<T>>>;

/**
 * The one place that reads a descriptor. Kept narrow, and the only place in
 * the save layer that has to reach past the type system to index by string.
 */
type Loose = Record<string, unknown>;

export function encode<T extends object>(
  o: T, desc: Descriptor<T>, codecs: Codecs<T> = {},
): Loose {
  const out: Loose = {};
  for (const [key, mode] of Object.entries(desc) as [string, Persist][]) {
    if (mode === 'save' || mode === 'ctor') out[key] = (o as unknown as Loose)[key];
    else if (mode === 'custom') out[key] = (codecs as Loose as Record<string, Codec<T>>)[key].get(o);
  }
  return out;
}

/**
 * Apply a saved payload. `'ctor'` fields are skipped — they were consumed when
 * the object was built — and any key absent from the payload is left at the
 * class default, which is what makes additive changes migration-free.
 */
export function decode<T extends object>(
  o: T, data: Loose, desc: Descriptor<T>, codecs: Codecs<T> = {},
): void {
  for (const [key, mode] of Object.entries(desc) as [string, Persist][]) {
    if (!(key in data)) continue;
    if (mode === 'save') (o as unknown as Loose)[key] = data[key];
    else if (mode === 'custom') (codecs as Loose as Record<string, Codec<T>>)[key].set(o, data[key]);
  }
}
