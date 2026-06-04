import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import {
  createLogger,
  createPostgresClient,
  createRedisClient,
  createKafkaClient,
  AppError,
  authPlugin,
} from '@nexus/shared';
import { userRoutes } from './routes/user.routes';
import { searchRoutes } from './routes/search.routes';
import { healthRoutes } from './routes/health.routes';
import { config } from './config';

const logger = createLogger({ serviceName: 'user-service' });

export const buildServer = async (): Promise<FastifyInstance> => {
  const server = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: true,
  });

  const postgres = createPostgresClient('user-service');
  const redis = createRedisClient('user-service', 'user:');
  const kafka = createKafkaClient('user-service');

  await redis.connect();
  await kafka.initProducer();

  // Plugins
  await server.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(sensible);
  await server.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  });

  await server.register(swagger, {
    openapi: {
      info: {
        title: 'User Service API',
        description: 'User profile and status management',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await server.register(swaggerUI, { routePrefix: '/docs' });

  // Auth plugin (excludes health routes)
  await server.register(authPlugin, {
    accessTokenSecret: config.jwt.accessTokenSecret,
    excludePatterns: [/^\/health/, /^\/docs/],
  });

  // Decorate
  server.decorate('postgres', postgres);
  server.decorate('redis', redis);
  server.decorate('kafka', kafka);

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
  await server.register(userRoutes, { prefix: '/api/v1/users' });
  await server.register(searchRoutes, { prefix: '/api/v1/search' });

  // Cleanup
  server.addHook('onClose', async () => {
    await postgres.close();
    await redis.close();
    await kafka.close();
  });

  return server;
};

declare module 'fastify' {
  interface FastifyInstance {
    postgres: ReturnType<typeof createPostgresClient>;
    redis: ReturnType<typeof createRedisClient>;
    kafka: ReturnType<typeof createKafkaClient>;
  }
}
