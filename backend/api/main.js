// Express backend using simple HTTP requests to scrape Noon Minutes products
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { scrapeNoonProducts, scrapeProductDetails } = require('./simple-scraper');

const app = express();
app.use(cors());

const PRODUCTS_JSON = path.join(__dirname, '../noon_products.json');

// API Routes
app.get('/search', async (req, res) => {
  try {
    console.log('Starting scraping process...');
    const result = await scrapeNoonProducts();
    
    const uniquePages = new Set(result.map(p => p.page));
    console.log(`Scraped ${result.length} products from ${uniquePages.size} pages`);
    
    if (uniquePages.size >= 1) { // Lowered threshold for testing
      fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(result, null, 2), 'utf-8');
      console.log('Data saved to file');
      return res.json({
        success: true,
        count: result.length,
        pages: uniquePages.size,
        method: 'simple-http',
        data: result
      });
    } else {
      if (fs.existsSync(PRODUCTS_JSON)) {
        const existing = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf-8'));
        console.log('Using cached data');
        return res.json({
          success: true,
          count: existing.length,
          cached: true,
          method: 'cached',
          data: existing
        });
      } else {
        return res.status(500).json({ 
          error: 'Not enough data scraped and no previous data found.',
          scraped: result.length,
          pages: uniquePages.size,
          method: 'simple-http'
        });
      }
    }
  } catch (e) {
    console.error(`Search endpoint error: ${e.message}`);
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

// Scrape product details
app.get('/product-details/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    console.log(`Scraping product details for: ${product_id}`);
    const result = await scrapeProductDetails(product_id);
    
    res.json({
      ...result,
      method: 'simple-http'
    });
    
  } catch (e) {
    console.error(`Product details error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Noon Minutes Scraper API (Simple HTTP Version)',
    endpoints: ['/search', '/product-details/:id', '/download']
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Simple HTTP scraper ready for Noon Minutes products`);
});
