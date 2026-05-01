// Flattens per-retailer extraction records into spreadsheet rows and
// writes them as XLSX (multi-sheet), CSV, or both.
//
// Sheets produced:
//   - "Retailers"  — one row per retailer, all top-level fields flattened
//   - "Stores"     — one row per individual store (long-form)
//   - "Brands"     — one row per (retailer, brand) pair
//   - "Sources"    — one row per (retailer, source URL)
//   - "Quality"    — completeness/confidence/warnings per retailer
//
// CSV mode writes one file per sheet alongside the .xlsx.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import * as XLSX from 'xlsx';

export function exportRecordsToWorkbook(records, outputPath, options = {}) {
  const format = options.format || inferFormat(outputPath);
  const sheets = buildSheets(records);

  if (format === 'csv' || format === 'both') {
    writeCsvFiles(sheets, outputPath);
  }
  if (format === 'xlsx' || format === 'both') {
    writeXlsx(sheets, outputPath);
  }

  return {
    format,
    path: outputPath,
    sheets: Object.keys(sheets),
    rowCounts: Object.fromEntries(
      Object.entries(sheets).map(([name, rows]) => [name, rows.length]),
    ),
  };
}

function inferFormat(outputPath) {
  const ext = extname(outputPath).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  return 'xlsx';
}

function buildSheets(records) {
  const retailers = records.map(flattenRetailer);
  const stores = records.flatMap(flattenStores);
  const brands = records.flatMap(flattenBrands);
  const sources = records.flatMap(flattenSources);
  const quality = records.map(flattenQuality);
  const samplePrices = records.flatMap(flattenSamplePrices);

  return {
    Retailers: retailers,
    Stores: stores,
    Brands: brands,
    SamplePrices: samplePrices,
    Sources: sources,
    Quality: quality,
  };
}

function flattenRetailer(r) {
  const company = r.company || {};
  const social = company.social_media || {};
  const hq = r.locations?.headquarters || {};
  const bm = r.business_model || {};
  const products = r.products || {};
  const status = r.status || {};
  const contact = r.contact || {};
  const size = r.company_size || {};
  const services = r.services || {};
  const meta = r.extraction_metadata || {};
  const dq = r.data_quality || {};

  return {
    row_id: r.row_id,
    name_input: company.name_input ?? null,
    legal_name: company.legal_name ?? null,
    trading_name: company.trading_name ?? null,
    website: company.website ?? null,
    founded_year: company.founded_year ?? null,
    description_en: truncate(company.description_en, 500),
    description_original: truncate(company.description_original, 500),
    logo_url: company.logo_url ?? null,
    facebook: social.facebook ?? null,
    instagram: social.instagram ?? null,
    linkedin: social.linkedin ?? null,
    twitter: social.twitter ?? null,
    tiktok: social.tiktok ?? null,
    youtube: social.youtube ?? null,
    hq_street: hq.street ?? null,
    hq_house_number: hq.house_number ?? null,
    hq_postal_code: hq.postal_code ?? null,
    hq_city: hq.city ?? null,
    hq_region: hq.region ?? null,
    hq_country: hq.country ?? null,
    hq_country_name: hq.country_name ?? null,
    hq_latitude: hq.latitude ?? null,
    hq_longitude: hq.longitude ?? null,
    store_count: r.locations?.store_count ?? null,
    countries: arrayToString(r.locations?.countries),
    business_model_type: bm.type ?? null,
    parent_company: bm.parent_company ?? null,
    buying_group_membership: bm.buying_group_membership ?? null,
    year_joined_group: bm.year_joined_group ?? null,
    product_categories: arrayToString(products.categories),
    brands: arrayToString(products.brands),
    private_labels: arrayToString(products.private_labels),
    price_positioning: products.price_positioning ?? null,
    sample_price_count: (products.sample_prices || []).length,
    operating_status: status.operating_status ?? null,
    closure_date: status.closure_date ?? null,
    closure_reason: status.closure_reason ?? null,
    status_evidence: truncate(status.evidence, 300),
    contact_phone: contact.phone ?? null,
    contact_email: contact.email ?? null,
    contact_form_url: contact.contact_form_url ?? null,
    employees: size.employees ?? null,
    employees_range: size.employees_range ?? null,
    annual_revenue_eur: size.annual_revenue_eur ?? null,
    revenue_year: size.revenue_year ?? null,
    online_shop: services.online_shop ?? null,
    click_and_collect: services.click_and_collect ?? null,
    delivery: services.delivery ?? null,
    in_store_pickup: services.in_store_pickup ?? null,
    repair_service: services.repair_service ?? null,
    consultation: services.consultation ?? null,
    completeness: dq.completeness ?? null,
    confidence: dq.confidence ?? null,
    fields_filled: dq.fields_filled ?? null,
    fields_total: dq.fields_total ?? null,
    missing_field_count: (dq.missing_fields || []).length,
    warning_count: (dq.warnings || []).length,
    quality_notes: truncate(dq.notes, 300),
    source_count: (r.sources || []).length,
    extracted_at: meta.extracted_at ?? null,
    model_used: meta.model_used ?? null,
    duration_ms: meta.duration_ms ?? null,
    session_id: meta.session_id ?? null,
  };
}

