/**
 * Static game data: resources, needs, and the building catalogue.
 * Pure data + pure functions only — this module must never import the renderer.
 */

export type ResId =
  | 'logs' | 'planks' | 'stone' | 'clay' | 'bricks' | 'iron_ore' | 'iron' | 'tools' | 'firewood'
  | 'grain' | 'flour' | 'bread' | 'berries' | 'fish' | 'meat' | 'honey' | 'herbs' | 'eggs'
  | 'beans' | 'turnips'
  | 'hide' | 'leather' | 'shoes' | 'wool' | 'cloth' | 'clothes'
  | 'ale' | 'pottery' | 'candles' | 'medicine';

export type ResCat = 'material' | 'food' | 'fuel' | 'clothing' | 'good';

export interface ResourceDef {
  id: ResId;
  name: string;
  icon: string;
  cat: ResCat;
  /** Reference coin value. Trade prices drift around this. */
  price: number;
  /** Counts toward the "food variety" that houses demand. */
  food?: boolean;
  /** Counts toward the "clothing variety" that houses demand. */
  clothing?: boolean;
  /** Burned for warmth. */
  fuel?: boolean;
  /** Comfort goods: raise contentment in tier 2+ homes. */
  luxury?: boolean;
  /**
   * How fast this rots when stored. Fraction lost per day in ordinary
   * storage; a granary keeps most of it (see BuildingDef.preserves).
   * Absent = does not spoil.
   */
  spoil?: number;
}

const R = (
  id: ResId, name: string, icon: string, cat: ResCat, price: number,
  extra: Partial<ResourceDef> = {},
): ResourceDef => ({ id, name, icon, cat, price, ...extra });

export const RESOURCES: Record<ResId, ResourceDef> = Object.fromEntries(
  [
    R('logs', 'Logs', '🪵', 'material', 3),
    R('planks', 'Planks', '📏', 'material', 8),
    R('stone', 'Stone', '🪨', 'material', 4),
    R('clay', 'Clay', '🟤', 'material', 3),
    R('bricks', 'Bricks', '🧱', 'material', 10),
    R('iron_ore', 'Iron Ore', '⛏️', 'material', 6),
    R('iron', 'Iron', '⚙️', 'material', 14),
    R('tools', 'Tools', '🔨', 'material', 30),
    R('firewood', 'Firewood', '🔥', 'fuel', 5, { fuel: true }),

    R('grain', 'Grain', '🌾', 'material', 6),
    R('flour', 'Flour', '🥣', 'material', 10),
    R('bread', 'Bread', '🍞', 'food', 16, { food: true, spoil: 0.012 }),
    R('berries', 'Berries', '🫐', 'food', 5, { food: true, spoil: 0.03 }),
    R('fish', 'Fish', '🐟', 'food', 8, { food: true, spoil: 0.03 }),
    R('meat', 'Meat', '🍖', 'food', 12, { food: true, spoil: 0.025 }),
    R('eggs', 'Eggs', '🥚', 'food', 7, { food: true, spoil: 0.02 }),
    R('honey', 'Honey', '🍯', 'food', 14, { food: true }),
    R('beans', 'Beans', '🫘', 'food', 9, { food: true, spoil: 0.006 }),
    R('turnips', 'Turnips', '🥕', 'food', 6, { food: true, spoil: 0.008 }),
    R('herbs', 'Herbs', '🌿', 'material', 7),

    R('hide', 'Hides', '🟫', 'material', 9),
    R('leather', 'Leather', '🎽', 'material', 18),
    R('shoes', 'Shoes', '👞', 'clothing', 34, { clothing: true }),
    R('wool', 'Wool', '🐑', 'material', 8),
    R('cloth', 'Cloth', '🧵', 'material', 18),
    R('clothes', 'Clothes', '🧥', 'clothing', 36, { clothing: true }),

    R('ale', 'Ale', '🍺', 'good', 20, { luxury: true }),
    R('pottery', 'Pottery', '🏺', 'good', 22, { luxury: true }),
    R('candles', 'Candles', '🕯️', 'good', 24, { luxury: true }),
    R('medicine', 'Medicine', '💊', 'good', 40, { luxury: true }),
  ].map((r) => [r.id, r]),
) as Record<ResId, ResourceDef>;

export const ALL_RES = Object.keys(RESOURCES) as ResId[];
export const FOOD_TYPES = ALL_RES.filter((r) => RESOURCES[r].food);
export const CLOTHING_TYPES = ALL_RES.filter((r) => RESOURCES[r].clothing);
export const LUXURY_TYPES = ALL_RES.filter((r) => RESOURCES[r].luxury);

