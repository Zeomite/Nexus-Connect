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
import { callRoutes } from './routes/call.routes';
import { signalingHandler } from './websocket/signaling';
import { notificationsHandler } from './websocket/notifications';
import { healthRoutes } from './routes/health.routes';
import { SignalingManager } from './websocket/signaling-manager';
import { NotificationManager } from './websocket/notification-manager';
import { CallConsumer } from './consumers/call.consumer';
import { config } from './config';

const logger = createLogger({ serviceName: 'call-signaling-service' });

export const buildServer = async (): Promise<FastifyInstance> => {
  const server = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: true,
  });

  const postgres = createPostgresClient('call-signaling-service');
  const redis = createRedisClient('call-signaling-service', 'call:');
  const kafka = createKafkaClient('call-signaling-service');

  await redis.connect();
  await kafka.initProducer();

  // Initialize signaling manager
  const signalingManager = new SignalingManager(redis, kafka);

  // Initialize notification manager for push notifications
  const notificationManager = new NotificationManager();

  // Initialize Kafka consumer with notification manager for push notifications
  const callConsumer = new CallConsumer(kafka, signalingManager, notificationManager);
  await callConsumer.start();

  // Plugins
  await server.register(cors, { origin: config.corsOrigins, credentials: true });
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(sensible);
  await server.register(websocket, {
    options: {
      maxPayload: 64 * 1024, // 64KB for signaling messages
      clientTracking: true,
    },
  });

  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Call Signaling Service API',
        description: 'WebRTC signaling for calls',
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
  server.decorate('signalingManager', signalingManager);
  server.decorate('notificationManager', notificationManager);

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
  await server.register(callRoutes, { prefix: '/api/v1/calls' });
  await server.register(signalingHandler, { prefix: '/ws' });
  await server.register(notificationsHandler, { prefix: '/ws' });

  // Cleanup
  server.addHook('onClose', async () => {
    await callConsumer.stop();
    await postgres.close();
    await redis.close();
    await kafka.close();
    signalingManager.closeAll();
    notificationManager.closeAll();
  });

  return server;
};

declare module 'fastify' {
  interface FastifyInstance {
    postgres: ReturnType<typeof createPostgresClient>;
    redis: ReturnType<typeof createRedisClient>;
    kafka: ReturnType<typeof createKafkaClient>;
    signalingManager: SignalingManager;
    notificationManager: NotificationManager;
  }
}
