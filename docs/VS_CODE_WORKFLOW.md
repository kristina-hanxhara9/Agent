# Doing Everything from VS Code

Yes — you can run the entire pipeline (local extraction, GitHub Actions
triggering, artifact download, agent-mode interactive runs) without
leaving VS Code. This page maps each task to its one-click entry point.

## TL;DR

| What you want | How |
|---|---|
| Extract retailers locally | Cmd/Ctrl+Shift+P → **Tasks: Run Task** → "Extract: full batch" |
| Try the sample first | "Extract: sample (5 retailers, local mode)" |
| Re-build the Excel | "Export: re-build XLSX from existing JSON outputs" |
| Run via LLM agent (interactive) | Cmd/Ctrl+Shift+I → switch to **Agent** mode |
| Trigger the cloud workflow | "GitHub: trigger extract workflow (manual)" |
| Watch a cloud run | "GitHub: watch latest workflow run" |
| Download cloud results | "GitHub: download spreadsheet from latest run" |
| Debug a single retailer | F5 → "Orchestrator: Sample CSV (local mode)" |

## Three Ways VS Code Runs This

### 1. Terminal + npm scripts (no LLM)

The deterministic local pipeline. Use this for bulk runs, testing, or when
you don't want to spend Copilot tokens.

```bash
npm run extract             # full batch from data/input/retailers.xlsx
npm run extract:sample      # 5-retailer sample
npm run export              # re-build Excel from existing JSON
```

All available as one-click VS Code tasks (`Cmd/Ctrl+Shift+P` →
**Tasks: Run Task**).

### 2. Terminal + `gh` CLI (cloud runs)

Trigger and monitor the GitHub Actions workflow without opening a browser:

```bash
# Trigger
gh workflow run extract-retailer-data.yml \
  -f input_file=data/input/retailers.xlsx \
  -f mode=local

# Watch the latest run live
gh run watch $(gh run list --workflow=extract-retailer-data.yml --limit 1 --json databaseId -q '.[0].databaseId')

# Download artifacts (the spreadsheet) when done
gh run download <run-id> -n retailer-spreadsheet-<run-number> \
  -D ./data/output/from-actions

# View the run in your browser
gh run view <run-id> --web
```

All available as one-click tasks under "GitHub: …".

### 3. Copilot Agent Mode (interactive LLM)

For ad-hoc extraction or when you want the LLM to make judgment calls:

1. Open Copilot Chat: `Cmd/Ctrl+Shift+I`
2. Switch the dropdown from **Ask** → **Agent**
3. The MCP server (`.vscode/mcp.json`) automatically exposes
   `smart_scrape`, `detect_render_type`, `extract_structured_data`,
   `find_api_endpoints`, and `validate_extraction` to the agent
4. Type:

   > Extract data for "Bergzeit GmbH" (https://www.bergzeit.de) using the
   > `retailer-data-extractor` skill. Save to `data/output/bergzeit.json`,
   > then call `validate_extraction` to make sure every field has a source.

The agent uses the same skill (`.claude/skills/retailer-data-extractor/SKILL.md`)
that GitHub Actions uses, so the rules and output schema are identical.

## Common Workflows

### "I want to extract 200 retailers and get an Excel"

```
1. Drop your file at data/input/retailers.xlsx
2. Cmd/Ctrl+Shift+P → Tasks: Run Task → "Extract: full batch"
3. Wait (~10-30 minutes depending on site complexity)
4. Open data/output/retailers-extracted.xlsx
```

### "I want to do this in the cloud, not on my laptop"

```
1. Push your retailers.xlsx to a private branch (or upload via gh api)
2. Tasks: Run Task → "GitHub: trigger extract workflow (manual)"
3. Tasks: Run Task → "GitHub: watch latest workflow run"
4. When done: Tasks: Run Task → "GitHub: download spreadsheet from latest run"
5. The spreadsheet appears in data/output/from-actions/
```

### "One retailer is wrong — let me re-run just that one"

```
1. Tasks: Run Task → "Extract: single row by ID"
2. When prompted, enter the row_id (e.g., "row-00042")
3. Re-run the export to refresh the Excel:
   Tasks: Run Task → "Export: re-build XLSX from existing JSON outputs"
```

### "The agent claimed something I can't find on the site"

```
1. Open data/output/<row_id>.json
2. Look at data_quality.warnings — hallucination detector flags issues here
3. Look at sources[] — every source claims contributed_fields
4. If a field has no contributing source → that's the hallucination
5. Run "Validate: check a single output file" to get the formatted report
```

### "I want the agent to make one decision interactively"

Use Copilot Agent Mode:

> The retailer "Müller" returned ambiguous results (could be Müller drugstore
> chain, Müller sports, or Müller bakery). The country is DE. Which one is
> the actual retailer? Use `smart_scrape` and `search_company_info` to
> investigate, then update `data/output/row-00042.json` with the correct
> match. Validate before saving.

## Authentication

For GitHub Actions tasks (`gh` commands), authenticate once:

```bash
gh auth login
```

Token needs `repo` and `workflow` scopes. The `gh` CLI auto-detects when
you're inside a git repo and targets the right remote.

For Copilot Agent Mode, your VS Code GitHub login is reused — no extra
setup.

## Keyboard Shortcuts (Optional)

Add to your `keybindings.json` for muscle memory:

```json
[
  {
    "key": "cmd+shift+e",
    "command": "workbench.action.tasks.runTask",
    "args": "Extract: full batch (data/input/retailers.xlsx)"
  },
  {
    "key": "cmd+shift+r",
    "command": "workbench.action.tasks.runTask",
    "args": "Export: re-build XLSX from existing JSON outputs"
  },
  {
    "key": "cmd+shift+g",
    "command": "workbench.action.tasks.runTask",
    "args": "GitHub: trigger extract workflow (manual)"
  }
]
```

## What You DO Need Installed

- **VS Code** 1.99+ (for stable Copilot agent mode)
- **Node.js** 20+
- **Playwright Chromium** (`npx playwright install chromium`, run once)
- **GitHub CLI** (`gh`) for the GitHub: tasks — https://cli.github.com/
- **GitHub Copilot extension** for agent mode

## What You DON'T Need

- ❌ A separate terminal app
- ❌ A web browser (everything visible via `gh run view --web` if needed)
- ❌ Python / Docker / databases
- ❌ Any cloud account beyond GitHub
