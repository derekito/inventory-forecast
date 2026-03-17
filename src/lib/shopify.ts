const token = (process.env.SHOPIFY_ACCESS_TOKEN ?? "").trim();
const API_VERSION = "2024-10";

function getStoreHost(): string {
  const raw = (process.env.NEXT_PUBLIC_SHOPIFY_STORE ?? "").trim();
  if (!raw) return "";
  if (raw.includes(".myshopify.com")) return raw.replace(/^https?:\/\//, "").split("/")[0];
  return `${raw}.myshopify.com`;
}
const storeHost = getStoreHost();
const GRAPHQL_URL = storeHost ? `https://${storeHost}/admin/api/${API_VERSION}/graphql.json` : "";

// Keep requests small to avoid Shopify rate/cost limits (e.g. 1000+ products)
const PRODUCTS_PAGE_SIZE = 50;
const VARIANTS_PER_PRODUCT = 50;
const MAX_PRODUCTS = Math.min(Number(process.env.NEXT_PUBLIC_MAX_PRODUCTS) || 500, 1000);

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!GRAPHQL_URL) throw new Error("Shopify store host not configured (NEXT_PUBLIC_SHOPIFY_STORE)");
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("[Shopify] Request failed:", res.status, GRAPHQL_URL.replace(storeHost, "[store]"), body.slice(0, 200));
    throw new Error(`Shopify GraphQL: ${res.status} ${body}`);
  }
  const json = JSON.parse(body) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

function parseGid(gid: string): number {
  const match = String(gid).match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

// --- Types (GraphQL responses and our normalized types) ---

export type ShopifyProduct = {
  id: number;
  title: string;
  vendor: string;
  productType: string;
  variants: Array<{
    id: number;
    sku: string | null;
    inventory_item_id: number;
    title: string;
  }>;
  image: { src: string } | null;
  images: Array<{ src: string }>;
};

export type ShopifyOrder = {
  id: number;
  created_at: string;
  line_items: Array<{
    product_id: number;
    variant_id: number;
    sku: string | null;
    quantity: number;
    name: string;
  }>;
};

/** Build product search query: status:active and optional vendor filter. */
function productSearchQuery(vendor?: string): string {
  const base = "status:active";
  if (!vendor || !vendor.trim()) return base;
  const v = vendor.trim();
  const needsQuotes = /[\s"]/.test(v);
  const escaped = needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v;
  return `${base} vendor:${escaped}`;
}

type ProductsQueryResponse = {
  products: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        title: string;
        vendor: string;
        productType?: string | null;
        media?: {
          edges: Array<{
            node?: {
              image?: { url: string };
            };
          }>;
        };
        variants: {
          edges: Array<{
            node: {
              id: string;
              sku: string | null;
              inventoryItem: { id: string } | null;
              title: string;
            };
          }>;
        };
      };
    }>;
    pageInfo: { hasNextPage: boolean };
  };
};

