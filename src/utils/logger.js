import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = process.env.LOG_DIR || './data/logs';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE_LEVEL = LEVELS[LOG_LEVEL] ?? LEVELS.info;

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

const logFile = join(LOG_DIR, `extraction-${new Date().toISOString().split('T')[0]}.log`);

function write(level, event, data) {
  if (LEVELS[level] < ACTIVE_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data || {}),
  };

  const line = JSON.stringify(entry);
  const consoleLine = `[${entry.ts}] ${level.toUpperCase()} ${event} ${data ? JSON.stringify(data) : ''}`;

  if (level === 'error') {
    process.stderr.write(consoleLine + '\n');
  } else if (LOG_LEVEL === 'debug' || level !== 'debug') {
    process.stdout.write(consoleLine + '\n');
  }

  try {
    appendFileSync(logFile, line + '\n');
  } catch {
    // file logging is best-effort
  }
}

export const logger = {
  debug: (event, data) => write('debug', event, data),
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
};
