# Scraping Strategy — How We Handle HTML, JavaScript, and APIs

## The Three Site Types

Most retailer websites fall into one of three buckets:

### 1. Static HTML
- Content is in the initial HTML response
- Server-side rendered (PHP, WordPress, classic e-commerce platforms)
- Examples: most independent retailers, Shopify storefronts, Magento

**How we detect it:**
- Visible text > 2000 characters
- < 15 external `<script>` tags
- No SPA framework signatures

**Strategy:** `cheerio` + `undici` HTTP fetch. ~150ms per page.

### 2. Dynamic / JavaScript-Heavy (SPA)
- Initial HTML is mostly empty
- Content loaded via React / Vue / Angular / Next.js after JS executes
- Examples: many modern brand sites, headless commerce frontends

**How we detect it:**
- `<div id="root"></div>` or `<div id="app"></div>` with no children
- Presence of `__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`
- Visible text < 500 chars but many `<script>` tags
- `data-react-helmet`, `ng-version`, `data-v-app` attributes

**Strategy:** `playwright` (Chromium, headless). ~3-5s per page.
We `goto` with `waitUntil: 'domcontentloaded'`, then wait for `networkidle`,
then auto-scroll to trigger lazy loading.

### 3. API-Based / Hybrid
- Page is dynamic, but data lives in well-defined `/api/`, `/graphql`, or
  `/wp-json/` endpoints visible in the network tab
- Often the fastest path: skip rendering, hit the API directly

**How we detect it:**
- Content-Type starts with `application/json`
- Source HTML contains `fetch('/api/...')`, `axios.get('/api/...')`, etc.
- Playwright observes `/api/*` calls during navigation

**Strategy:** Either:
1. Dynamic render once → observe API calls → call them directly on subsequent
   pages (`find_api_endpoints` tool)
2. Direct `undici` fetch with appropriate headers. ~300ms per call.

## The Detector

`src/scrapers/detector.js` runs a single fast HTTP request and decides:

```
                  ┌─────────────────────────────────────────┐
                  │   GET url with undici (5s timeout)      │
                  └─────────────────┬───────────────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
       Content-Type:        text/html               other
       application/json         │                     │
                │               ▼                     ▼
                │       parse with Cheerio        return 'static'
                │               │
                ▼               ▼
            return 'api'   ┌─────────────────────────┐
                           │ Has SPA signatures?     │
                           │ visible text < 500?     │
                           │ scripts > 5?            │
                           └────┬─────────────┬──────┘
                                │ yes         │ no
                                ▼             ▼
                          'dynamic'        'static'
```

The detector is deliberately fast and approximate. If misclassified, the
agent can override with `smart_scrape(url, { renderType: 'dynamic' })`.

## Common Pitfalls and How We Handle Them

### Cookie banners / GDPR walls

Playwright loads with normal user-agent and viewport — most sites don't
require accepting cookies to render content. For sites that hide all content
behind a banner, the agent can pass `waitForSelector` to wait for the
content to appear after dismissal.

### Cloudflare / bot protection

We don't try to bypass it. If a site returns 403/503 with Cloudflare
markers, the page is logged in `data_quality.notes` and the agent uses
third-party sources (Google Business, Wikipedia, business registers).

### Lazy loading / infinite scroll

The dynamic scraper auto-scrolls to the bottom of the page (with a 5s
cap) to trigger most lazy-loaded content. For very long product lists,
the agent should look for the underlying API instead.

### Session persistence

The Playwright browser instance is reused across pages within the same
agent session for performance, but a fresh `BrowserContext` is created
per page to avoid cookie pollution.

### Robots.txt

We respect it by convention. The default user agent is
`Mozilla/5.0 (compatible; RetailerDataBot/1.0; +https://github.com/<your-repo>)`
so site owners can identify and contact you. Set `RESPECT_ROBOTS_TXT=true`
in `.env` (default).

### Rate limiting

`MAX_REQUESTS_PER_DOMAIN_PER_MIN=10` (default) caps per-domain rate even
though most retailers' sites only get 5-15 requests per session anyway.

## Performance Targets

| Site type | Target time per retailer (full extraction) |
|---|---|
| Static HTML | < 5 seconds |
| Dynamic / SPA | 15 - 30 seconds |
| Mixed (most retailers) | 10 - 20 seconds |

For 1000 retailers at concurrency=5, expect 30-60 minutes total.

## Extending the Detector

To add a new framework signature:

```js
// src/scrapers/detector.js
const SPA_FRAMEWORK_SIGNATURES = [
  // ... existing signatures
  /your-new-framework-marker/,
];
```

To add a new strategy (e.g., a paid scraping API as fallback):

1. Create `src/scrapers/your-strategy.js` exporting `scrapeYourStrategy(url, opts)`
2. Add a route in `src/scrapers/index.js`'s `runScraper` switch
3. Update the detector to return your render type when appropriate
