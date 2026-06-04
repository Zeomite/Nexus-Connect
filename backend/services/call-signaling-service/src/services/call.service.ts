import {
  PostgresClient,
  RedisClient,
  KafkaClient,
  InitiateCallInput,
  generateTimeOrderedUuid,
  NotFoundError,
  ForbiddenError,
  CallInProgressError,
  KafkaTopics,
  CallEventTypes,
  SessionKeys,
} from '@nexus/shared';
import { SignalingManager } from '../websocket/signaling-manager';
import { config } from '../config';

export class CallService {
  constructor(
    private readonly postgres: PostgresClient,
    private readonly redis: RedisClient,
    private readonly kafka: KafkaClient,
    private readonly signalingManager: SignalingManager
  ) {}

  async initiateCall(
    initiatorId: string,
    input: InitiateCallInput
  ): Promise<{
    callId: string;
    roomId: string;
    type: string;
    wsUrl: string;
  }> {
    // Check if initiator is already in a call
    const activeCall = await this.redis.get(`user:${initiatorId}:active_call`);
    if (activeCall) {
      throw new CallInProgressError();
    }

    // Create call room
    const room = await this.signalingManager.createRoom(
      initiatorId,
      input.type,
      input.participantIds,
      input.groupId
    );

    // Store call in database
    await this.postgres.query(
      `INSERT INTO calls (id, room_id, type, status, initiator_id, is_group_call, group_id, created_at)
       VALUES ($1, $2, $3, 'initiating', $4, $5, $6, NOW())`,
      [
        room.callId,
        room.roomId,
        input.type,
        initiatorId,
        input.participantIds.length > 1,
        input.groupId || null,
      ]
    );

    // Store initiator's active call (short TTL - auto-expires if call fails)
    await this.redis.set(`user:${initiatorId}:active_call`, room.callId, 120);

    // Send call invitation to all participants
    for (const participantId of input.participantIds) {
      // Store pending call for each participant
      await this.redis.set(
        `user:${participantId}:pending_call:${room.callId}`,
        JSON.stringify({
          callId: room.callId,
          initiatorId,
          type: input.type,
          isGroupCall: room.isGroupCall,
        }),
        config.call.ringTimeout / 1000
      );

      // Publish incoming call event
      await this.kafka.publish(KafkaTopics.CALL_SIGNALING, {
        eventType: 'call.incoming',
        payload: {
          callId: room.callId,
          roomId: room.roomId,
          type: input.type,
          initiatorId,
          recipientId: participantId,
          isGroupCall: room.isGroupCall,
        },
      });
    }

    const wsUrl = `ws://localhost:${config.port}/ws/signaling?callId=${room.callId}`;

    return {
      callId: room.callId,
      roomId: room.roomId,
      type: input.type,
      wsUrl,
    };
  }

  async acceptCall(
    callId: string,
    userId: string
  ): Promise<{
    callId: string;
    roomId: string;
    wsUrl: string;
  }> {
    // Check if call exists
    const room = this.signalingManager.getRoom(callId);
    if (!room) {
      throw new NotFoundError('Call');
    }

    // Remove pending call marker
    await this.redis.del(`user:${userId}:pending_call:${callId}`);

    // Store user's active call (short TTL - auto-expires if call fails)
    await this.redis.set(`user:${userId}:active_call`, callId, 120);

    // Update call status if first acceptance
    if (room.status === 'initiating' || room.status === 'ringing') {
      room.status = 'ongoing';

      await this.postgres.query(
        `UPDATE calls SET status = 'ongoing', started_at = NOW() WHERE id = $1`,
        [callId]
      );
    }

    // Publish call accepted event
    await this.kafka.publish(KafkaTopics.CALL_EVENTS, {
      eventType: CallEventTypes.CALL_ANSWERED,
      payload: { callId, userId },
    });

    const wsUrl = `ws://localhost:${config.port}/ws/signaling?callId=${callId}`;

    return {
      callId,
      roomId: room.roomId,
      wsUrl,
    };
  }

  async declineCall(callId: string, userId: string): Promise<void> {
    // Remove pending call marker
    await this.redis.del(`user:${userId}:pending_call:${callId}`);

    // Publish call declined event
    await this.kafka.publish(KafkaTopics.CALL_EVENTS, {
      eventType: CallEventTypes.CALL_DECLINED,
      payload: { callId, userId },
    });

    // Notify other participants
    const room = this.signalingManager.getRoom(callId);
    if (room) {
      this.signalingManager.broadcastToRoom(callId, 'call:declined', {
        callId,
        userId,
      }, userId);
    }
  }

