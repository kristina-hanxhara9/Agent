import { request } from 'undici';

export async function scrapeApi(url, options = {}) {
  const headers = {
    'user-agent': options.userAgent || process.env.USER_AGENT || 'Mozilla/5.0 (compatible; RetailerDataBot/1.0)',
    'accept': 'application/json, text/plain, */*',
    'accept-language': options.acceptLanguage || 'en-US,en;q=0.9,de;q=0.8',
    ...(options.headers || {}),
  };

  const response = await request(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    headersTimeout: options.timeout || 15000,
    bodyTimeout: options.timeout || 15000,
    maxRedirections: 5,
  });

  const contentType = response.headers['content-type'] || '';
  const rawBody = await response.body.text();

  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = null;
    }
  }

  return {
    status: response.statusCode,
    finalUrl: url,
    contentType,
    text: rawBody,
    data,
    method: 'undici-api',
  };
}
