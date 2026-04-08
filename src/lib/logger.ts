type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = {
  action: string;
  userId?: string | null;
  householdId?: string | null;
  [key: string]: unknown;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getThreshold(): number {
  return process.env.NODE_ENV === 'production' ? LEVEL_WEIGHT.warn : LEVEL_WEIGHT.debug;
}

function sanitize(context: LogContext, error?: unknown) {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  if (error) {
    payload.error = error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) };
  }

  return payload;
}

function write(level: LogLevel, context: LogContext, error?: unknown) {
  if (typeof window !== 'undefined') return;
  if (LEVEL_WEIGHT[level] < getThreshold()) return;

  const payload = sanitize(context, error);
  if (level === 'error') {
    console.error(payload);
    return;
  }
  if (level === 'warn') {
    console.warn(payload);
    return;
  }
  if (level === 'info') {
    console.info(payload);
    return;
  }
  console.debug(payload);
}

export const logger = {
  debug: (context: LogContext) => write('debug', context),
  info: (context: LogContext) => write('info', context),
  warn: (context: LogContext, error?: unknown) => write('warn', context, error),
  error: (context: LogContext, error?: unknown) => write('error', context, error),
};
