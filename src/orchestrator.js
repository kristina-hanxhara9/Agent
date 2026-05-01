#!/usr/bin/env node
// Orchestrator: reads the Excel/CSV input and dispatches one isolated agent
// per row. Each agent runs in its own session — the orchestrator never
// shares context between retailers.

import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pLimit from 'p-limit';
import { readRetailerInput } from './utils/excel-reader.js';
import { runAgentForRetailer } from './agent-runner.js';
import { aggregateOutputs } from './utils/output-writer.js';
import { exportRecordsToWorkbook } from './utils/excel-exporter.js';
import { closeBrowser } from './scrapers/dynamic-scraper.js';
import { logger } from './utils/logger.js';

const args = parseArgs(process.argv.slice(2));
const config = {
  inputFile: args.input || './data/input/retailers.xlsx',
  outputDir: args.output || process.env.OUTPUT_DIR || './data/output',
  aggregateFile: args.aggregate || './data/output/_aggregate.json',
  exportFile: args.export || './data/output/retailers-extracted.xlsx',
  exportFormat: args['export-format'] || 'xlsx',
  noExport: args['no-export'] === true,
  mode: args.mode || process.env.AGENT_MODE || 'local',
  concurrency: Number(args.concurrency || process.env.MAX_CONCURRENT_AGENTS || 5),
  dryRun: args['dry-run'] === true,
  limit: args.limit ? Number(args.limit) : null,
  filterRowId: args['only-row'] || null,
};

if (args.help) {
  printHelp();
  process.exit(0);
}

run().catch(async (err) => {
  logger.error('orchestrator.fatal', { error: err.message, stack: err.stack });
  await closeBrowser().catch(() => {});
  process.exitCode = 1;
});

async function run() {
  logger.info('orchestrator.start', { config: redact(config) });

  const inputPath = resolve(config.inputFile);
  if (!existsSync(inputPath)) {
    throw new Error(
      `Input file not found: ${inputPath}\n` +
      `Place your Excel/CSV at this path or pass --input <file>.\n` +
      `See examples/sample-retailers.csv for the expected format.`,
    );
  }

  let retailers = readRetailerInput(inputPath);
  logger.info('orchestrator.input_loaded', { count: retailers.length });

  if (config.filterRowId) {
    retailers = retailers.filter((r) => r.rowId === config.filterRowId);
  }
  if (config.limit) {
    retailers = retailers.slice(0, config.limit);
  }

  if (config.dryRun) {
    console.log('DRY RUN — would dispatch agents for:');
    for (const r of retailers) {
      console.log(`  ${r.rowId}: ${r.retailerName} (${r.retailerWebsite || 'no website'})`);
    }
    return;
  }

  const limit = pLimit(config.concurrency);
  const startTime = Date.now();

  const results = await Promise.all(
    retailers.map((retailer) =>
      limit(() => runAgentForRetailer(retailer, {
        mode: config.mode,
        outputDir: config.outputDir,
      })),
    ),
  );

  const summary = summarize(results);
  logger.info('orchestrator.done', {
    durationMs: Date.now() - startTime,
    ...summary,
  });

  const aggregate = aggregateOutputs(config.outputDir, config.aggregateFile);
  logger.info('orchestrator.aggregated', aggregate);

  let exportInfo = null;
  if (!config.noExport && aggregate.count > 0) {
    try {
      const records = JSON.parse(readFileSync(config.aggregateFile, 'utf-8')).records;
      exportInfo = exportRecordsToWorkbook(records, config.exportFile, {
        format: config.exportFormat,
      });
      logger.info('orchestrator.exported', exportInfo);
    } catch (err) {
      logger.error('orchestrator.export_failed', { error: err.message });
    }
  }

  await closeBrowser().catch(() => {});

  printSummary(summary, aggregate, exportInfo, Date.now() - startTime);

  if (summary.failed > 0) {
    process.exitCode = 2;
  }
}

function summarize(results) {
  const total = results.length;
  const successful = results.filter((r) => r.success).length;
  const acceptable = results.filter((r) => r.success && r.acceptable).length;
  const failed = total - successful;
  return { total, successful, acceptable, failed };
}

function printSummary(summary, aggregate, exportInfo, durationMs) {
  const seconds = (durationMs / 1000).toFixed(1);
  console.log('\n=== Extraction Summary ===');
  console.log(`Total retailers   : ${summary.total}`);
  console.log(`Successful runs   : ${summary.successful}`);
  console.log(`Passed validation : ${summary.acceptable}`);
  console.log(`Failed runs       : ${summary.failed}`);
  console.log(`Aggregate JSON    : ${aggregate.file}`);
  if (exportInfo) {
    console.log(`Spreadsheet       : ${exportInfo.path}`);
    console.log(`Sheets            : ${exportInfo.sheets.join(', ')}`);
  }
  console.log(`Total duration    : ${seconds}s`);
  console.log('==========================\n');
}

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

function redact(config) {
  return { ...config };
}

function printHelp() {
  console.log(`
Usage: node src/orchestrator.js [options]

Options:
  --input <file>          Path to Excel/CSV input (default: data/input/retailers.xlsx)
  --output <dir>          Directory for per-retailer JSON outputs (default: data/output)
  --aggregate <file>      Aggregate JSON file (default: data/output/_aggregate.json)
  --export <file>         Spreadsheet export path (default: data/output/retailers-extracted.xlsx)
  --export-format <fmt>   "xlsx", "csv", or "both" (default: xlsx)
  --no-export             Skip the spreadsheet export step
  --mode <mode>           "local" (deterministic scrape) or "copilot" (LLM agent)
                          (default: local; set AGENT_MODE env var to override)
  --concurrency <n>       Max parallel agents (default: 5)
  --limit <n>             Process only first N rows (testing)
  --only-row <id>         Process only the row with this ID (debugging)
  --dry-run               Print what would be processed without running
  --help                  Show this help
`);
}
