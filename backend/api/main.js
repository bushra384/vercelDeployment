const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const serverless = require('serverless-http');

const app = express();
app.use(cors());

// Path to the JSON file
const PRODUCTS_JSON = path.join(__dirname, 'noon_products.json');

// Scrape search results
async function scrapeNoonProducts(searchTerm) {
  try {
    const url = `https://minutes.noon.com/uae-en/search?q=${encodeURIComponent(searchTerm)}`;
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    const scriptContent = $('script#__NEXT_DATA__').html();
    const json = JSON.parse(scriptContent);

    const products = json.props.pageProps.initialState.search.products || [];
    return products.map((product) => ({
      id: product.sku,
      name: product.name,
      image_url: product.image_key ? `https://f.nooncdn.com/p/v168/${product.image_key}.jpg` : null,
      price: product.price ? product.price.value : null,
      rating: product.rating ? product.rating.value : null,
    }));
  } catch (error) {
    console.error('Error scraping Noon:', error);
    return [];
  }
}

// Scrape product details
async function fetchPage(url) {
  const { data: html } = await axios.get(url);
  return cheerio.load(html);
}

// Route: Search
app.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  const products = await scrapeNoonProducts(query);
  fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(products, null, 2));

  res.json(products);
});

// Route: Product details
app.get('/product-details/:product_id', async (req, res) => {
  const { product_id } = req.params;
  const image_url_fallback = req.query.image_url;

  try {
    const url = `https://minutes.noon.com/uae-en/now-product/${product_id}/`;
    const $ = await fetchPage(url);

    const name = $('h1').first().text().trim() || null;

    const description = $('div.layout_row__o3pQb p').first().text().trim() || null;

    const features = [];
    $('div.layout_row__o3pQb ul li').each((i, el) => {
      features.push($(el).text().trim());
    });

    const image = $('img.Image_image__RxFD0').first().attr('src') || image_url_fallback;

    res.json({ name, description, features, image });
  } catch (error) {
    console.error('Error fetching product details:', error);
    res.status(500).json({ error: 'Failed to fetch product details' });
  }
});

// Route: Download
app.get('/download', (req, res) => {
  if (fs.existsSync(PRODUCTS_JSON)) {
    res.download(PRODUCTS_JSON, 'noon_products.json');
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Export for Vercel (no app.listen!)
module.exports = app;
module.exports.handler = serverless(app);
