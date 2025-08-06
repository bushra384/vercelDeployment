// Test script for simple HTTP scraper
const { scrapeNoonProducts, scrapeProductDetails } = require('./api/simple-scraper');

async function testSimpleScraper() {
  console.log('Testing simple HTTP scraper...');
  
  try {
    // Test product list scraping
    console.log('Testing product list scraping...');
    const products = await scrapeNoonProducts();
    console.log(`✅ Found ${products.length} products`);
    
    if (products.length > 0) {
      // Test product details scraping
      console.log('Testing product details scraping...');
      const firstProduct = products[0];
      const details = await scrapeProductDetails(firstProduct.product_id);
      console.log(`✅ Product details: ${details.name}`);
    }
    
    console.log('🎉 All tests passed!');
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
  }
}

// Run the test
testSimpleScraper(); 