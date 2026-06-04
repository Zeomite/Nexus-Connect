import { FastifyPluginAsync } from 'fastify';
import { UserService } from '../services/user.service';
import { validate, PaginationSchema, getCurrentUser } from '@nexus/shared';
import { z } from 'zod';

const SearchByNumberSchema = z.object({
  uniqueNumber: z.string().length(10).regex(/^\d{10}$/),
});

const SearchByNameSchema = z.object({
  query: z.string().min(1).max(100),
  ...PaginationSchema.shape,
});

export const searchRoutes: FastifyPluginAsync = async (server) => {
  const userService = new UserService(server.postgres, server.redis, server.kafka);

  // Search by unique number
  server.get('/by-number/:uniqueNumber', {
    schema: {
      description: 'Search user by unique 10-digit number',
      tags: ['search'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['uniqueNumber'],
        properties: {
          uniqueNumber: { type: 'string', pattern: '^\\d{10}$' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            displayName: { type: 'string' },
            uniqueNumber: { type: 'string' },
            profilePictureUrl: { type: 'string', nullable: true },
            status: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { uniqueNumber } = validate(SearchByNumberSchema, request.params);
    const user = await userService.findByUniqueNumber(uniqueNumber);
    return reply.send(user);
  });

  // Search by name
  server.get('/users', {
    schema: {
      description: 'Search users by name',
      tags: ['search'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const currentUser = getCurrentUser(request);
    const input = validate(SearchByNameSchema, request.query);
    const results = await userService.searchByName(
      input.query,
      currentUser.userId,
      input.page,
      input.limit
    );
    return reply.send(results);
  });
};
