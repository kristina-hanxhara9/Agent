# Retailer Data Extractor — GitHub Copilot Agent Infrastructure

Production-ready, lightweight multi-agent system that extracts structured data
about retailers from their public web presence. **One isolated agent per
retailer**, **zero hallucinations**, **smart HTML/JavaScript/API scraping**.

---

## What It Does

For each row in your Excel/CSV (one row per retailer), the system dispatches a
fresh, isolated agent that:

1. Resolves the company website
2. Auto-detects whether the site is static HTML, a JS-heavy SPA, or API-based
3. Fetches a small, targeted set of pages (homepage, about, imprint, store
   finder, brands, products)
4. Extracts structured data (JSON-LD, OpenGraph, Microdata) plus parsed text
5. Maps findings to a strict JSON schema
6. Validates that every claim is backed by a fetched source URL

You get:

- One JSON file per retailer in `data/output/<row_id>.json` (full structured data + sources)
- An aggregated `data/output/_aggregate.json` (all records in one file)
- An Excel workbook `data/output/retailers-extracted.xlsx` with multiple sheets:
  **Retailers** (one row per retailer, all top-level fields flattened),
  **Stores** (long-form), **Brands**, **SamplePrices**, **Sources**, **Quality**
- Optional CSV companion files (one per sheet) when `--export-format=csv` or `both`

---

## Three Ways to Run It

| Where | Command | Best for |
|---|---|---|
| **GitHub Actions** (cloud) | `gh workflow run extract-retailer-data.yml` | Scheduled batch runs |
| **VS Code** (local, agent mode) | `Cmd/Ctrl+Shift+I` → Agent mode → "extract retailers" | Interactive iteration |
| **CLI** (local, terminal) | `npm run extract` | Scripts, debugging |

All three use the **same agent definition** (`.github/agents/retailer-data-extractor.yaml`)
and the **same skill** (`.claude/skills/retailer-data-extractor/SKILL.md`).

---

## Quick Start (5 minutes)

```bash
git clone https://github.com/kristina-hanxhara9/agent.git
cd agent
npm install
npx playwright install chromium
cp .env.example .env

# Try the sample (5 retailers, no auth needed)
npm run extract:sample
```

Outputs land in `data/output/`. Open `data/output/_aggregate.json` to see
all results.

For your own retailers: drop an Excel file at `data/input/retailers.xlsx`
(columns: `id`, `retailer_name`, `website`, `country`) and run:

```bash
npm run extract
```

The Excel output lands at `data/output/retailers-extracted.xlsx`.

### Re-export Without Re-running

If you already have JSON outputs and just want a different spreadsheet
format:

```bash
npm run export                # rebuild xlsx from existing JSONs
npm run export:csv            # CSV instead
npm run export:both           # xlsx + CSV side-by-side
```

---

## How "One Agent Per Retailer" Works

```
Excel (N rows)
      │
      ▼
┌───────────────┐
│  orchestrator │  reads input, applies p-limit (default: 5 concurrent)
└───────┬───────┘
        │ fan-out
        ├──────────────────┬──────────────────┬─────────── ...
        ▼                  ▼                  ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ Agent A │        │ Agent B │        │ Agent C │     each in own
   │  Row 1  │        │  Row 2  │        │  Row 3  │     session, no
   └────┬────┘        └────┬────┘        └────┬────┘     shared state
        │                  │                  │
        ▼                  ▼                  ▼
   data/output/      data/output/        data/output/
    row-1.json        row-2.json          row-3.json
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                           ▼
                  data/output/_aggregate.json
```

**Why isolation matters:** The agent for "Sport Müller" can never accidentally
inject data from "Decathlon" because it was never told about it. Each session
starts blank, fetches only that retailer's pages, and writes only that
retailer's row.

---

## Anti-Hallucination Guarantees

The system enforces these rules at three layers:

### Layer 1 — Skill-level (LLM instructions)
`SKILL.md` tells the model: "Every non-null field must be backed by a URL you
actually fetched. If not verifiable, the field is `null`."

### Layer 2 — Schema validation
`configs/extraction-schema.json` rejects records with missing required fields,
invalid enums, or unauthorized properties.

### Layer 3 — Hallucination detector
`src/validators/hallucination-detector.js` cross-checks:
- Every populated field has at least one source claiming to support it
- Every cited source URL appears in the agent's actual fetch log
- No record has data without sources

Issues are flagged in `data_quality.warnings` and (in strict mode) cause the
record to fail validation.

---

## Smart Scraping (HTML / JavaScript / API)

`src/scrapers/index.js` routes each URL to the best strategy:

| Render type | Detector signals | Strategy | Speed |
|---|---|---|---|
| **static** | Long visible text, few external scripts | Cheerio + undici | ~150ms |
| **dynamic** | Empty `<div id="root">`, SPA framework signatures | Playwright (Chromium) | ~3-5s |
| **api** | Content-type is JSON, or `/api/` `/graphql` calls visible | Direct undici | ~300ms |
| **hybrid** | SPA wrapper but content rendered server-side | Playwright | ~3-5s |

