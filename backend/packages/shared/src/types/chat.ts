import { z } from 'zod';

// Message status enum
export const MessageStatus = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
} as const;

export type MessageStatusType = (typeof MessageStatus)[keyof typeof MessageStatus];

// Message type enum
export const MessageType = {
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
  AUDIO: 'audio',
  VIDEO: 'video',
  SYSTEM: 'system',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// Chat type enum
export const ChatType = {
  DIRECT: 'direct',
  GROUP: 'group',
} as const;

export type ChatTypeValue = (typeof ChatType)[keyof typeof ChatType];

// Message schema
export const MessageSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  senderId: z.string().uuid(),
  type: z.enum(['text', 'image', 'file', 'audio', 'video', 'system']),
  content: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  replyToId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});

export type Message = z.infer<typeof MessageSchema>;

// Chat schema
export const ChatSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['direct', 'group']),
  name: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Chat = z.infer<typeof ChatSchema>;

// Chat participant schema
export const ChatParticipantSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  joinedAt: z.date(),
  lastReadAt: z.date().nullable(),
  isAdmin: z.boolean(),
});

export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;

// Send message input
export const SendMessageSchema = z.object({
  chatId: z.string().uuid(),
  type: z.enum(['text', 'image', 'file', 'audio', 'video']).default('text'),
  content: z.string().min(1).max(10000),
  metadata: z.record(z.unknown()).optional(),
  replyToId: z.string().uuid().optional(),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

// Create chat input
export const CreateDirectChatSchema = z.object({
  participantId: z.string().uuid(),
});

export type CreateDirectChatInput = z.infer<typeof CreateDirectChatSchema>;

// Mark messages read input
export const MarkMessagesReadSchema = z.object({
  chatId: z.string().uuid(),
  messageIds: z.array(z.string().uuid()),
});

export type MarkMessagesReadInput = z.infer<typeof MarkMessagesReadSchema>;

// WebSocket chat events
export interface WsChatMessage {
  event: 'message:new' | 'message:delivered' | 'message:read' | 'message:deleted';
  data: Message | { messageIds: string[]; readBy: string };
}

export interface WsTypingEvent {
  event: 'typing:start' | 'typing:stop';
  data: {
    chatId: string;
    userId: string;
    displayName: string;
  };
}
