// Detects likely hallucinations by checking that every non-null field
// is supported by at least one source URL that was actually fetched
// during the agent's session.

const FIELDS_REQUIRING_SOURCES = [
  'company.legal_name',
  'company.trading_name',
  'company.website',
  'company.founded_year',
  'company.description_en',
  'company.description_original',
  'company.logo_url',
  'locations.headquarters',
  'locations.store_count',
  'locations.countries',
  'business_model.type',
  'business_model.parent_company',
  'business_model.buying_group_membership',
  'products.categories',
  'products.brands',
  'products.price_positioning',
  'products.private_labels',
  'status.operating_status',
  'status.closure_date',
  'status.closure_reason',
  'company_size.employees',
  'company_size.employees_range',
  'company_size.annual_revenue_eur',
];

export function detectHallucinations(record, options = {}) {
  const fetchedUrls = options.fetchedUrls
    ? new Set(options.fetchedUrls.map(normalizeUrl))
    : null;

  const issues = [];

  const sources = record.sources || [];
  const sourceUrls = new Set(sources.map((s) => normalizeUrl(s.url)));
  const sourceFieldMap = buildSourceFieldMap(sources);

  for (const path of FIELDS_REQUIRING_SOURCES) {
    const value = getPath(record, path);
    if (isMeaningful(value)) {
      const supportingSources = sourceFieldMap.get(path) || [];
      if (supportingSources.length === 0) {
        issues.push({
          severity: 'high',
          type: 'unsourced_field',
          path,
          message: `Field "${path}" has value but no source URL claims to support it`,
        });
      }
    }
  }

  if (fetchedUrls) {
    for (const source of sources) {
      const normalized = normalizeUrl(source.url);
      if (!fetchedUrls.has(normalized)) {
        issues.push({
          severity: 'critical',
          type: 'fabricated_source',
          url: source.url,
          message: `Source URL "${source.url}" was cited but never actually fetched in this session`,
        });
      }
    }
  }

  if (sources.length === 0 && hasAnyMeaningfulField(record)) {
    issues.push({
      severity: 'critical',
      type: 'no_sources',
      message: 'Record contains data but cites zero sources',
    });
  }

  const filledFields = countFilledFields(record);
  const expectedCompleteness = filledFields.filled / Math.max(filledFields.total, 1);
  const reportedCompleteness = record.data_quality?.completeness;

  if (
    reportedCompleteness != null &&
    Math.abs(reportedCompleteness - expectedCompleteness) > 0.15
  ) {
    issues.push({
      severity: 'low',
      type: 'completeness_mismatch',
      message: `Reported completeness ${reportedCompleteness.toFixed(2)} differs from observed ${expectedCompleteness.toFixed(2)}`,
    });
  }

  const stores = record.locations?.stores || [];
  const storeCount = record.locations?.store_count;
  if (typeof storeCount === 'number' && stores.length > storeCount) {
    issues.push({
      severity: 'medium',
      type: 'inconsistent_stores',
      message: `Listed ${stores.length} individual stores but store_count is ${storeCount}`,
    });
  }

  return {
    clean: issues.length === 0,
    issueCount: issues.length,
    issues,
    summary: summarize(issues),
  };
}

function buildSourceFieldMap(sources) {
  const map = new Map();
  for (const source of sources) {
    for (const field of source.contributed_fields || []) {
      if (!map.has(field)) map.set(field, []);
      map.get(field).push(source.url);
    }
  }
  return map;
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function isMeaningful(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function hasAnyMeaningfulField(record) {
  return FIELDS_REQUIRING_SOURCES.some((path) => isMeaningful(getPath(record, path)));
}

function countFilledFields(record) {
  let filled = 0;
  let total = 0;
  for (const path of FIELDS_REQUIRING_SOURCES) {
    total += 1;
    if (isMeaningful(getPath(record, path))) filled += 1;
  }
  return { filled, total };
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

function summarize(issues) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  }
  return counts;
}
