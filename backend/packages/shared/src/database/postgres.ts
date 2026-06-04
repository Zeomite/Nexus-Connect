import { Pool, PoolClient, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

export interface PostgresConfig extends PoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class PostgresClient {
  private pool: Pool;
  private serviceName: string;

  constructor(config: PostgresConfig, serviceName: string = 'unknown') {
    this.serviceName = serviceName;
    this.pool = new Pool({
      ...config,
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 5000,
    });

    this.pool.on('error', (err) => {
      logger.error({ err, service: this.serviceName }, 'Unexpected error on idle PostgreSQL client');
    });

    this.pool.on('connect', () => {
      logger.debug({ service: this.serviceName }, 'New PostgreSQL client connected');
    });
  }

  // Get a client from the pool
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  // Execute a query
  async query<T = unknown>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug({ duration, rowCount: result.rowCount, service: this.serviceName }, 'Query executed');
      return { rows: result.rows as T[], rowCount: result.rowCount };
    } catch (error) {
      const duration = Date.now() - start;
      logger.error({ error, duration, text, service: this.serviceName }, 'Query failed');
      throw error;
    }
  }

  // Execute a query and return single row
  async queryOne<T = unknown>(text: string, params?: unknown[]): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] || null;
  }

  // Execute a transaction
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // Close the pool
  async close(): Promise<void> {
    await this.pool.end();
    logger.info({ service: this.serviceName }, 'PostgreSQL pool closed');
  }

  // Get pool statistics
  getPoolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }
}

// Create PostgreSQL client from environment variables
export const createPostgresClient = (serviceName: string): PostgresClient => {
  const config: PostgresConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'nexus',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: parseInt(process.env.POSTGRES_POOL_MAX || '20', 10),
  };

  return new PostgresClient(config, serviceName);
};
