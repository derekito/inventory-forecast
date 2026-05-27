"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProductRow, StatusFilter, DateWindow } from "@/types/forecast";

const UNTRACKED_STORAGE_KEY = "inventory-forecast-untracked";
const SKIP_LIST_STORAGE_KEY = "inventory-forecast-skip";
/** Brand dropdown value to load products from the entire catalog. */
const ALL_BRANDS = "__all__";

function loadUntrackedIds(vendor: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(UNTRACKED_STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const list = vendor ? (data[vendor] ?? []) : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

function saveUntrackedIds(vendor: string, ids: Set<string>) {
  if (typeof window === "undefined" || !vendor) return;
  try {
    const raw = localStorage.getItem(UNTRACKED_STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    data[vendor] = Array.from(ids);
    localStorage.setItem(UNTRACKED_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function loadSkipIds(vendor: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SKIP_LIST_STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return new Set(vendor ? (data[vendor] ?? []) : []);
  } catch {
    return new Set();
  }
}

function saveSkipIds(vendor: string, ids: Set<string>) {
  if (typeof window === "undefined" || !vendor) return;
  try {
    const raw = localStorage.getItem(SKIP_LIST_STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    data[vendor] = Array.from(ids);
    localStorage.setItem(SKIP_LIST_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "order_now", label: "Order now" },
  { key: "out_of_stock", label: "Out of stock" },
  { key: "overstocked", label: "Overstocked" },
  { key: "no_sales", label: "No Sales" },
  { key: "snoozed", label: "Snoozed" },
  { key: "untracked", label: "Untracked" },
  { key: "sales_by_brand", label: "Sales by brand" },
  { key: "brand_health", label: "Brand health" },
  { key: "naked_armor", label: "Naked Armor" },
  { key: "skip_list", label: "Don't order" },
];

const DATE_WINDOWS: { key: DateWindow; label: string }[] = [
  { key: "1", label: "1 month" },
  { key: "3", label: "3 months" },
  { key: "6", label: "6 months" },
];

function statusLabel(s: ProductRow["status"]): string {
  const map: Record<ProductRow["status"], string> = {
    out_of_stock: "Out of stock",
    order_now: "Order now",
    overstocked: "Overstocked",
    ordered: "Ordered",
    snoozed: "Snoozed",
    untracked: "Untracked",
    in_stock: "In stock",
  };
  return map[s] ?? "In stock";
}

function statusClass(s: ProductRow["status"]): string {
  if (s === "out_of_stock") return "border-red-300 bg-red-50 text-red-800";
  if (s === "order_now") return "border-amber-300 bg-amber-50 text-amber-800";
  if (s === "overstocked") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (s === "in_stock") return "border-gray-200 bg-gray-100 text-gray-600";
  return "border-gray-200 bg-gray-100 text-gray-700";
}

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function Home() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowMonths, setWindowMonths] = useState<DateWindow>("3");
  const [vendor, setVendor] = useState<string>("");
  const [statusTab, setStatusTab] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [untrackedIds, setUntrackedIds] = useState<Set<string>>(new Set());
  const [skipIds, setSkipIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hasSixMonthsSnapshotData, setHasSixMonthsSnapshotData] = useState(false);
  const [brandsSummary, setBrandsSummary] = useState<{ vendor: string; unitsSold: number; salesAmount: number }[] | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [brandTableSort, setBrandTableSort] = useState<{ key: "sales" | "pct"; dir: "asc" | "desc" }>({ key: "sales", dir: "desc" });
  type BrandHealthRow = { vendor: string; salesPct: number; orderNowCount: number; outOfStockCount: number; noSalesCount: number; overstockedCount: number; totalVariants: number; noSalesPct: number; trend: "mostly_up" | "mostly_down" | "mixed" };
  const [brandHealth, setBrandHealth] = useState<BrandHealthRow[] | null>(null);
  const [loadingBrandHealth, setLoadingBrandHealth] = useState(false);
  type NakedArmorRow = { variantId: number; productId: number; title: string; sku: string; productType: string; unitsSold: number; salesAmount: number; unitsSoldLastYear: number; salesAmountLastYear: number; trend: "up" | "down" | "stable" | "new" };
  const [nakedArmorRows, setNakedArmorRows] = useState<NakedArmorRow[] | null>(null);
  const [loadingNakedArmor, setLoadingNakedArmor] = useState(false);
  const [nakedArmorSort, setNakedArmorSort] = useState<{ key: "sales" | "changePct"; dir: "asc" | "desc" }>({ key: "sales", dir: "desc" });
  const [nakedArmorProductTypeFilter, setNakedArmorProductTypeFilter] = useState<string>("");
  const [productTableSalesSort, setProductTableSalesSort] = useState<"asc" | "desc">("desc");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const loadVendors = useCallback(async () => {
    try {
      const r = await fetch("/api/vendors");
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setVendors(data.vendors ?? []);
    } catch {
      setVendors([]);
    }
  }, []);

  const loadForecast = useCallback(async () => {
    if (!vendor) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ window: windowMonths });
      if (vendor !== ALL_BRANDS) params.set("vendor", vendor);
      const r = await fetch(`/api/forecast?${params}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || r.statusText);
      }
      const data = await r.json();
      setRows(data.rows ?? []);
      setHasSixMonthsSnapshotData(data.hasSixMonthsSnapshotData === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load forecast");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [windowMonths, vendor]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    if (!vendor) {
      setRows([]);
      setLoading(false);
      setError(null);
      setUntrackedIds(new Set());
      setSkipIds(new Set());
      setHasSixMonthsSnapshotData(false);
      return;
    }
    setUntrackedIds(loadUntrackedIds(vendor));
    setSkipIds(loadSkipIds(vendor));
    loadForecast();
  }, [vendor, loadForecast]);

  const loadSalesByBrand = useCallback(async () => {
    setLoadingBrands(true);
    try {
      const r = await fetch(`/api/sales-by-brand?window=${windowMonths}`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setBrandsSummary(data.brands ?? []);
    } catch {
      setBrandsSummary([]);
    } finally {
      setLoadingBrands(false);
    }
  }, [windowMonths]);

  useEffect(() => {
    if (statusTab === "sales_by_brand") loadSalesByBrand();
    else setBrandsSummary(null);
  }, [statusTab, loadSalesByBrand]);

  const loadBrandHealth = useCallback(async () => {
    setLoadingBrandHealth(true);
    try {
      const r = await fetch(`/api/brand-health?window=${windowMonths}`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setBrandHealth(data.brands ?? []);
    } catch {
      setBrandHealth([]);
    } finally {
      setLoadingBrandHealth(false);
    }
  }, [windowMonths]);

  useEffect(() => {
    if (statusTab === "brand_health") loadBrandHealth();
    else setBrandHealth(null);
  }, [statusTab, loadBrandHealth]);

  const loadNakedArmor = useCallback(async () => {
    setLoadingNakedArmor(true);
    try {
      const r = await fetch(`/api/naked-armor?window=${windowMonths}`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setNakedArmorRows(data.rows ?? []);
    } catch {
      setNakedArmorRows([]);
    } finally {
      setLoadingNakedArmor(false);
    }
  }, [windowMonths]);

  useEffect(() => {
    if (statusTab === "naked_armor") loadNakedArmor();
    else setNakedArmorRows(null);
  }, [statusTab, loadNakedArmor]);

  const searchLower = search.trim().toLowerCase();
  const filtered =
    searchLower === ""
      ? rows
      : rows.filter(
          (row) =>
            row.title.toLowerCase().includes(searchLower) ||
            row.vendor.toLowerCase().includes(searchLower) ||
            row.sku.toLowerCase().includes(searchLower)
        );

  const excludeUntracked = (list: ProductRow[]) =>
    list.filter((row) => !untrackedIds.has(row.id));

  const orderNowRows = (list: ProductRow[]) =>
    excludeUntracked(list).filter(
      (row) =>
        (row.status === "order_now" || row.status === "out_of_stock") &&
        row.salesPerMonth > 0
    );

  const noSalesRows = (list: ProductRow[]) =>
    excludeUntracked(list).filter(
      (row) =>
        row.salesPerMonth === 0 &&
        row.inventory > 0 &&
        (hasSixMonthsSnapshotData ? row.inStockFullPeriod6Months === true : true)
    );

  const isSuggestedSkip = (row: ProductRow) =>
    row.status === "overstocked" && row.salesPerMonth === 0 && row.inventory > 0;
  const skipListRows = (list: ProductRow[]) =>
    excludeUntracked(list).filter((row) => skipIds.has(row.id) || isSuggestedSkip(row));

  const statusFiltered =
    statusTab === "all"
      ? excludeUntracked(filtered)
      : statusTab === "order_now"
        ? orderNowRows(filtered)
        : statusTab === "no_sales"
          ? noSalesRows(filtered)
          : statusTab === "untracked"
            ? filtered.filter((row) => untrackedIds.has(row.id))
            : statusTab === "skip_list"
              ? skipListRows(filtered)
              : excludeUntracked(filtered).filter((row) => row.status === statusTab);

  const orderNowCount = orderNowRows(rows).length;
  const outOfStockCount = excludeUntracked(rows).filter((r) => r.status === "out_of_stock").length;
  const overstockedCount = excludeUntracked(rows).filter((r) => r.status === "overstocked").length;
  const noSalesCount = noSalesRows(rows).length;
  const snoozedCount = excludeUntracked(rows).filter((r) => r.status === "snoozed").length;
  const untrackedCount = rows.filter((r) => untrackedIds.has(r.id)).length;
  const skipListCount = skipListRows(rows).length;

  const handleToggleUntracked = useCallback(
    (ids?: string[]) => {
      if (!vendor) return;
      const toToggle = ids ?? statusFiltered.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
      if (toToggle.length === 0) return;
      setUntrackedIds((prev) => {
        const next = new Set(prev);
        const allAlreadyUntracked = toToggle.every((id) => next.has(id));
        if (allAlreadyUntracked && (ids != null || statusTab === "untracked")) {
          toToggle.forEach((id) => next.delete(id));
        } else {
          toToggle.forEach((id) => next.add(id));
        }
        saveUntrackedIds(vendor, next);
        return next;
      });
      if (ids == null) setSelectedIds(new Set());
    },
    [vendor, statusTab, selectedIds, statusFiltered]
  );

  const toggleSelected = useCallback((rowId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    const ids = statusFiltered.map((r) => r.id);
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, [statusFiltered]);

  const handleToggleSkip = useCallback(
    (ids?: string[]) => {
      if (!vendor) return;
      const toToggle = ids ?? statusFiltered.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
      if (toToggle.length === 0) return;
      const next = new Set(skipIds);
      const allAlreadySkipped = toToggle.every((id) => next.has(id));
      if (allAlreadySkipped && (ids != null || statusTab === "skip_list")) {
        toToggle.forEach((id) => next.delete(id));
      } else {
        toToggle.forEach((id) => next.add(id));
      }
      setSkipIds(next);
      if (ids == null) setSelectedIds(new Set());
      saveSkipIds(vendor, next);
    },
    [vendor, statusTab, selectedIds, skipIds, statusFiltered]
  );

  const tabCounts: Record<StatusFilter, number> = {
    all: excludeUntracked(rows).length,
    order_now: orderNowCount,
    out_of_stock: outOfStockCount,
    overstocked: overstockedCount,
    no_sales: noSalesCount,
    snoozed: snoozedCount,
    untracked: untrackedCount,
    sales_by_brand: 0,
    brand_health: 0,
    naked_armor: 0,
    skip_list: skipListCount,
  };

  const exportTableToCsv = useCallback(() => {
    const dataToExport = statusFiltered.length > 0 ? statusFiltered : filtered;
    const sorted = [...dataToExport].sort((a, b) =>
      productTableSalesSort === "desc"
        ? b.salesPerMonth - a.salesPerMonth
        : a.salesPerMonth - b.salesPerMonth
    );
    const headers = [
      "Product",
      "Vendor",
      "SKU",
      "Sales per month",
      "Trend",
      "Inv",
      "Enough for (days)",
      "Status",
      "OOS (days)",
      "Order in (days)",
      "Est. order",
    ];
    const trendStr = (t: ProductRow["trend"] | undefined) =>
      t === "up" ? "Up" : t === "down" ? "Down" : "—";
    const rows = sorted.map((row) => [
      row.title,
      row.vendor,
      row.sku ?? "",
      row.salesPerMonth.toFixed(1),
      trendStr(row.trend),
      row.inventory,
      row.enoughForDays,
      statusLabel(row.status),
      typeof row.daysOutOfStock === "number" ? row.daysOutOfStock : "",
      row.orderInDays,
      row.estOrder,
    ]);
    const csvContent = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((r) => r.map(escapeCsvCell).join(",")),
    ].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  }, [statusFiltered, filtered, productTableSalesSort]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Products</h1>
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExportMenuOpen((open) => !open)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            aria-expanded={exportMenuOpen}
            aria-haspopup="true"
          >
            Export as ▾
          </button>
          {exportMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                aria-hidden
                onClick={() => setExportMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={exportTableToCsv}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Download as CSV
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search for product title or supplier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm placeholder-gray-500 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded border border-gray-200 bg-white p-1">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusTab(key)}
              className={`rounded px-3 py-1.5 text-sm ${
                statusTab === key
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label} {tabCounts[key] > 0 && `(${tabCounts[key]})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="window" className="text-sm text-gray-600">
            Look back:
          </label>
          <select
            id="window"
            value={windowMonths}
            onChange={(e) => setWindowMonths(e.target.value as DateWindow)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700"
          >
            {DATE_WINDOWS.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="vendor" className="text-sm text-gray-600">
            Brand:
          </label>
          <select
            id="vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700"
          >
            <option value="">Choose a brand…</option>
            <option value={ALL_BRANDS}>All brands</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {statusTab === "sales_by_brand" ? (
        <div className="rounded border border-gray-200 bg-white">
          <p className="mb-3 text-sm text-gray-500">
            Total units sold and sales amount per brand for the selected look-back period.
          </p>
          {loadingBrands ? (
            <div className="py-16 text-center text-gray-500">Loading…</div>
          ) : (
            (() => {
              const brands = brandsSummary ?? [];
              const totalSales = brands.reduce((sum, b) => sum + b.salesAmount, 0);
              const withPct = brands.map((b) => ({
                ...b,
                pct: totalSales > 0 ? (b.salesAmount / totalSales) * 100 : 0,
              }));
              const sorted = [...withPct].sort((a, b) => {
                const { key, dir } = brandTableSort;
                const mult = dir === "asc" ? 1 : -1;
                if (key === "sales") return mult * (a.salesAmount - b.salesAmount);
                return mult * (a.pct - b.pct);
              });
              const toggleSort = (key: "sales" | "pct") => {
                setBrandTableSort((prev) => ({
                  key,
                  dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
                }));
              };
              return (
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-3 font-medium text-gray-700">Brand</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Units sold</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort("sales")}
                          className="inline-flex items-center gap-1 rounded hover:bg-gray-100 px-1 py-0.5 -my-0.5 font-medium text-gray-700"
                        >
                          Sales
                          {brandTableSort.key === "sales" && (
                            <span aria-hidden>{brandTableSort.dir === "desc" ? "↓" : "↑"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort("pct")}
                          className="inline-flex items-center gap-1 rounded hover:bg-gray-100 px-1 py-0.5 -my-0.5 font-medium text-gray-700"
                        >
                          % of total
                          {brandTableSort.key === "pct" && (
                            <span aria-hidden>{brandTableSort.dir === "desc" ? "↓" : "↑"}</span>
                          )}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((b) => (
                      <tr key={b.vendor} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-medium text-gray-900">{b.vendor}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.unitsSold.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-700">
                          ${b.salesAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {totalSales > 0 ? `${b.pct.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          )}
          {(brandsSummary?.length === 0 && !loadingBrands) && (
            <div className="py-12 text-center text-gray-500">No sales data for this period.</div>
          )}
        </div>
      ) : statusTab === "brand_health" ? (
        <div className="rounded border border-gray-200 bg-white">
          <p className="mb-3 text-sm text-gray-500">
            Per-brand summary for the look-back period: sales share, order/stock counts, and trend. Use this to compare brands and decide where to invest or scale down.
          </p>
          {loadingBrandHealth ? (
            <div className="py-16 text-center text-gray-500">Loading…</div>
          ) : (
            (() => {
              const list = brandHealth ?? [];
              const trendLabel = (t: "mostly_up" | "mostly_down" | "mixed") =>
                t === "mostly_up" ? "Mostly up" : t === "mostly_down" ? "Mostly down" : "Mixed";
              return (
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-3 font-medium text-gray-700">Brand</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Sales %</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Order now</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Out of stock</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">No sales</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Overstocked</th>
                      <th className="px-3 py-3 font-medium text-gray-700">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((b) => (
                      <tr key={b.vendor} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-medium text-gray-900">{b.vendor}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.salesPct.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.orderNowCount}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.outOfStockCount}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.noSalesCount}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.overstockedCount}</td>
                        <td className="px-3 py-2">
                          <span className={b.trend === "mostly_up" ? "text-emerald-600" : b.trend === "mostly_down" ? "text-red-600" : "text-gray-600"}>
                            {trendLabel(b.trend)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          )}
          {brandHealth?.length === 0 && !loadingBrandHealth && (
            <div className="py-12 text-center text-gray-500">No brand data for this period.</div>
          )}
        </div>
      ) : statusTab === "naked_armor" ? (
        <div className="rounded border border-gray-200 bg-white">
          <p className="mb-3 text-sm text-gray-500">
            Naked Armor products: units and sales for the selected look-back period (1 / 3 / 6 months). YoY = vs same period last year.
          </p>
          {loadingNakedArmor ? (
            <div className="py-16 text-center text-gray-500">Loading…</div>
          ) : (
            (() => {
              const list = nakedArmorRows ?? [];
              const productTypes = Array.from(new Set(list.map((r) => r.productType).filter(Boolean))).sort((a, b) => a.localeCompare(b));
              const filteredByType = nakedArmorProductTypeFilter
                ? list.filter((r) => r.productType === nakedArmorProductTypeFilter)
                : list;
              const changePct = (row: NakedArmorRow) => {
                if (row.salesAmountLastYear === 0) return null;
                return ((row.salesAmount - row.salesAmountLastYear) / row.salesAmountLastYear) * 100;
              };
              const unitsChangePct = (row: NakedArmorRow) => {
                if (row.unitsSoldLastYear === 0) return null;
                return ((row.unitsSold - row.unitsSoldLastYear) / row.unitsSoldLastYear) * 100;
              };
              const totalSales = filteredByType.reduce((s, r) => s + r.salesAmount, 0);
              const totalUnits = filteredByType.reduce((s, r) => s + r.unitsSold, 0);
              const summaryByType = !nakedArmorProductTypeFilter && list.length > 0
                ? (() => {
                    const byType = new Map<string, { count: number; units: number; sales: number }>();
                    for (const r of list) {
                      const key = r.productType || "—";
                      const cur = byType.get(key) ?? { count: 0, units: 0, sales: 0 };
                      cur.count += 1;
                      cur.units += r.unitsSold;
                      cur.sales += r.salesAmount;
                      byType.set(key, cur);
                    }
                    return Array.from(byType.entries())
                      .filter(([t]) => t !== "—" || byType.get("—")!.count > 0)
                      .map(([type, { count, units, sales }]) => ({ type, count, units, sales }))
                      .sort((a, b) => (a.type === "—" ? 1 : b.type === "—" ? -1 : a.type.localeCompare(b.type)));
                  })()
                : null;
              const sorted = [...filteredByType].sort((a, b) => {
                const mult = nakedArmorSort.dir === "asc" ? 1 : -1;
                if (nakedArmorSort.key === "sales") {
                  return mult * (a.salesAmount - b.salesAmount);
                }
                const pctA = changePct(a);
                const pctB = changePct(b);
                const nullSentinel = nakedArmorSort.dir === "asc" ? Infinity : -Infinity;
                const va = pctA ?? nullSentinel;
                const vb = pctB ?? nullSentinel;
                return mult * (va - vb);
              });
              const trendLabel = (t: "up" | "down" | "stable" | "new") =>
                t === "up" ? "Up" : t === "down" ? "Down" : t === "new" ? "New" : "—";
              const toggleSalesSort = () => {
                setNakedArmorSort((prev) => ({
                  key: "sales",
                  dir: prev.key === "sales" && prev.dir === "desc" ? "asc" : "desc",
                }));
              };
              const toggleChangePctSort = () => {
                setNakedArmorSort((prev) => ({
                  key: "changePct",
                  dir: prev.key === "changePct" && prev.dir === "desc" ? "asc" : "desc",
                }));
              };
              return (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <label htmlFor="naked-armor-type-filter" className="text-sm font-medium text-gray-700">
                      Product type:
                    </label>
                    <select
                      id="naked-armor-type-filter"
                      value={nakedArmorProductTypeFilter}
                      onChange={(e) => setNakedArmorProductTypeFilter(e.target.value)}
                      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    >
                      <option value="">All types</option>
                      {productTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {nakedArmorProductTypeFilter && (
                      <span className="text-sm text-gray-500">
                        {filteredByType.length} of {list.length} products
                      </span>
                    )}
                  </div>
                  {summaryByType && summaryByType.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-4 rounded border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm">
                      <span className="font-medium text-gray-700">By type:</span>
                      {summaryByType.map(({ type, count, units, sales }) => (
                        <span key={type} className="text-gray-600">
                          <strong className="text-gray-800">{type}</strong>
                          {" – "}
                          {count} products, {units.toLocaleString()} units, ${sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ))}
                    </div>
                  )}
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-3 font-medium text-gray-700">Product</th>
                      <th className="px-3 py-3 font-medium text-gray-700">Product type</th>
                      <th className="px-3 py-3 font-medium text-gray-700">SKU</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Units</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Units (prior year)</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Units chg %</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">
                        <button
                          type="button"
                          onClick={toggleSalesSort}
                          className="inline-flex items-center gap-1 rounded hover:bg-gray-100 px-1 py-0.5 -my-0.5 font-medium text-gray-700"
                        >
                          Sales
                          {nakedArmorSort.key === "sales" && (
                            <span aria-hidden>{nakedArmorSort.dir === "desc" ? "↓" : "↑"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">% of total</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Price</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">Sales (prior year)</th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">
                        <button
                          type="button"
                          onClick={toggleChangePctSort}
                          className="inline-flex items-center gap-1 rounded hover:bg-gray-100 px-1 py-0.5 -my-0.5 font-medium text-gray-700"
                        >
                          Change %
                          {nakedArmorSort.key === "changePct" && (
                            <span aria-hidden>{nakedArmorSort.dir === "desc" ? "↓" : "↑"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-3 py-3 font-medium text-gray-700 text-right">YoY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => {
                      const pct = changePct(row);
                      const pctStr = pct === null ? "—" : (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
                      const unitsPct = unitsChangePct(row);
                      const unitsPctStr = unitsPct === null ? "—" : (unitsPct > 0 ? "+" : "") + unitsPct.toFixed(1) + "%";
                      const pctOfTotal = totalSales > 0 ? (row.salesAmount / totalSales) * 100 : 0;
                      const price = row.unitsSold > 0 ? row.salesAmount / row.unitsSold : null;
                      return (
                        <tr key={row.variantId} className="border-b border-gray-100 hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-medium text-gray-900">{row.title}</td>
                          <td className="px-3 py-2 text-gray-600">{row.productType || "—"}</td>
                          <td className="px-3 py-2 text-gray-600">{row.sku || "—"}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{row.unitsSold.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{row.unitsSoldLastYear.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={unitsPct === null ? "text-gray-500" : unitsPct > 0 ? "text-emerald-600" : unitsPct < 0 ? "text-red-600" : "text-gray-500"}>
                              {unitsPctStr}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-700">
                            ${row.salesAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {totalSales > 0 ? `${pctOfTotal.toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {price != null ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            ${row.salesAmountLastYear.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={pct === null ? "text-gray-500" : pct > 0 ? "text-emerald-600" : pct < 0 ? "text-red-600" : "text-gray-500"}>
                              {pctStr}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={row.trend === "up" ? "text-emerald-600" : row.trend === "down" ? "text-red-600" : "text-gray-500"}>
                              {trendLabel(row.trend)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </>
              );
            })()
          )}
          {nakedArmorRows?.length === 0 && !loadingNakedArmor && (
            <div className="py-12 text-center text-gray-500">No Naked Armor data for this period.</div>
          )}
        </div>
      ) : !vendor ? (
        <div className="flex flex-col items-center justify-center rounded border border-gray-200 bg-gray-50/50 py-16 text-center">
          <p className="mb-1 text-gray-600">Select a brand above to view its products.</p>
          <p className="text-sm text-gray-500">Choose a brand from the dropdown to load inventory and forecast data.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          Loading products…
        </div>
      ) : (
        <>
          {statusTab === "no_sales" && (
            <p className="mb-3 text-sm text-gray-500">
              {vendor === ALL_BRANDS
                ? "No Sales across all brands: zero sales in the look-back period and currently in stock."
                : hasSixMonthsSnapshotData
                  ? "No Sales: zero sales in the look-back period and in stock for the full 6 months (never went out of stock). Set Look back to 6 months."
                  : "No Sales: zero sales in the look-back period and currently in stock. Set Look back to 6 months. Once we have ~6 months of daily snapshots, we’ll restrict this to items that were in stock the entire time."}
            </p>
          )}
          {statusTab === "skip_list" && (
            <p className="mb-3 text-sm text-gray-500">
              Items to skip when ordering: you marked them as Don&apos;t order, or they are suggested (overstocked + no sales). Remove from list to allow ordering again.
            </p>
          )}
          {selectedIds.size > 0 && (
            <div className="mb-3 flex items-center gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-600">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-100"
                onClick={() => handleToggleUntracked()}
              >
                {statusFiltered.filter((r) => selectedIds.has(r.id)).every((r) => untrackedIds.has(r.id))
                  ? "Remove from Untracked"
                  : "Move to Untracked"}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-500 hover:bg-gray-100"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear selection
              </button>
              {(statusTab === "skip_list" || statusTab === "all" || statusTab === "overstocked" || statusTab === "no_sales") && (
                <button
                  type="button"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-100"
                  onClick={() => handleToggleSkip()}
                >
                  {statusFiltered.filter((r) => selectedIds.has(r.id)).every((r) => skipIds.has(r.id))
                    ? "Remove from Don't order"
                    : "Add to Don't order"}
                </button>
              )}
            </div>
          )}
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={
                      statusFiltered.length > 0 &&
                      statusFiltered.every((r) => selectedIds.has(r.id))
                    }
                    onChange={selectAllVisible}
                    title="Select all visible"
                  />
                </th>
                <th className="px-3 py-3 font-medium text-gray-700">Product</th>
                <th className="px-3 py-3 font-medium text-gray-700">
                  <button
                    type="button"
                    onClick={() => setProductTableSalesSort((d) => (d === "desc" ? "asc" : "desc"))}
                    className="inline-flex items-center gap-1 rounded hover:bg-gray-100 px-1 py-0.5 -my-0.5 font-medium text-gray-700"
                  >
                    Sales
                    <span aria-hidden>{productTableSalesSort === "desc" ? "↓" : "↑"}</span>
                  </button>
                </th>
                <th className="px-3 py-3 font-medium text-gray-700" title="Last 3 months vs previous 3 months">Trend</th>
                <th className="px-3 py-3 font-medium text-gray-700">Inv</th>
                <th className="px-3 py-3 font-medium text-gray-700">Enough for</th>
                <th className="px-3 py-3 font-medium text-gray-700">Status</th>
                <th className="px-3 py-3 font-medium text-gray-700" title="Days out of stock (from daily snapshots)">OOS (days)</th>
                <th className="px-3 py-3 font-medium text-gray-700">Order in</th>
                <th className="px-3 py-3 font-medium text-gray-700">Est. order</th>
                {statusTab === "skip_list" && (
                  <th className="px-3 py-3 font-medium text-gray-700">Source</th>
                )}
                <th className="px-3 py-3 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...statusFiltered]
                .sort((a, b) =>
                  productTableSalesSort === "desc"
                    ? b.salesPerMonth - a.salesPerMonth
                    : a.salesPerMonth - b.salesPerMonth
                )
                .map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 hover:bg-gray-50/50"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-100">
                        {row.thumbnail ? (
                          <img
                            src={row.thumbnail}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-gray-400">
                            —
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{row.title}</div>
                        <div className="text-gray-500">{row.vendor}</div>
                        {row.sku && (
                          <div className="text-xs text-gray-400">
                            SKU: {row.sku}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {row.salesPerMonth.toFixed(1)} / month
                  </td>
                  <td className="px-3 py-2" title="Last 3 mo vs previous 3 mo">
                    {row.trend === "up" && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-600" title="Growing">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                        Up
                      </span>
                    )}
                    {row.trend === "down" && (
                      <span className="inline-flex items-center gap-0.5 text-red-600" title="Slowing">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                        Down
                      </span>
                    )}
                    {(row.trend === "stable" || !row.trend) && (
                      <span className="text-gray-500" title="Stable">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{row.inventory}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {row.enoughForDays} days
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-tight whitespace-nowrap ${statusClass(
                        row.status
                      )}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600" title={typeof row.daysOutOfStock === "number" ? "Days since last in-stock snapshot" : row.inventory > 0 ? "In stock" : "Unknown (no snapshot history)"}>
                    {typeof row.daysOutOfStock === "number"
                      ? `${row.daysOutOfStock} days`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {row.orderInDays >= 0
                      ? `${row.orderInDays} days`
                      : `${row.orderInDays} days`}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {row.estOrder}
                  </td>
                  {statusTab === "skip_list" && (
                    <td className="px-3 py-2 text-gray-600">
                      {skipIds.has(row.id) ? (
                        <span className="text-[10px] font-medium text-amber-700">Marked</span>
                      ) : isSuggestedSkip(row) ? (
                        <span className="text-[10px] text-gray-500">Suggested</span>
                      ) : null}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        title="Order"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`rounded p-1.5 ${
                          untrackedIds.has(row.id)
                            ? "bg-gray-200 text-gray-700"
                            : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        }`}
                        title={untrackedIds.has(row.id) ? "Remove from Untracked" : "Move to Untracked"}
                        onClick={() => handleToggleUntracked([row.id])}
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`rounded p-1.5 ${
                          skipIds.has(row.id)
                            ? "bg-amber-100 text-amber-800"
                            : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        }`}
                        title={skipIds.has(row.id) ? "Remove from Don't order" : "Don't order (add to skip list)"}
                        onClick={() => handleToggleSkip([row.id])}
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {statusFiltered.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              No products match your filters.
            </div>
          )}
        </div>
        </>
      )}

      <footer className="mt-6 text-center text-sm text-gray-500">
        <a
          href="https://admin.shopify.com/store/naked-armor"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-700"
        >
          Open Shopify admin →
        </a>
      </footer>
    </div>
  );
}
