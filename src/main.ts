/**
 * Entry point: owns the frame loop, input, and the mapping between simulation
 * objects and their meshes.
 */

import {
  BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments,
  MeshBasicMaterial, Object3D, Vector2,
} from 'three';

import { Game } from './sim/game';
import {
  AUTOSAVE_KEY, SAVE_KEY, clearSave, deserialize, exportSave,
  loadFromStorage, peekSave, saveToStorage, type SaveData,
} from './sim/save';
import { BUILDING_BY_ID } from './sim/defs';
import type { Building } from './sim/building';
import type { Villager } from './sim/villager';
import { View } from './render/view';
import {
  disposeObject, makeBuildingMesh, makeGhost, updateBuildingVisual,
  type BuildingVisual,
} from './render/entities';
import { VillagerRenderer } from './render/villagers';
import { UI } from './ui/ui';

const canvas = document.getElementById('stage') as HTMLCanvasElement;

/**
 * Boot from the rolling autosave if there is one, so closing the tab and
 * coming back resumes the village rather than throwing it away. A corrupt or
 * stale-version save is discarded rather than blocking the game.
 */
function bootGame(): { game: Game; resumed: boolean } {
  try {
    const loaded = loadFromStorage(AUTOSAVE_KEY);
    if (loaded) return { game: loaded, resumed: true };
  } catch (err) {
    console.warn('Could not read the autosave, starting fresh:', err);
    clearSave(AUTOSAVE_KEY);
  }
  return { game: new Game(Math.floor(Math.random() * 1e9)), resumed: false };
}

const boot = bootGame();
const game = boot.game;
const view = new View(canvas, game);

const buildingVisuals = new Map<number, BuildingVisual>();

const buildingRoot = new Group();
const villagerRoot = new Group();
view.scene.add(buildingRoot, villagerRoot);

// Every villager is drawn from a handful of InstancedMeshes, so a village of
// hundreds costs the same handful of draw calls as a village of eight.
const villagers = new VillagerRenderer(game, villagerRoot);

const ghost = makeGhost();
view.scene.add(ghost.root);

// Supply lines drawn for the selected building.
const flowLines = new LineSegments(
  new BufferGeometry(),
  new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
);
flowLines.frustumCulled = false;
flowLines.visible = false;
view.scene.add(flowLines);

// ---------------------------------------------------------------------- UI

/** Write the rolling autosave. Cheap enough to do every half-minute. */
function autosave(quiet = true): void {
  try {
    saveToStorage(game, AUTOSAVE_KEY, 'Autosave');
    if (!quiet) ui.flashSaved('Village saved');
  } catch (err) {
    console.warn('Autosave failed:', err);
    if (!quiet) ui.flashSaved('Could not save');
  }
}

/** Put a save into the boot slot and restart cleanly into it. */
function bootInto(data: SaveData | null): void {
  if (data) localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  else clearSave(AUTOSAVE_KEY);
  suppressExitSave = true;
  location.reload();
}

let suppressExitSave = false;

const ui = new UI(game, {
  onSelectBuildDef: (defId) => { pendingDef = defId; pendingRot = false; },
  onDemolish: (id) => { game.demolish(id); view.markTerrainDirty(); },
  onFocus: (x, y) => view.focusOn(x + 0.5, y + 0.5),
  onOverlay: (mode) => view.setOverlay(mode),
  getCamera: () => ({ x: view.target.x, z: view.target.z, yaw: view.yawAngle }),

  onSave: () => {
    try {
      saveToStorage(game, SAVE_KEY, 'Manual save');
      autosave();
      ui.flashSaved('Saved');
    } catch (err) {
      console.warn(err);
      ui.flashSaved('Could not save');
    }
  },
  onLoad: () => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { ui.toast('There is no saved village to load.', 'bad'); return; }
    try {
      bootInto(JSON.parse(raw) as SaveData);
    } catch (err) {
      console.warn(err);
      ui.toast('That save could not be read.', 'bad');
    }
  },
  onNewGame: () => bootInto(null),
  onExport: () => {
    const { name, json } = exportSave(game);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    ui.flashSaved('Exported');
  },
  onImport: (file: File) => {
    file.text().then((txt) => {
      try {
        const data = JSON.parse(txt) as SaveData;
        deserialize(data); // validate before committing to a reload
        bootInto(data);
      } catch (err) {
        console.warn(err);
        ui.toast('That file is not a Cozy Village save.', 'bad');
      }
    });
  },
  saveStatus: () => {
    const s = peekSave(SAVE_KEY);
    const auto = peekSave(AUTOSAVE_KEY);
    const fmt = (x: NonNullable<ReturnType<typeof peekSave>>) => {
      const mins = Math.round((Date.now() - x.savedAt) / 60000);
      const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
      return `Year ${x.year}, day ${x.day + 1} · ${x.pop} villagers · ${when}`;
    };
    const lines: string[] = [];
    lines.push(auto ? `Autosave: ${fmt(auto)}` : 'No autosave yet.');
    if (s) lines.push(`Saved game: ${fmt(s)}`);
    return lines.join('  ·  ');
  },
});

