import * as cheerio from 'cheerio';

export function extractStructuredData(html) {
  const $ = cheerio.load(html);

  return {
    jsonLd: extractJsonLd($),
    openGraph: extractOpenGraph($),
    microdata: extractMicrodata($),
    meta: extractMeta($),
  };
}

function extractJsonLd($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        items.push(...parsed);
      } else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
        items.push(...parsed['@graph']);
      } else {
        items.push(parsed);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  });
  return items;
}

function extractOpenGraph($) {
  const og = {};
  $('meta[property^="og:"]').each((_, el) => {
    const property = $(el).attr('property');
    const content = $(el).attr('content');
    if (property && content) {
      og[property.replace('og:', '')] = content;
    }
  });
  return og;
}

function extractMicrodata($) {
  const items = [];
  $('[itemscope]').each((_, el) => {
    const $el = $(el);
    const itemType = $el.attr('itemtype');
    const properties = {};
    $el.find('[itemprop]').each((_, propEl) => {
      const $prop = $(propEl);
      const name = $prop.attr('itemprop');
      const value = $prop.attr('content') || $prop.attr('href') || $prop.text().trim();
      if (name && value) {
        properties[name] = value;
      }
    });
    if (itemType && Object.keys(properties).length > 0) {
      items.push({ itemType, properties });
    }
  });
  return items;
}

function extractMeta($) {
  return {
    description: $('meta[name="description"]').attr('content') || null,
    keywords: $('meta[name="keywords"]').attr('content') || null,
    author: $('meta[name="author"]').attr('content') || null,
    robots: $('meta[name="robots"]').attr('content') || null,
    language: $('html').attr('lang') || null,
  };
}
