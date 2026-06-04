import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {
  createLogger,
  createPostgresClient,
  createRedisClient,
  createKafkaClient,
  AppError,
  authPlugin,
} from '@nexus/shared';
import { chatRoutes } from './routes/chat.routes';
import { messageRoutes } from './routes/message.routes';
import { websocketHandler } from './websocket/handler';
import { healthRoutes } from './routes/health.routes';
import { WebSocketManager } from './websocket/manager';
import { ChatConsumer } from './consumers/chat.consumer';
import { config } from './config';

const logger = createLogger({ serviceName: 'chat-service' });

export const buildServer = async (): Promise<FastifyInstance> => {
  const server = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: true,
  });

  const postgres = createPostgresClient('chat-service');
  const redis = createRedisClient('chat-service', 'chat:');
  const kafka = createKafkaClient('chat-service');

  await redis.connect();
  await kafka.initProducer();

  // Initialize WebSocket manager
  const wsManager = new WebSocketManager(redis);

  // Initialize Kafka consumer
  const chatConsumer = new ChatConsumer(kafka, wsManager);
  await chatConsumer.start();

  // Plugins
  await server.register(cors, { origin: config.corsOrigins, credentials: true });
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(sensible);
  await server.register(websocket, {
    options: {
      maxPayload: 1024 * 1024, // 1MB
      clientTracking: true,
    },
  });

  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Chat Service API',
        description: 'Real-time messaging service',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await server.register(swaggerUI, { routePrefix: '/docs' });

  // Auth plugin
  await server.register(authPlugin, {
    accessTokenSecret: config.jwt.accessTokenSecret,
    excludePatterns: [/^\/health/, /^\/docs/, /^\/ws/],
  });

  // Decorate
  server.decorate('postgres', postgres);
  server.decorate('redis', redis);
  server.decorate('kafka', kafka);
  server.decorate('wsManager', wsManager);

  // Request logging
  server.addHook('onRequest', async (request) => {
    (request as any).log = logger.child({
      requestId: request.id,
      method: request.method,
      url: request.url,
      userId: request.user?.userId,
    });
  });

  // Error handler
  server.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }
    request.log.error({ error }, 'Unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  // Routes
  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(chatRoutes, { prefix: '/api/v1/chats' });
  await server.register(messageRoutes, { prefix: '/api/v1/messages' });
  await server.register(websocketHandler, { prefix: '/ws' });

  // Cleanup
  server.addHook('onClose', async () => {
    await chatConsumer.stop();
    await postgres.close();
    await redis.close();
    await kafka.close();
    wsManager.closeAll();
  });

  return server;
};

declare module 'fastify' {
  interface FastifyInstance {
    postgres: ReturnType<typeof createPostgresClient>;
    redis: ReturnType<typeof createRedisClient>;
    kafka: ReturnType<typeof createKafkaClient>;
    wsManager: WebSocketManager;
  }
}
