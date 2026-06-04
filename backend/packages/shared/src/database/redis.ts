import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  retryDelayOnFailover?: number;
}

export class RedisClient {
  private client: Redis;
  private subscriber: Redis | null = null;
  private serviceName: string;

  constructor(config: RedisConfig, serviceName: string = 'unknown') {
    this.serviceName = serviceName;

    const options: RedisOptions = {
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db || 0,
      keyPrefix: config.keyPrefix,
      maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error({ service: this.serviceName }, 'Redis connection failed after 10 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    };

    this.client = new Redis(options);

    this.client.on('error', (err) => {
      logger.error({ err, service: this.serviceName }, 'Redis connection error');
    });

    this.client.on('connect', () => {
      logger.info({ service: this.serviceName }, 'Redis connected');
    });

    this.client.on('ready', () => {
      logger.info({ service: this.serviceName }, 'Redis ready');
    });
  }

  // Connect to Redis
  async connect(): Promise<void> {
    await this.client.connect();
  }

  // Get raw client for advanced operations
  getClient(): Redis {
    return this.client;
  }

  // Create subscriber client for pub/sub
  createSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate();
    }
    return this.subscriber;
  }

  // Basic operations
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string | string[]): Promise<number> {
    return this.client.del(...(Array.isArray(key) ? key : [key]));
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // JSON operations
  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.set(key, serialized, ttlSeconds);
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, field: string | string[]): Promise<number> {
    return this.client.hdel(key, ...(Array.isArray(field) ? field : [field]));
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    await this.client.ltrim(key, start, stop);
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.client.zrem(key, member);
  }

  // Pub/Sub
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  // Increment operations
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.client.incrby(key, increment);
  }

  // Atomic operations with Lua scripts
  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  // Key pattern search (use sparingly, prefer scan for production)
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  // Pipeline for batch operations
  pipeline(): ReturnType<Redis['pipeline']> {
    return this.client.pipeline();
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  // Close connection
  async close(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    await this.client.quit();
    logger.info({ service: this.serviceName }, 'Redis connection closed');
  }
}

// Create Redis client from environment variables
export const createRedisClient = (serviceName: string, keyPrefix?: string): RedisClient => {
  const config: RedisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix,
  };

  return new RedisClient(config, serviceName);
};

// Session storage keys
export const SessionKeys = {
  userSession: (userId: string) => `session:user:${userId}`,
  refreshToken: (token: string) => `refresh:${token}`,
  emailVerification: (token: string) => `email_verify:${token}`,
  passwordReset: (token: string) => `password_reset:${token}`,
  userStatus: (userId: string) => `status:${userId}`,
  userConnections: (userId: string) => `connections:${userId}`,
  callRoom: (roomId: string) => `call:room:${roomId}`,
  callParticipants: (callId: string) => `call:participants:${callId}`,
  typingIndicator: (chatId: string, userId: string) => `typing:${chatId}:${userId}`,
  onlineUsers: () => 'online:users',
  rateLimitKey: (identifier: string, action: string) => `ratelimit:${action}:${identifier}`,
};
