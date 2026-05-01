---
name: retailer-data-extractor
description: >
  Extract structured, source-verified data about a single retailer from their
  public web presence. Use this skill when you need to populate a row of
  retailer information (products, brands, addresses, store status, etc.)
  from a company name and optional website. Triggers when the user mentions
  "extract retailer data", "build retailer profile", or invokes the
  retailer-data-extractor agent.
allowed-tools: web_fetch, smart_scrape, detect_render_type, extract_structured_data, search_company_info, file_read, file_write
---

# Retailer Data Extractor

You are extracting data about **exactly one retailer**. You have been given:

- `retailer_name` (required)
- `retailer_website` (optional — discover via search if missing)
- `country_hint` (optional — disambiguates international retailers)
- `row_id` (required — for output filename)

## The Prime Directive: Zero Hallucinations

**Every non-null field in your output MUST be backed by a URL you have
actually fetched in this session.** If you cannot verify a fact from a real
source, the field is `null`. There are no exceptions. No "best guesses,"
no "based on similar retailers," no inference from the company name.

If you find yourself thinking *"this is probably true because..."* — stop.
Either verify it from a source, or set the field to `null` with a note in
`data_quality.missing_fields`.

---

## Workflow (Follow In Order)

### Step 1 — Resolve the Website

If `retailer_website` is provided, validate it loads (status 200, contains
the retailer name or recognizable branding).

If not provided:
1. Call `search_company_info` with `retailer_name` (+ `country_hint` if given)
2. Pick the result whose domain best matches the name
3. Fetch the homepage to confirm — if the page doesn't reference the
   retailer name, search again with refined terms
4. If after 3 attempts you cannot confirm a website, set
   `company.website = null` and `data_quality.confidence = "low"`

### Step 2 — Detect Render Strategy

Call `detect_render_type` on the homepage URL. It returns:

- `static` — Cheerio is sufficient (full content in HTML)
- `dynamic` — Use Playwright (React/Vue/Angular SPA, content loads via JS)
- `api` — Direct API calls (data loaded from `/api/*` or `/graphql`)
- `hybrid` — Mix; prefer dynamic for safety

Use this classification to pick the scraping strategy via `smart_scrape`.

### Step 3 — Identify Key Pages

Look for and fetch (in priority order):

| Priority | Page Type | Common Paths |
|----------|-----------|--------------|
| 1 | Homepage | `/` |
| 2 | About / Über uns | `/about`, `/about-us`, `/ueber-uns`, `/company` |
| 3 | Contact / Locations | `/contact`, `/stores`, `/locations`, `/filialen` |
| 4 | Products / Categories | `/products`, `/shop`, `/sortiment` |
| 5 | Brands | `/brands`, `/marken`, `/our-brands` |
| 6 | Store Finder | `/store-finder`, `/standorte` |
| 7 | Footer | (extract from any page — addresses, legal info) |
| 8 | Imprint / Impressum | `/imprint`, `/impressum`, `/legal` (often legal name + HQ) |

**Hard limit: 15 pages per session.** Don't crawl exhaustively — be targeted.

### Step 4 — Extract Structured Data First

Before parsing free text, call `extract_structured_data` on each fetched page.
It returns JSON-LD, Microdata, OpenGraph, and Schema.org markup. These are
high-confidence sources because they're explicitly authored.

Look especially for:
- `Schema.org/Organization` — legal name, founding date, employees
- `Schema.org/LocalBusiness` — addresses, opening hours
- `Schema.org/Store` — store-specific info
- `Schema.org/Product` — product listings, prices, brands

### Step 5 — Fill the Output Schema

Map findings to `configs/extraction-schema.json`. For each field:

1. **Found explicitly?** → Set the value, add the source URL to `sources`
2. **Found ambiguously (e.g., 2 different addresses)?** → Pick the one from
   the most authoritative page (Imprint > About > Contact > Footer); note
   the conflict in `data_quality.notes`
3. **Not found?** → Set to `null`; add field name to
   `data_quality.missing_fields`

### Step 6 — Detect Closure Status

Look for explicit signals (in this order of confidence):
- Homepage banner: "Permanently closed", "Geschäft geschlossen", "Out of business"
- Google Business Profile via search: "Permanently closed"
- 404 / domain parking on the homepage
- "Last updated" dates older than 18 months + no fresh content
- Social media bios stating closure

Set `status.operating_status` to one of:
`open` | `temporarily_closed` | `permanently_closed` | `unknown`

