# VS Code Setup — Agent Mode + MCP Server

Run the same retailer-extraction agent locally inside VS Code, with full
interactive control. The agent uses the MCP server defined in
`.vscode/mcp.json` to call the smart scrapers.

## Prerequisites

- VS Code (1.99 or later — agent mode is in stable)
- GitHub Copilot subscription (Individual, Business, or Enterprise)
- Node.js 20+
- The recommended extensions in `.vscode/extensions.json`

## One-Time Setup

```bash
# From the repo root
npm install
npx playwright install chromium
cp .env.example .env
```

Open the repo in VS Code. When prompted, install the recommended extensions
(GitHub Copilot, GitHub Copilot Chat, Playwright, ESLint).

## Enable Agent Mode

Already enabled by `.vscode/settings.json`:

```json
{
  "github.copilot.chat.agent.enabled": true,
  "chat.agent.enabled": true,
  "chat.mcp.enabled": true
}
```

## Verify the MCP Server

1. Open Copilot Chat (`Cmd/Ctrl+Shift+I`)
2. Switch the dropdown from "Ask" → **"Agent"**
3. Click the tools icon (🔧) at the bottom of the chat
4. You should see five tools under **retailer-tools**:
   - `detect_render_type`
   - `smart_scrape`
   - `extract_structured_data`
   - `find_api_endpoints`
   - `validate_extraction`

If they're missing, run **Command Palette → "MCP: Show Server Logs"** to
debug. Most often the server failed to start because `node_modules` isn't
installed.

## Use It

In agent mode, type:

> Extract data for the retailers in `examples/sample-retailers.csv`. Use
> the `retailer-data-extractor` skill. Write each result to
> `data/output/<row_id>.json`.

The agent will:
1. Read the CSV
2. For each row, call `detect_render_type` → `smart_scrape` → fill the schema
3. Run `validate_extraction` before saving each file
4. Report back with a summary

For a single retailer:

> Extract data for "Bergzeit GmbH" (https://www.bergzeit.de). Save to
> `data/output/bergzeit.json`.

## Debugging the Agent

`.vscode/launch.json` includes four debug configurations:

| Configuration | What it does |
|---|---|
| `Orchestrator: Sample CSV (local mode)` | Run the deterministic pipeline on the sample |
| `Orchestrator: Excel input (Copilot mode)` | Run the LLM pipeline on your Excel |
| `Orchestrator: Dry run` | List rows that *would* be processed |
| `MCP server (debug standalone)` | Attach a debugger to the MCP server process |

## Watching the Browser

To see Playwright actually navigate (useful for debugging dynamic sites):

```bash
PLAYWRIGHT_HEADLESS=false npm run extract:sample
```

Or in `.env`:

```
PLAYWRIGHT_HEADLESS=false
```

## When the Agent Misbehaves

If the agent claims it fetched a URL it didn't, the `validate_extraction`
tool will flag it as a `fabricated_source` issue. Always tell the agent:

> Before you save the record, call `validate_extraction` with the list of
> URLs you actually fetched. If validation fails, fix the record and revalidate.

This is also enforced by `agent-runner.js` after the run, so even if the
agent skips validation, the orchestrator catches the issue and writes
warnings into `data_quality.warnings`.
