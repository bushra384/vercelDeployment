// Express backend using Cheerio to scrape Noon Minutes products
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { chromium } = require('@playwright/test');

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
    let browser;
    try {
      // Try launching with system Chrome if available, else default
      let launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };
      // Try to use system Chrome if on Windows
      const chromePaths = [
        'D:/The Hedge Collective/NoonMintues/chrome.exe',
        'D:/The Hedge Collective/NoonMintues/chrome.exe'
      ];
      const fs = require('fs');
      for (const chromePath of chromePaths) {
        if (fs.existsSync(chromePath)) {
          launchOptions.executablePath = chromePath;
          break;
        }
      }
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();

      // Rotate user agent
      const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      await page.setUserAgent(userAgent);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const html = await page.content();

      await browser.close();
      return html; // Return HTML string
    } catch (err) {
      if (browser) await browser.close();
      console.error(`fetchPage error (attempt ${attempt}):`, err.code || err.message);
      if (attempt === retries) throw new Error(`Failed to fetch ${url}: ${err.code || err.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Scrape all fruits and vegetables products
async function scrapeNoonProducts() {
  let allProducts = [];
  let pageNum = 1;
  let nextPageUrl = 'https://minutes.noon.com/uae-en/search/?f[category]=fruits_vegetables';
  const seenProductIds = new Set();
  const maxPages = isVercel ? 1 : 2;

  // Playwright browser setup
  let browser;
  try {
    let launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote'
      ]
    };
    browser = await chromium.launch(launchOptions);
    while (nextPageUrl && pageNum <= maxPages) {
      console.log(`Scraping page ${pageNum}`);
      const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const context = await browser.newContext({ userAgent });
      const page = await context.newPage();
      await page.goto(nextPageUrl, { waitUntil: 'networkidle' });

      // Extract product data from the page
      const { products, nextHref } = await page.evaluate(() => {
        const productCards = Array.from(document.querySelectorAll('div.catalogList_instantCatalogList__gUTOP a'));
        const products = [];
        const seenProductIds = new Set();
        for (const card of productCards) {
          // Extract product ID from href
          const href = card.getAttribute('href') || '';
          let product_id = null;
          const match = href.match(/\/now-product\/([^/]+)\//);
          if (match) product_id = match[1];
          if (!product_id || seenProductIds.has(product_id)) continue;
          seenProductIds.add(product_id);

          // Extract text data
          const data = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
          // Filter promotional/non-product elements
          const filtered = data.filter(item => {
            if (["ADD", "OFF", "ON", "SALE", "NEW", "HOT"].includes(item.toUpperCase())) return false;
            if (/%/.test(item)) return false;
            if (/^AED/.test(item)) return false;
            if (/^\d{1,2}$/.test(item)) return false;
            if (/^[A-Za-z]{1,2}$/.test(item)) return false;
            return true;
          });
          if (filtered.length < 3) continue;

          // Image
          let image_url = '';
          const img = card.querySelector('img');
          if (img) {
            const src = img.getAttribute('src');
            if (src && src.includes('f.nooncdn.com/')) image_url = src;
          }

          // Price
          let price = '', original_price = '';
          const prices = filtered.filter(d => /AED|\d+[.,]?\d*/.test(d)).map(d => d.replace('AED', '').trim());
          if (prices.length === 1) price = prices[0];
          if (prices.length >= 2) { price = prices[0]; original_price = prices[1]; }

          products.push({
            product_id,
            origin: filtered[0] || '',
            name: filtered[1] || '',
            size: filtered[2] || '',
            price,
            original_price,
            image_url
          });
        }
        // Find next page link
        let nextHref = null;
        const nextBtn = document.querySelector("a[role='button'][aria-label='Next page'][rel='next'][aria-disabled='false']");
        if (nextBtn) {
          nextHref = nextBtn.getAttribute('href');
        }
        return { products, nextHref };
      });

      // Add page number and filter duplicates
      for (const prod of products) {
        if (!seenProductIds.has(prod.product_id)) {
          seenProductIds.add(prod.product_id);
          allProducts.push({ ...prod, page: pageNum });
        }
      }

      // Prepare for next page
      if (products.length && nextHref) {
        nextPageUrl = new URL(nextHref, nextPageUrl).href;
        pageNum++;
        if (!isVercel) {
          await new Promise(r => setTimeout(r, 2000)); // Only delay locally
        }
      } else {
        break;
      }
    }
    await browser.close();
    return allProducts;
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
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

  let browser;
  try {
    // Puppeteer launch options (reuse logic from above)
    let launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote'
      ]
    };
    const chromePaths = [
      'D:/The Hedge Collective/NoonMintues/chrome.exe',
      'D:/The Hedge Collective/NoonMintues/chrome.exe'
    ];
    const fs = require('fs');
    for (const chromePath of chromePaths) {
      if (fs.existsSync(chromePath)) {
        launchOptions.executablePath = chromePath;
        break;
      }
    }
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    // Rotate user agent
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await page.setUserAgent(userAgent);

    const url = `https://minutes.noon.com/uae-en/now-product/${product_id}/`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extract product details from the page
    const details = await page.evaluate((image_url_fallback) => {
      // Product name
      const nameEl = document.querySelector('h1');
      const name = nameEl && typeof nameEl.innerText === 'string' ? nameEl.innerText.trim() : null;

      // Size
      let size = null;
      const infoDiv = document.querySelector("div[class*='ProductDetails_infoWrapper'] > div");
      if (infoDiv && typeof infoDiv.innerText === 'string') size = infoDiv.innerText.trim();

      // Image
      let image_url = null;
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const img of imgs) {
        const src = img.getAttribute('src');
        if (src && /\/p\/pzsku\//.test(src)) {
          image_url = src;
          break;
        }
      }
      if (!image_url) image_url = image_url_fallback;

      // Description and features
      let desc = null;
      let features = [];

      // 1. Try with original selector (Horilla-like structure)
      const mainDescDiv = document.querySelector('body > div.layout_pageWrapper__W_ZgS > div:nth-child(2) > div:nth-child(4)');
      if (mainDescDiv && typeof mainDescDiv.innerText === 'string') {
        desc = mainDescDiv.innerText.trim();
        const ul = mainDescDiv.querySelector('ul');
        if (ul) {
          features = Array.from(ul.querySelectorAll('li'))
            .map(li => li.innerText ? li.innerText.trim() : '')
            .filter(Boolean);
        }
      }

      // 2. Fallback to older style (description and features in styled div)
      if (!desc || features.length === 0) {
        const descDivs = Array.from(document.querySelectorAll("div[style*='margin-top: 20px'][style*='color: rgb(126, 133, 155)']"));
        for (const div of descDivs) {
          let localDesc = null;
          const p = div.querySelector('p');
          if (p && typeof p.innerText === 'string') localDesc = p.innerText.trim();
          else if (typeof div.innerText === 'string') localDesc = div.innerText.trim();
          if (localDesc && !desc) desc = localDesc;
          // Append any <li> inside this block
          const localFeatures = Array.from(div.querySelectorAll('li'))
            .map(li => li.innerText ? li.innerText.trim() : '')
            .filter(Boolean);
          if (localFeatures.length) features = localFeatures;
          if (desc) break;
        }
      }

      // 3. Last resort: heuristic description
      if (!desc) {
        const divs = Array.from(document.querySelectorAll('div'));
        for (const div of divs) {
          if (typeof div.innerText === 'string') {
            const t = div.innerText.trim();
            if (t && t.length > 30 && t.toLowerCase().includes('fruit')) {
              desc = t;
              break;
            }
          }
        }
      }

      // 4. Final fallback for features: find first <ul> in body
      if (features.length === 0) {
        const ul = document.querySelector('ul');
        if (ul) {
          features = Array.from(ul.querySelectorAll('li'))
            .map(li => li.innerText ? li.innerText.trim() : '')
            .filter(Boolean);
        }
      }

      // Price logic
      let price = null, original_price = null;
      const priceCandidates = [];
      const spans = Array.from(document.querySelectorAll('span'));
      for (const el of spans) {
        if (typeof el.innerText === 'string') {
          const txt = el.innerText.trim();
          if (txt && (/AED|د.إ|\d/.test(txt))) priceCandidates.push(txt);
        }
      }
      if (priceCandidates.length > 0) price = priceCandidates[0];
      if (priceCandidates.length > 1) original_price = priceCandidates[1];

      // Delivery text
      let delivery = null;
      const allEls = Array.from(document.querySelectorAll('*'));
      for (const el of allEls) {
        if (typeof el.innerText === 'string') {
          const txt = el.innerText.trim();
          if (/Arrives in/.test(txt)) {
            delivery = null;
            break;
          }
        }
      }

      return {
        name,
        size,
        price,
        original_price,
        delivery,
        description: desc,
        features,
        image_url
      };
    }, image_url_fallback);

    const elapsed = Date.now() - start;
    await browser.close();
    res.json({
      product_id,
      ...details,
      elapsed_ms: elapsed
    });
  } catch (e) {
    if (browser) await browser.close();
    res.status(500).json({ error: e.message });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