export type Amounts = Partial<Record<ResId, number>>;

// ---------------------------------------------------------------------------
// World resource nodes
// ---------------------------------------------------------------------------

export type NodeKind = 'tree' | 'berry' | 'herb' | 'stone' | 'clay' | 'iron' | 'game' | 'fish' | 'flower';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export type BuildCat = 'housing' | 'gathering' | 'farming' | 'crafting' | 'civic' | 'logistics' | 'decor';

export interface Recipe {
  in: Amounts;
  out: Amounts;
  /** Worker-seconds of labour for one batch at skill 1.0. */
  work: number;
  /** If set, the workshop only runs during these seasons. */
  seasons?: Season[];
}

export interface Harvest {
  kind: NodeKind;
  out: ResId;
  /** Units produced per node consumed. */
  yield: number;
  /** Worker-seconds to work one node. */
  work: number;
  /** Tiles searched around the building. */
  radius: number;
  /** Node regrows after this many days (undefined = finite deposit). */
  regrow?: number;
  seasons?: Season[];
  /** Secondary output per node, e.g. hides from a deer. */
  extra?: Amounts;
}

/** Forester behaviour: replants depleted tree tiles. */
export interface Plants {
  radius: number;
  work: number;
  seasons?: Season[];
}

/**
 * Drag-to-size zone buildings (fields, pastures, orchards). The player draws
 * the rectangle; jobs, yield and work all scale with the area.
 */
export interface Zone {
  minSide: number;
  maxSide: number;
}

/**
 * What a field is sown with. Rotating between them year to year is rewarded:
 * repeating the same crop tires the soil and costs yield, while legumes put
 * goodness back into the ground.
 */
export type CropType = 'wheat' | 'beans' | 'turnips';

export interface CropVariety {
  id: CropType;
  name: string;
  icon: string;
  out: ResId;
  /** Units per tile at full growth on perfect soil. */
  yieldPerTile: number;
  /** Multiplier on the soil cost of a harvest. Negative puts fertility back. */
  soilDrain: number;
  sowWork: number;
  tendWork: number;
  harvestWork: number;
  blurb: string;
}

export const CROPS: Record<CropType, CropVariety> = {
  wheat: {
    id: 'wheat', name: 'Wheat', icon: '🌾', out: 'grain',
    yieldPerTile: 1.35, soilDrain: 1, sowWork: 2.2, tendWork: 4.2, harvestWork: 1.6,
    blurb: 'The bread crop. Best yield, hardest on the soil.',
  },
  beans: {
    id: 'beans', name: 'Beans', icon: '🫘', out: 'beans',
    yieldPerTile: 0.95, soilDrain: -0.7, sowWork: 2.0, tendWork: 3.6, harvestWork: 1.5,
    blurb: 'A legume: feeds the village and feeds the field, restoring fertility.',
  },
  turnips: {
    id: 'turnips', name: 'Turnips', icon: '🥕', out: 'turnips',
    yieldPerTile: 1.6, soilDrain: 0.45, sowWork: 1.8, tendWork: 3.2, harvestWork: 1.9,
    blurb: 'Heavy, cheap bulk food. Kind to the soil, but nobody is thrilled by it.',
  },
};

export const CROP_ORDER: CropType[] = ['wheat', 'beans', 'turnips'];

/** Yield multiplier for sowing something different from last year. */
export const ROTATION_BONUS = 1.25;
/** Yield multiplier for sowing the same crop twice running. */
export const MONOCULTURE_PENALTY = 0.78;

/**
 * Marks a zone building as arable. The numbers that drive sowing, growth and
 * harvest all come from `CROPS[building.cropType]` — this is only the flag that
 * says "this plot lives the farming year".
 */
export interface Farmable {
  /** Present for documentation; all real values live in CROPS. */
  arable: true;
}

export type ServiceKind = 'water' | 'faith' | 'leisure' | 'health' | 'market' | 'learning';

/** Every service kind, in the order homes are scored on them. */
export const SERVICE_KINDS: ServiceKind[] = ['water', 'faith', 'leisure', 'health', 'market', 'learning'];

