import { request } from 'undici';
import * as cheerio from 'cheerio';

const DETECTION_TIMEOUT = 8000;

const SPA_FRAMEWORK_SIGNATURES = [
  /__NEXT_DATA__/,
  /__NUXT__/,
  /window\.__INITIAL_STATE__/,
  /id="__nuxt"/,
  /id="root"[^>]*>\s*<\/div>/,
  /id="app"[^>]*>\s*<\/div>/,
  /data-react-helmet/,
  /\bng-version=/,
  /data-v-app/,
  /<script[^>]+src="[^"]*\/_next\//,
  /<script[^>]+src="[^"]*\/static\/js\/main\.[a-f0-9]+\.js/,
];

const API_HEAVY_SIGNATURES = [
  /fetch\(['"]\/api\//,
  /axios\.(get|post)\(['"]\/api\//,
  /\/graphql/,
  /\/wp-json\//,
];

export async function detectRenderType(url) {
  let response;
  try {
    response = await request(url, {
      method: 'GET',
      headers: {
        'user-agent': process.env.USER_AGENT || 'Mozilla/5.0 (compatible; RetailerDataBot/1.0)',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,de;q=0.8',
      },
      headersTimeout: DETECTION_TIMEOUT,
      bodyTimeout: DETECTION_TIMEOUT,
      maxRedirections: 5,
    });
  } catch (err) {
    return 'dynamic';
  }

  const contentType = response.headers['content-type'] || '';

  if (contentType.includes('application/json')) {
    return 'api';
  }

  if (!contentType.includes('text/html')) {
    return 'static';
  }

  const html = await response.body.text();

  if (!html || html.length < 200) {
    return 'dynamic';
  }

  const $ = cheerio.load(html);

  const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
  const visibleTextLength = visibleText.length;

  const scriptTags = $('script').length;
  const externalScripts = $('script[src]').length;

  const isSpa = SPA_FRAMEWORK_SIGNATURES.some((sig) => sig.test(html));
  const isApiHeavy = API_HEAVY_SIGNATURES.some((sig) => sig.test(html));

  if (visibleTextLength < 500 && scriptTags > 5) {
    return isApiHeavy ? 'hybrid' : 'dynamic';
  }

  if (isSpa) {
    if (visibleTextLength > 2000) return 'hybrid';
    return 'dynamic';
  }

  if (visibleTextLength > 2000 && externalScripts < 15) {
    return 'static';
  }

  if (visibleTextLength > 1000) {
    return 'static';
  }

  return 'dynamic';
}

export async function findApiEndpoints(url) {
  try {
    const response = await request(url, {
      headers: { 'user-agent': process.env.USER_AGENT || 'Mozilla/5.0 (compatible; RetailerDataBot/1.0)' },
      headersTimeout: DETECTION_TIMEOUT,
      bodyTimeout: DETECTION_TIMEOUT,
    });
    const html = await response.body.text();
    const apiPaths = new Set();

    const patterns = [
      /["'`](\/api\/[^"'`\s?]+)/g,
      /["'`](\/wp-json\/[^"'`\s?]+)/g,
      /["'`](\/graphql)["'`]/g,
      /["'`](\/_next\/data\/[^"'`\s]+)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        apiPaths.add(match[1]);
      }
    }

    return [...apiPaths];
  } catch {
    return [];
  }
}
