import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
  createLogger,
  createPostgresClient,
  createKafkaClient,
  authPlugin,
  getCurrentUser,
  PaginationSchema,
  validate,
  KafkaTopics,
  ConsumerGroups,
  CallEventTypes,
  generateTimeOrderedUuid,
} from '@nexus/shared';
import { EachMessagePayload, Consumer } from 'kafkajs';

const logger = createLogger({ serviceName: 'call-history-service' });

const start = async (): Promise<void> => {
  const server = Fastify({ logger: false });

  const postgres = createPostgresClient('call-history-service');
  const kafka = createKafkaClient('call-history-service');

  let consumer: Consumer | null = null;

  // Initialize Kafka consumer for call events
  consumer = await kafka.initConsumer(ConsumerGroups.CALL_HISTORY_SERVICE);

  await kafka.subscribe(
    consumer,
    [KafkaTopics.CALL_EVENTS],
    async (payload: EachMessagePayload) => {
      const event = kafka.parseEvent(payload);
      if (!event) return;

      logger.debug({ eventType: event.eventType }, 'Processing call history event');

      try {
        switch (event.eventType) {
          case CallEventTypes.CALL_ENDED:
            await handleCallEnded(postgres, event.payload as {
              callId: string;
              endedBy: string;
              duration: number;
              participantCount: number;
            });
            break;

          case CallEventTypes.CALL_MISSED:
            await handleCallMissed(postgres, event.payload as {
              callId: string;
              initiatorId: string;
              missedByUserId: string;
              callType: string;
            });
            break;

          case CallEventTypes.CALL_INITIATED:
            await handleCallInitiated(postgres, event.payload as {
              callId: string;
              roomId: string;
              initiatorId: string;
              participantIds: string[];
              callType: string;
              isGroupCall: boolean;
            });
            break;
        }
      } catch (error) {
        logger.error({ error, eventType: event.eventType }, 'Failed to process call history');
      }
    }
  );

  logger.info('Call history consumer started');

  await server.register(cors, { origin: ['http://localhost:3000'], credentials: true });
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(authPlugin, {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret',
    excludePatterns: [/^\/health/],
  });

  server.decorate('postgres', postgres);

  // Health
  server.get('/health', async () => ({ status: 'ok', service: 'call-history-service' }));

  // Get call history
  server.get('/api/v1/history', async (request) => {
    const user = getCurrentUser(request);
    const { page, limit } = validate(PaginationSchema, request.query);

    const offset = (page - 1) * limit;

    const result = await postgres.query<{
      id: string;
      call_id: string;
      direction: string;
      type: string;
      status: string;
      duration: number;
      participant_count: number;
      created_at: Date;
    }>(
      `SELECT id, call_id, direction, type, status, duration, participant_count, created_at
       FROM call_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [user.userId, limit, offset]
    );

    const countResult = await postgres.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM call_history WHERE user_id = $1',
      [user.userId]
    );

    return {
      history: result.rows.map((row) => ({
        id: row.id,
        callId: row.call_id,
        direction: row.direction,
        type: row.type,
        status: row.status,
        duration: row.duration,
        participantCount: row.participant_count,
        createdAt: row.created_at.toISOString(),
      })),
      total: parseInt(countResult?.count || '0', 10),
      page,
      limit,
    };
  });

  // Get call details
  server.get('/api/v1/history/:callId', async (request) => {
    const user = getCurrentUser(request);
    const { callId } = request.params as { callId: string };

    const call = await postgres.queryOne<{
      id: string;
      call_id: string;
      direction: string;
      type: string;
      status: string;
      duration: number;
      participant_count: number;
      created_at: Date;
    }>(
      'SELECT * FROM call_history WHERE call_id = $1 AND user_id = $2',
      [callId, user.userId]
    );

    if (!call) {
      return { error: 'Call not found' };
    }

    // Get participants
    const participants = await postgres.query<{ user_id: string; display_name: string }>(
      `SELECT ch.user_id, u.display_name FROM call_history ch
       INNER JOIN users u ON ch.user_id = u.id
       WHERE ch.call_id = $1`,
      [callId]
    );

    return {
      ...call,
      participants: participants.rows,
    };
  });

  const port = parseInt(process.env.PORT || '3009', 10);
  await server.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Call history service started');

  const shutdown = async (): Promise<void> => {
    await server.close();
    if (consumer) await consumer.disconnect();
    await postgres.close();
    await kafka.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

async function handleCallInitiated(
  postgres: ReturnType<typeof createPostgresClient>,
  payload: {
    callId: string;
    roomId: string;
    initiatorId: string;
    participantIds: string[];
    callType: string;
    isGroupCall: boolean;
  }
): Promise<void> {
  // Create history entry for initiator (outgoing)
  await postgres.query(
    `INSERT INTO call_history (id, call_id, user_id, direction, type, status, participant_count, created_at)
     VALUES ($1, $2, $3, 'outgoing', $4, 'ongoing', $5, NOW())`,
    [generateTimeOrderedUuid(), payload.callId, payload.initiatorId, payload.callType, payload.participantIds.length + 1]
  );

  // Create history entries for participants (incoming)
  for (const participantId of payload.participantIds) {
    await postgres.query(
      `INSERT INTO call_history (id, call_id, user_id, direction, type, status, participant_count, created_at)
       VALUES ($1, $2, $3, 'incoming', $4, 'ringing', $5, NOW())`,
      [generateTimeOrderedUuid(), payload.callId, participantId, payload.callType, payload.participantIds.length + 1]
    );
  }
}

async function handleCallEnded(
  postgres: ReturnType<typeof createPostgresClient>,
  payload: { callId: string; duration: number; participantCount: number }
): Promise<void> {
  await postgres.query(
    `UPDATE call_history SET status = 'answered', duration = $1, participant_count = $2
     WHERE call_id = $3 AND status IN ('ongoing', 'ringing')`,
    [payload.duration, payload.participantCount, payload.callId]
  );
}

async function handleCallMissed(
  postgres: ReturnType<typeof createPostgresClient>,
  payload: { callId: string; missedByUserId: string }
): Promise<void> {
  await postgres.query(
    `UPDATE call_history SET status = 'missed' WHERE call_id = $1 AND user_id = $2`,
    [payload.callId, payload.missedByUserId]
  );
}

start().catch((error) => {
  logger.error({ error }, 'Failed to start call history service');
  process.exit(1);
});
