const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const PRODUCTS_JSON = path.join(__dirname, '../noon_products.json');

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return cheerio.load(data);
}

async function scrapeNoonProducts() {
  let allProducts = [];
  let page = 1;
  let nextPageUrl = 'https://minutes.noon.com/uae-en/search/?f[category]=fruits_vegetables';
  const seen = new Set();

  while (nextPageUrl) {
    const $ = await fetchPage(nextPageUrl);
    const productCards = $("div.catalogList_instantCatalogList__gUTOP a");
    if (!productCards.length) break;

    productCards.each((i, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/now-product\/([^/]+)\//);
      const product_id = match ? match[1] : null;
      if (!product_id || seen.has(product_id)) return;
      seen.add(product_id);

      const data = $(el).text().split('\n').map(t => t.trim()).filter(Boolean);
      const filtered = data.filter(item => {
        return !["ADD", "OFF", "ON", "SALE", "NEW", "HOT"].includes(item.toUpperCase()) &&
               !/%/.test(item) && !/^AED/.test(item) &&
               !/^\d{1,2}$/.test(item) && !/^[A-Za-z]{1,2}$/.test(item);
      });

      if (filtered.length < 3) return;

      const img = $(el).find('img').attr('src') || '';
      const image_url = img.includes('f.nooncdn.com/') ? img : '';

      const prices = filtered.filter(d => /AED|\d+/.test(d)).map(d => d.replace('AED', '').trim());
      const price = prices[0] || '';
      const original_price = prices[1] || '';

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
    });

    const nextBtn = $("a[aria-label='Next page'][rel='next'][aria-disabled='false']");
    const nextHref = nextBtn.attr('href');
    if (nextHref) {
      nextPageUrl = new URL(nextHref, nextPageUrl).href;
      page++;
    } else {
      break;
    }
  }

  return allProducts;
}

module.exports = async (req, res) => {
  try {
    const result = await scrapeNoonProducts();
    const pages = new Set(result.map(p => p.page));
    if (pages.size >= 5) {
      fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(result, null, 2));
      res.json(result);
    } else if (fs.existsSync(PRODUCTS_JSON)) {
      res.json(JSON.parse(fs.readFileSync(PRODUCTS_JSON)));
    } else {
      res.status(500).json({ error: 'Not enough data scraped and no backup available.' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
