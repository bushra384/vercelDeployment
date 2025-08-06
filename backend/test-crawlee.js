// Test script to verify Crawlee setup
const { PuppeteerCrawler, log } = require('crawlee');

async function testCrawlee() {
  console.log('Testing Crawlee setup...');
  
  const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--mute-audio',
          '--no-default-browser-check',
          '--safebrowsing-disable-auto-update',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      }
    },
    
    async requestHandler({ request, page }) {
      console.log(`Testing page: ${request.url}`);
      
      try {
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Wait for page to load
        await page.waitForSelector('body', { timeout: 10000 });
        
        // Get page title
        const title = await page.title();
        console.log(`Page title: ${title}`);
        
        // Check if we can find any elements
        const bodyText = await page.$eval('body', el => el.textContent.substring(0, 200));
        console.log(`Body text preview: ${bodyText}...`);
        
        console.log('✅ Crawlee test successful!');
        
      } catch (error) {
        console.error(`❌ Crawlee test failed: ${error.message}`);
        throw error;
      }
    },
    
    failedRequestHandler({ request, error }) {
      console.error(`❌ Request failed: ${request.url} - ${error.message}`);
    }
  });
  
  try {
    await crawler.run(['https://httpbin.org/html']);
    console.log('🎉 All tests passed!');
  } catch (error) {
    console.error('💥 Test failed:', error.message);
  }
}

// Run the test
testCrawlee(); 