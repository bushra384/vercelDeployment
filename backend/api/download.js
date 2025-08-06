const fs = require('fs');
const path = require('path');
const PRODUCTS_JSON = path.join(__dirname, '../noon_products.json');

module.exports = (req, res) => {
  if (fs.existsSync(PRODUCTS_JSON)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=noon_products.json');
    res.send(fs.readFileSync(PRODUCTS_JSON));
  } else {
    res.status(404).json({ error: 'File not found' });
  }
};
