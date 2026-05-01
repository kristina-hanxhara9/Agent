import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { extractStructuredData } from './structured-data.js';
import { logger } from '../utils/logger.js';

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function scrapeDynamic(url, options = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: options.userAgent || process.env.USER_AGENT || 'Mozilla/5.0 (compatible; RetailerDataBot/1.0)',
    viewport: {
      width: Number(process.env.PLAYWRIGHT_VIEWPORT_WIDTH) || 1920,
      height: Number(process.env.PLAYWRIGHT_VIEWPORT_HEIGHT) || 1080,
    },
    locale: options.locale || 'en-US',
    extraHTTPHeaders: {
      'accept-language': options.acceptLanguage || 'en-US,en;q=0.9,de;q=0.8',
    },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  const apiCalls = [];
  page.on('response', (response) => {
    const respUrl = response.url();
    if (
      respUrl.includes('/api/') ||
      respUrl.includes('/graphql') ||
      respUrl.includes('/wp-json/') ||
      respUrl.includes('/_next/data/')
    ) {
      apiCalls.push({
        url: respUrl,
        status: response.status(),
        method: response.request().method(),
      });
    }
  });

  try {
    const navigationTimeout = options.timeout || 25000;
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeout,
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      logger.debug('scrape.dynamic.networkidle_timeout', { url });
    }

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {});
    }

    await autoScroll(page);

    const html = await page.content();
    const finalUrl = page.url();
    const status = response?.status() || 200;

    const $ = cheerio.load(html);
    $('script, style, noscript, iframe').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    return {
      status,
      finalUrl,
      contentType: 'text/html',
      html,
      text,
      title: $('title').first().text().trim() || null,
      metaDescription: $('meta[name="description"]').attr('content') || null,
      structuredData: extractStructuredData(html),
      links: collectLinks($, finalUrl),
      apiCallsObserved: apiCalls,
      method: 'playwright',
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function autoScroll(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(timer);
          resolve();
        }, 5000);
      });
    });
  } catch {
    // ignore scroll errors
  }
}

function collectLinks($, baseUrl) {
  const links = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absolute = new URL(href, base).href;
      if (absolute.startsWith('http')) {
        links.add(absolute.split('#')[0]);
      }
    } catch {
      // ignore
    }
  });

  return [...links].slice(0, 100);
}
