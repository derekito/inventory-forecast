# Inventory Forecast – Naked Armor

A simple web app to forecast sales and re-order inventory for [nakedarmor.com](https://nakedarmor.com), using your Shopify store data.

## Features

- **Shopify login**: Uses your Shopify Admin API credentials (API key / access token).
- **Look-back windows**: View sales over 1-month, 3-month, or 6-month windows to drive forecasts.
- **Brand filter**: Filter products by vendor (brand).
- **Search**: Search by product title or supplier (vendor).
- **Product table**: Thumbnail, title, vendor, SKU, Sales, Inventory, Enough for, Status, Order in, Est. order, and Actions.
- **Filter tabs**: All, Order now, Out of stock, Overstocked, Ordered, Snoozed, Untracked.

## Setup

1. **Clone or open this project**, then install dependencies:

   ```bash
   cd inventory-forecast
   npm install
   ```

2. **Configure Shopify**:

   - In [Shopify Admin](https://admin.shopify.com/store/naked-armor), go to **Settings → Apps and sales channels → Develop apps** and create (or use) a custom app.
   - Give the app at least: **Read** access to **Products**, **Inventory**, and **Orders** (and **Read all orders** if you need more than 60 days of order history).
   - From the app’s **API credentials** page, copy the **Admin API access token** (sometimes shown as “API secret key” for custom apps).

3. **Environment variables**:

   - Copy `.env.example` to `.env.local`:
     ```bash
     cp .env.example .env.local
     ```
   - Edit `.env.local` and set:
     - `NEXT_PUBLIC_SHOPIFY_STORE` = your store handle (e.g. `naked-armor` from `https://admin.shopify.com/store/naked-armor`).
     - `SHOPIFY_ACCESS_TOKEN` = the Admin API access token from step 2.

4. **Run the app**:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

   **Large catalogs (1000+ products):** The app fetches up to 500 products by default to stay within API limits. To change this, set `NEXT_PUBLIC_MAX_PRODUCTS` in `.env.local` (max 1000).

## How forecasting works

- **Sales**: Average units sold per month over the selected 1-, 3-, or 6-month window (from order line items).
- **Enough for**: Current inventory ÷ (sales per month ÷ 30) → days of stock.
- **Order in**: Days until you should reorder (negative = overdue), based on a 30-day safety buffer.
- **Est. order**: Recommended order quantity to cover about 90 days of sales: `max(0, ceil(90-day demand − current inventory)`.

Status is derived from inventory and “enough for” days: **Out of stock**, **Order now**, **Overstocked**, or **Untracked** (Ordered/Snoozed would come from your own tracking later).

## Tech stack

- **Next.js 14** (App Router), **TypeScript**, **Tailwind CSS**
- **Shopify REST Admin API** (products, inventory levels, orders)

## Security

- Never commit `.env.local` or your access token. The token is only used on the server (API routes).

cd /Users/yemanja/Documents/inventory-forecast
npm install
npm run dev