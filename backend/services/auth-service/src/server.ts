import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {
  createLogger,
  createPostgresClient,
  createRedisClient,
  createKafkaClient,
  AppError,
} from '@nexus/shared';
import { authRoutes } from './routes/auth.routes';
import { healthRoutes } from './routes/health.routes';
import { config } from './config';

const logger = createLogger({ serviceName: 'auth-service' });

export const buildServer = async (): Promise<FastifyInstance> => {
  const server = Fastify({
    logger: false, // Using custom logger
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: true,
  });

  // Initialize database clients
  const postgres = createPostgresClient('auth-service');
  const redis = createRedisClient('auth-service', 'auth:');
  const kafka = createKafkaClient('auth-service');

  // Connect to Redis
  await redis.connect();

  // Initialize Kafka producer
  await kafka.initProducer();

  // Register plugins
  await server.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await server.register(helmet, {
    contentSecurityPolicy: false,
  });

  await server.register(sensible);

  // Swagger documentation
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Auth Service API',
        description: 'Authentication and authorization service for Nexus',
        version: '1.0.0',
      },
      servers: [
        { url: `http://localhost:${config.port}`, description: 'Development' },
      ],
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

  await server.register(swaggerUI, {
    routePrefix: '/docs',
  });

  // Decorate with clients
  server.decorate('postgres', postgres);
  server.decorate('redis', redis);
  server.decorate('kafka', kafka);

  // Request logging
  server.addHook('onRequest', async (request) => {
    (request as any).log = logger.child({
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
    request.log.info('Incoming request');
  });

  server.addHook('onResponse', async (request, reply) => {
    request.log.info(
      { statusCode: reply.statusCode, responseTime: reply.elapsedTime },
      'Request completed'
    );
  });

  // Error handler
  server.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ error: error.toJSON() }, 'Application error');
      return reply.status(error.statusCode).send(error.toJSON());
    }

    request.log.error({ error }, 'Unhandled error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  // Register routes
  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(authRoutes, { prefix: '/api/v1/auth' });

  // Cleanup on close
  server.addHook('onClose', async () => {
    await postgres.close();
    await redis.close();
    await kafka.close();
    logger.info('Connections closed');
  });

  return server;
};

// Type declarations for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    postgres: ReturnType<typeof createPostgresClient>;
    redis: ReturnType<typeof createRedisClient>;
    kafka: ReturnType<typeof createKafkaClient>;
  }
}
