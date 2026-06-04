import * as mediasoup from 'mediasoup';
import { types as MediasoupTypes } from 'mediasoup';
import { createLogger } from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'media-service:workers' });

export class MediaWorkerManager {
  private workers: MediasoupTypes.Worker[] = [];
  private routers: Map<string, MediasoupTypes.Router> = new Map();
  private nextWorkerIdx = 0;

  async createWorkers(numWorkers: number): Promise<void> {
    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: config.mediasoup.workerSettings.logLevel,
        logTags: config.mediasoup.workerSettings.logTags as unknown as MediasoupTypes.WorkerLogTag[],
        rtcMinPort: config.mediasoup.workerSettings.rtcMinPort,
        rtcMaxPort: config.mediasoup.workerSettings.rtcMaxPort,
      });

      worker.on('died', (error) => {
        logger.error({ error, workerId: worker.pid }, 'mediasoup worker died');
        // In production, restart the worker
      });

      this.workers.push(worker);
      logger.info({ pid: worker.pid }, 'mediasoup worker created');
    }
  }

  getWorkerCount(): number {
    return this.workers.length;
  }

  private getNextWorker(): MediasoupTypes.Worker {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  async getOrCreateRouter(roomId: string): Promise<MediasoupTypes.Router> {
    let router = this.routers.get(roomId);
    if (router) {
      return router;
    }

    const worker = this.getNextWorker();
    router = await worker.createRouter({
      mediaCodecs: config.mediasoup.routerMediaCodecs as MediasoupTypes.RtpCodecCapability[],
    });

    this.routers.set(roomId, router);

    router.on('workerclose', () => {
      this.routers.delete(roomId);
    });

    logger.info({ roomId, routerId: router.id }, 'Router created');

    return router;
  }

  async createWebRtcTransport(
    router: MediasoupTypes.Router,
    direction: 'send' | 'recv'
  ): Promise<MediasoupTypes.WebRtcTransport> {
    const transport = await router.createWebRtcTransport({
      listenIps: config.mediasoup.webRtcTransportOptions.listenIps as MediasoupTypes.TransportListenIp[],
      initialAvailableOutgoingBitrate:
        config.mediasoup.webRtcTransportOptions.initialAvailableOutgoingBitrate,
      minimumAvailableOutgoingBitrate:
        config.mediasoup.webRtcTransportOptions.minimumAvailableOutgoingBitrate,
      maxSctpMessageSize: config.mediasoup.webRtcTransportOptions.maxSctpMessageSize,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    if (config.mediasoup.webRtcTransportOptions.maxIncomingBitrate) {
      await transport.setMaxIncomingBitrate(
        config.mediasoup.webRtcTransportOptions.maxIncomingBitrate
      );
    }

    logger.info({ transportId: transport.id, direction }, 'WebRTC transport created');

    return transport;
  }

  async closeRouter(roomId: string): Promise<void> {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
      logger.info({ roomId }, 'Router closed');
    }
  }

  async closeAll(): Promise<void> {
    for (const router of this.routers.values()) {
      router.close();
    }
    this.routers.clear();

    for (const worker of this.workers) {
      worker.close();
    }
    this.workers = [];

    logger.info('All workers closed');
  }
}
