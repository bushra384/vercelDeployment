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

// Helper to fetch and parse a page
async function fetchPage(url) {
  console.log(`[fetchPage] Fetching URL: ${url}`);
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return cheerio.load(data);
}

// Scrape all fruits and vegetables products
async function scrapeNoonProducts() {
  console.log('[scrapeNoonProducts] Starting product scraping...');
  let allProducts = [];
  let page = 1;
  let nextPageUrl = 'https://minutes.noon.com/uae-en/search/?f[category]=fruits_vegetables';
  const seenProductIds = new Set();

  while (nextPageUrl) {
    console.log(`[scrapeNoonProducts] Scraping page ${page}: ${nextPageUrl}`);
    const $ = await fetchPage(nextPageUrl);
    const productCards = $("div.catalogList_instantCatalogList__gUTOP a");

    if (!productCards.length) {
      console.log(`[scrapeNoonProducts] No product cards found on page ${page}`);
      break;
    }

    let pageProducts = 0;
    productCards.each((i, el) => {
      const card = $(el);
      const href = card.attr('href') || '';
      const match = href.match(/\/now-product\/([^/]+)\//);
      if (!match) return;

      const product_id = match[1];
      if (seenProductIds.has(product_id)) return;
      seenProductIds.add(product_id);

      const data = card.text().split('\n').map(s => s.trim()).filter(Boolean);
      const filtered = data.filter(item => {
        if (["ADD", "OFF", "ON", "SALE", "NEW", "HOT"].includes(item.toUpperCase())) return false;
        if (/%/.test(item)) return false;
        if (/^AED/.test(item)) return false;
        if (/^\d{1,2}$/.test(item)) return false;
        if (/^[A-Za-z]{1,2}$/.test(item)) return false;
        return true;
      });

      if (filtered.length < 3) return;

      let image_url = '';
      const img = card.find('img');
      if (img.length) {
        const src = img.attr('src');
        if (src && src.includes('f.nooncdn.com/')) image_url = src;
      }

      let price = '', original_price = '';
      const prices = filtered.filter(d => /AED|\d+[.,]?\d*/.test(d)).map(d => d.replace('AED', '').trim());
      if (prices.length === 1) price = prices[0];
      if (prices.length >= 2) { price = prices[0]; original_price = prices[1]; }

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

    console.log(`[scrapeNoonProducts] Page ${page} scraped: ${pageProducts} products.`);

    const nextBtn = $("a[role='button'][aria-label='Next page'][rel='next'][aria-disabled='false']");
    if (nextBtn.length) {
      const nextHref = nextBtn.attr('href');
      if (nextHref) {
        nextPageUrl = new URL(nextHref, nextPageUrl).href;
        page++;
        await new Promise(r => setTimeout(r, 2000));
      } else {
        break;
      }
    } else {
      break;
    }
  }

  console.log(`[scrapeNoonProducts] Finished scraping. Total products: ${allProducts.length}`);
  return allProducts;
}

app.get('/search', async (req, res) => {
  console.log('[GET /search] Hit endpoint');
  try {
    const result = await scrapeNoonProducts();
    const uniquePages = new Set(result.map(p => p.page));

    if (uniquePages.size >= 5) {
      fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(result, null, 2), 'utf-8');
      console.log('[GET /search] Data scraped and saved.');
      return res.json(result);
    } else {
      console.warn('[GET /search] Insufficient pages scraped:', uniquePages.size);
      if (fs.existsSync(PRODUCTS_JSON)) {
        const existing = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf-8'));
        console.log('[GET /search] Loaded fallback data.');
        return res.json(existing);
      } else {
        return res.status(500).json({ error: 'Not enough data scraped and no previous data found.' });
      }
    }
  } catch (e) {
    console.error('[GET /search] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/download', (req, res) => {
  console.log('[GET /download] Download requested.');
  if (fs.existsSync(PRODUCTS_JSON)) {
    res.download(PRODUCTS_JSON, 'noon_products.json');
  } else {
    console.warn('[GET /download] File not found.');
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/', (req, res) => {
  console.log('[GET /] Health check.');
  res.json({ status: 'ok' });
});

// Scrape product details
app.get('/product-details/:product_id', async (req, res) => {
  const { product_id } = req.params;
  const image_url_fallback = req.query.image_url;

  console.log(`[GET /product-details/${product_id}] Requested`);

  try {
    const url = `https://minutes.noon.com/uae-en/now-product/${product_id}/`;
    const $ = await fetchPage(url);

    const name = $('h1').first().text().trim() || null;
    console.log(`[GET /product-details/${product_id}] Name: ${name}`);

    let size = null;
    const infoDiv = $("div[class*='ProductDetails_infoWrapper'] > div").first();
    if (infoDiv.length) size = infoDiv.text().trim();

    let image_url = null;
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && /\/p\/pzsku\//.test(src)) {
        image_url = src;
        return false;
      }
    });
    if (!image_url) image_url = image_url_fallback;

    let desc = null;
    let features = [];

    const mainDescDiv = $('body > div.layout_pageWrapper__W_ZgS > div:nth-child(2) > div:nth-child(4)');
    if (mainDescDiv.length) {
      desc = mainDescDiv.text().trim();
      const ul = mainDescDiv.find('ul');
      if (ul.length) {
        features = ul.find('li').map((i, li) => $(li).text().trim()).get();
      }
    }

    if (!desc || features.length === 0) {
      $("div[style*='margin-top: 20px'][style*='color: rgb(126, 133, 155)']").each((i, div) => {
        const p = $(div).find('p').first();
        if (p.length) desc = p.text().trim();
        else desc = $(div).text().trim();

        const localFeatures = $(div).find('li').map((i, li) => $(li).text().trim()).get();
        if (localFeatures.length) features = localFeatures;

        if (desc) return false;
      });
    }

    if (!desc) {
      $('div').each((i, div) => {
        const t = $(div).text().trim();
        if (t && t.length > 30 && t.toLowerCase().includes('fruit')) {
          desc = t;
          return false;
        }
      });
    }

    if (features.length === 0) {
      const ul = $('ul').first();
      if (ul.length) {
        features = ul.find('li').map((i, li) => $(li).text().trim()).get();
      }
    }

    let price = null, original_price = null;
    const priceCandidates = [];
    $("span").each((i, el) => {
      const txt = $(el).text().trim();
      if (txt && /AED|د.إ|\d/.test(txt)) priceCandidates.push(txt);
    });
    if (priceCandidates.length > 0) price = priceCandidates[0];
    if (priceCandidates.length > 1) original_price = priceCandidates[1];

    let delivery = null;
    $('*').each((i, el) => {
      const txt = $(el).text().trim();
      if (/Arrives in/.test(txt)) {
        delivery = txt;
        return false;
      }
    });

    console.log(`[GET /product-details/${product_id}] Done`);

    res.json({
      product_id,
      name,
      size,
      price,
      original_price,
      delivery,
      description: desc,
      features,
      image_url
    });

  } catch (e) {
    console.error(`[GET /product-details/${product_id}] Error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