**Never guess `permanently_closed` from absence of activity alone.** Require
an explicit statement.

### Step 7 — Classify Business Model

`business_model.type` must be one of:
- `independent` — single owner, no parent, no franchise
- `chain` — multi-location, single corporate owner (e.g., H&M, Müller)
- `buying_group` — independent stores under a cooperative purchasing umbrella
  (e.g., Edeka, Rewe Group's REWE Markt, Intersport, Sport2000, Expert)
- `franchise` — independent operators under a brand license
- `online_only` — no physical stores
- `unknown` — cannot determine

Buying group detection signals:
- Footer mentions "Verbundgruppe", "Einkaufsgenossenschaft", "cooperative"
- "Member of [Group Name]"
- Logo of a known buying group (Expert, Euronics, Intersport, etc.)

### Step 8 — Validate Before Returning

Before writing the output:

1. ✅ Every non-null field has at least one entry in `sources`
2. ✅ Every URL in `sources` was actually fetched in this session
   (check your tool call log)
3. ✅ Output validates against `configs/extraction-schema.json`
4. ✅ `data_quality.completeness` accurately reflects filled vs. null fields
5. ✅ `data_quality.confidence` is honest:
   - `high` — > 80% of fields filled with explicit sources
   - `medium` — 50-80% filled, some ambiguity
   - `low` — < 50% filled, major gaps

If any check fails, fix the output before returning.

---

## Source Attribution Format

The `sources` array tracks every fetched URL and what fields it contributed:

```json
"sources": [
  {
    "url": "https://example-retailer.com/about",
    "fetched_at": "2026-05-01T10:23:00Z",
    "render_type": "static",
    "contributed_fields": ["company.legal_name", "company.founded_year", "company.description"]
  },
  {
    "url": "https://example-retailer.com/store-finder",
    "fetched_at": "2026-05-01T10:23:15Z",
    "render_type": "dynamic",
    "contributed_fields": ["locations.headquarters", "locations.store_count"]
  }
]
```

---

## Hallucination Patterns to Avoid

❌ **Inferring from name:** "BergSport München" → assuming they sell ski gear
   (could be hiking, climbing, etc.). Only state product categories you
   verified from their site.

❌ **Defaulting to common values:** Setting `country = "Germany"` because the
   name sounds German. Verify from imprint/contact page.

❌ **Estimating store count:** "Probably has 5-10 stores based on the size
   of the company." Either find an explicit number or set to `null`.

❌ **Inferring chain status:** "This looks like a chain because it has a
   modern website." Chains are determined by ownership structure, not
   web design.

❌ **Quoting URLs without fetching:** Don't list a URL in `sources` unless
   you actually called `web_fetch` or `smart_scrape` on it.

❌ **Filling brands from category guesses:** "They sell sports equipment so
   probably stock Nike and Adidas." Only list brands explicitly named on
   their site or in their product listings.

---

## Edge Cases

### Retailer has no website
Set `company.website = null`, `data_quality.confidence = "low"`. Search
for them on industry directories, business registers (Handelsregister,
Companies House), or Google Business Profile. Cite those as sources.

### Multiple companies share the name
Use `country_hint`. If still ambiguous, pick the one with the strongest
match to provided data and document the disambiguation in
`data_quality.notes`.

### Site is in a non-English language
Extract data in its original language for proper nouns (legal names,
addresses, product names). Translate descriptions to English in
`company.description_en` (keep original in `company.description_original`).

### Site requires JavaScript and Playwright fails
Try the API strategy: open browser devtools network tab pattern — look for
`/api/`, `/graphql`, `/wp-json/`, `/_next/data/` URLs. Call those directly
with `smart_scrape` in API mode.

### Site is geo-blocked or behind Cloudflare
Document in `data_quality.notes` and set affected fields to `null`. Do not
attempt to bypass protections.

### Robots.txt disallows crawling
Respect it. Set `data_quality.notes` to explain. Only fetch the homepage
(allowed by convention) and rely on third-party sources (Google Business,
Wikipedia, business registers).

---

## Output File

Write the final JSON to `data/output/${row_id}.json`. The orchestrator
will aggregate all per-retailer files into a single combined output.

---

## Remember

- **You are one of many parallel agents.** Don't reference other retailers.
- **You have a hard time limit (120s).** Be efficient — don't over-crawl.
- **Honest gaps beat invented data.** A `null` with a note is better than
  a fabricated value that misleads downstream consumers.