export interface Service {
  kind: ServiceKind;
  radius: number;
  /** Service is only "live" while the building holds one of these. */
  consumes?: ResId[];
  /** Units consumed per villager served per day. */
  rate?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  cat: BuildCat;
  icon: string;
  desc: string;
  /** Footprint in tiles. */
  size: [number, number];
  cost: Amounts;
  /** Labour (worker-seconds) to raise the frame once materials are on site. */
  buildWork: number;
  jobs: number;
  recipe?: Recipe;
  harvest?: Harvest;
  plants?: Plants;
  zone?: Zone;
  crop?: Farmable;
  service?: Service;
  /** Storage capacity contributed to the village stockpile. */
  storage?: number;
  /** Only these resources may be stored here (granary vs storehouse). */
  storeOnly?: ResCat[];
  /**
   * Multiplier on food spoilage for goods stored here. The granary's whole
   * reason to exist beyond raw capacity: 0.15 means bread rots six times
   * slower on its shelves than on a market stall.
   */
  preserves?: number;
  /** Beauty radiated to nearby homes. */
  charm?: number;
  charmRadius?: number;
  /** Coin per month to run. */
  upkeep?: number;
  /** Must already own one of these before it can be placed. */
  needs?: string[];
  /** Population gate. */
  minPop?: number;
  /** Homes provided (housing only). */
  homes?: number;
  /** Draught oxen stabled here, each of which lets a haulier pull a cart. */
  oxen?: number;
  /** Renderer hints. */
  height: number;
  palette: 'timber' | 'stone' | 'thatch' | 'brick' | 'canvas' | 'garden' | 'field';
  /** Must be placed adjacent to water. */
  nearWater?: boolean;
  /** Must be placed on fertile soil. */
  needsFertile?: boolean;
}

const B = (d: BuildingDef): BuildingDef => d;

