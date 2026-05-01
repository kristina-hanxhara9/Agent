// Per-retailer agent runner.
//
// Each retailer is processed in isolation. This module either:
//   1. Dispatches to the GitHub Copilot agent (cloud or VS Code) — preferred
//      for production runs where the LLM does the reasoning, OR
//   2. Runs a local extraction pipeline that calls the scrapers directly
//      and produces a deterministic record (used as fallback / for testing).
//
// The orchestrator picks the mode via --mode flag or AGENT_MODE env var.

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { smartScrape, detectRenderType } from './scrapers/index.js';
import { findApiEndpoints } from './scrapers/detector.js';
import { validateRecord } from './validators/index.js';
import { writeRetailerOutput } from './utils/output-writer.js';
import { logger } from './utils/logger.js';

const AGENT_VERSION = '1.0.0';
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 120000;
const MAX_PAGES = 15;

const PRIORITY_PATHS = [
  { type: 'about', paths: ['/about', '/about-us', '/ueber-uns', '/uber-uns', '/company', '/unternehmen'] },
  { type: 'contact', paths: ['/contact', '/kontakt', '/contact-us'] },
  { type: 'imprint', paths: ['/imprint', '/impressum', '/legal', '/legal-notice'] },
  { type: 'store_finder', paths: ['/stores', '/store-finder', '/standorte', '/filialen', '/locations'] },
  { type: 'brands', paths: ['/brands', '/marken', '/our-brands'] },
  { type: 'product_listing', paths: ['/products', '/shop', '/sortiment', '/katalog'] },
];

export async function runAgentForRetailer(retailer, config = {}) {
  const sessionId = randomUUID();
  const startTime = Date.now();

  logger.info('agent.start', {
    sessionId,
    rowId: retailer.rowId,
    retailerName: retailer.retailerName,
    mode: config.mode || 'local',
  });

  try {
    const result = config.mode === 'copilot'
      ? await runCopilotAgent(retailer, sessionId, config)
      : await runLocalExtraction(retailer, sessionId, config);

    const validation = validateRecord(result, {
      fetchedUrls: result.sources?.map((s) => s.url) || [],
    });

    result.data_quality = result.data_quality || {};
    result.data_quality.warnings = [
      ...(result.data_quality.warnings || []),
      ...validation.hallucinations.issues.map(
        (i) => `${i.severity}: ${i.type} — ${i.message}`,
      ),
    ];

    if (!validation.acceptable) {
      logger.warn('agent.validation_failed', {
        sessionId,
        rowId: retailer.rowId,
        schemaErrors: validation.schema.errors.length,
        hallucinationIssues: validation.hallucinations.issueCount,
      });
    }

    const outputDir = config.outputDir || process.env.OUTPUT_DIR || './data/output';
    const file = writeRetailerOutput(outputDir, retailer.rowId, result);

    logger.info('agent.done', {
      sessionId,
      rowId: retailer.rowId,
      durationMs: Date.now() - startTime,
      acceptable: validation.acceptable,
      file,
    });

    return {
      success: true,
      acceptable: validation.acceptable,
      record: result,
      validation,
      file,
    };
  } catch (err) {
    logger.error('agent.error', {
      sessionId,
      rowId: retailer.rowId,
      error: err.message,
      stack: err.stack,
    });
    return {
      success: false,
      error: err.message,
      rowId: retailer.rowId,
    };
  }
}

