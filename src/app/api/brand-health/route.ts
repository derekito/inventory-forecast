import {
  fetchOrdersForSalesByBrand,
  fetchProducts,
  fetchInventoryLevels,
  fetchOrdersSince,
  type ShopifyOrder,
} from "@/lib/shopify";

const MONTH_DAYS = 30;
const COVER_DAYS = 90;
const OVERSTOCK_DAYS = 180;
const REORDER_THRESHOLD_DAYS = 60;
const TREND_UP_RATIO = 1.1;
const TREND_DOWN_RATIO = 0.9;

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

function getTrend(last3: number, prev3: number): "up" | "down" | "stable" {
  if (last3 > prev3 * TREND_UP_RATIO) return "up";
  if (prev3 > 0 && last3 < prev3 * TREND_DOWN_RATIO) return "down";
  return "stable";
}

export type BrandHealthRow = {
  vendor: string;
  salesPct: number;
  orderNowCount: number;
  outOfStockCount: number;
  noSalesCount: number;
  overstockedCount: number;
  totalVariants: number;
  noSalesPct: number;
  trend: "mostly_up" | "mostly_down" | "mixed";
};

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

  try {
    const sinceWindow = getSince(windowMonths);
    const since6 = getSince(6);
    const since3 = getSince(3);

    const [products, ordersAll, salesLines] = await Promise.all([
      fetchProducts(undefined),
      fetchOrdersSince(since6),
      fetchOrdersForSalesByBrand(sinceWindow).then((lines) => {
        const byV = new Map<string, number>();
        for (const l of lines) {
          byV.set(l.vendor, (byV.get(l.vendor) ?? 0) + l.quantity * l.unitPriceAmount);
        }
        return byV;
      }),
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

    const totalSalesAmount = Array.from(salesLines.values()).reduce((a, b) => a + b, 0);

    type Row = { vendor: string; status: string; trend: "up" | "down" | "stable"; noSales: boolean };
    const rows: Row[] = [];

    for (const p of products) {
      const vendor = (p.vendor ?? "").trim() || "—";
      for (const v of p.variants) {
        const inv = inventoryByItemId.get(v.inventory_item_id) ?? 0;
        const sold = salesByVariant.get(v.id) ?? 0;
        const salesPerMonth = windowMonths > 0 ? sold / windowMonths : 0;
        const salesPerDay = salesPerMonth / MONTH_DAYS;
        const enoughForDays =
          salesPerDay > 0 ? Math.floor(inv / salesPerDay) : inv > 0 ? 999 : 0;
        const orderInDays = enoughForDays - REORDER_THRESHOLD_DAYS;

        let status = "in_stock";
        if (inv <= 0) status = "out_of_stock";
        else if (enoughForDays > OVERSTOCK_DAYS) status = "overstocked";
        else if (orderInDays <= 0 || enoughForDays < REORDER_THRESHOLD_DAYS) status = "order_now";

        const trend = getTrend(
          salesLast3.get(v.id) ?? 0,
          salesPrev3.get(v.id) ?? 0
        );
        const noSales = salesPerMonth === 0 && inv > 0;

        rows.push({ vendor, status, trend, noSales });
      }
    }

    const byVendor = new Map<
      string,
      { orderNow: number; out: number; noSales: number; over: number; up: number; down: number; stable: number }
    >();
    for (const r of rows) {
      const cur = byVendor.get(r.vendor) ?? {
        orderNow: 0,
        out: 0,
        noSales: 0,
        over: 0,
        up: 0,
        down: 0,
        stable: 0,
      };
      if (r.status === "order_now") cur.orderNow++;
      if (r.status === "out_of_stock") cur.out++;
      if (r.noSales) cur.noSales++;
      if (r.status === "overstocked") cur.over++;
      if (r.trend === "up") cur.up++;
      if (r.trend === "down") cur.down++;
      if (r.trend === "stable") cur.stable++;
      byVendor.set(r.vendor, cur);
    }

    const brands: BrandHealthRow[] = Array.from(byVendor.entries()).map(([vendor, counts]) => {
      const totalForVendor = rows.filter((r) => r.vendor === vendor).length;
      const noSalesPct = totalForVendor > 0 ? (counts.noSales / totalForVendor) * 100 : 0;
      const salesAmount = salesLines.get(vendor) ?? 0;
      const salesPct = totalSalesAmount > 0 ? (salesAmount / totalSalesAmount) * 100 : 0;
      let trend: "mostly_up" | "mostly_down" | "mixed" = "mixed";
      if (counts.up > counts.down && counts.up >= counts.stable) trend = "mostly_up";
      else if (counts.down > counts.up) trend = "mostly_down";

      return {
        vendor,
        salesPct: Math.round(salesPct * 10) / 10,
        orderNowCount: counts.orderNow,
        outOfStockCount: counts.out,
        noSalesCount: counts.noSales,
        overstockedCount: counts.over,
        totalVariants: totalForVendor,
        noSalesPct: Math.round(noSalesPct * 10) / 10,
        trend,
      };
    });

    brands.sort((a, b) => b.salesPct - a.salesPct);
    return Response.json({ brands, windowMonths });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[brand-health]", e);
    const isAuth = /401|invalid.*token|unrecognized login/i.test(message);
    return Response.json(
      { error: message },
      { status: isAuth ? 401 : 500 }
    );
  }
}
