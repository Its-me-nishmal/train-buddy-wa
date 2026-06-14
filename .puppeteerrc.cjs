const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to reside within the project directory.
  // This ensures the downloaded browser is packaged and uploaded to the runtime container.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
