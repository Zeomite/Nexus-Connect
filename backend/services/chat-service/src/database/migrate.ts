import { createPostgresClient, createLogger } from '@nexus/shared';

const logger = createLogger({ serviceName: 'chat-service:migrate' });

const migrations = [
  {
    name: '001_create_chats_table',
    up: `
      CREATE TABLE IF NOT EXISTS chats (
        id UUID PRIMARY KEY,
        type VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'group')),
        name VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX idx_chats_type ON chats(type);
    `,
    down: `DROP TABLE IF EXISTS chats;`,
  },
  {
    name: '002_create_chat_participants_table',
    up: `
      CREATE TABLE IF NOT EXISTS chat_participants (
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_read_at TIMESTAMP WITH TIME ZONE,
        is_admin BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE INDEX idx_chat_participants_user ON chat_participants(user_id);
      CREATE INDEX idx_chat_participants_chat ON chat_participants(chat_id);
    `,
    down: `DROP TABLE IF EXISTS chat_participants;`,
  },
  {
    name: '003_create_messages_table',
    up: `
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL,
        type VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file', 'audio', 'video', 'system')),
        content TEXT NOT NULL,
        metadata JSONB,
        status VARCHAR(10) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
        reply_to_id UUID REFERENCES messages(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE
      );

      CREATE INDEX idx_messages_chat ON messages(chat_id);
      CREATE INDEX idx_messages_sender ON messages(sender_id);
      CREATE INDEX idx_messages_created ON messages(chat_id, created_at DESC);
      CREATE INDEX idx_messages_status ON messages(chat_id, status);
    `,
    down: `DROP TABLE IF EXISTS messages;`,
  },
];

const runMigrations = async (): Promise<void> => {
  const postgres = createPostgresClient('chat-service:migrate');

  try {
    await postgres.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    const executed = await postgres.query<{ name: string }>('SELECT name FROM migrations');
    const executedNames = new Set(executed.rows.map((r) => r.name));

    for (const migration of migrations) {
      if (executedNames.has(migration.name)) {
        logger.info({ migration: migration.name }, 'Migration already executed, skipping');
        continue;
      }

      logger.info({ migration: migration.name }, 'Running migration');

      await postgres.transaction(async (client) => {
        await client.query(migration.up);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
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

runMigrations()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

export { runMigrations, migrations };
