/**
 * The hauling ledger, with receipts.
 *
 * A trip claims goods at both ends — stock reserved at the source, a delivery
 * pledged to the destination — and those claims used to live only as running
 * totals (`reservedOut` / `incoming`) that every cancellation path had to
 * reconstruct from villager state. Get one conditional wrong and the totals
 * drift: that bug has shipped twice.
 *
 * Every claim is now an identified record. Opening a trip creates one;
 * settling or cancelling closes it and releases exactly what the record says
 * is still open. A cancellation can no longer disagree with the claim it is
 * cancelling, because it no longer re-derives it.
 *
 * The aggregates stay materialised — dozens of call sites read them — but
 * they are maintained in lockstep here and nowhere else, and the invariant
 * harness checks aggregate == Σ open records at every snapshot.
 */

import type { ResId } from '../defs';
import type { Villager } from '../villager';
import type { Game } from '../game';

export interface Haul {
  readonly id: number;
  readonly villagerId: number;
  /** Where stock is reserved, or -1 once collected (or if carrying from the start). */
  sourceId: number;
  /** Where the delivery is pledged, or -1 while no store has been chosen. */
  destId: number;
  readonly res: ResId;
  /** The open amount: what is still reserved and/or pledged. */
  amt: number;
}

/** Reserve at a source (and optionally pledge to a destination) for one trip. */
export function openHaul(g: Game, v: Villager, sourceId: number, destId: number, res: ResId, amt: number): void {
  g.buildings.get(sourceId)!.reserveOut(res, amt);
  if (destId >= 0) g.buildings.get(destId)!.addIncoming(res, amt);
  const id = g.nextHaulId++;
  g.hauls.set(id, { id, villagerId: v.id, sourceId, destId, res, amt });
  v.haulId = id;
}

/** Pledge a load already in hand (no source side) to a destination. */
export function openDelivery(g: Game, v: Villager, destId: number, res: ResId, amt: number): void {
  g.buildings.get(destId)!.addIncoming(res, amt);
  const id = g.nextHaulId++;
  g.hauls.set(id, { id, villagerId: v.id, sourceId: -1, destId, res, amt });
  v.haulId = id;
}

/**
 * The source side closes on arrival: the reservation is released in full, and
 * if less was collected than promised, the destination's pledge shrinks by the
 * shortfall. What remains open is a pure delivery pledge for `got`.
 */
export function settlePickup(g: Game, v: Villager, got: number): void {
  const h = g.hauls.get(v.haulId);
  if (!h) return;
  g.buildings.get(h.sourceId)?.releaseOut(h.res, h.amt);
  if (h.destId >= 0 && h.amt > got) g.buildings.get(h.destId)?.clearIncoming(h.res, h.amt - got);
  h.sourceId = -1;
  h.amt = got;
  if (got <= 0 || h.destId < 0) return; // caller decides the next step; an unpledged load keeps its record until then
}

/** Choose (or change) where an in-hand load is going. */
export function pledgeTo(g: Game, v: Villager, destId: number): void {
  const h = g.hauls.get(v.haulId);
  if (!h || h.destId === destId) return;
  if (h.destId >= 0) g.buildings.get(h.destId)?.clearIncoming(h.res, h.amt);
  h.destId = destId;
  if (destId >= 0) g.buildings.get(destId)!.addIncoming(h.res, h.amt);
}

/** The destination side closes on arrival. The record is spent. */
export function settleDelivery(g: Game, v: Villager): void {
  const h = g.hauls.get(v.haulId);
  if (!h) return;
  if (h.destId >= 0) g.buildings.get(h.destId)?.clearIncoming(h.res, h.amt);
  close(g, v, h);
}

/**
 * Abandon the trip: hand back whichever sides the record says are still open.
 * This is the whole point of the receipts — cancellation releases what was
 * actually claimed, not what the villager's action flags imply was claimed.
 */
export function cancelHaulById(g: Game, v: Villager): void {
  const h = g.hauls.get(v.haulId);
  if (!h) return;
  // `?.` because either building may have been demolished under the trip.
  if (h.sourceId >= 0) g.buildings.get(h.sourceId)?.releaseOut(h.res, h.amt);
  if (h.destId >= 0) g.buildings.get(h.destId)?.clearIncoming(h.res, h.amt);
  close(g, v, h);
}

/** Drop the record without touching ledgers (both sides already settled). */
export function closeHaul(g: Game, v: Villager): void {
  const h = g.hauls.get(v.haulId);
  if (h) close(g, v, h);
}

function close(g: Game, v: Villager, h: Haul): void {
  g.hauls.delete(h.id);
  if (v.haulId === h.id) v.haulId = -1;
}
