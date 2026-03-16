import { fetchProducts, fetchOrderLinesWithVariant } from "@/lib/shopify";

const VENDOR_NAKED_ARMOR = "Naked Armor";

function getSince(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

export type NakedArmorRow = {
  variantId: number;
  productId: number;
  title: string;
  sku: string;
  productType: string;
  unitsSold: number;
  salesAmount: number;
  unitsSoldLastYear: number;
  salesAmountLastYear: number;
  /** Up = higher than same period last year; Down = lower; stable = same; new = no prior year data. */
  trend: "up" | "down" | "stable" | "new";
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
    const sinceCurrent = getSince(windowMonths);
    const sinceLastYear = getSince(12 + windowMonths);
    const untilLastYear = getSince(12);

    const [products, currentLines, lastYearLines] = await Promise.all([
      fetchProducts({ vendor: VENDOR_NAKED_ARMOR }),
      fetchOrderLinesWithVariant(sinceCurrent),
      fetchOrderLinesWithVariant(sinceLastYear, untilLastYear),
    ]);

    const variantToProduct = new Map<
      number,
      { productId: number; title: string; sku: string; productType: string }
    >();
    for (const p of products) {
      for (const v of p.variants) {
        variantToProduct.set(v.id, {
          productId: p.id,
          title: p.title,
          sku: v.sku ?? "",
          productType: p.productType ?? "",
        });
      }
    }

    const currentByVariant = new Map<number, { units: number; amount: number }>();
    for (const line of currentLines) {
      if (line.vendor !== VENDOR_NAKED_ARMOR) continue;
      const cur = currentByVariant.get(line.variantId) ?? { units: 0, amount: 0 };
      cur.units += line.quantity;
      cur.amount += line.quantity * line.unitPriceAmount;
      currentByVariant.set(line.variantId, cur);
    }

    const lastYearByVariant = new Map<number, { units: number; amount: number }>();
    for (const line of lastYearLines) {
      if (line.vendor !== VENDOR_NAKED_ARMOR) continue;
      const cur = lastYearByVariant.get(line.variantId) ?? { units: 0, amount: 0 };
      cur.units += line.quantity;
      cur.amount += line.quantity * line.unitPriceAmount;
      lastYearByVariant.set(line.variantId, cur);
    }

    const variantIds = new Set<number>([
      ...variantToProduct.keys(),
      ...currentByVariant.keys(),
      ...lastYearByVariant.keys(),
    ]);

    const rows: NakedArmorRow[] = [];
    for (const variantId of variantIds) {
      const info = variantToProduct.get(variantId);
      const productId = info?.productId ?? 0;
      const title = info?.title ?? "—";
      const sku = info?.sku ?? "—";
      const productType = info?.productType ?? "";
      const current = currentByVariant.get(variantId) ?? { units: 0, amount: 0 };
      const lastYear = lastYearByVariant.get(variantId) ?? { units: 0, amount: 0 };
      const unitsLastYear = lastYear.units;
      const salesLastYear = Math.round(lastYear.amount * 100) / 100;

      let trend: NakedArmorRow["trend"] = "stable";
      if (unitsLastYear === 0) {
        trend = current.units > 0 ? "new" : "stable";
      } else if (current.units > unitsLastYear) {
        trend = "up";
      } else if (current.units < unitsLastYear) {
        trend = "down";
      }

      rows.push({
        variantId,
        productId,
        title,
        sku,
        productType,
        unitsSold: current.units,
        salesAmount: Math.round(current.amount * 100) / 100,
        unitsSoldLastYear: unitsLastYear,
        salesAmountLastYear: salesLastYear,
        trend,
      });
    }

    rows.sort((a, b) => b.unitsSold - a.unitsSold);

    return Response.json({ rows, windowMonths });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[naked-armor]", e);
    const isAuth = /401|invalid.*token|unrecognized login/i.test(message);
    return Response.json(
      { error: message },
      { status: isAuth ? 401 : 500 }
    );
  }
}
