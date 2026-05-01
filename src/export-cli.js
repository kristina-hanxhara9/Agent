#!/usr/bin/env node
// Standalone exporter — re-build the spreadsheet from existing per-row JSON
// files (or an aggregate.json) without re-running the agents.
//
// Usage:
//   node src/export-cli.js                             # uses defaults
//   node src/export-cli.js --output retailers.csv --format csv
//   node src/export-cli.js --aggregate data/output/_aggregate.json

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateOutputs } from './utils/output-writer.js';
import { exportRecordsToWorkbook } from './utils/excel-exporter.js';

const args = parseArgs(process.argv.slice(2));

const aggregateFile = resolve(args.aggregate || './data/output/_aggregate.json');
const outputDir = resolve(args.outputDir || './data/output');
const exportPath = resolve(args.output || './data/output/retailers-extracted.xlsx');
const format = args.format || 'xlsx';

let records;
if (existsSync(aggregateFile)) {
  records = JSON.parse(readFileSync(aggregateFile, 'utf-8')).records;
} else {
  console.log(`No aggregate at ${aggregateFile} — rebuilding from ${outputDir}`);
  const tempPath = resolve('./data/output/_aggregate.json');
  aggregateOutputs(outputDir, tempPath);
  records = JSON.parse(readFileSync(tempPath, 'utf-8')).records;
}

if (!records || records.length === 0) {
  console.error('No records to export');
  process.exit(1);
}

const result = exportRecordsToWorkbook(records, exportPath, { format });
console.log(`Exported ${records.length} records to ${result.path}`);
console.log(`Sheets: ${result.sheets.join(', ')}`);
console.log(`Row counts: ${JSON.stringify(result.rowCounts)}`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}
