import {
  KafkaClient,
  KafkaTopics,
  ConsumerGroups,
  ChatEventTypes,
  createLogger,
} from '@nexus/shared';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { WebSocketManager } from '../websocket/manager';

const logger = createLogger({ serviceName: 'chat-service:consumer' });

export class ChatConsumer {
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafka: KafkaClient,
    private readonly wsManager: WebSocketManager
  ) {}

  async start(): Promise<void> {
    this.consumer = await this.kafka.initConsumer(ConsumerGroups.CHAT_SERVICE);

    await this.kafka.subscribe(
      this.consumer,
      [KafkaTopics.CHAT_EVENTS, KafkaTopics.CHAT_MESSAGES],
      this.handleMessage.bind(this)
    );

    logger.info('Chat consumer started');
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      logger.info('Chat consumer stopped');
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const event = this.kafka.parseEvent(payload);
    if (!event) return;

    logger.debug({ eventType: event.eventType }, 'Processing event');

    switch (event.eventType) {
      case ChatEventTypes.MESSAGE_SENT:
        await this.handleMessageSent(event.payload as {
          messageId: string;
          chatId: string;
          senderId: string;
          recipientIds: string[];
          content: string;
        });
        break;

      case ChatEventTypes.MESSAGE_DELIVERED:
        await this.handleMessageDelivered(event.payload as {
          messageId: string;
          chatId: string;
          deliveredToUserId: string;
        });
        break;

      case ChatEventTypes.MESSAGE_READ:
        await this.handleMessageRead(event.payload as {
          chatId: string;
          messageIds: string[];
          readByUserId: string;
        });
        break;

      case ChatEventTypes.CHAT_CREATED:
        await this.handleChatCreated(event.payload as {
          chatId: string;
          type: string;
          participantIds: string[];
        });
        break;

      default:
        logger.debug({ eventType: event.eventType }, 'Unhandled event type');
    }
  }

  private async handleMessageSent(payload: {
    messageId: string;
    chatId: string;
    senderId: string;
    recipientIds: string[];
    content: string;
  }): Promise<void> {
    // Message delivery is handled in real-time via WebSocket
    // This is for catching up offline users or cross-instance delivery

    for (const recipientId of payload.recipientIds) {
      const connections = this.wsManager.getUserConnections(recipientId);

      if (connections.length > 0) {
        // User is online, mark as delivered
        this.wsManager.sendToUser(recipientId, 'message:delivered', {
          messageId: payload.messageId,
          chatId: payload.chatId,
        });
      }
    }
  }

  private async handleMessageDelivered(payload: {
    messageId: string;
    chatId: string;
    deliveredToUserId: string;
  }): Promise<void> {
    // Notify sender that message was delivered
    await this.wsManager.sendToChat(
      payload.chatId,
      'message:delivered',
      {
        messageId: payload.messageId,
        deliveredTo: payload.deliveredToUserId,
        deliveredAt: new Date().toISOString(),
      },
      payload.deliveredToUserId
    );
  }

  private async handleMessageRead(payload: {
    chatId: string;
    messageIds: string[];
    readByUserId: string;
  }): Promise<void> {
    // Notify chat participants about read receipts
    await this.wsManager.sendToChat(
      payload.chatId,
      'message:read',
      {
        chatId: payload.chatId,
        messageIds: payload.messageIds,
        readBy: payload.readByUserId,
        readAt: new Date().toISOString(),
      },
      payload.readByUserId
    );
  }

  private async handleChatCreated(payload: {
    chatId: string;
    type: string;
    participantIds: string[];
  }): Promise<void> {
    // Notify all participants about the new chat
    this.wsManager.sendToUsers(payload.participantIds, 'chat:created', {
      chatId: payload.chatId,
      type: payload.type,
    });
  }
}
