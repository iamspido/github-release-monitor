/**
 * Server-side logger with levels and scope, formatted as:
 * [YYYY-MM-DDTHH:mm:ss±HH:MM] [Scope] Message
 *
 * - Levels: error, warn, info, debug, silent
 * - Default level: debug (development), warn (production)
 * - Timezone: uses the server/process timezone. If TZ is set at process start,
 *   Node will apply it. Otherwise, Node's system default is used; effectively
 *   this falls back to UTC on many containers.
 * - Internally delegates to console.* so existing console spies in tests keep working.
 */

type LevelName = 'error' | 'warn' | 'info' | 'debug' | 'silent';

const LEVEL_ORDER: Record<LevelName, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  silent: 4,
};

function defaultLevel(): LevelName {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'production' ? 'warn' : 'debug';
}

function parseLevel(input: string | undefined): LevelName {
  if (!input) return defaultLevel();
  const v = input.toLowerCase().trim();
  if (v === 'none') return 'silent';
  if (v === 'verbose') return 'debug';
  if (v in LEVEL_ORDER) return v as LevelName;
  return defaultLevel();
}

const ACTIVE_LEVEL: LevelName = parseLevel(process.env.LOG_LEVEL);

function shouldLog(level: LevelName): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[ACTIVE_LEVEL];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Formats a local timestamp using the process timezone with numeric UTC offset.
function formatLocalTimestamp(d = new Date()): string {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  // getTimezoneOffset returns minutes to add to local time to get UTC
  // e.g., Europe/Berlin in summer => -120 (UTC+02:00)
  const offsetMin = d.getTimezoneOffset();
  const sign = offsetMin <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = pad2(Math.floor(abs / 60));
  const offM = pad2(abs % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offH}:${offM}`;
}

export interface Logger {
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  withScope: (scope: string) => Logger;
}

function emit(level: Exclude<LevelName, 'silent'>, scope: string, message: string, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const ts = formatLocalTimestamp();
  const lvl = level.toUpperCase();
  const line = `[${ts}] [${lvl}] [${scope}] ${message}`;
  switch (level) {
    case 'error':
      // eslint-disable-next-line no-console
      console.error(line, ...args);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(line, ...args);
      break;
    case 'info':
      // eslint-disable-next-line no-console
      console.log(line, ...args);
      break;
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug ? console.debug(line, ...args) : console.log(line, ...args);
      break;
  }
}

function makeLogger(scope = 'App'): Logger {
  return {
    error: (message, ...args) => emit('error', scope, message, args),
    warn: (message, ...args) => emit('warn', scope, message, args),
    info: (message, ...args) => emit('info', scope, message, args),
    debug: (message, ...args) => emit('debug', scope, message, args),
    withScope: (s: string) => makeLogger(s || scope),
  };
}

export const logger: Logger = makeLogger();

// For tests or runtime introspection if ever needed
export const __internal = { ACTIVE_LEVEL };
