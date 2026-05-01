import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../../configs/extraction-schema.json');

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false,
});
addFormats(ajv);

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
const validateFn = ajv.compile(schema);

export function validateSchema(record) {
  const valid = validateFn(record);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validateFn.errors || []).map((err) => ({
    path: err.instancePath || '/',
    message: err.message,
    keyword: err.keyword,
    params: err.params,
  }));

  return { valid: false, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node schema-validator.js <path-to-record.json>');
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(file, 'utf-8'));
  const result = validateSchema(record);
  if (result.valid) {
    console.log('Valid');
    process.exit(0);
  } else {
    console.error('Invalid:');
    for (const err of result.errors) {
      console.error(`  ${err.path}: ${err.message}`);
    }
    process.exit(2);
  }
}
