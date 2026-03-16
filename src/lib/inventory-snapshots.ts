/**
 * Records daily inventory snapshots so we can later determine
 * "was this item in stock for the full 6 months?" (never went to zero).
 * Shopify does not provide historical inventory levels, so we build our own.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const SNAPSHOTS_DIR = path.join(process.cwd(), "data");
const SNAPSHOTS_FILE = path.join(SNAPSHOTS_DIR, "inventory-snapshots.json");
const SIX_MONTHS_DAYS = 180;
const MIN_DAYS_COVERAGE = 150; // require at least this many days of data in the 6-month window

export type SnapshotStore = {
  byDate: Record<string, Record<number, number>>; // date YYYY-MM-DD -> inventoryItemId -> quantity
};

async function ensureDir(): Promise<void> {
  try {
    await mkdir(SNAPSHOTS_DIR, { recursive: true });
  } catch {
    // ignore if exists
  }
}

export async function readSnapshots(): Promise<SnapshotStore> {
  try {
    const raw = await readFile(SNAPSHOTS_FILE, "utf-8");
    const data = JSON.parse(raw) as SnapshotStore;
    return data.byDate ? data : { byDate: {} };
  } catch {
    return { byDate: {} };
  }
}

export async function recordSnapshot(
  inventoryByItemId: Map<number, number>
): Promise<void> {
  await ensureDir();
  const today = new Date().toISOString().slice(0, 10);
  const store = await readSnapshots();
  if (store.byDate[today]) return; // already recorded today
  store.byDate[today] = Object.fromEntries(inventoryByItemId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 220);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const trimmed: Record<string, Record<number, number>> = {};
  for (const [d, items] of Object.entries(store.byDate)) {
    if (d >= cutoffStr) trimmed[d] = items;
  }
  await writeFile(
    SNAPSHOTS_FILE,
    JSON.stringify({ byDate: trimmed }, null, 0),
    "utf-8"
  );
}

/** True if we have at least MIN_DAYS_COVERAGE days of snapshots in the past 6 months. */
export function hasEnoughSnapshotHistory(store: SnapshotStore): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SIX_MONTHS_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let days = 0;
  for (const date of Object.keys(store.byDate)) {
    if (date >= cutoffStr) days++;
  }
  return days >= MIN_DAYS_COVERAGE;
}

/**
 * Returns true if we have enough snapshot history for the past 6 months
 * and the item's quantity was > 0 in every snapshot in that window.
 */
export function wasInStockFullSixMonths(
  store: SnapshotStore,
  inventoryItemId: number
): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SIX_MONTHS_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let daysWithData = 0;
  for (const [date, items] of Object.entries(store.byDate)) {
    if (date < cutoffStr) continue;
    const qty = items[inventoryItemId];
    if (qty === undefined) continue; // not in this snapshot (e.g. different vendor run)
    daysWithData++;
    if (qty <= 0) return false;
  }
  return daysWithData >= MIN_DAYS_COVERAGE;
}

/**
 * Returns how many days this item has been out of stock (quantity <= 0),
 * by finding the most recent snapshot where quantity was > 0.
 * Returns null if currently in stock or if we have no history of it being in stock.
 */
export function getDaysOutOfStock(
  store: SnapshotStore,
  inventoryItemId: number,
  currentQuantity: number
): number | null {
  if (currentQuantity > 0) return null;
  const dates = Object.keys(store.byDate).sort().reverse(); // newest first
  const today = new Date().toISOString().slice(0, 10);
  for (const date of dates) {
    const qty = store.byDate[date]?.[inventoryItemId];
    if (qty === undefined) continue; // no data for this item on this date
    if (qty > 0) {
      const lastInStock = new Date(date);
      const now = new Date();
      const diffMs = now.getTime() - lastInStock.getTime();
      return Math.floor(diffMs / (24 * 60 * 60 * 1000));
    }
  }
  return null; // never seen in stock in our history
}
