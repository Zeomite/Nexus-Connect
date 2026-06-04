import { z } from 'zod';

// Base event schema
export const BaseEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string(),
  timestamp: z.string().datetime(),
  version: z.string().default('1.0'),
  source: z.string(),
  correlationId: z.string().uuid().optional(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

// User events
export const UserEventTypes = {
  USER_REGISTERED: 'user.registered',
  USER_EMAIL_VERIFIED: 'user.email_verified',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_STATUS_CHANGED: 'user.status_changed',
  USER_DELETED: 'user.deleted',
} as const;

export interface UserRegisteredEvent extends BaseEvent {
  eventType: typeof UserEventTypes.USER_REGISTERED;
  payload: {
    userId: string;
    email: string;
    uniqueNumber: string;
    displayName: string;
  };
}

export interface UserStatusChangedEvent extends BaseEvent {
  eventType: typeof UserEventTypes.USER_STATUS_CHANGED;
  payload: {
    userId: string;
    previousStatus: string;
    newStatus: string;
  };
}

export interface UserEmailVerifiedEvent extends BaseEvent {
  eventType: typeof UserEventTypes.USER_EMAIL_VERIFIED;
  payload: {
    userId: string;
  };
}

export interface UserProfileUpdatedEvent extends BaseEvent {
  eventType: typeof UserEventTypes.USER_PROFILE_UPDATED;
  payload: {
    userId: string;
    changes: Record<string, unknown>;
  };
}

// Chat events
export const ChatEventTypes = {
  MESSAGE_SENT: 'chat.message_sent',
  MESSAGE_DELIVERED: 'chat.message_delivered',
  MESSAGE_READ: 'chat.message_read',
  MESSAGE_DELETED: 'chat.message_deleted',
  CHAT_CREATED: 'chat.created',
  PARTICIPANT_ADDED: 'chat.participant_added',
  PARTICIPANT_REMOVED: 'chat.participant_removed',
} as const;

export interface MessageSentEvent extends BaseEvent {
  eventType: typeof ChatEventTypes.MESSAGE_SENT;
  payload: {
    messageId: string;
    chatId: string;
    senderId: string;
    recipientIds: string[];
    messageType: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}

export interface MessageDeliveredEvent extends BaseEvent {
  eventType: typeof ChatEventTypes.MESSAGE_DELIVERED;
  payload: {
    messageId: string;
    chatId: string;
    deliveredToUserId: string;
    deliveredAt: string;
  };
}

export interface MessageReadEvent extends BaseEvent {
  eventType: typeof ChatEventTypes.MESSAGE_READ;
  payload: {
    messageIds: string[];
    chatId: string;
    readByUserId: string;
    readAt: string;
  };
}

export interface MessageDeletedEvent extends BaseEvent {
  eventType: typeof ChatEventTypes.MESSAGE_DELETED;
  payload: {
    messageId: string;
    chatId: string;
    deletedBy: string;
  };
}

export interface ChatCreatedEvent extends BaseEvent {
  eventType: typeof ChatEventTypes.CHAT_CREATED;
  payload: {
    chatId: string;
    type: string;
    name?: string;
    createdBy: string;
    participantIds: string[];
  };
}

export interface ChatParticipantRemovedEvent extends BaseEvent {
  eventType: typeof ChatEventTypes.PARTICIPANT_REMOVED;
  payload: {
    chatId: string;
    userId: string;
  };
}

// Call events
export const CallEventTypes = {
  CALL_INITIATED: 'call.initiated',
  CALL_RINGING: 'call.ringing',
  CALL_ANSWERED: 'call.answered',
  CALL_DECLINED: 'call.declined',
  CALL_ENDED: 'call.ended',
  CALL_MISSED: 'call.missed',
  PARTICIPANT_JOINED: 'call.participant_joined',
  PARTICIPANT_LEFT: 'call.participant_left',
  MEDIA_STATE_CHANGED: 'call.media_state_changed',
} as const;

export interface CallInitiatedEvent extends BaseEvent {
  eventType: typeof CallEventTypes.CALL_INITIATED;
  payload: {
    callId: string;
    roomId: string;
    initiatorId: string;
    participantIds: string[];
    callType: 'audio' | 'video';
    isGroupCall: boolean;
    groupId?: string;
  };
}

export interface CallEndedEvent extends BaseEvent {
  eventType: typeof CallEventTypes.CALL_ENDED;
  payload: {
    callId: string;
    endedBy: string;
    duration: number;
    participantCount: number;
    endReason: 'normal' | 'timeout' | 'error' | 'declined_all';
  };
}

export interface CallMissedEvent extends BaseEvent {
  eventType: typeof CallEventTypes.CALL_MISSED;
  payload: {
    callId: string;
    initiatorId: string;
    missedByUserId: string;
    callType: 'audio' | 'video';
  };
}

export interface CallIncomingEvent extends BaseEvent {
  eventType: 'call.incoming';
  payload: {
    callId: string;
    roomId: string;
    type: 'audio' | 'video';
    initiatorId: string;
    recipientId: string;
    isGroupCall: boolean;
  };
}

export interface CallAnsweredEvent extends BaseEvent {
  eventType: typeof CallEventTypes.CALL_ANSWERED;
  payload: {
    callId: string;
    userId: string;
  };
}

export interface CallDeclinedEvent extends BaseEvent {
  eventType: typeof CallEventTypes.CALL_DECLINED;
  payload: {
    callId: string;
    userId: string;
  };
}

export interface CallParticipantLeftEvent extends BaseEvent {
  eventType: typeof CallEventTypes.PARTICIPANT_LEFT;
  payload: {
    callId: string;
    participantId: string;
    reason?: string;
  };
}

// Group events
export const GroupEventTypes = {
  GROUP_CREATED: 'group.created',
  GROUP_UPDATED: 'group.updated',
  GROUP_DELETED: 'group.deleted',
  MEMBER_ADDED: 'group.member_added',
  MEMBER_REMOVED: 'group.member_removed',
  MEMBER_ROLE_CHANGED: 'group.member_role_changed',
} as const;

export interface GroupCreatedEvent extends BaseEvent {
  eventType: typeof GroupEventTypes.GROUP_CREATED;
  payload: {
    groupId: string;
    name: string;
    createdById: string;
    memberIds: string[];
  };
}

// Expense events
export const ExpenseEventTypes = {
  EXPENSE_CREATED: 'expense.created',
  EXPENSE_SETTLED: 'expense.settled',
  SETTLEMENT_RECORDED: 'expense.settlement_recorded',
} as const;

export interface ExpenseCreatedEvent extends BaseEvent {
  eventType: typeof ExpenseEventTypes.EXPENSE_CREATED;
  payload: {
    expenseId: string;
    groupId: string;
    createdById: string;
    totalAmount: number;
    currency: string;
    description: string;
    splitType: string;
    participantIds: string[];
  };
}

// Notification events
export const NotificationEventTypes = {
  SEND_EMAIL: 'notification.send_email',
  SEND_PUSH: 'notification.send_push',
} as const;

export interface SendEmailEvent extends BaseEvent {
  eventType: typeof NotificationEventTypes.SEND_EMAIL;
  payload: {
    to: string;
    subject: string;
    template: string;
    templateData: Record<string, unknown>;
  };
}

// Union type for all events
export type DomainEvent =
  | UserRegisteredEvent
  | UserStatusChangedEvent
  | UserEmailVerifiedEvent
  | UserProfileUpdatedEvent
  | MessageSentEvent
  | MessageDeliveredEvent
  | MessageReadEvent
  | MessageDeletedEvent
  | ChatCreatedEvent
  | ChatParticipantRemovedEvent
  | CallInitiatedEvent
  | CallEndedEvent
  | CallMissedEvent
  | CallIncomingEvent
  | CallAnsweredEvent
  | CallDeclinedEvent
  | CallParticipantLeftEvent
  | GroupCreatedEvent
  | ExpenseCreatedEvent
  | SendEmailEvent;
