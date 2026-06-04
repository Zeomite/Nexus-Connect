import { WebSocket } from 'ws';
import {
  RedisClient,
  KafkaClient,
  SessionKeys,
  KafkaTopics,
  CallEventTypes,
  createLogger,
  generateUuid,
  generateConnectionId,
  generateRoomId,
} from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'call-signaling:manager' });

export interface CallParticipant {
  socket: WebSocket;
  userId: string;
  connectionId: string;
  callId: string;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  joinedAt: number;
}

export interface CallRoom {
  callId: string;
  roomId: string;
  type: 'audio' | 'video';
  initiatorId: string;
  isGroupCall: boolean;
  groupId?: string;
  participants: Map<string, CallParticipant>;
  status: 'initiating' | 'ringing' | 'ongoing' | 'ended';
  createdAt: number;
}

export class SignalingManager {
  private rooms: Map<string, CallRoom> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private connectionToRoom: Map<string, string> = new Map();

  constructor(
    private readonly redis: RedisClient,
    private readonly kafka: KafkaClient
  ) {}

  // Create a new call room
  async createRoom(
    initiatorId: string,
    type: 'audio' | 'video',
    participantIds: string[],
    groupId?: string
  ): Promise<CallRoom> {
    const callId = generateUuid(); // Use UUID for database compatibility
    const roomId = generateRoomId();

    const room: CallRoom = {
      callId,
      roomId,
      type,
      initiatorId,
      isGroupCall: participantIds.length > 1,
      groupId,
      participants: new Map(),
      status: 'initiating',
      createdAt: Date.now(),
    };

    this.rooms.set(callId, room);

    // Store room info in Redis
    await this.redis.setJson(
      SessionKeys.callRoom(callId),
      {
        callId,
        roomId,
        type,
        initiatorId,
        isGroupCall: room.isGroupCall,
        groupId,
        status: room.status,
        participantIds,
        createdAt: room.createdAt,
      },
      config.ttl.callRoom
    );

    // Publish call initiated event
    await this.kafka.publish(KafkaTopics.CALL_EVENTS, {
      eventType: CallEventTypes.CALL_INITIATED,
      payload: {
        callId,
        roomId,
        initiatorId,
        participantIds,
        callType: type,
        isGroupCall: room.isGroupCall,
        groupId,
      },
    });

    logger.info({ callId, roomId, initiatorId, type }, 'Call room created');

    return room;
  }

  // Add participant to a call
  addParticipant(
    socket: WebSocket,
    userId: string,
    callId: string
  ): CallParticipant | null {
    const room = this.rooms.get(callId);
    if (!room) {
      logger.warn({ callId, userId }, 'Room not found');
      return null;
    }

    if (room.participants.size >= config.call.maxParticipants) {
      logger.warn({ callId, userId }, 'Room is full');
      return null;
    }

    const connectionId = generateConnectionId();

    const participant: CallParticipant = {
      socket,
      userId,
      connectionId,
      callId,
      isMuted: false,
      isVideoEnabled: room.type === 'video',
      isScreenSharing: false,
      joinedAt: Date.now(),
    };

    room.participants.set(userId, participant);
    this.connectionToRoom.set(connectionId, callId);

    // Track user connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    // Store participant in Redis
    this.redis.sadd(SessionKeys.callParticipants(callId), userId);

    logger.info({ callId, userId, connectionId }, 'Participant joined call');

    return participant;
  }

