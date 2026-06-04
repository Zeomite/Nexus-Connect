import {
  PostgresClient,
  RedisClient,
  KafkaClient,
  generateTimeOrderedUuid,
  NotFoundError,
  ForbiddenError,
  KafkaTopics,
  ChatEventTypes,
  // Import centralized queries
  ChatQueries,
  ChatParticipantQueries,
  MessageQueries,
  ErrorMessages,
} from '@nexus/shared';

interface ChatRow {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ParticipantRow {
  user_id: string;
  display_name: string;
  profile_picture_url: string | null;
  joined_at: Date;
  is_admin: boolean;
}

export class ChatService {
  constructor(
    private readonly postgres: PostgresClient,
    private readonly redis: RedisClient,
    private readonly kafka: KafkaClient
  ) {}

  async getUserChats(userId: string, page: number = 1, limit: number = 20): Promise<{
    chats: Array<{
      id: string;
      type: string;
      name: string | null;
      lastMessage: unknown;
      unreadCount: number;
      participants: Array<{ id: string; displayName: string; profilePictureUrl: string | null }>;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const chatsResult = await this.postgres.query<ChatRow & { last_message_at: Date }>(
      ChatQueries.SELECT.USER_CHATS,
      [userId, limit, offset]
    );

    const countResult = await this.postgres.queryOne<{ count: string }>(
      ChatQueries.SELECT.USER_CHATS_COUNT,
      [userId]
    );

    const chats = await Promise.all(
      chatsResult.rows.map(async (chat) => {
        const [participants, lastMessage, unreadCount] = await Promise.all([
          this.getParticipantsPreview(chat.id, userId),
          this.getLastMessage(chat.id),
          this.getUnreadCount(chat.id, userId),
        ]);

        return {
          id: chat.id,
          type: chat.type,
          name: chat.type === 'direct' ? participants[0]?.displayName : chat.name,
          lastMessage,
          unreadCount,
          participants,
        };
      })
    );

    return {
      chats,
      total: parseInt(countResult?.count || '0', 10),
      page,
      limit,
    };
  }

  async getChat(chatId: string, userId: string): Promise<{
    id: string;
    type: string;
    name: string | null;
    createdAt: string;
  }> {
    // Verify user is a participant
    const participant = await this.postgres.queryOne(
      ChatParticipantQueries.SELECT.IS_PARTICIPANT,
      [chatId, userId]
    );

    if (!participant) {
      throw new ForbiddenError(ErrorMessages.CHAT.NOT_PARTICIPANT);
    }

    const chat = await this.postgres.queryOne<ChatRow>(
      ChatQueries.SELECT.BY_ID,
      [chatId]
    );

    if (!chat) {
      throw new NotFoundError('Chat');
    }

    return {
      id: chat.id,
      type: chat.type,
      name: chat.name,
      createdAt: chat.created_at.toISOString(),
    };
  }

  async createOrGetDirectChat(userId: string, participantId: string): Promise<{
    id: string;
    type: string;
    isNew: boolean;
  }> {
    // Check if direct chat already exists
    const existingChat = await this.postgres.queryOne<{ id: string }>(
      ChatQueries.SELECT.DIRECT_CHAT_EXISTS,
      [userId, participantId]
    );

    if (existingChat) {
      return { id: existingChat.id, type: 'direct', isNew: false };
    }

    // Create new direct chat
    const chatId = generateTimeOrderedUuid();

    await this.postgres.transaction(async (client) => {
      await client.query(ChatQueries.INSERT.CHAT, [chatId, 'direct']);
      await client.query(ChatParticipantQueries.INSERT.TWO_PARTICIPANTS, [chatId, userId, participantId]);
    });

    // Publish chat created event
    await this.kafka.publish(KafkaTopics.CHAT_EVENTS, {
      eventType: ChatEventTypes.CHAT_CREATED,
      payload: {
        chatId,
        type: 'direct',
        createdBy: userId,
        participantIds: [userId, participantId],
      },
    });

    return { id: chatId, type: 'direct', isNew: true };
  }

  async createGroupChat(
    creatorId: string,
    name: string,
    participantIds: string[]
  ): Promise<{ id: string; type: string; name: string }> {
    const chatId = generateTimeOrderedUuid();
    const allParticipants = [...new Set([creatorId, ...participantIds])];

    await this.postgres.transaction(async (client) => {
      await client.query(ChatQueries.INSERT.CHAT_WITH_NAME, [chatId, 'group', name]);

      const participantValues = allParticipants
        .map((participantUserId, i) => `($1, $${i + 2}, NOW(), ${participantUserId === creatorId})`)
        .join(', ');

      await client.query(
        `INSERT INTO chat_participants (chat_id, user_id, joined_at, is_admin) VALUES ${participantValues}`,
        [chatId, ...allParticipants]
      );
    });

    // Publish chat created event
    await this.kafka.publish(KafkaTopics.CHAT_EVENTS, {
      eventType: ChatEventTypes.CHAT_CREATED,
      payload: {
        chatId,
        type: 'group',
        name,
        createdBy: creatorId,
        participantIds: allParticipants,
      },
    });

    return { id: chatId, type: 'group', name };
  }

  async getChatParticipants(chatId: string, userId: string): Promise<ParticipantRow[]> {
    // Verify user is a participant
    const isParticipant = await this.postgres.queryOne(
      ChatParticipantQueries.SELECT.IS_PARTICIPANT,
      [chatId, userId]
    );

    if (!isParticipant) {
      throw new ForbiddenError(ErrorMessages.CHAT.NOT_PARTICIPANT);
    }

    const result = await this.postgres.query<ParticipantRow>(
      ChatParticipantQueries.SELECT.BY_CHAT_ID,
      [chatId]
    );

    return result.rows;
  }

  async leaveChat(chatId: string, userId: string): Promise<void> {
    const chat = await this.postgres.queryOne<{ type: string }>(
      ChatQueries.SELECT.TYPE_BY_ID,
      [chatId]
    );

    if (!chat) {
      throw new NotFoundError('Chat');
    }

    if (chat.type === 'direct') {
      throw new ForbiddenError(ErrorMessages.CHAT.CANNOT_LEAVE_DIRECT);
    }

    await this.postgres.query(ChatParticipantQueries.DELETE.PARTICIPANT, [chatId, userId]);

    // Publish participant removed event
    await this.kafka.publish(KafkaTopics.CHAT_EVENTS, {
      eventType: ChatEventTypes.PARTICIPANT_REMOVED,
      payload: { chatId, userId },
    });
  }

  private async getParticipantsPreview(
    chatId: string,
    excludeUserId: string
  ): Promise<Array<{ id: string; displayName: string; profilePictureUrl: string | null }>> {
    const result = await this.postgres.query<{ id: string; display_name: string; profile_picture_url: string | null }>(
      ChatParticipantQueries.SELECT.PREVIEW_BY_CHAT,
      [chatId, excludeUserId]
    );

    return result.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      profilePictureUrl: r.profile_picture_url,
    }));
  }

  private async getLastMessage(chatId: string): Promise<{
    id: string;
    content: string;
    senderId: string;
    createdAt: string;
  } | null> {
    const result = await this.postgres.queryOne<{
      id: string;
      content: string;
      sender_id: string;
      created_at: Date;
    }>(MessageQueries.SELECT.LAST_BY_CHAT, [chatId]);

    if (!result) return null;

    return {
      id: result.id,
      content: result.content.substring(0, 100),
      senderId: result.sender_id,
      createdAt: result.created_at.toISOString(),
    };
  }

  private async getUnreadCount(chatId: string, userId: string): Promise<number> {
    const result = await this.postgres.queryOne<{ count: string }>(
      MessageQueries.SELECT.UNREAD_COUNT,
      [chatId, userId]
    );

    return parseInt(result?.count || '0', 10);
  }
}
