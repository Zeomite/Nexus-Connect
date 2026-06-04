import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createLogger, createRedisClient, createKafkaClient } from '@nexus/shared';
import { MediaWorkerManager } from './workers/manager';
import { config } from './config';

const logger = createLogger({ serviceName: 'media-service' });

const start = async (): Promise<void> => {
  const server = Fastify({ logger: false });

  const redis = createRedisClient('media-service', 'media:');
  const kafka = createKafkaClient('media-service');

  await redis.connect();
  await kafka.initProducer();

  // Initialize mediasoup workers
  const workerManager = new MediaWorkerManager();
  await workerManager.createWorkers(config.mediasoup.numWorkers);

  await server.register(cors, { origin: config.corsOrigins, credentials: true });

  // Health endpoint
  server.get('/health', async () => ({
    status: 'ok',
    service: 'media-service',
    workers: workerManager.getWorkerCount(),
  }));

  // Get router for a room
  server.post('/rooms/:roomId/router', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const router = await workerManager.getOrCreateRouter(roomId);
    return {
      roomId,
      routerId: router.id,
      rtpCapabilities: router.rtpCapabilities,
    };
  });

  // Create WebRTC transport
  server.post('/rooms/:roomId/transports', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const { direction } = request.body as { direction: 'send' | 'recv' };

    const router = await workerManager.getOrCreateRouter(roomId);
    const transport = await workerManager.createWebRtcTransport(router, direction);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  });

  const port = parseInt(process.env.PORT || '3005', 10);
  await server.listen({ port, host: '0.0.0.0' });

  logger.info({ port }, 'Media service started');

  const shutdown = async (): Promise<void> => {
    await server.close();
    await workerManager.closeAll();
    await redis.close();
    await kafka.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start().catch((error) => {
  logger.error({ error }, 'Failed to start media service');
  process.exit(1);
});
