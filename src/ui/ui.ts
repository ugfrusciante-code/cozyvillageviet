/**
 * All DOM: the HUD strip, village banner and alert pennants, bottom build
 * stack, minimap, overlays, tooltips, the windowed inspector with its tabs,
 * the ledger/people/menu/help windows, and the event log.
 */

import {
  ALL_RES, BUILDINGS, BUILDING_BY_ID, CAT_LABEL, CLOTHING_TYPES, CROPS, CROP_ORDER,
  FOOD_TYPES, HOUSE_TIERS, LUXURY_TYPES, RESOURCES, TUNING,
  type BuildCat, type BuildingDef, type CropType, type ResId,
} from '../sim/defs';
import { NODE_INDEX } from '../sim/world';
import type { Building } from '../sim/building';
import type { Game } from '../sim/game';
import { backlog, storageCapacity, storageUsed } from '../sim/systems/inventory';
import { foodDaysLeft } from '../sim/systems/labour';
import { MILESTONES } from '../sim/systems/milestones';
import type { Villager } from '../sim/villager';
import { I } from './icons';
import { pic } from './paint';
import { TRADE_TUNIC, buildingPortrait, villagerPortrait } from '../render/portraits';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Wire a click if the element exists; say so once if it does not.
 *
 * The markup and this file do not always move in the same commit — a UI
 * rework lands its HTML before its wiring, and one missing button must not
 * take the whole boot down with "cannot set onclick of null". A warning names
 * the orphan; everything else keeps working.
 */