export const BUILDINGS: BuildingDef[] = [
  // ---------------------------- Housing ----------------------------
  B({
    id: 'cottage', name: 'Cottage', cat: 'housing', icon: '🏠',
    desc: 'A family home. Keep it fed, warm and watered and it will grow into a fine house that pays real tax.',
    size: [2, 2], cost: { logs: 12, planks: 4 }, buildWork: 40, jobs: 0, homes: 1,
    height: 2.1, palette: 'timber',
  }),
  B({
    id: 'longhouse', name: 'Longhouse', cat: 'housing', icon: '🏘️',
    desc: 'Houses three families under one roof. Cheap per head, but crowded: −10% contentment.',
    size: [3, 2], cost: { logs: 24, planks: 12, stone: 8 }, buildWork: 90, jobs: 0, homes: 3,
    minPop: 20, height: 2.4, palette: 'timber',
  }),

  // ---------------------------- Gathering ----------------------------
  B({
    id: 'woodcutter', name: "Woodcutter's Camp", cat: 'gathering', icon: '🪓',
    desc: 'Fells mature trees for logs. Works any season, slower in deep winter.',
    size: [2, 2], cost: { logs: 8 }, buildWork: 25, jobs: 2,
    harvest: { kind: 'tree', out: 'logs', yield: 6, work: 14, radius: 14 },
    height: 1.8, palette: 'timber',
  }),
  B({
    id: 'forester', name: "Forester's Hut", cat: 'gathering', icon: '🌲',
    desc: 'Plants saplings in the surrounding woods so the forest never runs dry.',
    size: [2, 2], cost: { logs: 10, planks: 2 }, buildWork: 30, jobs: 1,
    plants: { radius: 16, work: 9, seasons: ['spring', 'summer', 'autumn'] },
    height: 1.9, palette: 'timber',
  }),
  B({
    id: 'forager', name: 'Forager Hut', cat: 'gathering', icon: '🧺',
    desc: 'Gathers berries from the undergrowth. Spring to autumn only.',
    size: [2, 2], cost: { logs: 8 }, buildWork: 22, jobs: 2,
    harvest: { kind: 'berry', out: 'berries', yield: 6, work: 9, radius: 14, regrow: 5, seasons: ['spring', 'summer', 'autumn'] },
    height: 1.7, palette: 'thatch',
  }),
  B({
    id: 'hunter', name: "Hunter's Lodge", cat: 'gathering', icon: '🏹',
    desc: 'Takes deer for meat and hides. Overhunt and the herds thin out.',
    size: [2, 2], cost: { logs: 12, planks: 2 }, buildWork: 32, jobs: 2,
    harvest: { kind: 'game', out: 'meat', yield: 5, work: 14, radius: 20, regrow: 8, extra: { hide: 2 } },
    height: 2.0, palette: 'timber',
  }),
  B({
    id: 'fishery', name: 'Fishing Hut', cat: 'gathering', icon: '🎣',
    desc: 'Must sit on the shore. A steady food source that never needs replanting.',
    size: [2, 2], cost: { logs: 12, planks: 4 }, buildWork: 30, jobs: 2, nearWater: true,
    harvest: { kind: 'fish', out: 'fish', yield: 6, work: 10, radius: 12, regrow: 3 },
    height: 1.8, palette: 'timber',
  }),
  B({
    id: 'herbalist', name: "Herbalist's Hut", cat: 'gathering', icon: '🌿',
    desc: 'Collects wild herbs for the brewery and the apothecary.',
    size: [2, 2], cost: { logs: 8, planks: 2 }, buildWork: 26, jobs: 1,
    harvest: { kind: 'herb', out: 'herbs', yield: 4, work: 11, radius: 14, regrow: 5, seasons: ['spring', 'summer', 'autumn'] },
    height: 1.7, palette: 'thatch',
  }),
  B({
    id: 'quarry', name: 'Quarry', cat: 'gathering', icon: '⛰️',
    desc: 'Cuts stone from an outcrop. Deposits are finite — plan your masonry.',
    size: [3, 3], cost: { logs: 14, tools: 2 }, buildWork: 55, jobs: 3,
    harvest: { kind: 'stone', out: 'stone', yield: 10, work: 20, radius: 8 },
    height: 1.4, palette: 'stone',
  }),
  B({
    id: 'claypit', name: 'Clay Pit', cat: 'gathering', icon: '🕳️',
    desc: 'Digs river clay for bricks and pottery.',
    size: [3, 3], cost: { logs: 10 }, buildWork: 40, jobs: 2,
    harvest: { kind: 'clay', out: 'clay', yield: 8, work: 15, radius: 8, regrow: 20 },
    height: 1.2, palette: 'stone',
  }),
  B({
    id: 'mine', name: 'Iron Mine', cat: 'gathering', icon: '⛏️',
    desc: 'Hard, slow work at an ore seam. The backbone of every tool you will ever own.',
    size: [3, 3], cost: { logs: 24, planks: 8, tools: 4 }, buildWork: 90, jobs: 4,
    harvest: { kind: 'iron', out: 'iron_ore', yield: 8, work: 26, radius: 7 },
    // No blacksmith prerequisite: the smith needs iron, iron needs ore, and ore
    // only comes from here. The tool cost is gate enough.
    height: 2.6, palette: 'stone',
  }),

  // ---------------------------- Farming ----------------------------
  B({
    id: 'field', name: 'Wheat Field', cat: 'farming', icon: '🌾',
    desc: 'Drag out the plot you want, from a garden patch to a great open field. Sown in spring, tended in summer, reaped in autumn. Farming the same ground year after year slowly tires the soil.',
    size: [4, 4], cost: { logs: 4 }, buildWork: 30, jobs: 3, needsFertile: true,
    zone: { minSide: 3, maxSide: 9 },
    crop: { arable: true },
    height: 0.35, palette: 'field',
  }),
  B({
    id: 'orchard', name: 'Orchard', cat: 'farming', icon: '🍎',
    desc: 'Drag out the grove. Slow to establish, then generous every summer and autumn.',
    size: [4, 4], cost: { logs: 10, planks: 2 }, buildWork: 45, jobs: 2, needsFertile: true,
    zone: { minSide: 3, maxSide: 8 },
    recipe: { in: {}, out: { berries: 12, honey: 2 }, work: 24, seasons: ['summer', 'autumn'] },
    height: 1.6, palette: 'garden',
  }),
  B({
    id: 'pasture', name: 'Sheep Pasture', cat: 'farming', icon: '🐑',
    desc: 'Drag out the paddock — more grass, more sheep, more wool. Shears all year round.',
    size: [4, 4], cost: { logs: 14, planks: 4 }, buildWork: 45, jobs: 2,
    zone: { minSide: 3, maxSide: 9 },
    recipe: { in: {}, out: { wool: 5 }, work: 20 },
    height: 0.9, palette: 'field',
  }),
  B({
    id: 'coop', name: 'Chicken Coop', cat: 'farming', icon: '🐔',
    desc: 'A backyard flock. Small, cheap, and a whole extra food type.',
    size: [2, 2], cost: { logs: 8, planks: 2 }, buildWork: 24, jobs: 1,
    recipe: { in: { grain: 1 }, out: { eggs: 6 }, work: 15 },
    height: 1.2, palette: 'timber',
  }),
  B({
    id: 'apiary', name: 'Apiary', cat: 'farming', icon: '🐝',
    desc: 'Hives for honey and beeswax. Warm months only.',
    size: [2, 2], cost: { logs: 8, planks: 4 }, buildWork: 26, jobs: 1,
    recipe: { in: {}, out: { honey: 4 }, work: 18, seasons: ['spring', 'summer', 'autumn'] },
    height: 1.1, palette: 'garden',
  }),

  // ---------------------------- Crafting ----------------------------
  B({
    id: 'sawpit', name: 'Sawpit', cat: 'crafting', icon: '🪚',
    desc: 'Logs into planks. Almost everything you build downstream wants planks.',
    size: [3, 2], cost: { logs: 14 }, buildWork: 35, jobs: 2,
    recipe: { in: { logs: 2 }, out: { planks: 3 }, work: 14 },
    height: 1.9, palette: 'timber',
  }),
  B({
    id: 'woodshed', name: 'Woodshed', cat: 'crafting', icon: '🔥',
    desc: 'Splits logs into firewood. Without one, winter kills.',
    size: [2, 2], cost: { logs: 10 }, buildWork: 26, jobs: 2,
    recipe: { in: { logs: 1 }, out: { firewood: 4 }, work: 10 },
    height: 1.7, palette: 'timber',
  }),
  B({
    id: 'kiln', name: 'Brick Kiln', cat: 'crafting', icon: '🧱',
    desc: 'Fires clay into bricks for stone-grade housing and grand civic works.',
    size: [3, 3], cost: { logs: 16, stone: 12 }, buildWork: 55, jobs: 2,
    recipe: { in: { clay: 3, firewood: 2 }, out: { bricks: 4 }, work: 22 },
    height: 2.8, palette: 'brick',
  }),
  B({
    id: 'pottery', name: 'Pottery', cat: 'crafting', icon: '🏺',
    desc: 'Turns clay into household ware. A comfort good that sells well abroad.',
    size: [3, 2], cost: { logs: 12, planks: 6, stone: 6 }, buildWork: 48, jobs: 2,
    recipe: { in: { clay: 2, firewood: 1 }, out: { pottery: 2 }, work: 20 },
    height: 2.1, palette: 'brick',
  }),
  B({
    id: 'smelter', name: 'Smelter', cat: 'crafting', icon: '🔩',
    desc: 'Ore and charcoal in, iron out. Hungry for firewood.',
    size: [3, 3], cost: { logs: 18, stone: 16 }, buildWork: 65, jobs: 2,
    recipe: { in: { iron_ore: 2, firewood: 2 }, out: { iron: 1 }, work: 24 },
    height: 3.0, palette: 'stone',
  }),
  B({
    id: 'blacksmith', name: 'Blacksmith', cat: 'crafting', icon: '🔨',
    desc: 'Forges tools. Quarries, mines and advanced workshops all need them.',
    size: [3, 2], cost: { logs: 16, planks: 8, stone: 8 }, buildWork: 60, jobs: 2,
    recipe: { in: { iron: 1, planks: 1 }, out: { tools: 2 }, work: 26 },
    height: 2.3, palette: 'stone',
  }),
  B({
    id: 'mill', name: 'Windmill', cat: 'crafting', icon: '🌬️',
    desc: 'Grinds grain into flour. Put it on high ground for the view, if nothing else.',
    size: [3, 3], cost: { logs: 20, planks: 12, stone: 8 }, buildWork: 70, jobs: 2,
    recipe: { in: { grain: 3 }, out: { flour: 3 }, work: 16 },
    height: 4.6, palette: 'timber',
  }),
  B({
    id: 'bakery', name: 'Bakery', cat: 'crafting', icon: '🍞',
    desc: 'Flour and fire into bread — the densest food in the village.',
    size: [3, 2], cost: { logs: 14, planks: 6, bricks: 6 }, buildWork: 55, jobs: 2,
    recipe: { in: { flour: 2, firewood: 1 }, out: { bread: 5 }, work: 18 },
    height: 2.2, palette: 'brick',
  }),
  B({
    id: 'brewery', name: 'Brewery', cat: 'crafting', icon: '🍺',
    desc: 'Grain and herbs into ale. The tavern cannot lift a single spirit without it.',
    size: [3, 3], cost: { logs: 18, planks: 10, stone: 6 }, buildWork: 62, jobs: 2,
    recipe: { in: { grain: 3, herbs: 1 }, out: { ale: 3 }, work: 24 },
    height: 2.4, palette: 'timber',
  }),
  B({
    id: 'weaver', name: "Weaver's Shop", cat: 'crafting', icon: '🧵',
    desc: 'Spins wool into cloth.',
    size: [3, 2], cost: { logs: 12, planks: 6 }, buildWork: 45, jobs: 2,
    recipe: { in: { wool: 2 }, out: { cloth: 2 }, work: 18 },
    height: 2.1, palette: 'timber',
  }),
  B({
    id: 'tailor', name: 'Tailor', cat: 'crafting', icon: '🧥',
    desc: 'Cloth into clothes. One of the two clothing types your homes demand.',
    size: [3, 2], cost: { logs: 12, planks: 8 }, buildWork: 48, jobs: 2,
    recipe: { in: { cloth: 2 }, out: { clothes: 2 }, work: 22 },
    height: 2.2, palette: 'timber',
  }),
  B({
    id: 'tannery', name: 'Tannery', cat: 'crafting', icon: '🟫',
    desc: 'Cures hides into leather. Nobody wants to live next door.',
    size: [3, 2], cost: { logs: 14, planks: 6, stone: 4 }, buildWork: 50, jobs: 2,
    recipe: { in: { hide: 2 }, out: { leather: 2 }, work: 20 },
    charm: -3, charmRadius: 8,
    height: 2.0, palette: 'timber',
  }),
  B({
    id: 'cobbler', name: 'Cobbler', cat: 'crafting', icon: '👞',
    desc: 'Leather into shoes — the second clothing type, and a fine export.',
    size: [3, 2], cost: { logs: 12, planks: 8 }, buildWork: 48, jobs: 2,
    recipe: { in: { leather: 1 }, out: { shoes: 1 }, work: 20 },
    height: 2.1, palette: 'timber',
  }),
  B({
    id: 'chandler', name: 'Chandlery', cat: 'crafting', icon: '🕯️',
    desc: 'Beeswax candles. Light in the long dark, and a luxury the wealthy pay for.',
    size: [2, 2], cost: { logs: 10, planks: 6 }, buildWork: 40, jobs: 1,
    recipe: { in: { honey: 2 }, out: { candles: 2 }, work: 18 },
    height: 1.9, palette: 'timber',
  }),
  B({
    id: 'apothecary', name: 'Apothecary', cat: 'crafting', icon: '💊',
    desc: 'Herbs and honey into medicine. Stock it before the first hard winter.',
    size: [3, 2], cost: { logs: 14, planks: 8, bricks: 4 }, buildWork: 55, jobs: 1,
    recipe: { in: { herbs: 2, honey: 1 }, out: { medicine: 1 }, work: 26 },
    height: 2.2, palette: 'brick',
  }),

  // ---------------------------- Civic ----------------------------
  B({
    id: 'well', name: 'Well', cat: 'civic', icon: '🪣',
    desc: 'Clean water. Every home needs one in range before it will ever upgrade.',
    size: [1, 1], cost: { stone: 8, logs: 4 }, buildWork: 20, jobs: 0,
    service: { kind: 'water', radius: 16 },
    charm: 2, charmRadius: 6, height: 1.2, palette: 'stone',
  }),
  B({
    id: 'market', name: 'Market Square', cat: 'civic', icon: '🏪',
    desc: 'Homes collect food, fuel, clothing and comforts here. Nearest homes are served first.',
    size: [4, 4], cost: { logs: 20, planks: 10 }, buildWork: 55, jobs: 2,
    service: { kind: 'market', radius: 26 },
    storage: 340, charm: 3, charmRadius: 10, height: 1.6, palette: 'canvas',
  }),
  B({
    id: 'chapel', name: 'Chapel', cat: 'civic', icon: '⛪',
    desc: 'A timber chapel. Required before any home reaches tier 2.',
    size: [3, 3], cost: { logs: 24, planks: 12, stone: 10 }, buildWork: 85, jobs: 1,
    service: { kind: 'faith', radius: 24 }, upkeep: 3,
    charm: 8, charmRadius: 14, height: 4.2, palette: 'timber',
  }),
  B({
    id: 'church', name: 'Stone Church', cat: 'civic', icon: '🏰',
    desc: 'The heart of a real town. Required for tier 3 homes.',
    size: [4, 4], cost: { stone: 60, bricks: 30, planks: 20, tools: 4 }, buildWork: 220, jobs: 2,
    service: { kind: 'faith', radius: 34 }, upkeep: 10, needs: ['chapel'], minPop: 40,
    charm: 18, charmRadius: 22, height: 7.5, palette: 'stone',
  }),
  B({
    id: 'tavern', name: 'Tavern', cat: 'civic', icon: '🍻',
    desc: 'Serves ale. No ale, no cheer — and no tier 3 homes.',
    size: [3, 3], cost: { logs: 22, planks: 14, stone: 8 }, buildWork: 80, jobs: 2,
    service: { kind: 'leisure', radius: 24, consumes: ['ale'], rate: 0.12 }, upkeep: 4,
    storage: 60, charm: 6, charmRadius: 12, height: 3.0, palette: 'timber',
  }),
  B({
    id: 'healer', name: "Healer's House", cat: 'civic', icon: '🩺',
    desc: 'Treats the sick with medicine. Cuts winter deaths sharply.',
    size: [3, 2], cost: { planks: 16, bricks: 8, logs: 8 }, buildWork: 70, jobs: 2,
    service: { kind: 'health', radius: 28, consumes: ['medicine'], rate: 0.05 }, upkeep: 5,
    storage: 40, height: 2.4, palette: 'brick',
  }),
  B({
    id: 'school', name: 'School', cat: 'civic', icon: '📚',
    desc: 'Children learn a trade. Educated villagers work noticeably faster for life.',
    size: [3, 3], cost: { planks: 24, bricks: 14, logs: 10 }, buildWork: 95, jobs: 2,
    service: { kind: 'learning', radius: 40 }, upkeep: 8, minPop: 30,
    charm: 5, charmRadius: 10, height: 3.2, palette: 'brick',
  }),
  B({
    id: 'townhall', name: 'Town Hall', cat: 'civic', icon: '🏛️',
    desc: 'Collects tax from every home each month and unlocks trade.',
    size: [4, 3], cost: { logs: 30, planks: 20, stone: 20 }, buildWork: 130, jobs: 1,
    upkeep: 4, charm: 10, charmRadius: 16, height: 4.4, palette: 'stone',
  }),

  // ---------------------------- Logistics ----------------------------
  B({
    id: 'storehouse', name: 'Storehouse', cat: 'logistics', icon: '📦',
    desc: 'General goods store. Hauliers carry everything here from the workshops.',
    size: [3, 3], cost: { logs: 16, planks: 6 }, buildWork: 45, jobs: 2,
    storage: 400, preserves: 0.5, height: 2.4, palette: 'timber',
  }),
  B({
    id: 'granary', name: 'Granary', cat: 'logistics', icon: '🌾',
    desc: 'Keeps food dry and rot-free. Food stored elsewhere spoils slowly.',
    size: [3, 3], cost: { logs: 18, planks: 10, stone: 4 }, buildWork: 55, jobs: 2,
    storage: 500, storeOnly: ['food'], preserves: 0.15, height: 2.8, palette: 'timber',
  }),
  B({
    id: 'tradepost', name: 'Trading Post', cat: 'logistics', icon: '⚖️',
    desc: 'Buy and sell with passing merchants. Prices move against you as you flood a market.',
    size: [3, 3], cost: { logs: 20, planks: 12, stone: 6 }, buildWork: 70, jobs: 2,
    storage: 200, upkeep: 4, needs: ['townhall'], height: 2.6, palette: 'canvas',
  }),
  B({
    id: 'stable', name: 'Ox Stable', cat: 'logistics', icon: '🐂',
    desc: 'Stables two draught oxen. A haulier who takes a cart carries three times as much, at a slightly slower walk. The single best cure for a village drowning in its own goods.',
    size: [3, 3], cost: { logs: 24, planks: 14, stone: 6 }, buildWork: 75, jobs: 1,
    oxen: 2, storage: 60, upkeep: 4, minPop: 16,
    height: 2.5, palette: 'timber',
  }),
  B({
    id: 'road', name: 'Road', cat: 'logistics', icon: '🛤️',
    desc: 'Villagers walk 70% faster on roads. The cheapest productivity upgrade there is.',
    size: [1, 1], cost: { stone: 1 }, buildWork: 2, jobs: 0,
    height: 0.06, palette: 'stone',
  }),

  // ---------------------------- Decor ----------------------------
  B({
    id: 'flowerbed', name: 'Flower Bed', cat: 'decor', icon: '🌷',
    desc: 'Small, cheap charm. Charm raises contentment and gates tier 3 homes.',
    size: [1, 1], cost: { logs: 2 }, buildWork: 6, jobs: 0,
    charm: 4, charmRadius: 7, height: 0.3, palette: 'garden',
  }),
  B({
    id: 'lantern', name: 'Street Lantern', cat: 'decor', icon: '🏮',
    desc: 'Warm light after dark. Charm, and a village that looks lived in.',
    size: [1, 1], cost: { logs: 2, iron: 1 }, buildWork: 8, jobs: 0,
    charm: 3, charmRadius: 8, height: 2.4, palette: 'timber',
  }),
  B({
    id: 'bench', name: 'Bench', cat: 'decor', icon: '🪑',
    desc: 'Somewhere to sit and watch the day go by.',
    size: [1, 1], cost: { planks: 2 }, buildWork: 5, jobs: 0,
    charm: 2, charmRadius: 6, height: 0.5, palette: 'timber',
  }),
  B({
    id: 'fountain', name: 'Fountain', cat: 'decor', icon: '⛲',
    desc: 'The centrepiece of a prosperous square. Also counts as a water source.',
    size: [2, 2], cost: { stone: 30, bricks: 10 }, buildWork: 60, jobs: 0,
    service: { kind: 'water', radius: 14 },
    charm: 16, charmRadius: 18, height: 1.5, palette: 'stone',
  }),
  B({
    id: 'garden', name: 'Village Garden', cat: 'decor', icon: '🌳',
    desc: 'A planted green. Wide, generous charm for a whole neighbourhood.',
    size: [3, 3], cost: { logs: 8, stone: 6 }, buildWork: 35, jobs: 0,
    charm: 10, charmRadius: 16, height: 1.4, palette: 'garden',
  }),
  B({
    id: 'monument', name: 'Great Monument', cat: 'decor', icon: '🗿',
    desc: 'A stone pillar raised to the village itself. Enormous charm, enormous cost.',
    size: [3, 3], cost: { stone: 90, bricks: 40, tools: 8 }, buildWork: 300, jobs: 0,
    needs: ['church'], minPop: 60,
    charm: 40, charmRadius: 34, height: 9.0, palette: 'stone',
  }),
];

