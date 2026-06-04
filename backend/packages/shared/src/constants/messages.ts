// ===========================================
// Response Messages
// ===========================================

export const ResponseMessages = {
  // Auth
  AUTH: {
    REGISTRATION_SUCCESS: 'Registration successful. Please check your email to verify your account.',
    LOGIN_SUCCESS: 'Login successful',
    LOGOUT_SUCCESS: 'Logged out successfully',
    EMAIL_VERIFIED: 'Email verified successfully',
    VERIFICATION_EMAIL_SENT: 'If the email exists, a verification email has been sent',
    PASSWORD_RESET_SENT: 'If the email exists, a password reset link has been sent',
    PASSWORD_RESET_SUCCESS: 'Password reset successfully',
    TOKEN_REFRESHED: 'Token refreshed successfully',
  },

  // User
  USER: {
    PROFILE_UPDATED: 'Profile updated successfully',
    STATUS_UPDATED: 'Status updated successfully',
    AVATAR_UPLOADED: 'Avatar uploaded successfully',
  },

  // Chat
  CHAT: {
    MESSAGE_SENT: 'Message sent successfully',
    MESSAGE_DELETED: 'Message deleted',
    MESSAGES_READ: 'Messages marked as read',
    CHAT_CREATED: 'Chat created successfully',
    LEFT_CHAT: 'Left chat successfully',
  },

  // Call
  CALL: {
    CALL_INITIATED: 'Call initiated successfully',
    CALL_ACCEPTED: 'Call accepted',
    CALL_DECLINED: 'Call declined',
    CALL_ENDED: 'Call ended',
  },

  // Group
  GROUP: {
    CREATED: 'Group created successfully',
    UPDATED: 'Group updated successfully',
    DELETED: 'Group deleted successfully',
    MEMBER_ADDED: 'Member added successfully',
    MEMBER_REMOVED: 'Member removed successfully',
    ROLE_UPDATED: 'Member role updated successfully',
    LEFT_GROUP: 'Left group successfully',
  },

  // Expense
  EXPENSE: {
    CREATED: 'Expense created successfully',
    SETTLED: 'Expense settled successfully',
    SETTLEMENT_RECORDED: 'Settlement recorded successfully',
  },

  // Generic
  GENERIC: {
    SUCCESS: 'Operation completed successfully',
    CREATED: 'Created successfully',
    UPDATED: 'Updated successfully',
    DELETED: 'Deleted successfully',
  },
} as const;

// ===========================================
// Error Messages
// ===========================================

export const ErrorMessages = {
  // Auth
  AUTH: {
    INVALID_CREDENTIALS: 'Invalid email or password',
    EMAIL_NOT_VERIFIED: 'Email not verified. Please verify your email first.',
    EMAIL_ALREADY_EXISTS: 'Email already registered',
    TOKEN_EXPIRED: 'Token has expired',
    TOKEN_INVALID: 'Invalid token',
    UNAUTHORIZED: 'Unauthorized',
    MISSING_AUTH_HEADER: 'Missing authorization header',
    INVALID_AUTH_FORMAT: 'Invalid authorization header format',
  },

  // User
  USER: {
    NOT_FOUND: 'User not found',
    INVALID_STATUS: 'Invalid status value',
    INVALID_FILE_TYPE: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP',
    NO_FILE_UPLOADED: 'No file uploaded',
  },

  // Chat
  CHAT: {
    NOT_FOUND: 'Chat not found',
    NOT_PARTICIPANT: 'Not a chat participant',
    CANNOT_LEAVE_DIRECT: 'Cannot leave a direct chat',
    MESSAGE_NOT_FOUND: 'Message not found',
    CANNOT_DELETE_OTHERS: 'Can only delete your own messages',
  },

  // Call
  CALL: {
    NOT_FOUND: 'Call not found',
    ALREADY_IN_CALL: 'User already in a call',
    ROOM_FULL: 'Call room is full',
    NOT_PARTICIPANT: 'Not a call participant',
    CANNOT_END_CALL: 'Only the initiator can end the call for everyone',
  },

  // Group
  GROUP: {
    NOT_FOUND: 'Group not found',
    NOT_MEMBER: 'User is not a member of this group',
    INSUFFICIENT_PERMISSIONS: 'Insufficient permissions to perform this action',
    CANNOT_REMOVE_OWNER: 'Cannot remove the group owner',
    ALREADY_MEMBER: 'User is already a member of this group',
  },

  // Expense
  EXPENSE: {
    NOT_FOUND: 'Expense not found',
    INVALID_SPLIT_TYPE: 'Invalid split type',
    SPLITS_DONT_MATCH: 'Split amounts do not match total',
    PERCENTAGES_DONT_MATCH: 'Percentages must sum to 100',
  },

  // Rate Limiting
  RATE_LIMIT: {
    EXCEEDED: 'Too many requests. Please try again later.',
    LOGIN_EXCEEDED: 'Too many login attempts. Please try again later.',
    REGISTRATION_EXCEEDED: 'Too many registration attempts. Please try again later.',
  },

  // Validation
  VALIDATION: {
    FAILED: 'Validation failed',
    INVALID_UUID: 'Invalid UUID format',
    INVALID_EMAIL: 'Invalid email format',
    PASSWORD_TOO_SHORT: 'Password must be at least 8 characters',
    PASSWORD_TOO_WEAK: 'Password must contain uppercase, lowercase, number, and special character',
  },

  // Generic
  GENERIC: {
    NOT_FOUND: 'Resource not found',
    FORBIDDEN: 'Access forbidden',
    INTERNAL_ERROR: 'An unexpected error occurred',
    SERVICE_UNAVAILABLE: 'Service is temporarily unavailable',
    BAD_REQUEST: 'Bad request',
  },
} as const;

// ===========================================
// Validation Messages
// ===========================================

export const ValidationMessages = {
  EMAIL: {
    REQUIRED: 'Email is required',
    INVALID: 'Please enter a valid email address',
    MAX_LENGTH: 'Email must be less than 254 characters',
  },
  PASSWORD: {
    REQUIRED: 'Password is required',
    MIN_LENGTH: 'Password must be at least 8 characters',
    MAX_LENGTH: 'Password must be at most 128 characters',
    UPPERCASE: 'Password must contain at least one uppercase letter',
    LOWERCASE: 'Password must contain at least one lowercase letter',
    NUMBER: 'Password must contain at least one number',
    SPECIAL: 'Password must contain at least one special character',
  },
  DISPLAY_NAME: {
    REQUIRED: 'Display name is required',
    MIN_LENGTH: 'Display name must be at least 1 character',
    MAX_LENGTH: 'Display name must be at most 100 characters',
  },
  UNIQUE_NUMBER: {
    INVALID: 'Invalid unique number format. Must be 10 digits.',
  },
  MESSAGE: {
    REQUIRED: 'Message content is required',
    MAX_LENGTH: 'Message must be at most 10000 characters',
  },
  GROUP_NAME: {
    REQUIRED: 'Group name is required',
    MAX_LENGTH: 'Group name must be at most 100 characters',
  },
  AMOUNT: {
    REQUIRED: 'Amount is required',
    POSITIVE: 'Amount must be positive',
  },
} as const;
