// WebRTC Signaling WebSocket Client

import { API_CONFIG } from '../api/config';
import { tokenManager } from '../api/client';

export type SignalingEventType =
  | 'call:joined'
  | 'call:participant_joined'
  | 'call:participant_left'
  | 'call:offer'
  | 'call:answer'
  | 'call:ice_candidate'
  | 'call:media_state_changed'
  | 'call:declined'
  | 'call:ended'
  | 'error';

export interface CallJoinedData {
  callId: string;
  roomId: string;
  type: 'audio' | 'video';
  iceServers: RTCIceServer[];
  participants: string[];
}

export interface ParticipantJoinedData {
  callId: string;
  userId: string;
}

export interface ParticipantLeftData {
  callId: string;
  userId: string;
  remainingCount: number;
}

export interface OfferData {
  callId: string;
  fromUserId: string;
  offer: RTCSessionDescriptionInit;
}

export interface AnswerData {
  callId: string;
  fromUserId: string;
  answer: RTCSessionDescriptionInit;
}

export interface IceCandidateData {
  callId: string;
  fromUserId: string;
  candidate: RTCIceCandidateInit;
}

export interface MediaStateData {
  callId: string;
  userId: string;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
}

export interface CallEndedData {
  callId: string;
  endReason: 'normal' | 'timeout' | 'error' | 'declined_all';
}

type EventHandler<T = unknown> = (data: T) => void;

export class SignalingWebSocket {
  private ws: WebSocket | null = null;
  private callId: string;
  private eventHandlers: Map<SignalingEventType, Set<EventHandler>> = new Map();
  private iceServers: RTCIceServer[] = [];

  constructor(callId: string) {
    this.callId = callId;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    const eventTypes: SignalingEventType[] = [
      'call:joined',
      'call:participant_joined',
      'call:participant_left',
      'call:offer',
      'call:answer',
      'call:ice_candidate',
      'call:media_state_changed',
      'call:declined',
      'call:ended',
      'error',
    ];
    eventTypes.forEach((type) => {
      this.eventHandlers.set(type, new Set());
    });
  }

  connect(): Promise<CallJoinedData> {
    return new Promise((resolve, reject) => {
      const token = tokenManager.getAccessToken();
      if (!token) {
        reject(new Error('No access token available'));
        return;
      }

      const wsUrl = `${API_CONFIG.wsBaseUrl}${API_CONFIG.websocket.signaling}?token=${token}&callId=${this.callId}`;

      try {
        this.ws = new WebSocket(wsUrl);
        this.setupWebSocketListeners(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupWebSocketListeners(
    onConnect: (data: CallJoinedData) => void,
    onError: (error: Error) => void
  ): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('SignalingWebSocket: Connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message, onConnect);
      } catch (error) {
        console.error('SignalingWebSocket: Failed to parse message', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('SignalingWebSocket: Connection closed', event.code);
      if (event.code >= 4000) {
        // Handle custom error codes
        const errorMessages: Record<number, string> = {
          4001: 'Unauthorized',
          4002: 'Missing required parameter',
          4003: 'Failed to join call',
          4004: 'Call not found',
        };
        onError(new Error(errorMessages[event.code] || 'Connection closed'));
      }
    };

    this.ws.onerror = (error) => {
      console.error('SignalingWebSocket: Error', error);
      onError(new Error('WebSocket error'));
    };
  }

  private handleMessage(
    message: { event: SignalingEventType; data: unknown },
    onConnect?: (data: CallJoinedData) => void
  ): void {
    const { event, data } = message;

    // Handle call:joined specially for the connect promise
    if (event === 'call:joined' && onConnect) {
      const joinData = data as CallJoinedData;
      this.iceServers = joinData.iceServers;
      onConnect(joinData);
    }

    // Emit to registered handlers
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  // Event subscription
  on<T = unknown>(event: SignalingEventType, handler: EventHandler<T>): () => void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler as EventHandler);
    }

    return () => {
      handlers?.delete(handler as EventHandler);
    };
  }

  // Send offer
  sendOffer(toUserId: string, offer: RTCSessionDescriptionInit): void {
    this.send({
      type: 'offer',
      payload: { toUserId, offer },
    });
  }

  // Send answer
  sendAnswer(toUserId: string, answer: RTCSessionDescriptionInit): void {
    this.send({
      type: 'answer',
      payload: { toUserId, answer },
    });
  }

  // Send ICE candidate
  sendIceCandidate(toUserId: string, candidate: RTCIceCandidateInit): void {
    this.send({
      type: 'ice-candidate',
      payload: { toUserId, candidate },
    });
  }

  // Toggle mute
  toggleMute(isMuted: boolean): void {
    this.send({
      type: 'mute',
      payload: { isMuted },
    });
  }

  // Toggle video
  toggleVideo(isVideoEnabled: boolean): void {
    this.send({
      type: 'video',
      payload: { isVideoEnabled },
    });
  }

  // Toggle screen share
  toggleScreenShare(isScreenSharing: boolean): void {
    this.send({
      type: 'screen-share',
      payload: { isScreenSharing },
    });
  }

  // Leave call
  leave(): void {
    this.send({ type: 'leave' });
    this.disconnect();
  }

  // End call (initiator only)
  endCall(): void {
    this.send({ type: 'end-call' });
    this.disconnect();
  }

  private send(message: { type: string; payload?: unknown }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('SignalingWebSocket: Cannot send, connection not open');
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getIceServers(): RTCIceServer[] {
    return this.iceServers;
  }
}
