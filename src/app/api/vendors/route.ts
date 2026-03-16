import { fetchAllVendors } from "@/lib/shopify";

export async function GET() {
  const token = (process.env.SHOPIFY_ACCESS_TOKEN ?? "").trim();
  if (!token) {
    return Response.json(
      { error: "Missing SHOPIFY_ACCESS_TOKEN in .env.local" },
      { status: 500 }
    );
  }
  try {
    const vendors = await fetchAllVendors();
    return Response.json({ vendors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[vendors]", e);
    const isAuth = /401|invalid.*token|unrecognized login/i.test(message);
    return Response.json(
      { error: message },
      { status: isAuth ? 401 : 500 }
    );
  }
}
