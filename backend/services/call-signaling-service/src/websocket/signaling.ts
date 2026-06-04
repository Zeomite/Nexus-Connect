import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { SocketStream } from '@fastify/websocket';
import {
  createLogger,
  authenticateWebSocket,
  TokenPayload,
  SessionDescription,
  IceCandidate,
} from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'call-signaling:ws' });

interface SignalingMessage {
  type: string;
  payload: unknown;
}

interface WsQuerystring {
  token?: string;
  callId?: string;
}

export const signalingHandler: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: WsQuerystring }>('/signaling', { websocket: true }, (connection: SocketStream, request: FastifyRequest<{ Querystring: WsQuerystring }>) => {
    const socket = connection.socket;
    // Authenticate via query parameter
    const token = request.query.token;
    const callId = request.query.callId;

    let user: TokenPayload;
    try {
      user = authenticateWebSocket(token!, config.jwt.accessTokenSecret);
    } catch {
      socket.close(4001, 'Unauthorized');
      return;
    }

    if (!callId) {
      socket.close(4002, 'Missing callId');
      return;
    }

    // Add participant to the call
    const participant = server.signalingManager.addParticipant(socket, user.userId, callId);
    if (!participant) {
      socket.close(4003, 'Failed to join call');
      return;
    }

    const room = server.signalingManager.getRoom(callId);
    if (!room) {
      socket.close(4004, 'Call not found');
      return;
    }

    logger.info({ userId: user.userId, callId, connectionId: participant.connectionId }, 'User joined call');

    // Send room info and ICE servers
    socket.send(JSON.stringify({
      event: 'call:joined',
      data: {
        callId,
        roomId: room.roomId,
        type: room.type,
        iceServers: config.iceServers,
        participants: Array.from(room.participants.keys()).filter((id) => id !== user.userId),
      },
    }));

    // Notify other participants
    server.signalingManager.broadcastToRoom(callId, 'call:participant_joined', {
      callId,
      userId: user.userId,
    }, user.userId);

    // Handle incoming messages
    socket.on('message', async (data) => {
      try {
        const message: SignalingMessage = JSON.parse(data.toString());
        await handleSignalingMessage(server, user, callId, message);
      } catch (error) {
        logger.error({ error, userId: user.userId, callId }, 'Failed to process signaling message');
        socket.send(JSON.stringify({
          event: 'error',
          data: { code: 'INVALID_MESSAGE', message: 'Failed to process message' },
        }));
      }
    });

    // Handle close
    socket.on('close', async (code, reason) => {
      logger.info({ userId: user.userId, callId, code, reason: reason.toString() }, 'User left call');
      await server.signalingManager.removeParticipant(participant.connectionId);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error({ error, userId: user.userId, callId }, 'WebSocket error');
    });
  });
};

async function handleSignalingMessage(
  server: any,
  user: TokenPayload,
  callId: string,
  message: SignalingMessage
): Promise<void> {
  switch (message.type) {
    case 'offer':
      await handleOffer(server, user, callId, message.payload as {
        toUserId: string;
        offer: SessionDescription;
      });
      break;

    case 'answer':
      await handleAnswer(server, user, callId, message.payload as {
        toUserId: string;
        answer: SessionDescription;
      });
      break;

    case 'ice-candidate':
      await handleIceCandidate(server, user, callId, message.payload as {
        toUserId: string;
        candidate: IceCandidate;
      });
      break;

    case 'mute':
      handleMute(server, user, callId, message.payload as { isMuted: boolean });
      break;

    case 'video':
      handleVideo(server, user, callId, message.payload as { isVideoEnabled: boolean });
      break;

    case 'screen-share':
      handleScreenShare(server, user, callId, message.payload as { isScreenSharing: boolean });
      break;

    case 'leave':
      const participant = server.signalingManager.getParticipant(callId, user.userId);
      if (participant) {
        await server.signalingManager.removeParticipant(participant.connectionId);
      }
      break;

    case 'end-call':
      // Only initiator can end the call for everyone
      const room = server.signalingManager.getRoom(callId);
      if (room && room.initiatorId === user.userId) {
        await server.signalingManager.closeRoom(callId);
      }
      break;

    default:
      logger.warn({ type: message.type, userId: user.userId }, 'Unknown message type');
  }
}

async function handleOffer(
  server: any,
  user: TokenPayload,
  callId: string,
  payload: { toUserId: string; offer: SessionDescription }
): Promise<void> {
  server.signalingManager.sendToParticipant(callId, payload.toUserId, 'call:offer', {
    callId,
    fromUserId: user.userId,
    offer: payload.offer,
  });
}

async function handleAnswer(
  server: any,
  user: TokenPayload,
  callId: string,
  payload: { toUserId: string; answer: SessionDescription }
): Promise<void> {
  server.signalingManager.sendToParticipant(callId, payload.toUserId, 'call:answer', {
    callId,
    fromUserId: user.userId,
    answer: payload.answer,
  });
}

async function handleIceCandidate(
  server: any,
  user: TokenPayload,
  callId: string,
  payload: { toUserId: string; candidate: IceCandidate }
): Promise<void> {
  server.signalingManager.sendToParticipant(callId, payload.toUserId, 'call:ice_candidate', {
    callId,
    fromUserId: user.userId,
    candidate: payload.candidate,
  });
}

function handleMute(
  server: any,
  user: TokenPayload,
  callId: string,
  payload: { isMuted: boolean }
): void {
  server.signalingManager.updateMediaState(callId, user.userId, { isMuted: payload.isMuted });
}

function handleVideo(
  server: any,
  user: TokenPayload,
  callId: string,
  payload: { isVideoEnabled: boolean }
): void {
  server.signalingManager.updateMediaState(callId, user.userId, { isVideoEnabled: payload.isVideoEnabled });
}

function handleScreenShare(
  server: any,
  user: TokenPayload,
  callId: string,
  payload: { isScreenSharing: boolean }
): void {
  server.signalingManager.updateMediaState(callId, user.userId, { isScreenSharing: payload.isScreenSharing });
}