export async function fetchProducts(options?: { vendor?: string }): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  let cursor: string | null = null;
  const queryString = productSearchQuery(options?.vendor);

  const productsQuery = `
    query Products($cursor: String, $first: Int!, $query: String!) {
      products(first: $first, after: $cursor, query: $query) {
        edges {
          cursor
          node {
            id
            title
            vendor
            productType
            media(first: 1) {
              edges {
                node {
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }
            }
            variants(first: ${VARIANTS_PER_PRODUCT}) {
              edges {
                node {
                  id
                  sku
                  inventoryItem { id }
                  title
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  while (out.length < MAX_PRODUCTS) {
    const data = await graphql<ProductsQueryResponse>(productsQuery, {
      first: Math.min(PRODUCTS_PAGE_SIZE, MAX_PRODUCTS - out.length),
      query: queryString,
      ...(cursor ? { cursor } : {}),
    });

    const products = data.products;
    for (const edge of products.edges) {
      const node = edge.node;
      const imageUrl =
        node.media?.edges?.[0]?.node?.image?.url ?? null;
      const variants = (node.variants?.edges ?? []).map((ve) => {
        const v = ve.node;
        return {
          id: parseGid(v.id),
          sku: v.sku ?? null,
          inventory_item_id: v.inventoryItem ? parseGid(v.inventoryItem.id) : 0,
          title: v.title,
        };
      });
      out.push({
        id: parseGid(node.id),
        title: node.title,
        vendor: node.vendor ?? "",
        productType: node.productType ?? "",
        image: imageUrl ? { src: imageUrl } : null,
        images: imageUrl ? [{ src: imageUrl }] : [],
        variants,
      });
    }

    if (!products.pageInfo.hasNextPage) break;
    cursor = products.edges[products.edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  return out;
}

/** Line item with vendor and price for sales-by-brand aggregation. */
export type OrderLineForBrand = {
  vendor: string;
  quantity: number;
  unitPriceAmount: number;
};

/** Line item with variant id for per-variant aggregation (e.g. Naked Armor YoY). */
export type OrderLineForVariant = {
  variantId: number;
  vendor: string;
  quantity: number;
  unitPriceAmount: number;
};

/** Fetches orders with line item vendor and price for sales-by-brand. */
export async function fetchOrdersForSalesByBrand(since: string): Promise<OrderLineForBrand[]> {
  const out: OrderLineForBrand[] = [];
  let cursor: string | null = null;
  const sinceDate = new Date(since).toISOString();

  const ordersQuery = `
    query OrdersForSalesByBrand($cursor: String, $query: String) {
      orders(first: ${ORDERS_PAGE_SIZE}, after: $cursor, query: $query, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            lineItems(first: 100) {
              edges {
                node {
                  vendor
                  quantity
                  originalUnitPriceSet {
                    shopMoney { amount }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  while (true) {
    const data = await graphql<{
      orders: {
        edges: Array<{
          cursor: string;
          node: {
            lineItems: {
              edges: Array<{
                node: {
                  vendor: string | null;
                  quantity: number;
                  originalUnitPriceSet?: { shopMoney?: { amount?: string } } | null;
                };
              }>;
            };
          };
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(ordersQuery, {
      cursor: cursor ?? undefined,
      query: `created_at:>=${sinceDate}`,
    });

    const orders = data.orders;
    for (const edge of orders.edges) {
      for (const le of edge.node.lineItems?.edges ?? []) {
        const n = le.node;
        const vendor = (n.vendor ?? "").trim() || "—";
        const qty = n.quantity ?? 0;
        const amountStr = n.originalUnitPriceSet?.shopMoney?.amount;
        const unitPrice = amountStr != null ? parseFloat(amountStr) : 0;
        if (vendor && (qty > 0 || unitPrice > 0))
          out.push({ vendor, quantity: qty, unitPriceAmount: unitPrice });
      }
    }

    if (!orders.pageInfo.hasNextPage) break;
    cursor = orders.edges[orders.edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  return out;
}

/** Fetches order line items with variant id and price. If until is set, only includes orders with createdAt < until. */
export async function fetchOrderLinesWithVariant(since: string, until?: string): Promise<OrderLineForVariant[]> {
  const out: OrderLineForVariant[] = [];
  let cursor: string | null = null;
  const sinceDate = new Date(since).toISOString();
  const untilDate = until ? new Date(until).toISOString() : null;

  const ordersQuery = `
    query OrdersForVariantLines($cursor: String, $query: String) {
      orders(first: ${ORDERS_PAGE_SIZE}, after: $cursor, query: $query, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            createdAt
            lineItems(first: 100) {
              edges {
                node {
                  variant { id }
                  vendor
                  quantity
                  originalUnitPriceSet {
                    shopMoney { amount }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  while (true) {
    const data = await graphql<{
      orders: {
        edges: Array<{
          cursor: string;
          node: {
            createdAt: string;
            lineItems: {
              edges: Array<{
                node: {
                  variant: { id: string } | null;
                  vendor: string | null;
                  quantity: number;
                  originalUnitPriceSet?: { shopMoney?: { amount?: string } } | null;
                };
              }>;
            };
          };
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(ordersQuery, {
      cursor: cursor ?? undefined,
      query: `created_at:>=${sinceDate}`,
    });

    const orders = data.orders;
    for (const edge of orders.edges) {
      const orderCreatedAt = edge.node.createdAt;
      if (untilDate && orderCreatedAt >= untilDate) continue;
      for (const le of edge.node.lineItems?.edges ?? []) {
        const n = le.node;
        const variantId = n.variant ? parseGid(n.variant.id) : 0;
        if (!variantId) continue;
        const vendor = (n.vendor ?? "").trim() || "—";
        const qty = n.quantity ?? 0;
        const amountStr = n.originalUnitPriceSet?.shopMoney?.amount;
        const unitPrice = amountStr != null ? parseFloat(amountStr) : 0;
        if (qty > 0 || unitPrice > 0)
          out.push({ variantId, vendor, quantity: qty, unitPriceAmount: unitPrice });
      }
    }

    if (!orders.pageInfo.hasNextPage) break;
    cursor = orders.edges[orders.edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  return out;
}

const NODES_CHUNK = 50;
const ORDERS_PAGE_SIZE = 100;
const VENDORS_PAGE_SIZE = 200;

export async function fetchInventoryLevels(inventoryItemIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (let i = 0; i < inventoryItemIds.length; i += NODES_CHUNK) {
    const chunk = inventoryItemIds.slice(i, i + NODES_CHUNK);
    const ids = chunk.map((id) => `gid://shopify/InventoryItem/${id}`);
    const query = `
      query InventoryLevels($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on InventoryItem {
            id
            inventoryLevels(first: 20) {
              edges {
                node {
                  quantities(names: ["available"]) { quantity }
                }
              }
            }
          }
        }
      }
    `;
    const data = await graphql<{
      nodes: Array<{
        id: string;
        inventoryLevels?: {
          edges: Array<{ node: { quantities: Array<{ quantity: number }> } }>;
        };
      } | null>;
    }>(query, { ids });

    data.nodes?.forEach((n, j) => {
      if (!n || !("inventoryLevels" in n)) return;
      const itemId = chunk[j];
      if (itemId == null) return;
      let total = 0;
      for (const e of n.inventoryLevels?.edges ?? []) {
        total += e.node.quantities?.[0]?.quantity ?? 0;
      }
      map.set(itemId, total);
    });
  }
  return map;
}

// Lightweight fetch for vendor list – only pulls product vendors, across full catalog.
export async function fetchAllVendors(): Promise<string[]> {
  const vendors = new Set<string>();
  let cursor: string | null = null;

  const query = `
    query VendorProducts($cursor: String, $first: Int!) {
      products(first: $first, after: $cursor) {
        edges {
          cursor
          node {
            vendor
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  while (true) {
    const data = await graphql<{
      products: {
        edges: Array<{
          cursor: string;
          node: { vendor: string };
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(query, {
      first: VENDORS_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });

    const { products } = data;
    for (const edge of products.edges) {
      const v = (edge.node.vendor || "").trim();
      if (v) vendors.add(v);
    }

    if (!products.pageInfo.hasNextPage) break;
    cursor = products.edges[products.edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  return Array.from(vendors).sort((a, b) => a.localeCompare(b));
}

export async function fetchOrdersSince(since: string): Promise<ShopifyOrder[]> {
  const out: ShopifyOrder[] = [];
  let cursor: string | null = null;
  const sinceDate = new Date(since).toISOString();

  const ordersQuery = `
    query Orders($cursor: String, $query: String) {
      orders(first: ${ORDERS_PAGE_SIZE}, after: $cursor, query: $query, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            id
            createdAt
            lineItems(first: 100) {
              edges {
                node {
                  variant { id }
                  product { id }
                  quantity
                  sku
                  name
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  while (true) {
    const data = await graphql<{
      orders: {
        edges: Array<{
          cursor: string;
          node: {
            id: string;
            createdAt: string;
            lineItems: {
              edges: Array<{
                node: {
                  variant: { id: string } | null;
                  product: { id: string } | null;
                  quantity: number;
                  sku: string | null;
                  name: string;
                };
              }>;
            };
          };
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(ordersQuery, {
      cursor: cursor ?? undefined,
      query: `created_at:>=${sinceDate}`,
    });

    const orders = data.orders;
    for (const edge of orders.edges) {
      const node = edge.node;
      const line_items = (node.lineItems?.edges ?? []).map((le) => {
        const n = le.node;
        return {
          product_id: n.product ? parseGid(n.product.id) : 0,
          variant_id: n.variant ? parseGid(n.variant.id) : 0,
          sku: n.sku ?? null,
          quantity: n.quantity ?? 0,
          name: n.name ?? "",
        };
      });
      out.push({
        id: parseGid(node.id),
        created_at: node.createdAt,
        line_items,
      });
    }

    if (!orders.pageInfo.hasNextPage) break;
    cursor = orders.edges[orders.edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  return out;
}
