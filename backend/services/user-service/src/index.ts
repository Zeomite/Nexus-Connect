import { buildServer } from './server';
import { createLogger } from '@nexus/shared';

const logger = createLogger({ serviceName: 'user-service' });

const start = async (): Promise<void> => {
  try {
    const server = await buildServer();

    const port = parseInt(process.env.PORT || '3002', 10);
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });

    logger.info({ port, host }, 'User service started');

    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Received shutdown signal');
      try {
        await server.close();
        logger.info('Server closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start user service');
    process.exit(1);
  }
};

start();