export const BUILDING_BY_ID: Record<string, BuildingDef> = Object.fromEntries(
  BUILDINGS.map((b) => [b.id, b]),
);

export const CAT_LABEL: Record<BuildCat, string> = {
  housing: 'Homes',
  gathering: 'Gathering',
  farming: 'Farms',
  crafting: 'Workshops',
  civic: 'Civic',
  logistics: 'Logistics',
  decor: 'Beauty',
};

// ---------------------------------------------------------------------------
// House tiers — the Manor Lords-style upgrade ladder
// ---------------------------------------------------------------------------

export interface TierReq {
  tier: number;
  name: string;
  /** Distinct food types that must have reached the home. */
  foodTypes: number;
  clothingTypes: number;
  luxuryTypes: number;
  fuel: boolean;
  water: boolean;
  faith: number;      // 0 none, 1 chapel, 2 stone church
  leisure: boolean;   // tavern serving ale in range
  charm: number;      // minimum local charm
  /** Coin of tax per family per month. */
  tax: number;
  /** Families the plot supports at this tier. */
  capacity: number;
}

export const HOUSE_TIERS: TierReq[] = [
  { tier: 1, name: 'Hovel', foodTypes: 1, clothingTypes: 0, luxuryTypes: 0, fuel: false, water: false, faith: 0, leisure: false, charm: 0, tax: 1, capacity: 1 },
  { tier: 2, name: 'Cottage', foodTypes: 2, clothingTypes: 1, luxuryTypes: 0, fuel: true, water: true, faith: 1, leisure: false, charm: 4, tax: 4, capacity: 2 },
  { tier: 3, name: 'Burgage House', foodTypes: 3, clothingTypes: 2, luxuryTypes: 2, fuel: true, water: true, faith: 2, leisure: true, charm: 14, tax: 11, capacity: 3 },
];

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