  async endCall(callId: string, userId: string): Promise<void> {
    const room = this.signalingManager.getRoom(callId);
    if (!room) {
      throw new NotFoundError('Call');
    }

    // Clear active call for all participants
    for (const participantId of room.participants.keys()) {
      await this.redis.del(`user:${participantId}:active_call`);
    }

    // Also clear for initiator if they ended
    await this.redis.del(`user:${room.initiatorId}:active_call`);

    // Close the room
    await this.signalingManager.closeRoom(callId);

    // Update database
    await this.postgres.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW() WHERE id = $1`,
      [callId]
    );
  }

  async getCallInfo(
    callId: string,
    userId: string
  ): Promise<{
    callId: string;
    roomId: string;
    type: string;
    status: string;
    initiatorId: string;
    participants: string[];
    isGroupCall: boolean;
  }> {
    const room = this.signalingManager.getRoom(callId);
    if (!room) {
      // Try to get from database
      const dbCall = await this.postgres.queryOne<{
        id: string;
        room_id: string;
        type: string;
        status: string;
        initiator_id: string;
        is_group_call: boolean;
      }>(
        'SELECT id, room_id, type, status, initiator_id, is_group_call FROM calls WHERE id = $1',
        [callId]
      );

      if (!dbCall) {
        throw new NotFoundError('Call');
      }

      return {
        callId: dbCall.id,
        roomId: dbCall.room_id,
        type: dbCall.type,
        status: dbCall.status,
        initiatorId: dbCall.initiator_id,
        participants: [],
        isGroupCall: dbCall.is_group_call,
      };
    }

    return {
      callId: room.callId,
      roomId: room.roomId,
      type: room.type,
      status: room.status,
      initiatorId: room.initiatorId,
      participants: Array.from(room.participants.keys()),
      isGroupCall: room.isGroupCall,
    };
  }

  async getActiveCalls(userId: string): Promise<Array<{
    callId: string;
    type: string;
    status: string;
  }>> {
    const activeCallId = await this.redis.get(`user:${userId}:active_call`);
    if (!activeCallId) {
      return [];
    }

    const room = this.signalingManager.getRoom(activeCallId);
    if (!room) {
      // Clean up stale reference
      await this.redis.del(`user:${userId}:active_call`);
      return [];
    }

    return [{
      callId: room.callId,
      type: room.type,
      status: room.status,
    }];
  }

  // Get pending/incoming calls for user
  async getPendingCalls(userId: string): Promise<Array<{
    callId: string;
    initiatorId: string;
    type: string;
    isGroupCall: boolean;
  }>> {
    // Get all pending call keys for this user
    const pattern = `user:${userId}:pending_call:*`;
    const keys = await this.redis.keys(pattern);
    
    const calls: Array<{
      callId: string;
      initiatorId: string;
      type: string;
      isGroupCall: boolean;
    }> = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        try {
          const callData = JSON.parse(data);
          calls.push({
            callId: callData.callId,
            initiatorId: callData.initiatorId,
            type: callData.type,
            isGroupCall: callData.isGroupCall,
          });
        } catch {
          // Invalid data, skip
        }
      }
    }

    return calls;
  }

  // Clear stale active call (for when calls fail due to permissions, network, etc.)
  async clearActiveCall(userId: string): Promise<boolean> {
    const activeCallId = await this.redis.get(`user:${userId}:active_call`);
    if (!activeCallId) {
      return false;
    }

    // Clear the active call marker
    await this.redis.del(`user:${userId}:active_call`);

    // Try to clean up the room if it exists
    const room = this.signalingManager.getRoom(activeCallId);
    if (room && room.initiatorId === userId && room.participants.size === 0) {
      // If user is initiator and no one joined, close the room
      await this.signalingManager.closeRoom(activeCallId);
      
      // Update database
      await this.postgres.query(
        `UPDATE calls SET status = 'cancelled', ended_at = NOW() WHERE id = $1 AND status IN ('initiating', 'ringing')`,
        [activeCallId]
      );
    }

    return true;
  }
}