let pendingDef: string | null = null;
let pendingRot = false;

/** Footprint of the pending building, rotation applied. */
function pendingDims(): { w: number; h: number } {
  if (!pendingDef) return { w: 1, h: 1 };
  const d = BUILDING_BY_ID[pendingDef];
  return pendingRot ? { w: d.size[1], h: d.size[0] } : { w: d.size[0], h: d.size[1] };
}

// ------------------------------------------------------------------- input

const ndc = new Vector2();
const pointer = { x: 0, y: 0, down: false, button: 0, sx: 0, sy: 0, cx: 0, cy: 0 };
const keys = new Set<string>();
let hoverTile: { x: number; y: number } | null = null;
let roadDragFrom: { x: number; y: number } | null = null;
/** Anchor corner while dragging out a field/pasture/orchard. */
let zoneDrag: { x: number; y: number } | null = null;

function setNdc(e: { clientX: number; clientY: number }): void {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer.down = true;
  pointer.button = e.button;
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.sx = e.clientX; pointer.sy = e.clientY;
  if (e.button === 0 && pendingDef) {
    setNdc(e);
    const def = BUILDING_BY_ID[pendingDef];
    if (pendingDef === 'road') roadDragFrom = view.pickTile(ndc);
    else if (def.zone) zoneDrag = view.pickTile(ndc);
  }
});

window.addEventListener('pointerup', (e) => {
  if (!pointer.down) return;
  pointer.down = false;
  const moved = Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 5;

  if (e.button === 2) {
    if (!moved) {
      if (pendingDef) { pendingDef = null; zoneDrag = null; ui.setBuildSelection(null); }
      else ui.clearSelection();
    }
    return;
  }
  if (e.button !== 0) return;

  setNdc(e);

  // Drag-drawn roads.
  if (pendingDef === 'road' && roadDragFrom) {
    const to = view.pickTile(ndc);
    if (to) placeRoadLine(roadDragFrom, to);
    roadDragFrom = null;
    return;
  }

  // Drag-drawn zones (fields, pastures, orchards).
  if (pendingDef && zoneDrag) {
    const def = BUILDING_BY_ID[pendingDef];
    const to = view.pickTile(ndc) ?? zoneDrag;
    const rect = zoneRect(zoneDrag, to, def.zone!.minSide, def.zone!.maxSide);
    const check = game.canPlace(pendingDef, rect.x, rect.y, rect.w, rect.h);
    if (!check.ok) {
      ui.toast(check.reason ?? 'Cannot place that here', 'bad');
    } else {
      const b = game.place(pendingDef, rect.x, rect.y, rect.w, rect.h);
      if (b) {
        view.markTerrainDirty();
        view.refreshProps();
        if (!e.shiftKey) { pendingDef = null; ui.setBuildSelection(null); }
      }
    }
    zoneDrag = null;
    ui.hideDragSize();
    return;
  }

  if (moved) return;

  if (pendingDef) {
    const tile = view.pickTile(ndc);
    if (tile) tryPlace(pendingDef, tile.x, tile.y, e.shiftKey);
    return;
  }
  pickAtPointer();
});

let tooltipTimer = 0;

