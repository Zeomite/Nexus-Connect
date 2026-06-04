import pino from 'pino';

export interface LoggerOptions {
  serviceName: string;
  level?: string;
  prettyPrint?: boolean;
}

// Check if we should use pretty printing (only in development with pino-pretty available)
const shouldUsePrettyPrint = (): boolean => {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
};

export const createLogger = (options: LoggerOptions): pino.Logger => {
  const { serviceName, level = 'info', prettyPrint = shouldUsePrettyPrint() } = options;

  return pino({
    name: serviceName,
    level,
    transport: prettyPrint
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    base: {
      service: serviceName,
      env: process.env.NODE_ENV || 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: ['password', 'token', 'refreshToken', 'accessToken', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
  });
};

// Default logger for shared package
export const logger = createLogger({ serviceName: 'nexus-shared' });

// Request context for distributed tracing
export interface RequestContext {
  requestId: string;
  correlationId?: string;
  userId?: string;
  traceId?: string;
  spanId?: string;
}

export const createRequestLogger = (baseLogger: pino.Logger, context: RequestContext): pino.Logger => {
  return baseLogger.child({
    requestId: context.requestId,
    correlationId: context.correlationId,
    userId: context.userId,
    traceId: context.traceId,
    spanId: context.spanId,
  });
};
