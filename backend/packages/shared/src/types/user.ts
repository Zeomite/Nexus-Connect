import { z } from 'zod';

// User status enum
export const UserStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy',
  AWAY: 'away',
  DO_NOT_DISTURB: 'do_not_disturb',
} as const;

export type UserStatusType = (typeof UserStatus)[keyof typeof UserStatus];

// User schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  uniqueNumber: z.string().length(10).regex(/^\d{10}$/),
  displayName: z.string().min(1).max(100),
  profilePictureUrl: z.string().url().nullable(),
  status: z.enum(['online', 'offline', 'busy', 'away', 'do_not_disturb']),
  emailVerified: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastSeenAt: z.date().nullable(),
});

export type User = z.infer<typeof UserSchema>;

// Registration schema
export const RegisterUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
});

export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;

// Login schema
export const LoginUserSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type LoginUserInput = z.infer<typeof LoginUserSchema>;

// Update profile schema
export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  profilePictureUrl: z.string().url().nullable().optional(),
  status: z.enum(['online', 'offline', 'busy', 'away', 'do_not_disturb']).optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

// Token payload
export interface TokenPayload {
  userId: string;
  email: string;
  uniqueNumber: string;
  iat?: number;
  exp?: number;
}

// Refresh token schema
export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});