export const TUNING = {
  /** Seconds of real time per in-game hour at 1× speed. A 24h day is 60s. */
  secondsPerHour: 2.5,
  hoursPerDay: 24,
  daysPerSeason: 4,
  workStartHour: 6,
  workEndHour: 20,

  /** Food eaten per adult per day. */
  foodPerDay: 0.8,
  /** Firewood burned per home per day, multiplied by the season factor. */
  fuelPerDay: 0.5,
  fuelSeason: { spring: 0.6, summer: 0.15, autumn: 0.8, winter: 2.0 } as Record<Season, number>,
  /** Clothing worn out per home per day. */
  clothingPerDay: 0.03,
  luxuryPerDay: 0.06,

  /** Base walking speed in tiles/second. */
  walkSpeed: 3.0,
  roadSpeedBonus: 1.7,

  /** Villagers carry this much in one trip. */
  carryCapacity: 12,
  /** With an ox and cart behind them, this much instead. */
  cartCapacity: 36,
  /** Oxen plod: haulage speed multiplier while pulling a cart. */
  cartSpeed: 0.82,

  /** Contentment thresholds. */
  birthContentment: 0.56,
  leaveContentment: 0.24,

  /** How much of a full stomach one unit of food is worth. */
  startingCoin: 260,
  startingVillagers: 8,

  /** Trade: sell price = price × (1 − spread), buy price = price × (1 + spread). */
  tradeSpread: 0.18,
  /** How hard prices move per unit traded, as a fraction. */
  priceElasticity: 0.0016,
  priceRecovery: 0.02,

  /** Fraction of soil fertility a fully-grown harvest costs the tiles under it. */
  fertilityPerHarvest: 0.07,
  /** Daily fertility regain for unworked tiles, toward their natural baseline. */
  fertilityRegen: 0.0025,
  /** Passive crop growth per summer day (sun and rain do some of the work). */
  passiveGrowth: 0.05,
} as const;
