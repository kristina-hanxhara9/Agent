import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { exportRecordsToWorkbook } from '../src/utils/excel-exporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(resolve(__dirname, '../examples/sample-output.json'), 'utf-8'),
);

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rde-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('exports XLSX with all expected sheets', () => {
  withTempDir((dir) => {
    const out = join(dir, 'out.xlsx');
    const result = exportRecordsToWorkbook([sample], out, { format: 'xlsx' });
    assert.equal(result.format, 'xlsx');
    assert.ok(existsSync(out));

    const wb = XLSX.readFile(out);
    assert.deepEqual(
      wb.SheetNames.sort(),
      ['Brands', 'Quality', 'Retailers', 'SamplePrices', 'Sources', 'Stores'].sort(),
    );

    const retailerRows = XLSX.utils.sheet_to_json(wb.Sheets.Retailers);
    assert.equal(retailerRows.length, 1);
    assert.equal(retailerRows[0].row_id, 'sample-001');
    assert.equal(retailerRows[0].legal_name, 'Sport Müller GmbH');
    assert.equal(retailerRows[0].business_model_type, 'buying_group');
    assert.equal(retailerRows[0].buying_group_membership, 'Intersport');
  });
});

test('flattens stores into long-form rows', () => {
  withTempDir((dir) => {
    const out = join(dir, 'out.xlsx');
    exportRecordsToWorkbook([sample], out);
    const wb = XLSX.readFile(out);
    const stores = XLSX.utils.sheet_to_json(wb.Sheets.Stores);
    assert.equal(stores.length, 1);
    assert.equal(stores[0].store_name, 'Hauptfiliale Garmisch');
    assert.equal(stores[0].city, 'Garmisch-Partenkirchen');
  });
});

test('flattens brands into one row per brand', () => {
  withTempDir((dir) => {
    const out = join(dir, 'out.xlsx');
    exportRecordsToWorkbook([sample], out);
    const wb = XLSX.readFile(out);
    const brands = XLSX.utils.sheet_to_json(wb.Sheets.Brands);
    assert.equal(brands.length, 5);
    assert.equal(brands[0].brand, 'Salomon');
  });
});

test('exports CSV files (one per sheet)', () => {
  withTempDir((dir) => {
    const out = join(dir, 'out.csv');
    const result = exportRecordsToWorkbook([sample], out, { format: 'csv' });
    assert.equal(result.format, 'csv');
    assert.ok(existsSync(join(dir, 'out__Retailers.csv')));
    assert.ok(existsSync(join(dir, 'out__Stores.csv')));
    assert.ok(existsSync(join(dir, 'out__Brands.csv')));

    const csv = readFileSync(join(dir, 'out__Retailers.csv'), 'utf-8');
    assert.ok(csv.includes('row_id'));
    assert.ok(csv.includes('sample-001'));
  });
});

test('handles records with empty optional sections', () => {
  withTempDir((dir) => {
    const minimal = {
      ...sample,
      locations: { headquarters: null, store_count: null, countries: [], stores: [] },
      products: { categories: [], brands: [], price_positioning: null, sample_prices: [], private_labels: [] },
    };
    const out = join(dir, 'out.xlsx');
    const result = exportRecordsToWorkbook([minimal], out);
    const wb = XLSX.readFile(out);
    const retailers = XLSX.utils.sheet_to_json(wb.Sheets.Retailers);
    assert.equal(retailers.length, 1);
    assert.equal(retailers[0].store_count, undefined);
  });
});
