import { FastifyPluginAsync } from 'fastify';
import { ChatService } from '../services/chat.service';
import {
  validate,
  getCurrentUser,
  PaginationSchema,
  ResponseMessages,
} from '@nexus/shared';
import { z } from 'zod';

const CreateDirectChatSchema = z.object({
  participantId: z.string().uuid(),
});

const CreateGroupChatSchema = z.object({
  name: z.string().min(1).max(100),
  participantIds: z.array(z.string().uuid()).min(1).max(100),
});

export const chatRoutes: FastifyPluginAsync = async (server) => {
  const chatService = new ChatService(server.postgres, server.redis, server.kafka);

  // Get user's chats
  server.get('/', {
    schema: {
      description: 'Get user chats',
      tags: ['chats'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const pagination = validate(PaginationSchema, request.query);
    const chats = await chatService.getUserChats(user.userId, pagination.page, pagination.limit);
    return reply.send(chats);
  });

  // Get chat by ID
  server.get('/:chatId', {
    schema: {
      description: 'Get chat by ID',
      tags: ['chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          chatId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { chatId } = request.params as { chatId: string };
    const chat = await chatService.getChat(chatId, user.userId);
    return reply.send(chat);
  });

  // Create direct chat
  server.post('/direct', {
    schema: {
      description: 'Create or get direct chat',
      tags: ['chats'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['participantId'],
        properties: {
          participantId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(CreateDirectChatSchema, request.body);
    const chat = await chatService.createOrGetDirectChat(user.userId, input.participantId);
    return reply.status(201).send(chat);
  });

  // Create group chat
  server.post('/group', {
    schema: {
      description: 'Create group chat',
      tags: ['chats'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'participantIds'],
        properties: {
          name: { type: 'string' },
          participantIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(CreateGroupChatSchema, request.body);
    const chat = await chatService.createGroupChat(user.userId, input.name, input.participantIds);
    return reply.status(201).send(chat);
  });

  // Get chat participants
  server.get('/:chatId/participants', {
    schema: {
      description: 'Get chat participants',
      tags: ['chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          chatId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { chatId } = request.params as { chatId: string };
    const participants = await chatService.getChatParticipants(chatId, user.userId);
    return reply.send(participants);
  });

  // Leave chat
  server.delete('/:chatId/leave', {
    schema: {
      description: 'Leave group chat',
      tags: ['chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          chatId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { chatId } = request.params as { chatId: string };
    await chatService.leaveChat(chatId, user.userId);
    return reply.send({ message: ResponseMessages.CHAT.LEFT_CHAT });
  });
};
