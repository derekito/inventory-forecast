import {
  getDaysOutOfStock,
  hasEnoughSnapshotHistory,
  readSnapshots,
  recordSnapshot,
  wasInStockFullSixMonths,
} from "@/lib/inventory-snapshots";
import {
  fetchProducts,
  fetchInventoryLevels,
  fetchOrdersSince,
  type ShopifyOrder,
} from "@/lib/shopify";
import type { ProductRow } from "@/types/forecast";

const MONTH_DAYS = 30;
const COVER_DAYS = 90; // how many days of stock we want from an order
const OVERSTOCK_DAYS = 180; // enough for > 6 months = overstocked
const REORDER_THRESHOLD_DAYS = 60; // below this = "order now" (forecast: reorder within ~2 months)

function getSince(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

function aggregateSalesByVariant(orders: ShopifyOrder[]): Map<number, number> {
  const byVariant = new Map<number, number>();
  for (const order of orders) {
    for (const item of order.line_items) {
      const q = byVariant.get(item.variant_id) ?? 0;
      byVariant.set(item.variant_id, q + item.quantity);
    }
  }
  return byVariant;
}

const TREND_UP_RATIO = 1.1;   // last 3 mo > prev 3 mo by 10% = up
const TREND_DOWN_RATIO = 0.9; // last 3 mo < prev 3 mo by 10% = down

function getTrend(
  last3Sales: number,
  prev3Sales: number
): "up" | "down" | "stable" {
  if (last3Sales > prev3Sales * TREND_UP_RATIO) return "up";
  if (prev3Sales > 0 && last3Sales < prev3Sales * TREND_DOWN_RATIO) return "down";
  return "stable";
}

export async function GET(request: Request) {
  const store = (process.env.NEXT_PUBLIC_SHOPIFY_STORE ?? "").trim();
  const token = (process.env.SHOPIFY_ACCESS_TOKEN ?? "").trim();
  if (!store || !token) {
    return Response.json(
      { error: "Missing NEXT_PUBLIC_SHOPIFY_STORE or SHOPIFY_ACCESS_TOKEN in .env.local" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const windowMonths = Math.min(6, Math.max(1, parseInt(searchParams.get("window") || "3", 10)));
  const vendorFilter = searchParams.get("vendor") || undefined;

  try {
    const sinceWindow = getSince(windowMonths);
    const since6 = getSince(6);
    const since3 = getSince(3);
    const [products, ordersAll] = await Promise.all([
      fetchProducts(vendorFilter ? { vendor: vendorFilter } : undefined),
      fetchOrdersSince(since6),
    ]);

    const ordersInWindow = ordersAll.filter((o) => o.created_at >= sinceWindow);
    const ordersLast3 = ordersAll.filter((o) => o.created_at >= since3);
    const ordersPrev3 = ordersAll.filter((o) => o.created_at >= since6 && o.created_at < since3);

    const salesByVariant = aggregateSalesByVariant(ordersInWindow);
    const salesLast3 = aggregateSalesByVariant(ordersLast3);
    const salesPrev3 = aggregateSalesByVariant(ordersPrev3);
    const inventoryItemIds: number[] = [];
    const variantToInvItem = new Map<number, number>();
    for (const p of products) {
      for (const v of p.variants) {
        inventoryItemIds.push(v.inventory_item_id);
        variantToInvItem.set(v.id, v.inventory_item_id);
      }
    }
    const inventoryByItemId = await fetchInventoryLevels(inventoryItemIds);

    const store = await readSnapshots();
    recordSnapshot(inventoryByItemId).catch(() => {});

    const rows: ProductRow[] = [];
    for (const p of products) {
      if (vendorFilter && p.vendor !== vendorFilter) continue;
      const image = p.image?.src ?? p.images?.[0]?.src ?? null;
      for (const v of p.variants) {
        const inv = inventoryByItemId.get(v.inventory_item_id) ?? 0;
        const sold = salesByVariant.get(v.id) ?? 0;
        const salesPerMonth = windowMonths > 0 ? sold / windowMonths : 0;
        const salesPerDay = salesPerMonth / MONTH_DAYS;
        const enoughForDays =
          salesPerDay > 0 ? Math.floor(inv / salesPerDay) : (inv > 0 ? 999 : 0);
        const targetStock = salesPerDay * COVER_DAYS;
        const estOrder = Math.max(0, Math.ceil(targetStock - inv));
        const orderInDays = enoughForDays - REORDER_THRESHOLD_DAYS; // positive = days until reorder, negative = overdue

        let status: ProductRow["status"] = "in_stock";
        if (inv <= 0) status = "out_of_stock";
        else if (enoughForDays > OVERSTOCK_DAYS) status = "overstocked";
        else if (orderInDays <= 0 || enoughForDays < REORDER_THRESHOLD_DAYS) status = "order_now";
        // ordered / snoozed would come from your own tracking; default in_stock = adequately stocked

        const inStockFullPeriod6Months = wasInStockFullSixMonths(store, v.inventory_item_id);
        const trend = getTrend(
          salesLast3.get(v.id) ?? 0,
          salesPrev3.get(v.id) ?? 0
        );
        const daysOutOfStock =
          inv <= 0 ? getDaysOutOfStock(store, v.inventory_item_id, inv) : undefined;

        rows.push({
          id: `v-${v.id}`,
          productId: p.id,
          variantId: v.id,
          thumbnail: image,
          title: p.title,
          vendor: p.vendor,
          sku: v.sku ?? "",
          productType: p.productType ?? "",
          salesPerMonth,
          inventory: inv,
          enoughForDays,
          status,
          orderInDays,
          estOrder,
          inStockFullPeriod6Months,
          trend,
          daysOutOfStock,
        });
      }
    }

    const hasSixMonthsSnapshotData = hasEnoughSnapshotHistory(store);
    return Response.json({ rows, windowMonths, hasSixMonthsSnapshotData });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[forecast]", e);
    const isAuth = /401|invalid.*token|unrecognized login/i.test(message);
    return Response.json(
      { error: message },
      { status: isAuth ? 401 : 500 }
    );
  }
}
