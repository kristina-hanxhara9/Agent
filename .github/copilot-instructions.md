# Copilot Instructions — Retailer Data Extractor

These instructions apply to all GitHub Copilot interactions in this repository
(agent mode in VS Code, Copilot chat, and the coding agent on github.com).

## Project Purpose

This repo extracts structured data about retailers (independent stores, chains,
buying groups) from their public websites. The system runs **one isolated
agent per retailer** to prevent cross-contamination and hallucinations.

## Non-Negotiable Rules

1. **Zero hallucinations.** Every non-null field must have a source URL.
   If the data isn't on a page you've fetched, the field is `null`.
2. **One retailer per session.** Never mix data between retailers.
3. **Schema-first.** All output must validate against
   `configs/extraction-schema.json`.
4. **Source traceability.** Only cite URLs you have actually fetched in
   this session.

## Architecture

- `.github/agents/retailer-data-extractor.yaml` — Custom agent definition
- `.claude/skills/retailer-data-extractor/SKILL.md` — Extraction logic & rules
- `src/orchestrator.js` — Reads Excel input, dispatches one agent per row
- `src/scrapers/` — Smart scraping (auto-detects HTML / JS / API)
- `src/validators/` — Schema + hallucination checks
- `src/mcp-server/` — MCP server exposing scraping tools to VS Code agent mode

## Coding Conventions

- ES modules (`"type": "module"` in package.json)
- Node 20+
- No comments unless the *why* is non-obvious
- Errors throw — don't swallow them
- Concurrency via `p-limit` (default 5 concurrent agents)

## When Adding Features

- Update `configs/extraction-schema.json` if you add output fields
- Update `.claude/skills/retailer-data-extractor/SKILL.md` if you change rules
- Add a test in `tests/` for new scrapers or validators
