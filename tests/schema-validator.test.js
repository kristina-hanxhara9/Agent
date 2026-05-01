import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateSchema } from '../src/validators/schema-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleOutput = JSON.parse(
  readFileSync(resolve(__dirname, '../examples/sample-output.json'), 'utf-8'),
);

test('schema validator accepts the sample output', () => {
  const result = validateSchema(sampleOutput);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test('schema validator rejects missing required fields', () => {
  const broken = JSON.parse(JSON.stringify(sampleOutput));
  delete broken.company;
  const result = validateSchema(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('schema validator rejects invalid enum values', () => {
  const broken = JSON.parse(JSON.stringify(sampleOutput));
  broken.business_model.type = 'not_a_valid_type';
  const result = validateSchema(broken);
  assert.equal(result.valid, false);
});

test('schema validator rejects unknown additional properties', () => {
  const broken = JSON.parse(JSON.stringify(sampleOutput));
  broken.company.unauthorized_field = 'oops';
  const result = validateSchema(broken);
  assert.equal(result.valid, false);
});
