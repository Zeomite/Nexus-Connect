import { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get('/live', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  server.get('/ready', async (_request, reply) => {
    const [postgresHealth, redisHealth, kafkaHealth] = await Promise.all([
      server.postgres.healthCheck(),
      server.redis.healthCheck(),
      server.kafka.healthCheck(),
    ]);

    const checks = { postgres: postgresHealth, redis: redisHealth, kafka: kafkaHealth };
    const isHealthy = postgresHealth && redisHealth && kafkaHealth;

    if (isHealthy) {
      return reply.send({ status: 'ok', checks });
    }
    return reply.status(503).send({ status: 'unhealthy', checks });
  });

  server.get('/', async (_request, reply) => {
    return reply.send({
      service: 'user-service',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
};
