/**
 * Households. A family is the unit that occupies a home, has a surname, raises
 * children and can be traced across generations — the Manor Lords idea that a
 * settlement is a set of families rather than a pile of interchangeable workers.
 */

import type { Codecs, Descriptor } from './persist';

/** The one surname pool. Villagers take their family's name, never their own. */
export const SURNAMES = [
  'Ashdown', 'Barleycorn', 'Cobb', 'Dunmore', 'Ellersby', 'Fallow', 'Greenhollow', 'Hearth',
  'Ingle', 'Juniper', 'Kilnwright', 'Longmead', 'Millbrook', 'Northgate', 'Oakhanger',
  'Pennyfeather', 'Quarrell', 'Rushmere', 'Stonely', 'Thatcher', 'Underhill', 'Vale',
  'Wickstead', 'Yewbank', 'Marlowe', 'Brackenbury', 'Combe', 'Draycott', 'Fernhill', 'Harrowgate',
];

let nextFamilyId = 1;
export function resetFamilyIds(): void { nextFamilyId = 1; }
export function setNextFamilyId(n: number): void { nextFamilyId = n; }
export function peekNextFamilyId(): number { return nextFamilyId; }

export class Family {
  readonly id: number;
  surname: string;
  /** Home this family occupies, or -1 while they are looking for a roof. */
  homeId = -1;
  /** Villager ids belonging to this family. */
  memberIds: number[] = [];
  /** Day the family was founded, for the chronicle. */
  founded = 0;
  /** Children born into this family over its lifetime. */
  childrenBorn = 0;

  constructor(surname: string, founded: number, id?: number) {
    this.id = id ?? nextFamilyId++;
    if (id !== undefined && id >= nextFamilyId) nextFamilyId = id + 1;
    this.surname = surname;
    this.founded = founded;
  }

  get size(): number { return this.memberIds.length; }
}

/** See `./persist`. Adding a field to Family without classifying it fails the build. */
export const FAMILY_PERSIST = {
  id: 'ctor', surname: 'ctor', founded: 'ctor',
  size: 'derived',
  homeId: 'save', memberIds: 'save', childrenBorn: 'save',
} satisfies Descriptor<Family>;

export const FAMILY_CODECS: Codecs<Family> = {};
