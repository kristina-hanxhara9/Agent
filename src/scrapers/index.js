import { detectRenderType } from './detector.js';
import { scrapeStatic } from './static-scraper.js';
import { scrapeDynamic } from './dynamic-scraper.js';
import { scrapeApi } from './api-scraper.js';
import { logger } from '../utils/logger.js';

const SCRAPER_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS) || 30000;

export async function smartScrape(url, options = {}) {
  const start = Date.now();
  const renderType = options.renderType ?? await detectRenderType(url);

  logger.info('scrape.start', { url, renderType });

  const result = await withTimeout(runScraper(url, renderType, options), SCRAPER_TIMEOUT_MS, url);

  logger.info('scrape.done', {
    url,
    renderType,
    status: result.status,
    contentLength: result.html?.length ?? 0,
    durationMs: Date.now() - start,
  });

  return {
    url,
    renderType,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    ...result,
  };
}

async function runScraper(url, renderType, options) {
  switch (renderType) {
    case 'static':
      return scrapeStatic(url, options);
    case 'dynamic':
    case 'hybrid':
      return scrapeDynamic(url, options);
    case 'api':
      return scrapeApi(url, options);
    default:
      throw new Error(`Unknown render type: ${renderType}`);
  }
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Scrape timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export { detectRenderType };