window.addEventListener('pointermove', (e) => {
  setNdc(e);
  pointer.cx = e.clientX; pointer.cy = e.clientY;
  if (pointer.down) {
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (pointer.button === 2) { view.panBy(-dx, -dy); return; }
    if (pointer.button === 1) { view.rotateBy(-dx * 0.006); view.pitchBy(dy * 0.004); return; }
    if (pointer.button === 0 && !pendingDef) { view.panBy(-dx, -dy); return; }
    // Left-drag with a pending zone/road: the drag IS the placement gesture.
  }
  hoverTile = view.pickTile(ndc);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoomBy(e.deltaY * 0.0012);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === 'Escape') {
    if (pendingDef) { pendingDef = null; zoneDrag = null; ui.setBuildSelection(null); }
    else ui.clearSelection();
  }
  if (e.key.toLowerCase() === 'r' && pendingDef) pendingRot = !pendingRot;
  if (e.key === ' ') { e.preventDefault(); game.speed = game.speed === 0 ? 1 : 0; }
  if (e.key >= '1' && e.key <= '4') game.speed = [1, 2, 5, 10][Number(e.key) - 1];
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => view.resize());

function handleKeyPan(dt: number): void {
  const speed = 26 * dt * (view.zoom / 46);
  let dx = 0, dz = 0;
  if (keys.has('w') || keys.has('arrowup')) dz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dz += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  if (dx || dz) view.panWorld(dx * speed, dz * speed);
  if (keys.has('q')) view.rotateBy(-1.4 * dt);
  if (keys.has('e')) view.rotateBy(1.4 * dt);
}

// -------------------------------------------------------------- placement

/** Normalise two drag corners into a clamped zone rectangle. */
function zoneRect(a: { x: number; y: number }, b: { x: number; y: number }, minSide: number, maxSide: number) {
  let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  let y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  let w = Math.max(minSide, Math.min(maxSide, x1 - x0 + 1));
  let h = Math.max(minSide, Math.min(maxSide, y1 - y0 + 1));
  // Grow/shrink away from the anchor corner.
  const x = a.x <= b.x ? x0 : x1 - w + 1;
  const y = a.y <= b.y ? y0 : y1 - h + 1;
  return { x, y, w, h };
}

function tryPlace(defId: string, x: number, y: number, keep: boolean): void {
  const { w, h } = pendingDims();
  const ox = x - Math.floor(w / 2);
  const oy = y - Math.floor(h / 2);
  const check = game.canPlace(defId, ox, oy, w, h);
  if (!check.ok) { ui.toast(check.reason ?? 'Cannot build here', 'bad'); return; }
  const b = game.place(defId, ox, oy, w, h);
  if (!b) { ui.toast('Cannot build here', 'bad'); return; }
  const def = BUILDING_BY_ID[defId];
  if (def.id === 'road' || def.cat === 'decor') view.markTerrainDirty();
  view.refreshProps();
  if (!keep) { pendingDef = null; ui.setBuildSelection(null); }
}

function placeRoadLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  let laid = 0;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if (game.canPlace('road', x, y).ok && game.place('road', x, y)) laid++;
  }
  if (laid) view.markTerrainDirty();
  else ui.toast('No room for a road there', 'bad');
}

// --------------------------------------------------------------- selection

function pickBuildingOrVillager(): { building?: Building; villager?: Villager } {
  // People first: they are small, and if the cursor is on one the player
  // almost certainly meant them rather than the building behind.
  const villager = villagers.pick(view.raycasterFor(ndc));
  if (villager) return { villager };

  const roots: Object3D[] = [];
  for (const v of buildingVisuals.values()) roots.push(v.root);
  const hit = view.raycastObjects(ndc, roots);
  let node: Object3D | null = hit;
  while (node) {
    if (node.userData.buildingId !== undefined) {
      const b = game.buildings.get(node.userData.buildingId as number);
      if (b) return { building: b };
    }
    node = node.parent;
  }
  return {};
}

function pickAtPointer(): void {
  const { building, villager } = pickBuildingOrVillager();
  if (building) { ui.selectBuilding(building); refreshFlowLines(true); return; }
  if (villager) { ui.selectVillager(villager); refreshFlowLines(true); return; }
  ui.clearSelection();
  refreshFlowLines(true);
}

// ---------------------------------------------------------- supply lines

let flowTimer = 0;

