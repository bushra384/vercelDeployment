// Express backend using Cheerio to scrape Noon Minutes products
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const PRODUCTS_JSON = path.join(__dirname, '../noon_products.json');

// Helper to detect Vercel environment
const isVercel = !!process.env.VERCEL;

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0'
];

// Helper to fetch and parse a page with timeout and retry logic
async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Pick a random user agent for each request
      const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': userAgent },
        timeout: 15000000 // 15 seconds
      });
      return cheerio.load(data);
    } catch (err) {
      console.error(`fetchPage error (attempt ${attempt}):`, err.code || err.message);
      if (attempt === retries) throw new Error(`Failed to fetch ${url}: ${err.code || err.message}`);
      await new Promise(r => setTimeout(r, 2000)); // wait 2 sec before retry
    }
  }
}

// Scrape all fruits and vegetables products
async function scrapeNoonProducts() {
  let allProducts = [];
  let page = 1;
  let nextPageUrl = 'https://minutes.noon.com/uae-en/search/?f[category]=fruits_vegetables';
  const seenProductIds = new Set();
  // Limit pages if on Vercel
  const maxPages = isVercel ? 1 : 2; // 1 page on Vercel, up to 10 locally
  while (nextPageUrl && page <= maxPages) {
    console.log(`Scraping page ${page}`);
    const $ = await fetchPage(nextPageUrl);
    const productCards = $("div.catalogList_instantCatalogList__gUTOP a");
    if (!productCards.length) break;
    let pageProducts = 0;
    productCards.each((i, el) => {
      const card = $(el);
      // Extract product ID from href
      const href = card.attr('href') || '';
      let product_id = null;
      const match = href.match(/\/now-product\/([^/]+)\//);
      if (match) product_id = match[1];
      if (!product_id || seenProductIds.has(product_id)) return;
      seenProductIds.add(product_id);
      // Extract text data
      const data = card.text().split('\n').map(s => s.trim()).filter(Boolean);
      // Filter promotional/non-product elements
      const filtered = data.filter(item => {
        if (["ADD", "OFF", "ON", "SALE", "NEW", "HOT"].includes(item.toUpperCase())) return false;
        if (/%/.test(item)) return false;
        if (/^AED/.test(item)) return false;
        if (/^\d{1,2}$/.test(item)) return false;
        if (/^[A-Za-z]{1,2}$/.test(item)) return false;
        return true;
      });
      if (filtered.length < 3) return;
      // Image
      let image_url = '';
      const img = card.find('img');
      if (img.length) {
        const src = img.attr('src');
        if (src && src.includes('f.nooncdn.com/')) image_url = src;
      }
      // Price
      let price = '', original_price = '';
      const prices = filtered.filter(d => /AED|\d+[.,]?\d*/.test(d)).map(d => d.replace('AED', '').trim());
      if (prices.length === 1) price = prices[0];
      if (prices.length >= 2) { price = prices[0]; original_price = prices[1]; }
      // Product object
      allProducts.push({
        product_id,
        origin: filtered[0] || '',
        name: filtered[1] || '',
        size: filtered[2] || '',
        price,
        original_price,
        image_url,
        page
      });
      pageProducts++;
    });
    // Find next page link
    const nextBtn = $("a[role='button'][aria-label='Next page'][rel='next'][aria-disabled='false']");
    if (nextBtn.length) {
      let nextHref = nextBtn.attr('href');
      if (nextHref) {
        nextPageUrl = new URL(nextHref, nextPageUrl).href;
        page++;
        if (!isVercel) {
          await new Promise(r => setTimeout(r, 2000)); // Only delay locally
        }
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return allProducts;
}

app.get('/search', async (req, res) => {
  const start = Date.now();
  try {
    const result = await scrapeNoonProducts();
    const uniquePages = new Set(result.map(p => p.page));
    if (uniquePages.size >= 1) {
      if (!isVercel && uniquePages.size >= 5) {
        fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(result, null, 2), 'utf-8');
      }
      const elapsed = Date.now() - start;
      console.log(`/search took ${elapsed}ms`);
      return res.json({ elapsed_ms: elapsed, products: result });
    } else {
      if (fs.existsSync(PRODUCTS_JSON)) {
        const existing = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf-8'));
        const elapsed = Date.now() - start;
        return res.json({ elapsed_ms: elapsed, products: existing });
      } else {
        return res.status(500).json({ error: 'Not enough data scraped and no previous data found.' });
      }
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/download', (req, res) => {
  if (fs.existsSync(PRODUCTS_JSON)) {
    res.download(PRODUCTS_JSON, 'noon_products.json');
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// Scrape product details
app.get('/product-details/:product_id', async (req, res) => {
  const start = Date.now();
  const { product_id } = req.params;
  const image_url_fallback = req.query.image_url;

  try {
    const url = `https://minutes.noon.com/uae-en/now-product/${product_id}/`;
    const $ = await fetchPage(url);

    // Product name
    const name = $('h1').first().text().trim() || null;

    // Size
    let size = null;
    const infoDiv = $("div[class*='ProductDetails_infoWrapper'] > div").first();
    if (infoDiv.length) size = infoDiv.text().trim();

    // Image
    let image_url = null;
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && /\/p\/pzsku\//.test(src)) {
        image_url = src;
        return false;
      }
    });
    if (!image_url) image_url = image_url_fallback;

    // Description and features
    let desc = null;
    let features = [];

    // 1. Try with original selector (Horilla-like structure)
    const mainDescDiv = $('body > div.layout_pageWrapper__W_ZgS > div:nth-child(2) > div:nth-child(4)');
    if (mainDescDiv.length) {
      desc = mainDescDiv.text().trim();
      const ul = mainDescDiv.find('ul');
      if (ul.length) {
        features = ul.find('li').map((i, li) => $(li).text().trim()).get();
      }
    }

    // 2. Fallback to older style (description and features in styled div)
    if (!desc || features.length === 0) {
      $("div[style*='margin-top: 20px'][style*='color: rgb(126, 133, 155)']").each((i, div) => {
        const p = $(div).find('p').first();
        if (p.length) desc = p.text().trim();
        else desc = $(div).text().trim();

        // Append any <li> inside this block
        const localFeatures = $(div).find('li').map((i, li) => $(li).text().trim()).get();
        if (localFeatures.length) features = localFeatures;

        if (desc) return false; // Break loop
      });
    }

    // 3. Last resort: heuristic description
    if (!desc) {
      $('div').each((i, div) => {
        const t = $(div).text().trim();
        if (t && t.length > 30 && t.toLowerCase().includes('fruit')) {
          desc = t;
          return false;
        }
      });
    }

    // 4. Final fallback for features: find first <ul> in body
    if (features.length === 0) {
      const ul = $('ul').first();
      if (ul.length) {
        features = ul.find('li').map((i, li) => $(li).text().trim()).get();
      }
    }

    // Price logic
    let price = null, original_price = null;
    const priceCandidates = [];
    $("span").each((i, el) => {
      const txt = $(el).text().trim();
      if (txt && /AED|د.إ|\d/.test(txt)) priceCandidates.push(txt);
    });
    if (priceCandidates.length > 0) price = priceCandidates[0];
    if (priceCandidates.length > 1) original_price = priceCandidates[1];

    // Delivery text
    let delivery = null;
    $('*').each((i, el) => {
      const txt = $(el).text().trim();
      if (/Arrives in/.test(txt)) {
        delivery = txt;
        return false;
      }
    });

    // Final response
    const elapsed = Date.now() - start;
    res.json({
      product_id,
      name,
      size,
      price,
      original_price,
      delivery,
      description: desc,
      features,
      image_url,
      elapsed_ms: elapsed
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
