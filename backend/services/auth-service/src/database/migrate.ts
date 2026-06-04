import { createPostgresClient, createLogger } from '@nexus/shared';

const logger = createLogger({ serviceName: 'auth-service:migrate' });

const migrations = [
  {
    name: '001_create_users_table',
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email VARCHAR(254) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        unique_number VARCHAR(10) NOT NULL UNIQUE,
        display_name VARCHAR(100) NOT NULL,
        profile_picture_url TEXT,
        status VARCHAR(20) DEFAULT 'offline',
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_seen_at TIMESTAMP WITH TIME ZONE
      );

      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_users_unique_number ON users(unique_number);
      CREATE INDEX idx_users_status ON users(status);
    `,
    down: `DROP TABLE IF EXISTS users;`,
  },
  {
    name: '002_create_migrations_table',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `,
    down: `DROP TABLE IF EXISTS migrations;`,
  },
];

const runMigrations = async (): Promise<void> => {
  const postgres = createPostgresClient('auth-service:migrate');

  try {
    // Ensure migrations table exists
    await postgres.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Get executed migrations
    const executed = await postgres.query<{ name: string }>(
      'SELECT name FROM migrations'
    );
    const executedNames = new Set(executed.rows.map((r) => r.name));

    // Run pending migrations
    for (const migration of migrations) {
      if (executedNames.has(migration.name)) {
        logger.info({ migration: migration.name }, 'Migration already executed, skipping');
        continue;
      }

      logger.info({ migration: migration.name }, 'Running migration');

      await postgres.transaction(async (client) => {
        await client.query(migration.up);
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name]
        );
      });

      logger.info({ migration: migration.name }, 'Migration completed');
    }

    logger.info('All migrations completed');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    throw error;
  } finally {
    await postgres.close();
  }
};

// Run if executed directly
runMigrations()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

export { runMigrations, migrations };
