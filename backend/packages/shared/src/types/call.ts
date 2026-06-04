import { z } from 'zod';

// Call status enum
export const CallStatus = {
  INITIATING: 'initiating',
  RINGING: 'ringing',
  ONGOING: 'ongoing',
  ENDED: 'ended',
  MISSED: 'missed',
  DECLINED: 'declined',
  FAILED: 'failed',
} as const;

export type CallStatusType = (typeof CallStatus)[keyof typeof CallStatus];

// Call type enum
export const CallType = {
  AUDIO: 'audio',
  VIDEO: 'video',
} as const;

export type CallTypeValue = (typeof CallType)[keyof typeof CallType];

// Participant status
export const ParticipantStatus = {
  INVITED: 'invited',
  RINGING: 'ringing',
  JOINED: 'joined',
  LEFT: 'left',
  DECLINED: 'declined',
} as const;

export type ParticipantStatusType = (typeof ParticipantStatus)[keyof typeof ParticipantStatus];

// Call schema
export const CallSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string(),
  type: z.enum(['audio', 'video']),
  status: z.enum(['initiating', 'ringing', 'ongoing', 'ended', 'missed', 'declined', 'failed']),
  initiatorId: z.string().uuid(),
  isGroupCall: z.boolean(),
  groupId: z.string().uuid().nullable(),
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type Call = z.infer<typeof CallSchema>;

// Call participant schema
export const CallParticipantSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  userId: z.string().uuid(),
  status: z.enum(['invited', 'ringing', 'joined', 'left', 'declined']),
  isMuted: z.boolean(),
  isVideoEnabled: z.boolean(),
  isScreenSharing: z.boolean(),
  joinedAt: z.date().nullable(),
  leftAt: z.date().nullable(),
});

export type CallParticipant = z.infer<typeof CallParticipantSchema>;

// Call history schema
export const CallHistorySchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  userId: z.string().uuid(),
  direction: z.enum(['incoming', 'outgoing']),
  type: z.enum(['audio', 'video']),
  status: z.enum(['answered', 'missed', 'declined']),
  duration: z.number().int().min(0).nullable(),
  participantCount: z.number().int().min(1),
  createdAt: z.date(),
});

export type CallHistory = z.infer<typeof CallHistorySchema>;

// Initiate call input
export const InitiateCallSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(50),
  type: z.enum(['audio', 'video']),
  groupId: z.string().uuid().optional(),
});

export type InitiateCallInput = z.infer<typeof InitiateCallSchema>;

// WebRTC signaling types
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

// WebSocket call events
export interface WsCallSignaling {
  event:
    | 'call:incoming'
    | 'call:accepted'
    | 'call:declined'
    | 'call:ended'
    | 'call:participant_joined'
    | 'call:participant_left'
    | 'call:ice_candidate'
    | 'call:offer'
    | 'call:answer'
    | 'call:mute_toggle'
    | 'call:video_toggle'
    | 'call:screen_share';
  data: unknown;
}

export interface WsCallOffer {
  callId: string;
  fromUserId: string;
  toUserId: string;
  offer: SessionDescription;
}

export interface WsCallAnswer {
  callId: string;
  fromUserId: string;
  toUserId: string;
  answer: SessionDescription;
}

export interface WsIceCandidate {
  callId: string;
  fromUserId: string;
  toUserId: string;
  candidate: IceCandidate;
}

export interface WsCallIncoming {
  callId: string;
  roomId: string;
  type: CallTypeValue;
  initiator: {
    id: string;
    displayName: string;
    profilePictureUrl: string | null;
  };
  isGroupCall: boolean;
  groupName?: string;
}

export interface WsMediaStateChange {
  callId: string;
  userId: string;
  isMuted?: boolean;
  isVideoEnabled?: boolean;
  isScreenSharing?: boolean;
}
