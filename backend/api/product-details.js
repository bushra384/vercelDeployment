const axios = require('axios');
const cheerio = require('cheerio');

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return cheerio.load(data);
}

module.exports = async (req, res) => {
  const { product_id, image_url: image_url_fallback } = req.query;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  try {
    const url = `https://minutes.noon.com/uae-en/now-product/${product_id}/`;
    const $ = await fetchPage(url);

    const name = $('h1').first().text().trim();
    let size = $("div[class*='ProductDetails_infoWrapper'] > div").first().text().trim() || null;

    let image_url = null;
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && /\/p\/pzsku\//.test(src)) {
        image_url = src;
        return false;
      }
    });
    if (!image_url) image_url = image_url_fallback;

    let desc = null, features = [];
    const mainDiv = $('body > div.layout_pageWrapper__W_ZgS > div:nth-child(2) > div:nth-child(4)');
    if (mainDiv.length) {
      desc = mainDiv.text().trim();
      features = mainDiv.find('li').map((_, li) => $(li).text().trim()).get();
    }

    if (!desc) {
      $("div[style*='margin-top: 20px']").each((_, div) => {
        const p = $(div).find('p').first();
        desc = p.length ? p.text().trim() : $(div).text().trim();
        features = $(div).find('li').map((_, li) => $(li).text().trim()).get();
        if (desc) return false;
      });
    }

    let price = null, original_price = null;
    const priceTexts = [];
    $("span").each((_, el) => {
      const text = $(el).text().trim();
      if (/AED|د.إ|\d/.test(text)) priceTexts.push(text);
    });
    price = priceTexts[0];
    original_price = priceTexts[1];

    let delivery = null;
    $('*').each((_, el) => {
      const text = $(el).text().trim();
      if (/Arrives in/.test(text)) {
        delivery = text;
        return false;
      }
    });

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
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