function flattenStores(r) {
  const stores = r.locations?.stores || [];
  return stores.map((store, idx) => ({
    row_id: r.row_id,
    retailer_name: r.company?.trading_name || r.company?.name_input,
    store_index: idx + 1,
    store_name: store.name ?? null,
    street: store.address?.street ?? null,
    house_number: store.address?.house_number ?? null,
    postal_code: store.address?.postal_code ?? null,
    city: store.address?.city ?? null,
    region: store.address?.region ?? null,
    country: store.address?.country ?? null,
    latitude: store.address?.latitude ?? null,
    longitude: store.address?.longitude ?? null,
    phone: store.phone ?? null,
    opening_hours: store.opening_hours ?? null,
  }));
}

function flattenBrands(r) {
  const brands = r.products?.brands || [];
  return brands.map((brand) => ({
    row_id: r.row_id,
    retailer_name: r.company?.trading_name || r.company?.name_input,
    brand,
  }));
}

function flattenSamplePrices(r) {
  const prices = r.products?.sample_prices || [];
  return prices.map((p) => ({
    row_id: r.row_id,
    retailer_name: r.company?.trading_name || r.company?.name_input,
    product: p.product ?? null,
    brand: p.brand ?? null,
    price: p.price ?? null,
    currency: p.currency ?? null,
    url: p.url ?? null,
  }));
}

function flattenSources(r) {
  const sources = r.sources || [];
  return sources.map((s) => ({
    row_id: r.row_id,
    retailer_name: r.company?.trading_name || r.company?.name_input,
    url: s.url ?? null,
    page_type: s.page_type ?? null,
    render_type: s.render_type ?? null,
    http_status: s.http_status ?? null,
    fetched_at: s.fetched_at ?? null,
    contributed_fields: arrayToString(s.contributed_fields),
  }));
}

function flattenQuality(r) {
  const dq = r.data_quality || {};
  return {
    row_id: r.row_id,
    retailer_name: r.company?.trading_name || r.company?.name_input,
    completeness: dq.completeness ?? null,
    confidence: dq.confidence ?? null,
    fields_filled: dq.fields_filled ?? null,
    fields_total: dq.fields_total ?? null,
    missing_fields: arrayToString(dq.missing_fields),
    warnings: arrayToString(dq.warnings, ' || '),
    notes: dq.notes ?? null,
  };
}

function arrayToString(arr, sep = ', ') {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.join(sep);
}

function truncate(value, max) {
  if (value == null) return null;
  const str = String(value);
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeXlsx(sheets, outputPath) {
  ensureDir(outputPath);
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const safeRows = rows.length > 0 ? rows : [{ note: 'no rows' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(workbook, ws, name);
  }
  XLSX.writeFile(workbook, outputPath);
}

function writeCsvFiles(sheets, outputPath) {
  ensureDir(outputPath);
  const dir = dirname(outputPath);
  const stem = basename(outputPath, extname(outputPath));
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    writeFileSync(join(dir, `${stem}__${name}.csv`), csv, 'utf-8');
  }
}