  // Remove participant from a call
  async removeParticipant(connectionId: string): Promise<void> {
    const callId = this.connectionToRoom.get(connectionId);
    if (!callId) return;

    const room = this.rooms.get(callId);
    if (!room) return;

    // Find and remove participant
    for (const [userId, participant] of room.participants) {
      if (participant.connectionId === connectionId) {
        room.participants.delete(userId);

        // Clean up user connections
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          userConns.delete(connectionId);
          if (userConns.size === 0) {
            this.userConnections.delete(userId);
          }
        }

        this.connectionToRoom.delete(connectionId);

        // Remove from Redis
        this.redis.srem(SessionKeys.callParticipants(callId), userId);

        // Notify other participants
        this.broadcastToRoom(callId, 'call:participant_left', {
          callId,
          userId,
          remainingCount: room.participants.size,
        }, userId);

        // Publish event
        await this.kafka.publish(KafkaTopics.CALL_EVENTS, {
          eventType: CallEventTypes.PARTICIPANT_LEFT,
          payload: { callId, userId },
        });

        logger.info({ callId, userId }, 'Participant left call');

        // Check if room should be closed
        if (room.participants.size === 0) {
          await this.closeRoom(callId);
        }

        break;
      }
    }
  }

  // Get room by call ID
  getRoom(callId: string): CallRoom | undefined {
    return this.rooms.get(callId);
  }

  // Get participant by user ID in a room
  getParticipant(callId: string, userId: string): CallParticipant | undefined {
    return this.rooms.get(callId)?.participants.get(userId);
  }

  // Send signaling message to a specific user in a call
  sendToParticipant(callId: string, userId: string, event: string, data: unknown): void {
    const participant = this.getParticipant(callId, userId);
    if (participant && participant.socket.readyState === WebSocket.OPEN) {
      participant.socket.send(JSON.stringify({ event, data, timestamp: Date.now() }));
    }
  }

  // Broadcast to all participants in a room
  broadcastToRoom(callId: string, event: string, data: unknown, excludeUserId?: string): void {
    const room = this.rooms.get(callId);
    if (!room) return;

    const message = JSON.stringify({ event, data, timestamp: Date.now() });

    for (const [userId, participant] of room.participants) {
      if (userId !== excludeUserId && participant.socket.readyState === WebSocket.OPEN) {
        participant.socket.send(message);
      }
    }
  }

  // Update participant media state
  updateMediaState(
    callId: string,
    userId: string,
    update: { isMuted?: boolean; isVideoEnabled?: boolean; isScreenSharing?: boolean }
  ): void {
    const participant = this.getParticipant(callId, userId);
    if (!participant) return;

    if (update.isMuted !== undefined) participant.isMuted = update.isMuted;
    if (update.isVideoEnabled !== undefined) participant.isVideoEnabled = update.isVideoEnabled;
    if (update.isScreenSharing !== undefined) participant.isScreenSharing = update.isScreenSharing;

    // Broadcast to other participants
    this.broadcastToRoom(callId, 'call:media_state_changed', {
      callId,
      userId,
      ...update,
    }, userId);
  }

  // Close a room
  async closeRoom(callId: string): Promise<void> {
    const room = this.rooms.get(callId);
    if (!room) return;

    room.status = 'ended';

    // Notify all participants
    this.broadcastToRoom(callId, 'call:ended', {
      callId,
      endReason: 'normal',
    });

    // Close all participant sockets
    for (const participant of room.participants.values()) {
      participant.socket.close(1000, 'Call ended');
    }

    // Clean up
    this.rooms.delete(callId);
    await this.redis.del(SessionKeys.callRoom(callId));
    await this.redis.del(SessionKeys.callParticipants(callId));

    // Calculate duration
    const duration = Math.floor((Date.now() - room.createdAt) / 1000);

    // Publish call ended event
    await this.kafka.publish(KafkaTopics.CALL_EVENTS, {
      eventType: CallEventTypes.CALL_ENDED,
      payload: {
        callId,
        endedBy: room.initiatorId,
        duration,
        participantCount: room.participants.size,
        endReason: 'normal',
      },
    });

    logger.info({ callId, duration }, 'Call room closed');
  }

  // Close all rooms (for shutdown)
  closeAll(): void {
    for (const [callId, room] of this.rooms) {
      for (const participant of room.participants.values()) {
        participant.socket.close(1000, 'Server shutting down');
      }
      this.rooms.delete(callId);
    }
    this.userConnections.clear();
    this.connectionToRoom.clear();
  }

  // Get stats
  getStats(): { activeRooms: number; totalParticipants: number } {
    let totalParticipants = 0;
    for (const room of this.rooms.values()) {
      totalParticipants += room.participants.size;
    }

    return {
      activeRooms: this.rooms.size,
      totalParticipants,
    };
  }
}
