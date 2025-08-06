// Simple HTTP-based scraper for Noon Minutes products
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PRODUCTS_JSON = path.join(__dirname, '../noon_products.json');

// HTTP client with retry logic and proper headers
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Fetching ${url} (attempt ${i + 1})`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0'
        },
        timeout: 30000,
        maxRedirects: 5
      });
      return response.data;
    } catch (error) {
      console.log(`Attempt ${i + 1} failed: ${error.message}`);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

// Extract products from HTML using regex patterns
function extractProducts(html) {
  const products = [];
  const seenIds = new Set();
  
  // Pattern to find product cards
  const cardPattern = /<a[^>]*href="\/uae-en\/now-product\/([^"]+)\/"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  
  while ((match = cardPattern.exec(html)) !== null) {
    const productId = match[1];
    const cardHtml = match[2];
    
    if (seenIds.has(productId)) continue;
    seenIds.add(productId);
    
    // Extract text content (remove HTML tags)
    const textContent = cardHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = textContent.split(' ').filter(line => line.trim().length > 0);
    
    // Filter out promotional text
    const filtered = lines.filter(item => {
      const upper = item.toUpperCase();
      if (["ADD", "OFF", "ON", "SALE", "NEW", "HOT", "BUY", "NOW"].includes(upper)) return false;
      if (/%/.test(item)) return false;
      if (/^AED/.test(item)) return false;
      if (/^\d{1,2}$/.test(item)) return false;
      if (/^[A-Za-z]{1,2}$/.test(item)) return false;
      return true;
    });
    
    if (filtered.length < 3) continue;
    
    // Extract image URL
    const imgMatch = cardHtml.match(/src="([^"]*f\.nooncdn\.com[^"]*)"/);
    const imageUrl = imgMatch ? imgMatch[1] : '';
    
    // Extract prices
    const priceMatches = filtered.filter(item => /AED|\d+[.,]?\d*/.test(item));
    const price = priceMatches[0] || '';
    const originalPrice = priceMatches[1] || '';
    
    products.push({
      product_id: productId,
      origin: filtered[0] || '',
      name: filtered[1] || '',
      size: filtered[2] || '',
      price: price.replace('AED', '').trim(),
      original_price: originalPrice.replace('AED', '').trim(),
      image_url: imageUrl,
      page: 1 // Will be updated later
    });
  }
  
  return products;
}

// Main scraping function
async function scrapeNoonProducts() {
  console.log('Starting simple HTTP scraper...');
  
  const allProducts = [];
  let page = 1;
  const maxPages = 5;
  
  try {
    while (page <= maxPages) {
      console.log(`Scraping page ${page}...`);
      
      const url = page === 1 
        ? 'https://minutes.noon.com/uae-en/search/?f[category]=fruits_vegetables'
        : `https://minutes.noon.com/uae-en/search/?f[category]=fruits_vegetables&page=${page}`;
      
      const html = await fetchWithRetry(url);
      const pageProducts = extractProducts(html);
      
      if (pageProducts.length === 0) {
        console.log('No products found on this page, stopping');
        break;
      }
      
      // Add page number to products
      pageProducts.forEach(product => {
        product.page = page;
      });
      
      allProducts.push(...pageProducts);
      console.log(`Found ${pageProducts.length} products on page ${page}`);
      
      // Check if there's a next page
      if (html.includes('aria-label="Next page"') && !html.includes('aria-disabled="true"')) {
        page++;
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log('No next page found');
        break;
      }
    }
    
    console.log(`Simple scraping completed. Total products: ${allProducts.length}`);
    return allProducts;
    
  } catch (error) {
    console.error(`Simple scraper failed: ${error.message}`);
    throw error;
  }
}

// Product details scraper
async function scrapeProductDetails(productId) {
  try {
    const url = `https://minutes.noon.com/uae-en/now-product/${productId}/`;
    const html = await fetchWithRetry(url);
    
    // Extract name
    const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const name = nameMatch ? nameMatch[1].trim() : null;
    
    // Extract image
    const imgMatch = html.match(/src="([^"]*\/p\/pzsku\/[^"]*)"/);
    const imageUrl = imgMatch ? imgMatch[1] : null;
    
    // Extract price
    const priceMatch = html.match(/(AED\s*\d+[.,]?\d*)/);
    const price = priceMatch ? priceMatch[1] : null;
    
    // Extract description (simple approach)
    const descMatch = html.match(/<p[^>]*>([^<]{50,})<\/p>/);
    const description = descMatch ? descMatch[1].trim() : null;
    
    // Extract size
    const sizeMatch = html.match(/<div[^>]*>([^<]{5,50})<\/div>/g);
    let size = null;
    if (sizeMatch) {
      for (const match of sizeMatch) {
        const text = match.replace(/<[^>]*>/g, '').trim();
        if (text && text.length > 0 && text.length < 50 && /kg|g|ml|l|pack|piece/i.test(text)) {
          size = text;
          break;
        }
      }
    }
    
    return {
      product_id: productId,
      name,
      size,
      price,
      description,
      image_url: imageUrl
    };
    
  } catch (error) {
    console.error(`Product details scraper failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  scrapeNoonProducts,
  scrapeProductDetails
}; 