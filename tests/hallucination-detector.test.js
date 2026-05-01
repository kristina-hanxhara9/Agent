import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { detectHallucinations } from '../src/validators/hallucination-detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleOutput = JSON.parse(
  readFileSync(resolve(__dirname, '../examples/sample-output.json'), 'utf-8'),
);

test('clean record produces no high/critical issues', () => {
  const result = detectHallucinations(sampleOutput, {
    fetchedUrls: sampleOutput.sources.map((s) => s.url),
  });
  assert.equal(result.summary.critical, 0);
  assert.equal(result.summary.high, 0);
});

test('detects unsourced field', () => {
  const broken = JSON.parse(JSON.stringify(sampleOutput));
  broken.company.legal_name = 'Made Up Inc.';
  for (const source of broken.sources) {
    source.contributed_fields = source.contributed_fields.filter(
      (f) => f !== 'company.legal_name',
    );
  }
  const result = detectHallucinations(broken, {
    fetchedUrls: broken.sources.map((s) => s.url),
  });
  assert.ok(
    result.issues.some((i) => i.type === 'unsourced_field' && i.path === 'company.legal_name'),
  );
});

test('detects fabricated source URL', () => {
  const broken = JSON.parse(JSON.stringify(sampleOutput));
  broken.sources.push({
    url: 'https://fabricated-source-that-was-never-fetched.example/about',
    fetched_at: new Date().toISOString(),
    render_type: 'static',
    contributed_fields: ['company.legal_name'],
    page_type: 'about',
  });
  const result = detectHallucinations(broken, {
    fetchedUrls: sampleOutput.sources.map((s) => s.url),
  });
  assert.ok(
    result.issues.some(
      (i) => i.type === 'fabricated_source' && i.url.includes('fabricated-source'),
    ),
  );
});

test('detects record with data but no sources', () => {
  const broken = JSON.parse(JSON.stringify(sampleOutput));
  broken.sources = [];
  const result = detectHallucinations(broken, { fetchedUrls: [] });
  assert.ok(result.issues.some((i) => i.type === 'no_sources'));
});
