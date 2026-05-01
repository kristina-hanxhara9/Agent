import { request } from 'undici';
import * as cheerio from 'cheerio';
import { extractStructuredData } from './structured-data.js';

export async function scrapeStatic(url, options = {}) {
  const response = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': options.userAgent || process.env.USER_AGENT || 'Mozilla/5.0 (compatible; RetailerDataBot/1.0)',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': options.acceptLanguage || 'en-US,en;q=0.9,de;q=0.8',
    },
    headersTimeout: options.timeout || 15000,
    bodyTimeout: options.timeout || 15000,
    maxRedirections: 5,
  });

  const html = await response.body.text();
  const $ = cheerio.load(html);

  $('script, style, noscript, iframe').remove();

  const text = $('body').text().replace(/\s+/g, ' ').trim();

  return {
    status: response.statusCode,
    finalUrl: url,
    contentType: response.headers['content-type'] || 'text/html',
    html,
    text,
    title: $('title').first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
    structuredData: extractStructuredData(html),
    links: collectLinks($, url),
    method: 'cheerio',
  };
}

function collectLinks($, baseUrl) {
  const links = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absolute = new URL(href, base).href;
      if (absolute.startsWith('http')) {
        links.add(absolute.split('#')[0]);
      }
    } catch {
      // ignore malformed URLs
    }
  });

  return [...links].slice(0, 100);
}
