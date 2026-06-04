import { FastifyPluginAsync } from 'fastify';
import { CallService } from '../services/call.service';
import { validate, getCurrentUser, InitiateCallSchema } from '@nexus/shared';

export const callRoutes: FastifyPluginAsync = async (server) => {
  const callService = new CallService(
    server.postgres,
    server.redis,
    server.kafka,
    server.signalingManager
  );

  // Initiate a call
  server.post('/initiate', {
    schema: {
      description: 'Initiate a new call',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['participantIds', 'type'],
        properties: {
          participantIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          type: { type: 'string', enum: ['audio', 'video'] },
          groupId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            callId: { type: 'string' },
            roomId: { type: 'string' },
            type: { type: 'string' },
            wsUrl: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const input = validate(InitiateCallSchema, request.body);

    const result = await callService.initiateCall(user.userId, input);

    return reply.status(201).send(result);
  });

  // Accept a call
  server.post('/:callId/accept', {
    schema: {
      description: 'Accept an incoming call',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { callId } = request.params as { callId: string };

    const result = await callService.acceptCall(callId, user.userId);

    return reply.send(result);
  });

  // Decline a call
  server.post('/:callId/decline', {
    schema: {
      description: 'Decline an incoming call',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { callId } = request.params as { callId: string };

    await callService.declineCall(callId, user.userId);

    return reply.send({ message: 'Call declined' });
  });

  // End a call
  server.post('/:callId/end', {
    schema: {
      description: 'End a call',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { callId } = request.params as { callId: string };

    await callService.endCall(callId, user.userId);

    return reply.send({ message: 'Call ended' });
  });

  // Get call info
  server.get('/:callId', {
    schema: {
      description: 'Get call information',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { callId } = request.params as { callId: string };

    const callInfo = await callService.getCallInfo(callId, user.userId);

    return reply.send(callInfo);
  });

  // Get active calls for user
  server.get('/active', {
    schema: {
      description: 'Get active calls for the current user',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const calls = await callService.getActiveCalls(user.userId);
    return reply.send({ calls });
  });

  // Get pending/incoming calls for user
  server.get('/incoming', {
    schema: {
      description: 'Get pending incoming calls for the current user',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  callId: { type: 'string' },
                  initiatorId: { type: 'string' },
                  type: { type: 'string' },
                  isGroupCall: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const calls = await callService.getPendingCalls(user.userId);
    return reply.send({ calls });
  });

  // Clear stale active call (for when calls fail due to permissions etc.)
  server.delete('/active', {
    schema: {
      description: 'Clear any stale active call for the current user',
      tags: ['calls'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            cleared: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const cleared = await callService.clearActiveCall(user.userId);
    return reply.send({ message: cleared ? 'Active call cleared' : 'No active call found', cleared });
  });
};
