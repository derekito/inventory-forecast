import { fetchOrdersForSalesByBrand } from "@/lib/shopify";

function getSince(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

export type SalesByBrandRow = {
  vendor: string;
  unitsSold: number;
  salesAmount: number;
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
    const since = getSince(windowMonths);
    const lines = await fetchOrdersForSalesByBrand(since);

    const byVendor = new Map<string, { units: number; amount: number }>();
    for (const line of lines) {
      const cur = byVendor.get(line.vendor) ?? { units: 0, amount: 0 };
      cur.units += line.quantity;
      cur.amount += line.quantity * line.unitPriceAmount;
      byVendor.set(line.vendor, cur);
    }

    const brands: SalesByBrandRow[] = Array.from(byVendor.entries())
      .map(([vendor, { units, amount }]) => ({
        vendor,
        unitsSold: units,
        salesAmount: Math.round(amount * 100) / 100,
      }))
      .sort((a, b) => b.unitsSold - a.unitsSold);

    return Response.json({ brands, windowMonths });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[sales-by-brand]", e);
    const isAuth = /401|invalid.*token|unrecognized login/i.test(message);
    return Response.json(
      { error: message },
      { status: isAuth ? 401 : 500 }
    );
  }
}
