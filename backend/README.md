# Noon Minutes Backend

## Scraping Behavior

- **On Vercel (free plan):**
  - Scraping is limited to **1 page** per request to avoid Vercel's 10-second timeout.
  - The `/search` endpoint will return only the first page of products.
  - The `/product-details/:product_id` endpoint fetches details for a single product and is optimized for speed.
- **Locally:**
  - Scraping will fetch up to 10 pages (or as many as available), with a 2-second delay between pages to avoid rate-limiting.
  - The `/search` endpoint will return all scraped products and cache them to `noon_products.json` if 5 or more pages are scraped.

## How to Run Locally

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Start the server:
   ```bash
   node api/main.js
   ```
3. Access endpoints:
   - `GET /search` — Scrapes all available pages (up to 10) and returns products.
   - `GET /product-details/:product_id` — Fetches details for a single product.

## How to Deploy to Vercel

1. Deploy the `backend` folder as a Vercel serverless function.
2. On Vercel, the backend will automatically limit scraping to 1 page per request.
3. Endpoints:
   - `GET /api/search` — Returns products from the first page only.
   - `GET /api/product-details/:product_id` — Returns product details quickly.

## Notes
- If you need to scrape all products, run the backend locally and use the `/download` endpoint to get the full dataset.
- The backend detects Vercel by checking the `VERCEL` environment variable. 