const on = (id: string, fn: (ev: MouseEvent) => void): void => {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
  else console.warn(`[ui] no #${id} in the markup — its action is unwired`);
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Painted category glyphs, from the same set as the resources. */
const CAT_PIC: Record<BuildCat, string> = {
  housing: 'housing', gathering: 'gathering', farming: 'farming', crafting: 'crafting',
  civic: 'civic', logistics: 'logistics', decor: 'decor',
};

const ALERT_META: Record<string, { icon: string; label: string }> = {
  food: { icon: 'bread', label: 'Food' },
  fuel: { icon: 'fire', label: 'Firewood' },
  spoilage: { icon: 'skull', label: 'Spoilage' },
  homeless: { icon: 'homeless', label: 'Homeless' },
  market: { icon: 'market', label: 'No market' },
  idle: { icon: 'idle', label: 'Idle hands' },
  storage: { icon: 'logistics', label: 'Storage' },
  coin: { icon: 'coins', label: 'Treasury' },
  blocked: { icon: 'barrier', label: 'Building sites' },
  raid: { icon: 'sword', label: 'Raiders' },
};

/** The resources pinned to the top-right strip, lord's-eye view. */
const RES_STRIP: ResId[] = ['logs', 'planks', 'stone', 'firewood', 'tools', 'iron', 'grain', 'bread'];

/** Deterministic village name from the world seed. */
const NAME_A = ['Grün', 'Stein', 'Birken', 'Linden', 'Mühl', 'Eichen', 'Rosen', 'Hasel',
  'Tann', 'Falken', 'Hirsch', 'Kirch', 'Wiesen', 'Brunn', 'Ahorn', 'Immen'];
const NAME_B = ['bach', 'berg', 'feld', 'heim', 'hausen', 'stedt', 'dorf', 'reuth',
  'brand', 'lohe', 'walde', 'au', 'ried', 'tal'];
function villageNameFor(seed: number): string {
  const s = Math.abs(seed | 0);
  return NAME_A[s % NAME_A.length] + NAME_B[Math.floor(s / 13) % NAME_B.length];
}

type TradeFilter = 'all' | 'material' | 'food' | 'clothing' | 'good';
type TabName = 'Residential' | 'General' | 'People' | 'Advanced' | 'Trade';

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

  private tab: TabName = 'General';
  private selKey = '';
  private buildOpen = true;
  private overlayMode: 'none' | 'fertility' | 'charm' = 'none';
  private tradeFilter: TradeFilter = 'all';
  private lastLogCount = 0;
  private peopleOpen = false;
  private ledgerOpen = false;
  /** The ledger re-renders once a second, not per UI tick. */
  private ledgerDrawn = 0;
  private minimapDirty = 0;
  private tipFrom: 'hover' | 'api' = 'api';
  private saveToastTimer = 0;
  readonly villageName: string;

  constructor(private game: Game, private cb: UICallbacks) {
    this.villageName = villageNameFor(game.world.seed);
    const banner = document.getElementById('banner-name');
    if (banner) banner.textContent = this.villageName.toUpperCase();
    this.buildStatics();
    this.wire();
    this.wireTooltips();
    this.wireWindowDrag();
    this.renderFlyout();
  }

  // ------------------------------------------------------------------ wiring

  private buildStatics(): void {
    const portrait = document.getElementById('portrait');
    if (portrait) {
      portrait.innerHTML = `<div class="frame">${I.portrait}</div><div class="crest">${I.crest}</div>`;
      portrait.dataset.tip = `The Reeve of ${this.villageName}`;
      portrait.dataset.tipb = 'Your village, your ledger, your problems.';
    }

    // Playback orbs.
    const speeds = document.getElementById('speeds');
    if (speeds) {
      speeds.innerHTML = '';
      const opts: { label: string; v: number; tip: string }[] = [
        { label: '❚❚', v: 0, tip: 'Pause' }, { label: '▶', v: 1, tip: 'Normal speed' },
        { label: '▶▶', v: 2, tip: 'Double speed' }, { label: '▶▶▶', v: 5, tip: 'Fast' },
        { label: '▶▶▶▶', v: 10, tip: 'Fastest' },
      ];
      for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'orb';
        b.textContent = o.label;
        b.dataset.speed = String(o.v);
        b.dataset.tip = o.tip;
        b.onclick = () => { this.game.speed = o.v; this.refreshSpeeds(); };
        speeds.appendChild(b);
      }
    }

    // The main round menu.
    const menu = document.getElementById('mainmenu');
    if (menu) {
      menu.innerHTML = '';
      const items: { id: string; icon: string; tip: string; body: string }[] = [
        { id: 'roads', icon: I.road, tip: 'Roads', body: 'Drag <b>roads</b> across the ground. Villagers walk far faster on them.' },
        { id: 'build', icon: I.hammer, tip: 'Construction', body: 'Open and close the building rows.' },
        { id: 'people', icon: I.people, tip: 'Villagers', body: 'Every household, and who is doing what.' },
        { id: 'ledger', icon: I.scroll, tip: 'Village ledger', body: 'History, today’s flows, and where the hands are.' },
        { id: 'help', icon: I.question, tip: 'How to play', body: '' },
        { id: 'menu', icon: I.gear, tip: 'Village menu', body: 'Save, load, or start again.' },
      ];
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'orb orb-lg';
        b.innerHTML = `<span class="icn">${it.icon}</span>`;
        b.dataset.menu = it.id;
        b.dataset.tip = it.tip;
        b.setAttribute('aria-label', it.tip);
        if (it.body) b.dataset.tipb = it.body;
        menu.appendChild(b);
      }
      (menu.querySelector('[data-menu="roads"]') as HTMLElement).onclick = () => {
        const active = this.selectedDef === 'road';
        this.cb.onSelectBuildDef(active ? null : 'road');
        this.setBuildSelection(active ? null : 'road');
      };
      (menu.querySelector('[data-menu="build"]') as HTMLElement).onclick = () => {
        this.buildOpen = !this.buildOpen;
        this.renderFlyout();
      };
      (menu.querySelector('[data-menu="people"]') as HTMLElement).onclick = () => {
        if (this.peopleOpen) this.closePeople();
        else this.openPeople();
      };
      (menu.querySelector('[data-menu="ledger"]') as HTMLElement).onclick = () => {
        this.ledgerOpen = !this.ledgerOpen;
        $('ledger').classList.toggle('hidden', !this.ledgerOpen);
        if (this.ledgerOpen) { this.ledgerDrawn = 0; this.renderLedger(); }
      };
      (menu.querySelector('[data-menu="help"]') as HTMLElement).onclick = () => $('help').classList.toggle('hidden');
      (menu.querySelector('[data-menu="menu"]') as HTMLElement).onclick = () => {
        $('menu-status').textContent = this.cb.saveStatus();
        $('menu').classList.toggle('hidden');
      };
    }

    // Category orbs.
    const host = document.getElementById('buildcats');
    if (host) {
      host.innerHTML = '';
      const cats: BuildCat[] = ['housing', 'gathering', 'farming', 'crafting', 'civic', 'logistics', 'decor'];
      for (const c of cats) {
        const b = document.createElement('button');
        b.className = 'orb orb-md';
        b.innerHTML = pic(CAT_PIC[c], 19);
        b.dataset.cat = c;
        b.dataset.tip = CAT_LABEL[c];
        b.setAttribute('aria-label', CAT_LABEL[c]);
        b.onclick = () => {
          this.cat = this.cat === c ? null : c;
          this.renderFlyout();
        };
        host.appendChild(b);
      }
    }

    // Window-head icons.
    const heads: [string, string][] = [
      ['insp-help', I.question], ['insp-pause', I.pause], ['insp-focus', I.focus],
      ['insp-close', I.close], ['ledger-close', I.close], ['people-close', I.close],
      ['menu-close', I.close], ['help-close', I.close],
    ];
    for (const [id, icon] of heads) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = icon;
    }
  }

  private wire(): void {
    on('insp-close', () => this.clearSelection());
    on('insp-help', () => $('help').classList.remove('hidden'));
    on('insp-pause', () => {
      const b = this.selectedBuilding;
      if (b) { b.paused = !b.paused; this.renderInspector(); }
    });
    on('insp-focus', () => {
      const b = this.selectedBuilding, v = this.selectedVillager;
      if (b) this.cb.onFocus(b.cx, b.cy);
      else if (v) this.cb.onFocus(v.x, v.y);
    });

    on('people-close', () => this.closePeople());
    on('help-close', () => $('help').classList.add('hidden'));
    on('ledger-close', () => { this.ledgerOpen = false; $('ledger').classList.add('hidden'); });

    on('menu-close', () => $('menu').classList.add('hidden'));
    on('menu-save', () => { this.cb.onSave(); $('menu-status').textContent = this.cb.saveStatus(); });
    on('menu-load', () => this.cb.onLoad());
    on('menu-export', () => this.cb.onExport());
    // Destructive, so it asks twice: the first click arms the button, the
    // second within a few seconds actually starts over.
    let armedAt = 0;
    on('menu-new', () => {
      const btn = $('menu-new');
      if (performance.now() - armedAt < 4000) {
        btn.textContent = 'Start a new village';
        this.cb.onNewGame();
        $('menu').classList.add('hidden');
        return;
      }
      armedAt = performance.now();
      btn.textContent = 'Click again to abandon this village';
      setTimeout(() => { if (performance.now() - armedAt >= 4000) btn.textContent = 'Start a new village'; }, 4200);
    });
    on('menu-import', () => ($('menu-file') as HTMLInputElement).click());
    const fileInput = document.getElementById('menu-file') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.onchange = (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) this.cb.onImport(f);
      };
    }

    const ovDock = document.getElementById('overlaydock');
    if (ovDock) {
      for (const el of ovDock.querySelectorAll('button')) {
        (el as HTMLElement).onclick = () => {
          for (const o of ovDock.querySelectorAll('button')) o.classList.remove('on');
          el.classList.add('on');
          this.overlayMode = ((el as HTMLElement).dataset.ov ?? 'none') as 'none' | 'fertility' | 'charm';
          this.cb.onOverlay(this.overlayMode);
        };
      }
    }

    const mm = document.getElementById('minimap') as HTMLCanvasElement | null;
    if (mm) {
      mm.onclick = (e) => {
        const r = mm.getBoundingClientRect();
        const n = this.game.world.size;
        const x = ((e.clientX - r.left) / r.width) * n;
        const y = ((e.clientY - r.top) / r.height) * n;
        this.cb.onFocus(x, y);
      };
    }
  }

  /** One delegated handler renders every `[data-tip]` hover as a styled tooltip. */
  private wireTooltips(): void {
    document.addEventListener('pointerover', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      const el = t.closest('[data-tip]') as HTMLElement | null;
      if (el) {
        this.tipFrom = 'hover';
        this.showTipFor(el);
      } else if (this.tipFrom === 'hover') {
        this.forceHideTip();
      }
    });
    document.addEventListener('pointerdown', () => {
      if (this.tipFrom === 'hover') this.forceHideTip();
    }, true);
    document.documentElement.addEventListener('pointerleave', () => {
      if (this.tipFrom === 'hover') this.forceHideTip();
    });
  }

  private showTipFor(el: HTMLElement): void {
    const tip = $('tooltip');
    const title = el.dataset.tip ?? '';
    const body = el.dataset.tipb ?? '';
    const cost = el.dataset.tipc ?? '';
    tip.innerHTML = `<span class="tt">${title}</span>` +
      (body ? `<span class="tb">${body}</span>` : '') +
      (cost ? `<span class="tc">${cost}</span>` : '');
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const below = r.top + r.height / 2 < window.innerHeight / 2;
    const y = below ? r.bottom + 9 : r.top - h - 9;
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  /** Drag the inspector window around by its header, the way a window should. */
  private wireWindowDrag(): void {
    const head = document.getElementById('insp-head');
    const win = document.getElementById('inspector');
    if (!head || !win) return;
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.win-hbtn')) return;
      e.preventDefault();
      const r = win.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const move = (ev: PointerEvent) => {
        const x = Math.max(4, Math.min(window.innerWidth - r.width - 4, ev.clientX - ox));
        const y = Math.max(4, Math.min(window.innerHeight - 60, ev.clientY - oy));
        win.style.left = `${x}px`;
        win.style.top = `${y}px`;
        win.style.right = 'auto';
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  private refreshSpeeds(): void {
    for (const b of $('speeds').querySelectorAll('button')) {
      b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === this.game.speed);
    }
    const badge = document.getElementById('pausebadge');
    if (badge) badge.classList.toggle('hidden', this.game.speed !== 0);
  }

  // --------------------------------------------------------- bottom build bar

  private lockReason(d: BuildingDef): string | null {
    if (d.minPop && this.game.population < d.minPop) return `Needs ${d.minPop} villagers`;
    if (d.needs) {
      for (const n of d.needs) {
        if (!this.game.hasBuilding(n)) return `Needs a ${BUILDING_BY_ID[n].name}`;
      }
    }
    return null;
  }

  private renderFlyout(): void {
    $('buildcats').classList.toggle('hidden', !this.buildOpen);
    const menu = $('mainmenu');
    const buildBtn = menu.querySelector('[data-menu="build"]') as HTMLElement | null;
    if (buildBtn) buildBtn.classList.toggle('on', this.buildOpen);
    const roadBtn = menu.querySelector('[data-menu="roads"]') as HTMLElement | null;
    if (roadBtn) roadBtn.classList.toggle('on', this.selectedDef === 'road');
    for (const b of $('buildcats').querySelectorAll('button')) {
      b.classList.toggle('on', (b as HTMLElement).dataset.cat === this.cat);
    }

    const flyout = $('buildflyout');
    if (!this.cat || !this.buildOpen) {
      flyout.classList.add('hidden');
    } else {
      flyout.classList.remove('hidden');
      const grid = $('flyout-grid');
      grid.innerHTML = '';
      for (const d of BUILDINGS.filter((x) => x.cat === this.cat && x.id !== 'road')) {
        grid.appendChild(this.buildCard(d));
      }
    }
    this.updatePlacehint();
  }

  private buildCard(d: BuildingDef): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bcard';
    el.dataset.def = d.id;

    const lock = this.lockReason(d);
    if (lock) el.classList.add('locked');
    if (this.selectedDef === d.id) el.classList.add('on');

    const cost = Object.entries(d.cost)
      .map(([k, v]) => `${pic(k, 11)}${Math.round(v as number)}`)
      .join('') || 'free';

    const portrait = buildingPortrait(d.id, 176, 112);
    el.innerHTML = `
      <div class="art art-${d.palette}">${portrait ? '' : `<span class="ei">${d.icon}</span>`}</div>
      <div class="cost">${cost}</div>
      ${lock ? `<span class="lockmark">${I.lock}</span>` : ''}`;
    if (portrait) {
      (el.querySelector('.art') as HTMLElement).style.backgroundImage = `url(${portrait})`;
    }

    el.dataset.tip = d.name;
    el.dataset.tipb = esc(d.desc) + (lock ? ` <span class="bad">${esc(lock)}.</span>` : '');
    const costText = Object.entries(d.cost)
      .map(([k, v]) => `${pic(k, 12)} ${Math.round(v as number)}`).join(' · ') || 'Free';
    el.dataset.tipc = costText + (d.zone ? ' · drag to size' : '');

    el.onclick = () => {
      if (lock) return;
      this.selectedDef = this.selectedDef === d.id ? null : d.id;
      this.cb.onSelectBuildDef(this.selectedDef);
      this.renderFlyout();
    };
    return el;
  }

  private updatePlacehint(): void {
    const host = document.getElementById('placehint');
    if (!host) return;
    if (!this.selectedDef) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    const d = BUILDING_BY_ID[this.selectedDef];
    const item = (icon: string, label: string) =>
      `<span class="hitem">${icon}<span>${label}</span></span>`;
    const kbd = (k: string) => `<span class="kbd">${k}</span>`;
    const sep = '<span class="hsep">◆</span>';
    const parts: string[] = [];
    if (d.id === 'road') parts.push(item(`<span class="icn">${I.mouseDrag}</span>`, 'DRAG TO DRAW'));
    else if (d.zone) parts.push(item(`<span class="icn">${I.mouseDrag}</span>`, 'DRAG OUT THE PLOT'));
    else parts.push(item(`<span class="icn">${I.mouseL}</span>`, 'PLACE'));
    if (!d.zone && d.id !== 'road') parts.push(item(kbd('R'), 'ROTATE'));
    parts.push(item(kbd('SHIFT'), 'KEEP PLACING'));
    parts.push(item(`<span class="icn">${I.mouseR}</span>`, 'CANCEL'));
    host.innerHTML = parts.join(sep);
  }

  setBuildSelection(defId: string | null): void {
    this.selectedDef = defId;
    if (defId) {
      const d = BUILDING_BY_ID[defId];
      if (d && d.cat !== this.cat && d.id !== 'road') this.cat = d.cat;
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
    this.selKey = '';
    $('inspector').classList.add('hidden');
  }

  // ---------------------------------------------------------------- tooltip

  showTooltip(html: string, x: number, y: number): void {
    const tip = $('tooltip');
    this.tipFrom = 'api';
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const pad = 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, x + pad)}px`;
    tip.style.top = `${Math.min(window.innerHeight - h - 8, y + pad)}px`;
  }

  /**
   * The frame loop calls this constantly whenever the pointer is off the
   * canvas — it must not eat tooltips owned by a hovered UI element.
   */
  hideTooltip(): void {
    if (this.tipFrom === 'hover') return;
    $('tooltip').classList.add('hidden');
  }

  private forceHideTip(): void {
    this.tipFrom = 'api';
    $('tooltip').classList.add('hidden');
  }

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

  // ------------------------------------------------------------------ frame

  update(): void {
    const g = this.game;
    this.refreshSpeeds();

    const season = g.season[0].toUpperCase() + g.season.slice(1);
    const dateline = document.getElementById('dateline');
    if (dateline) {
      dateline.innerHTML =
        `<span class="icn">${I.sun}</span><span>${season} · Day ${g.dayOfSeason + 1}</span>` +
        `<span class="yr">YEAR ${g.year}</span>`;
    }

    this.renderTopStats();
    this.renderResources();
    this.renderTreasury();
    this.renderAlerts();
    this.renderLog();
    this.renderMinimap();

    if (this.selectedBuilding && !g.buildings.has(this.selectedBuilding.id)) this.clearSelection();
    if (this.selectedVillager && !g.villagers.has(this.selectedVillager.id)) this.clearSelection();
    if (this.selectedBuilding || this.selectedVillager) this.renderInspector();
    if (this.peopleOpen) this.renderPeople();
    if (this.ledgerOpen && performance.now() - this.ledgerDrawn > 1000) this.renderLedger();
  }

  private renderTopStats(): void {
    const g = this.game;
    const host = document.getElementById('tl-stats');
    if (!host) return;
    const famCount = [...g.families.values()].filter((f) => f.memberIds.length > 0).length;
    let houses = 0;
    for (const b of g.buildings.values()) if (b.isHouse && b.state === 'active') houses++;
    const content = Math.round(g.averageContentment * 100);
    const hist = g.stats.contentHistory;
    const prev = hist.length > 1 ? hist[hist.length - 2] : g.averageContentment;
    const trend = g.averageContentment - prev;
    const employedPct = g.adults > 0 ? Math.round((g.employed / g.adults) * 100) : 0;
    const ale = Math.round(g.stockOf('ale'));

    const stat = (icon: string, val: string, tip: string, body: string, crit = false, extra = '') =>
      `<div class="tstat ${crit ? 'crit' : ''}" data-tip="${esc(tip)}" data-tipb="${esc(body)}">` +
      `${pic(icon, 14)}<span>${val}</span>${extra}</div>`;
    const sep = '<span class="tsep">◆</span>';

    const trendArrow = trend > 0.005 ? '<span class="trend up">▲</span>'
      : trend < -0.005 ? '<span class="trend down">▼</span>' : '';

    host.innerHTML = [
      stat('family', String(famCount), 'Families', 'Households living in the village.'),
      stat('housing', String(houses), 'Homes', 'Houses standing, hovel to burgage house.'),
      stat('person', String(g.population), 'Population', `${g.adults} adults · ${g.population - g.adults} children. Click for the roster.`),
      stat('approval', `${content}%`, 'Approval', 'Average contentment. Above 56% families grow; below 24% they pack up.', content < 40, trendArrow),
      stat('scales', `${employedPct}%`, 'Hands at work', `${g.employed} of ${g.adults} adults have a post.`),
      stat('idle', String(g.idleAdults), 'Labour pool', 'Adults without a post. They haul goods and fill building sites.'),
      stat('ox', String(g.oxenTotal), 'Draught oxen', `${g.oxenInUse} of ${g.oxenTotal} pulling carts right now.`),
      stat('ale', String(ale), 'Ale in store', 'The tavern pours it; the brewery brews it.'),
    ].join(sep);
    const pop = host.querySelectorAll('.tstat')[2] as HTMLElement | undefined;
    if (pop) {
      pop.onclick = () => this.openPeople();
      pop.style.cursor = 'pointer';
    }
  }

  private renderResources(): void {
    const g = this.game;
    const host = document.getElementById('resbar');
    if (!host) return;
    const parts: string[] = [];
    for (const r of RES_STRIP) {
      const amt = g.stockOf(r);
      const flow = g.netFlow(r);
      const low = (r === 'firewood' && amt < g.population) || (RESOURCES[r].food && amt < g.population);
      const d = flow > 0.5 ? `Gaining ${flow.toFixed(0)} a day.` : flow < -0.5 ? `Losing ${Math.abs(flow).toFixed(0)} a day.` : 'Holding steady.';
      parts.push(
        `<div class="tstat ${low ? 'crit' : ''}" data-tip="${esc(RESOURCES[r].name)}" data-tipb="${d}">` +
        `${pic(r, 14)}<span>${Math.round(amt)}</span></div>`,
      );
    }
    host.innerHTML = parts.join('<span class="tsep">◆</span>');
  }

  private renderTreasury(): void {
    const g = this.game;
    const host = document.getElementById('treasury');
    if (!host) return;
    const income = g.stats.lastTax + g.stats.lastTradeIncome - g.stats.lastUpkeep;
    const days = foodDaysLeft(g);
    const deltaCls = income > 0 ? 'pos' : income < 0 ? 'neg' : '';
    host.innerHTML =
      `<div class="trow ${g.coin < 0 ? 'crit' : ''}" data-tip="Treasury" data-tipb="Last season: tax ${Math.round(g.stats.lastTax)} · trade ${Math.round(g.stats.lastTradeIncome)} · upkeep −${Math.round(g.stats.lastUpkeep)}.">` +
      `${pic('coins', 15)}<span>${Math.round(g.coin)}</span>` +
      `<span class="delta ${deltaCls}">${income >= 0 ? '+' : ''}${Math.round(income)}</span></div>` +
      `<div class="trow ${days < 4 ? 'crit' : ''}" data-tip="Days of food" data-tipb="How long the stores last at today’s appetite.">` +
      `${pic('bread', 13)}<span>${days.toFixed(0)}d</span></div>`;
  }

  private renderAlerts(): void {
    const host = document.getElementById('alerts');
    if (!host) return;
    host.innerHTML = this.game.alerts.map((a) => {
      const meta = ALERT_META[a.id] ?? { icon: '⚠️', label: 'Warning' };
      const num = a.text.match(/\d+(\.\d+)?/);
      const n = num ? Math.round(parseFloat(num[0])) : null;
      return `<div class="abadge ${a.severity === 'danger' ? '' : 'warn'}" ` +
        `data-tip="${esc(meta.label)}" data-tipb="${esc(a.text)}.">` +
        pic(meta.icon, 14) +
        (n != null && n < 100 ? `<span class="n">${n}</span>` : '') + '</div>';
    }).join('');
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
          if (w.water[i]) col = '#2e4b5e';
          else if (w.road[i]) col = '#63492e';
          else if (w.node[i] === NODE_INDEX['tree']) col = '#2b3f2c';
          else {
            const f = w.fertility[i];
            col = f > 0.5 ? '#57703f' : f > 0.3 ? '#657149' : '#6f6a52';
          }
          ctx.fillStyle = col;
          ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
        }
      }
      for (const b of g.buildings.values()) {
        ctx.fillStyle = b.state !== 'active' ? '#c39a45'
          : b.isHouse ? '#a45c38'
          : b.def.cat === 'farming' ? '#a58e55'
          : '#c5b799';
        ctx.fillRect(b.x * s, b.y * s, Math.max(2, b.w * s), Math.max(2, b.h * s));
      }
    }

    // Camera marker: a wedge showing position + facing.
    const cam = this.cb.getCamera();
    ctx.save();
    ctx.translate(cam.x * s, cam.z * s);
    ctx.rotate(-cam.yaw);
    ctx.strokeStyle = 'rgba(243, 234, 213, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-6, 6);
    ctx.lineTo(0, -7);
    ctx.lineTo(6, 6);
    ctx.stroke();
    ctx.restore();
    this.minimapDirty = Math.min(this.minimapDirty, 10);
  }

  // ============================================================== inspector

  private tabsFor(b: Building | null, v: Villager | null): TabName[] {
    if (v || !b) return ['General'];
    if (b.state !== 'active') return ['General'];
    if (b.isHouse) return ['Residential', 'General', 'People'];
    if (b.def.id === 'tradepost') return ['General', 'People', 'Advanced', 'Trade'];
    if (b.jobSlots > 0 || b.def.jobs > 0) return ['General', 'People', 'Advanced'];
    return ['General'];
  }

  private defaultTab(b: Building | null): TabName {
    if (b && b.state === 'active') {
      if (b.isHouse) return 'Residential';
      if (b.def.id === 'tradepost') return 'Trade';
    }
    return 'General';
  }

  private renderInspector(): void {
    const panel = $('inspector');
    const b = this.selectedBuilding, v = this.selectedVillager;
    if (!b && !v) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    const key = b ? `b${b.id}:${b.state}` : `v${v!.id}`;
    if (key !== this.selKey) {
      this.selKey = key;
      this.tab = this.defaultTab(b);
      this.renderChrome();
    }

    $('insp-pause').classList.toggle('hidden', !b);
    if (b) $('insp-pause').classList.toggle('on', b.paused);

    const body = $('insp-body');
    if (body.querySelector('select:focus, input:focus')) return;
    const scroll = body.scrollTop;
    this.renderBody();
    body.scrollTop = scroll;
  }

  private renderChrome(): void {
    const b = this.selectedBuilding, v = this.selectedVillager;
    const title = b ? (b.isHouse ? b.tierDef().name : b.name) : v ? v.name : '—';
    $('insp-title').textContent = title;
    $('insp-sub').textContent = this.villageName;

    const hero = $('insp-hero');
    const canHire = !!b && b.state === 'active' && !b.isHouse && (b.jobSlots > 0 || b.def.jobs > 0);
    let discHtml = pic('person', 27);
    hero.style.backgroundImage = '';
    if (b) {
      const portrait = buildingPortrait(b.def.id, 420, 200);
      if (portrait) {
        hero.style.backgroundImage =
          `linear-gradient(180deg, rgba(16,14,11,0.10) 30%, rgba(16,14,11,0.66) 100%), url(${portrait})`;
      }
      discHtml = pic(CAT_PIC[b.def.cat], 27);
    } else if (v) {
      const face = this.faceFor(v);
      if (face) discHtml = `<img class="facebig" src="${face}" alt="">`;
    }
    hero.innerHTML =
      `<div class="disc">${discHtml}</div>` +
      (canHire ? `<button class="disc-plus" data-tip="Open another post" data-tipb="Raises this workplace’s worker cap by one.">${I.plus}</button>` : '');
    if (canHire) {
      (hero.querySelector('.disc-plus') as HTMLElement).onclick = () => {
        const bb = this.selectedBuilding;
        if (bb) this.game.setJobSlots(bb.id, bb.jobSlots + 1);
        this.renderInspector();
      };
    }

    const tabs = this.tabsFor(b, v);
    const host = $('insp-tabs');
    host.innerHTML = tabs.map((t) =>
      `<button data-tab="${t}" class="${t === this.tab ? 'on' : ''}">${t}</button>`).join('');
    for (const el of host.querySelectorAll('button')) {
      (el as HTMLElement).onclick = () => {
        this.tab = (el as HTMLElement).dataset.tab as TabName;
        for (const o of host.querySelectorAll('button')) o.classList.toggle('on', o === el);
        this.renderBody();
      };
    }
  }

  private renderBody(): void {
    const b = this.selectedBuilding, v = this.selectedVillager;
    const body = $('insp-body');
    let out: string[] = [];
    if (v) out = this.partsVillager(v);
    else if (b && b.state !== 'active') out = this.partsConstruction(b);
    else if (b) {
      switch (this.tab) {
        case 'Residential': out = this.partsResidential(b); break;
        case 'People': out = b.isHouse ? this.partsPeopleHouse(b) : this.partsPeopleWork(b); break;
        case 'Advanced': out = this.partsAdvanced(b); break;
        case 'Trade': out = this.partsTrade(); break;
        default: out = b.isHouse ? this.partsGeneralHouse(b) : this.partsGeneralWork(b);
      }
    }
    body.innerHTML = out.join('');
    if (b) this.wireBody(b);
    if (v) this.wireVillagerBody(v);
  }

  // ------------------------------------------------------------ html helpers

  /** A villager's little rendered portrait, dressed for their trade. */
  private faceFor(v: Villager): string | null {
    const job = v.jobId >= 0 ? this.game.buildings.get(v.jobId) : undefined;
    const key = job ? job.def.cat : v.isAdult ? 'labourer' : 'child';
    const tunic = TRADE_TUNIC[key] ?? TRADE_TUNIC.labourer;
    return villagerPortrait(tunic, { hat: v.isAdult });
  }

  private faceImg(v: Villager, s = 18): string {
    const url = this.faceFor(v);
    return url
      ? `<img class="face" style="width:${s}px;height:${s}px" src="${url}" alt="">`
      : pic('person', s);
  }

  private row(label: string, value: string, opts: { icon?: string; cls?: string; vcls?: string } = {}): string {
    return `<div class="mrow ${opts.cls ?? ''}"><span class="lbl">` +
      (opts.icon ? pic(opts.icon, 15) : '') +
      `<span>${label}</span></span><span class="val ${opts.vcls ?? ''}">${value}</span></div>`;
  }

  private pips(count: number, total: number, bad = false): string {
    let s = '<span class="pips">';
    for (let i = 0; i < total; i++) {
      s += `<span class="pip ${i < count ? 'on' : bad ? 'bad' : ''}"></span>`;
    }
    return s + '</span>';
  }

  private sec(label: string, opts: { icon?: string; caps?: boolean; tip?: string } = {}): string {
    return `<div class="sec ${opts.caps ? 'caps' : ''}">` +
      (opts.icon ? pic(opts.icon, 14) : '') +
      `<span>${label}</span>` +
      (opts.tip ? `<span class="qm" data-tip="${esc(label)}" data-tipb="${esc(opts.tip)}">${I.question}</span>` : '') +
      '</div>';
  }

  private bar(pct: number, cls = ''): string {
    return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  }

  // -------------------------------------------------------------- tab bodies

  private partsConstruction(b: Building): string[] {
    const out: string[] = [];
    const d = b.def;
    out.push(`<p>${d.desc}</p>`);
    out.push(this.sec('Under construction', { caps: true }));
    if (d.zone) out.push(this.row('Plot', `${b.w}×${b.h} · ${b.area} tiles`));
    const owed = b.materialsOwed('delivered');
    const owedEntries = Object.entries(owed);
    if (owedEntries.length) {
      out.push(this.sec('Waiting on materials', {
        tip: 'Hauliers bring what the site needs from the stores. If the village owns none of it, build the workshop that makes it.',
      }));
      for (const [k, amt] of owedEntries) {
        const r = RESOURCES[k as ResId];
        out.push(this.row(r.name, `${Math.ceil(amt as number)} short`, { icon: k, vcls: 'neg' }));
      }
    } else {
      const pct = Math.round(b.buildFraction * 100);
      out.push(this.row('Frame raised', `${pct}%`));
      out.push(this.bar(pct));
    }
    out.push(`<div class="btn-row">
      <button class="btn" data-act="pause">${b.paused ? 'Resume' : 'Hold'}</button>
      <button class="btn danger" data-act="cancel">Cancel</button></div>`);
    return out;
  }

  private partsResidential(b: Building): string[] {
    const out: string[] = [];
    const s = b.supply;
    const next = HOUSE_TIERS[b.tier];

    out.push(this.sec('REQUIREMENTS', {
      caps: true, icon: 'coins',
      tip: 'What this home draws from wells, taverns, churches and the market stalls. Filled diamonds are needs being met.',
    }));

    out.push(this.sec('Amenities', { icon: 'ale', tip: 'Services with this home inside their reach.' }));
    const faith = (b.services as Record<string, number | undefined>).faith ?? 0;
    out.push(this.row('Water access', this.pips(b.services.water ? 1 : 0, 1), { icon: 'water' }));
    out.push(this.row('Tavern supply', this.pips(b.services.leisure ? 1 : 0, 1), { icon: 'ale' }));
    out.push(this.row('Church level', this.pips(faith >= 2 ? 2 : faith >= 1 ? 1 : 0, 2), { icon: 'civic' }));
    out.push(this.row('Healer', this.pips(b.services.health ? 1 : 0, 1), { icon: 'healer' }));
    out.push(this.row('Schooling', this.pips(b.services.learning ? 1 : 0, 1), { icon: 'book' }));

    out.push(this.sec('Market supply', { icon: 'market', tip: 'What actually reached this household from the stalls lately.' }));
    out.push(this.row('Fuel stall supply', this.pips(s.fuelDays > 0.4 ? 1 : 0, 1), { icon: 'fire' }));
    out.push(this.row('Food stall supply', this.pips(Math.min(3, s.foodTypes.size), 3), { icon: 'bread' }));
    out.push(this.row('Clothing stall supply', this.pips(Math.min(2, s.clothingTypes.size), 2), { icon: 'clothes' }));
    out.push(this.row('Comfort goods', this.pips(Math.min(2, s.luxuryTypes.size), 2), { icon: 'pottery' }));

    out.push(this.sec('Surroundings', { icon: 'charm', tip: 'Local charm from wells, chapels, gardens and decor. Tier 3 homes demand 14.' }));
    out.push(this.row('Charm', this.pips((b.localCharm >= 4 ? 1 : 0) + (b.localCharm >= 14 ? 1 : 0), 2), { icon: 'charm' }));

    if (next) {
      out.push(this.sec(`To become a ${next.name}`, { caps: true }));
      if (b.upgradeBlockers.length === 0) {
        out.push('<p>Everything is in place. It will upgrade shortly.</p>');
      } else {
        for (const blocker of b.upgradeBlockers) {
          out.push(`<div class="mrow req"><span class="lbl"><span>${esc(blocker)}</span></span><span class="val">${this.pips(0, 1, true)}</span></div>`);
        }
      }
    } else {
      out.push(this.sec('Fully grown', { caps: true }));
      out.push('<p>This is as fine as a house gets.</p>');
    }
    out.push('<div class="btn-row"><button class="btn danger" data-act="demolish">Demolish</button></div>');
    return out;
  }

  private partsGeneralHouse(b: Building): string[] {
    const g = this.game;
    const out: string[] = [];
    const tierDef = b.tierDef();
    out.push(this.sec('Household', { caps: true }));
    out.push(this.row('Families', `${b.families} / ${b.capacityFamilies}`, { icon: 'family' }));
    out.push(this.row('Residents', `${b.residents.length} / ${b.capacityResidents}`, { icon: 'person' }));
    const fams = b.familyIds.map((id) => g.families.get(id)).filter(Boolean);
    const born = fams.reduce((n, f) => n + (f?.childrenBorn ?? 0), 0);
    if (born > 0) out.push(this.row('Children raised here', String(born), { icon: 'family' }));
    out.push(this.row('Tax each season', `${Math.round(tierDef.tax * b.families)}c`, { icon: 'coins' }));
    const cPct = Math.round(b.contentment * 100);
    out.push(this.row('Contentment', `${cPct}%`));
    out.push(this.bar(cPct, cPct < 40 ? 'hot' : cPct < 65 ? '' : 'cool'));
    if (b.rationing) out.push('<p>Rationing from the storehouse — the stalls were bare.</p>');

    if (b.moodParts.length) {
      out.push(this.sec('What the household feels', {
        tip: 'Every mood source. A bar shows a need against its ceiling; a signed number is an event — a birth lifts, mourning weighs.',
      }));
      const ranked = [...b.moodParts].sort((a, z) => (a[2] - a[1]) - (z[2] - z[1])).reverse();
      for (const [label, earned, ceiling] of ranked) {
        if (ceiling === 0) {
          const up = earned > 0;
          out.push(this.row(label, `${up ? '+' : '−'}${Math.abs(earned * 100).toFixed(0)}`, { vcls: up ? 'pos' : 'neg' }));
          continue;
        }
        const pct = Math.round((earned / ceiling) * 100);
        out.push(this.row(label, `${(earned * 100).toFixed(0)} of ${(ceiling * 100).toFixed(0)}`));
        out.push(this.bar(pct, pct < 35 ? 'hot' : ''));
      }
    }

    out.push(this.sec('Supplied', { caps: true }));
    out.push('<div class="tags">');
    const s = b.supply;
    for (const f of FOOD_TYPES) if (s.foodTypes.has(f)) out.push(`<span class="tag ok">${pic(f, 12)}${RESOURCES[f].name}</span>`);
    for (const c of CLOTHING_TYPES) if (s.clothingTypes.has(c)) out.push(`<span class="tag ok">${pic(c, 12)}${RESOURCES[c].name}</span>`);
    for (const l of LUXURY_TYPES) if (s.luxuryTypes.has(l)) out.push(`<span class="tag ok">${pic(l, 12)}${RESOURCES[l].name}</span>`);
    out.push(s.fuelDays > 0.4 ? `<span class="tag ok">${pic('fire', 12)}Warm</span>` : `<span class="tag no">${pic('fire', 12)}Cold</span>`);
    out.push('</div>');

    out.push(this.supplyLinesHtml(b));
    return out;
  }

  private partsPeopleHouse(b: Building): string[] {
    const g = this.game;
    const out: string[] = [];
    const fams = b.familyIds.map((id) => g.families.get(id)).filter(Boolean);
    for (const f of fams) {
      out.push(this.sec(`The ${f!.surname}s`, { caps: true }));
      const members = f!.memberIds
        .map((id) => g.villagers.get(id))
        .filter((x): x is Villager => !!x)
        .sort((a, z) => z.age - a.age);
      for (const m of members) {
        out.push(`<div class="mrow" data-selv="${m.id}" style="cursor:pointer">` +
          `<span class="lbl">${this.faceImg(m)}<span>${esc(m.name)}</span></span>` +
          `<span class="val dim">${Math.floor(m.age)} · ${esc(m.jobTitle)}</span></div>`);
      }
    }
    if (!fams.length) out.push('<p>Nobody lives here yet.</p>');
    return out;
  }

  private partsPeopleWork(b: Building): string[] {
    const g = this.game;
    const out: string[] = [];
    out.push(this.sec('Workers', { caps: true, tip: 'Villagers posted here. Open more posts and the idle will take them.' }));
    out.push(`<div class="mrow"><span class="lbl"><span>Posts filled</span></span>
      <span class="val"><span class="stepper">
        <button class="orb" data-act="minus"><span class="icn">${I.minus}</span></button>
        <span class="v">${b.workers.length} / ${b.jobSlots}</span>
        <button class="orb" data-act="plus"><span class="icn">${I.plus}</span></button>
      </span></span></div>`);
    for (const id of b.workers) {
      const w = g.villagers.get(id);
      if (!w) continue;
      out.push(`<div class="mrow" data-selv="${w.id}" style="cursor:pointer">` +
        `<span class="lbl">${this.faceImg(w)}<span>${esc(w.name)}</span></span>` +
        `<span class="val dim">${esc(w.activity)}</span></div>`);
    }
    if (!b.workers.length) out.push('<p>Nobody is posted here. Open a post, or check the labour pool.</p>');
    return out;
  }

  private partsGeneralWork(b: Building): string[] {
    const g = this.game;
    const d = b.def;
    const out: string[] = [];
    out.push(`<p>${d.desc}</p>`);

    if (b.jobSlots > 0 || d.jobs > 0) {
      out.push(this.row('Status', `<span style="font-weight:600;font-size:12px">${esc(b.status)}</span>`));
      const act = Math.round(Math.min(1, b.activity) * 100);
      out.push(this.bar(act, act < 25 ? 'hot' : ''));
    }

    // --- Farms with a crop cycle
    if (d.crop) {
      out.push(this.sec('The farming year', { caps: true }));
      out.push(this.row('Plot', `${b.w}×${b.h} · ${b.area} tiles`));
      out.push(this.row('Soil', `${Math.round(b.fertility * 100)}%`, { icon: 'herbs' }));
      const phase = g.season === 'spring' ? (b.sown ? 'Sown — growing' : 'Sowing')
        : g.season === 'summer' ? (b.sown ? 'Growing' : 'Not sown!')
        : g.season === 'autumn' ? (b.cropPool > 0.01 ? 'Harvest!' : 'Harvest done')
        : 'Dormant';
      out.push(this.row('Phase', phase));
      const growPct = Math.round(b.growth * 100);
      out.push(this.row('Crop', `${growPct}%`, { icon: CROPS[b.cropType].out }));
      out.push(this.bar(growPct));
      if (g.season === 'autumn' && b.cropPoolInit > 0.02) {
        const reaped = Math.round((1 - b.cropPool / b.cropPoolInit) * 100);
        out.push(this.row('Reaped', `${reaped}%`));
      }
      const standing = b.standingCrop;
      const est = Math.round(
        b.growth * standing.yieldPerTile * b.area * (0.35 + b.fertility * 0.9) * b.rotationFactor,
      );
      out.push(this.row('Standing yield', `≈ ${est} ${RESOURCES[standing.out].name}`, { icon: standing.out }));
      if (b.sown) out.push(this.row('This year’s yield', `×${b.rotationFactor.toFixed(2)}`));
    }

    // --- Herds (pasture): the flock is the whole story of this building.
    if (d.husbandry) {
      const h = d.husbandry;
      const cap = Math.max(2, Math.floor(b.area / h.tilesPerHead));
      out.push(this.sec('The flock', { caps: true }));
      out.push(this.row('Paddock', `${b.w}×${b.h} · room for ${cap} head`));
      out.push(this.row(`${h.animal[0].toUpperCase()}${h.animal.slice(1)}`, `${b.herd} of ${cap}`));
      out.push(this.bar(Math.round((b.herd / cap) * 100)));
      if (b.herd > 0 && b.herd < cap) {
        out.push(this.row('Next lamb', `${Math.round(b.breedProgress * 100)}%`));
      }
      let fodder = 0;
      for (const k of h.fodder.kinds) fodder += b.amount(k);
      const days = b.herd > 0 ? fodder / (b.herd * h.fodder.perHeadDay) : Infinity;
      out.push(this.row('Winter fodder',
        b.herd <= 0 ? '—' : days === Infinity ? '—' : `${Math.floor(days)} days`,
        { icon: 'grain' }));
      if (this.game.season === 'winter' && b.herd > 0 && days < 2) {
        out.push('<p class="crit">The shelf is nearly bare — lay in grain or turnips or the flock starves.</p>');
      }
      out.push(this.row('Shearing', `${h.tend.perHead} ${RESOURCES[h.tend.out].name} per head`, { icon: h.tend.out }));
    }

    if (d.recipe) {
      out.push(this.sec('Recipe', { caps: true }));
      const ins = Object.entries(d.recipe.in).map(([k, v]) => `${pic(k, 12)}${v}`).join(' + ') || '—';
      const outs = Object.entries(d.recipe.out).map(([k, v]) => `${pic(k, 12)}${v}`).join(' + ');
      out.push(`<div class="tags"><span class="tag">${ins} → ${outs}${b.sizeFactor !== 1 ? ` ×${b.sizeFactor.toFixed(1)}` : ''}</span>` +
        (d.recipe.seasons ? `<span class="tag">${d.recipe.seasons.join(', ')}</span>` : '') + '</div>');
      if (d.zone && !d.crop) out.push(this.row('Plot', `${b.w}×${b.h} · ${b.area} tiles`));
    }

    if (d.harvest) {
      const nodes = g.world.findNodes(Math.round(b.cx), Math.round(b.cy), d.harvest.kind, d.harvest.radius, 400).length;
      out.push(this.sec('Gathering', { caps: true }));
      out.push(this.row(`${d.harvest.kind[0].toUpperCase()}${d.harvest.kind.slice(1)} in range`, String(nodes)));
      out.push(this.row('Yield', `${d.harvest.yield} ${RESOURCES[d.harvest.out].name}`, { icon: d.harvest.out }));
      if (d.harvest.seasons) out.push(this.row('Season', d.harvest.seasons.join(', ')));
    }
    if (d.oxen) {
      out.push(this.sec('Draught team', { caps: true }));
      out.push(this.row('Oxen stabled', String(d.oxen), { icon: 'ox' }));
      out.push(this.row('Village-wide, in use', `${g.oxenInUse} / ${g.oxenTotal}`));
      out.push(`<p>A carter hauls ${TUNING.cartCapacity} at a time instead of ${TUNING.carryCapacity}.</p>`);
    }
    if (d.service) {
      out.push(this.sec('Service', { caps: true }));
      out.push(this.row(d.service.kind[0].toUpperCase() + d.service.kind.slice(1), `${d.service.radius} tiles`));
      out.push(this.row('Villagers served', String(b.serving)));
    }
    if (d.charm) out.push(this.row('Charm', `${d.charm > 0 ? '+' : ''}${d.charm} over ${d.charmRadius ?? 10} tiles`, { icon: 'charm' }));
    if (d.upkeep) out.push(this.row('Upkeep', `${d.upkeep}c per season`, { icon: 'coins' }));

    const stock = Object.entries(b.store).filter(([, val]) => (val as number) > 0.4);
    if (stock.length) {
      out.push(this.sec('On hand', { caps: true }));
      out.push('<div class="tags">' + stock.map(([k, val]) =>
        `<span class="tag">${pic(k, 12)}${Math.round(val as number)}</span>`).join('') + '</div>');
    }
    if (b.produced > 0) out.push(this.row('Produced in total', String(Math.round(b.produced))));

    out.push(this.supplyLinesHtml(b));
    return out;
  }

  private partsAdvanced(b: Building): string[] {
    const g = this.game;
    const d = b.def;
    const out: string[] = [];

    out.push(this.sec('Standing orders', { caps: true }));
    out.push(`<div class="mrow"><span class="lbl"><span>Priority</span></span>
      <span class="val"><span class="stepper">
        <button class="orb" data-act="pri-minus"><span class="icn">${I.minus}</span></button>
        <span class="v">${['Low', 'Normal', 'High', 'Urgent'][b.priority] ?? b.priority}</span>
        <button class="orb" data-act="pri-plus"><span class="icn">${I.plus}</span></button>
      </span></span></div>`);

    if (d.recipe) {
      const primary = Object.keys(d.recipe.out)[0] as ResId | undefined;
      if (primary) {
        out.push(`<div class="mrow"><span class="lbl"><span>Make until</span></span>
          <span class="val"><span class="stepper">
            <button class="orb" data-act="lim-minus"><span class="icn">${I.minus}</span></button>
            <span class="v">${b.limit == null ? '∞' : b.limit}</span>
            <button class="orb" data-act="lim-plus"><span class="icn">${I.plus}</span></button>
          </span></span></div>`);
        if (b.limit != null) {
          out.push(this.row('In store now', `${Math.round(g.totalOf(primary))} ${RESOURCES[primary].name}`, { icon: primary }));
        }
      }
    }

    if (d.crop) {
      out.push(this.sec('Sow next spring', {
        caps: true,
        tip: 'Rotating crops year to year is rewarded; repeating one tires the soil and costs yield. Beans feed the field itself.',
      }));
      out.push('<div class="tags">');
      for (const ct of CROP_ORDER) {
        const c = CROPS[ct];
        const active = b.cropType === ct;
        const repeat = b.lastCrop === ct;
        out.push(`<span class="tag pick ${active ? 'on' : ''}" data-crop="${ct}" data-tip="${esc(c.name)}" data-tipb="${esc(c.blurb)}">` +
          `${pic(c.out, 12)}${c.name}${repeat ? ' ↺' : ''}</span>`);
      }
      out.push('</div>');
      out.push(`<p>${CROPS[b.cropType].blurb}</p>`);
      if (b.lastCrop) {
        const f = b.rotationFactorFor(b.cropType);
        const label = f > 1 ? `Rotation bonus ×${f.toFixed(2)}`
          : f < 1 ? `Same crop again ×${f.toFixed(2)}`
          : 'No rotation effect';
        out.push(this.row('Last sown', CROPS[b.lastCrop].name, { icon: CROPS[b.lastCrop].out }));
        out.push(this.row('Next harvest', label, { vcls: f >= 1 ? '' : 'neg' }));
      }
    }

    out.push('<div class="btn-row">');
    out.push(`<button class="btn" data-act="pause">${b.paused ? 'Resume' : 'Pause'}</button>`);
    out.push('<button class="btn danger" data-act="demolish">Demolish</button>');
    out.push('</div>');
    return out;
  }

  // ------------------------------------------------------------------ trade

  private partsTrade(): string[] {
    const g = this.game;
    const out: string[] = [];

    const filters: { key: TradeFilter; icon: string; tip: string }[] = [
      { key: 'all', icon: 'scales', tip: 'All goods' },
      { key: 'material', icon: 'logs', tip: 'Materials and fuel' },
      { key: 'food', icon: 'bread', tip: 'Food' },
      { key: 'clothing', icon: 'clothes', tip: 'Clothing' },
      { key: 'good', icon: 'pottery', tip: 'Comforts' },
    ];
    out.push('<div class="trade-filters">' + filters.map((f) =>
      `<button class="orb orb-sm ${this.tradeFilter === f.key ? 'on' : ''}" data-tfilter="${f.key}" data-tip="${f.tip}">` +
      `${pic(f.icon, 14)}</button>`).join('') + '</div>');

    const match = (r: ResId): boolean => {
      if (this.tradeFilter === 'all') return true;
      const cat = RESOURCES[r].cat === 'fuel' ? 'material' : RESOURCES[r].cat;
      return cat === this.tradeFilter;
    };

    const rowFor = (r: ResId): string => {
      const res = RESOURCES[r];
      const have = Math.round(g.stockOf(r));
      const rule = g.tradeRules[r];
      const mode = rule?.sellAbove != null ? 'export' : rule?.buyBelow != null ? 'import' : 'none';
      const tv = mode === 'export' ? rule!.sellAbove : mode === 'import' ? rule!.buyBelow : null;
      const mod = g.trade.mod[r] ?? 1;
      const pd = mod > 1.02 ? '<span class="pd up">▲</span>' : mod < 0.98 ? '<span class="pd down">▼</span>' : '';
      const price = mode === 'import' ? g.buyPrice(r) : g.sellPrice(r);
      const verb = mode === 'import' ? 'Buy' : 'Sell';
      return `<div class="trow-t">
        <select class="msel ${mode === 'export' ? 'exp' : mode === 'import' ? 'imp' : ''}" data-tmode="${r}">
          <option value="none" ${mode === 'none' ? 'selected' : ''}>No trade</option>
          <option value="export" ${mode === 'export' ? 'selected' : ''}>Export</option>
          <option value="import" ${mode === 'import' ? 'selected' : ''}>Import</option>
        </select>
        ${pic(r, 14)}
        <span class="nm">${res.name}</span>
        <span class="have">${have}</span>
        <span class="arr"><span class="icn">${I.arrow}</span></span>
        <button class="orb" data-tstep="${r}" data-d="-5" ${mode === 'none' ? 'disabled' : ''}><span class="icn">${I.minus}</span></button>
        <span class="tv ${mode === 'none' ? 'dim' : ''}">${tv == null ? '—' : tv}</span>
        <button class="orb" data-tstep="${r}" data-d="5" ${mode === 'none' ? 'disabled' : ''}><span class="icn">${I.plus}</span></button>
        <button class="priceb" data-tgo="${r}" data-tip="${verb} 10 now" data-tipb="At today’s price of <b>${price.toFixed(1)}c</b> each. Prices move as you flood or drain a market, then drift back over days.">
          ${price.toFixed(1)}${pd}<span class="icn">${I.cart}</span>
        </button>
      </div>`;
    };

    const minor: string[] = [], major: string[] = [];
    for (const r of ALL_RES) {
      if (!match(r)) continue;
      const rule = g.tradeRules[r];
      const have = g.stockOf(r);
      if (have < 1 && !rule && (g.trade.mod[r] ?? 1) === 1
        && !['tools', 'stone', 'planks', 'bread', 'clothes', 'grain', 'logs'].includes(r)) continue;
      (RESOURCES[r].price < 15 ? minor : major).push(rowFor(r));
    }
    if (minor.length) {
      out.push(this.sec('Minor trades', { tip: 'Everyday goods. Standing orders run once a day: Export sells everything above the number, Import tops the stores up to it.' }));
      out.push(...minor);
    }
    if (major.length) {
      out.push(this.sec('Major trades', { tip: 'Fine goods fetch real coin — and cost real coin to bring in.' }));
      out.push(...major);
    }
    if (!minor.length && !major.length) out.push('<p>Nothing of this kind is in store or on order.</p>');
    return out;
  }

  // -------------------------------------------------------------- villagers

  private partsVillager(v: Villager): string[] {
    const g = this.game;
    const out: string[] = [];
    const job = v.jobId >= 0 ? g.buildings.get(v.jobId) : undefined;
    const home = v.homeId >= 0 ? g.buildings.get(v.homeId) : undefined;
    out.push(`<p>${esc(v.activity)}.</p>`);
    out.push(this.sec('Life', { caps: true }));
    out.push(this.row('Age', String(Math.floor(v.age))));
    out.push(this.row('Role', job ? job.name : v.jobTitle, { icon: job ? CAT_PIC[job.def.cat] : 'idle' }));
    out.push(this.row('Home', home ? home.tierDef().name : 'None', { icon: home ? 'housing' : 'homeless' }));
    const fam = v.familyId >= 0 ? g.families.get(v.familyId) : undefined;
    if (fam) out.push(this.row('Family', `The ${fam.surname}s (${fam.size})`, { icon: 'family' }));
    const hp = Math.round(v.health * 100);
    out.push(this.row('Health', `${hp}%`));
    out.push(this.bar(hp, hp < 40 ? 'hot' : hp < 70 ? '' : 'cool'));
    const sk = Math.round(((v.skill - 0.6) / 1.25) * 100);
    out.push(this.row('Skill', `${v.skill.toFixed(2)}×`));
    out.push(this.bar(sk));
    const tags: string[] = [];
    if (v.educated) tags.push(`<span class="tag ok">${pic('book', 12)}Schooled</span>`);
    if (v.hasOx) tags.push(`<span class="tag ok">${pic('ox', 12)}Driving a cart</span>`);
    if (v.carry) tags.push(`<span class="tag">${pic(v.carry.res, 12)}Carrying ${Math.round(v.carry.amt)} ${RESOURCES[v.carry.res].name}</span>`);
    if (tags.length) out.push(`<div class="tags">${tags.join('')}</div>`);

    if (v.isAdult) {
      out.push(this.sec('Assign to', { caps: true, tip: 'The nearest workplaces with an open post.' }));
      const openings = [...g.buildings.values()]
        .filter((b) => b.state === 'active' && b.jobSlots > 0 && b.workers.length < b.jobSlots)
        .sort((a, b) => Math.hypot(a.cx - v.x, a.cy - v.y) - Math.hypot(b.cx - v.x, b.cy - v.y))
        .slice(0, 8);
      out.push('<div class="tags">');
      out.push('<span class="tag pick" data-job="-1">Labourer</span>');
      for (const b of openings) {
        out.push(`<span class="tag pick" data-job="${b.id}">${pic(CAT_PIC[b.def.cat], 12)}${b.name}</span>`);
      }
      out.push('</div>');
    }
    return out;
  }

  // ----------------------------------------------------------- body wiring

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
      `<div class="flowline"><span class="${f.dir}">${f.dir === 'in' ? '⬅' : '➡'} ${pic(f.res, 12)} ${Math.round(f.amt)} ${RESOURCES[f.res].name}</span><b>${f.dir === 'in' ? 'from' : 'to'} ${esc(f.other)}</b></div>`,
    );
    return this.sec('Supply lines', { caps: true, tip: 'Recent deliveries in and out of this building.' }) + rows.join('');
  }

  private wireBody(b: Building): void {
    const body = $('insp-body');
    const g = this.game;

    for (const el of body.querySelectorAll('[data-selv]')) {
      (el as HTMLElement).onclick = () => {
        const v = g.villagers.get(Number((el as HTMLElement).dataset.selv));
        if (v) { this.selectVillager(v); this.cb.onFocus(v.x, v.y); }
      };
    }
    for (const el of body.querySelectorAll('[data-crop]')) {
      (el as HTMLElement).onclick = () => {
        b.cropType = (el as HTMLElement).dataset.crop as CropType;
        this.renderBody();
      };
    }
    for (const el of body.querySelectorAll('[data-act]')) {
      const act = (el as HTMLElement).dataset.act;
      (el as HTMLElement).onclick = () => {
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
        }
        this.renderInspector();
      };
    }

    // Trade tab.
    for (const el of body.querySelectorAll('[data-tfilter]')) {
      (el as HTMLElement).onclick = () => {
        this.tradeFilter = (el as HTMLElement).dataset.tfilter as TradeFilter;
        this.renderBody();
      };
    }
    for (const el of body.querySelectorAll('[data-tmode]')) {
      (el as HTMLSelectElement).onchange = () => {
        const r = (el as HTMLElement).dataset.tmode as ResId;
        const mode = (el as HTMLSelectElement).value;
        const prev = g.tradeRules[r];
        const kept = prev?.sellAbove ?? prev?.buyBelow ?? 10;
        if (mode === 'none') delete g.tradeRules[r];
        else if (mode === 'export') g.tradeRules[r] = { sellAbove: kept };
        else g.tradeRules[r] = { buyBelow: kept };
        this.renderBody();
      };
    }
    for (const el of body.querySelectorAll('[data-tstep]')) {
      (el as HTMLElement).onclick = () => {
        const r = (el as HTMLElement).dataset.tstep as ResId;
        const d = Number((el as HTMLElement).dataset.d);
        const rule = g.tradeRules[r];
        if (!rule) return;
        if (rule.sellAbove != null) rule.sellAbove = Math.max(0, rule.sellAbove + d);
        else if (rule.buyBelow != null) rule.buyBelow = Math.max(0, rule.buyBelow + d);
        this.renderBody();
      };
    }
    for (const el of body.querySelectorAll('[data-tgo]')) {
      (el as HTMLElement).onclick = () => {
        const r = (el as HTMLElement).dataset.tgo as ResId;
        const rule = g.tradeRules[r];
        const res = rule?.buyBelow != null ? g.buy(r, 10) : g.sell(r, 10);
        g.log(res.msg, res.ok ? 'good' : 'bad');
        this.renderBody();
      };
    }
  }

  private wireVillagerBody(v: Villager): void {
    const body = $('insp-body');
    for (const el of body.querySelectorAll('[data-job]')) {
      (el as HTMLElement).onclick = () => {
        this.game.assignVillager(v.id, Number((el as HTMLElement).dataset.job));
        this.renderInspector();
      };
    }
  }

  // ----------------------------------------------------------------- ledger

  /**
   * The numbers the village has been keeping all along: 240 days of coin,
   * heads and contentment, today's flows including what rotted, and where
   * the hands actually are.
   */
  private renderLedger(): void {
    this.ledgerDrawn = performance.now();
    const g = this.game;
    const out: string[] = [];

    out.push('<div class="ledger-sparks">');
    const sparks: [string, string, number[]][] = [
      ['Coin', `${Math.round(g.coin)}`, g.stats.coinHistory],
      ['People', `${g.population}`, g.stats.popHistory],
      ['Content', `${Math.round(g.averageContentment * 100)}%`, g.stats.contentHistory],
    ];
    for (const [label, now, series] of sparks) {
      out.push(`<div class="spark"><div class="lbl"><span>${label}</span><b>${now}</b></div>` +
        `<canvas data-spark="${label}" width="220" height="42"></canvas></div>`);
      void series;
    }
    out.push('</div>');

    // Today's flows: what was made, eaten, and lost to rot.
    out.push(this.sec('Today', { caps: true }));
    out.push('<table class="ledger-table"><tr><th>Good</th><th>Made</th><th>Used</th><th>Rotted</th><th>Store</th></tr>');
    const rows: ResId[] = [...FOOD_TYPES, 'firewood'];
    for (const r of rows) {
      const made = g.stats.producedToday[r] ?? 0;
      const used = g.stats.consumedToday[r] ?? 0;
      const rot = g.stats.spoiledToday[r] ?? 0;
      const have = g.stockOf(r);
      if (made < 0.05 && used < 0.05 && rot < 0.05 && have < 0.5) continue;
      out.push(`<tr><td>${pic(r, 13)} ${RESOURCES[r].name}</td>` +
        `<td class="${made > 0.05 ? 'pos' : ''}">${made > 0.05 ? `+${made.toFixed(1)}` : '·'}</td>` +
        `<td>${used > 0.05 ? `−${used.toFixed(1)}` : '·'}</td>` +
        `<td class="${rot > 0.05 ? 'neg' : ''}">${rot > 0.05 ? `−${rot.toFixed(1)}` : '·'}</td>` +
        `<td>${Math.round(have)}</td></tr>`);
    }
    out.push('</table>');

    // Labour and logistics: the "producing but not moving" diagnostics.
    const starved = [...g.buildings.values()].filter((b) =>
      b.state === 'active' && b.workers.length > 0 && b.status.startsWith('Waiting for')).length;
    const receipts = g.hauls.size;
    const cap = storageCapacity(g);
    out.push(this.sec('Hands and haulage', { caps: true }));
    out.push('<table class="ledger-table">');
    out.push(`<tr><td>Working / adults</td><td>${g.employed} / ${g.adults}</td></tr>`);
    out.push(`<tr><td>Labour pool</td><td>${g.idleAdults}</td></tr>`);
    out.push(`<tr><td>Hauls under way</td><td>${receipts}</td></tr>`);
    out.push(`<tr><td>Workshops waiting on inputs</td><td class="${starved ? 'neg' : ''}">${starved}</td></tr>`);
    out.push(`<tr><td>Goods awaiting a haulier</td><td>${Math.round(backlog(g))}</td></tr>`);
    out.push(`<tr><td>Storage</td><td>${Math.round(storageUsed(g))} / ${Math.round(cap)}</td></tr>`);
    out.push(`<tr><td>Days of food in store</td><td>${foodDaysLeft(g).toFixed(1)}</td></tr>`);
    out.push('</table>');

    // The chronicle of firsts: done ones dated, the three nearest next. This
    // section fell out once already when the ledger was restyled — milestones
    // are why a sandbox player opens this panel at all.
    out.push(this.sec('Milestones', { caps: true }));
    const done = MILESTONES.filter((m) => g.milestonesDone[m.id] !== undefined);
    const open = MILESTONES
      .filter((m) => g.milestonesDone[m.id] === undefined)
      .map((m) => ({ m, p: m.progress(g) }))
      .sort((a, b) => (b.p.value / b.p.target) - (a.p.value / a.p.target));
    out.push('<table class="ledger-table">');
    for (const m of done) {
      const day = g.milestonesDone[m.id];
      out.push(`<tr><td>✓ ${m.name}</td><td>Year ${Math.floor(day / (TUNING.daysPerSeason * 4)) + 1}</td></tr>`);
    }
    for (const { m, p } of open.slice(0, 3)) {
      const pct = Math.round((p.value / p.target) * 100);
      out.push(`<tr><td data-tip="${m.name}" data-tipb="${m.desc}">${m.name}</td><td>${pct}%</td></tr>`);
    }
    out.push('</table>');
    if (!open.length) out.push('<p>Every milestone reached. The valley is yours.</p>');

    $('ledger-body').innerHTML = out.join('');
    for (const [label, , series] of sparks) {
      const canvas = document.querySelector(`[data-spark="${label}"]`) as HTMLCanvasElement | null;
      if (canvas) drawSpark(canvas, series);
    }
  }

  // ----------------------------------------------------------------- people

  openPeople(): void { this.peopleOpen = true; $('people').classList.remove('hidden'); this.renderPeople(); }
  closePeople(): void { this.peopleOpen = false; $('people').classList.add('hidden'); }

  private renderPeople(): void {
    const g = this.game;
    // The village is households, not a roster: group by family, eldest first
    // within each, and the handful of villagers between homes at the end.
    const person = (v: Villager): string => {
      const job = v.jobId >= 0 ? g.buildings.get(v.jobId) : undefined;
      return `
        <div class="person">
          <div class="who">${this.faceImg(v, 26)}<div><b>${esc(v.name)}</b><span>${Math.floor(v.age)} years · ${esc(v.jobTitle)}</span></div></div>
          <div class="what">${job ? `${pic(CAT_PIC[job.def.cat], 12)} ${esc(job.name)}` : 'Labourer'}</div>
          <div class="what">${esc(v.activity)}</div>
          <div><button class="btn" data-goto="${v.id}">Find</button></div>
        </div>`;
    };
    const out: string[] = [];
    const shown = new Set<number>();
    const families = [...g.families.values()]
      .filter((f) => f.memberIds.length > 0)
      .sort((a, b) => b.memberIds.length - a.memberIds.length || a.id - b.id);
    for (const f of families) {
      const members = f.memberIds
        .map((id) => g.villagers.get(id))
        .filter((v): v is Villager => !!v)
        .sort((a, b) => b.age - a.age);
      if (!members.length) continue;
      const home = f.homeId >= 0 ? g.buildings.get(f.homeId) : undefined;
      const mood = home && home.residents.length ? ` · ${Math.round(home.contentment * 100)}% content` : '';
      out.push(this.sec(`The ${f.surname}s · ${members.length}${mood}`, { caps: true }));
      for (const v of members) { out.push(person(v)); shown.add(v.id); }
    }
    const loose = [...g.villagers.values()].filter((v) => !shown.has(v.id));
    if (loose.length) {
      out.push(this.sec(`Between homes · ${loose.length}`, { caps: true }));
      for (const v of loose.sort((a, b) => b.age - a.age)) out.push(person(v));
    }
    const host = $('people-list');
    host.innerHTML = out.join('');
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

/** A tiny line chart: 240 days of one number, no axes, no library. */
function drawSpark(canvas: HTMLCanvasElement, series: number[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || series.length < 2) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  let min = Infinity, max = -Infinity;
  for (const v of series) { if (v < min) min = v; if (v > max) max = v; }
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const pad = 3;
  ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((series[i] - min) / (max - min)) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(217, 189, 124, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
