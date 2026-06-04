import { FastifyPluginAsync } from 'fastify';
import { UserService } from '../services/user.service';
import {
  UpdateProfileSchema,
  validate,
  getCurrentUser,
  ResponseMessages,
  ErrorMessages,
} from '@nexus/shared';
import { z } from 'zod';

const UpdateStatusSchema = z.object({
  status: z.enum(['online', 'offline', 'busy', 'away', 'do_not_disturb']),
});

export const userRoutes: FastifyPluginAsync = async (server) => {
  const userService = new UserService(server.postgres, server.redis, server.kafka);

  // Get current user profile
  server.get('/me', {
    schema: {
      description: 'Get current user profile',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            uniqueNumber: { type: 'string' },
            displayName: { type: 'string' },
            profilePictureUrl: { type: 'string', nullable: true },
            status: { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const profile = await userService.getProfile(user.userId);
    return reply.send(profile);
  });

  // Get user by ID
  server.get('/:userId', {
    schema: {
      description: 'Get user by ID',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const profile = await userService.getProfile(userId);
    return reply.send(profile);
  });

  // Update profile
  server.patch('/me', {
    schema: {
      description: 'Update current user profile',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
          profilePictureUrl: { type: 'string', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(UpdateProfileSchema, request.body);
    const profile = await userService.updateProfile(user.userId, input);
    return reply.send(profile);
  });

  // Update status
  server.patch('/me/status', {
    schema: {
      description: 'Update user status',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['online', 'offline', 'busy', 'away', 'do_not_disturb'] },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(UpdateStatusSchema, request.body);
    await userService.updateStatus(user.userId, input.status);
    return reply.send({ status: input.status });
  });

  // Get user status
  server.get('/:userId/status', {
    schema: {
      description: 'Get user status',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const status = await userService.getStatus(userId);
    return reply.send({ userId, status });
  });

  // Get multiple users' statuses
  server.post('/statuses', {
    schema: {
      description: 'Get multiple users statuses',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['userIds'],
        properties: {
          userIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        },
      },
    },
  }, async (request, reply) => {
    const { userIds } = request.body as { userIds: string[] };
    const statuses = await userService.getStatuses(userIds);
    return reply.send({ statuses });
  });

  // Upload profile picture
  server.post('/me/avatar', {
    schema: {
      description: 'Upload profile picture',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({
        error: { code: 'NO_FILE', message: ErrorMessages.USER.NO_FILE_UPLOADED }
      });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.status(400).send({ 
        error: { code: 'INVALID_FILE_TYPE', message: ErrorMessages.USER.INVALID_FILE_TYPE }
      });
    }

    const result = await userService.uploadAvatar(user.userId, data);
    return reply.send(result);
  });
};
