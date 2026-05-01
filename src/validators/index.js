import { validateSchema } from './schema-validator.js';
import { detectHallucinations } from './hallucination-detector.js';

export function validateRecord(record, options = {}) {
  const schemaResult = validateSchema(record);
  const hallucinationResult = detectHallucinations(record, options);

  const acceptable =
    schemaResult.valid &&
    hallucinationResult.summary.critical === 0 &&
    hallucinationResult.summary.high <= (options.maxHighSeverityIssues ?? 0);

  return {
    acceptable,
    schema: schemaResult,
    hallucinations: hallucinationResult,
  };
}

export { validateSchema, detectHallucinations };
