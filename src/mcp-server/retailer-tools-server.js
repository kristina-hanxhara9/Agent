#!/usr/bin/env node
// MCP server exposing retailer-extraction tools to VS Code agent mode.
//
// Configured in .vscode/mcp.json — VS Code launches this process and
// communicates via stdio. Each tool wraps a function from src/scrapers/
// or src/validators/ so the LLM can call them directly during agent runs.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { smartScrape, detectRenderType } from '../scrapers/index.js';
import { findApiEndpoints } from '../scrapers/detector.js';
import { extractStructuredData } from '../scrapers/structured-data.js';
import { validateRecord } from '../validators/index.js';
import { closeBrowser } from '../scrapers/dynamic-scraper.js';

const TOOLS = [
  {
    name: 'detect_render_type',
    description: 'Classify a URL as static HTML, JavaScript-heavy SPA, API-based, or hybrid. Always call this BEFORE smart_scrape so you know which strategy to use.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri', description: 'Page URL to classify' },
      },
    },
  },
  {
    name: 'smart_scrape',
    description: 'Fetch a URL using the optimal strategy (Cheerio for static HTML, Playwright for JS-heavy sites, undici for APIs). Returns HTML, text, structured data (JSON-LD, OpenGraph, Microdata), and discovered links.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri' },
        renderType: {
          type: 'string',
          enum: ['static', 'dynamic', 'api', 'hybrid'],
          description: 'Optional override; otherwise auto-detected',
        },
        waitForSelector: {
          type: 'string',
          description: 'CSS selector to wait for (Playwright only)',
        },
        acceptLanguage: {
          type: 'string',
          description: 'Accept-Language header (e.g. "de-DE,de;q=0.9")',
        },
      },
    },
  },
  {
    name: 'extract_structured_data',
    description: 'Parse JSON-LD, Microdata, OpenGraph, and Schema.org markup from raw HTML. Use after smart_scrape to get high-confidence structured fields.',
    inputSchema: {
      type: 'object',
      required: ['html'],
      properties: {
        html: { type: 'string' },
      },
    },
  },
  {
    name: 'find_api_endpoints',
    description: 'Scan a page\'s HTML/JS for likely API endpoints (/api/, /graphql, /wp-json/, /_next/data/). Useful when a site is JS-heavy and you want to bypass rendering by hitting the API directly.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri' },
      },
    },
  },
  {
    name: 'validate_extraction',
    description: 'Validate a candidate extraction record against the schema and check for hallucinations (unsourced claims, fabricated source URLs).',
    inputSchema: {
      type: 'object',
      required: ['record'],
      properties: {
        record: { type: 'object', description: 'The extraction record to validate' },
        fetchedUrls: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of URLs actually fetched in this session',
        },
      },
    },
  },
];

const server = new Server(
  { name: 'retailer-tools-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await executeTool(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${err.message}` }],
      isError: true,
    };
  }
});

async function executeTool(name, args) {
  switch (name) {
    case 'detect_render_type': {
      const renderType = await detectRenderType(args.url);
      return { url: args.url, renderType };
    }
    case 'smart_scrape': {
      const result = await smartScrape(args.url, {
        renderType: args.renderType,
        waitForSelector: args.waitForSelector,
        acceptLanguage: args.acceptLanguage,
      });
      return {
        url: args.url,
        finalUrl: result.finalUrl,
        renderType: result.renderType,
        status: result.status,
        title: result.title,
        metaDescription: result.metaDescription,
        text: result.text?.slice(0, 50000),
        textTruncated: (result.text?.length || 0) > 50000,
        structuredData: result.structuredData,
        links: result.links?.slice(0, 50),
        apiCallsObserved: result.apiCallsObserved?.slice(0, 20),
        method: result.method,
        fetchedAt: result.fetchedAt,
      };
    }
    case 'extract_structured_data': {
      return extractStructuredData(args.html);
    }
    case 'find_api_endpoints': {
      const endpoints = await findApiEndpoints(args.url);
      return { url: args.url, endpoints };
    }
    case 'validate_extraction': {
      return validateRecord(args.record, { fetchedUrls: args.fetchedUrls || [] });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async () => {
  await closeBrowser().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.stderr.write('retailer-tools MCP server ready (stdio)\n');
