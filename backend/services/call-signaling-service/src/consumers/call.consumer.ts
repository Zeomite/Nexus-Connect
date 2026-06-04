import {
  KafkaClient,
  KafkaTopics,
  ConsumerGroups,
  CallEventTypes,
  createLogger,
} from '@nexus/shared';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { SignalingManager } from '../websocket/signaling-manager';
import { NotificationManager } from '../websocket/notification-manager';

const logger = createLogger({ serviceName: 'call-signaling:consumer' });

export class CallConsumer {
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafka: KafkaClient,
    private readonly signalingManager: SignalingManager,
    private readonly notificationManager: NotificationManager
  ) { }

  async start(): Promise<void> {
    this.consumer = await this.kafka.initConsumer(ConsumerGroups.CALL_SERVICE);

    await this.kafka.subscribe(
      this.consumer,
      [KafkaTopics.CALL_EVENTS, KafkaTopics.CALL_SIGNALING],
      this.handleMessage.bind(this)
    );

    logger.info('Call consumer started');
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      logger.info('Call consumer stopped');
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const event = this.kafka.parseEvent(payload);
    if (!event) return;

    logger.debug({ eventType: event.eventType }, 'Processing call event');

    switch (event.eventType) {
      case 'call.incoming':
        await this.handleIncomingCall(event.payload as {
          callId: string;
          roomId: string;
          type: string;
          initiatorId: string;
          recipientId: string;
          isGroupCall: boolean;
        });
        break;

      case CallEventTypes.CALL_ANSWERED:
        // Handle call answered - update room state
        break;

      case CallEventTypes.CALL_DECLINED:
        // Handle call declined
        break;

      case CallEventTypes.CALL_ENDED:
        // Handle call ended
        break;

      default:
        logger.debug({ eventType: event.eventType }, 'Unhandled call event');
    }
  }

  private async handleIncomingCall(payload: {
    callId: string;
    roomId: string;
    type: string;
    initiatorId: string;
    recipientId: string;
    isGroupCall: boolean;
  }): Promise<void> {
    // Push incoming call notification to recipient via WebSocket
    const sent = this.notificationManager.notifyIncomingCall(payload.recipientId, {
      callId: payload.callId,
      roomId: payload.roomId,
      type: payload.type as 'audio' | 'video',
      initiatorId: payload.initiatorId,
      isGroupCall: payload.isGroupCall,
      timestamp: Date.now(),
    });

    if (sent) {
      logger.info(
        { callId: payload.callId, recipientId: payload.recipientId },
        'Incoming call notification pushed via WebSocket'
      );
    } else {
      logger.info(
        { callId: payload.callId, recipientId: payload.recipientId },
        'Recipient offline, incoming call stored in Redis for polling fallback'
      );
    }
  }
}
