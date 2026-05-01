import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import * as XLSX from 'xlsx';

const NAME_COLUMNS = ['name', 'retailer', 'company', 'company_name', 'retailer_name', 'firma', 'unternehmen'];
const WEBSITE_COLUMNS = ['website', 'url', 'web', 'homepage', 'site', 'webseite'];
const COUNTRY_COLUMNS = ['country', 'land', 'country_code', 'nation'];
const ID_COLUMNS = ['id', 'row_id', 'identifier', 'key'];

export function readRetailerInput(filePath) {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.csv') {
    return readCsv(filePath);
  }

  if (ext === '.xlsx' || ext === '.xls') {
    return readExcel(filePath);
  }

  throw new Error(`Unsupported input format: ${ext}. Use .csv, .xlsx, or .xls`);
}

function readExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return normalizeRows(rows);
}

function readCsv(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const workbook = XLSX.read(content, { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
  return normalizeRows(rows);
}

function normalizeRows(rows) {
  return rows.map((row, index) => {
    const lower = lowerKeyMap(row);
    const name = pickFirst(lower, NAME_COLUMNS);
    const website = pickFirst(lower, WEBSITE_COLUMNS);
    const country = pickFirst(lower, COUNTRY_COLUMNS);
    const explicitId = pickFirst(lower, ID_COLUMNS);

    if (!name) {
      throw new Error(
        `Row ${index + 2} is missing a retailer name. Expected one of: ${NAME_COLUMNS.join(', ')}`,
      );
    }

    return {
      rowId: explicitId ? String(explicitId) : `row-${String(index + 1).padStart(5, '0')}`,
      retailerName: String(name).trim(),
      retailerWebsite: website ? String(website).trim() : null,
      countryHint: country ? String(country).trim() : null,
      raw: row,
    };
  });
}

function lowerKeyMap(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.toLowerCase().trim().replace(/\s+/g, '_')] = value;
  }
  return out;
}

function pickFirst(rowMap, candidates) {
  for (const candidate of candidates) {
    if (rowMap[candidate] != null && rowMap[candidate] !== '') {
      return rowMap[candidate];
    }
  }
  return null;
}