async function runCopilotAgent(retailer, sessionId, config) {
  return new Promise((resolve, reject) => {
    const args = [
      'copilot',
      'agent',
      'run',
      '.github/agents/retailer-data-extractor.yaml',
      '--input', `retailer_name=${retailer.retailerName}`,
      '--input', `row_id=${retailer.rowId}`,
      '--session-id', sessionId,
      '--format', 'json',
    ];

    if (retailer.retailerWebsite) {
      args.push('--input', `retailer_website=${retailer.retailerWebsite}`);
    }
    if (retailer.countryHint) {
      args.push('--input', `country_hint=${retailer.countryHint}`);
    }

    const child = spawn('gh', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Copilot agent timeout after ${AGENT_TIMEOUT_MS}ms`));
    }, AGENT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`gh copilot agent exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Failed to parse agent output: ${err.message}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runLocalExtraction(retailer, sessionId, config) {
  const fetchedPages = [];
  const sources = [];
  const fetchedUrls = new Set();

  if (!retailer.retailerWebsite) {
    return buildEmptyRecord(retailer, sessionId, sources, 'No website provided and discovery is disabled in local mode');
  }

  const homepageUrl = normalizeWebsite(retailer.retailerWebsite);
  const renderType = await detectRenderType(homepageUrl).catch(() => 'static');

  const homepage = await safeScrape(homepageUrl, { renderType });
  if (homepage) {
    fetchedPages.push({ ...homepage, pageType: 'homepage' });
    fetchedUrls.add(homepageUrl);
    sources.push({
      url: homepage.finalUrl || homepageUrl,
      fetched_at: homepage.fetchedAt,
      render_type: homepage.renderType,
      http_status: homepage.status,
      contributed_fields: [],
      page_type: 'homepage',
    });
  } else {
    return buildEmptyRecord(retailer, sessionId, sources, 'Homepage could not be fetched');
  }

  const baseUrl = new URL(homepage.finalUrl || homepageUrl);
  const candidatePages = [];

  for (const { type, paths } of PRIORITY_PATHS) {
    for (const path of paths) {
      const candidate = new URL(path, baseUrl).href;
      if (homepage.links?.some((l) => l.toLowerCase() === candidate.toLowerCase()) ||
          homepage.links?.some((l) => l.toLowerCase().endsWith(path.toLowerCase()))) {
        candidatePages.push({ url: candidate, type });
      }
    }
  }

  for (const link of homepage.links || []) {
    const lower = link.toLowerCase();
    for (const { type, paths } of PRIORITY_PATHS) {
      if (paths.some((p) => lower.includes(p))) {
        if (!candidatePages.find((c) => c.url === link)) {
          candidatePages.push({ url: link, type });
        }
        break;
      }
    }
  }

  const remainingBudget = MAX_PAGES - 1;
  const dedup = new Set([homepageUrl]);
  let fetched = 0;
  for (const { url, type } of candidatePages) {
    if (fetched >= remainingBudget) break;
    if (dedup.has(url)) continue;
    dedup.add(url);

    const page = await safeScrape(url, { renderType });
    if (page) {
      fetchedPages.push({ ...page, pageType: type });
      fetchedUrls.add(url);
      sources.push({
        url: page.finalUrl || url,
        fetched_at: page.fetchedAt,
        render_type: page.renderType,
        http_status: page.status,
        contributed_fields: [],
        page_type: type,
      });
      fetched += 1;
    }
  }

  const record = buildRecordFromPages(retailer, sessionId, fetchedPages, sources);
  return record;
}

async function safeScrape(url, options) {
  try {
    return await smartScrape(url, options);
  } catch (err) {
    logger.debug('agent.scrape_failed', { url, error: err.message });
    return null;
  }
}

function normalizeWebsite(website) {
  if (!website) return null;
  const trimmed = website.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildEmptyRecord(retailer, sessionId, sources, note) {
  return baseRecord(retailer, sessionId, sources, {
    note,
    confidence: 'low',
  });
}

function baseRecord(retailer, sessionId, sources, dq = {}) {
  return {
    row_id: retailer.rowId,
    extraction_metadata: {
      agent_version: AGENT_VERSION,
      extracted_at: new Date().toISOString(),
      model_used: 'local-deterministic',
      session_id: sessionId,
      duration_ms: 0,
      tool_calls_made: sources.length,
    },
    company: {
      name_input: retailer.retailerName,
      legal_name: null,
      trading_name: null,
      website: retailer.retailerWebsite || null,
      founded_year: null,
      description_en: null,
      description_original: null,
      logo_url: null,
      social_media: {
        facebook: null,
        instagram: null,
        linkedin: null,
        twitter: null,
        tiktok: null,
        youtube: null,
      },
    },
    locations: {
      headquarters: null,
      store_count: null,
      countries: [],
      stores: [],
    },
    business_model: {
      type: 'unknown',
      parent_company: null,
      buying_group_membership: null,
      year_joined_group: null,
    },
    products: {
      categories: [],
      brands: [],
      price_positioning: null,
      sample_prices: [],
      private_labels: [],
    },
    status: {
      operating_status: 'unknown',
      closure_date: null,
      closure_reason: null,
      evidence: dq.note || 'No definitive operating-status evidence collected in this run',
    },
    data_quality: {
      completeness: 0,
      confidence: dq.confidence || 'low',
      fields_filled: 0,
      fields_total: 22,
      missing_fields: [],
      notes: dq.note || null,
      warnings: [],
    },
    sources: sources.length > 0 ? sources : [{
      url: retailer.retailerWebsite || 'about:blank',
      fetched_at: new Date().toISOString(),
      render_type: 'search_result',
      contributed_fields: ['company.name_input'],
      page_type: 'other',
    }],
  };
}

function buildRecordFromPages(retailer, sessionId, pages, sources) {
  const record = baseRecord(retailer, sessionId, sources);
  const homepage = pages.find((p) => p.pageType === 'homepage');

  if (homepage?.title) {
    record.company.trading_name = homepage.title.split(/[|–-]/)[0].trim();
    addContribution(record, sources, homepage.finalUrl, 'company.trading_name');
  }

  if (homepage?.metaDescription) {
    record.company.description_en = homepage.metaDescription;
    record.company.description_original = homepage.metaDescription;
    addContribution(record, sources, homepage.finalUrl, 'company.description_en');
    addContribution(record, sources, homepage.finalUrl, 'company.description_original');
  }

  for (const page of pages) {
    const og = page.structuredData?.openGraph || {};
    const jsonLd = page.structuredData?.jsonLd || [];

    if (!record.company.logo_url && og.image) {
      record.company.logo_url = og.image;
      addContribution(record, sources, page.finalUrl, 'company.logo_url');
    }

    for (const item of jsonLd) {
      const types = [].concat(item['@type'] || []);
      if (types.includes('Organization')) {
        if (!record.company.legal_name && item.legalName) {
          record.company.legal_name = item.legalName;
          addContribution(record, sources, page.finalUrl, 'company.legal_name');
        }
        if (!record.company.founded_year && item.foundingDate) {
          const year = parseInt(item.foundingDate.slice(0, 4), 10);
          if (!isNaN(year)) {
            record.company.founded_year = year;
            addContribution(record, sources, page.finalUrl, 'company.founded_year');
          }
        }
      }
      if (types.includes('LocalBusiness') || types.includes('Store')) {
        const addr = item.address;
        if (!record.locations.headquarters && addr) {
          record.locations.headquarters = {
            street: addr.streetAddress || null,
            house_number: null,
            postal_code: addr.postalCode || null,
            city: addr.addressLocality || null,
            region: addr.addressRegion || null,
            country: addr.addressCountry || null,
            country_name: addr.addressCountry || null,
            latitude: null,
            longitude: null,
          };
          addContribution(record, sources, page.finalUrl, 'locations.headquarters');
        }
      }
    }

    extractSocialMedia(record, page, sources);
  }

  recomputeDataQuality(record);
  return record;
}

function extractSocialMedia(record, page, sources) {
  const platforms = {
    facebook: /facebook\.com\/[A-Za-z0-9_.\-]+/i,
    instagram: /instagram\.com\/[A-Za-z0-9_.\-]+/i,
    linkedin: /linkedin\.com\/(?:company|in)\/[A-Za-z0-9_.\-]+/i,
    twitter: /(?:twitter|x)\.com\/[A-Za-z0-9_]+/i,
    tiktok: /tiktok\.com\/@[A-Za-z0-9_.]+/i,
    youtube: /youtube\.com\/(?:c|channel|user|@)[A-Za-z0-9_.\-]+/i,
  };

  for (const link of page.links || []) {
    for (const [platform, pattern] of Object.entries(platforms)) {
      if (!record.company.social_media[platform] && pattern.test(link)) {
        record.company.social_media[platform] = link;
        addContribution(record, sources, page.finalUrl, `company.social_media.${platform}`);
      }
    }
  }
}

function addContribution(record, sources, url, fieldPath) {
  const source = sources.find((s) => s.url === url);
  if (source && !source.contributed_fields.includes(fieldPath)) {
    source.contributed_fields.push(fieldPath);
  }
}

function recomputeDataQuality(record) {
  const trackedPaths = [
    'company.legal_name', 'company.trading_name', 'company.website',
    'company.founded_year', 'company.description_en', 'company.logo_url',
    'locations.headquarters', 'locations.store_count',
    'business_model.parent_company', 'business_model.buying_group_membership',
    'products.categories', 'products.brands', 'products.price_positioning',
    'status.operating_status',
  ];
  let filled = 0;
  const missing = [];
  for (const path of trackedPaths) {
    const v = path.split('.').reduce((acc, k) => acc?.[k], record);
    if (v != null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0)) {
      filled += 1;
    } else {
      missing.push(path);
    }
  }
  const completeness = filled / trackedPaths.length;
  record.data_quality.fields_total = trackedPaths.length;
  record.data_quality.fields_filled = filled;
  record.data_quality.completeness = Number(completeness.toFixed(2));
  record.data_quality.missing_fields = missing;
  record.data_quality.confidence =
    completeness >= 0.8 ? 'high' : completeness >= 0.5 ? 'medium' : 'low';
}
