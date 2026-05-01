import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readRetailerInput } from '../src/utils/excel-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(__dirname, '../examples/sample-retailers.csv');

test('reads sample CSV with id, name, website, country columns', () => {
  const rows = readRetailerInput(samplePath);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].rowId, 'sample-001');
  assert.equal(rows[0].retailerName, 'Sport Müller GmbH');
  assert.equal(rows[0].retailerWebsite, 'https://www.sportmueller.de');
  assert.equal(rows[0].countryHint, 'DE');
});

test('rejects unsupported file extension', () => {
  assert.throws(() => readRetailerInput('/tmp/x.txt'), /Unsupported input format/);
});
