import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
  createLogger,
  createPostgresClient,
  createKafkaClient,
  authPlugin,
  validate,
  getCurrentUser,
  CreateExpenseSchema,
  RecordSettlementSchema,
  KafkaTopics,
  ExpenseEventTypes,
  generateTimeOrderedUuid,
  ForbiddenError,
} from '@nexus/shared';

const logger = createLogger({ serviceName: 'expense-service' });

const start = async (): Promise<void> => {
  const server = Fastify({ logger: false });

  const postgres = createPostgresClient('expense-service');
  const kafka = createKafkaClient('expense-service');

  await kafka.initProducer();

  await server.register(cors, { origin: ['http://localhost:3000'], credentials: true });
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(authPlugin, {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret',
    excludePatterns: [/^\/health/],
  });

  server.decorate('postgres', postgres);
  server.decorate('kafka', kafka);

  // Health
  server.get('/health', async () => ({ status: 'ok', service: 'expense-service' }));

  // Create expense
  server.post('/api/v1/expenses', async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(CreateExpenseSchema, request.body);

    // Verify user is group member
    const member = await postgres.queryOne(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [input.groupId, user.userId]
    );
    if (!member) throw new ForbiddenError('Not a group member');

    const expenseId = generateTimeOrderedUuid();

    await postgres.transaction(async (client) => {
      // Create expense
      await client.query(
        `INSERT INTO expenses (id, group_id, created_by_id, description, total_amount, currency, split_type, paid_by_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [expenseId, input.groupId, user.userId, input.description, input.totalAmount, input.currency, input.splitType, input.paidById]
      );

      // Calculate and create splits
      if (input.splitType === 'equal') {
        const participantIds = input.participantIds;
        const splitAmount = input.totalAmount / participantIds.length;

        for (const participantId of participantIds) {
          await client.query(
            `INSERT INTO expense_splits (id, expense_id, user_id, amount, is_paid)
             VALUES ($1, $2, $3, $4, $5)`,
            [generateTimeOrderedUuid(), expenseId, participantId, splitAmount, participantId === input.paidById]
          );
        }
      } else if (input.splitType === 'exact') {
        for (const split of input.splits) {
          await client.query(
            `INSERT INTO expense_splits (id, expense_id, user_id, amount, is_paid)
             VALUES ($1, $2, $3, $4, $5)`,
            [generateTimeOrderedUuid(), expenseId, split.userId, split.amount, split.userId === input.paidById]
          );
        }
      } else if (input.splitType === 'percentage') {
        for (const split of input.splits) {
          const amount = (input.totalAmount * split.percentage) / 100;
          await client.query(
            `INSERT INTO expense_splits (id, expense_id, user_id, amount, percentage, is_paid)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [generateTimeOrderedUuid(), expenseId, split.userId, amount, split.percentage, split.userId === input.paidById]
          );
        }
      }

      // Create ledger entries (immutable)
      const splits = input.splitType === 'equal'
        ? input.participantIds.map((id) => ({ userId: id, amount: input.totalAmount / input.participantIds.length }))
        : input.splits.map((s) => ({ userId: s.userId, amount: 'amount' in s ? s.amount : (input.totalAmount * s.percentage) / 100 }));

      for (const split of splits) {
        if (split.userId !== input.paidById) {
          await client.query(
            `INSERT INTO ledger_entries (id, group_id, expense_id, from_user_id, to_user_id, amount, currency, type, description, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'expense', $8, NOW())`,
            [generateTimeOrderedUuid(), input.groupId, expenseId, split.userId, input.paidById, split.amount, input.currency, input.description]
          );
        }
      }
    });

    await kafka.publish(KafkaTopics.EXPENSE_EVENTS, {
      eventType: ExpenseEventTypes.EXPENSE_CREATED,
      payload: { expenseId, groupId: input.groupId, createdById: user.userId, totalAmount: input.totalAmount, currency: input.currency },
    });

    return reply.status(201).send({ id: expenseId });
  });

  // Get group expenses
  server.get('/api/v1/groups/:groupId/expenses', async (request) => {
    const user = getCurrentUser(request);
    const { groupId } = request.params as { groupId: string };

    const member = await postgres.queryOne(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.userId]
    );
    if (!member) throw new ForbiddenError('Not a group member');

    const expenses = await postgres.query<{
      id: string; description: string; total_amount: number; currency: string; split_type: string; created_at: Date;
    }>(
      'SELECT id, description, total_amount, currency, split_type, created_at FROM expenses WHERE group_id = $1 ORDER BY created_at DESC',
      [groupId]
    );

    return { expenses: expenses.rows };
  });

  // Get group balances
  server.get('/api/v1/groups/:groupId/balances', async (request) => {
    const user = getCurrentUser(request);
    const { groupId } = request.params as { groupId: string };

    const member = await postgres.queryOne(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.userId]
    );
    if (!member) throw new ForbiddenError('Not a group member');

    // Calculate net balances from ledger
    const balances = await postgres.query<{
      user_id: string; net_balance: number;
    }>(
      `SELECT 
        user_id,
        COALESCE(SUM(CASE WHEN to_user_id = user_id THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_user_id = user_id THEN amount ELSE 0 END), 0) as net_balance
       FROM ledger_entries, group_members
       WHERE ledger_entries.group_id = $1 AND group_members.group_id = $1
       GROUP BY user_id`,
      [groupId]
    );

    return { balances: balances.rows };
  });

  // Record settlement
  server.post('/api/v1/settlements', async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(RecordSettlementSchema, request.body);

    const member = await postgres.queryOne(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [input.groupId, user.userId]
    );
    if (!member) throw new ForbiddenError('Not a group member');

    const ledgerEntryId = generateTimeOrderedUuid();

    await postgres.query(
      `INSERT INTO ledger_entries (id, group_id, from_user_id, to_user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'settlement', 'Settlement', NOW())`,
      [ledgerEntryId, input.groupId, user.userId, input.toUserId, input.amount, input.currency]
    );

    return reply.status(201).send({ id: ledgerEntryId });
  });

  const port = parseInt(process.env.PORT || '3007', 10);
  await server.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Expense service started');

  const shutdown = async (): Promise<void> => {
    await server.close();
    await postgres.close();
    await kafka.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start().catch((error) => {
  logger.error({ error }, 'Failed to start expense service');
  process.exit(1);
});
