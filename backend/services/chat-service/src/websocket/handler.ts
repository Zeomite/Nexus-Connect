import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { SocketStream } from '@fastify/websocket';
import {
  createLogger,
  authenticateWebSocket,
  TokenPayload,
  SessionKeys,
} from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'chat-service:ws' });

interface WsMessage {
  type: string;
  payload: unknown;
}

interface WsQuerystring {
  token?: string;
}

export const websocketHandler: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: WsQuerystring }>('/chat', { websocket: true }, (connection: SocketStream, request: FastifyRequest<{ Querystring: WsQuerystring }>) => {
    const socket = connection.socket;
    // Authenticate via query parameter or header
    const token = request.query.token || request.headers.authorization?.replace('Bearer ', '');

    let user: TokenPayload;
    try {
      user = authenticateWebSocket(token!, config.jwt.accessTokenSecret);
    } catch {
      socket.close(4001, 'Unauthorized');
      return;
    }

    // Add connection to manager
    const connectionId = server.wsManager.addConnection(socket, user.userId);

    logger.info({ userId: user.userId, connectionId }, 'WebSocket connected');

    // Handle pong (response to ping)
    socket.on('pong', () => {
      server.wsManager.updatePing(connectionId);
    });

    // Handle incoming messages
    socket.on('message', async (data) => {
      try {
        const message: WsMessage = JSON.parse(data.toString());
        await handleMessage(server, socket, user, connectionId, message);
      } catch (error) {
        logger.error({ error, userId: user.userId }, 'Failed to process WebSocket message');
        socket.send(JSON.stringify({
          event: 'error',
          data: { code: 'INVALID_MESSAGE', message: 'Failed to process message' },
        }));
      }
    });

    // Handle close
    socket.on('close', (code, reason) => {
      logger.info({ userId: user.userId, connectionId, code, reason: reason.toString() }, 'WebSocket disconnected');
      server.wsManager.removeConnection(connectionId);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error({ error, userId: user.userId, connectionId }, 'WebSocket error');
    });

    // Send connection confirmation
    socket.send(JSON.stringify({
      event: 'connected',
      data: { connectionId, userId: user.userId },
    }));
  });
};

async function handleMessage(
  server: any,
  socket: WebSocket,
  user: TokenPayload,
  connectionId: string,
  message: WsMessage
): Promise<void> {
  switch (message.type) {
    case 'ping':
      socket.send(JSON.stringify({ event: 'pong', data: { timestamp: Date.now() } }));
      server.wsManager.updatePing(connectionId);
      break;

    case 'typing:start':
      await handleTypingStart(server, user, message.payload as { chatId: string });
      break;

    case 'typing:stop':
      await handleTypingStop(server, user, message.payload as { chatId: string });
      break;

    case 'message:read':
      await handleMessageRead(server, user, message.payload as { chatId: string; messageIds: string[] });
      break;

    case 'subscribe:chat':
      await handleSubscribeChat(server, user, message.payload as { chatId: string });
      break;

    case 'unsubscribe:chat':
      await handleUnsubscribeChat(server, user, message.payload as { chatId: string });
      break;

    default:
      socket.send(JSON.stringify({
        event: 'error',
        data: { code: 'UNKNOWN_MESSAGE_TYPE', message: `Unknown message type: ${message.type}` },
      }));
  }
}

async function handleTypingStart(
  server: any,
  user: TokenPayload,
  payload: { chatId: string }
): Promise<void> {
  const { chatId } = payload;

  // Store typing indicator in Redis with TTL
  await server.redis.set(
    SessionKeys.typingIndicator(chatId, user.userId),
    '1',
    config.typingTtl
  );

  // Broadcast to chat participants
  await server.wsManager.sendToChat(chatId, 'typing:start', {
    chatId,
    userId: user.userId,
  }, user.userId);
}

async function handleTypingStop(
  server: any,
  user: TokenPayload,
  payload: { chatId: string }
): Promise<void> {
  const { chatId } = payload;

  // Remove typing indicator
  await server.redis.del(SessionKeys.typingIndicator(chatId, user.userId));

  // Broadcast to chat participants
  await server.wsManager.sendToChat(chatId, 'typing:stop', {
    chatId,
    userId: user.userId,
  }, user.userId);
}

async function handleMessageRead(
  server: any,
  user: TokenPayload,
  payload: { chatId: string; messageIds: string[] }
): Promise<void> {
  const { chatId, messageIds } = payload;

  // Update read status in database
  await server.postgres.query(
    `UPDATE messages SET status = 'read' WHERE id = ANY($1) AND sender_id != $2`,
    [messageIds, user.userId]
  );

  // Update chat participant's last read timestamp
  await server.postgres.query(
    `UPDATE chat_participants SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2`,
    [chatId, user.userId]
  );

  // Publish read receipt event
  await server.kafka.publish('nexus.chat.events', {
    eventType: 'chat.message_read',
    payload: {
      chatId,
      messageIds,
      readByUserId: user.userId,
      readAt: new Date().toISOString(),
    },
  });

  // Notify sender(s)
  await server.wsManager.sendToChat(chatId, 'message:read', {
    chatId,
    messageIds,
    readBy: user.userId,
    readAt: new Date().toISOString(),
  }, user.userId);
}

async function handleSubscribeChat(
  server: any,
  user: TokenPayload,
  payload: { chatId: string }
): Promise<void> {
  const { chatId } = payload;

  // Verify user is a participant
  const participant = await server.postgres.queryOne(
    'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
    [chatId, user.userId]
  );

  if (!participant) {
    throw new Error('Not a chat participant');
  }

  // Subscribe to Redis pub/sub for this chat
  const subscriber = server.redis.createSubscriber();
  await subscriber.subscribe(`chat:${chatId}`);

  logger.info({ userId: user.userId, chatId }, 'User subscribed to chat');
}

async function handleUnsubscribeChat(
  server: any,
  user: TokenPayload,
  payload: { chatId: string }
): Promise<void> {
  const { chatId } = payload;
  logger.info({ userId: user.userId, chatId }, 'User unsubscribed from chat');
}
