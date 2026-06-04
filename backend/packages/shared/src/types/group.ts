import { z } from 'zod';

// Group role enum
export const GroupRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type GroupRoleType = (typeof GroupRole)[keyof typeof GroupRole];

// Group schema
export const GroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable(),
  avatarUrl: z.string().url().nullable(),
  createdById: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Group = z.infer<typeof GroupSchema>;

// Group member schema
export const GroupMemberSchema = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']),
  joinedAt: z.date(),
  invitedById: z.string().uuid().nullable(),
});

export type GroupMember = z.infer<typeof GroupMemberSchema>;

// Create group input
export const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  memberIds: z.array(z.string().uuid()).max(100).optional(),
});

export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

// Update group input
export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;

// Add member input
export const AddGroupMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'member']).default('member'),
});

export type AddGroupMemberInput = z.infer<typeof AddGroupMemberSchema>;

// Update member role input
export const UpdateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;

// Group permissions
export interface GroupPermissions {
  canEditGroup: boolean;
  canDeleteGroup: boolean;
  canAddMembers: boolean;
  canRemoveMembers: boolean;
  canPromoteMembers: boolean;
  canInitiateCall: boolean;
}

export const getGroupPermissions = (role: GroupRoleType): GroupPermissions => {
  switch (role) {
    case 'owner':
      return {
        canEditGroup: true,
        canDeleteGroup: true,
        canAddMembers: true,
        canRemoveMembers: true,
        canPromoteMembers: true,
        canInitiateCall: true,
      };
    case 'admin':
      return {
        canEditGroup: true,
        canDeleteGroup: false,
        canAddMembers: true,
        canRemoveMembers: true,
        canPromoteMembers: false,
        canInitiateCall: true,
      };
    case 'member':
      return {
        canEditGroup: false,
        canDeleteGroup: false,
        canAddMembers: false,
        canRemoveMembers: false,
        canPromoteMembers: false,
        canInitiateCall: true,
      };
  }
};
