# Getting Started — 5-Minute Setup

Step-by-step checklist to go from zero to your first extraction.

## ☐ Step 1 — Install Prerequisites (3 min)

```bash
# Verify Node 20+
node --version

# Install dependencies
npm install

# Install Playwright Chromium (~120MB)
npx playwright install chromium

# Copy environment template
cp .env.example .env
```

## ☐ Step 2 — Test with the Sample (1 min)

The sample CSV has 5 well-known German sports retailers:

```bash
npm run extract:sample
```

What you should see:

```
[2026-05-01T...] INFO orchestrator.start ...
[2026-05-01T...] INFO orchestrator.input_loaded {"count":5}
[2026-05-01T...] INFO agent.start {"sessionId":"...","rowId":"sample-001",...}
[2026-05-01T...] INFO scrape.start {"url":"https://www.sportmueller.de","renderType":"static"}
...
[2026-05-01T...] INFO orchestrator.done {"durationMs":...,"successful":5,...}

=== Extraction Summary ===
Total retailers   : 5
Successful runs   : 5
Passed validation : 4
Failed runs       : 0
Aggregate file    : ./data/output/_aggregate.json
==========================
```

Check the output:

```bash
ls data/output/
cat data/output/sample-001.json | head -50
```

You'll see:

- `data/output/sample-001.json` … `sample-005.json` — one JSON file per retailer
- `data/output/_aggregate.json` — all records combined
- `data/output/sample-extracted.xlsx` — multi-sheet Excel workbook
  (Retailers, Stores, Brands, SamplePrices, Sources, Quality)

Open the `.xlsx` in Excel/Numbers/LibreOffice to browse the results.

## ☐ Step 3 — Add Your Retailers (1 min)

Drop your Excel file at `data/input/retailers.xlsx` with these columns
(case-insensitive, only `retailer_name` is required):

| id | retailer_name | website | country |
|---|---|---|---|
| 1 | Sport Müller GmbH | https://www.sportmueller.de | DE |
| 2 | Bergzeit | https://www.bergzeit.de | DE |
| ... | ... | ... | ... |

Accepted file formats: `.xlsx`, `.xls`, `.csv`. Accepted column names:

- **Name:** `name`, `retailer`, `company`, `company_name`, `retailer_name`, `firma`, `unternehmen`
- **Website:** `website`, `url`, `web`, `homepage`, `site`, `webseite`
- **Country:** `country`, `land`, `country_code`, `nation`
- **ID:** `id`, `row_id`, `identifier`, `key` (auto-generated if missing)

## ☐ Step 4 — Run Extraction

### Local mode (no Copilot subscription needed)

```bash
npm run extract
```

### Copilot agent mode (needs `gh` CLI authenticated, Copilot subscription)

```bash
gh auth login
AGENT_MODE=copilot npm run extract
```

### Specific row only (debugging)

```bash
node src/orchestrator.js --only-row sample-002
```

### Limited batch (testing on first 10 rows)

```bash
node src/orchestrator.js --limit 10
```

## ☐ Step 4b — Customize the Spreadsheet Output

The orchestrator writes an Excel workbook by default. Override with:

```bash
# Different file path
node src/orchestrator.js --export results/march-2026.xlsx

# CSV instead of Excel (one CSV per sheet)
node src/orchestrator.js --export-format csv \
  --export data/output/retailers.csv

# Both formats
node src/orchestrator.js --export-format both

# Skip the spreadsheet (JSON only)
node src/orchestrator.js --no-export
```

You can also re-export from existing JSON files without re-running agents:

```bash
npm run export                # rebuild xlsx from data/output/_aggregate.json
npm run export:csv            # CSV instead
npm run export:both           # both formats
node src/export-cli.js --output /path/to/anywhere.xlsx
```

## ☐ Step 5 — Validate Results

### Quick stats

```bash
node -e "const a=require('./data/output/_aggregate.json');console.log(\`Records: \${a.record_count}, Errors: \${a.error_count}\`)"
```

### Per-record validation

```bash
node src/validators/schema-validator.js data/output/sample-001.json
```

### Confidence breakdown

```bash
node -e "
const a = require('./data/output/_aggregate.json');
const counts = a.records.reduce((acc, r) => {
  const c = r.data_quality?.confidence || 'unknown';
  acc[c] = (acc[c] || 0) + 1;
  return acc;
}, {});
console.log('Confidence distribution:', counts);
"
```

## ☐ Step 6 — Set Up Automation (Optional)

### GitHub Actions (cloud, scheduled daily)

The workflow is already in `.github/workflows/extract-retailer-data.yml`.
After pushing to GitHub:

```bash
# Manual trigger
gh workflow run extract-retailer-data.yml

# View runs
gh run list --workflow=extract-retailer-data.yml

# Download outputs from latest run
gh run download
```

### VS Code Agent Mode (interactive)

See [`VS_CODE_SETUP.md`](VS_CODE_SETUP.md) — open Copilot Chat, switch to
Agent mode, ask the agent to extract from your CSV.

## Common Issues

### `playwright: command not found`

Run `npx playwright install --with-deps chromium`.

### `Input file not found: data/input/retailers.xlsx`

Either drop your file there or pass `--input <your-file>`.

### `gh: command not found` (when using `--mode copilot`)

Install the GitHub CLI: https://cli.github.com/

### Playwright fails with "Host system is missing dependencies"

```bash
npx playwright install --with-deps chromium
```

On older Linux you may also need:

```bash
sudo apt-get install -y libnss3 libnspr4 libasound2
```

### MCP server not visible in VS Code

1. Open Command Palette → "MCP: Show Server Logs"
2. Most often: `node_modules` not installed → run `npm install`
3. Restart VS Code after installing

## Next Steps

- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) to understand the design
- Read [`SCRAPING_STRATEGY.md`](SCRAPING_STRATEGY.md) to tune scraping
- Customize `.claude/skills/retailer-data-extractor/SKILL.md` for your
  domain (e.g., add buying groups specific to your industry)
- Extend `configs/extraction-schema.json` with custom fields
