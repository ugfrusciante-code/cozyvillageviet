/**
 * All DOM: top bar, resource strip, bottom build bar, minimap, overlays,
 * tooltips, inspector, trade and people panels, and the event log.
 */

import {
  ALL_RES, BUILDINGS, BUILDING_BY_ID, CAT_LABEL, CLOTHING_TYPES, CROPS, CROP_ORDER,
  FOOD_TYPES, HOUSE_TIERS, LUXURY_TYPES, RESOURCES, TUNING,
  type BuildCat, type BuildingDef, type CropType, type ResId,
} from '../sim/defs';
import { NODE_INDEX } from '../sim/world';
import type { Building } from '../sim/building';
import type { Game } from '../sim/game';
import type { Villager } from '../sim/villager';

const SEASON_COLOR: Record<string, string> = {
  spring: '#8fb35c', summer: '#e0a756', autumn: '#c06b3d', winter: '#a8c2d4',
};

const CAT_ICON: Record<BuildCat, string> = {
  housing: '🏠', gathering: '🪓', farming: '🌾', crafting: '🔨',
  civic: '⛪', logistics: '📦', decor: '🌷',
};

const HEADLINE_RES: ResId[] = [
  'logs', 'planks', 'stone', 'firewood', 'bread', 'berries', 'meat', 'fish',
  'grain', 'clothes', 'shoes', 'ale', 'tools', 'iron',
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UICallbacks {
  onSelectBuildDef(defId: string | null): void;
  onDemolish(id: number): void;
  onFocus(x: number, y: number): void;
  onOverlay(mode: 'none' | 'fertility' | 'charm'): void;
  /** Camera state for the minimap frustum marker. */
  getCamera(): { x: number; z: number; yaw: number };
  onSave(): void;
  onLoad(): void;
  onNewGame(): void;
  onExport(): void;
  onImport(file: File): void;
  /** Human-readable description of the stored save, if any. */
  saveStatus(): string;
}

export class UI {
  private cat: BuildCat | null = null;
  selectedDef: string | null = null;
  selectedBuilding: Building | null = null;
  selectedVillager: Villager | null = null;
  private lastLogCount = 0;
  private tradeOpen = false;
  private peopleOpen = false;
  private minimapDirty = 0;

  constructor(private game: Game, private cb: UICallbacks) {
    this.buildSpeeds();
    this.buildCategories();
    this.wire();
  }

  // ------------------------------------------------------------------ wiring

  private wire(): void {
    $('insp-close').onclick = () => this.clearSelection();
    $('trade-close').onclick = () => this.closeTrade();
    $('people-close').onclick = () => this.closePeople();
    $('help-close').onclick = () => $('help').classList.add('hidden');
    $('btn-help').onclick = () => $('help').classList.toggle('hidden');

    $('btn-menu').onclick = () => {
      $('menu-status').textContent = this.cb.saveStatus();
      $('menu').classList.toggle('hidden');
    };
    $('menu-close').onclick = () => $('menu').classList.add('hidden');
    $('menu-save').onclick = () => { this.cb.onSave(); $('menu-status').textContent = this.cb.saveStatus(); };
    $('menu-load').onclick = () => this.cb.onLoad();
    $('menu-export').onclick = () => this.cb.onExport();
    $('menu-import').onclick = () => ($('menu-file') as HTMLInputElement).click();
    ($('menu-file') as HTMLInputElement).onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) this.cb.onImport(f);
    };

    for (const el of $('overlays').querySelectorAll('button')) {
      (el as HTMLElement).onclick = () => {
        for (const o of $('overlays').querySelectorAll('button')) o.classList.remove('on');
        el.classList.add('on');
        this.cb.onOverlay(((el as HTMLElement).dataset.ov ?? 'none') as 'none' | 'fertility' | 'charm');
      };
    }

    const mm = $('minimap') as HTMLCanvasElement;
    mm.onclick = (e) => {
      const r = mm.getBoundingClientRect();
      const n = this.game.world.size;
      const x = ((e.clientX - r.left) / r.width) * n;
      const y = ((e.clientY - r.top) / r.height) * n;
      this.cb.onFocus(x, y);
    };
  }

  private buildSpeeds(): void {
    const host = $('speeds');
    host.innerHTML = '';
    const opts: { label: string; v: number }[] = [
      { label: '❚❚', v: 0 }, { label: '1×', v: 1 }, { label: '2×', v: 2 },
      { label: '5×', v: 5 }, { label: '10×', v: 10 },
    ];
    for (const o of opts) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.dataset.speed = String(o.v);
      b.onclick = () => { this.game.speed = o.v; this.refreshSpeeds(); };
      host.appendChild(b);
    }
    this.refreshSpeeds();
  }

  private refreshSpeeds(): void {
    for (const b of $('speeds').querySelectorAll('button')) {
      b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === this.game.speed);
    }
  }

  // --------------------------------------------------------- bottom build bar

  private buildCategories(): void {
    const host = $('buildcats');
    host.innerHTML = '';
    const cats: BuildCat[] = ['housing', 'gathering', 'farming', 'crafting', 'civic', 'logistics', 'decor'];
    for (const c of cats) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="ico">${CAT_ICON[c]}</span>${CAT_LABEL[c]}`;
      b.dataset.cat = c;
      b.onclick = () => {
        this.cat = this.cat === c ? null : c;
        this.renderFlyout();
      };
      host.appendChild(b);
    }
  }

  private renderFlyout(): void {
    for (const b of $('buildcats').querySelectorAll('button')) {
      b.classList.toggle('on', (b as HTMLElement).dataset.cat === this.cat);
    }
    const flyout = $('buildflyout');
    if (!this.cat) { flyout.classList.add('hidden'); return; }
    flyout.classList.remove('hidden');

    const grid = $('flyout-grid');
    grid.innerHTML = '';
    for (const d of BUILDINGS.filter((x) => x.cat === this.cat)) {
      grid.appendChild(this.buildCard(d));
    }
    this.updateHint();
  }

  private lockReason(d: BuildingDef): string | null {
    if (d.minPop && this.game.population < d.minPop) return `Needs ${d.minPop} villagers`;
    if (d.needs) {
      for (const n of d.needs) {
        if (!this.game.hasBuilding(n)) return `Needs a ${BUILDING_BY_ID[n].name}`;
      }
    }
    return null;
  }

  private buildCard(d: BuildingDef): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bcard';
    el.dataset.def = d.id;

    const lock = this.lockReason(d);
    if (lock) el.classList.add('locked');
    if (this.selectedDef === d.id) el.classList.add('on');

    const cost = Object.entries(d.cost)
      .map(([k, v]) => `${RESOURCES[k as ResId].icon}${Math.round(v as number)}`).join(' ') || 'free';
    const extra = d.zone ? ' · drag to size' : '';

    el.innerHTML = `
      <div class="ico">${d.icon}</div>
      <div>
        <div class="nm">${d.name}</div>
        <div class="cost">${lock ?? cost + extra}</div>
      </div>`;

    el.title = d.desc;
    el.onclick = () => {
      if (lock) return;
      this.selectedDef = this.selectedDef === d.id ? null : d.id;
      this.cb.onSelectBuildDef(this.selectedDef);
      this.renderFlyout();
    };
    return el;
  }

  private updateHint(): void {
    const h = $('flyout-hint');
    if (this.selectedDef) {
      const d = BUILDING_BY_ID[this.selectedDef];
      const zone = d.zone ? ` <b>Press and drag</b> on the ground to draw the plot (${d.zone.minSide}–${d.zone.maxSide} a side).` : ' Click the ground to place · R rotates · Shift keeps placing.';
      h.innerHTML = `<b>${d.name}</b> — ${d.desc}${zone}`;
    } else {
      h.textContent = 'Pick a building. Esc or right-click cancels.';
    }
  }

  setBuildSelection(defId: string | null): void {
    this.selectedDef = defId;
    if (defId) {
      const d = BUILDING_BY_ID[defId];
      if (d && d.cat !== this.cat) this.cat = d.cat;
    }
    this.renderFlyout();
  }

  // -------------------------------------------------------------- selection

  selectBuilding(b: Building | null): void {
    this.selectedBuilding = b;
    this.selectedVillager = null;
    this.renderInspector();
  }

  selectVillager(v: Villager | null): void {
    this.selectedVillager = v;
    this.selectedBuilding = null;
    this.renderInspector();
  }

  clearSelection(): void {
    this.selectedBuilding = null;
    this.selectedVillager = null;
    $('inspector').classList.add('hidden');
  }

  // ---------------------------------------------------------------- tooltip

  showTooltip(html: string, x: number, y: number): void {
    const tip = $('tooltip');
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const pad = 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, x + pad)}px`;
    tip.style.top = `${Math.min(window.innerHeight - h - 8, y + pad)}px`;
  }

  hideTooltip(): void { $('tooltip').classList.add('hidden'); }

  // ------------------------------------------------------- drag size readout

  /** Live plot size while the player drags out a field, pasture or orchard. */
  showDragSize(w: number, h: number, x: number, y: number, note: string, ok: boolean): void {
    const el = $('dragsize');
    el.className = ok ? '' : 'bad';
    el.innerHTML = `<div class="dims">${w} × ${h}</div><div class="sub">${note}</div>`;
    el.style.left = `${Math.min(window.innerWidth - el.offsetWidth - 8, x + 18)}px`;
    el.style.top = `${Math.max(8, y - el.offsetHeight - 14)}px`;
  }

  hideDragSize(): void { $('dragsize').classList.add('hidden'); }

  flashSaved(text = 'Saved'): void {
    const el = $('savetoast');
    el.textContent = text;
    el.classList.remove('hidden');
    // Restart the CSS animation.
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
    window.clearTimeout(this.saveToastTimer);
    this.saveToastTimer = window.setTimeout(() => el.classList.add('hidden'), 1800);
  }

  private saveToastTimer = 0;

  // ------------------------------------------------------------------ frame

  update(): void {
    const g = this.game;
    this.refreshSpeeds();

    const h = Math.floor(g.hour);
    const m = Math.floor((g.hour % 1) * 60);
    $('date-line').textContent = `${g.season[0].toUpperCase()}${g.season.slice(1)} · Year ${g.year}`;
    $('time-line').textContent =
      `Day ${g.dayOfSeason + 1} of ${TUNING.daysPerSeason} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('season-dot').style.background = SEASON_COLOR[g.season];

    const content = g.averageContentment;
    const foodStock = FOOD_TYPES.reduce((s, f) => s + g.stockOf(f), 0);
    const daysFood = foodStock / Math.max(0.01, g.population * TUNING.foodPerDay);
    $('stats').innerHTML = `
      <div class="stat"><b>${g.population}</b><span>People</span></div>
      <div class="stat"><b>${g.idleAdults}</b><span>Idle</span></div>
      <div class="stat ${content < 0.4 ? 'warn' : ''}"><b>${Math.round(content * 100)}%</b><span>Content</span></div>
      <div class="stat ${g.coin < 0 ? 'warn' : ''}"><b>${Math.round(g.coin)}</b><span>Coin</span></div>
      <div class="stat ${daysFood < 4 ? 'warn' : ''}"><b>${daysFood.toFixed(0)}d</b><span>Food</span></div>`;
    ($('stats') as HTMLElement).onclick = () => this.openPeople();

    this.renderResources();
    this.renderAlerts();
    this.renderLog();
    this.renderMinimap();
    if (this.selectedBuilding && !g.buildings.has(this.selectedBuilding.id)) this.clearSelection();
    if (this.selectedVillager && !g.villagers.has(this.selectedVillager.id)) this.clearSelection();
    if (this.selectedBuilding || this.selectedVillager) this.renderInspector();
    if (this.tradeOpen) this.renderTrade();
    if (this.peopleOpen) this.renderPeople();
  }

  private renderResources(): void {
    const g = this.game;
    const parts: string[] = [];
    for (const r of HEADLINE_RES) {
      const amt = g.stockOf(r);
      const flow = g.netFlow(r);
      if (amt < 0.5 && Math.abs(flow) < 0.5 && !['logs', 'firewood', 'bread'].includes(r)) continue;
      const low = (r === 'firewood' && amt < g.population) || (RESOURCES[r].food && amt < g.population);
      const d = flow > 0.5 ? `+${flow.toFixed(0)}` : flow < -0.5 ? flow.toFixed(0) : '';
      parts.push(
        `<div class="res ${low ? 'low' : ''}" title="${RESOURCES[r].name}">` +
        `${RESOURCES[r].icon}<span class="n">${Math.round(amt)}</span>` +
        `${d ? `<span class="d ${flow < 0 ? 'neg' : ''}">${d}</span>` : ''}</div>`,
      );
    }
    $('resbar').innerHTML = parts.join('');
  }

  private renderAlerts(): void {
    $('alerts').innerHTML = this.game.alerts
      .map((a) => `<div class="alert ${a.severity === 'danger' ? 'danger' : ''}">${a.text}</div>`)
      .join('');
  }

  private renderLog(): void {
    const g = this.game;
    if (g.events.length === this.lastLogCount) return;
    this.lastLogCount = g.events.length;
    $('log').innerHTML = g.events.slice(-5)
      .map((e) => `<div class="logline ${e.kind}">${e.text}</div>`)
      .join('');
  }

  // ---------------------------------------------------------------- minimap

  private renderMinimap(): void {
    // Terrain repaints slowly; the camera marker follows every UI tick.
    const mm = $('minimap') as HTMLCanvasElement;
    const ctx = mm.getContext('2d');
    if (!ctx) return;
    const g = this.game;
    const n = g.world.size;
    const s = mm.width / n;

    if (--this.minimapDirty <= 0) {
      this.minimapDirty = 10; // full repaint every ~2s of UI ticks
      const w = g.world;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = w.idx(x, y);
          let col: string;
          if (w.water[i]) col = '#5a8fa0';
          else if (w.road[i]) col = '#8a6c4c';
          else if (w.node[i] === NODE_INDEX['tree']) col = '#3f5b41';
          else {
            const f = w.fertility[i];
            col = f > 0.5 ? '#7d9a56' : f > 0.3 ? '#8fa05f' : '#a09a78';
          }
          ctx.fillStyle = col;
          ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
        }
      }
      for (const b of g.buildings.values()) {
        ctx.fillStyle = b.state !== 'active' ? '#e0a756'
          : b.isHouse ? '#c0663d'
          : b.def.cat === 'farming' ? '#d9bb84'
          : '#efe1c9';
        ctx.fillRect(b.x * s, b.y * s, Math.max(2, b.w * s), Math.max(2, b.h * s));
      }
    }

    // Camera marker: a wedge showing position + facing. Drawn over a cached
    // copy would be nicer, but a tiny triangle redraw each tick is cheap.
    const cam = this.cb.getCamera();
    ctx.save();
    ctx.translate(cam.x * s, cam.z * s);
    ctx.rotate(-cam.yaw);
    ctx.strokeStyle = 'rgba(255, 246, 234, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-6, 6);
    ctx.lineTo(0, -7);
    ctx.lineTo(6, 6);
    ctx.stroke();
    ctx.restore();
    this.minimapDirty = Math.min(this.minimapDirty, 10);
  }

  // -------------------------------------------------------------- inspector

  private renderInspector(): void {
    const panel = $('inspector');
    if (this.selectedBuilding) { this.renderBuildingInspector(this.selectedBuilding); panel.classList.remove('hidden'); return; }
    if (this.selectedVillager) { this.renderVillagerInspector(this.selectedVillager); panel.classList.remove('hidden'); return; }
    panel.classList.add('hidden');
  }

  private supplyLinesHtml(b: Building): string {
    const g = this.game;
    const seen = new Map<string, { dir: 'in' | 'out'; res: ResId; amt: number; other: string }>();
    for (const t of g.transfersFor(b.id)) {
      const dir: 'in' | 'out' = t.to === b.id ? 'in' : 'out';
      const otherId = dir === 'in' ? t.from : t.to;
      const other = g.buildings.get(otherId);
      if (!other) continue;
      const key = `${dir}:${t.res}:${otherId}`;
      const cur = seen.get(key);
      if (cur) cur.amt += t.amt;
      else seen.set(key, { dir, res: t.res, amt: t.amt, other: other.name });
      if (seen.size >= 6) break;
    }
    if (!seen.size) return '';
    const rows = [...seen.values()].map((f) =>
      `<div class="flowline"><span class="${f.dir}">${f.dir === 'in' ? '⬅' : '➡'} ${RESOURCES[f.res].icon} ${Math.round(f.amt)} ${RESOURCES[f.res].name}</span><b>${f.dir === 'in' ? 'from' : 'to'} ${f.other}</b></div>`,
    );
    return `<div class="section">Supply lines (recent)</div>${rows.join('')}`;
  }

  private renderBuildingInspector(b: Building): void {
    const g = this.game;
    const d = b.def;
    $('insp-title').textContent = b.isHouse ? `${b.tierDef().name}` : d.name;
    const body = $('insp-body');
    const out: string[] = [];

    out.push(`<p>${d.desc}</p>`);

    if (b.state !== 'active') {
      const pct = Math.round(b.buildFraction * 100);
      out.push('<div class="section">Under construction</div>');
      if (d.zone) out.push(`<div class="row"><span>Plot</span><b>${b.w}×${b.h} (${b.area} tiles)</b></div>`);
      const owed = b.missingMaterials();
      const owedList = Object.entries(owed)
        .map(([k, v]) => `<span class="chip no">${RESOURCES[k as ResId].icon} ${Math.ceil(v as number)} ${RESOURCES[k as ResId].name}</span>`)
        .join('');
      out.push(owedList
        ? `<div class="chips">${owedList}</div><p style="margin-top:6px">Waiting on materials.</p>`
        : `<div class="row"><span>Frame</span><b>${pct}%</b></div>
           <div class="bar warm"><i style="width:${pct}%"></i></div>`);
      out.push(`<div class="btn-row">
        <button class="btn" data-act="pause">${b.paused ? 'Resume' : 'Hold'}</button>
        <button class="btn danger" data-act="cancel">Cancel</button></div>`);
      body.innerHTML = out.join('');
      this.wireInspectorButtons(b);
      return;
    }

    // --- Housing
    if (b.isHouse) {
      const tierDef = b.tierDef();
      const next = HOUSE_TIERS[b.tier];
      out.push('<div class="section">Household</div>');
      const fams = b.familyIds.map((id) => g.families.get(id)).filter(Boolean);
      if (fams.length) {
        out.push('<div class="chips">' + fams.map((f) =>
          `<span class="chip ok">👪 The ${f!.surname}s · ${f!.size}</span>`).join('') + '</div>');
      }
      out.push(`<div class="row"><span>Residents</span><b>${b.residents.length} / ${b.capacityResidents}</b></div>`);
      out.push(`<div class="row"><span>Families</span><b>${b.families} / ${b.capacityFamilies}</b></div>`);
      const born = fams.reduce((n, f) => n + (f?.childrenBorn ?? 0), 0);
      if (born > 0) out.push(`<div class="row"><span>Children raised here</span><b>${born}</b></div>`);
      out.push(`<div class="row"><span>Tax each season</span><b>${Math.round(tierDef.tax * b.families)}c</b></div>`);
      const cPct = Math.round(b.contentment * 100);
      out.push(`<div class="row"><span>Contentment</span><b>${cPct}%</b></div>
        <div class="bar ${cPct < 40 ? 'hot' : cPct < 65 ? 'warm' : ''}"><i style="width:${cPct}%"></i></div>`);
      if (b.rationing) out.push('<p style="margin-top:6px">Rationing from the storehouse — the stalls were bare.</p>');

      out.push('<div class="section">Supplied</div><div class="chips">');
      const s = b.supply;
      for (const f of FOOD_TYPES) if (s.foodTypes.has(f)) out.push(`<span class="chip ok">${RESOURCES[f].icon} ${RESOURCES[f].name}</span>`);
      for (const c of CLOTHING_TYPES) if (s.clothingTypes.has(c)) out.push(`<span class="chip ok">${RESOURCES[c].icon} ${RESOURCES[c].name}</span>`);
      for (const l of LUXURY_TYPES) if (s.luxuryTypes.has(l)) out.push(`<span class="chip ok">${RESOURCES[l].icon} ${RESOURCES[l].name}</span>`);
      out.push(s.fuelDays > 0.4 ? '<span class="chip ok">🔥 Warm</span>' : '<span class="chip no">🔥 Cold</span>');
      out.push('</div>');

      out.push('<div class="section">Services in range</div><div class="chips">');
      const svc: [string, string][] = [
        ['water', '🪣 Water'], ['faith', '⛪ Faith'], ['leisure', '🍻 Tavern'],
        ['health', '🩺 Healer'], ['market', '🏪 Market'], ['learning', '📚 School'],
      ];
      for (const [k, label] of svc) {
        const has = (b.services as Record<string, number | undefined>)[k];
        out.push(`<span class="chip ${has ? 'ok' : 'no'}">${label}</span>`);
      }
      out.push(`<span class="chip ${b.localCharm >= 14 ? 'ok' : ''}">🌷 Charm ${b.localCharm.toFixed(0)}</span>`);
      out.push('</div>');

      if (next) {
        out.push(`<div class="section">To become a ${next.name}</div>`);
        if (b.upgradeBlockers.length === 0) out.push('<p>Everything is in place. It will upgrade shortly.</p>');
        else out.push('<div class="chips">' + b.upgradeBlockers.map((x) => `<span class="chip no">${x}</span>`).join('') + '</div>');
      } else {
        out.push('<div class="section">Fully grown</div><p>This is as fine as a house gets.</p>');
      }
      out.push(this.supplyLinesHtml(b));
      out.push('<div class="btn-row"><button class="btn danger" data-act="demolish">Demolish</button></div>');
      body.innerHTML = out.join('');
      this.wireInspectorButtons(b);
      return;
    }

    // --- Farms with a crop cycle
    if (d.crop) {
      out.push('<div class="section">The farming year</div>');
      out.push(`<div class="row"><span>Plot</span><b>${b.w}×${b.h} (${b.area} tiles)</b></div>`);
      out.push(`<div class="row"><span>Soil</span><b>${Math.round(b.fertility * 100)}%</b></div>`);
      const phase = g.season === 'spring' ? (b.sown ? 'Sown — growing' : 'Sowing')
        : g.season === 'summer' ? (b.sown ? 'Growing' : 'Not sown!')
        : g.season === 'autumn' ? (b.cropPool > 0.01 ? 'Harvest!' : 'Harvest done')
        : 'Dormant';
      out.push(`<div class="row"><span>Phase</span><b>${phase}</b></div>`);
      const growPct = Math.round(b.growth * 100);
      out.push(`<div class="row"><span>Crop</span><b>${growPct}%</b></div>
        <div class="bar gold"><i style="width:${growPct}%"></i></div>`);
      if (g.season === 'autumn' && b.cropPoolInit > 0.02) {
        const reaped = Math.round((1 - b.cropPool / b.cropPoolInit) * 100);
        out.push(`<div class="row"><span>Reaped</span><b>${reaped}%</b></div>`);
      }
      const standing = b.standingCrop;
      const est = Math.round(
        b.growth * standing.yieldPerTile * b.area * (0.35 + b.fertility * 0.9) * b.rotationFactor,
      );
      out.push(`<div class="row"><span>Standing yield</span><b>≈ ${est} ${RESOURCES[standing.out].name}</b></div>`);

      out.push('<div class="section">Sow next spring</div><div class="chips">');
      for (const ct of CROP_ORDER) {
        const c = CROPS[ct];
        const on = b.cropType === ct;
        const repeat = b.lastCrop === ct;
        out.push(
          `<span class="chip ${on ? 'ok' : ''}" data-crop="${ct}" style="cursor:pointer"` +
          ` title="${c.blurb}">${c.icon} ${c.name}${repeat ? ' ↺' : ''}</span>`,
        );
      }
      out.push('</div>');
      out.push(`<p style="margin-top:6px">${CROPS[b.cropType].blurb}</p>`);
      if (b.lastCrop) {
        const f = b.rotationFactorFor(b.cropType);
        const label = f > 1 ? `Rotation bonus ×${f.toFixed(2)}`
          : f < 1 ? `Same crop again ×${f.toFixed(2)}`
          : 'No rotation effect';
        out.push(`<div class="row"><span>Last sown</span><b>${CROPS[b.lastCrop].name}</b></div>`);
        out.push(`<div class="row"><span>Next harvest</span><b class="${f >= 1 ? '' : 'warn'}">${label}</b></div>`);
      }
      if (b.sown) {
        out.push(`<div class="row"><span>This year's yield</span><b>×${b.rotationFactor.toFixed(2)}</b></div>`);
      }
    }

    // --- Workplaces
    if (b.jobSlots > 0 || d.jobs > 0) {
      out.push('<div class="section">Workers</div>');
      out.push(`<div class="row"><span>Assigned</span>
        <span class="stepper">
          <button data-act="minus">−</button>
          <span class="v">${b.workers.length} / ${b.jobSlots}</span>
          <button data-act="plus">+</button>
        </span></div>`);
      out.push(`<div class="row"><span>Priority</span>
        <span class="stepper">
          <button data-act="pri-minus">−</button>
          <span class="v">${['Low', 'Normal', 'High', 'Urgent'][b.priority] ?? b.priority}</span>
          <button data-act="pri-plus">+</button>
        </span></div>`);
      out.push(`<div class="row"><span>Status</span><b style="font-size:12px">${b.status}</b></div>`);
      const act = Math.round(Math.min(1, b.activity) * 100);
      out.push(`<div class="bar ${act < 25 ? 'hot' : act < 60 ? 'warm' : ''}"><i style="width:${act}%"></i></div>`);
    }

    if (d.recipe) {
      out.push('<div class="section">Recipe</div><div class="chips">');
      const ins = Object.entries(d.recipe.in).map(([k, v]) => `${RESOURCES[k as ResId].icon}${v}`).join(' + ') || '—';
      const outs = Object.entries(d.recipe.out).map(([k, v]) => `${RESOURCES[k as ResId].icon}${v}`).join(' + ');
      out.push(`<span class="chip">${ins} → ${outs}${b.sizeFactor !== 1 ? ` ×${b.sizeFactor.toFixed(1)}` : ''}</span>`);
      if (d.recipe.seasons) out.push(`<span class="chip">${d.recipe.seasons.join(', ')}</span>`);
      out.push('</div>');
      if (d.zone) out.push(`<div class="row"><span>Plot</span><b>${b.w}×${b.h} (${b.area} tiles)</b></div>`);
      if (d.cat === 'farming') out.push(`<div class="row"><span>Soil quality</span><b>${Math.round(b.fertility * 100)}%</b></div>`);

      // Production cap: hold the bench once the village owns this much.
      const primary = Object.keys(d.recipe.out)[0] as ResId | undefined;
      if (primary) {
        out.push(`<div class="row"><span>Make until</span>
          <span class="stepper">
            <button data-act="lim-minus">−</button>
            <span class="v">${b.limit == null ? '∞' : b.limit}</span>
            <button data-act="lim-plus">+</button>
          </span></div>`);
        if (b.limit != null) {
          out.push(`<div class="row"><span>In store now</span><b>${Math.round(g.totalOf(primary))} ${RESOURCES[primary].name}</b></div>`);
        }
      }
    }
    if (d.harvest) {
      const nodes = g.world.findNodes(Math.round(b.cx), Math.round(b.cy), d.harvest.kind, d.harvest.radius, 400).length;
      out.push('<div class="section">Gathering</div>');
      out.push(`<div class="row"><span>${d.harvest.kind} in range</span><b>${nodes}</b></div>`);
      out.push(`<div class="row"><span>Yield</span><b>${d.harvest.yield} ${RESOURCES[d.harvest.out].name}</b></div>`);
      if (d.harvest.seasons) out.push(`<div class="row"><span>Season</span><b style="font-size:12px">${d.harvest.seasons.join(', ')}</b></div>`);
    }
    if (d.oxen) {
      out.push('<div class="section">Draught team</div>');
      out.push(`<div class="row"><span>Oxen stabled</span><b>${d.oxen}</b></div>`);
      out.push(`<div class="row"><span>Village-wide, in use</span><b>${g.oxenInUse} / ${g.oxenTotal}</b></div>`);
      out.push(`<p style="margin-top:4px">A carter hauls ${TUNING.cartCapacity} at a time instead of ${TUNING.carryCapacity}.</p>`);
    }
    if (d.service) {
      out.push('<div class="section">Service</div>');
      out.push(`<div class="row"><span>${d.service.kind}</span><b>${d.service.radius} tiles</b></div>`);
      out.push(`<div class="row"><span>Villagers served</span><b>${b.serving}</b></div>`);
    }
    if (d.charm) out.push(`<div class="row"><span>Charm</span><b>${d.charm > 0 ? '+' : ''}${d.charm} over ${d.charmRadius ?? 10} tiles</b></div>`);
    if (d.upkeep) out.push(`<div class="row"><span>Upkeep</span><b>${d.upkeep}c per season</b></div>`);

    const stock = Object.entries(b.store).filter(([, v]) => (v as number) > 0.4);
    if (stock.length) {
      out.push('<div class="section">On hand</div><div class="chips">');
      out.push(stock.map(([k, v]) => `<span class="chip">${RESOURCES[k as ResId].icon} ${Math.round(v as number)}</span>`).join(''));
      out.push('</div>');
    }
    if (b.produced > 0) out.push(`<div class="row" style="margin-top:8px"><span>Produced in total</span><b>${Math.round(b.produced)}</b></div>`);

    out.push(this.supplyLinesHtml(b));

    out.push('<div class="btn-row">');
    if (d.id === 'tradepost') out.push('<button class="btn primary" data-act="trade">Open trade</button>');
    out.push(`<button class="btn" data-act="pause">${b.paused ? 'Resume' : 'Pause'}</button>`);
    out.push('<button class="btn danger" data-act="demolish">Demolish</button>');
    out.push('</div>');

    body.innerHTML = out.join('');
    this.wireInspectorButtons(b);
  }

  private wireInspectorButtons(b: Building): void {
    const body = $('insp-body');
    for (const el of body.querySelectorAll('[data-crop]')) {
      (el as HTMLElement).onclick = () => {
        b.cropType = (el as HTMLElement).dataset.crop as CropType;
        this.renderInspector();
      };
    }
    for (const el of body.querySelectorAll('[data-act]')) {
      const act = (el as HTMLElement).dataset.act;
      (el as HTMLElement).onclick = () => {
        const g = this.game;
        switch (act) {
          case 'plus': g.setJobSlots(b.id, b.jobSlots + 1); break;
          case 'minus': g.setJobSlots(b.id, b.jobSlots - 1); break;
          case 'pri-plus': b.priority = Math.min(3, b.priority + 1); break;
          case 'pri-minus': b.priority = Math.max(0, b.priority - 1); break;
          case 'lim-plus': b.limit = b.limit == null ? 20 : b.limit + 20; break;
          case 'lim-minus': b.limit = b.limit == null ? null : (b.limit <= 20 ? null : b.limit - 20); break;
          case 'pause': b.paused = !b.paused; break;
          case 'demolish':
          case 'cancel': this.cb.onDemolish(b.id); this.clearSelection(); return;
          case 'trade': this.openTrade(); break;
        }
        this.renderInspector();
      };
    }
  }

  private renderVillagerInspector(v: Villager): void {
    const g = this.game;
    $('insp-title').textContent = v.name;
    const job = v.jobId >= 0 ? g.buildings.get(v.jobId) : undefined;
    const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
    const out: string[] = [];
    out.push(`<p>${v.activity}.</p>`);
    out.push('<div class="section">Life</div>');
    out.push(`<div class="row"><span>Age</span><b>${Math.floor(v.age)}</b></div>`);
    out.push(`<div class="row"><span>Role</span><b>${job ? job.name : v.jobTitle}</b></div>`);
    out.push(`<div class="row"><span>Home</span><b>${home ? home.tierDef().name : 'None'}</b></div>`);
    const fam = v.familyId >= 0 ? g.families.get(v.familyId) : undefined;
    if (fam) {
      out.push(`<div class="row"><span>Family</span><b>The ${fam.surname}s (${fam.size})</b></div>`);
    }
    if (v.hasOx) out.push('<div class="chips" style="margin-top:6px"><span class="chip ok">🐂 Driving a cart</span></div>');
    const hp = Math.round(v.health * 100);
    out.push(`<div class="row"><span>Health</span><b>${hp}%</b></div>
      <div class="bar ${hp < 40 ? 'hot' : hp < 70 ? 'warm' : ''}"><i style="width:${hp}%"></i></div>`);
    const sk = Math.round(((v.skill - 0.6) / 1.25) * 100);
    out.push(`<div class="row"><span>Skill</span><b>${v.skill.toFixed(2)}×</b></div>
      <div class="bar"><i style="width:${Math.max(0, Math.min(100, sk))}%"></i></div>`);
    if (v.educated) out.push('<div class="chips" style="margin-top:6px"><span class="chip ok">📚 Schooled</span></div>');
    if (v.carry) {
      out.push(`<div class="section">Carrying</div><div class="chips">
        <span class="chip">${RESOURCES[v.carry.res].icon} ${Math.round(v.carry.amt)} ${RESOURCES[v.carry.res].name}</span></div>`);
    }

    if (v.isAdult) {
      out.push('<div class="section">Assign to</div>');
      const openings = [...g.buildings.values()]
        .filter((b) => b.state === 'active' && b.jobSlots > 0 && b.workers.length < b.jobSlots)
        .sort((a, b) => Math.hypot(a.cx - v.x, a.cy - v.y) - Math.hypot(b.cx - v.x, b.cy - v.y))
        .slice(0, 8);
      out.push('<div class="chips">');
      out.push('<span class="chip" data-job="-1" style="cursor:pointer">Labourer</span>');
      for (const b of openings) {
        out.push(`<span class="chip" data-job="${b.id}" style="cursor:pointer">${b.def.icon} ${b.name}</span>`);
      }
      out.push('</div>');
    }

    const body = $('insp-body');
    body.innerHTML = out.join('');
    for (const el of body.querySelectorAll('[data-job]')) {
      (el as HTMLElement).onclick = () => {
        g.assignVillager(v.id, Number((el as HTMLElement).dataset.job));
        this.renderInspector();
      };
    }
  }

  // ------------------------------------------------------------------ trade

  openTrade(): void { this.tradeOpen = true; $('trade').classList.remove('hidden'); this.renderTrade(); }
  closeTrade(): void { this.tradeOpen = false; $('trade').classList.add('hidden'); }

  private renderTrade(): void {
    const g = this.game;
    const host = $('trade-list');
    // Rebuilding inputs while the user types in them would eat keystrokes.
    if (host.querySelector('input:focus')) return;
    const rows: string[] = [];
    for (const r of ALL_RES) {
      const have = g.stockOf(r);
      const mod = g.trade.mod[r] ?? 1;
      const rule = g.tradeRules[r];
      const trend = mod > 1.02 ? 'up' : mod < 0.98 ? 'down' : '';
      const arrow = mod > 1.02 ? '▲' : mod < 0.98 ? '▼' : '·';
      if (have < 1 && mod === 1 && !rule && !['tools', 'stone', 'planks', 'bread', 'clothes', 'grain'].includes(r)) continue;
      rows.push(`
        <div class="trade-row">
          <div>${RESOURCES[r].icon}</div>
          <div>${RESOURCES[r].name}<div class="price">in store: ${Math.round(have)}</div></div>
          <div class="price ${trend}">${arrow} ${Math.round(mod * 100)}%</div>
          <div class="price">sell ${g.sellPrice(r).toFixed(1)}c · buy ${g.buyPrice(r).toFixed(1)}c</div>
          <div class="orders">
            sell&nbsp;›<input type="number" min="0" data-rule-sell="${r}" value="${rule?.sellAbove ?? ''}" placeholder="—">
            buy&nbsp;‹<input type="number" min="0" data-rule-buy="${r}" value="${rule?.buyBelow ?? ''}" placeholder="—">
          </div>
          <div class="acts">
            <button data-sell="${r}" data-n="10">Sell 10</button>
            <button data-sell="${r}" data-n="50">50</button>
            <button data-buy="${r}" data-n="10">Buy 10</button>
          </div>
        </div>`);
    }
    host.innerHTML = rows.join('') || '<p class="hint">Nothing to trade yet.</p>';
    for (const el of host.querySelectorAll('[data-sell]')) {
      (el as HTMLElement).onclick = () => {
        const res = (el as HTMLElement).dataset.sell as ResId;
        const r = g.sell(res, Number((el as HTMLElement).dataset.n));
        g.log(r.msg, r.ok ? 'good' : 'bad');
        this.renderTrade();
      };
    }
    for (const el of host.querySelectorAll('[data-buy]')) {
      (el as HTMLElement).onclick = () => {
        const res = (el as HTMLElement).dataset.buy as ResId;
        const r = g.buy(res, Number((el as HTMLElement).dataset.n));
        g.log(r.msg, r.ok ? 'good' : 'bad');
        this.renderTrade();
      };
    }
    const bindRule = (el: HTMLInputElement, res: ResId, kind: 'sellAbove' | 'buyBelow') => {
      el.onchange = () => {
        const v = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
        const rule = g.tradeRules[res] ?? {};
        rule[kind] = v;
        if (rule.sellAbove == null && rule.buyBelow == null) delete g.tradeRules[res];
        else g.tradeRules[res] = rule;
      };
    };
    for (const el of host.querySelectorAll('[data-rule-sell]')) {
      bindRule(el as HTMLInputElement, (el as HTMLElement).dataset.ruleSell as ResId, 'sellAbove');
    }
    for (const el of host.querySelectorAll('[data-rule-buy]')) {
      bindRule(el as HTMLInputElement, (el as HTMLElement).dataset.ruleBuy as ResId, 'buyBelow');
    }
  }

  // ----------------------------------------------------------------- people

  openPeople(): void { this.peopleOpen = true; $('people').classList.remove('hidden'); this.renderPeople(); }
  closePeople(): void { this.peopleOpen = false; $('people').classList.add('hidden'); }

  private renderPeople(): void {
    const g = this.game;
    const rows = [...g.villagers.values()]
      .sort((a, b) => (a.jobId === b.jobId ? a.id - b.id : (b.jobId < 0 ? -1 : 1)))
      .map((v) => {
        const job = v.jobId >= 0 ? g.buildings.get(v.jobId) : undefined;
        return `
          <div class="person">
            <div class="who"><b>${v.name}</b><span>${Math.floor(v.age)} years · ${v.jobTitle}</span></div>
            <div class="what">${job ? `${job.def.icon} ${job.name}` : 'Labourer'}</div>
            <div class="what">${v.activity}</div>
            <div><button class="btn" data-goto="${v.id}">Find</button></div>
          </div>`;
      });
    const host = $('people-list');
    host.innerHTML = rows.join('');
    for (const el of host.querySelectorAll('[data-goto]')) {
      (el as HTMLElement).onclick = () => {
        const v = g.villagers.get(Number((el as HTMLElement).dataset.goto));
        if (!v) return;
        this.cb.onFocus(v.x, v.y);
        this.selectVillager(v);
        this.closePeople();
      };
    }
  }

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info'): void {
    this.game.log(msg, kind);
    this.lastLogCount = -1;
  }
}
