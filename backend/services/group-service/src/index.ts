import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
  createLogger,
  createPostgresClient,
  createRedisClient,
  createKafkaClient,
  authPlugin,
  validate,
  getCurrentUser,
  CreateGroupSchema,
  UpdateGroupSchema,
  KafkaTopics,
  GroupEventTypes,
  generateTimeOrderedUuid,
  NotFoundError,
  ForbiddenError,
  getGroupPermissions,
} from '@nexus/shared';

const logger = createLogger({ serviceName: 'group-service' });

const start = async (): Promise<void> => {
  const server = Fastify({ logger: false });

  const postgres = createPostgresClient('group-service');
  const redis = createRedisClient('group-service', 'group:');
  const kafka = createKafkaClient('group-service');

  await redis.connect();
  await kafka.initProducer();

  await server.register(cors, { origin: ['http://localhost:3000'], credentials: true });
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(authPlugin, {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret',
    excludePatterns: [/^\/health/],
  });

  server.decorate('postgres', postgres);
  server.decorate('redis', redis);
  server.decorate('kafka', kafka);

  // Health
  server.get('/health', async () => ({ status: 'ok', service: 'group-service' }));

  // Create group
  server.post('/api/v1/groups', async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(CreateGroupSchema, request.body);

    const groupId = generateTimeOrderedUuid();
    const members = [...new Set([user.userId, ...(input.memberIds || [])])];

    await postgres.transaction(async (client) => {
      await client.query(
        `INSERT INTO groups (id, name, description, avatar_url, created_by_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [groupId, input.name, input.description || null, input.avatarUrl || null, user.userId]
      );

      for (const memberId of members) {
        await client.query(
          `INSERT INTO group_members (group_id, user_id, role, joined_at, invited_by_id)
           VALUES ($1, $2, $3, NOW(), $4)`,
          [groupId, memberId, memberId === user.userId ? 'owner' : 'member', user.userId]
        );
      }
    });

    await kafka.publish(KafkaTopics.GROUP_EVENTS, {
      eventType: GroupEventTypes.GROUP_CREATED,
      payload: { groupId, name: input.name, createdById: user.userId, memberIds: members },
    });

    return reply.status(201).send({ id: groupId, name: input.name });
  });

  // Get user's groups
  server.get('/api/v1/groups', async (request) => {
    const user = getCurrentUser(request);

    const result = await postgres.query<{ id: string; name: string; role: string }>(
      `SELECT g.id, g.name, gm.role FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [user.userId]
    );

    return { groups: result.rows };
  });

  // Get group by ID
  server.get('/api/v1/groups/:groupId', async (request) => {
    const user = getCurrentUser(request);
    const { groupId } = request.params as { groupId: string };

    const member = await postgres.queryOne<{ role: string }>(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.userId]
    );

    if (!member) throw new ForbiddenError('Not a group member');

    const group = await postgres.queryOne<{ id: string; name: string; description: string }>(
      'SELECT id, name, description FROM groups WHERE id = $1',
      [groupId]
    );

    if (!group) throw new NotFoundError('Group');

    return { ...group, role: member.role, permissions: getGroupPermissions(member.role as any) };
  });

  // Update group
  server.patch('/api/v1/groups/:groupId', async (request) => {
    const user = getCurrentUser(request);
    const { groupId } = request.params as { groupId: string };
    const input = validate(UpdateGroupSchema, request.body);

    const member = await postgres.queryOne<{ role: string }>(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.userId]
    );

    if (!member) throw new ForbiddenError('Not a group member');
    if (!getGroupPermissions(member.role as any).canEditGroup) {
      throw new ForbiddenError('Insufficient permissions');
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name) { updates.push(`name = $${idx++}`); values.push(input.name); }
    if (input.description !== undefined) { updates.push(`description = $${idx++}`); values.push(input.description); }

    if (updates.length > 0) {
      values.push(groupId);
      await postgres.query(
        `UPDATE groups SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        values
      );
    }

    return { message: 'Group updated' };
  });

  // Add member
  server.post('/api/v1/groups/:groupId/members', async (request) => {
    const user = getCurrentUser(request);
    const { groupId } = request.params as { groupId: string };
    const { userId } = request.body as { userId: string };

    const member = await postgres.queryOne<{ role: string }>(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.userId]
    );

    if (!member || !getGroupPermissions(member.role as any).canAddMembers) {
      throw new ForbiddenError('Cannot add members');
    }

    await postgres.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at, invited_by_id)
       VALUES ($1, $2, 'member', NOW(), $3)
       ON CONFLICT DO NOTHING`,
      [groupId, userId, user.userId]
    );

    return { message: 'Member added' };
  });

  // Remove member
  server.delete('/api/v1/groups/:groupId/members/:userId', async (request) => {
    const user = getCurrentUser(request);
    const { groupId, userId } = request.params as { groupId: string; userId: string };

    const member = await postgres.queryOne<{ role: string }>(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.userId]
    );

    if (!member || !getGroupPermissions(member.role as any).canRemoveMembers) {
      throw new ForbiddenError('Cannot remove members');
    }

    await postgres.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    return { message: 'Member removed' };
  });

  const port = parseInt(process.env.PORT || '3006', 10);
  await server.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Group service started');

  const shutdown = async (): Promise<void> => {
    await server.close();
    await postgres.close();
    await redis.close();
    await kafka.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start().catch((error) => {
  logger.error({ error }, 'Failed to start group service');
  process.exit(1);
});
