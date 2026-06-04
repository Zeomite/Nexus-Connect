import { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (server) => {
  // Liveness probe
  server.get('/live', {
    schema: {
      description: 'Liveness probe',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  // Readiness probe
  server.get('/ready', {
    schema: {
      description: 'Readiness probe',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                postgres: { type: 'boolean' },
                redis: { type: 'boolean' },
                kafka: { type: 'boolean' },
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: {
              type: 'object',
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const [postgresHealth, redisHealth, kafkaHealth] = await Promise.all([
      server.postgres.healthCheck(),
      server.redis.healthCheck(),
      server.kafka.healthCheck(),
    ]);

    const checks = {
      postgres: postgresHealth,
      redis: redisHealth,
      kafka: kafkaHealth,
    };

    const isHealthy = postgresHealth && redisHealth && kafkaHealth;

    if (isHealthy) {
      return reply.send({ status: 'ok', checks });
    }

    return reply.status(503).send({ status: 'unhealthy', checks });
  });

  // Detailed health check
  server.get('/', {
    schema: {
      description: 'Detailed health check',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            service: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number' },
            timestamp: { type: 'string' },
            checks: {
              type: 'object',
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const [postgresHealth, redisHealth, kafkaHealth] = await Promise.all([
      server.postgres.healthCheck(),
      server.redis.healthCheck(),
      server.kafka.healthCheck(),
    ]);

    return reply.send({
      service: 'auth-service',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: {
        postgres: {
          healthy: postgresHealth,
          stats: server.postgres.getPoolStats(),
        },
        redis: {
          healthy: redisHealth,
        },
        kafka: {
          healthy: kafkaHealth,
        },
      },
    });
  });
};
