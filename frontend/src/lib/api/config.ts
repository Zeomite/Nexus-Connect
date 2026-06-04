// API Configuration

const isDevelopment = "true"

export const API_CONFIG = {
  baseUrl: isDevelopment 
    ? 'http://localhost:8080' 
    : 'https://api.nexus.com',
  wsBaseUrl: isDevelopment
    ? 'ws://localhost:8080'
    : 'wss://api.nexus.com',
  endpoints: {
    // Auth
    register: '/api/v1/auth/register',
    login: '/api/v1/auth/login',
    refresh: '/api/v1/auth/refresh',
    verifyEmail: '/api/v1/auth/verify-email',
    resendVerification: '/api/v1/auth/resend-verification',
    forgotPassword: '/api/v1/auth/forgot-password',
    verifyResetCode: '/api/v1/auth/verify-reset-code',
    updatePassword: '/api/v1/auth/update-password',

    // Users
    me: '/api/v1/users/me',
    updateStatus: '/api/v1/users/me/status',
    searchByNumber: (number: string) => `/api/v1/search/by-number/${number}`,
    searchUsers: '/api/v1/search/users',

    // Chats
    chats: '/api/v1/chats',
    directChat: '/api/v1/chats/direct',
    groupChat: '/api/v1/chats/group',
    messages: '/api/v1/messages',
    chatMessages: (chatId: string) => `/api/v1/messages/chat/${chatId}`,
    markRead: '/api/v1/messages/read',

    // Calls
    initiateCall: '/api/v1/calls/initiate',
    acceptCall: (callId: string) => `/api/v1/calls/${callId}/accept`,
    declineCall: (callId: string) => `/api/v1/calls/${callId}/decline`,
    endCall: (callId: string) => `/api/v1/calls/${callId}/end`,
    activeCalls: '/api/v1/calls/active',

    // Call History
    callHistory: '/api/v1/history',

    // Groups
    groups: '/api/v1/groups',
    groupMembers: (groupId: string) => `/api/v1/groups/${groupId}/members`,
    groupBalances: (groupId: string) => `/api/v1/groups/${groupId}/balances`,

    // Expenses
    expenses: '/api/v1/expenses',
    settlements: '/api/v1/settlements',
  },
  websocket: {
    chat: '/ws/chat',
    signaling: '/ws/signaling',
    notifications: '/ws/notifications',
  },
} as const;

export const STORAGE_KEYS = {
  accessToken: 'nexus_access_token',
  refreshToken: 'nexus_refresh_token',
  user: 'nexus_user',
} as const;