The detector inspects: visible text length, script tag count, framework
signatures (`__NEXT_DATA__`, `id="root"`, `ng-version`, etc.), and API call
patterns in the source.

You can override the auto-detection by passing `--render-type` to `smart_scrape`.

---

## File Map

```
.
├── .github/
│   ├── agents/
│   │   └── retailer-data-extractor.yaml    # Custom Copilot agent definition
│   ├── workflows/
│   │   ├── extract-retailer-data.yml       # Scheduled / manual extraction
│   │   └── test.yml                        # CI for tests + schema check
│   └── copilot-instructions.md             # Repo-level Copilot guidance
├── .vscode/
│   ├── mcp.json                            # MCP server config (agent mode)
│   ├── settings.json                       # Agent + Copilot settings
│   ├── launch.json                         # Debug configurations
│   └── extensions.json                     # Recommended extensions
├── .claude/
│   └── skills/
│       └── retailer-data-extractor/
│           └── SKILL.md                    # Shared extraction skill
├── configs/
│   └── extraction-schema.json              # Strict output schema
├── src/
│   ├── orchestrator.js                     # Reads input, dispatches agents, exports spreadsheet
│   ├── agent-runner.js                     # Per-retailer runner (local + Copilot)
│   ├── export-cli.js                       # Standalone JSON → XLSX/CSV exporter
│   ├── scrapers/
│   │   ├── index.js                        # Router
│   │   ├── detector.js                     # Render-type classification
│   │   ├── static-scraper.js               # Cheerio
│   │   ├── dynamic-scraper.js              # Playwright
│   │   ├── api-scraper.js                  # undici
│   │   └── structured-data.js              # JSON-LD / OG / Microdata
│   ├── validators/
│   │   ├── index.js
│   │   ├── schema-validator.js             # AJV against extraction-schema
│   │   └── hallucination-detector.js       # Source-attribution checks
│   ├── utils/
│   │   ├── excel-reader.js                 # CSV / XLSX input
│   │   ├── excel-exporter.js               # JSON → XLSX/CSV (multi-sheet)
│   │   ├── output-writer.js                # Per-row + aggregate writer
│   │   └── logger.js                       # JSON-line logger
│   └── mcp-server/
│       └── retailer-tools-server.js        # MCP server for VS Code agent mode
├── data/
│   ├── input/                              # Drop retailers.xlsx here
│   ├── output/                             # Per-row JSON + _aggregate.json + retailers-extracted.xlsx
│   └── logs/                               # Daily JSON-line logs
├── examples/
│   ├── sample-retailers.csv
│   └── sample-output.json
├── tests/                                  # node --test
└── docs/
    ├── ARCHITECTURE.md
    ├── VS_CODE_SETUP.md
    └── SCRAPING_STRATEGY.md
```

---

## Configuration

All knobs are environment variables (see `.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `MAX_CONCURRENT_AGENTS` | `5` | How many retailers run in parallel |
| `AGENT_TIMEOUT_MS` | `120000` | Max time per retailer (2 min) |
| `SCRAPER_TIMEOUT_MS` | `30000` | Max time per page fetch |
| `OUTPUT_DIR` | `./data/output` | Where per-row JSONs land |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PLAYWRIGHT_HEADLESS` | `true` | Set `false` to watch the browser |
| `STRICT_VALIDATION` | `true` | Fail records with hallucination issues |
| `AGENT_MODE` | `local` | `local` (deterministic scrape) or `copilot` (LLM agent) |

---

## VS Code Agent Mode Setup

See [`docs/VS_CODE_SETUP.md`](docs/VS_CODE_SETUP.md) for full instructions.
TL;DR:

1. Install the recommended extensions (`.vscode/extensions.json`)
2. Open the project — VS Code auto-discovers `.vscode/mcp.json`
3. Open Copilot Chat → switch to **Agent mode**
4. Type: *"Extract data for the retailers in `examples/sample-retailers.csv`"*

The agent has access to `smart_scrape`, `detect_render_type`,
`extract_structured_data`, `find_api_endpoints`, and `validate_extraction`
through the MCP server.

---

## GitHub Actions Setup

The workflow runs daily at 03:00 UTC by default and can also be triggered
manually:

```bash
gh workflow run extract-retailer-data.yml \
  -f input_file=data/input/retailers.xlsx \
  -f mode=local \
  -f concurrency=5
```

Outputs are uploaded as artifacts (`retailer-extraction-<run-number>`) and
retained 30 days.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Why this design, trade-offs
- [`docs/VS_CODE_SETUP.md`](docs/VS_CODE_SETUP.md) — Local dev with agent mode
- [`docs/SCRAPING_STRATEGY.md`](docs/SCRAPING_STRATEGY.md) — How HTML/JS/API detection works
- [`.claude/skills/retailer-data-extractor/SKILL.md`](.claude/skills/retailer-data-extractor/SKILL.md) — The agent's instructions

---

## License

MIT
