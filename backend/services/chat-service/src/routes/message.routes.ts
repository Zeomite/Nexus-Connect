import { FastifyPluginAsync } from 'fastify';
import { MessageService } from '../services/message.service';
import {
  validate,
  getCurrentUser,
  SendMessageSchema,
  PaginationSchema,
  ResponseMessages,
} from '@nexus/shared';
import { z } from 'zod';

const GetMessagesSchema = z.object({
  chatId: z.string().uuid(),
  ...PaginationSchema.shape,
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
});

export const messageRoutes: FastifyPluginAsync = async (server) => {
  const messageService = new MessageService(
    server.postgres,
    server.redis,
    server.kafka,
    server.wsManager
  );

  // Get messages for a chat
  server.get('/chat/:chatId', {
    schema: {
      description: 'Get chat messages',
      tags: ['messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          chatId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 50 },
          before: { type: 'string', format: 'date-time' },
          after: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { chatId } = request.params as { chatId: string };
    const query = validate(GetMessagesSchema, { chatId, ...(request.query as Record<string, unknown>) });

    const messages = await messageService.getMessages(
      chatId,
      user.userId,
      query.page,
      query.limit,
      query.before,
      query.after
    );

    return reply.send(messages);
  });

  // Send a message
  server.post('/', {
    schema: {
      description: 'Send a message',
      tags: ['messages'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['chatId', 'content'],
        properties: {
          chatId: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['text', 'image', 'file', 'audio', 'video'], default: 'text' },
          content: { type: 'string', maxLength: 10000 },
          metadata: { type: 'object' },
          replyToId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(SendMessageSchema, request.body);

    const message = await messageService.sendMessage(user.userId, {
      ...input,
      type: input.type || 'text',
    });

    return reply.status(201).send(message);
  });

  // Get message by ID
  server.get('/:messageId', {
    schema: {
      description: 'Get message by ID',
      tags: ['messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          messageId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { messageId } = request.params as { messageId: string };

    const message = await messageService.getMessage(messageId, user.userId);

    return reply.send(message);
  });

  // Delete a message
  server.delete('/:messageId', {
    schema: {
      description: 'Delete a message',
      tags: ['messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          messageId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { messageId } = request.params as { messageId: string };

    await messageService.deleteMessage(messageId, user.userId);

    return reply.send({ message: ResponseMessages.CHAT.MESSAGE_DELETED });
  });

  // Mark messages as read
  server.post('/read', {
    schema: {
      description: 'Mark messages as read',
      tags: ['messages'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['chatId', 'messageIds'],
        properties: {
          chatId: { type: 'string', format: 'uuid' },
          messageIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { chatId, messageIds } = request.body as { chatId: string; messageIds: string[] };

    await messageService.markAsRead(chatId, messageIds, user.userId);

    return reply.send({ message: ResponseMessages.CHAT.MESSAGES_READ });
  });
};
