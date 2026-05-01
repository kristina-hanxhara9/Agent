import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export function writeRetailerOutput(outputDir, rowId, data) {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  const file = join(outputDir, `${rowId}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

export function aggregateOutputs(outputDir, aggregateFile) {
  if (!existsSync(outputDir)) {
    return { count: 0, file: aggregateFile };
  }

  const files = readdirSync(outputDir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_'),
  );

  const records = [];
  const errors = [];

  for (const file of files) {
    const filePath = join(outputDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      records.push(parsed);
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }

  const aggregate = {
    aggregated_at: new Date().toISOString(),
    record_count: records.length,
    error_count: errors.length,
    errors,
    records,
  };

  mkdirSync(dirname(aggregateFile), { recursive: true });
  writeFileSync(aggregateFile, JSON.stringify(aggregate, null, 2), 'utf-8');

  return { count: records.length, file: aggregateFile, errors };
}
