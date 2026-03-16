export type DateWindow = "1" | "3" | "6";

export type StatusFilter =
  | "all"
  | "order_now"
  | "out_of_stock"
  | "overstocked"
  | "no_sales"
  | "snoozed"
  | "untracked"
  | "sales_by_brand"
  | "brand_health"
  | "naked_armor"
  | "skip_list";

export type ProductRow = {
  id: string;
  productId: number;
  variantId: number;
  thumbnail: string | null;
  title: string;
  vendor: string;
  sku: string;
  salesPerMonth: number;
  inventory: number;
  enoughForDays: number;
  status: "out_of_stock" | "order_now" | "overstocked" | "ordered" | "snoozed" | "untracked" | "in_stock";
  orderInDays: number;
  estOrder: number;
  /** True if inventory snapshots show quantity > 0 for the full past 6 months (requires snapshot history). */
  inStockFullPeriod6Months?: boolean;
  /** Sales trend: last 3 months vs previous 3 months. */
  trend?: "up" | "down" | "stable";
  /** Days the product has been out of stock (from inventory snapshots). Only set when status is out_of_stock; null if unknown. */
  daysOutOfStock?: number | null;
};