/** Draw the selected building's recent deliveries as coloured ground arcs. */
function refreshFlowLines(force = false): void {
  flowTimer -= force ? flowTimer : 0;
  const sel = ui.selectedBuilding;
  if (!sel || !game.buildings.has(sel.id)) { flowLines.visible = false; return; }

  const flows = game.transfersFor(sel.id, 150);
  if (!flows.length) { flowLines.visible = false; return; }

  const segs: number[] = [];
  const cols: number[] = [];
  const seen = new Set<string>();
  for (const f of flows) {
    const other = game.buildings.get(f.from === sel.id ? f.to : f.from);
    if (!other) continue;
    const key = `${f.from}:${f.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const incoming = f.to === sel.id;
    // Rise-and-fall arc sampled as short segments.
    const ax = other.cx, az = other.cy, bx = sel.cx, bz = sel.cy;
    const steps = 10;
    let px = ax, pz = az;
    let py = game.world.heightAt(ax, az) + 0.4;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const lift = Math.sin(t * Math.PI) * (2 + Math.hypot(bx - ax, bz - az) * 0.12);
      const y = Math.max(game.world.heightAt(x, z), game.world.heightAt(px, pz)) + 0.4 + lift;
      segs.push(px, py, pz, x, y, z);
      const c = incoming ? [0.48, 0.56, 0.34] : [0.75, 0.4, 0.24];
      cols.push(...c, ...c);
      px = x; py = y; pz = z;
    }
    if (seen.size >= 8) break;
  }
  if (!segs.length) { flowLines.visible = false; return; }
  flowLines.geometry.dispose();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(segs), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
  flowLines.geometry = geo;
  flowLines.visible = true;
}

// ------------------------------------------------------------- sync meshes

function syncBuildings(): void {
  for (const [id, b] of game.buildings) {
    let v = buildingVisuals.get(id);
    if (!v) {
      v = makeBuildingMesh(b);
      v.root.userData.buildingId = id;
      buildingRoot.add(v.root);
      buildingVisuals.set(id, v);
    }
    updateBuildingVisual(v, b, game, nightGlow);
    v.selection.visible = ui.selectedBuilding?.id === id;
  }
  for (const [id, v] of buildingVisuals) {
    if (!game.buildings.has(id)) {
      buildingRoot.remove(v.root);
      disposeObject(v.root);
      buildingVisuals.delete(id);
    }
  }
}

function syncVillagers(dt: number): void {
  villagers.update(dt, ui.selectedVillager?.id);
}

function syncGhost(): void {
  if (!pendingDef || !hoverTile) { ghost.root.visible = false; ui.hideDragSize(); return; }
  const def = BUILDING_BY_ID[pendingDef];

  let ox: number, oy: number, w: number, h: number;
  if (def.zone && zoneDrag) {
    const rect = zoneRect(zoneDrag, hoverTile, 1, def.zone.maxSide);
    ox = rect.x; oy = rect.y; w = rect.w; h = rect.h;
  } else if (def.zone) {
    w = def.size[0]; h = def.size[1];
    ox = hoverTile.x - Math.floor(w / 2);
    oy = hoverTile.y - Math.floor(h / 2);
  } else {
    const dims = pendingDims();
    w = dims.w; h = dims.h;
    ox = hoverTile.x - Math.floor(w / 2);
    oy = hoverTile.y - Math.floor(h / 2);
  }

  const check = game.canPlace(pendingDef, ox, oy, w, h);

  // While a zone is being dragged out, show the plot size at the cursor.
  if (def.zone && zoneDrag) {
    const tiles = w * h;
    const jobs = Math.max(1, Math.min(6, Math.round(tiles / 8)));
    const cost = Object.entries(def.cost)
      .map(([k, v]) => `${Math.ceil((v as number) * Math.max(1, tiles / 16))} ${k}`)
      .join(', ');
    const note = check.ok
      ? `${tiles} tiles · ${jobs} ${jobs === 1 ? 'worker' : 'workers'} · ${cost}`
      : (check.reason ?? 'Cannot build here');
    ui.showDragSize(w, h, pointer.cx, pointer.cy, note, check.ok);
  } else {
    ui.hideDragSize();
  }

  const cx = ox + w / 2, cy = oy + h / 2;
  const ground = game.world.heightAt(cx, cy);
  ghost.root.position.set(cx, ground, cy);
  ghost.box.scale.set(w * 0.95, Math.max(0.5, def.height), h * 0.95);
  ghost.box.position.y = Math.max(0.5, def.height) / 2;
  const r = def.service?.radius ?? def.charmRadius ?? 0;
  ghost.ring.visible = r > 0;
  if (r > 0) { ghost.ring.scale.setScalar(r); ghost.ring.position.y = 0.08; }
  (ghost.box.material as MeshBasicMaterial).color.setHex(check.ok ? 0x8fd18a : 0xd4705f);
  ghost.root.visible = true;
}

// ------------------------------------------------------------------- loop

let last = performance.now();
let uiTimer = 0;
let nightGlow = 0;
let treeCheck = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  handleKeyPan(dt);
  game.update(dt);

  // Warm window light through dusk, night and dawn.
  const t = game.dayFraction;
  const target = (t < 0.27 || t > 0.76) ? 1 : (t < 0.32 ? 1 - (t - 0.27) / 0.05 : 0);
  nightGlow += (target - nightGlow) * Math.min(1, dt * 2.2);

  view.update(dt);
  syncBuildings();
  syncVillagers(dt);
  syncGhost();

  // Hover tooltips over buildings and villagers.
  tooltipTimer -= dt;
  if (tooltipTimer <= 0) {
    tooltipTimer = 0.12;
    // cx starts at 0,0 before the mouse has ever moved — no phantom tooltips.
    // And never tooltip through UI panels: only when the canvas itself is hovered.
    const overCanvas = (pointer.cx || pointer.cy)
      && document.elementFromPoint(pointer.cx, pointer.cy) === canvas;
    if (!pendingDef && !pointer.down && overCanvas) {
      const { building, villager } = pickBuildingOrVillager();
      if (building) {
        const extra = building.state !== 'active'
          ? `building · ${Math.round(building.buildFraction * 100)}%`
          : building.isHouse
            ? `${building.residents.length} residents · ${Math.round(building.contentment * 100)}% content`
            : building.jobSlots > 0
              ? `${building.workers.length}/${building.jobSlots} workers · ${building.status}`
              : building.status;
        ui.showTooltip(`<b>${building.def.icon} ${building.isHouse ? building.tierDef().name : building.name}</b><span>${extra}</span>`, pointer.cx, pointer.cy);
      } else if (villager) {
        ui.showTooltip(`<b>${villager.name}</b><span>${villager.activity}</span>`, pointer.cx, pointer.cy);
      } else {
        ui.hideTooltip();
      }
    } else {
      ui.hideTooltip();
    }
  }

  // Supply lines follow the selection, refreshed every second or so.
  flowTimer -= dt;
  if (flowTimer <= 0) { flowTimer = 1.2; refreshFlowLines(); }

  // Trees are planted and felled over time; refresh the instanced props lazily.
  treeCheck -= dt;
  if (treeCheck <= 0 && (game.newTrees.length || game.removedNodes.length || game.speed > 0)) {
    treeCheck = 1.5;
    view.refreshProps();
    game.newTrees.length = 0;
    game.removedNodes.length = 0;
  }

  uiTimer -= dt;
  if (uiTimer <= 0) { uiTimer = 0.2; ui.update(); }

  view.render();
  requestAnimationFrame(frame);
}

// Browsers throttle requestAnimationFrame in hidden or occluded tabs, which
// would freeze the village. A coarse interval keeps the simulation ticking
// (rendering can wait; the economy should not).
setInterval(() => {
  const now = performance.now();
  if (now - last > 600) {
    last = now;
    game.update(0.25);
  }
}, 250);

// Roll the autosave forward every half-minute, and whenever the player leaves.
setInterval(() => autosave(), 30_000);
window.addEventListener('beforeunload', () => { if (!suppressExitSave) autosave(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !suppressExitSave) autosave();
});

// Give the first-time player somewhere to look and something to read.
if (boot.resumed) {
  game.log(`Welcome back to your village — year ${game.year}, day ${game.dayOfSeason + 1}.`, 'good');
} else {
  game.log('Pick a building from the bar below, then click the ground to place it.', 'info');
}
view.focusOn(game.startX, game.startY);
ui.update();
requestAnimationFrame(frame);

// Expose for debugging in the console.
(window as unknown as { village: unknown }).village = { game, view, ui };
export type { Building };
