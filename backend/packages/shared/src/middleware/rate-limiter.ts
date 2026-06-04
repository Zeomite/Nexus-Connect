import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { RedisClient, SessionKeys } from '../database/redis';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum requests per window
  keyPrefix?: string;
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
  keyGenerator?: (request: FastifyRequest) => string;
  skip?: (request: FastifyRequest) => boolean;
  onRateLimit?: (request: FastifyRequest, reply: FastifyReply) => void;
}

export interface RateLimitPluginOptions {
  redis: RedisClient;
  defaultConfig?: Partial<RateLimitConfig>;
}

// Sliding window rate limiter using Redis
export class RateLimiter {
  private redis: RedisClient;
  private config: RateLimitConfig;

  constructor(redis: RedisClient, config: RateLimitConfig) {
    this.redis = redis;
    this.config = {
      keyPrefix: 'ratelimit',
      skipFailedRequests: false,
      skipSuccessfulRequests: false,
      ...config,
    };
  }

  async check(identifier: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  }> {
    const key = SessionKeys.rateLimitKey(identifier, this.config.keyPrefix || 'default');
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Lua script for atomic sliding window rate limiting
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local ttl = tonumber(ARGV[4])
      
      -- Remove old entries outside the window
      redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
      
      -- Count current requests in window
      local count = redis.call('ZCARD', key)
      
      if count < limit then
        -- Add new request
        redis.call('ZADD', key, now, now .. '-' .. math.random())
        redis.call('PEXPIRE', key, ttl)
        return {1, limit - count - 1, now + window}
      else
        -- Get oldest entry to calculate reset time
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local resetTime = oldest[2] and (tonumber(oldest[2]) + window) or (now + window)
        return {0, 0, resetTime}
      end
    `;

    const result = await this.redis.eval(
      script,
      [key],
      [now, this.config.windowMs, this.config.max, this.config.windowMs + 1000]
    ) as [number, number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];
    const resetTime = result[2];

    return {
      allowed,
      remaining,
      resetTime,
      retryAfter: allowed ? undefined : Math.ceil((resetTime - now) / 1000),
    };
  }

  async increment(identifier: string): Promise<void> {
    const key = SessionKeys.rateLimitKey(identifier, this.config.keyPrefix || 'default');
    const now = Date.now();

    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, Math.ceil(this.config.windowMs / 1000) + 1);
  }
}

// Rate limit plugin for Fastify
export const rateLimitPlugin: FastifyPluginAsync<RateLimitPluginOptions> = async (fastify, options) => {
  const { redis, defaultConfig } = options;

  // Create default rate limiter
  const defaultLimiter = new RateLimiter(redis, {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    ...defaultConfig,
  });

  // Add rate limit decorator
  fastify.decorate('rateLimiter', defaultLimiter);

  // Add rate limit hook (skip in development)
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip rate limiting in development
    if (process.env.NODE_ENV === 'development') {
      return;
    }

    // Get identifier (IP or user ID)
    const identifier = request.user?.userId || request.ip || 'unknown';

    const result = await defaultLimiter.check(identifier);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', defaultConfig?.max || 100);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetTime);

    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter);
      throw new RateLimitError(result.retryAfter);
    }
  });
};

export default fp(rateLimitPlugin, {
  name: 'rate-limit-plugin',
  fastify: '4.x',
});

// Pre-configured rate limiters for different use cases
export const createAuthRateLimiter = (redis: RedisClient): RateLimiter => {
  return new RateLimiter(redis, {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    keyPrefix: 'auth',
  });
};

export const createLoginRateLimiter = (redis: RedisClient): RateLimiter => {
  return new RateLimiter(redis, {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 login attempts
    keyPrefix: 'login',
  });
};

export const createApiRateLimiter = (redis: RedisClient): RateLimiter => {
  return new RateLimiter(redis, {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests
    keyPrefix: 'api',
  });
};

export const createMessageRateLimiter = (redis: RedisClient): RateLimiter => {
  return new RateLimiter(redis, {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 messages per minute
    keyPrefix: 'message',
  });
};

export const createCallRateLimiter = (redis: RedisClient): RateLimiter => {
  return new RateLimiter(redis, {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 call attempts
    keyPrefix: 'call',
  });
};

// Middleware for specific routes
export const createRateLimitMiddleware = (limiter: RateLimiter) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip rate limiting in development
    if (process.env.NODE_ENV === 'development') {
      return;
    }

    const identifier = request.user?.userId || request.ip || 'unknown';
    const result = await limiter.check(identifier);

    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetTime);

    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter);
      logger.warn(
        { identifier, retryAfter: result.retryAfter },
        'Rate limit exceeded'
      );
      throw new RateLimitError(result.retryAfter);
    }
  };
};
