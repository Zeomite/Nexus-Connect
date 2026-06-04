import {
  PostgresClient,
  RedisClient,
  KafkaClient,
  SendMessageInput,
  generateTimeOrderedUuid,
  NotFoundError,
  ForbiddenError,
  KafkaTopics,
  ChatEventTypes,
  // Import centralized queries
  MessageQueries,
  ChatParticipantQueries,
  ErrorMessages,
} from '@nexus/shared';
import { WebSocketManager } from '../websocket/manager';

interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  status: string;
  reply_to_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export class MessageService {
  constructor(
    private readonly postgres: PostgresClient,
    private readonly redis: RedisClient,
    private readonly kafka: KafkaClient,
    private readonly wsManager: WebSocketManager
  ) {}

  async getMessages(
    chatId: string,
    userId: string,
    page: number = 1,
    limit: number = 50,
    before?: string,
    after?: string
  ): Promise<{
    messages: Array<{
      id: string;
      senderId: string;
      type: string;
      content: string;
      status: string;
      replyToId: string | null;
      createdAt: string;
    }>;
    hasMore: boolean;
  }> {
    // Verify user is a participant
    await this.verifyParticipant(chatId, userId);

    let query: string;
    const params: unknown[] = [chatId];

    if (before) {
      query = MessageQueries.SELECT.BY_CHAT_BEFORE;
      params.push(before, limit + 1);
    } else if (after) {
      query = MessageQueries.SELECT.BY_CHAT_AFTER;
      params.push(after, limit + 1);
    } else {
      query = MessageQueries.SELECT.BY_CHAT;
      params.push(limit + 1);
    }

    const result = await this.postgres.query<MessageRow>(query, params);

    const hasMore = result.rows.length > limit;
    const messages = result.rows.slice(0, limit).map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      type: row.type,
      content: row.content,
      status: row.status,
      replyToId: row.reply_to_id,
      createdAt: row.created_at.toISOString(),
    }));

    return { messages, hasMore };
  }

  async sendMessage(senderId: string, input: SendMessageInput): Promise<{
    id: string;
    chatId: string;
    senderId: string;
    type: string;
    content: string;
    status: string;
    createdAt: string;
  }> {
    // Verify sender is a participant
    await this.verifyParticipant(input.chatId, senderId);

    const messageId = generateTimeOrderedUuid();

    await this.postgres.query(
      MessageQueries.INSERT.MESSAGE,
      [
        messageId,
        input.chatId,
        senderId,
        input.type || 'text',
        input.content,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.replyToId || null,
      ]
    );

    // Get recipient IDs
    const recipients = await this.postgres.query<{ user_id: string }>(
      ChatParticipantQueries.SELECT.USER_IDS_BY_CHAT,
      [input.chatId, senderId]
    );

    const recipientIds = recipients.rows.map((r) => r.user_id);

    const message = {
      id: messageId,
      chatId: input.chatId,
      senderId,
      type: input.type || 'text',
      content: input.content,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };

    // Publish to Kafka
    await this.kafka.publish(
      KafkaTopics.CHAT_MESSAGES,
      {
        eventType: ChatEventTypes.MESSAGE_SENT,
        payload: {
          messageId,
          chatId: input.chatId,
          senderId,
          recipientIds,
          messageType: input.type || 'text',
          content: input.content,
          metadata: input.metadata,
        },
      },
      input.chatId // Use chatId as key for ordering
    );

    // Send via WebSocket to online recipients
    this.wsManager.sendToUsers(recipientIds, 'message:new', message);

    return message;
  }

  async getMessage(messageId: string, userId: string): Promise<{
    id: string;
    chatId: string;
    senderId: string;
    type: string;
    content: string;
    status: string;
    createdAt: string;
  }> {
    const message = await this.postgres.queryOne<MessageRow>(
      MessageQueries.SELECT.BY_ID,
      [messageId]
    );

    if (!message) {
      throw new NotFoundError('Message');
    }

    // Verify user is a participant of the chat
    await this.verifyParticipant(message.chat_id, userId);

    return {
      id: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      type: message.type,
      content: message.content,
      status: message.status,
      createdAt: message.created_at.toISOString(),
    };
  }

  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.postgres.queryOne<MessageRow>(
      MessageQueries.SELECT.SENDER_ID,
      [messageId]
    );

    if (!message) {
      throw new NotFoundError('Message');
    }

    // Only sender can delete their message
    if (message.sender_id !== userId) {
      throw new ForbiddenError(ErrorMessages.CHAT.CANNOT_DELETE_OTHERS);
    }

    await this.postgres.query(MessageQueries.UPDATE.SOFT_DELETE, [messageId]);

    // Publish delete event
    await this.kafka.publish(KafkaTopics.CHAT_EVENTS, {
      eventType: ChatEventTypes.MESSAGE_DELETED,
      payload: { messageId, chatId: message.chat_id, deletedBy: userId },
    });

    // Notify via WebSocket
    await this.wsManager.sendToChat(message.chat_id, 'message:deleted', {
      messageId,
      chatId: message.chat_id,
    });
  }

  async markAsRead(chatId: string, messageIds: string[], userId: string): Promise<void> {
    // Verify user is a participant
    await this.verifyParticipant(chatId, userId);

    // Update message status
    await this.postgres.query(
      MessageQueries.UPDATE.STATUS_BULK,
      [messageIds, chatId, userId]
    );

    // Update participant's last read timestamp
    await this.postgres.query(
      ChatParticipantQueries.UPDATE.LAST_READ,
      [chatId, userId]
    );

    // Publish read event
    await this.kafka.publish(KafkaTopics.CHAT_EVENTS, {
      eventType: ChatEventTypes.MESSAGE_READ,
      payload: {
        chatId,
        messageIds,
        readByUserId: userId,
        readAt: new Date().toISOString(),
      },
    });

    // Notify senders via WebSocket
    await this.wsManager.sendToChat(chatId, 'message:read', {
      chatId,
      messageIds,
      readBy: userId,
      readAt: new Date().toISOString(),
    }, userId);
  }

  private async verifyParticipant(chatId: string, userId: string): Promise<void> {
    const participant = await this.postgres.queryOne(
      ChatParticipantQueries.SELECT.IS_PARTICIPANT,
      [chatId, userId]
    );

    if (!participant) {
      throw new ForbiddenError(ErrorMessages.CHAT.NOT_PARTICIPANT);
    }
  }
}
