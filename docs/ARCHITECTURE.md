# Architecture

## Design Goals

1. **One agent per retailer.** No cross-contamination, no shared state.
2. **Zero hallucinations.** Every claim backed by a fetched URL.
3. **Light infrastructure.** No databases, no message queues, no orchestration
   platform. Just Node + the file system + GitHub Actions / VS Code.
4. **Three execution paths from one definition.** Same agent runs in cloud
   (Actions), VS Code (agent mode), and CLI (orchestrator).

## Component Responsibilities

```
┌────────────────────────────────────────────────────────────────────────┐
│                            INPUT LAYER                                 │
│  data/input/retailers.xlsx  →  utils/excel-reader.js  →  rows[]        │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION LAYER                             │
│  src/orchestrator.js                                                   │
│    - applies p-limit (default: 5 concurrent)                           │
│    - dispatches one runAgentForRetailer() per row                      │
│    - aggregates per-row outputs at the end                             │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          AGENT LAYER                                   │
│  src/agent-runner.js                                                   │
│    Mode A: local       → deterministic scrape pipeline                 │
│    Mode B: copilot     → spawns `gh copilot agent run` per retailer    │
│                          (uses .github/agents/...yaml definition)      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         SCRAPER LAYER                                  │
│  src/scrapers/                                                         │
│    detector.js          → classifies URL: static | dynamic | api       │
│    static-scraper.js    → Cheerio + undici (fast)                      │
│    dynamic-scraper.js   → Playwright Chromium (JS-heavy)               │
│    api-scraper.js       → undici JSON fetch                            │
│    structured-data.js   → JSON-LD / OpenGraph / Microdata extraction   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      VALIDATION LAYER                                  │
│  src/validators/                                                       │
│    schema-validator.js       → AJV against extraction-schema.json      │
│    hallucination-detector.js → source-attribution + URL fetch checks   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          OUTPUT LAYER                                  │
│  data/output/<row_id>.json    (one per retailer)                       │
│  data/output/_aggregate.json  (combined)                               │
│  data/logs/extraction-YYYY-MM-DD.log                                   │
└────────────────────────────────────────────────────────────────────────┘
```

## The Two Modes

The `--mode` flag (or `AGENT_MODE` env var) controls how each row is
processed.

### `--mode local` (default)

A deterministic pipeline calls the scrapers directly:

1. Resolve the website URL (use the one in the input row)
2. Detect render type
3. Fetch homepage + a small set of common subpaths (about, imprint, brands, …)
4. Extract structured data and meta tags
5. Map to the schema
6. Validate

**Pros:** No LLM cost, fully reproducible, very fast (~10s/retailer with
Playwright, ~2s/retailer for static sites).

**Cons:** Won't infer beyond what structured markup provides. Use this for
bootstrapping, testing, or when you want strict determinism.

### `--mode copilot`

Each row spawns `gh copilot agent run` which loads the agent definition
(`.github/agents/retailer-data-extractor.yaml`) and the skill
(`.claude/skills/retailer-data-extractor/SKILL.md`). The LLM reasons about
what to fetch, parses unstructured text, and fills the schema.

**Pros:** Handles unstructured sites, navigates store finders, makes
judgment calls about ambiguous data, with hallucination guards still
enforced by the validators.

**Cons:** Costs Copilot/Claude tokens per retailer. Use this for production
extraction where quality matters.

## The MCP Server

`src/mcp-server/retailer-tools-server.js` exposes the same scraper functions
as MCP tools. VS Code agent mode loads it from `.vscode/mcp.json` and gives
the LLM five tools:

- `detect_render_type(url)` — classify before scraping
- `smart_scrape(url, opts)` — fetch with the right strategy
- `extract_structured_data(html)` — parse JSON-LD / OG / Microdata
- `find_api_endpoints(url)` — discover XHR endpoints to bypass JS rendering
- `validate_extraction(record, fetchedUrls)` — pre-flight schema + hallucination check

This means the *same* extraction logic runs whether you're using GitHub
Actions, VS Code agent mode, or the CLI orchestrator.

## Why No Database?

For up to ~10k retailers, a flat JSON file per row is faster to write,
trivial to debug, and survives partial failures (each agent's output is
independent). The aggregate file is rebuilt at the end of each run.

If you scale past 10k or want incremental processing, swap
`utils/output-writer.js` to write to your DB of choice — every other layer
stays the same.

## Why No Message Queue?

`p-limit` provides bounded concurrency in a single process. For batches
< 1000 retailers, this is plenty. Each agent's runtime is bounded
(120s default) so the worst-case batch time is predictable.

For larger batches, the GitHub Actions matrix strategy lets you shard the
input across multiple runners — still no queue needed.

## Trade-offs Made

| Choice | Alternative | Why this one |
|---|---|---|
| Per-row JSON files | Single output stream | Independent failures, easy parallelism, restart-friendly |
| `p-limit` concurrency | Worker threads / cluster | Simpler, scrapers are I/O bound (network + browser) |
| Cheerio + Playwright | Puppeteer / Selenium | Modern, well-maintained, smaller install footprint |
| undici for HTTP | axios / node-fetch | Built-in to Node 18+, fastest for high concurrency |
| AJV for validation | Zod / Joi | Strict JSON Schema, plays well with the schema file |
| stdio MCP server | HTTP MCP server | No port allocation, VS Code launches it directly |
